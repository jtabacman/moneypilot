/**
 * Parser de QIF (Quicken Interchange Format).
 *
 * Es el formato de salida de Microsoft Money y de Quicken, así que es la
 * puerta del cohorte legacy: gente con quince o veinte años de historia que
 * no migra porque cree que va a perderla.
 *
 * QIF es un formato malo, y hay que diseñar alrededor de sus defectos:
 *
 *  - **No tiene identificador de transacción.** No hay FITID ni equivalente,
 *    así que la identidad depende enteramente de la huella canónica del
 *    núcleo. KMyMoney tuvo que inventarse un campo propietario para esto.
 *
 *  - **No declara el orden de la fecha.** Ver `shared/dates.ts`.
 *
 *  - **No trae moneda ni tipo de cambio.** La moneda la pone quien importa,
 *    por cuenta. Un QIF con cuentas en monedas distintas no se puede resolver
 *    solo, y eso hay que decirlo en vez de asumir.
 *
 *  - **No trae saldo de apertura ni de cierre.** Como OFX, la reconciliación
 *    depende de datos externos al fichero.
 *
 *  - **Microsoft Money escribe cada transferencia dos veces**, una en el QIF
 *    de cada cuenta. Eso lo resuelve el emparejamiento de transferencias
 *    aguas abajo, no el parser.
 */

import {
  type CurrencyCode,
  currencyCode,
  fromDecimalString,
  type Money,
  type ParsedStatement,
  type ParseWarning,
  type PlainDate,
  type StatementLine,
} from '@moneypilot/core'
import { type DateOrder, detectDateOrder, parseDateWithOrder } from '../shared/dates.js'
import { decodeBuffer } from '../shared/decode.js'
import { parseAmount } from '../shared/numeric.js'

export interface QifParseOptions {
  /** QIF no declara moneda: la pone quien importa. */
  readonly currency: string
  /** Fuerza el orden de fecha cuando el fichero es ambiguo. */
  readonly dateOrder?: DateOrder
  readonly centuryPivot?: number
}

interface RawTransaction {
  readonly startLine: number
  readonly fields: { code: string; value: string; line: number }[]
}

export function parseQif(bytes: Uint8Array, options: QifParseOptions): ParsedStatement {
  const currency = currencyCode(options.currency)
  const { text } = decodeBuffer(bytes)
  const warnings: ParseWarning[] = []

  const { transactions, accountName, type } = tokenize(text)

  // Primero el fichero entero, después las filas: una sola fecha con día
  // mayor que 12 en cualquier parte desambigua todas las demás.
  const dateSamples = transactions.flatMap((tx) =>
    tx.fields.filter((f) => f.code === 'D').map((f) => f.value),
  )
  const detection = detectDateOrder(dateSamples)
  const order = options.dateOrder ?? detection.order

  if (options.dateOrder === undefined && detection.ambiguous) {
    warnings.push({
      severity: 'warning',
      code: 'fecha_ambigua',
      message:
        `No se pudo determinar el orden de la fecha: ${detection.evidence}. ` +
        `Se asumió ${detection.order}. Confirmá antes de importar: si es al revés, ` +
        'las transacciones quedan en el mes equivocado.',
    })
  } else if (options.dateOrder === undefined) {
    warnings.push({
      severity: 'info',
      code: 'fecha_detectada',
      message: `Orden de fecha ${order} (${detection.evidence}).`,
    })
  }

  const lines: StatementLine[] = []
  for (const transaction of transactions) {
    const line = buildLine(transaction, order, currency, options, warnings)
    if (line !== null) lines.push(line)
  }

  return {
    format: 'qif',
    account: {
      currency,
      ...(accountName === undefined ? {} : { institution: accountName }),
    },
    lines,
    warnings: [
      ...warnings,
      ...(type === undefined
        ? []
        : [
            {
              severity: 'info' as const,
              code: 'tipo_qif',
              message: `Tipo declarado: ${type}.`,
            },
          ]),
    ],
  }
}

/**
 * Divide el fichero en transacciones. Cada línea es un código de un carácter
 * seguido de su valor; el carácter `^` cierra la transacción en curso.
 */
