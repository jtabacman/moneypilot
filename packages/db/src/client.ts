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
    connectionString: config.connectionString,
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
export async function withTenant<T>(
  db: Db,
  tenantId: string,
  fn: (client: TenantClient) => Promise<T>,
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
    await client.query('select set_config($1, $2, true)', ['app.tenant_id', tenantId])
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
