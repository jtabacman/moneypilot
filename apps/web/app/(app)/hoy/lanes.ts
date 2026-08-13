/**
 * Los carriles de caja de esta pantalla, cortados a la fecha de hoy.
 *
 * `liquidityByCurrency` da exactamente esta cifra —cuentas de activo abiertas,
 * agrupadas por moneda, sumando sólo los postings en la moneda de la cuenta—
 * pero **no acepta `asOf`**: suma la historia entera, incluidos los asientos
 * con fecha futura. En una pantalla que se titula "Hoy" eso es una cifra que
 * no es la de hoy, y en la proyección es peor todavía: el saldo de partida ya
 * traería restado un cargo que la proyección vuelve a restar cuando llega su
 * semana. Un gasto contado dos veces.
 *
 * Por eso el carril se arma acá sobre `accountBalances(client, { asOf })`, que
 * sí corta por fecha, aplicando el mismo criterio que el repositorio: activo,
 * abierta, y sólo los postings en la moneda de la cuenta. Verificado contra
 * `liquidityByCurrency` sobre la base local: coincide en todos los hogares
 * salvo en los que tienen asientos con fecha posterior a hoy, que es
 * justamente la diferencia que se busca.
 *
 * De paso trae los ids de las cuentas del carril, que la vista del repositorio
 * no devuelve y sin los cuales el número más grande de la pantalla sería el
 * único que no se puede abrir hasta la transacción.
 */

import type { AccountBalance } from '@moneypilot/db'

export interface CarrilCaja {
  readonly currency: string
  /** Suma de los saldos a la fecha, en esa moneda. */
  readonly total: bigint
  readonly accounts: number
  /**
   * Postings de esas cuentas anotados en otra moneda, que por eso **no** están
   * en `total`. Debería ser cero; si no lo es, el carril está incompleto.
   */
  readonly foreignPostings: number
  /** Para el enlace al registro. Ordenados para que la URL sea estable. */
  readonly accountIds: readonly string[]
}

export function carrilesDeCaja(cuentas: readonly AccountBalance[]): CarrilCaja[] {
  interface Acumulador {
    total: bigint
    accounts: number
    foreignPostings: number
    accountIds: string[]
  }
  const porMoneda = new Map<string, Acumulador>()

  for (const cuenta of cuentas) {
    // Mismo filtro que `liquidityByCurrency`: una cuenta cerrada no aporta
    // caja, y una de pasivo es deuda, no liquidez.
    if (cuenta.kind !== 'asset' || cuenta.closedAt !== null) continue
    const carril = porMoneda.get(cuenta.currency) ?? {
      total: 0n,
      accounts: 0,
      foreignPostings: 0,
      accountIds: [],
    }
    carril.total += cuenta.balance
    carril.accounts += 1
    carril.foreignPostings += cuenta.foreignPostings
    carril.accountIds.push(cuenta.id)
    porMoneda.set(cuenta.currency, carril)
  }

  return [...porMoneda.entries()]
    .map(([currency, carril]) => ({
      currency,
      total: carril.total,
      accounts: carril.accounts,
      foreignPostings: carril.foreignPostings,
      accountIds: [...carril.accountIds].sort(),
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency))
}
