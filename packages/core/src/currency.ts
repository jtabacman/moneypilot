/**
 * Monedas y sus exponentes decimales (ISO 4217).
 *
 * El exponente define cuántos dígitos tiene la unidad mínima. Todo importe en
 * el sistema se guarda como un entero de unidades mínimas, así que este número
 * es la única cosa que traduce entre "1234" y "12,34".
 *
 * Equivocarse acá no produce un error visible: produce importes 100x mal en una
 * moneda puntual. Por eso la lista de excepciones es explícita y el default es 2.
 */

export type CurrencyCode = string & { readonly __brand: 'CurrencyCode' }

/** Monedas sin decimales. */
const EXPONENT_0 = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'ISK',
  'JPY',
  'KMF',
  'KRW',
  'PYG',
  'RWF',
  'UGX',
  'UYI',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
])

/** Monedas con tres decimales (mils). */
const EXPONENT_3 = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'])

/**
 * MGA y MRU tienen subunidades de 1/5, no de 1/100. ISO 4217 les asigna
 * exponente 2 por convención y así lo tratamos: es lo que hacen los bancos.
 */

const CODE_RE = /^[A-Z]{3}$/

export function isCurrencyCode(value: string): value is CurrencyCode {
  return CODE_RE.test(value)
}

export function currencyCode(value: string): CurrencyCode {
  const upper = value.trim().toUpperCase()
  if (!isCurrencyCode(upper)) {
    throw new RangeError(`Código de moneda inválido: ${JSON.stringify(value)}`)
  }
  return upper
}

export function currencyExponent(currency: CurrencyCode): number {
  if (EXPONENT_0.has(currency)) return 0
  if (EXPONENT_3.has(currency)) return 3
  return 2
}

/** 10^exponente, como bigint. Para escalar entre unidades mínimas y mayores. */
export function currencyScale(currency: CurrencyCode): bigint {
  return 10n ** BigInt(currencyExponent(currency))
}