function tokenize(text: string): {
  transactions: RawTransaction[]
  accountName: string | undefined
  type: string | undefined
} {
  const transactions: RawTransaction[] = []
  let current: RawTransaction | null = null
  let accountName: string | undefined
  let type: string | undefined
  let inAccountBlock = false
  let lineNumber = 0

  for (const rawLine of text.split(/\r?\n/)) {
    lineNumber += 1
    const line = rawLine.trimEnd()
    if (line === '') continue

    if (line.startsWith('!')) {
      const directive = line.slice(1).trim()
      // `!Account` abre un bloque que describe la cuenta, no una transacción.
      inAccountBlock = /^Account$/i.test(directive)
      if (/^Type:/i.test(directive)) {
        type = directive.slice(5)
        inAccountBlock = false
      }
      current = null
      continue
    }

    if (line === '^') {
      if (current !== null && current.fields.length > 0) transactions.push(current)
      current = null
      inAccountBlock = false
      continue
    }

    const code = line.slice(0, 1)
    const value = line.slice(1).trim()

    if (inAccountBlock) {
      if (code === 'N') accountName = value
      continue
    }

    if (current === null) current = { startLine: lineNumber, fields: [] }
    current.fields.push({ code, value, line: lineNumber })
  }

  if (current !== null && current.fields.length > 0) transactions.push(current)
  return { transactions, accountName, type }
}

function buildLine(
  transaction: RawTransaction,
  order: DateOrder,
  currency: CurrencyCode,
  options: QifParseOptions,
  warnings: ParseWarning[],
): StatementLine | null {
  const get = (code: string): string | undefined =>
    transaction.fields.find((f) => f.code === code)?.value
  const all = (code: string): string[] =>
    transaction.fields.filter((f) => f.code === code).map((f) => f.value)

  const lineNumber = transaction.startLine

  const dateRaw = get('D')
  const bookedOn: PlainDate | null =
    dateRaw === undefined
      ? null
      : parseDateWithOrder(dateRaw, order, {
          ...(options.centuryPivot === undefined ? {} : { centuryPivot: options.centuryPivot }),
        })

  if (bookedOn === null) {
    warnings.push({
      severity: 'error',
      code: 'fecha_ilegible',
      message: `Fecha ausente o ilegible: ${dateRaw ?? '(sin campo D)'}`,
      lineNumber,
    })
    return null
  }

  // `U` es el importe en las versiones nuevas y `T` en las viejas. Cuando
  // están los dos traen lo mismo; se prefiere T porque es el universal.
  const amountRaw = get('T') ?? get('U')
  if (amountRaw === undefined) {
    warnings.push({
      severity: 'error',
      code: 'importe_ilegible',
      message: 'La transacción no tiene campo de importe (T ni U).',
      lineNumber,
    })
    return null
  }

  const parsedAmount = parseAmount(amountRaw)
  if (parsedAmount === null) {
    warnings.push({
      severity: 'error',
      code: 'importe_ilegible',
      message: `Importe ilegible: ${amountRaw}`,
      lineNumber,
    })
    return null
  }
  if (parsedAmount.ambiguous) {
    warnings.push({
      severity: 'warning',
      code: 'importe_ambiguo',
      message: parsedAmount.note ?? `Importe ambiguo: ${amountRaw}`,
      lineNumber,
    })
  }

  let amount: Money
  try {
    amount = fromDecimalString(parsedAmount.canonical, currency)
  } catch (error) {
    warnings.push({
      severity: 'error',
      code: 'importe_ilegible',
      message: `Importe fuera de rango para ${currency}: ${amountRaw} (${String(error)})`,
      lineNumber,
    })
    return null
  }

  const payee = get('P')
  const memo = get('M')
  const category = get('L')

  const raw: Record<string, string> = {}
  for (const field of transaction.fields) {
    // Los códigos repetidos (splits) se acumulan en vez de pisarse.
    raw[field.code] =
      raw[field.code] === undefined ? field.value : `${raw[field.code]}\n${field.value}`
  }

  const splitCategories = all('S')
  if (splitCategories.length > 0) {
    warnings.push({
      severity: 'info',
      code: 'split_detectado',
      message: `Transacción con ${splitCategories.length} desglose(s); se conservan en raw.`,
      lineNumber,
    })
  }

  return {
    lineNumber,
    bookedOn,
    amount,
    description: buildDescription(payee, memo, category),
    raw,
  }
}

function buildDescription(
  payee: string | undefined,
  memo: string | undefined,
  category: string | undefined,
): string {
  if (payee !== undefined && memo !== undefined && payee.trim() !== memo.trim()) {
    return `${payee} · ${memo}`
  }
  return payee ?? memo ?? category ?? 'Sin descripción'
}
