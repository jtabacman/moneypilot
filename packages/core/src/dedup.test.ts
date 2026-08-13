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
  ...(tx.source === undefined ? {} : { source: tx.source }),
  ...(tx.externalId === undefined ? {} : { externalId: tx.externalId }),
})

/** Una fila que llega por el feed: origen 'api' y el id del proveedor. */
const delFeed = (
  lineNumber: number,
  date: string,
  amount: string,
  description: string,
  externalId: string,
  extra: Partial<IncomingTransaction> = {},
): IncomingTransaction =>
  incoming(lineNumber, date, amount, description, {
    source: 'api',
    externalId,
    ...extra,
  })

describe('pasada 1: determinista', () => {
  it('reimportar el mismo fichero no crea nada', () => {
    const rows = [
      incoming(1, '2026-03-01', '-42.50', 'MERCADONA'),
      incoming(2, '2026-03-02', '-13.20', 'REPSOL'),
    ]
    const existing = rows.map((row, i) => existingFrom(row, `tx-${i}`))

    const summary = summarizeDedup(classifyIncoming(rows, existing))
    expect(summary).toEqual({
      total: 2,
      fresh: 0,
      duplicates: 2,
      updated: 0,
      needsReview: 0,
    })
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
    const row = incoming(1, '2026-03-01', '-42.50', 'MERCADONA', {
      externalId: 'FIT-1',
    })

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
    const row = incoming(1, '2026-03-01', '-51.00', 'MERCADONA', {
      externalId: 'FIT-1',
    })

    const [result] = classifyIncoming([row], [existing])
    expect(result?.verdict.kind).not.toBe('duplicate')
  })

  it('detecta duplicado por FITID aunque cambie la descripción', () => {
    const existing = existingFrom(
      incoming(1, '2026-03-01', '-42.50', 'MERCADONA 1234', {
        externalId: 'FIT-9',
      }),
      'tx-9',
    )
    const row = incoming(1, '2026-03-01', '-42.50', 'MERCADONA SA MADRID', {
      externalId: 'FIT-9',
    })

    const [result] = classifyIncoming([row], [existing])
    expect(result?.verdict).toMatchObject({
      kind: 'duplicate',
      reason: 'external_id',
    })
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
      incoming(2, '2026-03-01', '-42.50', 'MERCADONA CENTRO', {
        externalId: 'FIT-7',
      }),
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
    expect(summary.fresh + summary.duplicates + summary.updated + summary.needsReview).toBe(
      summary.total,
    )
  })
})

