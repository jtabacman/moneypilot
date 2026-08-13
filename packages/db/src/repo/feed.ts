/**
 * El cableado de un feed de agregador: quiénes somos ante el proveedor, qué
 * conexiones abrimos y qué cuenta suya alimenta qué cuenta nuestra.
 *
 * Lo que **no** hay acá es tan importante como lo que hay: ni un movimiento ni
 * un saldo. Un feed es una fuente de entrada al libro, no un sustituto del
 * libro — lo que trae entra por `persistImport` igual que un OFX, con sus
 * asientos balanceados y su lote reversible. Este módulo sólo guarda el
 * estado que hace falta para poder volver a preguntar.
 *
 * Todo es agnóstico del proveedor a propósito. La única palabra que sabe de
 * finAPI en este paquete es el valor del enum; el resto —los nombres de los
 * campos de su API, sus fechas, sus estados de formulario— vive en la capa que
 * habla por la red, que es la que hay que reescribir el día que cambie.
 */

import type { TenantClient } from '../client.js'
import type { AccountKind } from './read-ledger.js'

/**
 * Los proveedores que existen, y el mismo valor que el enum de la base.
 *
 * Es una unión y no un `string` porque lo que distingue a un feed de otro no
 * es sólo la red: cada uno tiene su convenio de signo, su idea de qué es una
 * conexión y su forma de decir "esto ya lo mandé". El compilador tiene que
 * poder pedir que se declare cuál es.
 */
export type FeedProvider = 'finapi' | 'plaid'

export class FeedRepoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FeedRepoError'
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Sufijos que se prueban cuando el nombre preferido de una cuenta ya existe.
 * Ver `ensureLedgerAccount`: el tope existe para que un bug no se convierta en
 * un bucle infinito contra la base.
 */
const MAX_INTENTOS_DE_NOMBRE = 50

async function currentTenant(client: TenantClient): Promise<string> {
  const { rows } = await client.query<{ tenant_id: string | null }>(
    'select app_current_tenant() as tenant_id',
  )
  const tenantId = rows[0]?.tenant_id ?? null
  if (tenantId === null) {
    throw new FeedRepoError(
      'No hay hogar fijado en la transacción: el repositorio del feed tiene que correr dentro de withTenant.',
    )
  }
  return tenantId
}

/* ── Usuario del hogar en el proveedor ────────────────────────────────────── */

export interface FeedUserRow {
  readonly provider: FeedProvider
  /** El identificador del usuario en el proveedor. Lo genera él, no nosotros. */
  readonly externalId: string
  /**
   * La contraseña de ese usuario. Ver el comentario largo de la migración 008:
   * no son las credenciales del banco —ésas nunca pasan por acá— y hoy se
   * guarda en claro, protegida sólo por RLS y por el rol sin privilegios.
   */
  readonly accessSecret: string
  readonly createdAt: string
}

export async function readFeedUser(
  client: TenantClient,
  provider: FeedProvider,
): Promise<FeedUserRow | null> {
  const { rows } = await client.query<{
    provider: FeedProvider
    external_id: string
    access_secret: string
    created_at: Date
  }>(
    `select provider::text as provider, external_id, access_secret, created_at
       from feed_user
      where provider = $1::feed_provider`,
    [provider],
  )
  const row = rows[0]
  if (row === undefined) return null
  return {
    provider: row.provider,
    externalId: row.external_id,
    accessSecret: row.access_secret,
    createdAt: row.created_at.toISOString(),
  }
}

export interface SaveFeedUserInput {
  readonly provider: FeedProvider
  readonly externalId: string
  readonly accessSecret: string
}

/**
 * Guarda el usuario del hogar, **sin pisar** uno que ya existiera.
 *
 * El `do nothing` no es prudencia genérica: el identificador de un usuario del
 * proveedor es la llave de todos sus datos bancarios allá, y sobrescribirlo
 * con otro deja las conexiones anteriores vivas y sin dueño conocido — nadie
 * podría volver a leerlas ni borrarlas.
 *
 * Devuelve la fila que quedó guardada, que puede no ser la que se pasó. Quien
 * llama tiene que comparar: si difiere, acaba de crear un usuario huérfano en
 * el proveedor y le corresponde borrarlo.
 */
