import { describe, expect, it } from 'vitest'
import { currencyCode } from './currency.js'
import {
  classifyIncoming,
  type IncomingTransaction,
  summarizeDedup,
  type TransactionRef,
} from './dedup.js'
import { assignOrdinals, transactionFingerprint } from './identity.js'
import { fromDecimalString } from './money.js'
import { parsePlainDate } from './plain-date.js'

const EUR = currencyCode('EUR')
const ACCOUNT = 'acct-checking'
const OTHER = 'acct-savings'

const incoming = (
  lineNumber: number,
  date: string,
  amount: string,
  description: string,
  extra: Partial<IncomingTransaction> = {},
): IncomingTransaction => ({
  lineNumber,
  accountId: ACCOUNT,
  bookedOn: parsePlainDate(date),
  amount: fromDecimalString(amount, EUR),
  description,
  ordinal: 0,
  ...extra,
})

const existingFrom = (tx: IncomingTransaction, id: string): TransactionRef => ({
  id,
  accountId: tx.accountId,
  bookedOn: tx.bookedOn,
  amount: tx.amount,
  description: tx.description,
  fingerprint: transactionFingerprint({
    accountId: tx.accountId,
    bookedOn: tx.bookedOn,
    amount: tx.amount,
    descriptionRaw: tx.description,
    ordinal: tx.ordinal,
  }),
  ...(tx.externalId === undefined ? {} : { externalId: tx.externalId }),
})

describe('pasada 1: determinista', () => {
  it('reimportar el mismo fichero no crea nada', () => {
    const rows = [
      incoming(1, '2026-03-01', '-42.50', 'MERCADONA'),
      incoming(2, '2026-03-02', '-13.20', 'REPSOL'),
    ]
    const existing = rows.map((row, i) => existingFrom(row, `tx-${i}`))

    const summary = summarizeDedup(classifyIncoming(rows, existing))
    expect(summary).toEqual({ total: 2, fresh: 0, duplicates: 2, needsReview: 0 })
  })

  it('importa el solapamiento de dos ficheros una sola vez', () => {
    // Fichero A: enero-marzo. Fichero B: febrero-abril.
    const shared = incoming(1, '2026-02-15', '-99.00', 'SEGURO HOGAR')
    const existing = [existingFrom(shared, 'tx-shared')]

    const fileB = [
      { ...shared, lineNumber: 1 },
      incoming(2, '2026-04-01', '-99.00', 'SEGURO HOGAR'),
    ]

    const verdicts = classifyIncoming(fileB, existing).map((c) => c.verdict.kind)
    expect(verdicts).toEqual(['duplicate', 'new'])
  })

  it('no confunde dos compras iguales del mismo día', () => {
    // Dos cafés de 3,50 el mismo día son dos transacciones reales.
    const rows = assignOrdinals([
      {
        accountId: ACCOUNT,
        bookedOn: parsePlainDate('2026-03-01'),
        amount: fromDecimalString('-3.50', EUR),
        descriptionRaw: 'CAFE',
      },
      {
        accountId: ACCOUNT,
        bookedOn: parsePlainDate('2026-03-01'),
        amount: fromDecimalString('-3.50', EUR),
        descriptionRaw: 'CAFE',
      },
    ]).map((row, i) => incoming(i + 1, '2026-03-01', '-3.50', 'CAFE', { ordinal: row.ordinal }))

    const summary = summarizeDedup(classifyIncoming(rows, []))
    expect(summary.fresh).toBe(2)
    expect(summary.duplicates).toBe(0)
  })

  it('usa el FITID sólo dentro del alcance de la cuenta', () => {
    // Mismo FITID, mismo importe y misma fecha, pero en otra cuenta: no es el
    // mismo movimiento. El fixture calcula la huella con la cuenta correcta,
    // porque un TransactionRef cuya huella no corresponde a su accountId no
    // puede existir en la base.
    const inOtherAccount = existingFrom(
      incoming(1, '2026-03-01', '-42.50', 'MERCADONA', {
        accountId: OTHER,
        externalId: 'FIT-1',
      }),
      'tx-1',
    )
    const row = incoming(1, '2026-03-01', '-42.50', 'MERCADONA', { externalId: 'FIT-1' })

    const [result] = classifyIncoming([row], [inOtherAccount])
    expect(result?.verdict.kind).toBe('new')
  })

  it('ignora un FITID reutilizado con otro importe', () => {
    // Un banco que reemite el mismo FITID con importe distinto está haciendo
    // un rebooking, no repitiendo el movimiento.
    const existing = existingFrom(
      incoming(1, '2026-03-01', '-42.50', 'MERCADONA', { externalId: 'FIT-1' }),
      'tx-1',
    )
    const row = incoming(1, '2026-03-01', '-51.00', 'MERCADONA', { externalId: 'FIT-1' })

    const [result] = classifyIncoming([row], [existing])
    expect(result?.verdict.kind).not.toBe('duplicate')
  })

  it('detecta duplicado por FITID aunque cambie la descripción', () => {
    const existing = existingFrom(
      incoming(1, '2026-03-01', '-42.50', 'MERCADONA 1234', { externalId: 'FIT-9' }),
      'tx-9',
    )
    const row = incoming(1, '2026-03-01', '-42.50', 'MERCADONA SA MADRID', { externalId: 'FIT-9' })

    const [result] = classifyIncoming([row], [existing])
    expect(result?.verdict).toMatchObject({ kind: 'duplicate', reason: 'external_id' })
  })
})

