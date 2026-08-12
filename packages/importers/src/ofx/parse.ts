/**
 * Parser de OFX 1.x, OFX 2.x y QFX.
 *
 * QFX es OFX con campos propietarios de Intuit (INTU.BID, INTU.USERID): el
 * mismo parser lo cubre, y esos campos van a `raw` sin interpretarse.
 *
 * Sobre saldos: OFX trae `LEDGERBAL` (saldo de cierre) pero **no trae saldo de
 * apertura**. Deliberadamente no lo derivamos restando los movimientos: eso
 * haría que el delta de reconciliación diera cero siempre y convertiría la
 * verificación en una tautología. Un extracto OFX sobre una cuenta nueva se
 * reporta como "sin saldo declarado", que es la verdad. La comprobación real
 * ocurre contra el histórico ya persistido, o con formatos que sí traen las
 * dos puntas (Norma 43, MT940).
 */

import {
  type CurrencyCode,
  currencyCode,
  fromDecimalString,
  type Money,
  type ParsedStatement,
  type ParseWarning,
  type PlainDate,
  type StatementBalance,
  type StatementLine,
  tryParsePlainDate,
} from '@moneypilot/core'
import { decodeBuffer } from '../shared/decode.js'
import { maskAccountNumber } from '../shared/mask.js'
import { parseAmount } from '../shared/numeric.js'
import { child, childrenOf, findAllDeep, type OfxNode, parseOfxTree, textOf } from './tokenize.js'

export interface OfxParseOptions {
  /** Se usa sólo si el fichero no declara CURDEF. */
  readonly fallbackCurrency?: string
}

/**
 * Un fichero OFX puede traer varias cuentas, así que devuelve un extracto por
 * cada `STMTRS` / `CCSTMTRS` encontrado.
 */
export function parseOfx(bytes: Uint8Array, options: OfxParseOptions = {}): ParsedStatement[] {
  const { declaredCharset, isQfx } = readHeader(bytes)
  const decoded = decodeBuffer(bytes, declaredCharset)
  const bodyStart = decoded.text.search(/<OFX[\s>]/i)
  const tree = parseOfxTree(bodyStart === -1 ? decoded.text : decoded.text.slice(bodyStart))

  const statements = [...findAllDeep(tree, 'STMTRS'), ...findAllDeep(tree, 'CCSTMTRS')]
  if (statements.length === 0) return []

  return statements.map((statement) => buildStatement(statement, options, isQfx))
}

interface HeaderInfo {
  readonly declaredCharset: string | undefined
  readonly isQfx: boolean
}

/**
 * La cabecera de OFX 1.x es texto plano ASCII antes del `<OFX>`, y es donde
 * viene el CHARSET. Hay que leerla antes de decodificar el fichero completo:
 * de ahí que se decodifique dos veces, la primera con un encoding que nunca
 * falla sólo para poder averiguar el correcto.
 */
function readHeader(bytes: Uint8Array): HeaderInfo {
  const probe = new TextDecoder('windows-1252').decode(bytes.subarray(0, 2048))
  const cut = probe.search(/<OFX[\s>]/i)
  const header = cut === -1 ? probe : probe.slice(0, cut)

  const charsetMatch = /^\s*CHARSET\s*:\s*(\S+)\s*$/im.exec(header)
  const xmlEncodingMatch = /encoding\s*=\s*["']([^"']+)["']/i.exec(header)
  const declaredCharset = charsetMatch?.[1] ?? xmlEncodingMatch?.[1]

  return { declaredCharset, isQfx: /INTU\.BID/i.test(probe) }
}

function buildStatement(
  statement: OfxNode,
  options: OfxParseOptions,
  isQfx: boolean,
): ParsedStatement {
  const warnings: ParseWarning[] = []

  const currency = resolveCurrency(statement, options, warnings)
  const account = child(statement, 'BANKACCTFROM') ?? child(statement, 'CCACCTFROM')
  const transactionList = child(statement, 'BANKTRANLIST')

  const lines: StatementLine[] = []
  for (const [index, node] of childrenOf(transactionList, 'STMTTRN').entries()) {
    const line = buildLine(node, index + 1, currency, warnings)
    if (line !== null) lines.push(line)
  }

  const closingBalance = readBalance(child(statement, 'LEDGERBAL'), currency)

  return {
    format: isQfx ? 'qfx' : 'ofx',
    account: {
      currency,
      ...pick('institution', textOf(account, 'BANKID')),
      ...pick('accountNumber', maskAccountNumber(textOf(account, 'ACCTID'))),
    },
    ...pick('closingBalance', closingBalance),
    lines,
    warnings,
  }
}

