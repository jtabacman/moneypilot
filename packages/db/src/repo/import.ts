/**
 * Persistencia de una importación como lote reversible.
 *
 * Tres decisiones gobiernan este módulo:
 *
 *  1. **Todo movimiento entra como asiento balanceado.** Un cargo de 45,20 EUR
 *     son dos postings: −4520 en la cuenta del extracto y +4520 en la
 *     contrapartida. No hay un modo "sólo importe" que después haya que
 *     migrar: la partida doble empieza en la primera importación o no empieza.
 *
 *  2. **Lo que va a revisión NO entra al libro.** El informe que se le mostró
 *     al cliente calcula los movimientos de la cuenta con las filas nuevas
 *     únicamente; si además asentáramos las dudosas, el saldo del libro no
 *     coincidiría con el informe que el cliente acaba de aprobar. Los datos no
 *     se pierden: la fila de `review_item` lleva la transacción entera en su
 *     evidencia, así que materializarla después es leerla de ahí.
 *
 *  3. **El lote se escribe ya `completed`.** El estado `running` existe para
 *     importaciones en varios pasos; esta corre entera dentro de la
 *     transacción del llamador, así que o está completa o no existe. Y
 *     escribirlo completado desde el principio hace que el índice único
 *     parcial por hash de contenido tome el candado al insertar, que es lo que
 *     impide que dos importaciones simultáneas del mismo fichero pasen las dos.
 */

import { newEntryId, newImportBatchId, tryParsePlainDate } from '@moneypilot/core'
import type { TenantClient } from '../client.js'

export interface PersistableTransaction {
  readonly bookedOn: string
  readonly valuedOn?: string
  readonly description: string
  /** Unidades mínimas, con el signo del extracto. Nunca number. */
  readonly amount: bigint
  readonly currency: string
  readonly fingerprint: string
  readonly externalId?: string
  readonly memo?: string
}

export type ReviewKind = 'posible_duplicado' | 'transferencia_sugerida' | 'sin_categorizar'

const REVIEW_KINDS: readonly ReviewKind[] = [
  'posible_duplicado',
  'transferencia_sugerida',
  'sin_categorizar',
]

export interface NeedsReviewTransaction {
  readonly transaction: PersistableTransaction
  readonly evidence: unknown
  /**
   * Por qué va a revisión. Se guarda tal cual porque la cola se filtra por
   * este campo: registrar como 'posible_duplicado' algo que en realidad estaba
   * sin categorizar hace que el usuario nunca lo encuentre donde lo busca.
   */
  readonly kind?: ReviewKind
}

export interface DeclaredBalanceInput {
  readonly asOf: string
  readonly amount: bigint
  readonly currency: string
}

export interface PersistImportInput {
  readonly accountId: string
  readonly fileName: string
  readonly format: string
  readonly contentSha256: string
  readonly linesRead: number
  /** Sólo las nuevas: las duplicadas y las dudosas van por su propio camino. */
  readonly transactions: readonly PersistableTransaction[]
  readonly duplicates: number
  readonly needsReview: readonly NeedsReviewTransaction[]
  readonly rejected: number
  readonly declaredBalances: readonly DeclaredBalanceInput[]
  /** El informe tal cual se le mostró al cliente. */
  readonly report: unknown
  /**
   * Cuenta contra la que se asienta la contrapartida mientras no haya
   * categorización. Si no se pasa, se usan (o se crean) las dos bolsas de sin
   * categorizar que corresponden al signo del movimiento.
   */
  readonly suspenseAccountId?: string
}

export interface PersistImportResult {
  readonly batchId: string
  readonly imported: number
  readonly duplicates: number
  readonly needsReview: number
  readonly skippedByContentHash: boolean
}

export type ImportBatchStatus = 'running' | 'completed' | 'reverted' | 'failed'