describe('pasada 2: difusa', () => {
  it('manda a revisión, nunca descarta', () => {
    // Mismo importe, dos días de diferencia, descriptor parecido: es el caso
    // del banco que recontabiliza. Lo decide una persona.
    const existing = existingFrom(
      incoming(1, '2026-03-01', '-42.50', 'AMZN MKTP ES REF 998877'),
      'tx-1',
    )
    const row = incoming(1, '2026-03-03', '-42.50', 'AMZN MKTP ES')

    const [result] = classifyIncoming([row], [existing])
    expect(result?.verdict.kind).toBe('review')
    if (result?.verdict.kind === 'review') {
      expect(result.verdict.candidateId).toBe('tx-1')
      expect(result.verdict.dayGap).toBe(2)
      expect(result.verdict.similarity).toBeGreaterThanOrEqual(0.6)
    }
  })

  it('no empareja si el importe difiere aunque sea un céntimo', () => {
    const existing = existingFrom(incoming(1, '2026-03-01', '-42.50', 'AMZN MKTP ES'), 'tx-1')
    const row = incoming(1, '2026-03-02', '-42.51', 'AMZN MKTP ES')

    const [result] = classifyIncoming([row], [existing])
    expect(result?.verdict.kind).toBe('new')
  })

  it('respeta la ventana de días', () => {
    const existing = existingFrom(incoming(1, '2026-03-01', '-42.50', 'AMZN MKTP ES'), 'tx-1')
    const dentro = incoming(1, '2026-03-06', '-42.50', 'AMZN MKTP ES')
    const fuera = incoming(1, '2026-03-07', '-42.50', 'AMZN MKTP ES')

    expect(classifyIncoming([dentro], [existing])[0]?.verdict.kind).toBe('review')
    expect(classifyIncoming([fuera], [existing])[0]?.verdict.kind).toBe('new')
  })

  it('no empareja comercios distintos con el mismo importe', () => {
    const existing = existingFrom(incoming(1, '2026-03-01', '-50.00', 'MERCADONA'), 'tx-1')
    const row = incoming(1, '2026-03-02', '-50.00', 'REPSOL ESTACION')

    const [result] = classifyIncoming([row], [existing])
    expect(result?.verdict.kind).toBe('new')
  })

  it('elige el candidato más parecido cuando hay varios', () => {
    const existing = [
      existingFrom(incoming(1, '2026-03-01', '-42.50', 'AMZN MKTP ES'), 'tx-cerca'),
      existingFrom(incoming(2, '2026-02-28', '-42.50', 'AMZN MKTP ES'), 'tx-lejos'),
    ]
    const row = incoming(1, '2026-03-02', '-42.50', 'AMZN MKTP ES')

    const [result] = classifyIncoming([row], existing)
    if (result?.verdict.kind === 'review') expect(result.verdict.candidateId).toBe('tx-cerca')
    else expect.unreachable('debería ir a revisión')
  })
})

describe('propiedades del lote', () => {
  it('es idempotente: dos corridas dan el mismo veredicto', () => {
    const rows = [
      incoming(1, '2026-03-01', '-42.50', 'MERCADONA'),
      incoming(2, '2026-03-03', '-42.50', 'MERCADONA'),
    ]
    const first = classifyIncoming(rows, []).map((c) => c.verdict.kind)
    const second = classifyIncoming(rows, []).map((c) => c.verdict.kind)
    expect(first).toEqual(second)
  })

  it('no manda a revisión dos filas distintas del mismo fichero', () => {
    // Dos movimientos del mismo importe con referencias distintas del banco.
    // Dentro de un mismo extracto son dos transacciones reales: la pasada
    // difusa no mira el propio lote, justamente para no inundar la cola.
    const rows = [
      incoming(1, '2026-03-01', '-42.50', 'AMZN MKTP ES REF 1'),
      incoming(2, '2026-03-02', '-42.50', 'AMZN MKTP ES REF 2'),
    ]
    const verdicts = classifyIncoming(rows, []).map((c) => c.verdict.kind)
    expect(verdicts).toEqual(['new', 'new'])
  })

  it('pero sí deduplica un FITID repetido dentro del mismo fichero', () => {
    // Acá el banco sí repitió el movimiento: mismo FITID, importe y fecha.
    const rows = [
      incoming(1, '2026-03-01', '-42.50', 'MERCADONA', { externalId: 'FIT-7' }),
      incoming(2, '2026-03-01', '-42.50', 'MERCADONA CENTRO', { externalId: 'FIT-7' }),
    ]
    const verdicts = classifyIncoming(rows, []).map((c) => c.verdict.kind)
    expect(verdicts).toEqual(['new', 'duplicate'])
  })

  it('el conteo del resumen cierra siempre', () => {
    const rows = [
      incoming(1, '2026-03-01', '-42.50', 'MERCADONA'),
      incoming(2, '2026-03-02', '-13.20', 'REPSOL'),
      incoming(3, '2026-03-03', '-99.00', 'SEGURO'),
    ]
    const existing = [existingFrom(rows[0] as IncomingTransaction, 'tx-1')]
    const summary = summarizeDedup(classifyIncoming(rows, existing))
    expect(summary.fresh + summary.duplicates + summary.needsReview).toBe(summary.total)
  })
})
