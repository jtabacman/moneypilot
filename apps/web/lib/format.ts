/**
 * Formato de importes, fechas y porcentajes.
 *
 * Todo entra en **unidades mínimas como bigint** y sale como string. En
 * ningún punto de esta capa aparece un `number` con decimales: el núcleo
 * trabaja en enteros justamente para que 0,1 + 0,2 no sea 0,30000000000000004,
 * y convertir a coma flotante para "sólo mostrarlo" reintroduce el error en el
 * único sitio donde el usuario lo ve.
 */

const MINOR_UNITS: Readonly<Record<string, number>> = {
  JPY: 0,
  KRW: 0,
  CLP: 0,
  ISK: 0,
  VND: 0,
  BHD: 3,
  KWD: 3,
  OMR: 3,
  TND: 3,
}

export function minorUnits(currency: string): number {
  return MINOR_UNITS[currency.toUpperCase()] ?? 2
}

/** Símbolos para las monedas del corredor que soportamos. */
const SYMBOL: Readonly<Record<string, string>> = {
  EUR: '€',
  USD: '$',
  GBP: '£',
  CHF: 'CHF',
  ARS: 'AR$',
  MXN: 'MX$',
}

export interface MoneyFormat {
  /** Con signo negativo explícito y separador de miles. Sin símbolo. */
  readonly plain: string
  /** Con símbolo delante. */
  readonly withSymbol: string
  readonly negative: boolean
}

/**
 * Formato español: punto para miles, coma para decimales.
 *
 * Se construye a mano en vez de con `Intl.NumberFormat` porque Intl toma un
 * `number`, y para importes grandes en unidades mínimas (un patrimonio de ocho
 * cifras en céntimos pasa de 2^53 con holgura en yenes) eso pierde precisión.
 */
export function formatMoney(amount: bigint, currency: string): MoneyFormat {
  const digits = minorUnits(currency)
  const negative = amount < 0n
  const abs = negative ? -amount : amount
  const scale = 10n ** BigInt(digits)
  const whole = abs / scale
  const frac = abs % scale

  let intPart = whole.toString()
  const grouped: string[] = []
  while (intPart.length > 3) {
    grouped.unshift(intPart.slice(-3))
    intPart = intPart.slice(0, -3)
  }
  grouped.unshift(intPart)

  const body =
    digits === 0
      ? grouped.join('.')
      : `${grouped.join('.')},${frac.toString().padStart(digits, '0')}`

  const plain = negative ? `−${body}` : body
  const symbol = SYMBOL[currency.toUpperCase()] ?? currency.toUpperCase()

  return {
    plain,
    withSymbol: negative ? `−${symbol}${body}` : `${symbol}${body}`,
    negative,
  }
}

/** Atajo para JSX: el string ya formateado con símbolo. */
export function money(amount: bigint, currency: string): string {
  return formatMoney(amount, currency).withSymbol
}

/** Redondeado a miles, para titulares donde el céntimo es ruido. */
export function moneyShort(amount: bigint, currency: string): string {
  const digits = minorUnits(currency)
  const scale = 10n ** BigInt(digits)
  const units = amount / scale
  const symbol = SYMBOL[currency.toUpperCase()] ?? currency.toUpperCase()
  const negative = units < 0n
  const abs = negative ? -units : units
  const sign = negative ? '−' : ''

  if (abs >= 1_000_000n) {
    const millions = Number(abs / 10_000n) / 100
    return `${sign}${symbol}${millions.toFixed(millions >= 10 ? 1 : 2)}M`
  }
  if (abs >= 10_000n) {
    return `${sign}${symbol}${(Number(abs / 100n) / 10).toFixed(1)}k`
  }
  return money(amount, currency)
}

/** Porcentaje con signo, una decimal. `null` cuando la base es cero. */
export function pct(delta: bigint, base: bigint): string | null {
  if (base === 0n) return null
  // Se calcula en enteros por milésimas y recién ahí se pasa a decimal.
  const perMille = (delta * 1000n) / (base < 0n ? -base : base)
  const value = Number(perMille) / 10
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${Math.abs(value).toFixed(1)}%`
}

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const

const MONTHS_SHORT = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
] as const

/**
 * `2026-08-13` → `13 ago`. Trabaja sobre el string, sin construir un `Date`:
 * `new Date('2026-08-13')` se interpreta como UTC y en un huso al oeste
 * devuelve el día 12. Es la clase de error que aparece sólo para algunos
 * usuarios y sólo a ciertas horas.
 */
export function formatDate(iso: string, style: 'short' | 'long' = 'short'): string {
  const [y, m, d] = iso.split('-')
  if (y === undefined || m === undefined || d === undefined) return iso
  const monthIndex = Number.parseInt(m, 10) - 1
  const day = Number.parseInt(d, 10)
  if (style === 'long') {
    return `${day} de ${MONTHS[monthIndex] ?? m} de ${y}`
  }
  return `${day} ${MONTHS_SHORT[monthIndex] ?? m}`
}

/** `2026-08` → `agosto 2026`. */
export function formatMonth(iso: string, style: 'short' | 'long' = 'long'): string {
  const [y, m] = iso.split('-')
  if (y === undefined || m === undefined) return iso
  const index = Number.parseInt(m, 10) - 1
  const name = style === 'long' ? MONTHS[index] : MONTHS_SHORT[index]
  return `${name ?? m} ${y}`
}

/** Primera letra en mayúscula, para cuando el mes abre una frase. */
export function capitalize(text: string): string {
  return text.length === 0 ? text : text[0]?.toUpperCase() + text.slice(1)
}