describe('origen feed: manda el identificador del proveedor', () => {
  it('el mismo identificador con otro importe es una actualización, no un duplicado', () => {
    // El banco corrigió el importe de un movimiento que ya nos había dado.
    // No es un duplicado (lo guardado ya no dice lo que dice el banco) ni es
    // nuevo (asentarlo otra vez lo contaría dos veces).
    const guardado = existingFrom(
      delFeed(1, '2026-03-01', '-135.89', 'ALLIANZ LV / FLESSA KG', '1860779443'),
      'tx-1',
    )
    const corregido = delFeed(1, '2026-03-01', '-140.00', 'ALLIANZ LV / FLESSA KG', '1860779443')

    const [result] = classifyIncoming([corregido], [guardado])
    expect(result?.verdict).toMatchObject({
      kind: 'updated',
      reason: 'external_id',
      existingId: 'tx-1',
    })
    if (result?.verdict.kind !== 'updated') expect.unreachable('tenía que ser una actualización')
    else {
      expect(result.verdict.changes.amount).toEqual({
        before: fromDecimalString('-135.89', EUR),
        after: fromDecimalString('-140.00', EUR),
      })
      // Lo que no cambió no se declara: la descripción es la misma.
      expect(result.verdict.changes.description).toBeUndefined()
      expect(result.verdict.changes.bookedOn).toBeUndefined()
    }
  })

  it('el vaivén de pendiente a asentado se actualiza en vez de inundar la cola', () => {
    // Es el caso que hacía inútil la huella con un feed: el agregador cambia
    // el descriptor y corre la fecha contable cuando el banco asienta.
    const pendiente = existingFrom(
      delFeed(1, '2026-03-01', '-3.50', 'PENDIENTE COMPRA TARJETA', '1860779444'),
      'tx-pendiente',
    )
    const asentado = delFeed(1, '2026-03-03', '-3.50', 'CAFE BAR LOLA MADRID', '1860779444')

    const classified = classifyIncoming([asentado], [pendiente])
    const summary = summarizeDedup(classified)
    expect(summary.needsReview).toBe(0)
    expect(summary.updated).toBe(1)

    const verdict = classified[0]?.verdict
    if (verdict?.kind !== 'updated') expect.unreachable('tenía que ser una actualización')
    else {
      expect(verdict.existingId).toBe('tx-pendiente')
      expect(verdict.changes.bookedOn).toEqual({
        before: '2026-03-01',
        after: '2026-03-03',
      })
      expect(verdict.changes.description).toEqual({
        before: 'PENDIENTE COMPRA TARJETA',
        after: 'CAFE BAR LOLA MADRID',
      })
      expect(verdict.changes.amount).toBeUndefined()
    }
  })

  it('el identificador aguanta que el ordinal se corra entre sincronizaciones', () => {
    // Mismo hecho, sin un solo cambio, pero al lote le tocó otro ordinal: la
    // huella ya no coincide y el identificador del proveedor sí. Sin esto,
    // cada sincronización volvería a asentar la misma fila.
    const guardado = existingFrom(delFeed(1, '2026-03-01', '-3.50', 'CAFE', '111'), 'tx-1')
    const otraVez = delFeed(1, '2026-03-01', '-3.50', 'CAFE', '111', { ordinal: 1 })

    const [result] = classifyIncoming([otraVez], [guardado])
    expect(result?.verdict).toMatchObject({
      kind: 'duplicate',
      reason: 'external_id',
      existingId: 'tx-1',
    })
  })

  it('dos movimientos idénticos del mismo día con identificadores distintos no se funden', () => {
    // Son dos cafés, no un duplicado. El proveedor ya lo dijo dándoles dos
    // identificadores, así que ni la huella ni la difusa tienen voto.
    const rows = [
      delFeed(1, '2026-03-01', '-3.50', 'CAFE BAR LOLA', '111'),
      delFeed(2, '2026-03-01', '-3.50', 'CAFE BAR LOLA', '222'),
    ]

    const classified = classifyIncoming(rows, [])
    expect(classified.map((c) => c.verdict.kind)).toEqual(['new', 'new'])
    // Y con huellas distintas: dos filas con la misma huella no entran en la
    // base, que tiene un índice único por hogar.
    expect(classified[0]?.fingerprint).not.toBe(classified[1]?.fingerprint)
  })

  it('tampoco se funden cuando el segundo café llega en otra sincronización', () => {
    const primero = existingFrom(delFeed(1, '2026-03-01', '-3.50', 'CAFE BAR LOLA', '111'), 'tx-1')
    const segundo = delFeed(1, '2026-03-01', '-3.50', 'CAFE BAR LOLA', '222')

    const [result] = classifyIncoming([segundo], [primero])
    expect(result?.verdict.kind).toBe('new')
    expect(result?.fingerprint).not.toBe(primero.fingerprint)
    // El desempate es el ordinal, que continúa desde lo ya guardado.
    expect(result?.ordinal).toBe(1)
  })

  it('un movimiento que ya entró por fichero y vuelve por el feed se reconoce por la huella', () => {
    // Acá el identificador del proveedor no sirve —no coincide con el FITID
    // del OFX— y la huella es la herramienta correcta.
    const deFichero = existingFrom(
      incoming(1, '2026-01-15', '-42.50', 'MERCADONA', {
        source: 'file',
        externalId: 'FIT-1',
      }),
      'tx-fichero',
    )
    const delBanco = delFeed(1, '2026-01-15', '-42.50', 'MERCADONA', '1860779443')

    const [result] = classifyIncoming([delBanco], [deFichero])
    expect(result?.verdict).toMatchObject({
      kind: 'duplicate',
      reason: 'fingerprint',
      existingId: 'tx-fichero',
    })
  })

  it('lo reconoce también cuando no se sabe de dónde vino lo guardado', () => {
    // Un llamador que todavía no lee entry.source no puede quedarse sin la
    // red: sin origen conocido, la huella manda como siempre.
    const guardado = existingFrom(incoming(1, '2026-01-15', '-42.50', 'MERCADONA'), 'tx-viejo')
    const delBanco = delFeed(1, '2026-01-15', '-42.50', 'MERCADONA', '1860779443')

    const [result] = classifyIncoming([delBanco], [guardado])
    expect(result?.verdict).toMatchObject({ kind: 'duplicate', reason: 'fingerprint' })
  })

  it('si el fichero traía otro descriptor, el feed lo manda a revisión y no lo duplica', () => {
    // La huella no puede reconocerlo —el descriptor del agregador nunca es el
    // del OFX— y duplicar enero entero es el peor resultado posible. Acá la
    // difusa sigue haciendo falta.
    const deFichero = existingFrom(
      incoming(1, '2026-01-15', '-42.50', 'MERCADONA MADRID REF 998877', { source: 'file' }),
      'tx-fichero',
    )
    const delBanco = delFeed(1, '2026-01-16', '-42.50', 'MERCADONA MADRID', '1860779443')

    const [result] = classifyIncoming([delBanco], [deFichero])
    expect(result?.verdict).toMatchObject({ kind: 'review', candidateId: 'tx-fichero' })
  })

  it('no reescribe en su sitio un asiento que vino por fichero', () => {
    // Un FITID que coincide con un identificador del proveedor es casualidad,
    // no el mismo hecho: reescribir el asiento del fichero borraría un dato
    // que nadie pidió cambiar.
    const deFichero = existingFrom(
      incoming(1, '2026-03-01', '-42.50', 'MERCADONA', {
        source: 'file',
        externalId: '1860779443',
      }),
      'tx-fichero',
    )
    const delBanco = delFeed(1, '2026-03-01', '-99.00', 'ALDI SUED', '1860779443')

    const [result] = classifyIncoming([delBanco], [deFichero])
    expect(result?.verdict.kind).not.toBe('updated')
    expect(result?.verdict.kind).toBe('new')
  })

  it('una fila del feed sin identificador se comporta como un fichero', () => {
    // Defensa: si el proveedor no manda id, no hay nada estable y el camino
    // conservador es el de siempre.
    const guardado = existingFrom(incoming(1, '2026-03-01', '-42.50', 'MERCADONA'), 'tx-1')
    const sinId = incoming(1, '2026-03-03', '-42.50', 'MERCADONA', { source: 'api' })

    const [result] = classifyIncoming([sinId], [guardado])
    expect(result?.verdict.kind).toBe('review')
  })

  it('el resumen cuenta las actualizaciones aparte y el total sigue cerrando', () => {
    const guardado = existingFrom(delFeed(1, '2026-03-01', '-10.00', 'LUZ', '111'), 'tx-1')
    const rows = [
      delFeed(1, '2026-03-01', '-12.00', 'LUZ', '111'),
      delFeed(2, '2026-03-02', '-20.00', 'AGUA', '222'),
    ]

    const summary = summarizeDedup(classifyIncoming(rows, [guardado]))
    expect(summary).toEqual({
      total: 2,
      fresh: 1,
      duplicates: 0,
      updated: 1,
      needsReview: 0,
    })
  })
})
