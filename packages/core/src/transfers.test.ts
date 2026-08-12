import { describe, expect, it } from 'vitest'
import { currencyCode } from './currency.js'
import { fromDecimalString } from './money.js'
import { parsePlainDate } from './plain-date.js'
import { matchTransfers, type TransferLeg } from './transfers.js'

const EUR = currencyCode('EUR')
const USD = currencyCode('USD')

const CHECKING = 'acct-checking-eur'
const SAVINGS = 'acct-savings-eur'
const USD_ACCT = 'acct-savings-usd'

const leg = (
  id: string,
  accountId: string,
  date: string,
  amount: string,
  currency = EUR,
  description = 'TRASPASO',
): TransferLeg => ({
  id,
  accountId,
  bookedOn: parsePlainDate(date),
  amount: fromDecimalString(amount, currency),
  description,
})

describe('emparejamiento básico', () => {
  it('empareja salida y entrada del mismo importe', () => {
    const { pairs, unmatched } = matchTransfers([
      leg('a', CHECKING, '2026-03-01', '-1000.00'),
      leg('b', SAVINGS, '2026-03-01', '1000.00'),
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.confidence).toBe('exact')
    expect(pairs[0]?.outgoing.id).toBe('a')
    expect(pairs[0]?.incoming.id).toBe('b')
    expect(unmatched).toHaveLength(0)
  })

  it('tolera que las patas tengan fechas distintas', () => {
    // La salida se contabiliza el viernes y la entrada el lunes.
    const { pairs } = matchTransfers([
      leg('a', CHECKING, '2026-03-06', '-1000.00'),
      leg('b', SAVINGS, '2026-03-09', '1000.00'),
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.dayGap).toBe(3)
  })

  it('no empareja fuera de la ventana', () => {
    const { pairs, unmatched } = matchTransfers([
      leg('a', CHECKING, '2026-03-01', '-1000.00'),
      leg('b', SAVINGS, '2026-03-10', '1000.00'),
    ])
    expect(pairs).toHaveLength(0)
    expect(unmatched).toHaveLength(2)
  })

  it('nunca empareja dos patas de la misma cuenta', () => {
    // Un cargo y un abono del mismo importe en la misma cuenta son un cargo y
    // una devolución, no un traspaso.
    const { pairs } = matchTransfers([
      leg('a', CHECKING, '2026-03-01', '-1000.00'),
      leg('b', CHECKING, '2026-03-02', '1000.00'),
    ])
    expect(pairs).toHaveLength(0)
  })
})

describe('diferencias de importe', () => {
  it('atribuye una diferencia chica a comisión', () => {
    const { pairs } = matchTransfers([
      leg('a', CHECKING, '2026-03-01', '-1000.00'),
      leg('b', SAVINGS, '2026-03-01', '997.50'),
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.confidence).toBe('fee')
    expect(pairs[0]?.residual?.amount).toBe(250n)
  })

  it('no empareja si la diferencia es grande', () => {
    // 1000 sale y 800 entra no es una comisión: son dos movimientos.
    const { pairs, unmatched } = matchTransfers([
      leg('a', CHECKING, '2026-03-01', '-1000.00'),
      leg('b', SAVINGS, '2026-03-01', '800.00'),
    ])
    expect(pairs).toHaveLength(0)
    expect(unmatched).toHaveLength(2)
  })
})

describe('conversión de moneda', () => {
  it('marca el par entre monedas distintas con confianza baja', () => {
    const { pairs } = matchTransfers([
      leg('a', CHECKING, '2026-03-01', '-1000.00', EUR),
      leg('b', USD_ACCT, '2026-03-02', '1087.30', USD),
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.confidence).toBe('fx')
    expect(pairs[0]?.residual).toBeUndefined()
  })

  it('se puede desactivar el cruce de monedas', () => {
    const { pairs } = matchTransfers(
      [
        leg('a', CHECKING, '2026-03-01', '-1000.00', EUR),
        leg('b', USD_ACCT, '2026-03-02', '1087.30', USD),
      ],
      { allowCrossCurrency: false },
    )
    expect(pairs).toHaveLength(0)
  })

  it('prefiere el par exacto sobre el de moneda cruzada', () => {
    const { pairs } = matchTransfers([
      leg('a', CHECKING, '2026-03-01', '-1000.00', EUR),
      leg('b', USD_ACCT, '2026-03-01', '1000.00', USD),
      leg('c', SAVINGS, '2026-03-01', '1000.00', EUR),
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.confidence).toBe('exact')
    expect(pairs[0]?.incoming.id).toBe('c')
  })
})

describe('determinismo y no reutilización', () => {
  it('cada pata se usa como máximo una vez', () => {
    // Una salida y dos entradas candidatas: sólo una puede emparejar.
    const { pairs, unmatched } = matchTransfers([
      leg('a', CHECKING, '2026-03-01', '-1000.00'),
      leg('b', SAVINGS, '2026-03-01', '1000.00'),
      leg('c', USD_ACCT, '2026-03-01', '1000.00', EUR),
    ])
    expect(pairs).toHaveLength(1)
    expect(unmatched).toHaveLength(1)
  })

  it('produce el mismo resultado ante entradas equivalentes reordenadas', () => {
    const legs = [
      leg('a', CHECKING, '2026-03-01', '-1000.00'),
      leg('b', SAVINGS, '2026-03-02', '1000.00'),
      leg('c', CHECKING, '2026-03-05', '-500.00'),
      leg('d', SAVINGS, '2026-03-05', '500.00'),
    ]
    const forward = matchTransfers(legs).pairs.map((p) => `${p.outgoing.id}->${p.incoming.id}`)
    const reversed = matchTransfers([...legs].reverse()).pairs.map(
      (p) => `${p.outgoing.id}->${p.incoming.id}`,
    )
    expect([...forward].sort()).toEqual([...reversed].sort())
  })

  it('prefiere el par más cercano en el tiempo ante empate de importe', () => {
    const { pairs } = matchTransfers([
      leg('a', CHECKING, '2026-03-01', '-1000.00'),
      leg('lejos', SAVINGS, '2026-03-05', '1000.00'),
      leg('cerca', USD_ACCT, '2026-03-01', '1000.00', EUR),
    ])
    expect(pairs[0]?.incoming.id).toBe('cerca')
  })

  it('resuelve una cadena de tres patas sin duplicar', () => {
    // Cuenta -> tarjeta -> pago: dos traspasos encadenados.
    const { pairs, unmatched } = matchTransfers([
      leg('out1', CHECKING, '2026-03-01', '-1000.00'),
      leg('in1', SAVINGS, '2026-03-01', '1000.00'),
      leg('out2', SAVINGS, '2026-03-03', '-400.00'),
      leg('in2', USD_ACCT, '2026-03-03', '400.00', EUR),
    ])
    expect(pairs).toHaveLength(2)
    expect(unmatched).toHaveLength(0)
    const ids = pairs.flatMap((p) => [p.outgoing.id, p.incoming.id])
    expect(new Set(ids).size).toBe(4)
  })
})
