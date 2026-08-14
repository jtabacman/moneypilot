import { describe, expect, it } from 'vitest'
import { hogarDePrueba, resumenDelHogar } from './hogar-de-prueba'

/**
 * Lo que se fija acá no es "que los datos existan" sino las tres cosas que, si
 * se rompen, hacen que la demo mienta sin avisar: la ventana que el sandbox
 * conserva, el signo, y que los traspasos entre cuentas propias tengan sus dos
 * patas.
 */

const BANCOS = ['ins_68', 'ins_76', 'ins_56'] as const

/** Sin `Date`, igual que el módulo: el corte es un dato, no la hora de correr. */
const HOY = '2026-08-13'
const HACE_90 = '2026-05-15'

describe('el hogar de prueba de Plaid', () => {
  it('cubre los tres bancos del catálogo que se conectan', () => {
    for (const id of BANCOS) expect(hogarDePrueba(id), id).toBeDefined()
  })

  it('deja las instituciones que no configuramos con el usuario por defecto', () => {
    // No es un hueco: sirve de grupo de control contra descriptores que no
    // escribimos nosotros.
    expect(hogarDePrueba('ins_109508')).toBeUndefined()
    expect(resumenDelHogar('ins_109508')).toBeUndefined()
  })

  it('no pone ni un movimiento fuera de los 90 días que el sandbox conserva', () => {
    // Medido: el sandbox descarta lo más viejo se pida lo que se pida en
    // `days_requested`. Un movimiento de hace 100 días no da error — desaparece,
    // que es peor.
    for (const id of BANCOS) {
      for (const cuenta of hogarDePrueba(id)?.override_accounts ?? []) {
        for (const m of cuenta.transactions) {
          expect(m.date_posted >= HACE_90, `${id} · ${m.description} · ${m.date_posted}`).toBe(true)
          expect(m.date_posted <= HOY, `${id} · ${m.description} · ${m.date_posted}`).toBe(true)
        }
      }
    }
  })

  it('mantiene el convenio de Plaid: positivo sale, negativo entra', () => {
    const entradas = BANCOS.flatMap((id) =>
      (hogarDePrueba(id)?.override_accounts ?? []).flatMap((c) =>
        c.transactions.filter((m) => m.amount < 0).map((m) => m.description),
      ),
    )
    // Si alguien "arregla" el signo pensando en el nuestro, la nómina pasa a ser
    // un gasto de 4.850 € y el hogar entero deja de tener sentido.
    expect(entradas).toContain('NOMINA ABONO EMPRESA IRIARTE PATRIMONIAL SL')
    expect(entradas.some((d) => d.startsWith('RENTAL INCOME'))).toBe(true)
    expect(entradas.length).toBeGreaterThanOrEqual(8)
  })

  it('cada movimiento lleva la moneda de su cuenta', () => {
    for (const id of BANCOS) {
      for (const cuenta of hogarDePrueba(id)?.override_accounts ?? []) {
        for (const m of cuenta.transactions) {
          expect(m.currency, `${id} · ${m.description}`).toBe(cuenta.currency)
        }
      }
    }
  })

  it('es un solo hogar: los traspasos entre cuentas propias tienen las dos patas', () => {
    // Es la señal más segura del clasificador y la que más distorsiona los
    // totales cuando falta una pata: el mismo dinero cuenta como gasto en un
    // banco y como ingreso en el otro.
    const salidas = (hogarDePrueba('ins_68')?.override_accounts[0]?.transactions ?? []).filter(
      (m) => m.description.includes('A CUENTA PROPIA CAIXABANK'),
    )
    const entradas = (hogarDePrueba('ins_76')?.override_accounts[0]?.transactions ?? []).filter(
      (m) => m.description.includes('DESDE CUENTA PROPIA BBVA'),
    )
    expect(salidas.length).toBe(entradas.length)
    expect(salidas.length).toBeGreaterThan(0)
    for (const salida of salidas) {
      const pareja = entradas.find((e) => e.date_posted === salida.date_posted)
      expect(pareja, `sin pareja el ${salida.date_posted}`).toBeDefined()
      expect(pareja?.amount).toBe(-salida.amount)
    }
  })

  it('trae más de una moneda, que es de lo que va el producto', () => {
    const monedas = new Set(
      BANCOS.flatMap((id) => (hogarDePrueba(id)?.override_accounts ?? []).map((c) => c.currency)),
    )
    expect([...monedas].sort()).toEqual(['EUR', 'USD'])
  })

  it('incluye una cuenta de pasivo, que es donde el saldo se cuenta al revés', () => {
    const tarjetas = (hogarDePrueba('ins_76')?.override_accounts ?? []).filter(
      (c) => c.type === 'credit',
    )
    expect(tarjetas.length).toBe(1)
    expect(tarjetas[0]?.starting_balance).toBeGreaterThan(0)
  })

  it('resume cuántas cuentas y movimientos trae cada banco', () => {
    expect(resumenDelHogar('ins_76')).toEqual({ cuentas: 2, movimientos: 27 })
  })
})
