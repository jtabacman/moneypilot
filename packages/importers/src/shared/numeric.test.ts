import { describe, expect, it } from 'vitest'
import { parseAmount } from './numeric.js'

const canonical = (raw: string, exponent?: number) =>
  parseAmount(raw, exponent === undefined ? {} : { exponent })?.canonical

describe('formatos sin ambigüedad', () => {
  it('lee el formato anglosajón', () => {
    expect(canonical('1,234.56')).toBe('1234.56')
    expect(canonical('-1,234.56')).toBe('-1234.56')
    expect(canonical('1,234,567.89')).toBe('1234567.89')
  })

  it('lee el formato europeo', () => {
    expect(canonical('1.234,56')).toBe('1234.56')
    expect(canonical('-1.234,56')).toBe('-1234.56')
    expect(canonical('1.234.567,89')).toBe('1234567.89')
  })

  it('lee importes simples', () => {
    expect(canonical('42.50')).toBe('42.50')
    expect(canonical('42,50')).toBe('42.50')
    expect(canonical('42')).toBe('42')
    expect(canonical('0.00')).toBe('0.00')
  })

  it('quita símbolos y espacios', () => {
    expect(canonical('€ 1.234,56')).toBe('1234.56')
    expect(canonical('$1,234.56')).toBe('1234.56')
    expect(canonical('1 234,56')).toBe('1234.56')
    expect(canonical('USD -42.50')).toBe('-42.50')
  })
})

describe('convenciones de signo', () => {
  it('entiende los paréntesis contables', () => {
    expect(canonical('(42.50)')).toBe('-42.50')
    expect(canonical('(1.234,56)')).toBe('-1234.56')
  })

  it('entiende el signo al final', () => {
    // Convención de MT940 y de varios exports alemanes.
    expect(canonical('42.50-')).toBe('-42.50')
    expect(canonical('42.50+')).toBe('42.50')
  })

  it('no produce cero negativo', () => {
    expect(canonical('(0.00)')).toBe('0.00')
    expect(canonical('-0,00')).toBe('0.00')
  })
})

describe('el caso peligroso: un solo separador con tres dígitos detrás', () => {
  it('lo interpreta como miles y lo marca ambiguo', () => {
    // "1.234" vale 1234 en España y 1,234 en EE.UU. Elegir mal no da un error:
    // da un importe mil veces distinto. Se elige la lectura segura y se avisa.
    const parsed = parseAmount('1.234')
    expect(parsed?.canonical).toBe('1234')
    expect(parsed?.ambiguous).toBe(true)
    expect(parsed?.note).toContain('miles')

    expect(parseAmount('1,234')?.canonical).toBe('1234')
    expect(parseAmount('1,234')?.ambiguous).toBe(true)
  })

  it('deja de ser ambiguo si la moneda tiene tres decimales', () => {
    const parsed = parseAmount('1.234', { exponent: 3 })
    expect(parsed?.canonical).toBe('1.234')
    expect(parsed?.ambiguous).toBe(false)
  })

  it('deja de ser ambiguo si se fuerza el separador del fichero', () => {
    expect(parseAmount('1.234', { decimalSeparator: ',' })?.canonical).toBe('1234')
    expect(parseAmount('1.234', { decimalSeparator: ',' })?.ambiguous).toBe(false)
  })

  it('no es ambiguo cuando el separador aparece más de una vez', () => {
    const parsed = parseAmount('1.234.567')
    expect(parsed?.canonical).toBe('1234567')
    expect(parsed?.ambiguous).toBe(false)
  })
})

describe('entradas inválidas', () => {
  it('devuelve null en vez de inventar un número', () => {
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('   ')).toBeNull()
    expect(parseAmount('sin importe')).toBeNull()
    expect(parseAmount('-')).toBeNull()
  })

  it('rechaza más decimales de los que admite la moneda', () => {
    expect(parseAmount('42.5067')).toBeNull()
  })
})
