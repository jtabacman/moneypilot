/**
 * Acceso a la base desde la aplicación web, siempre con alcance de hogar.
 *
 * Exporta una sola función de lectura y escritura: `withHousehold`. No hay una
 * variante "sin alcance" a propósito — si existiera, alguien la usaría por
 * comodidad un martes a las siete de la tarde y el aislamiento se acabaría ahí.
 */

import 'server-only'

import { createPool, type Db, type TenantClient, withTenant } from '@moneypilot/db'
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
