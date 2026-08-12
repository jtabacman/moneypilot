/**
 * La sesión de la aplicación: quién sos y a qué hogar pertenecés.
 *
 * Supabase Auth responde lo primero. Lo segundo es nuestro, y la primera vez
 * que alguien entra hay que crearlo.
 */

import 'server-only'

import { createPool, withoutTenantScope } from '@moneypilot/db'
import { databaseUrl } from './env'
import { type AuthUser, currentUser } from './supabase/server'

export interface Session {
  readonly user: AuthUser
  readonly tenantId: string
  readonly householdName: string
  readonly baseCurrency: string
  readonly role: string
}

/**
 * Sesión completa, o null si no hay nadie autenticado.
 *
 * El alta del hogar ocurre acá, en el primer acceso, y no en el registro. La
 * razón es concreta: con confirmación por email, entre "me registré" y "entré"
 * pueden pasar días y otro dispositivo. Colgar la creación del hogar del
 * registro deja usuarios confirmados sin hogar, y eso se arregla a mano.
 *
 * `provision_household` es idempotente, así que llamarla en cada petición es
 * correcto aunque sea innecesario a partir de la segunda.
 */
export async function currentSession(): Promise<Session | null> {
  const user = await currentUser()
  if (user === null) return null

  // El alta del primer hogar es de las poquísimas operaciones legítimamente
  // fuera de alcance: todavía no hay hogar al que pertenecer.
  const pool = createPool({ connectionString: databaseUrl(), max: 2 })

  try {
    return await withoutTenantScope(pool, async (client) => {
      const { rows } = await client.query<{
        tenant_id: string
        name: string
        base_currency: string
        role: string
      }>(
        `select t.id as tenant_id, t.name, t.base_currency, m.role
           from membership m
           join tenant t on t.id = m.tenant_id
          where m.user_id = $1 and m.revoked_at is null
          limit 1`,
        [user.id],
      )

      const existing = rows[0]
      if (existing !== undefined) {
        return {
          user,
          tenantId: existing.tenant_id,
          householdName: existing.name,
          baseCurrency: existing.base_currency,
          role: existing.role,
        }
      }

      const created = await client.query<{ provision_household: string }>(
        'select provision_household($1, $2, $3, $4)',
        [user.id, user.email, defaultHouseholdName(user.email), 'EUR'],
      )
      const tenantId = created.rows[0]?.provision_household
      if (tenantId === undefined) throw new Error('No se pudo crear el hogar.')

      return {
        user,
        tenantId,
        householdName: defaultHouseholdName(user.email),
        baseCurrency: 'EUR',
        role: 'titular',
      }
    })
  } finally {
    await pool.end()
  }
}

function defaultHouseholdName(email: string | null): string {
  if (email === null) return 'Mi hogar'
  const local = email.split('@')[0] ?? ''
  return local === '' ? 'Mi hogar' : `Hogar de ${local}`
}