export interface ImportBatchRow {
  readonly id: string
  readonly accountId: string | null
  readonly fileName: string
  readonly format: string
  readonly contentSha256: string
  readonly status: ImportBatchStatus
  readonly linesRead: number
  readonly imported: number
  readonly duplicates: number
  readonly needsReview: number
  readonly rejected: number
  /** Instante, no fecha de calendario: acá el ISO completo sí es lo correcto. */
  readonly createdAt: string
  readonly revertedAt: string | null
}

export class ImportPersistError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportPersistError'
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHA256_RE = /^[0-9a-f]{64}$/i

/**
 * Nombres base de las contrapartidas por defecto. Ver `resolveSuspenseAccounts`.
 *
 * Son dos y no una porque el signo decide de qué clase es la cuenta: un cobro
 * sin categorizar no es un gasto negativo, es un ingreso. Con una sola bolsa de
 * clase `expense`, un sueldo de 3.000 € entra al informe de gastos como
 * −3.000 € y tapa el gasto real del mes.
 */
const SUSPENSE_OUTFLOW_NAME = 'Sin categorizar'
const SUSPENSE_INFLOW_NAME = 'Ingresos sin categorizar'

/**
 * Filas por sentencia. El insert masivo va con `unnest`, así que el límite no
 * es la cantidad de parámetros sino el tamaño del literal de array que viaja
 * al servidor: cortarlo mantiene acotada la memoria de una importación de
 * cientos de miles de filas sin volver al insert de a uno.
 */
const CHUNK = 2000

const LIST_DEFAULT_LIMIT = 50
const LIST_MAX_LIMIT = 500

export async function persistImport(
  client: TenantClient,
  input: PersistImportInput,
): Promise<PersistImportResult> {
  if (!SHA256_RE.test(input.contentSha256)) {
    // La columna es char(64): un hash corto se guardaría rellenado con espacios
    // y el índice de idempotencia dejaría de detectar la reimportación.
    throw new ImportPersistError(
      `content_sha256 tiene que ser sha256 en hexadecimal de 64 caracteres, y llegó ${JSON.stringify(input.contentSha256)}.`,
    )
  }

  const tenantId = await currentTenant(client)

  const previous = await findCompletedBatch(client, input.contentSha256)
  if (previous !== null) {
    // Los contadores son los del lote anterior a propósito: el llamador
    // necesita poder decir "este fichero ya lo cargaste, y trajo N
    // movimientos", no un cero que parece que el fichero estaba vacío.
    return {
      batchId: previous.id,
      imported: previous.imported,
      duplicates: previous.duplicates,
      needsReview: previous.needs_review,
      skippedByContentHash: true,
    }
  }

  const account = await loadAccount(client, input.accountId)
  validateTransactions(input, account.currency)

  const suspense = await resolveSuspenseAccounts(
    client,
    tenantId,
    account.currency,
    input.suspenseAccountId,
    input.transactions,
  )

  const batchId = newImportBatchId()
  await client.query(
    `insert into import_batch
       (id, tenant_id, account_id, file_name, format, content_sha256, status,
        lines_read, imported, duplicates, needs_review, rejected, report)
     values ($1, $2, $3, $4, $5, $6, 'completed', $7, $8, $9, $10, $11, $12::jsonb)`,
    [
      batchId,
      tenantId,
      input.accountId,
      input.fileName,
      input.format,
      input.contentSha256,
      input.linesRead,
      input.transactions.length,
      input.duplicates,
      input.needsReview.length,
      input.rejected,
      toJsonb(input.report),
    ],
  )

  await insertEntriesAndPostings(client, {
    tenantId,
    batchId,
    accountId: input.accountId,
    suspense,
    source: input.format.trim().toLowerCase() === 'pdf' ? 'pdf' : 'file',
    transactions: input.transactions,
  })

  await insertReviewItems(client, tenantId, batchId, input.needsReview)
  await insertDeclaredBalances(client, tenantId, batchId, input, account.currency)

  return {
    batchId,
    imported: input.transactions.length,
    duplicates: input.duplicates,
    needsReview: input.needsReview.length,
    skippedByContentHash: false,
  }
}