export async function saveFeedUser(
  client: TenantClient,
  input: SaveFeedUserInput,
): Promise<FeedUserRow> {
  const tenantId = await currentTenant(client)
  await client.query(
    `insert into feed_user (tenant_id, provider, external_id, access_secret)
     values ($1, $2::feed_provider, $3, $4)
     on conflict (tenant_id, provider) do nothing`,
    [tenantId, input.provider, input.externalId, input.accessSecret],
  )
  const stored = await readFeedUser(client, input.provider)
  if (stored === null) {
    throw new FeedRepoError(
      `El usuario de ${input.provider} no quedó guardado y tampoco había uno previo.`,
    )
  }
  return stored
}

/**
 * Olvida el usuario del hogar. Borrar el usuario **en el proveedor** es cosa
 * de la capa de red y va antes: si se hiciera al revés, un fallo dejaría los
 * datos bancarios vivos allá sin nada nuestro que apunte a ellos.
 */
export async function deleteFeedUser(
  client: TenantClient,
  provider: FeedProvider,
): Promise<boolean> {
  const result = await client.query('delete from feed_user where provider = $1::feed_provider', [
    provider,
  ])
  return (result.rowCount ?? 0) > 0
}

/* ── Conexiones ───────────────────────────────────────────────────────────── */

