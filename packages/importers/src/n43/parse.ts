/**
 * Parser de Norma 43 (Cuaderno 43 / CSB43 / AEB43).
 *
 * Es el formato de extracto de todos los bancos grandes de España y convivirá
 * con camt.053 hasta 2028. Registros de texto plano de 80 caracteres, cada uno
 * empezando por un código de dos dígitos:
 *
 *   11  cabecera de cuenta      33  final de cuenta
 *   22  movimiento              88  fin de fichero
 *   23  concepto complementario (hasta 5 por movimiento)
 *   24  equivalencia de importe en divisa
 *
 * Dos cosas lo hacen valioso frente a OFX:
 *
 *  1. **Trae las dos puntas del saldo.** El registro 11 declara el saldo
 *     inicial y el 33 el final, así que la comprobación
 *     `apertura + haber − debe = cierre` se puede hacer con el fichero solo.
 *     Eso es una verificación real, no una tautología.
 *
 *  2. Los importes vienen como enteros de 14 dígitos con dos decimales
 *     implícitos: no hay separador decimal que interpretar mal.
 *
 * Y una desviación de la realidad que hay que respetar: **los ficheros reales
 * no traen 80 caracteres por línea.** Los bancos recortan los espacios finales,
 * así que llegan líneas de 70, 77 o 79. Un parser fiel a la especificación
 * rechaza el fichero entero por una diferencia que no cambia ni un dato.
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
  tryParsePlainDate,
} from '@moneypilot/core'
import { decodeBuffer } from '../shared/decode.js'
import { maskAccountNumber } from '../shared/mask.js'

/** Norma 43 es ISO-8859-1 de facto: los bancos españoles siguen ahí. */
const DEFAULT_ENCODING = 'iso-8859-1'

const RECORD_LENGTH = 80

/** Códigos ISO 4217 numéricos que aparecen en extractos españoles. */
const NUMERIC_CURRENCIES: Record<string, string> = {
  '978': 'EUR',
  '840': 'USD',
  '826': 'GBP',
  '756': 'CHF',
  '392': 'JPY',
  '124': 'CAD',
  '036': 'AUD',
  '152': 'CLP',
  '484': 'MXN',
  '032': 'ARS',
  '986': 'BRL',
}

export interface N43ParseOptions {
  /**
   * Siglo para las fechas de dos dígitos. La norma sólo trae AAMMDD, así que
   * "98" es 1998 y "26" es 2026: el corte por defecto es 70.
   */
  readonly centuryPivot?: number
}

export function parseN43(bytes: Uint8Array, options: N43ParseOptions = {}): ParsedStatement[] {
  const pivot = options.centuryPivot ?? 70
  const { text } = decodeBuffer(bytes, DEFAULT_ENCODING)

  const warnings: ParseWarning[] = []
  const statements: ParsedStatement[] = []

  let current: AccountBuilder | null = null
  let lineNumber = 0

  for (const rawLine of text.split(/\r?\n/)) {
    lineNumber += 1
    if (rawLine.trim() === '') continue

    // Rellenar en vez de rechazar: los bancos recortan los espacios finales.
    const line = rawLine.length < RECORD_LENGTH ? rawLine.padEnd(RECORD_LENGTH, ' ') : rawLine
    if (rawLine.length > RECORD_LENGTH) {
      warnings.push({
        severity: 'info',
        code: 'registro_largo',
        message: `El registro mide ${rawLine.length} caracteres en vez de ${RECORD_LENGTH}; se leen los primeros ${RECORD_LENGTH}.`,
        lineNumber,
      })
    }

    const code = line.slice(0, 2)

    if (code === '11') {
      if (current !== null) statements.push(current.build(warnings))
      current = new AccountBuilder(line, lineNumber, pivot, warnings)
      continue
    }

    if (current === null) {
      warnings.push({
        severity: 'error',
        code: 'registro_huerfano',
        message: `Registro ${code} antes de una cabecera de cuenta.`,
        lineNumber,
      })
      continue
    }

    if (code === '22') current.addMovement(line, lineNumber)
    else if (code === '23') current.addConcept(line, lineNumber)
    else if (code === '24') current.addEquivalence(line, lineNumber)
    else if (code === '33') current.close(line, lineNumber)
    else if (code === '88') continue
    else {
      warnings.push({
        severity: 'warning',
        code: 'registro_desconocido',
        message: `Código de registro no reconocido: ${JSON.stringify(code)}`,
        lineNumber,
      })
    }
  }

  if (current !== null) statements.push(current.build(warnings))
  return statements
}