export interface RevertImportResult {
  readonly removedEntries: number
  /**
   * Filas de la cola de revisión de OTROS lotes que apuntaban a un asiento de
   * éste y se quedaron sin puntero. La fila sobrevive con su evidencia entera;
   * lo que se pierde es el enlace, y se declara en vez de callarse.
   */
  readonly detachedReviewItems: number
}

/**
 * Deshace un lote entero.
 *
 * Borra los asientos y no el lote: `entry.import_batch_id` es ON DELETE
 * RESTRICT, así que el lote sobrevive como registro de que la importación
 * ocurrió y de que se deshizo. Eso también libera el índice único parcial por
 * hash —sólo aplica a los lotes `completed`—, y por eso un fichero revertido
 * se puede volver a importar.
 */
export async function revertImport(
  client: TenantClient,
  batchId: string,
): Promise<RevertImportResult> {
  if (!UUID_RE.test(batchId)) {
    throw new ImportPersistError(`batchId inválido: ${JSON.stringify(batchId)}`)
  }

  const { rows } = await client.query<{
    status: ImportBatchStatus
    reverted_at: Date | null
    file_name: string
  }>('select status, reverted_at, file_name from import_batch where id = $1', [batchId])

  const batch = rows[0]
  if (batch === undefined) {
    // Con RLS, el lote de otro hogar es indistinguible de uno inexistente, y
    // así tiene que ser: la respuesta no puede confirmar que existe.
    throw new ImportPersistError(`El lote ${batchId} no existe en este hogar.`)
  }
  if (batch.status === 'reverted') {
    const when = batch.reverted_at === null ? 'antes' : batch.reverted_at.toISOString()
    throw new ImportPersistError(
      `El lote ${batchId} (${batch.file_name}) ya se revirtió el ${when}; no hay nada que deshacer.`,
    )
  }
  if (batch.status !== 'completed') {
    throw new ImportPersistError(
      `El lote ${batchId} (${batch.file_name}) está en estado ${batch.status}: sólo se puede revertir un lote completado.`,
    )
  }

  // El libro es append-only: corregir un asiento crea otro que lo anula y deja
  // marcado al anterior. Hay que mirar LOS DOS LADOS del enlace, porque cada
  // uno rompe de una forma distinta y sólo una de las dos hace ruido:
  //
  //  · el asiento del lote está marcado (`reversed_by` apuntando a un corrector
  //    de fuera): borrarlo NO falla, y deja al corrector con sus postings
  //    invertidos flotando solo. El saldo queda movido justo por el importe que
  //    se creía estar deshaciendo, en silencio y para siempre.
  //  · el asiento del lote ES el corrector de uno de fuera: ahí la FK
  //    `on delete restrict` sí se planta, pero con un error de Postgres que no
  //    le dice a nadie qué hacer.
  //
  // Las dos se paran acá, con un mensaje que explica que eso se resuelve a mano.
  const blocked = await client.query<{ count: string }>(
    `select count(*)::text as count
       from entry e
      where e.import_batch_id = $1
        and (e.reversed_by is not null
             or exists (select 1 from entry otro where otro.reversed_by = e.id))`,
    [batchId],
  )
  const blockedCount = BigInt(blocked.rows[0]?.count ?? '0')
  if (blockedCount > 0n) {
    throw new ImportPersistError(
      `No se puede revertir el lote ${batchId}: ${blockedCount} asiento(s) del lote están ` +
        'enlazados con asientos de anulación posteriores, que dejarían de tener a qué referirse.',
    )
  }

  await client.query('delete from review_item where import_batch_id = $1', [batchId])
  await client.query('delete from declared_balance where import_batch_id = $1', [batchId])
  // `review_item.counterpart_id` es ON DELETE CASCADE: sin soltar el puntero
  // antes, revertir este lote se llevaría por delante filas de la cola de OTROS
  // lotes —con su evidencia y todo— sin que nadie se entere. El enlace es
  // contexto; la fila es trabajo pendiente del usuario.
  const detached = await client.query(
    `update review_item
        set counterpart_id = null
      where counterpart_id in (select id from entry where import_batch_id = $1)`,
    [batchId],
  )
  // Los postings caen por cascada desde entry, y con ellos posting_dimension.
  const removed = await client.query('delete from entry where import_batch_id = $1', [batchId])
  await client.query(
    "update import_batch set status = 'reverted', reverted_at = now() where id = $1",
    [batchId],
  )

  return { removedEntries: removed.rowCount ?? 0, detachedReviewItems: detached.rowCount ?? 0 }
}

