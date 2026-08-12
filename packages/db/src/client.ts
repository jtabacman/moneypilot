/**
 * Acceso a Postgres con alcance de hogar.
 *
 * Regla del módulo: **toda consulta a datos de un hogar corre dentro de
 * `withTenant`**. No hay una forma de leer la base sin declarar de quién son
 * los datos que se piden.
 *
 * El detalle que hace esto seguro es el tercer argumento de `set_config`:
 * `true` la hace **local a la transacción**, así que Postgres la descarta solo
 * al terminar. Con una variable de sesión, una conexión devuelta al pool con
 * el tenant de otro se convierte en una fuga de datos silenciosa, y es el tipo
 * de bug que aparece bajo carga y nunca en desarrollo.
 */

import pg from 'pg'
import { toClientConfig } from './connection.js'

export interface DbConfig {
  readonly connectionString: string
  readonly max?: number
  /** Corta consultas descontroladas: RLS aísla filas, no CPU. */
  readonly statementTimeoutMs?: number
}

export type Db = pg.Pool
export type TenantClient = pg.PoolClient

export function createPool(config: DbConfig): Db {
  return new pg.Pool({
    // Campos sueltos y no `connectionString`: cuando `pg` recibe la cadena,
    // el `sslmode` que trae dentro pisa la configuración de TLS explícita.
    // Ver el comentario largo en connection.ts.
    ...toClientConfig(config.connectionString),
    max: config.max ?? 10,
    // Un tenant con una consulta pesada no puede degradar a los demás.
    statement_timeout: config.statementTimeoutMs ?? 15_000,
    application_name: 'moneypilot',
  })
}

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TenantScopeError'
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Abre una transacción con `app.tenant_id` fijado y ejecuta `fn` dentro.
 *
 * Confirma si `fn` termina bien y revierte si lanza. En ambos casos la
 * variable desaparece con la transacción.
 */
export interface TenantScopeOptions {
  /**
   * Rol al que degradarse dentro de la transacción. `null` lo desactiva, y
   * eso sólo es correcto cuando la conexión YA entra con un rol sin
   * privilegios, como en los tests locales contra Docker.
   */
  readonly role?: string | null
  /** Usuario autenticado, para las policies que filtran por persona. */
  readonly userId?: string
}

