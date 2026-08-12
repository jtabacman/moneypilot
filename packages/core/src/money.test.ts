import { describe, expect, it } from 'vitest'
import { currencyCode } from './currency.js'
import {
  add,
  allocate,
  CurrencyMismatchError,
  convert,
  formatMoney,
  fromDecimalString,
  money,
  subtract,
  sum,
  toDecimalString,
} from './money.js'

const EUR = currencyCode('EUR')
const USD = currencyCode('USD')
const JPY = currencyCode('JPY')
const KWD = currencyCode('KWD')

describe('parseo y formato', () => {
  it('respeta el exponente de cada moneda', () => {
    expect(fromDecimalString('12.34', EUR).amount).toBe(1234n)
    expect(fromDecimalString('12', JPY).amount).toBe(12n)
    expect(fromDecimalString('12.345', KWD).amount).toBe(12345n)
  })

  it('hace ida y vuelta sin perder nada', () => {
    for (const value of ['0.00', '-0.01', '1234567890.99', '-999.05']) {
      expect(toDecimalString(fromDecimalString(value, EUR))).toBe(value)
    }
  })

  it('representa exactamente los importes que el float rompe', () => {
    // 0.1 + 0.2 === 0.30000000000000004 en IEEE-754.
    const total = add(fromDecimalString('0.10', EUR), fromDecimalString('0.20', EUR))
    expect(toDecimalString(total)).toBe('0.30')
  })

  it('rechaza formatos no canónicos en vez de adivinar', () => {
    expect(() => fromDecimalString('1.234,56', EUR)).toThrow(RangeError)
    expect(() => fromDecimalString('1,234.56', EUR)).toThrow(RangeError)
    expect(() => fromDecimalString('12.345', EUR)).toThrow(/más decimales/)
  })

  it('acepta decimales de más si son ceros', () => {
    expect(fromDecimalString('12.3400', EUR).amount).toBe(1234n)
  })

  it('formatea con el código de moneda', () => {
    expect(formatMoney(money(-1234n, EUR))).toBe('-12.34 EUR')
    expect(formatMoney(money(1234n, JPY))).toBe('1234 JPY')
  })
})

describe('aritmética', () => {
  it('no deja mezclar monedas', () => {
    expect(() => add(money(100n, EUR), money(100n, USD))).toThrow(CurrencyMismatchError)
    expect(() => subtract(money(100n, EUR), money(100n, USD))).toThrow(CurrencyMismatchError)
    expect(() => sum([money(100n, EUR)], USD)).toThrow(CurrencyMismatchError)
  })

  it('suma listas vacías como cero', () => {
    expect(sum([], EUR).amount).toBe(0n)
  })
})

describe('allocate: reparto sin perder céntimos', () => {
  it('reparte 60/40 exacto', () => {
    const parts = allocate(fromDecimalString('100.00', EUR), [0.6, 0.4])
    expect(parts.map(toDecimalString)).toEqual(['60.00', '40.00'])
  })

  it('reparte importes indivisibles sin crear ni perder plata', () => {
    const total = fromDecimalString('100.00', EUR)
    const parts = allocate(total, [1, 1, 1])
    expect(parts.map(toDecimalString)).toEqual(['33.34', '33.33', '33.33'])
    expect(sum(parts, EUR).amount).toBe(total.amount)
  })

  it('mantiene la suma exacta en cientos de casos', () => {
    for (let cents = 1n; cents <= 500n; cents += 1n) {
      const total = money(cents, EUR)
      for (const weights of [
        [1, 1],
        [1, 2],
        [0.6, 0.4],
        [1, 1, 1],
        [5, 3, 2],
        [7, 11, 13, 17],
      ]) {
        const parts = allocate(total, weights)
        expect(sum(parts, EUR).amount).toBe(cents)
        expect(parts).toHaveLength(weights.length)
      }
    }
  })

  it('preserva el signo en importes negativos', () => {
    const parts = allocate(fromDecimalString('-100.00', EUR), [1, 1, 1])
    expect(sum(parts, EUR).amount).toBe(-10000n)
    expect(parts.every((p) => p.amount < 0n)).toBe(true)
  })

  it('es determinista ante empates', () => {
    const a = allocate(money(100n, EUR), [1, 1, 1])
    const b = allocate(money(100n, EUR), [1, 1, 1])
    expect(a.map(toDecimalString)).toEqual(b.map(toDecimalString))
  })

  it('rechaza pesos inválidos', () => {
    expect(() => allocate(money(100n, EUR), [])).toThrow(RangeError)
    expect(() => allocate(money(100n, EUR), [0, 0])).toThrow(RangeError)
    expect(() => allocate(money(100n, EUR), [-1, 2])).toThrow(RangeError)
    expect(() => allocate(money(100n, EUR), [Number.NaN])).toThrow(RangeError)
  })
})

describe('convert', () => {
  it('convierte con tasa como fracción exacta', () => {
    // 100,00 EUR a 1,0873 USD/EUR
    const result = convert(fromDecimalString('100.00', EUR), USD, 10873n, 10000n)
    expect(toDecimalString(result)).toBe('108.73')
  })

  it('redondea half-up sobre el valor absoluto', () => {
    // 1,00 EUR × 1,005 = 1,005 -> 1,01
    expect(toDecimalString(convert(money(100n, EUR), USD, 1005n, 1000n))).toBe('1.01')
    // El negativo redondea simétricamente, no hacia cero.
    expect(toDecimalString(convert(money(-100n, EUR), USD, 1005n, 1000n))).toBe('-1.01')
  })

  it('cruza monedas con exponentes distintos', () => {
    // 1.000 JPY (exponente 0) a EUR (exponente 2) con tasa 0,0062
    const result = convert(money(1000n, JPY), EUR, 62n, 10000n)
    expect(toDecimalString(result)).toBe('6.20')
  })

  it('rechaza denominador cero', () => {
    expect(() => convert(money(100n, EUR), USD, 1n, 0n)).toThrow(RangeError)
  })
})