/**
 * Los lotes del hogar, del más nuevo al más viejo.
 *
 * No trae `report`: el informe completo de un extracto grande pesa cientos de
 * kilobytes y este listado es para una pantalla de historial.
 */
export async function listImportBatches(
  client: TenantClient,
  limit: number = LIST_DEFAULT_LIMIT,
): Promise<ImportBatchRow[]> {
  // `Math.trunc(NaN)` es NaN y se cuela hasta el `limit $1`, donde Postgres
  // responde con un error de sintaxis que no dice de dónde vino.
  const asked = Number.isFinite(limit) ? Math.trunc(limit) : LIST_DEFAULT_LIMIT
  const capped = Math.min(Math.max(asked, 1), LIST_MAX_LIMIT)

  const { rows } = await client.query<{
    id: string
    account_id: string | null
    file_name: string
    format: string
    content_sha256: string
    status: ImportBatchStatus
    lines_read: number
    imported: number
    duplicates: number
    needs_review: number
    rejected: number
    created_at: Date
    reverted_at: Date | null
  }>(
    `select id, account_id, file_name, format, content_sha256, status, lines_read,
            imported, duplicates, needs_review, rejected, created_at, reverted_at
       from import_batch
      order by created_at desc, id desc
      limit $1`,
    [capped],
  )

  return rows.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    fileName: row.file_name,
    format: row.format,
    contentSha256: row.content_sha256,
    status: row.status,
    linesRead: row.lines_read,
    imported: row.imported,
    duplicates: row.duplicates,
    needsReview: row.needs_review,
    rejected: row.rejected,
    createdAt: row.created_at.toISOString(),
    revertedAt: row.reverted_at === null ? null : row.reverted_at.toISOString(),
  }))
}

// ── Piezas ──────────────────────────────────────────────────────────────────

async function currentTenant(client: TenantClient): Promise<string> {
  const { rows } = await client.query<{ tenant_id: string | null }>(
    'select app_current_tenant() as tenant_id',
  )
  const tenantId = rows[0]?.tenant_id ?? null
  if (tenantId === null) {
    throw new ImportPersistError(
      'No hay hogar fijado en la transacción: persistImport tiene que correr dentro de withTenant.',
    )
  }
  return tenantId
}

interface CompletedBatch {
  readonly id: string
  readonly imported: number
  readonly duplicates: number
  readonly needs_review: number
}

async function findCompletedBatch(
  client: TenantClient,
  contentSha256: string,
): Promise<CompletedBatch | null> {
  const { rows } = await client.query<CompletedBatch>(
    `select id, imported, duplicates, needs_review
       from import_batch
      where content_sha256 = $1 and status = 'completed'
      order by created_at desc
      limit 1`,
    [contentSha256],
  )
  return rows[0] ?? null
}

async function loadAccount(
  client: TenantClient,
  accountId: string,
): Promise<{ currency: string; name: string }> {
  if (!UUID_RE.test(accountId)) {
    throw new ImportPersistError(`accountId inválido: ${JSON.stringify(accountId)}`)
  }
  const { rows } = await client.query<{ currency: string; name: string }>(
    'select currency, name from account where id = $1',
    [accountId],
  )
  const account = rows[0]
  if (account === undefined) {
    throw new ImportPersistError(`La cuenta ${accountId} no existe en este hogar.`)
  }
  return { currency: account.currency.trim().toUpperCase(), name: account.name }
}

