/**
 * La costura entre el cliente y el mapeador.
 *
 * Es código aburrido y por eso hay que probarlo: un campo que se pierde acá no
 * rompe nada — el asiento entra igual, el informe cuadra igual— y lo único que
 * pasa es que dentro de seis meses la evidencia que explica un movimiento no
 * está. Lo que sí puede romper de verdad es el importe, y por eso el primer
 * caso comprueba que llega como el texto exacto que mandó el servidor, con el
 * signo de Plaid puesto.
 */

import { describe, expect, it } from 'vitest'
import { aCuentaDelMapeador, aMovimientoDelMapeador } from './adaptar'
import type { CuentaPlaid, MovimientoPlaid } from './tipos'

function movimiento(parcial: Partial<MovimientoPlaid> = {}): MovimientoPlaid {
  return {
    transactionId: 'tx-1',
    accountId: 'cuenta-1',
    importeSalidaPositiva: '5.4',
    isoCurrencyCode: 'EUR',
    unofficialCurrencyCode: null,
    date: '2026-08-13',
    authorizedDate: '2026-08-11',
    datetime: '2026-08-13T10:04:11Z',
    authorizedDatetime: null,
    name: 'UBER TRIP',
    originalDescription: 'UBER   *TRIP 8HJK2',
    merchantName: 'Uber',
    pending: false,
    pendingTransactionId: null,
    paymentChannel: 'online',
    transactionCode: null,
    checkNumber: null,
    categoriaPersonal: {
      primary: 'TRANSPORTATION',
      detailed: 'TRANSPORTATION_TAXIS_AND_RIDE_SHARES',
      confidenceLevel: 'UNKNOWN',
    },
    merchantCategoryCode: '4121',
    website: 'uber.com',
    logoUrl: null,
    contrapartes: [
      {
        name: 'Uber',
        type: 'merchant',
        website: 'uber.com',
        logoUrl: null,
        confidenceLevel: 'VERY_HIGH',
        entityId: 'eyg8o776k0QmNgVpAmaQj4WgzW9Qzo6O51gdd',
      },
    ],
    crudo: {
      merchant_entity_id: 'eyg8o776k0QmNgVpAmaQj4WgzW9Qzo6O51gdd',
      'location.city': 'Madrid',
      'location.country': 'ES',
    },
    ...parcial,
  }
}

describe('adaptar un movimiento de Plaid al mapeador', () => {
  it('el importe llega como el texto exacto y con el signo de Plaid', () => {
    const adaptado = aMovimientoDelMapeador(movimiento({ importeSalidaPositiva: '101.01' }))
    // Ni number, ni redondeado, ni invertido: el convenio de signos se cruza en
    // un solo sitio, que es el mapeador. Invertirlo también acá daría dos
    // sitios donde puede estar mal y uno donde se cancelan.
    expect(adaptado.amount).toBe('101.01')
    expect(typeof adaptado.amount).toBe('string')
  })

  it('la descripción es `name` y no el descriptor original', () => {
    const adaptado = aMovimientoDelMapeador(movimiento())
    // `original_description` sólo viene si se pide `include_original_description`,
    // y la descripción alimenta la huella de identidad: encender esa opción
    // cambiaría la identidad de todo lo que entrara después.
    expect(adaptado.name).toBe('UBER TRIP')
  })

  it('rescata del objeto crudo lo que el cliente no llegó a tipar', () => {
    const adaptado = aMovimientoDelMapeador(movimiento())
    expect(adaptado.merchant_entity_id).toBe('eyg8o776k0QmNgVpAmaQj4WgzW9Qzo6O51gdd')
    expect(adaptado.location).toEqual({
      city: 'Madrid',
      country: 'ES',
      region: null,
      postal_code: null,
    })
  })

  it('sin localidad no inventa un objeto vacío', () => {
    const adaptado = aMovimientoDelMapeador(movimiento({ crudo: {} }))
    expect(adaptado.location).toBeNull()
    expect(adaptado.merchant_entity_id).toBeNull()
  })

  it('los campos que deciden el asiento viajan enteros', () => {
    const adaptado = aMovimientoDelMapeador(
      movimiento({ pending: true, pendingTransactionId: 'tx-0' }),
    )
    expect(adaptado.transaction_id).toBe('tx-1')
    expect(adaptado.account_id).toBe('cuenta-1')
    expect(adaptado.date).toBe('2026-08-13')
    expect(adaptado.authorized_date).toBe('2026-08-11')
    expect(adaptado.iso_currency_code).toBe('EUR')
    // Los dos: son el hilo entre el pendiente y el asentado, y el motivo de que
    // el mapeador los reciba en vez de dejarlos en `raw`.
    expect(adaptado.pending).toBe(true)
    expect(adaptado.pending_transaction_id).toBe('tx-0')
  })

  it('la contraparte conserva su identificador de entidad, que es la clave estable', () => {
    const adaptado = aMovimientoDelMapeador(movimiento())
    expect(adaptado.counterparties?.[0]).toEqual({
      name: 'Uber',
      type: 'merchant',
      entity_id: 'eyg8o776k0QmNgVpAmaQj4WgzW9Qzo6O51gdd',
      confidence_level: 'VERY_HIGH',
      website: 'uber.com',
      logo_url: null,
    })
  })
})

describe('adaptar una cuenta de Plaid al mapeador', () => {
  const cuenta: CuentaPlaid = {
    accountId: 'cuenta-1',
    name: 'Plaid Current Account',
    officialName: 'BBVA Cuenta Online',
    mask: '0000',
    type: 'depository',
    subtype: 'checking',
    holderCategory: 'personal',
    saldoActual: '23631.9805',
    saldoDisponible: '100',
    limite: null,
    isoCurrencyCode: 'EUR',
    unofficialCurrencyCode: null,
    crudo: { 'balances.last_updated_datetime': '2026-08-13T09:00:00Z' },
  }

  it('los saldos llegan como texto, sin pasar por coma flotante', () => {
    const adaptada = aCuentaDelMapeador(cuenta)
    // Cuatro decimales: es el saldo real de la cuenta 401k del banco de prueba,
    // y `23631.9805 * 100` en coma flotante da 2363198.0500000003.
    expect(adaptada.balances.current).toBe('23631.9805')
    expect(adaptada.balances.iso_currency_code).toBe('EUR')
  })

  it('la institución la pone el llamador porque Plaid no la manda con la cuenta', () => {
    expect(aCuentaDelMapeador(cuenta, { institucion: 'BBVA' }).institution_name).toBe('BBVA')
    expect(aCuentaDelMapeador(cuenta).institution_name).toBeNull()
  })

  it('rescata la fecha del saldo del objeto crudo cuando la entidad la manda', () => {
    expect(aCuentaDelMapeador(cuenta).balances.last_updated_datetime).toBe('2026-08-13T09:00:00Z')
    expect(aCuentaDelMapeador({ ...cuenta, crudo: {} }).balances.last_updated_datetime).toBeNull()
  })
})