export async function withTenant<T>(
  db: Db,
  tenantId: string,
  fn: (client: TenantClient) => Promise<T>,
  options: TenantScopeOptions = {},
): Promise<T> {
  if (!UUID_RE.test(tenantId)) {
    // Validar antes de llegar a la base: un tenantId inválido tiene que ser un
    // error de programación ruidoso, no una consulta que devuelve cero filas y
    // parece que el hogar no tiene datos.
    throw new TenantScopeError(`tenantId inválido: ${JSON.stringify(tenantId)}`)
  }

  const client = await db.connect()
  try {
    await client.query('begin')
    // Degradarse a un rol sin privilegios ANTES de fijar el tenant.
    // Ver `assumeAppRole`: sin esto, en Supabase la conexión entra como
    // `postgres` —dueño de las tablas y con BYPASSRLS— y el aislamiento
    // entre hogares deja de aplicarse sin producir ningún error.
    await assumeAppRole(client, options.role)
    await client.query('select set_config($1, $2, true)', ['app.tenant_id', tenantId])
    if (options.userId !== undefined) {
      if (!UUID_RE.test(options.userId)) {
        throw new TenantScopeError(`userId inválido: ${JSON.stringify(options.userId)}`)
      }
      await client.query('select set_config($1, $2, true)', ['app.user_id', options.userId])
    }
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (error) {
    try {
      await client.query('rollback')
    } catch {
      // La transacción ya estaba abortada; el error original es el que importa.
    }
    throw error
  } finally {
    client.release()
  }
}

export const DEFAULT_APP_ROLE = 'moneypilot_app'

/** Sólo identificadores simples: el nombre del rol se interpola, no se parametriza. */
const ROLE_RE = /^[a-z_][a-z0-9_]*$/

/**
 * Cambia el rol efectivo de la transacción a uno sin privilegios.
 *
 * Existe por una razón concreta y peligrosa: la cadena de conexión que da
 * Supabase entra como `postgres`, que es **dueño de las tablas y tiene
 * BYPASSRLS**. Conectando así, las policies de aislamiento no se aplican, y no
 * hay ningún error que lo delate: cada hogar vería el dinero de los demás.
 *
 * `set local role` dura hasta el commit, igual que `app.tenant_id`, así que
 * una conexión devuelta al pool nunca arrastra privilegios de la anterior.
 *
 * Si el rol no existe o la conexión no es miembro de él, esto falla — y que
 * falle es lo correcto. La alternativa sería servir datos sin aislamiento.
 */
export async function assumeAppRole(
  client: TenantClient,
  role: string | null | undefined = DEFAULT_APP_ROLE,
): Promise<void> {
  if (role === null) return
  const name = role ?? DEFAULT_APP_ROLE
  if (!ROLE_RE.test(name)) {
    throw new TenantScopeError(`Nombre de rol inválido: ${JSON.stringify(name)}`)
  }
  try {
    await client.query(`set local role ${name}`)
  } catch (error) {
    throw new TenantScopeError(
      `No se pudo asumir el rol ${name}, así que Row Level Security no se aplicaría. ` +
        'Ejecutá las migraciones (crean el rol y otorgan la membresía) o pasá role: null ' +
        `si la conexión ya entra sin privilegios. Causa: ${(error as Error).message}`,
    )
  }
}

/**
 * ¿La conexión actual puede saltarse RLS?
 *
 * Sirve para negarse a arrancar en vez de servir datos sin aislamiento. Un
 * `true` acá significa que las policies son decorativas.
 */
export async function bypassesRls(db: Db): Promise<boolean> {
  const client = await db.connect()
  try {
    const { rows } = await client.query<{
      bypass: boolean
      superuser: boolean
    }>(
      `select rolbypassrls as bypass, rolsuper as superuser
         from pg_roles where rolname = current_user`,
    )
    return rows[0]?.bypass === true || rows[0]?.superuser === true
  } finally {
    client.release()
  }
}

/**
 * Para operaciones que no pertenecen a ningún hogar: migraciones, tipos de
 * cambio, alta del primer tenant. Se nombra así de largo a propósito — cada
 * uso es una excepción que hay que poder justificar en una revisión.
 */
export async function withoutTenantScope<T>(
  db: Db,
  fn: (client: TenantClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect()
  try {
    return await fn(client)
  } finally {
    client.release()
  }
}

/**
 * Alcance de **persona** sin alcance de hogar: para el único momento en que
 * alguien está autenticado pero todavía no sabemos a qué hogar pertenece.
 *
 * Es el caso de la pantalla de entrada. Se podría resolver con
 * `withoutTenantScope` y un `where user_id = $1`, y funcionaría — pero en
 * Supabase esa conexión entra como `postgres`, que se saltea RLS, y entonces
 * lo único que separa a un hogar de otro es que ese `where` esté bien
 * escrito. Acá, en cambio, el filtro lo aplica la policy `membership_own`:
 * aunque la consulta se olvide la condición, Postgres no devuelve de más.
 *
 * `provision_household` sigue funcionando porque es SECURITY DEFINER: crea el
 * hogar y la membresía por encima de RLS, que es justamente su razón de ser.
 */
export async function withUserScope<T>(
  db: Db,
  userId: string,
  fn: (client: TenantClient) => Promise<T>,
  options: Pick<TenantScopeOptions, 'role'> = {},
): Promise<T> {
  if (!UUID_RE.test(userId)) {
    throw new TenantScopeError(`userId inválido: ${JSON.stringify(userId)}`)
  }

  const client = await db.connect()
  try {
    await client.query('begin')
    await assumeAppRole(client, options.role)
    await client.query('select set_config($1, $2, true)', ['app.user_id', userId])
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (error) {
    try {
      await client.query('rollback')
    } catch {
      // La transacción ya estaba abortada; el error original es el que importa.
    }
    throw error
  } finally {
    client.release()
  }
}