function validateTransactions(input: PersistImportInput, accountCurrency: string): void {
  const seen = new Set<string>()

  for (const [index, tx] of input.transactions.entries()) {
    checkTransaction(tx, accountCurrency, `transactions[${index}]`)
    const key = tx.fingerprint.toLowerCase()
    if (seen.has(key)) {
      // Dos filas con la misma huella dentro del mismo fichero significan que
      // el ordinal no las desempató. Insertarlas rompería el índice único a
      // mitad del lote; abortar acá dice exactamente cuál es.
      throw new ImportPersistError(
        `La huella ${tx.fingerprint} aparece dos veces en el mismo fichero (${describe(tx)}). ` +
          'El dedup tenía que haberlas separado con el ordinal.',
      )
    }
    seen.add(key)
  }

  for (const [index, item] of input.needsReview.entries()) {
    checkTransaction(item.transaction, accountCurrency, `needsReview[${index}].transaction`)
  }
}

function checkTransaction(
  tx: PersistableTransaction,
  accountCurrency: string,
  where: string,
): void {
  if (tryParsePlainDate(tx.bookedOn) === null) {
    throw new ImportPersistError(`${where}: bookedOn no es una fecha YYYY-MM-DD: ${tx.bookedOn}`)
  }
  if (tx.valuedOn !== undefined && tryParsePlainDate(tx.valuedOn) === null) {
    throw new ImportPersistError(`${where}: valuedOn no es una fecha YYYY-MM-DD: ${tx.valuedOn}`)
  }
  if (!SHA256_RE.test(tx.fingerprint)) {
    // char(64) rellena con espacios en silencio: una huella corta se guardaría
    // igual y el dedup por huella dejaría de encontrarla.
    throw new ImportPersistError(
      `${where}: la huella tiene que ser sha256 hexadecimal de 64 caracteres, y llegó ${JSON.stringify(tx.fingerprint)}.`,
    )
  }
  const currency = tx.currency.trim().toUpperCase()
  if (currency !== accountCurrency) {
    // Una cuenta tiene UNA moneda, y el posting va en la moneda de la cuenta:
    // es lo que hace comprobable el balanceo por moneda. Un movimiento en otra
    // divisa necesita su propia cuenta, no una conversión inventada acá.
    throw new ImportPersistError(
      `${where}: el movimiento viene en ${currency} y la cuenta del extracto está en ${accountCurrency} (${describe(tx)}).`,
    )
  }
}

function describe(tx: PersistableTransaction): string {
  return `${tx.bookedOn} ${tx.description}`
}

interface SuspenseAccounts {
  /** Contrapartida de un cargo: la plata que sale. Cuenta de gasto. */
  readonly outflow: string | null
  /** Contrapartida de un abono: la plata que entra. Cuenta de ingreso. */
  readonly inflow: string | null
}

/**
 * Las contrapartidas por defecto, en la moneda de la cuenta.
 *
 * Se resuelven las que el fichero necesita y ninguna más: un extracto sin
 * abonos no tiene por qué dejarle al hogar una cuenta de ingresos vacía en el
 * plan de cuentas.
 *
 * Si el llamador pasa una contrapartida explícita, se usa para los dos signos:
 * es una elección suya y este módulo no la discute.
 */
async function resolveSuspenseAccounts(
  client: TenantClient,
  tenantId: string,
  currency: string,
  provided: string | undefined,
  transactions: readonly PersistableTransaction[],
): Promise<SuspenseAccounts> {
  if (provided !== undefined) {
    const id = await checkProvidedSuspense(client, currency, provided)
    return { outflow: id, inflow: id }
  }

  const needsOutflow = transactions.some((tx) => tx.amount <= 0n)
  const needsInflow = transactions.some((tx) => tx.amount > 0n)

  return {
    outflow: needsOutflow
      ? await resolveSuspense(client, tenantId, currency, 'expense', SUSPENSE_OUTFLOW_NAME)
      : null,
    inflow: needsInflow
      ? await resolveSuspense(client, tenantId, currency, 'income', SUSPENSE_INFLOW_NAME)
      : null,
  }
}