function resolveCurrency(
  statement: OfxNode,
  options: OfxParseOptions,
  warnings: ParseWarning[],
): CurrencyCode {
  const declared = textOf(statement, 'CURDEF')
  const fallback = options.fallbackCurrency
  const candidate = declared ?? fallback

  if (candidate === undefined) {
    warnings.push({
      severity: 'warning',
      code: 'moneda_no_declarada',
      message: 'El extracto no declara CURDEF; se asume USD. Verificar antes de importar.',
    })
    return currencyCode('USD')
  }
  try {
    return currencyCode(candidate)
  } catch {
    warnings.push({
      severity: 'error',
      code: 'moneda_invalida',
      message: `CURDEF inválido: ${JSON.stringify(candidate)}. Se asume USD.`,
    })
    return currencyCode('USD')
  }
}

function buildLine(
  node: OfxNode,
  lineNumber: number,
  currency: CurrencyCode,
  warnings: ParseWarning[],
): StatementLine | null {
  const raw = collectRaw(node)

  const bookedOn = parseOfxDate(textOf(node, 'DTPOSTED'))
  if (bookedOn === null) {
    warnings.push({
      severity: 'error',
      code: 'fecha_ilegible',
      message: `DTPOSTED ausente o inválido: ${textOf(node, 'DTPOSTED') ?? '(vacío)'}`,
      lineNumber,
    })
    return null
  }

  const amount = readAmount(textOf(node, 'TRNAMT'), currency, lineNumber, warnings)
  if (amount === null) return null

  const valuedOn = parseOfxDate(textOf(node, 'DTAVAIL') ?? textOf(node, 'DTUSER'))
  const foreign = readForeignCurrency(node, amount, lineNumber, warnings)

  return {
    lineNumber,
    bookedOn,
    amount,
    description: buildDescription(node),
    raw,
    ...pick('valuedOn', valuedOn ?? undefined),
    ...pick('externalId', textOf(node, 'FITID')),
    ...foreign,
  }
}

/**
 * `NAME` es el comercio y `MEMO` el detalle. Muchos bancos ponen lo mismo en
 * los dos; otros ponen el comercio en uno y la referencia en el otro. Se
 * concatenan sólo cuando aportan información distinta.
 */
function buildDescription(node: OfxNode): string {
  const payee = textOf(child(node, 'PAYEE'), 'NAME')
  const name = payee ?? textOf(node, 'NAME')
  const memo = textOf(node, 'MEMO')

  if (name !== undefined && memo !== undefined) {
    return name.trim() === memo.trim() ? name : `${name} · ${memo}`
  }
  return name ?? memo ?? textOf(node, 'TRNTYPE') ?? 'Sin descripción'
}

/**
 * OFX distingue dos situaciones y significan lo contrario:
 *  - `<CURRENCY>`: el importe **no** fue convertido; está en esa moneda.
 *  - `<ORIGCURRENCY>`: el importe **ya** fue convertido a CURDEF, y este campo
 *    dice cuál era la moneda original.
 *
 * `CURRATE` es la razón de CURDEF a CURSYM, de modo que el importe original se
 * obtiene dividiendo. Confundir la dirección produce importes plausibles y
 * equivocados, que es el peor tipo de error.
 */