export interface FeedConnectionRow {
  readonly id: string
  readonly provider: FeedProvider
  readonly bankId: string
  readonly bankName: string
  /**
   * El formulario web del agregador. `null` en los proveedores que no tienen
   * ninguno: Plaid autentica dentro de su propio widget y no deja nada que se
   * pueda volver a sondear. Ver la migración 009.
   */
  readonly webFormId: string | null
  readonly bankConnectionId: string | null
  /** El item de Plaid. `null` en finAPI, que no tiene ese concepto. */
  readonly itemId: string | null
  /**
   * El cursor de la última sincronización incremental. `null` mientras no haya
   * habido ninguna, que se lee como "traé todo el histórico".
   *
   * **Nunca lo escribe quien no acaba de asentar lo que el cursor deja atrás.**
   * Ver `saveSyncCursor`.
   */
  readonly syncCursor: string | null
  /** Lo que dice el proveedor, sin traducir. Ver la migración 008. */
  readonly status: string
  readonly errorDetail: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

interface ConnectionDbRow {
  id: string
  provider: FeedProvider
  bank_id: string
  bank_name: string
  web_form_id: string | null
  bank_connection_id: string | null
  item_id: string | null
  sync_cursor: string | null
  status: string
  error_detail: string | null
  created_at: Date
  updated_at: Date
}

/**
 * `access_secret` NO está en esta lista, y no es un olvido.
 *
 * Una `FeedConnectionRow` viaja hasta la pantalla —`/importar` la lee y le
 * pasa los campos a un componente de cliente—, así que todo lo que esté acá
 * dentro es un candidato a acabar en el navegador el día que alguien añada un
 * campo al mapeo de props. La credencial se lee aparte y a propósito, con
 * `readConnectionSecret`, desde el único sitio que la necesita.
 */
const CONNECTION_COLUMNS = `id, provider::text as provider, bank_id, bank_name, web_form_id,
                            bank_connection_id, item_id, sync_cursor, status, error_detail,
                            created_at, updated_at`

function toConnection(row: ConnectionDbRow): FeedConnectionRow {
  return {
    id: row.id,
    provider: row.provider,
    bankId: row.bank_id,
    bankName: row.bank_name,
    webFormId: row.web_form_id,
    bankConnectionId: row.bank_connection_id,
    itemId: row.item_id,
    syncCursor: row.sync_cursor,
    status: row.status,
    errorDetail: row.error_detail,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

export interface RecordConnectionInput {
  readonly provider: FeedProvider
  readonly bankId: string
  readonly bankName: string
  /**
   * Obligatorio en finAPI —la base lo exige con un check— y ausente en Plaid.
   * Ver la migración 009.
   */
  readonly webFormId?: string | null
  /** El item de Plaid, conocido ya al canjear el token público. */
  readonly itemId?: string | null
  /**
   * La credencial de larga duración de esta conexión. En Plaid es el
   * `access_token`, que no caduca; en finAPI no hay ninguna, porque el secreto
   * es del usuario del hogar y vive en `feed_user`.
   */
  readonly accessSecret?: string | null
  readonly status: string
}

export async function recordConnection(
  client: TenantClient,
  input: RecordConnectionInput,
): Promise<FeedConnectionRow> {
  const tenantId = await currentTenant(client)
  const { rows } = await client.query<ConnectionDbRow>(
    `insert into feed_connection
       (tenant_id, provider, bank_id, bank_name, web_form_id, item_id, access_secret, status)
     values ($1, $2::feed_provider, $3, $4, $5, $6, $7, $8)
     returning ${CONNECTION_COLUMNS}`,
    [
      tenantId,
      input.provider,
      input.bankId,
      input.bankName,
      input.webFormId ?? null,
      input.itemId ?? null,
      input.accessSecret ?? null,
      input.status,
    ],
  )
  const row = rows[0]
  if (row === undefined) {
    throw new FeedRepoError(`No se pudo registrar la conexión con ${input.bankName}.`)
  }
  return toConnection(row)
}

/**
 * La credencial de la conexión, y nada más.
 *
 * Es una función aparte para que el secreto no viaje dentro de la fila que se
 * lee en todas partes: ver el comentario de `CONNECTION_COLUMNS`. Quien la
 * llama tiene una sola razón para hacerlo —salir a la red por esa conexión— y
 * no debe guardarla en ningún sitio ni escribirla en un log.
 */
export async function readConnectionSecret(
  client: TenantClient,
  connectionId: string,
): Promise<string | null> {
  if (!UUID_RE.test(connectionId)) return null
  const { rows } = await client.query<{ access_secret: string | null }>(
    'select access_secret from feed_connection where id = $1',
    [connectionId],
  )
  const secreto = rows[0]?.access_secret ?? null
  return secreto === null || secreto.trim() === '' ? null : secreto
}

export interface SaveSyncCursorInput {
  readonly id: string
  /** El cursor que devolvió la última página leída. */
  readonly cursor: string
}

/**
 * Guarda el cursor de sincronización incremental de una conexión.
 *
 * **Sólo se llama en la misma transacción que asienta lo que ese cursor deja
 * atrás**, y de ahí que sea una función suelta y no un campo más de
 * `updateConnection`: escribirlo antes de que los movimientos estén en el
 * libro los pierde para siempre, porque el proveedor no los vuelve a mandar.
 * El error inverso es inofensivo: un cursor que se queda corto hace que la
 * próxima sincronización repita lo ya traído, y eso lo absorbe el dedup.
 *
 * La cadena vacía se guarda como `null`: es lo que Plaid devuelve mientras el
 * item todavía no tiene nada que contar, y significa exactamente lo mismo que
 * no tener cursor.
 */
export async function saveSyncCursor(
  client: TenantClient,
  input: SaveSyncCursorInput,
): Promise<void> {
  if (!UUID_RE.test(input.id)) {
    throw new FeedRepoError(`id de conexión inválido: ${JSON.stringify(input.id)}`)
  }
  const cursor = input.cursor.trim() === '' ? null : input.cursor
  const result = await client.query(
    'update feed_connection set sync_cursor = $2, updated_at = now() where id = $1',
    [input.id, cursor],
  )
  if ((result.rowCount ?? 0) === 0) {
    // Con RLS, la conexión de otro hogar es indistinguible de una inexistente.
    throw new FeedRepoError(`La conexión ${input.id} no existe en este hogar.`)
  }
}

export interface UpdateConnectionInput {
  readonly id: string
  readonly status: string
  /** Sin declarar, se conserva el que hubiera: un sondeo no borra lo que sabe. */
  readonly bankConnectionId?: string | null
  readonly errorDetail?: string | null
}

export async function updateConnection(
  client: TenantClient,
  input: UpdateConnectionInput,
): Promise<FeedConnectionRow> {
  if (!UUID_RE.test(input.id)) {
    throw new FeedRepoError(`id de conexión inválido: ${JSON.stringify(input.id)}`)
  }
  const { rows } = await client.query<ConnectionDbRow>(
    // `coalesce($3, bank_connection_id)` y no una asignación directa: un sondeo
    // que llega antes de que el proveedor rellene el identificador no puede
    // borrar el que ya teníamos de un sondeo anterior.
    `update feed_connection
        set status = $2,
            bank_connection_id = coalesce($3, bank_connection_id),
            error_detail = $4,
            updated_at = now()
      where id = $1
      returning ${CONNECTION_COLUMNS}`,
    [input.id, input.status, input.bankConnectionId ?? null, input.errorDetail ?? null],
  )
  const row = rows[0]
  if (row === undefined) {
    // Con RLS, la conexión de otro hogar es indistinguible de una inexistente.
    throw new FeedRepoError(`La conexión ${input.id} no existe en este hogar.`)
  }
  return toConnection(row)
}

export async function readConnection(
  client: TenantClient,
  id: string,
): Promise<FeedConnectionRow | null> {
  if (!UUID_RE.test(id)) return null
  const { rows } = await client.query<ConnectionDbRow>(
    `select ${CONNECTION_COLUMNS} from feed_connection where id = $1`,
    [id],
  )
  const row = rows[0]
  return row === undefined ? null : toConnection(row)
}

export async function listConnections(
  client: TenantClient,
  provider: FeedProvider,
): Promise<FeedConnectionRow[]> {
  const { rows } = await client.query<ConnectionDbRow>(
    `select ${CONNECTION_COLUMNS}
       from feed_connection
      where provider = $1::feed_provider
      order by created_at desc, id desc`,
    [provider],
  )
  return rows.map(toConnection)
}

/* ── Cuentas ──────────────────────────────────────────────────────────────── */

export interface FeedAccountRow {
  readonly provider: FeedProvider
  readonly externalAccountId: string
  readonly accountId: string
  readonly connectionId: string | null
  readonly lastSyncedAt: string | null
}

interface FeedAccountDbRow {
  provider: FeedProvider
  external_account_id: string
  account_id: string
  connection_id: string | null
  last_synced_at: Date | null
}

function toFeedAccount(row: FeedAccountDbRow): FeedAccountRow {
  return {
    provider: row.provider,
    externalAccountId: row.external_account_id,
    accountId: row.account_id,
    connectionId: row.connection_id,
    lastSyncedAt: row.last_synced_at === null ? null : row.last_synced_at.toISOString(),
  }
}

export async function listFeedAccounts(
  client: TenantClient,
  provider: FeedProvider,
): Promise<FeedAccountRow[]> {
  const { rows } = await client.query<FeedAccountDbRow>(
    `select provider::text as provider, external_account_id, account_id, connection_id,
            last_synced_at
       from feed_account
      where provider = $1::feed_provider
      order by external_account_id`,
    [provider],
  )
  return rows.map(toFeedAccount)
}

export interface EnsureLedgerAccountInput {
  readonly provider: FeedProvider
  /** El identificador de la cuenta EN EL PROVEEDOR. Nunca el nuestro. */
  readonly externalAccountId: string
  readonly connectionId?: string | null
  /** Nombre preferido. Si ya existe otra cuenta con él, se desambigua. */
  readonly name: string
  readonly kind: AccountKind
  readonly currency: string
  readonly institution?: string | null
  /** Ya enmascarado por el mapeador. El número completo no entra al sistema. */
  readonly accountNumber?: string | null
  readonly country?: string | null
}

export interface EnsureLedgerAccountResult {
  readonly accountId: string
  /** true si esta llamada creó la cuenta del libro. */
  readonly created: boolean
  /** El nombre con el que quedó, que puede no ser el pedido. */
  readonly name: string
}

/**
 * La cuenta del libro que corresponde a una cuenta del proveedor, creándola si
 * no existe, y el enlace entre las dos.
 *
 * Dos decisiones:
 *
 *  1. **El enlace manda sobre el nombre y sobre el IBAN.** Una vez creada la
 *     cuenta, esta función no vuelve a tocarla: si alguien la renombró de
 *     "Girokonto" a "Cuenta de la sociedad", la próxima sincronización
 *     respeta ese nombre. Pisarlo con lo que diga el banco convertiría una
 *     decisión del usuario en un dato volátil del agregador.
 *
 *  2. **Un choque de nombre desambigua, no falla ni reutiliza.** Reutilizar
 *     una cuenta existente que se llama igual mezclaría dos cuentas
 *     distintas —y el saldo resultante no sería el de ninguna—; fallar
 *     dejaría la sincronización muerta por un nombre. Se crea con un sufijo
 *     que dice de dónde salió.
 *
 * El nombre libre se busca leyendo antes de insertar y no capturando la
 * violación de unicidad: en Postgres una sentencia fallida aborta la
 * transacción entera, así que "intentar y ver" se llevaría por delante todo lo
 * escrito hasta ese punto.
 */
export async function ensureLedgerAccount(
  client: TenantClient,
  input: EnsureLedgerAccountInput,
): Promise<EnsureLedgerAccountResult> {
  const tenantId = await currentTenant(client)

  const { rows: enlazadas } = await client.query<{ account_id: string; name: string }>(
    `select fa.account_id, a.name
       from feed_account fa
       join account a on a.id = fa.account_id
      where fa.provider = $1::feed_provider and fa.external_account_id = $2`,
    [input.provider, input.externalAccountId],
  )
  const enlazada = enlazadas[0]
  if (enlazada !== undefined) {
    // El enlace ya existía: sólo se refresca de qué conexión vino, que es lo
    // único que puede cambiar legítimamente (reconectar el mismo banco).
    if (input.connectionId !== undefined && input.connectionId !== null) {
      await client.query(
        `update feed_account set connection_id = $3
          where provider = $1::feed_provider and external_account_id = $2`,
        [input.provider, input.externalAccountId, input.connectionId],
      )
    }
    return { accountId: enlazada.account_id, created: false, name: enlazada.name }
  }

  const name = await freeAccountName(client, input)

  const { rows: creadas } = await client.query<{ id: string }>(
    `insert into account (tenant_id, kind, name, currency, institution, account_number, country)
     values ($1, $2::account_kind, $3, $4, $5, $6, $7)
     returning id`,
    [
      tenantId,
      input.kind,
      name,
      input.currency.trim().toUpperCase(),
      input.institution ?? null,
      input.accountNumber ?? null,
      input.country ?? null,
    ],
  )
  const accountId = creadas[0]?.id
  if (accountId === undefined) {
    throw new FeedRepoError(`No se pudo crear la cuenta "${name}" para el feed.`)
  }

  await client.query(
    `insert into feed_account
       (tenant_id, provider, external_account_id, account_id, connection_id)
     values ($1, $2::feed_provider, $3, $4, $5)`,
    [tenantId, input.provider, input.externalAccountId, accountId, input.connectionId ?? null],
  )

  return { accountId, created: true, name }
}

async function freeAccountName(
  client: TenantClient,
  input: EnsureLedgerAccountInput,
): Promise<string> {
  const base = input.name.trim() === '' ? `Cuenta ${input.externalAccountId}` : input.name.trim()
  const candidatos = [base, `${base} (${input.provider} ${input.externalAccountId})`]
  for (let n = 2; candidatos.length < MAX_INTENTOS_DE_NOMBRE; n += 1) {
    candidatos.push(`${base} (${input.provider} ${input.externalAccountId} · ${n})`)
  }

  const { rows } = await client.query<{ name: string }>(
    'select name from account where name = any($1::text[])',
    [candidatos],
  )
  const ocupados = new Set(rows.map((row) => row.name))
  const libre = candidatos.find((candidato) => !ocupados.has(candidato))
  if (libre === undefined) {
    throw new FeedRepoError(
      `El hogar ya tiene ${MAX_INTENTOS_DE_NOMBRE} cuentas cuyo nombre empieza por "${base}". ` +
        'Renombrá alguna antes de conectar ésta.',
    )
  }
  return libre
}

/** Marca que la cuenta terminó bien una sincronización. Informativo. */
export async function markFeedAccountSynced(
  client: TenantClient,
  provider: FeedProvider,
  externalAccountId: string,
): Promise<void> {
  await client.query(
    `update feed_account set last_synced_at = now()
      where provider = $1::feed_provider and external_account_id = $2`,
    [provider, externalAccountId],
  )
}
