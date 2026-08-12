/**
 * Matching de transferencias entre cuentas.
 *
 * Por qué importa tanto: una transferencia de la cuenta corriente a la de
 * ahorro aparece dos veces en los ficheros —salida en una, entrada en otra— y
 * si no se emparejan, el reporte dice que gastaste el dinero y también que lo
 * cobraste. Con 25 cuentas eso no es un detalle cosmético: es la diferencia
 * entre un informe creíble y uno que el contador devuelve.
 *
 * Casos que hay que cubrir y que rompen a los importadores ingenuos:
 *  - Las dos patas tienen fechas distintas (la salida se contabiliza antes).
 *  - Los importes difieren por comisión.
 *  - Los importes difieren porque hubo conversión de moneda.
 *  - Cadenas de tres patas: cuenta -> tarjeta -> pago.
 */

import type { CurrencyCode } from './currency.js'
import type { Money } from './money.js'
import { differenceInDays, type PlainDate } from './plain-date.js'

export interface TransferLeg {
  readonly id: string
  readonly accountId: string
  readonly bookedOn: PlainDate
  readonly amount: Money
  readonly description: string
}

export type TransferConfidence = 'exact' | 'fee' | 'fx'

export interface TransferPair {
  readonly outgoing: TransferLeg
  readonly incoming: TransferLeg
  readonly dayGap: number
  readonly confidence: TransferConfidence
  /** Diferencia sin explicar entre las patas, en la moneda de salida. Solo en 'fee'. */
  readonly residual?: Money
}

export interface TransferOptions {
  /** Ventana máxima entre las dos patas, en días. */
  readonly windowDays?: number
  /**
   * Tolerancia para atribuir la diferencia a una comisión, en unidades
   * mínimas. Deliberadamente chica: si la diferencia es grande, no es una
   * comisión y emparejarlas oculta un movimiento real.
   */
  readonly feeToleranceMinor?: bigint
  /**
   * Si dos patas están en monedas distintas, se consideran candidatas a
   * conversión. Sin tasa declarada no se puede verificar el importe, así que
   * la confianza baja y el par queda marcado para revisión.
   */
  readonly allowCrossCurrency?: boolean
}

const DEFAULTS = {
  windowDays: 5,
  feeToleranceMinor: 5000n,
  allowCrossCurrency: true,
} as const

export interface TransferMatchResult {
  readonly pairs: readonly TransferPair[]
  readonly unmatched: readonly TransferLeg[]
}

interface Candidate {
  readonly outIndex: number
  readonly inIndex: number
  readonly dayGap: number
  readonly confidence: TransferConfidence
  readonly amountDiff: bigint
}

const CONFIDENCE_RANK: Record<TransferConfidence, number> = {
  exact: 0,
  fee: 1,
  fx: 2,
}

/**
 * Empareja salidas con entradas de forma determinista.
 *
 * El algoritmo es codicioso pero con un orden total explícito: primero los
 * pares más confiables, luego los de menor separación temporal, luego los de
 * menor diferencia de importe, y a igualdad se desempata por id. Sin ese
 * desempate, dos ejecuciones sobre el mismo fichero podrían producir
 * emparejamientos distintos, y un informe que no es reproducible no sirve.
 */
