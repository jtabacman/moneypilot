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
 *
 * ── Cuando el origen es un feed (`source: 'api'`) ────────────────────────────
 *
 * Todo lo anterior está pensado para ficheros, donde no hay ningún
 * identificador en el que confiar. Un agregador cambia eso, y cambia también
 * el modo de fallo:
 *
 *  · **El identificador del proveedor pasa a mandar.** Es estable entre
 *    pendiente y asentado, que es justo lo que la huella no es: la huella
 *    lleva dentro la descripción normalizada, el importe y la fecha, y las
 *    tres cambian cuando el banco asienta lo que estaba pendiente. La huella
 *    se sigue calculando y guardando —es la única forma de cruzar con lo que
 *    entró por fichero— pero deja de ser la clave.
 *
 *  · **Aparece un tercer veredicto: 'updated'.** Un movimiento cuyo
 *    identificador ya existe pero cuyo importe, fecha o descripción cambiaron
 *    no es un duplicado (el hecho no está guardado como está ahora) ni es
 *    nuevo (guardarlo otra vez lo contaría dos veces). Es el mismo hecho,
 *    corregido por el banco, y lo que corresponde es actualizarlo en su sitio.
 *
 *  · **La pasada difusa deja de ver los hechos del propio proveedor.** El
 *    identificador se mira antes que ella, así que el vaivén de pendiente a
 *    asentado —que es lo que inundaba la cola el primer día— ya está resuelto
 *    cuando le toca el turno. Lo que queda por mirar son filas cuyo
 *    identificador no conocemos, y ahí la difusa sigue haciendo falta: es lo
 *    único que reconoce un movimiento que entró por fichero con otro
 *    descriptor. Lo que se le quita son los candidatos que el proveedor ya
 *    declaró distintos.
 *
 * ── El cruce entre orígenes ──────────────────────────────────────────────────
 *
 * El caso peligroso: alguien importa enero por fichero y después conecta el
 * banco, que le devuelve los mismos movimientos de enero con SUS
 * identificadores. Ahí el identificador del proveedor no sirve —no coincide
 * con ningún FITID— y la huella sí: por eso la pasada de huella se hace
 * primero también para el feed.
 *
 * Y por eso `TransactionRef.source` importa. Sin él no se puede distinguir
 * "esta huella coincide con algo que entró por fichero" (es el mismo
 * movimiento: duplicado) de "esta huella coincide con OTRO hecho del mismo
 * proveedor" (dos cafés de 3,50 el mismo día: son dos, no uno). Cuando el
 * llamador no lo informa se toma el camino conservador, que es el de siempre.
 */

import type { DataSource } from './entry.js'
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
  /**
   * Origen del asiento ya guardado (`entry.source`). Es opcional porque hay
   * llamadores que todavía no lo leen, y sin él la clasificación se comporta
   * igual que antes. **Quien ingesta un feed tiene que informarlo**: sin
   * saber que una fila guardada vino del mismo proveedor no hay forma de
   * distinguir un segundo café idéntico de un duplicado. Ver la cabecera.
   */
  readonly source?: DataSource
}

export interface IncomingTransaction {
  readonly lineNumber: number
  readonly accountId: string
  readonly bookedOn: PlainDate
  readonly amount: Money
  readonly description: string
  readonly ordinal: number
  readonly externalId?: string
  /**
   * Fecha valor, cuando el origen la distingue de la contable.
   *
   * No entra en la huella de identidad y no se compara para decidir si un
   * movimiento cambió: viaja de acompañante para que el asiento se pueda
   * guardar con ella. Un feed las separa siempre —fecha valor y fecha contable
   * son dos hechos distintos del banco— y perderla acá dejaba `entry.valued_on`
   * en null para todo lo que entra por API.
   */
  readonly valuedOn?: PlainDate
  /** Sin declarar se trata como fichero, que es el comportamiento histórico. */
  readonly source?: DataSource
}

export interface FieldChange<T> {
  readonly before: T
  readonly after: T
}