function readForeignCurrency(
  node: OfxNode,
  amount: Money,
  lineNumber: number,
  warnings: ParseWarning[],
): Partial<Pick<StatementLine, 'native'>> {
  const origin = child(node, 'ORIGCURRENCY')
  if (origin === undefined) return {}

  const symbol = textOf(origin, 'CURSYM')
  const rate = textOf(origin, 'CURRATE')
  if (symbol === undefined || rate === undefined) return {}

  let originalCurrency: CurrencyCode
  try {
    originalCurrency = currencyCode(symbol)
  } catch {
    warnings.push({
      severity: 'warning',
      code: 'moneda_origen_invalida',
      message: `CURSYM inválido: ${symbol}`,
      lineNumber,
    })
    return {}
  }

  const parsedRate = parseAmount(rate, { exponent: 8 })
  if (parsedRate === null) {
    warnings.push({
      severity: 'warning',
      code: 'tasa_ilegible',
      message: `CURRATE ilegible: ${rate}`,
      lineNumber,
    })
    return {}
  }

  const [whole = '0', fraction = ''] = parsedRate.canonical.replace('-', '').split('.')
  const numerator = BigInt(whole + fraction)
  const denominator = 10n ** BigInt(fraction.length)
  if (numerator === 0n) return {}

  // Dividir por la tasa: value_en_CURSYM = value_en_CURDEF / CURRATE.
  const scale = 10n ** 6n
  const nativeMinor = (amount.amount * denominator * scale) / (numerator * scale)

  return { native: { amount: nativeMinor, currency: originalCurrency } }
}

function readAmount(
  raw: string | undefined,
  currency: CurrencyCode,
  lineNumber: number,
  warnings: ParseWarning[],
): Money | null {
  if (raw === undefined) {
    warnings.push({
      severity: 'error',
      code: 'importe_ilegible',
      message: 'TRNAMT ausente',
      lineNumber,
    })
    return null
  }
  const parsed = parseAmount(raw)
  if (parsed === null) {
    warnings.push({
      severity: 'error',
      code: 'importe_ilegible',
      message: `TRNAMT ilegible: ${raw}`,
      lineNumber,
    })
    return null
  }
  if (parsed.ambiguous) {
    warnings.push({
      severity: 'warning',
      code: 'importe_ambiguo',
      message: parsed.note ?? `Importe ambiguo: ${raw}`,
      lineNumber,
    })
  }
  try {
    return fromDecimalString(parsed.canonical, currency)
  } catch (error) {
    warnings.push({
      severity: 'error',
      code: 'importe_ilegible',
      message: `TRNAMT fuera de rango para ${currency}: ${raw} (${String(error)})`,
      lineNumber,
    })
    return null
  }
}

function readBalance(
  node: OfxNode | undefined,
  currency: CurrencyCode,
): StatementBalance | undefined {
  if (node === undefined) return undefined
  const amountText = textOf(node, 'BALAMT')
  const on = parseOfxDate(textOf(node, 'DTASOF'))
  if (amountText === undefined || on === null) return undefined
  const parsed = parseAmount(amountText)
  if (parsed === null) return undefined
  try {
    return { amount: fromDecimalString(parsed.canonical, currency), on }
  } catch {
    return undefined
  }
}

/**
 * Las fechas OFX son `YYYYMMDD` con hora y zona opcionales
 * (`20260312120000.000[-3:ART]`). Nos quedamos con el día tal como lo escribió
 * el banco: es la fecha contable que ese banco declara, y reinterpretarla en
 * otra zona horaria la correría un día.
 */
export function parseOfxDate(raw: string | undefined): PlainDate | null {
  if (raw === undefined) return null
  const digits = raw.trim().replace(/^(\d{8})[\s\S]*$/, '$1')
  if (!/^\d{8}$/.test(digits)) return null
  return tryParsePlainDate(`${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`)
}

/** Guarda todos los campos hoja del nodo. Lo que no se interpreta, no se pierde. */
function collectRaw(node: OfxNode): Record<string, string> {
  const raw: Record<string, string> = {}
  const walk = (current: OfxNode, prefix: string): void => {
    for (const candidate of current.children) {
      const key = prefix === '' ? candidate.tag : `${prefix}.${candidate.tag}`
      if (candidate.value !== null) raw[key] = candidate.value
      else walk(candidate, key)
    }
  }
  walk(node, '')
  return raw
}

/** Omite la clave cuando el valor es undefined, para respetar exactOptionalPropertyTypes. */
function pick<K extends string, V>(
  key: K,
  value: V | undefined,
): Record<K, V> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>)
}