export function matchTransfers(
  legs: readonly TransferLeg[],
  options: TransferOptions = {},
): TransferMatchResult {
  const windowDays = options.windowDays ?? DEFAULTS.windowDays
  const feeTolerance = options.feeToleranceMinor ?? DEFAULTS.feeToleranceMinor
  const allowCrossCurrency = options.allowCrossCurrency ?? DEFAULTS.allowCrossCurrency

  const outgoing = legs.filter((leg) => leg.amount.amount < 0n)
  const incoming = legs.filter((leg) => leg.amount.amount > 0n)

  const candidates: Candidate[] = []

  for (const [outIndex, out] of outgoing.entries()) {
    for (const [inIndex, inc] of incoming.entries()) {
      // Una transferencia cruza cuentas. Dos patas en la misma cuenta son
      // dos movimientos, no un traspaso.
      if (out.accountId === inc.accountId) continue

      const dayGap = differenceInDays(out.bookedOn, inc.bookedOn)
      if (Math.abs(dayGap) > windowDays) continue

      const classified = classifyPair(out, inc, feeTolerance, allowCrossCurrency)
      if (classified === null) continue

      candidates.push({ outIndex, inIndex, dayGap, ...classified })
    }
  }

  candidates.sort((a, b) => {
    const rank = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence]
    if (rank !== 0) return rank
    const gap = Math.abs(a.dayGap) - Math.abs(b.dayGap)
    if (gap !== 0) return gap
    if (a.amountDiff !== b.amountDiff) return a.amountDiff < b.amountDiff ? -1 : 1
    const outA = outgoing[a.outIndex]
    const outB = outgoing[b.outIndex]
    const byOut = (outA?.id ?? '').localeCompare(outB?.id ?? '')
    if (byOut !== 0) return byOut
    const incA = incoming[a.inIndex]
    const incB = incoming[b.inIndex]
    return (incA?.id ?? '').localeCompare(incB?.id ?? '')
  })

  const usedOut = new Set<number>()
  const usedIn = new Set<number>()
  const pairs: TransferPair[] = []

  for (const candidate of candidates) {
    if (usedOut.has(candidate.outIndex) || usedIn.has(candidate.inIndex)) continue
    const out = outgoing[candidate.outIndex]
    const inc = incoming[candidate.inIndex]
    if (out === undefined || inc === undefined) continue

    usedOut.add(candidate.outIndex)
    usedIn.add(candidate.inIndex)

    const residual =
      candidate.confidence === 'fee'
        ? { amount: candidate.amountDiff, currency: out.amount.currency }
        : undefined

    pairs.push({
      outgoing: out,
      incoming: inc,
      dayGap: candidate.dayGap,
      confidence: candidate.confidence,
      ...(residual === undefined ? {} : { residual }),
    })
  }

  const unmatched = [
    ...outgoing.filter((_, index) => !usedOut.has(index)),
    ...incoming.filter((_, index) => !usedIn.has(index)),
  ]

  return { pairs, unmatched }
}

function classifyPair(
  out: TransferLeg,
  inc: TransferLeg,
  feeTolerance: bigint,
  allowCrossCurrency: boolean,
): { confidence: TransferConfidence; amountDiff: bigint } | null {
  const outMagnitude = -out.amount.amount
  const inMagnitude = inc.amount.amount

  if (out.amount.currency === inc.amount.currency) {
    const diff = outMagnitude - inMagnitude
    const absoluteDiff = diff < 0n ? -diff : diff
    if (absoluteDiff === 0n) return { confidence: 'exact', amountDiff: 0n }
    if (absoluteDiff <= feeTolerance) return { confidence: 'fee', amountDiff: diff }
    return null
  }

  if (!allowCrossCurrency) return null
  // Monedas distintas: sin tasa declarada no hay forma de verificar el
  // importe, así que el par queda como candidato de baja confianza y lo
  // confirma una persona. Adivinar acá es inventar plata.
  return { confidence: 'fx', amountDiff: 0n }
}

/** Cuentas involucradas en al menos una transferencia detectada. */
export function accountsInvolved(pairs: readonly TransferPair[]): Set<string> {
  const accounts = new Set<string>()
  for (const pair of pairs) {
    accounts.add(pair.outgoing.accountId)
    accounts.add(pair.incoming.accountId)
  }
  return accounts
}

/** Monedas involucradas, para saber qué cuentas de trading hacen falta. */
export function currenciesInvolved(pairs: readonly TransferPair[]): Set<CurrencyCode> {
  const currencies = new Set<CurrencyCode>()
  for (const pair of pairs) {
    currencies.add(pair.outgoing.amount.currency)
    currencies.add(pair.incoming.amount.currency)
  }
  return currencies
}