/** Sólo los campos que cambiaron. Un campo ausente es un campo intacto. */
export interface TransactionChanges {
  readonly amount?: FieldChange<Money>
  /**
   * La fecha contable cambia constantemente entre pendiente y asentado: el
   * banco anota primero el día en que vio la operación y después el día en
   * que la contabilizó. Es parte de la corrección, no un movimiento distinto.
   */
  readonly bookedOn?: FieldChange<PlainDate>
  readonly description?: FieldChange<string>
}

export type DedupVerdict =
  | { readonly kind: 'new' }
  | {
      readonly kind: 'duplicate'
      readonly reason: 'fingerprint' | 'external_id'
      readonly existingId: string
    }
  | {
      /**
       * El mismo hecho, corregido por el banco.
       *
       * No puede ser 'duplicate': lo guardado ya no dice lo que el banco dice
       * hoy, y descartar la corrección deja el libro con un importe que el
       * extracto contradice — el delta de la reconciliación aparecería sin
       * causa visible.
       *
       * Y no puede ser 'new': el identificador del proveedor es el mismo, así
       * que es un solo movimiento. Asentarlo otra vez lo contaría dos veces y
       * duplicaría su importe en el saldo.
       */
      readonly kind: 'updated'
      readonly reason: 'external_id'
      readonly existingId: string
      readonly changes: TransactionChanges
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
  /**
   * El ordinal con el que se calculó `fingerprint`, que puede no ser el que
   * traía la fila. Ver `assignOrdinals` en identity.ts y el desempate entre
   * lotes de `classifyIncoming`.
   */
  readonly ordinal: number
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

function identityOf(tx: IncomingTransaction, ordinal: number): IdentityInput {
  return {
    accountId: tx.accountId,
    bookedOn: tx.bookedOn,
    amount: tx.amount,
    descriptionRaw: tx.description,
    ordinal,
  }
}

/**
 * Clasifica un lote entrante contra lo que ya existe.
 *
 * Los dos índices tienen alcances distintos, y la diferencia es deliberada:
 *
 *  - El índice **determinista** (huella e identificador externo) incluye
 *    también las filas aceptadas del propio lote. Así, un fichero que repite
 *    literalmente un FITID deduplica dentro de sí mismo.
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

  const byFingerprint = new Map<string, TransactionRef>()
  const byExternalId = new Map<string, TransactionRef>()
  /** Sólo lo persistido: candidatos de la pasada difusa. */
  const fuzzyByAccount = new Map<string, TransactionRef[]>()

  const indexDeterministic = (ref: TransactionRef): void => {
    if (!byFingerprint.has(ref.fingerprint)) byFingerprint.set(ref.fingerprint, ref)
    if (ref.externalId !== undefined) {
      byExternalId.set(externalKey(ref.accountId, ref.externalId), ref)
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
    // El identificador del proveedor sólo manda si el origen es un feed Y el
    // proveedor lo trajo. Un feed sin identificador no tiene nada mejor que la
    // huella, así que recae en el camino de fichero, que es el conservador.
    const providerKey =
      tx.source === 'api' && tx.externalId !== undefined
        ? externalKey(tx.accountId, tx.externalId)
        : null

    // ── Pasada 1a: huella ─────────────────────────────────────────────────
    // Primero también para el feed, y por dos motivos. Uno: es lo único que
    // reconoce un movimiento que ya había entrado por fichero. Dos: llegar a
    // 'updated' con una huella que ya existe reventaría contra
    // `entry_fingerprint_unique` al persistir; mirándola antes, eso no puede
    // pasar.
    let ordinal = tx.ordinal
    let fingerprint = transactionFingerprint(identityOf(tx, ordinal))
    let byHash = byFingerprint.get(fingerprint)

    // El ordinal es el desempate de filas genuinamente idénticas, y
    // `assignOrdinals` sólo lo puede hacer dentro del lote: no conoce lo que
    // ya está guardado. Con un feed sí lo sabemos —el identificador del
    // proveedor prueba que son dos hechos distintos—, así que el desempate
    // continúa desde donde lo dejó lo persistido. Sin esto, el segundo café
    // idéntico del día se guardaría con una huella que ya existe.
    // Termina siempre: cada vuelta produce una huella distinta y el índice es
    // finito.
    while (byHash !== undefined && providerKey !== null && isOtherProviderFact(byHash, tx)) {
      ordinal += 1
      fingerprint = transactionFingerprint(identityOf(tx, ordinal))
      byHash = byFingerprint.get(fingerprint)
    }

    if (byHash !== undefined) {
      results.push({
        incoming: tx,
        fingerprint,
        ordinal,
        verdict: {
          kind: 'duplicate',
          reason: 'fingerprint',
          existingId: byHash.id,
        },
      })
      continue
    }

    // ── Pasada 1b: identificador externo ──────────────────────────────────
    const candidate =
      tx.externalId === undefined
        ? undefined
        : byExternalId.get(externalKey(tx.accountId, tx.externalId))

    if (candidate !== undefined && providerKey !== null && sameProvider(candidate)) {
      const changes = compareAgainst(candidate, tx)
      const verdict: DedupVerdict =
        changes === null
          ? // Sin cambios y con otra huella: al lote le tocó otro ordinal para
            // la misma fila. El identificador del proveedor lo absorbe, que es
            // justamente para lo que sirve.
            { kind: 'duplicate', reason: 'external_id', existingId: candidate.id }
          : { kind: 'updated', reason: 'external_id', existingId: candidate.id, changes }

      results.push({ incoming: tx, fingerprint, ordinal, verdict })
      // Se reindexa con el contenido nuevo y el id del asiento que ya existe:
      // si el mismo lote trae dos veces el mismo identificador, la segunda se
      // compara contra lo que va a quedar guardado, no contra lo que había.
      indexDeterministic({
        id: candidate.id,
        accountId: tx.accountId,
        bookedOn: tx.bookedOn,
        amount: tx.amount,
        description: tx.description,
        fingerprint,
        source: 'api',
        ...(tx.externalId === undefined ? {} : { externalId: tx.externalId }),
      })
      continue
    }

    if (
      candidate !== undefined &&
      providerKey === null &&
      // El FITID solo se acepta como prueba de duplicado si el importe y la
      // fecha también coinciden. Un FITID reutilizado con otro importe es un
      // rebooking o un bug del banco, no el mismo movimiento.
      moneyEquals(candidate.amount, tx.amount) &&
      candidate.bookedOn === tx.bookedOn
    ) {
      results.push({
        incoming: tx,
        fingerprint,
        ordinal,
        verdict: {
          kind: 'duplicate',
          reason: 'external_id',
          existingId: candidate.id,
        },
      })
      continue
    }

    // ── Pasada 2: difusa. Nunca descarta; manda a revisión ────────────────
    // Sólo contra lo persistido. Ver la nota de alcance arriba.
    //
    // Para el feed sigue corriendo, y hace falta: un movimiento que ya entró
    // por fichero casi nunca trae el mismo descriptor que el agregador, así
    // que la huella no lo reconoce y ésta es la única red que queda antes de
    // duplicar enero entero. Lo que no mira son los hechos que el proveedor ya
    // declaró distintos — ver `findFuzzyCandidate`.
    const best = findFuzzyCandidate(
      tx,
      fuzzyByAccount.get(tx.accountId) ?? [],
      fuzzyWindowDays,
      similarityThreshold,
      providerKey !== null,
    )

    const accepted: TransactionRef = {
      id: `pending:${tx.lineNumber}`,
      accountId: tx.accountId,
      bookedOn: tx.bookedOn,
      amount: tx.amount,
      description: tx.description,
      fingerprint,
      ...(tx.source === undefined ? {} : { source: tx.source }),
      ...(tx.externalId === undefined ? {} : { externalId: tx.externalId }),
    }

    if (best !== null) {
      results.push({
        incoming: tx,
        fingerprint,
        ordinal,
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

    results.push({ incoming: tx, fingerprint, ordinal, verdict: { kind: 'new' } })
    indexDeterministic(accepted)
  }

  return results
}

/**
 * Separador de unidad (0x1F) como escape, por lo mismo que en identity.ts: un
 * carácter de control literal en el fuente es invisible y cualquier
 * formateador puede comérselo.
 */
function externalKey(accountId: string, externalId: string): string {
  return `${accountId}\u001F${externalId}`
}

/**
 * ¿La fila guardada es OTRO hecho del mismo proveedor?
 *
 * Sólo cuando sabemos que vino del feed y su identificador es distinto. Ese es
 * el único caso en que una huella idéntica no prueba nada: el proveedor ya
 * dijo que son dos movimientos. Si no sabemos el origen, o si vino por
 * fichero, la huella manda — que es lo que hace funcionar el cruce entre
 * orígenes.
 */
function isOtherProviderFact(ref: TransactionRef, tx: IncomingTransaction): boolean {
  return ref.source === 'api' && ref.externalId !== undefined && ref.externalId !== tx.externalId
}

/**
 * Sin `source` damos por buena la coincidencia de identificador: es el
 * comportamiento de siempre y el llamador que no lo informa no puede estar
 * mezclando orígenes todavía. Lo que no hacemos es reescribir en su sitio un
 * asiento que sabemos que vino de un fichero — su identificador es un FITID,
 * no el del proveedor, y coincidir es casualidad.
 */
function sameProvider(ref: TransactionRef): boolean {
  return ref.source === undefined || ref.source === 'api'
}

/** Null cuando no cambió nada: el hecho ya está guardado tal cual llega. */
function compareAgainst(ref: TransactionRef, tx: IncomingTransaction): TransactionChanges | null {
  const changes: {
    amount?: FieldChange<Money>
    bookedOn?: FieldChange<PlainDate>
    description?: FieldChange<string>
  } = {}

  if (!moneyEquals(ref.amount, tx.amount)) {
    changes.amount = { before: ref.amount, after: tx.amount }
  }
  if (ref.bookedOn !== tx.bookedOn) {
    changes.bookedOn = { before: ref.bookedOn, after: tx.bookedOn }
  }
  // La descripción se compara cruda y no normalizada: lo que se guarda es lo
  // que el usuario va a leer, así que un cambio de mayúsculas también es un
  // cambio. Cuando además cambia la huella, esta comparación ni se alcanza:
  // la pasada de huella lo resolvió antes.
  if (ref.description !== tx.description) {
    changes.description = { before: ref.description, after: tx.description }
  }

  return Object.keys(changes).length === 0 ? null : changes
}

interface FuzzyMatch {
  readonly ref: TransactionRef
  readonly similarity: number
  readonly dayGap: number
}

/**
 * `fromProvider` es true sólo cuando la fila entrante viene de un feed con
 * identificador. Sirve para descartar candidatos que ese mismo proveedor ya
 * declaró distintos: preguntarle a una persona si dos cafés de 3,50 del mismo
 * día son el mismo cuando el banco les dio dos identificadores es la clase de
 * pregunta que inunda la cola sin aportar nada.
 *
 * En el sentido contrario —una fila de fichero contra un candidato del feed—
 * la difusa sí mira, porque ahí no hay identificador que comparar y es
 * exactamente el cruce entre orígenes que hay que atrapar.
 */
function findFuzzyCandidate(
  tx: IncomingTransaction,
  candidates: readonly TransactionRef[],
  windowDays: number,
  threshold: number,
  fromProvider: boolean,
): FuzzyMatch | null {
  const tokens = descriptionTokens(tx.description)
  let best: FuzzyMatch | null = null

  for (const ref of candidates) {
    if (fromProvider && isOtherProviderFact(ref, tx)) continue

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
  /** Movimientos que ya existen y que el banco corrigió. */
  readonly updated: number
  readonly needsReview: number
}

export function summarizeDedup(classified: readonly ClassifiedTransaction[]): DedupSummary {
  let fresh = 0
  let duplicates = 0
  let updated = 0
  let needsReview = 0
  for (const item of classified) {
    switch (item.verdict.kind) {
      case 'new':
        fresh += 1
        break
      case 'duplicate':
        duplicates += 1
        break
      case 'updated':
        updated += 1
        break
      case 'review':
        needsReview += 1
        break
      default: {
        // Switch con salida exhaustiva y no una cadena de if/else: un
        // veredicto nuevo deja de compilar acá en vez de caer en el contador
        // de al lado, que es exactamente como 'updated' se habría contado
        // como "necesita revisión" sin que nadie lo notara.
        const inesperado: never = item.verdict
        throw new TypeError(`Veredicto de dedup desconocido: ${JSON.stringify(inesperado)}`)
      }
    }
  }
  return { total: classified.length, fresh, duplicates, updated, needsReview }
}
