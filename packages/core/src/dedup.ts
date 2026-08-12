/**
 * Deduplicación en dos pasadas.
 *
 * Regla que gobierna todo el módulo: **nunca autodescartar en silencio**.
 * La pasada determinista descarta; la pasada difusa manda a una cola de
 * revisión humana. Una importación que borra una transacción legítima sin
 * decirlo es peor que una que duplica: el duplicado se ve, la ausencia no.
 *
 * Y el FITID no es clave. Está documentado que sólo es único dentro del
 * alcance de la cuenta y que los bancos lo reemiten distinto tras un
 * rebooking. Se usa como *señal*, siempre junto a la cuenta, y sólo cuando
 * el importe y la fecha también coinciden.
 */

import { type IdentityInput, transactionFingerprint } from './identity.js'
import { type Money, equals as moneyEquals } from './money.js'
import { descriptionTokens, tokenSimilarity } from './normalize.js'
import { differenceInDays, type PlainDate } from './plain-date.js'

export interface TransactionRef {
  readonly id: string
  readonly accountId: string
  readonly bookedOn: PlainDate
  readonly amount: Money
  readonly description: string
  readonly fingerprint: string
  readonly externalId?: string
}

export interface IncomingTransaction {
  readonly lineNumber: number
  readonly accountId: string
  readonly bookedOn: PlainDate
  readonly amount: Money
  readonly description: string
  readonly ordinal: number
  readonly externalId?: string
}

export type DedupVerdict =
  | { readonly kind: 'new' }
  | {
      readonly kind: 'duplicate'
      readonly reason: 'fingerprint' | 'external_id'
      readonly existingId: string
    }
  | {
      readonly kind: 'review'
      readonly reason: 'fuzzy'
      readonly candidateId: string
      readonly similarity: number
      readonly dayGap: number
    }

export interface ClassifiedTransaction {
  readonly incoming: IncomingTransaction
  readonly fingerprint: string
  readonly verdict: DedupVerdict
}

export interface DedupOptions {
  /** Ventana de la pasada difusa, en días. */
  readonly fuzzyWindowDays?: number
  /** Umbral de similitud de tokens para mandar a revisión. 0..1. */
  readonly similarityThreshold?: number
}

const DEFAULTS = {
  fuzzyWindowDays: 5,
  similarityThreshold: 0.6,
} as const

function identityOf(tx: IncomingTransaction): IdentityInput {
  return {
    accountId: tx.accountId,
    bookedOn: tx.bookedOn,
    amount: tx.amount,
    descriptionRaw: tx.description,
    ordinal: tx.ordinal,
  }
}

/**
 * Clasifica un lote entrante contra lo que ya existe.
 *
 * Los dos índices tienen alcances distintos, y la diferencia es deliberada:
 *
 *  - El índice **determinista** (huella y FITID) incluye también las filas
 *    aceptadas del propio lote. Así, un fichero que repite literalmente un
 *    FITID deduplica dentro de sí mismo.
 *
 *  - El índice **difuso** contiene únicamente lo ya persistido. La pasada
 *    difusa existe para detectar recontabilizaciones *entre importaciones*
 *    —el banco reemite un movimiento con otro descriptor o corrido de fecha—,
 *    no para dudar de un extracto que internamente ya es consistente.
 *
 * Si la difusa mirara el propio lote, dos cafés de 3,50 del mismo día
 * (transacciones reales y frecuentes, ya distinguidas por el ordinal) irían a
 * revisión humana. Eso inunda la cola y destruye el 3-8% de revisión que el
 * producto promete: un mismo extracto no trae el mismo movimiento dos veces
 * con descriptores distintos.
 *
 * La protección contra reimportar el fichero entero no vive acá: vive en el
 * lote, como hash del contenido, que es donde corresponde.
 */
