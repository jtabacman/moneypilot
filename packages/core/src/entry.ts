/**
 * Partida doble con grano `posting`.
 *
 * INVARIANTE CENTRAL DEL SISTEMA:
 *   toda entry balancea a cero **dentro de cada moneda**.
 *
 * Esa formulación —y no "la suma de todo da cero"— es la que hace que un solo
 * mecanismo resuelva cuatro problemas que de otro modo serían cuatro parches:
 *
 *   1. Splits: una entry con N patas contra la misma cuenta de origen.
 *   2. Transferencias: dos patas, ninguna es gasto ni ingreso.
 *   3. Gastos compartidos con peso: `allocate` reparte sin perder céntimos.
 *   4. Conversión de moneda: las patas están en monedas distintas, así que
 *      cada moneda se balancea contra una cuenta de trading. El residuo en
 *      moneda de reporte es la diferencia de cambio, y queda como una línea
 *      explícita en vez de desaparecer en un redondeo.
 *
 * El punto 4 es el método Selinger, que es lo que hace GnuCash con sus
 * Trading Accounts. Es lo que permite que el waterfall patrimonial tenga una
 * barra "efecto cambiario" que se pueda clickear hasta la transacción.
 */

import type { CurrencyCode } from './currency.js'
import type { AccountId, DimensionValueId, EntryId, ImportBatchId } from './ids.js'
import { type Money, negate, zero } from './money.js'
import type { PlainDate } from './plain-date.js'

/** Cómo entró el dato al sistema. Se conserva para siempre. */
export type DataSource = 'file' | 'pdf' | 'manual' | 'api'

/** Tasa de cambio como fracción exacta. Nunca un float. */
export interface FxRate {
  readonly numerator: bigint
  readonly denominator: bigint
  /** Fecha de la tasa aplicada. Congelada: no se recalcula nunca. */
  readonly asOf: PlainDate
  readonly source: string
}

export interface DimensionAssignment {
  readonly valueId: DimensionValueId
  /**
   * Peso 0..1 para atribución parcial. Un gasto 60/40 entre "Personal" y
   * "Sociedad" son dos asignaciones de la misma dimensión con pesos 0,6 y 0,4.
   * Los importes derivados se calculan con `allocate`, no multiplicando.
   */
  readonly weight: number
}

export interface Posting {
  readonly accountId: AccountId
  /**
   * El importe que balancea, **en la moneda de la cuenta**.
   * Negativo = sale de la cuenta. Esta convención se normaliza en el importador
   * y no se discute más abajo.
   */
  readonly amount: Money
  /**
   * Importe original en la moneda del comercio, si difiere.
   * Es el primero de los "tres números" de un gasto de tarjeta en el exterior.
   */
  readonly native?: Money
  /** Consolidado a la moneda de reporte, congelado a la fecha. */
  readonly base?: Money
  readonly fx?: FxRate
  readonly dimensions?: readonly DimensionAssignment[]
  readonly memo?: string
  /** Marca las patas de una transferencia interna: nunca son gasto ni ingreso. */
  readonly isTransfer?: boolean
}

export interface Entry {
  readonly id: EntryId
  /** Fecha contable. Es la canónica para cortes de período y para el dedup. */
  readonly bookedOn: PlainDate
  /** Fecha de valor, cuando el origen la trae. Se conserva, no se mezcla. */
  readonly valuedOn?: PlainDate
  readonly description: string
  readonly postings: readonly Posting[]
  readonly source: DataSource
  readonly importBatchId?: ImportBatchId
  /** Huella canónica de la pata principal. Ver identity.ts. */
  readonly fingerprint?: string
  /** Identificador que trajo el origen (FITID). Atributo, no clave. */
  readonly externalId?: string
}

export class UnbalancedEntryError extends Error {
  constructor(readonly imbalances: ReadonlyMap<CurrencyCode, bigint>) {
    const detail = [...imbalances].map(([currency, amount]) => `${currency}: ${amount}`).join(', ')
    super(`La entry no balancea a cero por moneda (${detail})`)
    this.name = 'UnbalancedEntryError'
  }
}

/** Residuo por moneda. Un mapa vacío significa que la entry está balanceada. */
export function currencyImbalances(postings: readonly Posting[]): Map<CurrencyCode, bigint> {
  const totals = new Map<CurrencyCode, bigint>()
  for (const posting of postings) {
    const current = totals.get(posting.amount.currency) ?? 0n
    totals.set(posting.amount.currency, current + posting.amount.amount)
  }
  for (const [currency, total] of totals) {
    if (total === 0n) totals.delete(currency)
  }
  return totals
}

export function isBalanced(postings: readonly Posting[]): boolean {
  return currencyImbalances(postings).size === 0
}

export function assertBalanced(postings: readonly Posting[]): void {
  const imbalances = currencyImbalances(postings)
  if (imbalances.size > 0) throw new UnbalancedEntryError(imbalances)
}

/**
 * Cierra los residuos por moneda contra cuentas de trading.
 *
 * Ejemplo: una transferencia de 100 EUR que llega como 108,73 USD produce dos
 * patas que no balancean por moneda. Esta función añade:
 *   Trading:EUR  +100,00 EUR
 *   Trading:USD  -108,73 USD
 * y ahora cada moneda cierra en cero. La diferencia entre ambas, valuada en la
 * moneda de reporte, es exactamente el resultado por tipo de cambio.
 *
 * Idempotente: si ya está balanceada, devuelve las mismas patas.
 */
export function balanceWithTradingAccounts(
  postings: readonly Posting[],
  resolveTradingAccount: (currency: CurrencyCode) => AccountId,
): Posting[] {
  const imbalances = currencyImbalances(postings)
  if (imbalances.size === 0) return [...postings]

  const result = [...postings]
  // Orden determinista por código de moneda: el mismo input produce siempre
  // exactamente las mismas patas, que es lo que hace reproducible el hash.
  for (const currency of [...imbalances.keys()].sort()) {
    const residual = imbalances.get(currency) ?? 0n
    result.push({
      accountId: resolveTradingAccount(currency),
      amount: negate({ amount: residual, currency }),
      isTransfer: true,
      memo: 'Contrapartida de conversión de moneda',
    })
  }

  assertBalanced(result)
  return result
}

/** Suma de las patas que tocan una cuenta, en la moneda de esa cuenta. */
export function accountMovement(
  postings: readonly Posting[],
  accountId: AccountId,
  currency: CurrencyCode,
): Money {
  let total = 0n
  for (const posting of postings) {
    if (posting.accountId === accountId && posting.amount.currency === currency) {
      total += posting.amount.amount
    }
  }
  return total === 0n ? zero(currency) : { amount: total, currency }
}
