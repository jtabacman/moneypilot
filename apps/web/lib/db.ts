/**
 * Acceso a la base desde la aplicación web, siempre con alcance de hogar.
 *
 * Exporta una sola función de lectura y escritura: `withHousehold`. No hay una
 * variante "sin alcance" a propósito — si existiera, alguien la usaría por
 * comodidad un martes a las siete de la tarde y el aislamiento se acabaría ahí.
 */

import 'server-only'

import { createPool, type Db, type TenantClient, withTenant, withUserScope } from '@moneypilot/db'
import { databaseUrl } from './env'

let pool: Db | null = null

function getPool(): Db {
  if (pool !== null) return pool
  pool = createPool({
    connectionString: databaseUrl(),
    // En serverless cada instancia mantiene su propio pool y hay muchas
    // instancias. Un máximo alto por instancia multiplica hasta agotar el
    // límite del pooler; el trabajo real lo hace el pooler de Supabase.
    max: 3,
    statementTimeoutMs: 10_000,
  })
  return pool
}

/**
 * Ejecuta `fn` dentro de una transacción con el hogar y el usuario fijados.
 *
 * Debajo hace tres cosas, y las tres importan: se degrada al rol sin
 * privilegios (si no, la conexión de Supabase se saltea RLS), fija
 * `app.tenant_id` y fija `app.user_id`. Todo con alcance de transacción, así
 * que nada sobrevive al reciclaje de la conexión.
 */
export async function withHousehold<T>(
  tenantId: string,
  userId: string,
  fn: (client: TenantClient) => Promise<T>,
): Promise<T> {
  return withTenant(getPool(), tenantId, fn, { userId })
}

/**
 * El mismo pool, con alcance de **usuario** y no de hogar.
 *
 * Lo necesita la resolución de sesión, que corre antes de saber a qué hogar
 * pertenece nadie. Antes se abría un pool nuevo cada vez y se destruía al
 * terminar: una conexión TCP y un handshake TLS contra Supabase por cada
 * página, dos o tres veces si la sesión se resolvía más de una vez. En local
 * eran dos milisegundos; contra Supabase desde Vercel, cientos.
 *
 * Reutilizar el pool no relaja el aislamiento: `withUserScope` degrada el rol y
 * fija `app.user_id` con alcance de transacción igual que antes, así que la
 * conexión vuelve al pool sin recordar de quién era.
 */
export async function withUser<T>(
  userId: string,
  fn: (client: TenantClient) => Promise<T>,
): Promise<T> {
  return withUserScope(getPool(), userId, fn)
}