export function classifyIncoming(
  incoming: readonly IncomingTransaction[],
  existing: readonly TransactionRef[],
  options: DedupOptions = {},
): ClassifiedTransaction[] {
  const fuzzyWindowDays = options.fuzzyWindowDays ?? DEFAULTS.fuzzyWindowDays
  const similarityThreshold = options.similarityThreshold ?? DEFAULTS.similarityThreshold

  const byFingerprint = new Map<string, string>()
  const byExternalId = new Map<string, TransactionRef>()
  /** Sólo lo persistido: candidatos de la pasada difusa. */
  const fuzzyByAccount = new Map<string, TransactionRef[]>()

  const indexDeterministic = (ref: TransactionRef): void => {
    if (!byFingerprint.has(ref.fingerprint)) byFingerprint.set(ref.fingerprint, ref.id)
    if (ref.externalId !== undefined) {
      byExternalId.set(`${ref.accountId}\u001F${ref.externalId}`, ref)
    }
  }

  for (const ref of existing) {
    indexDeterministic(ref)
    const list = fuzzyByAccount.get(ref.accountId)
    if (list) list.push(ref)
    else fuzzyByAccount.set(ref.accountId, [ref])
  }

  const results: ClassifiedTransaction[] = []

  for (const tx of incoming) {
    const fingerprint = transactionFingerprint(identityOf(tx))

    // ── Pasada 1: determinista ────────────────────────────────────────────
    const byHash = byFingerprint.get(fingerprint)
    if (byHash !== undefined) {
      results.push({
        incoming: tx,
        fingerprint,
        verdict: {
          kind: 'duplicate',
          reason: 'fingerprint',
          existingId: byHash,
        },
      })
      continue
    }

    if (tx.externalId !== undefined) {
      const candidate = byExternalId.get(`${tx.accountId}\u001F${tx.externalId}`)
      // El FITID solo se acepta como prueba de duplicado si el importe y la
      // fecha también coinciden. Un FITID reutilizado con otro importe es un
      // rebooking o un bug del banco, no el mismo movimiento.
      if (
        candidate !== undefined &&
        moneyEquals(candidate.amount, tx.amount) &&
        candidate.bookedOn === tx.bookedOn
      ) {
        results.push({
          incoming: tx,
          fingerprint,
          verdict: {
            kind: 'duplicate',
            reason: 'external_id',
            existingId: candidate.id,
          },
        })
        continue
      }
    }

    // ── Pasada 2: difusa. Nunca descarta; manda a revisión ────────────────
    // Sólo contra lo persistido. Ver la nota de alcance arriba.
    const best = findFuzzyCandidate(
      tx,
      fuzzyByAccount.get(tx.accountId) ?? [],
      fuzzyWindowDays,
      similarityThreshold,
    )

    const accepted: TransactionRef = {
      id: `pending:${tx.lineNumber}`,
      accountId: tx.accountId,
      bookedOn: tx.bookedOn,
      amount: tx.amount,
      description: tx.description,
      fingerprint,
      ...(tx.externalId === undefined ? {} : { externalId: tx.externalId }),
    }

    if (best !== null) {
      results.push({
        incoming: tx,
        fingerprint,
        verdict: {
          kind: 'review',
          reason: 'fuzzy',
          candidateId: best.ref.id,
          similarity: best.similarity,
          dayGap: best.dayGap,
        },
      })
      indexDeterministic(accepted)
      continue
    }

    results.push({ incoming: tx, fingerprint, verdict: { kind: 'new' } })
    indexDeterministic(accepted)
  }

  return results
}

interface FuzzyMatch {
  readonly ref: TransactionRef
  readonly similarity: number
  readonly dayGap: number
}

function findFuzzyCandidate(
  tx: IncomingTransaction,
  candidates: readonly TransactionRef[],
  windowDays: number,
  threshold: number,
): FuzzyMatch | null {
  const tokens = descriptionTokens(tx.description)
  let best: FuzzyMatch | null = null

  for (const ref of candidates) {
    // El importe tiene que coincidir exacto. Tolerar diferencias de importe en
    // el dedup es la forma más rápida de fusionar dos compras distintas.
    if (!moneyEquals(ref.amount, tx.amount)) continue

    const dayGap = differenceInDays(ref.bookedOn, tx.bookedOn)
    if (Math.abs(dayGap) > windowDays) continue

    const similarity = tokenSimilarity(tokens, descriptionTokens(ref.description))
    if (similarity < threshold) continue

    const better =
      best === null ||
      similarity > best.similarity ||
      (similarity === best.similarity && Math.abs(dayGap) < Math.abs(best.dayGap))

    if (better) best = { ref, similarity, dayGap }
  }

  return best
}

export interface DedupSummary {
  readonly total: number
  readonly fresh: number
  readonly duplicates: number
  readonly needsReview: number
}

export function summarizeDedup(classified: readonly ClassifiedTransaction[]): DedupSummary {
  let fresh = 0
  let duplicates = 0
  let needsReview = 0
  for (const item of classified) {
    if (item.verdict.kind === 'new') fresh += 1
    else if (item.verdict.kind === 'duplicate') duplicates += 1
    else needsReview += 1
  }
  return { total: classified.length, fresh, duplicates, needsReview }
}