// ── Constructor de una cuenta ────────────────────────────────────────────────

interface PendingMovement {
  readonly lineNumber: number
  readonly bookedOn: PlainDate
  readonly valuedOn: PlainDate | undefined
  readonly amount: Money
  readonly raw: Record<string, string>
  concepts: string[]
  native?: Money
}

class AccountBuilder {
  private readonly currency: CurrencyCode
  private readonly bank: string
  private readonly branch: string
  private readonly accountNumber: string
  private readonly name: string
  private readonly openingBalance: Money | undefined
  private readonly openingDate: PlainDate | undefined
  private closingBalance: Money | undefined
  private closingDate: PlainDate | undefined
  private declaredDebit: Money | undefined
  private declaredCredit: Money | undefined
  private readonly movements: PendingMovement[] = []
  private readonly pivot: number

  constructor(line: string, lineNumber: number, pivot: number, warnings: ParseWarning[]) {
    this.pivot = pivot
    this.bank = line.slice(2, 6).trim()
    this.branch = line.slice(6, 10).trim()
    this.accountNumber = line.slice(10, 20).trim()
    this.name = line.slice(51, 77).replace(/\*+/g, '').trim()

    const code = line.slice(47, 50)
    this.currency = resolveCurrency(code, warnings, lineNumber)

    this.openingDate = readDate(line.slice(20, 26), pivot)
    this.closingDate = readDate(line.slice(26, 32), pivot)

    const sign = line.slice(32, 33)
    const amount = readAmount(line.slice(33, 47), this.currency)
    this.openingBalance =
      amount === null
        ? undefined
        : { amount: applySign(amount.amount, sign), currency: this.currency }

    if (this.openingBalance === undefined) {
      warnings.push({
        severity: 'warning',
        code: 'saldo_inicial_ilegible',
        message: 'No se pudo leer el saldo inicial de la cabecera.',
        lineNumber,
      })
    }
  }

  addMovement(line: string, lineNumber: number): void {
    const bookedOn = readDate(line.slice(10, 16), this.pivot)
    const valuedOn = readDate(line.slice(16, 22), this.pivot)
    if (bookedOn === undefined) return

    const sign = line.slice(27, 28)
    const parsed = readAmount(line.slice(28, 42), this.currency)
    if (parsed === null) return

    this.movements.push({
      lineNumber,
      bookedOn,
      valuedOn,
      amount: { amount: applySign(parsed.amount, sign), currency: this.currency },
      concepts: [],
      raw: {
        oficina: line.slice(6, 10).trim(),
        concepto_comun: line.slice(22, 24),
        concepto_propio: line.slice(24, 27),
        documento: line.slice(42, 52).trim(),
        referencia1: line.slice(52, 64).trim(),
        referencia2: line.slice(64, 80).trim(),
      },
    })
  }

  /**
   * Registro 23: hasta cinco por movimiento.
   *
   * Cada registro trae **un texto continuo de 76 caracteres partido en dos
   * tramos de 38**, no dos campos independientes. Hay que concatenarlos en
   * crudo: unirlos con un separador parte al medio cualquier palabra que
   * cruce el límite. En el fichero de prueba, "SHOP TO BUY" quedaba como
   * "SHOP TO B UY".
   *
   * Entre registros distintos sí va un espacio: son líneas separadas.
   */
  addConcept(line: string, _lineNumber: number): void {
    const last = this.movements[this.movements.length - 1]
    if (last === undefined) return
    const text = (line.slice(4, 42) + line.slice(42, 80)).trim()
    if (text !== '') last.concepts.push(text)
  }

