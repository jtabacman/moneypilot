/**
 * Dinero como entero de unidades mínimas.
 *
 * Regla absoluta del sistema: ningún importe pasa nunca por un `number`.
 * Los flotantes de IEEE-754 no pueden representar 0,10 y este producto le
 * muestra reconciliaciones a contadores. Un céntimo de deriva es un delta
 * distinto de cero, y un delta distinto de cero es una cuenta perdida.
 */

import { type CurrencyCode, currencyCode, currencyExponent, currencyScale } from './currency.js'

export interface Money {
  /** Unidades mínimas. 12,34 EUR se guarda como 1234n. */
  readonly amount: bigint
  readonly currency: CurrencyCode
}

export function money(amount: bigint, currency: CurrencyCode | string): Money {
  return {
    amount,
    currency: typeof currency === 'string' ? currencyCode(currency) : currency,
  }
}

export function zero(currency: CurrencyCode | string): Money {
  return money(0n, currency)
}

export class CurrencyMismatchError extends Error {
  constructor(
    readonly left: CurrencyCode,
    readonly right: CurrencyCode,
  ) {
    super(`No se pueden operar importes en monedas distintas: ${left} y ${right}`)
    this.name = 'CurrencyMismatchError'
  }
}

function sameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency)
}

export function add(a: Money, b: Money): Money {
  sameCurrency(a, b)
  return { amount: a.amount + b.amount, currency: a.currency }
}

export function subtract(a: Money, b: Money): Money {
  sameCurrency(a, b)
  return { amount: a.amount - b.amount, currency: a.currency }
}

export function negate(a: Money): Money {
  return { amount: -a.amount, currency: a.currency }
}

export function absolute(a: Money): Money {
  return { amount: a.amount < 0n ? -a.amount : a.amount, currency: a.currency }
}

export function isZero(a: Money): boolean {
  return a.amount === 0n
}

export function isNegative(a: Money): boolean {
  return a.amount < 0n
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amount === b.amount
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  sameCurrency(a, b)
  if (a.amount < b.amount) return -1
  if (a.amount > b.amount) return 1
  return 0
}

export function sum(items: readonly Money[], currency: CurrencyCode | string): Money {
  const code = typeof currency === 'string' ? currencyCode(currency) : currency
  let total = 0n
  for (const item of items) {
    if (item.currency !== code) throw new CurrencyMismatchError(code, item.currency)
    total += item.amount
  }
  return { amount: total, currency: code }
}

/**
 * Reparte un importe en partes proporcionales a los pesos, **sin perder ni
 * ganar un céntimo**: la suma de las partes es exactamente igual al total.
 *
 * Usa el método del resto mayor. Es el mecanismo detrás de los gastos
 * compartidos con peso (60/40 entre persona y sociedad) y de los splits.
 * Un `Math.round` por parte pierde céntimos y rompe la partida doble.
 */
export function allocate(total: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) throw new RangeError('allocate necesita al menos un peso')
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
    throw new RangeError('Los pesos deben ser números finitos no negativos')
  }

  // Trabajamos en enteros para no depender de la aritmética de punto flotante
  // más allá de ordenar los restos. Escalamos los pesos a enteros grandes.
  const SCALE = 1_000_000
  const intWeights = weights.map((w) => BigInt(Math.round(w * SCALE)))
  const weightTotal = intWeights.reduce((acc, w) => acc + w, 0n)
  if (weightTotal === 0n) throw new RangeError('La suma de los pesos no puede ser cero')

  const sign = total.amount < 0n ? -1n : 1n
  const magnitude = total.amount * sign

  const bases: bigint[] = []
  const remainders: { index: number; remainder: bigint }[] = []
  let allocated = 0n

  for (const [index, weight] of intWeights.entries()) {
    const numerator = magnitude * weight
    const base = numerator / weightTotal
    bases.push(base)
    remainders.push({ index, remainder: numerator % weightTotal })
    allocated += base
  }

  // Los céntimos que sobran van, de a uno, a las partes con mayor resto.
  // Empate resuelto por índice para que el reparto sea determinista.
  let leftover = magnitude - allocated
  remainders.sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1
    return a.index - b.index
  })
  for (const { index } of remainders) {
    if (leftover <= 0n) break
    bases[index] = (bases[index] ?? 0n) + 1n
    leftover -= 1n
  }

  return bases.map((base) => ({
    amount: base * sign,
    currency: total.currency,
  }))
}

/**
 * Convierte a otra moneda con una tasa expresada como fracción exacta.
 *
 * La tasa se pasa como numerador/denominador enteros a propósito: guardar
 * "1,0873" como float y multiplicar produce resultados que no se pueden
 * reproducir. El redondeo es half-up sobre el valor absoluto, que es la
 * convención bancaria.
 */
export function convert(
  amount: Money,
  target: CurrencyCode | string,
  rateNumerator: bigint,
  rateDenominator: bigint,
): Money {
  if (rateDenominator === 0n) throw new RangeError('El denominador de la tasa no puede ser cero')
  const targetCode = typeof target === 'string' ? currencyCode(target) : target

  const sourceScale = currencyScale(amount.currency)
  const targetScale = currencyScale(targetCode)

  const sign = amount.amount < 0n ? -1n : 1n
  const magnitude = amount.amount * sign

  const numerator = magnitude * rateNumerator * targetScale
  const denominator = rateDenominator * sourceScale

  const quotient = numerator / denominator
  const remainder = numerator % denominator
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient

  return { amount: rounded * sign, currency: targetCode }
}

/**
 * Parsea un importe en forma canónica: opcional signo, dígitos, punto decimal.
 * No acepta separadores de miles ni comas decimales — eso lo resuelven los
 * parsers de cada formato, que sí conocen el locale del fichero de origen.
 */
export function fromDecimalString(value: string, currency: CurrencyCode | string): Money {
  const code = typeof currency === 'string' ? currencyCode(currency) : currency
  const trimmed = value.trim()
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(trimmed)
  if (!match) {
    throw new RangeError(`Importe no canónico: ${JSON.stringify(value)} (se esperaba -1234.56)`)
  }
  const [, signPart = '', wholePart = '0', fracPart = ''] = match
  const exponent = currencyExponent(code)

  if (fracPart.length > exponent) {
    // Truncar en silencio esconde plata. Si el origen trae más precisión de la
    // que la moneda admite, es un problema del parser y hay que verlo.
    const extra = fracPart.slice(exponent)
    if (/[^0]/.test(extra)) {
      throw new RangeError(
        `${trimmed} tiene más decimales de los que admite ${code} (${exponent}); ` +
          'redondear es decisión del parser, no del núcleo',
      )
    }
  }

  const padded = fracPart.padEnd(exponent, '0').slice(0, exponent)
  const minor = BigInt(wholePart) * currencyScale(code) + BigInt(padded === '' ? '0' : padded)
  return { amount: signPart === '-' ? -minor : minor, currency: code }
}

/** Forma canónica para mostrar, serializar y hashear. Siempre con punto. */
export function toDecimalString(value: Money): string {
  const exponent = currencyExponent(value.currency)
  const scale = currencyScale(value.currency)
  const sign = value.amount < 0n ? '-' : ''
  const magnitude = value.amount < 0n ? -value.amount : value.amount
  const whole = magnitude / scale
  if (exponent === 0) return `${sign}${whole}`
  const frac = (magnitude % scale).toString().padStart(exponent, '0')
  return `${sign}${whole}.${frac}`
}

export function formatMoney(value: Money): string {
  return `${toDecimalString(value)} ${value.currency}`
}