async function checkProvidedSuspense(
  client: TenantClient,
  currency: string,
  provided: string,
): Promise<string> {
  if (!UUID_RE.test(provided)) {
    throw new ImportPersistError(`suspenseAccountId inválido: ${JSON.stringify(provided)}`)
  }
  const { rows } = await client.query<{ currency: string; name: string }>(
    'select currency, name from account where id = $1',
    [provided],
  )
  const account = rows[0]
  if (account === undefined) {
    throw new ImportPersistError(`La cuenta de contrapartida ${provided} no existe en este hogar.`)
  }
  if (account.currency.trim().toUpperCase() !== currency) {
    throw new ImportPersistError(
      `La contrapartida "${account.name}" está en ${account.currency.trim()} y el extracto viene en ${currency}. ` +
        'Los dos postings de un asiento tienen que estar en la misma moneda para que balancee.',
    )
  }
  return provided
}

/**
 * El nombre lleva la moneda porque `account_name_unique` es (hogar, nombre) y
 * cada cuenta tiene una sola moneda: un hogar con cuentas en euros y en dólares
 * necesita dos bolsas, y son dos cuentas distintas. Si ya existe una con el
 * nombre a secas en esa moneda —creada a mano por el cliente— se reutiliza esa
 * antes que crear una segunda.
 */
async function resolveSuspense(
  client: TenantClient,
  tenantId: string,
  currency: string,
  kind: 'expense' | 'income',
  baseName: string,
): Promise<string> {
  const perCurrencyName = `${baseName} (${currency})`
  const { rows } = await client.query<{ id: string; name: string }>(
    'select id, name from account where currency = $1 and name = any($2::text[])',
    [currency, [baseName, perCurrencyName]],
  )
  const existing = rows.find((row) => row.name === baseName) ?? rows[0]
  if (existing !== undefined) return existing.id

  const created = await client.query<{ id: string }>(
    `insert into account (tenant_id, kind, name, currency)
     values ($1, $2::account_kind, $3, $4)
     returning id`,
    [tenantId, kind, perCurrencyName, currency],
  )
  const id = created.rows[0]?.id
  if (id === undefined) {
    throw new ImportPersistError(`No se pudo crear la cuenta "${perCurrencyName}".`)
  }
  return id
}

interface EntryBatch {
  readonly tenantId: string
  readonly batchId: string
  readonly accountId: string
  readonly suspense: SuspenseAccounts
  readonly source: 'file' | 'pdf'
  readonly transactions: readonly PersistableTransaction[]
}