  /** Registro 24: importe original cuando el movimiento vino en otra divisa. */
  addEquivalence(line: string, lineNumber: number): void {
    const last = this.movements[this.movements.length - 1]
    if (last === undefined) return
    const code = line.slice(4, 7)
    let native: CurrencyCode
    try {
      native = resolveCurrency(code, [], lineNumber)
    } catch {
      return
    }
    const parsed = readAmount(line.slice(7, 21), native)
    if (parsed === null) return
    // El signo lo hereda del movimiento: la equivalencia no trae uno propio.
    const sign = last.amount.amount < 0n ? -1n : 1n
    last.native = { amount: parsed.amount * sign, currency: native }
  }

  close(line: string, lineNumber: number): void {
    const debitCount = line.slice(20, 25)
    void debitCount
    this.declaredDebit = readAmount(line.slice(25, 39), this.currency) ?? undefined
    this.declaredCredit = readAmount(line.slice(44, 58), this.currency) ?? undefined

    const sign = line.slice(58, 59)
    const parsed = readAmount(line.slice(59, 73), this.currency)
    this.closingBalance =
      parsed === null
        ? undefined
        : { amount: applySign(parsed.amount, sign), currency: this.currency }

    if (this.closingBalance === undefined) {
      // Un final de cuenta sin saldo legible deja al extracto sin la
      // comprobación aritmética, que es justamente lo que lo hace valioso.
      this.closingDate = this.closingDate ?? undefined
      void lineNumber
    }
  }

  build(warnings: ParseWarning[]): ParsedStatement {
    const lines: StatementLine[] = this.movements.map((movement, index) => ({
      lineNumber: movement.lineNumber,
      bookedOn: movement.bookedOn,
      amount: movement.amount,
      description: buildDescription(movement, index),
      raw: movement.raw,
      ...(movement.valuedOn === undefined ? {} : { valuedOn: movement.valuedOn }),
      ...(movement.native === undefined ? {} : { native: movement.native }),
    }))

    this.verifyArithmetic(warnings)

    return {
      format: 'n43',
      account: {
        currency: this.currency,
        ...(this.name === '' ? {} : { institution: this.name }),
        ...(maskAccountNumber(`${this.bank}${this.branch}${this.accountNumber}`) === undefined
          ? {}
          : { accountNumber: maskAccountNumber(this.accountNumber) as string }),
      },
      ...(this.openingBalance === undefined || this.openingDate === undefined
        ? {}
        : { openingBalance: { amount: this.openingBalance, on: this.openingDate } }),
      ...(this.closingBalance === undefined || this.closingDate === undefined
        ? {}
        : { closingBalance: { amount: this.closingBalance, on: this.closingDate } }),
      lines,
      warnings,
    }
  }

  /**
   * La comprobación que sólo permiten los formatos con las dos puntas:
   * apertura + haber − debe debe dar exactamente el cierre declarado.
   *
   * Si no cuadra, el problema está en el fichero o en este parser, y en
   * cualquiera de los dos casos hay que verlo antes de importar nada.
   */
  private verifyArithmetic(warnings: ParseWarning[]): void {
    if (this.openingBalance === undefined || this.closingBalance === undefined) return

    const movementsTotal = this.movements.reduce((total, m) => total + m.amount.amount, 0n)
    const expected = this.openingBalance.amount + movementsTotal
    if (expected !== this.closingBalance.amount) {
      warnings.push({
        severity: 'error',
        code: 'descuadre_aritmetico',
        message:
          `Apertura + movimientos = ${expected} pero el fichero declara ${this.closingBalance.amount} ` +
          `(diferencia ${expected - this.closingBalance.amount} en unidades mínimas de ${this.currency}).`,
      })
    }

    if (this.declaredDebit !== undefined && this.declaredCredit !== undefined) {
      const debit = this.movements
        .filter((m) => m.amount.amount < 0n)
        .reduce((total, m) => total - m.amount.amount, 0n)
      const credit = this.movements
        .filter((m) => m.amount.amount > 0n)
        .reduce((total, m) => total + m.amount.amount, 0n)
      if (debit !== this.declaredDebit.amount || credit !== this.declaredCredit.amount) {
        warnings.push({
          severity: 'warning',
          code: 'totales_no_coinciden',
          message:
            `Los totales del registro final no coinciden con los movimientos leídos ` +
            `(debe ${debit} contra ${this.declaredDebit.amount}, haber ${credit} contra ${this.declaredCredit.amount}).`,
        })
      }
    }
  }
}

