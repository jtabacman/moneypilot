/**
 * La costura entre lo que devuelve el cliente HTTP y lo que espera el mapeador.
 *
 * Son dos vistas del mismo dato escritas desde lados distintos y a propósito:
 *
 *  · El cliente (`tipos.ts`) nombra los campos como los usamos nosotros y
 *    renombra el que más duele —`amount` es `importeSalidaPositiva`, para que
 *    quien lo meta tal cual en un asiento vea el error al escribirlo—.
 *  · El mapeador (`@moneypilot/importers`) nombra los campos **como Plaid**, en
 *    snake_case, para que comparar su código con la documentación o con una
 *    respuesta cruda guardada en `raw` no exija traducir de cabeza.
 *
 * Las dos decisiones son correctas donde están, así que en algún punto hay que
 * pasar de una a la otra. Este módulo es ese punto, y es lo único que hay que
 * tocar el día que Plaid añada un campo: sin él, la conversión estaría repartida
 * por la orquestación y un campo nuevo llegaría a la mitad de los sitios.
 *
 * **Ningún importe se toca acá.** Viajan como el texto exacto que mandó el
 * servidor, con el signo de Plaid puesto —positivo es dinero que sale—, porque
 * el único sitio donde se cruza el convenio de signos es el mapeador. Convertir
 * el signo también acá dejaría dos sitios donde puede estar mal y uno donde se
 * cancelarían, que es la forma de que nadie lo encuentre nunca.
 */

import type { PlaidRawAccount, PlaidRawTransaction } from '@moneypilot/importers'
import type { Crudo, CuentaPlaid, MovimientoPlaid } from './tipos'

/** Texto útil o nada: el vacío y el blanco son ausencia, no dato. */
function texto(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null
  const limpio = valor.trim()
  return limpio === '' ? null : limpio
}

/**
 * Un campo que el cliente no declara y que sí está en el objeto aplanado.
 *
 * `aplanar` deja las claves punteadas —`location.city`,
 * `counterparties.0.name`—, así que lo que no llegó a tipo se puede recuperar
 * sin volver a pedirlo. Se usa sólo para lo que el mapeador guarda como
 * evidencia; nada que decida un importe, una fecha o un signo sale de acá.
 */
function delCrudo(crudo: Crudo, clave: string): string | null {
  return texto(crudo[clave])
}

export function aMovimientoDelMapeador(movimiento: MovimientoPlaid): PlaidRawTransaction {
  const contrapartes = movimiento.contrapartes.map((parte) => ({
    name: parte.name,
    type: parte.type,
    entity_id: parte.entityId,
    confidence_level: parte.confidenceLevel,
    website: parte.website,
    logo_url: parte.logoUrl,
  }))

  const localidad = {
    country: delCrudo(movimiento.crudo, 'location.country'),
    city: delCrudo(movimiento.crudo, 'location.city'),
    region: delCrudo(movimiento.crudo, 'location.region'),
    postal_code: delCrudo(movimiento.crudo, 'location.postal_code'),
  }
  const hayLocalidad = Object.values(localidad).some((valor) => valor !== null)

  return {
    transaction_id: movimiento.transactionId,
    account_id: movimiento.accountId,
    pending: movimiento.pending,
    pending_transaction_id: movimiento.pendingTransactionId,
    date: movimiento.date,
    authorized_date: movimiento.authorizedDate,
    datetime: movimiento.datetime,
    authorized_datetime: movimiento.authorizedDatetime,
    // El texto exacto del cuerpo HTTP, con el signo de Plaid. Ver la cabecera.
    amount: movimiento.importeSalidaPositiva,
    iso_currency_code: movimiento.isoCurrencyCode,
    unofficial_currency_code: movimiento.unofficialCurrencyCode,
    // `name` y no `originalDescription`, aunque el segundo sea más original.
    // La descripción alimenta la huella de identidad, y `original_description`
    // sólo viene si se pidió `include_original_description`: el día que alguien
    // encienda o apague esa opción cambiaría la descripción de todo lo que
    // entre después, y con ella la identidad de movimientos que ya estaban. La
    // huella no puede depender de una opción de la petición.
    name: movimiento.name,
    merchant_name: movimiento.merchantName,
    merchant_entity_id: delCrudo(movimiento.crudo, 'merchant_entity_id'),
    website: movimiento.website,
    logo_url: movimiento.logoUrl,
    payment_channel: movimiento.paymentChannel,
    transaction_code: movimiento.transactionCode,
    personal_finance_category:
      movimiento.categoriaPersonal === null
        ? null
        : {
            primary: movimiento.categoriaPersonal.primary,
            detailed: movimiento.categoriaPersonal.detailed,
            confidence_level: movimiento.categoriaPersonal.confidenceLevel,
          },
    counterparties: contrapartes,
    location: hayLocalidad ? localidad : null,
  }
}

export interface OpcionesDeCuenta {
  /** El nombre del banco, que Plaid no manda con la cuenta sino aparte. */
  readonly institucion?: string | null
}

export function aCuentaDelMapeador(
  cuenta: CuentaPlaid,
  opciones: OpcionesDeCuenta = {},
): PlaidRawAccount {
  return {
    account_id: cuenta.accountId,
    name: cuenta.name,
    official_name: cuenta.officialName,
    mask: cuenta.mask,
    type: cuenta.type,
    subtype: cuenta.subtype,
    balances: {
      current: cuenta.saldoActual,
      available: cuenta.saldoDisponible,
      limit: cuenta.limite,
      iso_currency_code: cuenta.isoCurrencyCode,
      unofficial_currency_code: cuenta.unofficialCurrencyCode,
      // Casi ninguna entidad la manda. Cuando falta, la fecha del saldo la pone
      // el llamador con `balanceAsOf`: es el único que sabe cuándo preguntó.
      last_updated_datetime: delCrudo(cuenta.crudo, 'balances.last_updated_datetime'),
    },
    institution_name: opciones.institucion ?? null,
  }
}