async function insertEntriesAndPostings(client: TenantClient, batch: EntryBatch): Promise<void> {
  const rows = batch.transactions.map((transaction) => ({ id: newEntryId(), transaction }))

  for (let offset = 0; offset < rows.length; offset += CHUNK) {
    const slice = rows.slice(offset, offset + CHUNK)

    await client.query(
      `insert into entry
         (id, tenant_id, booked_on, valued_on, description, source, import_batch_id,
          fingerprint, external_id)
       select t.id, $1::uuid, t.booked_on, t.valued_on, t.description, $2::data_source, $3::uuid,
              t.fingerprint, t.external_id
         from unnest($4::uuid[], $5::date[], $6::date[], $7::text[], $8::text[], $9::text[])
              as t(id, booked_on, valued_on, description, fingerprint, external_id)`,
      [
        batch.tenantId,
        batch.source,
        batch.batchId,
        slice.map((row) => row.id),
        slice.map((row) => row.transaction.bookedOn),
        slice.map((row) => row.transaction.valuedOn ?? null),
        slice.map((row) => row.transaction.description),
        // En minúsculas SIEMPRE: `entry_fingerprint_unique` compara char(64)
        // byte a byte, así que la misma huella escrita en mayúsculas se
        // insertaría como un asiento nuevo y el dedup no la vería.
        slice.map((row) => row.transaction.fingerprint.toLowerCase()),
        slice.map((row) => row.transaction.externalId ?? null),
      ],
    )

    const entryIds: string[] = []
    const accountIds: string[] = []
    const ordinals: number[] = []
    const amounts: string[] = []
    const currencies: string[] = []
    const memos: (string | null)[] = []

    for (const row of slice) {
      const currency = row.transaction.currency.trim().toUpperCase()
      // Pata 0: la cuenta del extracto, con el signo tal cual vino del banco.
      entryIds.push(row.id)
      accountIds.push(batch.accountId)
      ordinals.push(0)
      amounts.push(row.transaction.amount.toString())
      currencies.push(currency)
      memos.push(row.transaction.memo ?? null)
      // Pata 1: la contrapartida, que es exactamente lo opuesto. Que se calcule
      // por negación y no por otra lectura del fichero es lo que garantiza el
      // cero: no hay forma de que las dos patas discrepen.
      const counterpart =
        row.transaction.amount > 0n ? batch.suspense.inflow : batch.suspense.outflow
      if (counterpart === null) {
        throw new ImportPersistError(
          `No se resolvió la contrapartida para ${describe(row.transaction)}: es un error de programación de este módulo, no del fichero.`,
        )
      }
      entryIds.push(row.id)
      accountIds.push(counterpart)
      ordinals.push(1)
      amounts.push((-row.transaction.amount).toString())
      currencies.push(currency)
      memos.push(null)
    }

    await client.query(
      `insert into posting (tenant_id, entry_id, account_id, ordinal, amount, currency, memo)
       select $1::uuid, p.entry_id, p.account_id, p.ordinal, p.amount, p.currency, p.memo
         from unnest($2::uuid[], $3::uuid[], $4::smallint[], $5::bigint[], $6::text[], $7::text[])
              as p(entry_id, account_id, ordinal, amount, currency, memo)`,
      [batch.tenantId, entryIds, accountIds, ordinals, amounts, currencies, memos],
    )
  }
}

async function insertReviewItems(
  client: TenantClient,
  tenantId: string,
  batchId: string,
  items: readonly NeedsReviewTransaction[],
): Promise<void> {
  if (items.length === 0) return

  const candidates = await existingEntryIds(
    client,
    items.map((item) => candidateIdOf(item.evidence)).filter((id): id is string => id !== null),
  )

  const evidences = items.map((item) =>
    toJsonb({ transaccion: wireTransaction(item.transaction), evidencia: item.evidence ?? null }),
  )
  const counterparts = items.map((item) => {
    const candidate = candidateIdOf(item.evidence)
    return candidate !== null && candidates.has(candidate) ? candidate : null
  })
  const kinds = items.map((item, index) => {
    const kind = item.kind ?? 'posible_duplicado'
    if (!REVIEW_KINDS.includes(kind)) {
      throw new ImportPersistError(
        `needsReview[${index}].kind no es un motivo de revisión conocido: ${JSON.stringify(kind)}.`,
      )
    }
    return kind
  })

  await client.query(
    `insert into review_item (tenant_id, kind, evidence, import_batch_id, counterpart_id)
     select $1::uuid, e.kind::review_kind, e.evidence::jsonb, $2::uuid, e.counterpart_id
       from unnest($3::text[], $4::uuid[], $5::text[]) as e(evidence, counterpart_id, kind)`,
    [tenantId, batchId, evidences, counterparts, kinds],
  )
}

/**
 * El candidato de la pasada difusa, sólo si es un asiento que existe de verdad.
 *
 * `candidateId` puede ser un identificador sintético del propio lote
 * (`pending:12`) o el id de un asiento ya borrado, y la FK de `counterpart_id`
 * haría fallar la importación entera por un dato que es de contexto.
 */
function candidateIdOf(evidence: unknown): string | null {
  if (typeof evidence !== 'object' || evidence === null) return null
  const value = (evidence as Record<string, unknown>)['candidateId']
  return typeof value === 'string' && UUID_RE.test(value) ? value : null
}

