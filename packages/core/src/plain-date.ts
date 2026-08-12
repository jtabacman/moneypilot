/**
 * Fecha de calendario sin hora ni zona horaria.
 *
 * Un movimiento bancario ocurre en un día, no en un instante. Guardarlo como
 * `Date` significa que un usuario en Madrid y uno en Buenos Aires ven meses
 * distintos para la misma transacción, y que los cortes de período se corren
 * un día según dónde corra el servidor.
 *
 * Representación: string `YYYY-MM-DD`, comparable lexicográficamente.
 */

export type PlainDate = string & { readonly __brand: 'PlainDate' }

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

export function daysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) throw new RangeError(`Mes fuera de rango: ${month}`)
  if (month === 2 && isLeapYear(year)) return 29
  return DAYS_IN_MONTH[month - 1] ?? 30
}

export function isValidYmd(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  if (year < 1 || year > 9999) return false
  if (month < 1 || month > 12) return false
  return day >= 1 && day <= daysInMonth(year, month)
}

export function plainDate(year: number, month: number, day: number): PlainDate {
  if (!isValidYmd(year, month, day)) {
    throw new RangeError(`Fecha inválida: ${year}-${month}-${day}`)
  }
  const yyyy = String(year).padStart(4, '0')
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}` as PlainDate
}

export function parsePlainDate(value: string): PlainDate {
  const parsed = tryParsePlainDate(value)
  if (parsed === null) throw new RangeError(`Fecha ISO inválida: ${JSON.stringify(value)}`)
  return parsed
}

export function tryParsePlainDate(value: string): PlainDate | null {
  const match = ISO_RE.exec(value.trim())
  if (!match) return null
  const [, y = '', m = '', d = ''] = match
  const year = Number(y)
  const month = Number(m)
  const day = Number(d)
  if (!isValidYmd(year, month, day)) return null
  return plainDate(year, month, day)
}

export interface DateParts {
  readonly year: number
  readonly month: number
  readonly day: number
}

export function toParts(date: PlainDate): DateParts {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  }
}

/** Días desde 1970-01-01. Aritmética entera pura, sin objetos Date. */
export function toEpochDay(date: PlainDate): number {
  const { year, month, day } = toParts(date)
  // Algoritmo de Howard Hinnant (days_from_civil).
  const y = month <= 2 ? year - 1 : year
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const mp = (month + 9) % 12
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

export function fromEpochDay(epochDay: number): PlainDate {
  // Inverso de toEpochDay (civil_from_days).
  const z = epochDay + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  )
  const y = yoe + era * 400
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1
  const month = mp < 10 ? mp + 3 : mp - 9
  return plainDate(month <= 2 ? y + 1 : y, month, day)
}

export function addDays(date: PlainDate, days: number): PlainDate {
  return fromEpochDay(toEpochDay(date) + days)
}

/** Días de `b` menos `a`. Positivo si `b` es posterior. */
export function differenceInDays(a: PlainDate, b: PlainDate): number {
  return toEpochDay(b) - toEpochDay(a)
}

export function comparePlainDate(a: PlainDate, b: PlainDate): -1 | 0 | 1 {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

export function minDate(a: PlainDate, b: PlainDate): PlainDate {
  return a <= b ? a : b
}

export function maxDate(a: PlainDate, b: PlainDate): PlainDate {
  return a >= b ? a : b
}

export function startOfMonth(date: PlainDate): PlainDate {
  const { year, month } = toParts(date)
  return plainDate(year, month, 1)
}

export function endOfMonth(date: PlainDate): PlainDate {
  const { year, month } = toParts(date)
  return plainDate(year, month, daysInMonth(year, month))
}
