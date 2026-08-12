import { describe, expect, it } from 'vitest'
import {
  addDays,
  comparePlainDate,
  daysInMonth,
  differenceInDays,
  endOfMonth,
  fromEpochDay,
  isLeapYear,
  parsePlainDate,
  plainDate,
  startOfMonth,
  toEpochDay,
  tryParsePlainDate,
} from './plain-date.js'

describe('validación', () => {
  it('acepta fechas válidas y rechaza las que no existen', () => {
    expect(plainDate(2026, 2, 28)).toBe('2026-02-28')
    expect(() => plainDate(2026, 2, 29)).toThrow(RangeError)
    expect(plainDate(2024, 2, 29)).toBe('2024-02-29')
    expect(() => plainDate(2026, 13, 1)).toThrow(RangeError)
    expect(() => plainDate(2026, 4, 31)).toThrow(RangeError)
  })

  it('trata bien los años bisiestos seculares', () => {
    expect(isLeapYear(2000)).toBe(true)
    expect(isLeapYear(1900)).toBe(false)
    expect(isLeapYear(2100)).toBe(false)
    expect(daysInMonth(2000, 2)).toBe(29)
  })

  it('tryParse devuelve null en vez de tirar', () => {
    expect(tryParsePlainDate('no es fecha')).toBeNull()
    expect(tryParsePlainDate('2026-02-30')).toBeNull()
    expect(tryParsePlainDate('2026-08-12')).toBe('2026-08-12')
    expect(() => parsePlainDate('2026-02-30')).toThrow(RangeError)
  })
})

describe('aritmética de días', () => {
  it('va y vuelve por epoch day', () => {
    for (const date of ['1970-01-01', '2000-02-29', '2026-08-12', '1999-12-31', '2100-03-01']) {
      const parsed = parsePlainDate(date)
      expect(fromEpochDay(toEpochDay(parsed))).toBe(parsed)
    }
  })

  it('ancla el epoch en 1970-01-01', () => {
    expect(toEpochDay(parsePlainDate('1970-01-01'))).toBe(0)
    expect(toEpochDay(parsePlainDate('1969-12-31'))).toBe(-1)
  })

  it('cruza fin de mes y fin de año', () => {
    expect(addDays(parsePlainDate('2026-01-31'), 1)).toBe('2026-02-01')
    expect(addDays(parsePlainDate('2026-12-31'), 1)).toBe('2027-01-01')
    expect(addDays(parsePlainDate('2024-02-28'), 1)).toBe('2024-02-29')
    expect(addDays(parsePlainDate('2026-03-01'), -1)).toBe('2026-02-28')
  })

  it('calcula la ventana de ±5 días que usa el dedup', () => {
    const base = parsePlainDate('2026-03-01')
    expect(differenceInDays(base, addDays(base, 5))).toBe(5)
    expect(differenceInDays(base, addDays(base, -5))).toBe(-5)
  })

  it('no se corre un día por zona horaria', () => {
    // El bug clásico: new Date('2026-01-01') en UTC-3 devuelve 2025-12-31.
    // Acá no hay Date, así que no puede pasar.
    const date = parsePlainDate('2026-01-01')
    expect(startOfMonth(date)).toBe('2026-01-01')
    expect(endOfMonth(date)).toBe('2026-01-31')
    expect(endOfMonth(parsePlainDate('2024-02-10'))).toBe('2024-02-29')
  })

  it('ordena lexicográficamente igual que cronológicamente', () => {
    const dates = ['2026-10-01', '2026-02-09', '2026-02-10', '2025-12-31'].map(parsePlainDate)
    const sorted = [...dates].sort(comparePlainDate)
    expect(sorted).toEqual(['2025-12-31', '2026-02-09', '2026-02-10', '2026-10-01'])
    expect([...dates].sort()).toEqual(sorted)
  })
})