// ── Utilidades de campo ──────────────────────────────────────────────────────

function buildDescription(movement: PendingMovement, index: number): string {
  if (movement.concepts.length > 0) return movement.concepts.join(' ')
  const reference = movement.raw['referencia2'] ?? ''
  if (reference !== '') return reference
  return `Movimiento ${index + 1}`
}

/**
 * La clave debe/haber: 1 = debe (sale de la cuenta), 2 = haber (entra).
 * Se normaliza a la convención del sistema, negativo = salida.
 */
function applySign(magnitude: bigint, signCode: string): bigint {
  return signCode === '1' ? -magnitude : magnitude
}

/** Importes: 14 dígitos, dos decimales implícitos, sin separador. */
function readAmount(field: string, currency: CurrencyCode): Money | null {
  const digits = field.trim()
  if (digits === '' || !/^\d+$/.test(digits)) return null
  const padded = digits.padStart(3, '0')
  const whole = padded.slice(0, -2)
  const cents = padded.slice(-2)
  try {
    return fromDecimalString(`${whole}.${cents}`, currency)
  } catch {
    return null
  }
}

/** Fechas AAMMDD con año de dos dígitos. */
function readDate(field: string, pivot: number): PlainDate | undefined {
  const digits = field.trim()
  if (!/^\d{6}$/.test(digits)) return undefined
  const yy = Number(digits.slice(0, 2))
  const year = yy < pivot ? 2000 + yy : 1900 + yy
  const parsed = tryParsePlainDate(`${year}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`)
  return parsed ?? undefined
}

/**
 * La clave de divisa de Norma 43 es **numérica** por especificación (978 para
 * el euro). Se acepta también el código alfabético porque hay emisores que lo
 * escriben así, pero dejando constancia: un banco que se sale de la norma en
 * un campo suele salirse en otros, y conviene que alguien lo mire.
 *
 * Lo que no se hace es aceptar tres letras cualesquiera en silencio. Un campo
 * con basura se convertiría en una "moneda" válida, y como el balanceo es por
 * moneda, cada una cerraría en cero por separado: el descuadre desaparecería
 * de la vista en vez de saltar.
 */
function resolveCurrency(code: string, warnings: ParseWarning[], lineNumber: number): CurrencyCode {
  const trimmed = code.trim()

  const numeric = NUMERIC_CURRENCIES[trimmed.padStart(3, '0')]
  if (numeric !== undefined) return currencyCode(numeric)

  const upper = trimmed.toUpperCase()
  if (/^[A-Z]{3}$/.test(upper) && Object.values(NUMERIC_CURRENCIES).includes(upper)) {
    warnings.push({
      severity: 'info',
      code: 'divisa_no_numerica',
      message: `La divisa viene como código alfabético (${upper}) y la norma pide el numérico.`,
      lineNumber,
    })
    return currencyCode(upper)
  }

  warnings.push({
    severity: 'warning',
    code: 'divisa_desconocida',
    message: `Clave de divisa no reconocida: ${JSON.stringify(code)}. Se asume EUR.`,
    lineNumber,
  })
  return currencyCode('EUR')
}
