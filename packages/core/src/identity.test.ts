import { describe, expect, it } from 'vitest'
import { currencyCode } from './currency.js'
import {
  assignOrdinals,
  canonicalIdentityString,
  IDENTITY_VERSION,
  transactionFingerprint,
} from './identity.js'
import { fromDecimalString } from './money.js'
import { descriptionTokens, tokenSimilarity } from './normalize.js'
import { parsePlainDate } from './plain-date.js'

/** Mismo separador que usa identity.ts, construido sin literal de control. */
const SEP = String.fromCharCode(0x1f)

const EUR = currencyCode('EUR')
const account = 'acct-1'
const on = parsePlainDate('2026-03-14')

const row = (description: string, amount: string, ordinal = 0) => ({
  accountId: account,
  bookedOn: on,
  amount: fromDecimalString(amount, EUR),
  descriptionRaw: description,
  ordinal,
})

describe('huella canónica', () => {
  it('es estable para la misma entrada', () => {
    expect(transactionFingerprint(row('MERCADONA', '-42.50'))).toBe(
      transactionFingerprint(row('MERCADONA', '-42.50')),
    )
  })

  it('ignora mayúsculas, acentos y espaciado del descriptor', () => {
    const a = transactionFingerprint(row('Café  Público', '-3.50'))
    const b = transactionFingerprint(row('  cafe publico  ', '-3.50'))
    expect(a).toBe(b)
  })

  it('NO unifica variantes de razón social, y eso es deliberado', () => {
    // "S.L." se normaliza a "S L" porque el punto es separador. El hash de
    // identidad tiene que ser conservador: su contrato es que reimportar el
    // mismo fichero dé la misma huella, no adivinar que dos descriptores
    // distintos son el mismo comercio. Normalizar de más aumenta las
    // colisiones entre transacciones genuinamente distintas.
    //
    // Unificar "S.L." con "SL" es trabajo de la capa difusa (ver el test de
    // abajo), que puede evolucionar sin invalidar las huellas ya guardadas.
    expect(transactionFingerprint(row('Café Público, S.L.', '-3.50'))).not.toBe(
      transactionFingerprint(row('CAFE PUBLICO SL', '-3.50')),
    )
  })

  it('la capa difusa sí reconoce que son el mismo comercio', () => {
    const a = descriptionTokens('Café Público, S.L.')
    const b = descriptionTokens('CAFE PUBLICO SL')
    expect(tokenSimilarity(a, b)).toBe(1)
  })

  it('el hash es sensible a la versión del algoritmo', () => {
    // IDENTITY_VERSION viaja dentro del hash: dos versiones del normalizador
    // nunca pueden producir la misma huella para la misma transacción.
    expect(IDENTITY_VERSION).toBe(1)
    const fields = canonicalIdentityString(row('MERCADONA', '-42.50')).split(SEP)
    expect(fields[0]).toBe(`v${IDENTITY_VERSION}`)
    // Siete campos separados por U+001F. Si esta forma cambia, cambian todas
    // las huellas ya guardadas y hay que subir IDENTITY_VERSION.
    expect(fields).toHaveLength(7)
  })

  it('distingue importes, fechas, cuentas y signo', () => {
    const base = transactionFingerprint(row('MERCADONA', '-42.50'))
    expect(transactionFingerprint(row('MERCADONA', '-42.51'))).not.toBe(base)
    expect(transactionFingerprint(row('MERCADONA', '42.50'))).not.toBe(base)
    expect(transactionFingerprint({ ...row('MERCADONA', '-42.50'), accountId: 'acct-2' })).not.toBe(
      base,
    )
    expect(
      transactionFingerprint({
        ...row('MERCADONA', '-42.50'),
        bookedOn: parsePlainDate('2026-03-15'),
      }),
    ).not.toBe(base)
  })

  it('distingue transacciones idénticas por ordinal', () => {
    expect(transactionFingerprint(row('CAFE', '-3.50', 0))).not.toBe(
      transactionFingerprint(row('CAFE', '-3.50', 1)),
    )
  })
})

describe('assignOrdinals', () => {
  it('numera las filas indistinguibles en orden de aparición', () => {
    const rows = [
      {
        accountId: account,
        bookedOn: on,
        amount: fromDecimalString('-3.50', EUR),
        descriptionRaw: 'CAFE',
      },
      {
        accountId: account,
        bookedOn: on,
        amount: fromDecimalString('-3.50', EUR),
        descriptionRaw: 'CAFE',
      },
      {
        accountId: account,
        bookedOn: on,
        amount: fromDecimalString('-9.00', EUR),
        descriptionRaw: 'CAFE',
      },
    ]
    expect(assignOrdinals(rows).map((r) => r.ordinal)).toEqual([0, 1, 0])
  })

  it('reimportar el mismo fichero produce exactamente las mismas huellas', () => {
    const rows = [
      {
        accountId: account,
        bookedOn: on,
        amount: fromDecimalString('-3.50', EUR),
        descriptionRaw: 'CAFE',
      },
      {
        accountId: account,
        bookedOn: on,
        amount: fromDecimalString('-3.50', EUR),
        descriptionRaw: 'CAFE',
      },
    ]
    const first = assignOrdinals(rows).map(transactionFingerprint)
    const second = assignOrdinals(rows).map(transactionFingerprint)
    expect(first).toEqual(second)
    expect(new Set(first).size).toBe(2)
  })
})