async function existingEntryIds(
  client: TenantClient,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const { rows } = await client.query<{ id: string }>(
    'select id from entry where id = any($1::uuid[])',
    [[...new Set(ids)]],
  )
  return new Set(rows.map((row) => row.id))
}

function wireTransaction(tx: PersistableTransaction): Record<string, string | null> {
  return {
    bookedOn: tx.bookedOn,
    valuedOn: tx.valuedOn ?? null,
    description: tx.description,
    // Unidades mínimas como string: en JSON, un importe como número es el error
    // de coma flotante que el núcleo elimina, reintroducido en la frontera.
    amountMinor: tx.amount.toString(),
    currency: tx.currency.trim().toUpperCase(),
    fingerprint: tx.fingerprint.toLowerCase(),
    externalId: tx.externalId ?? null,
    memo: tx.memo ?? null,
  }
}

async function insertDeclaredBalances(
  client: TenantClient,
  tenantId: string,
  batchId: string,
  input: PersistImportInput,
  accountCurrency: string,
): Promise<void> {
  if (input.declaredBalances.length === 0) return

  const byDate = new Map<string, DeclaredBalanceInput>()
  for (const [index, balance] of input.declaredBalances.entries()) {
    if (tryParsePlainDate(balance.asOf) === null) {
      throw new ImportPersistError(
        `declaredBalances[${index}]: asOf no es una fecha YYYY-MM-DD: ${balance.asOf}`,
      )
    }
    const currency = balance.currency.trim().toUpperCase()
    if (currency !== accountCurrency) {
      throw new ImportPersistError(
        `declaredBalances[${index}]: el saldo viene en ${currency} y la cuenta está en ${accountCurrency}.`,
      )
    }
    const seen = byDate.get(balance.asOf)
    if (seen !== undefined && seen.amount !== balance.amount) {
      throw new ImportPersistError(
        `El fichero declara dos saldos distintos para el ${balance.asOf}: ${seen.amount} y ${balance.amount}.`,
      )
    }
    byDate.set(balance.asOf, { asOf: balance.asOf, amount: balance.amount, currency })
  }

  const balances = [...byDate.values()]
  const dates = balances.map((balance) => balance.asOf)

  const { rows } = await client.query<{ as_of: string; amount: string }>(
    `select as_of::text as as_of, amount
       from declared_balance
      where account_id = $1 and as_of = any($2::date[])`,
    [input.accountId, dates],
  )
  for (const row of rows) {
    const incoming = byDate.get(row.as_of)
    if (incoming !== undefined && BigInt(row.amount) !== incoming.amount) {
      // Sobrescribirlo haría irreversible el lote que lo trajo, y callarlo
      // escondería que el banco se contradice. Se para la importación entera.
      throw new ImportPersistError(
        `El saldo declarado para el ${row.as_of} ya está guardado como ${row.amount} y este ` +
          `fichero dice ${incoming.amount}. Revisá cuál de los dos extractos es el bueno.`,
      )
    }
  }

  await client.query(
    `insert into declared_balance (tenant_id, account_id, as_of, amount, currency, import_batch_id)
     select $1::uuid, $2::uuid, b.as_of, b.amount, b.currency, $3::uuid
       from unnest($4::date[], $5::bigint[], $6::text[]) as b(as_of, amount, currency)
     on conflict (account_id, as_of) do nothing`,
    [
      tenantId,
      input.accountId,
      batchId,
      dates,
      balances.map((balance) => balance.amount.toString()),
      balances.map((balance) => balance.currency),
    ],
  )
}

/**
 * JSON para una columna jsonb, con los bigint como string decimal.
 *
 * `JSON.stringify` lanza ante un bigint, así que un informe con importes sin
 * serializar rompería la importación en el último paso, después de haber
 * escrito todo lo demás.
 */
function toJsonb(value: unknown): string {
  return (
    JSON.stringify(value ?? null, (_key, raw) =>
      typeof raw === 'bigint' ? raw.toString() : raw,
    ) ?? 'null'
  )
}
