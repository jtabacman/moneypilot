/**
 * La sesión de la aplicación: quién sos y a qué hogar pertenecés.
 *
 * Supabase Auth responde lo primero. Lo segundo es nuestro, y la primera vez
 * que alguien entra hay que crearlo.
 */

import 'server-only'

import { createPool, withUserScope } from '@moneypilot/db'
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
 * Estar autenticado y tener acceso son cosas distintas.
 *
 * El producto promete delegar acceso al contador o al asistente **con fecha de
 * caducidad**. Si eso se resolviera devolviendo simplemente "no hay sesión",
 * quien caducó vería la pantalla de entrar, se autenticaría bien, y volvería a
 * la pantalla de entrar sin ninguna explicación. Peor todavía: sin distinguir
 * los dos casos, el código de más abajo le crearía un hogar nuevo y vacío al
 * contador cuya colaboración terminó.
 */
export type SessionState =
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'expired'; readonly user: AuthUser }
  | { readonly kind: 'active'; readonly session: Session }

interface MembershipRow {
  readonly tenant_id: string
  readonly name: string | null
  readonly base_currency: string | null
  readonly role: string
  readonly activa: boolean
}

/**
 * Resuelve el estado completo.
 *
 * El alta del hogar ocurre acá, en el primer acceso, y no en el registro. La
 * razón es concreta: con confirmación por correo, entre "me registré" y "entré"
 * pueden pasar días y otro dispositivo. Colgar la creación del hogar del
 * registro deja usuarios confirmados sin hogar, y eso se arregla a mano.
 *
 * `provision_household` es idempotente, así que llamarla en cada primer acceso
 * es correcto aunque sea innecesario a partir de la segunda vez.
 */
export async function resolveSession(): Promise<SessionState> {
  const user = await currentUser()
  if (user === null) return { kind: 'anonymous' }

  // Sin hogar todavía, pero con persona: `withUserScope` degrada el rol y
  // fija `app.user_id`, así que la policy `membership_own` filtra en la base y
  // no depende de que el `where` de abajo esté bien escrito.
  const pool = createPool({ connectionString: databaseUrl(), max: 2 })

  try {
    return await withUserScope(pool, user.id, async (client) => {
      // Se piden también las caducadas, y se ordena poniendo las activas
      // primero. Traer sólo las activas haría indistinguibles "nunca tuvo
      // hogar" y "se le acabó el acceso", que llevan a acciones opuestas.
      const { rows } = await client.query<MembershipRow>(
        `select m.tenant_id,
                t.name,
                t.base_currency,
                m.role,
                (m.expires_at is null or m.expires_at > now()) as activa
           from membership m
           left join tenant t on t.id = m.tenant_id
          where m.user_id = $1
            and m.revoked_at is null
          order by activa desc, m.created_at
          limit 1`,
        [user.id],
      )

      const found = rows[0]

      if (found !== undefined && !found.activa) return { kind: 'expired', user } as const

      if (found !== undefined) {
        return {
          kind: 'active',
          session: {
            user,
            tenantId: found.tenant_id,
            // `left join`: si la policy de tenant no dejara ver la fila, es
            // preferible una sesión con el nombre en blanco que ninguna.
            householdName: found.name ?? 'Mi hogar',
            baseCurrency: found.base_currency ?? 'EUR',
            role: found.role,
          },
        } as const
      }

      const created = await client.query<{ provision_household: string }>(
        'select provision_household($1, $2, $3, $4)',
        [user.id, user.email, defaultHouseholdName(user.email), 'EUR'],
      )
      const tenantId = created.rows[0]?.provision_household
      if (tenantId === undefined) throw new Error('No se pudo crear el hogar.')

      return {
        kind: 'active',
        session: {
          user,
          tenantId,
          householdName: defaultHouseholdName(user.email),
          baseCurrency: 'EUR',
          role: 'titular',
        },
      } as const
    })
  } finally {
    await pool.end()
  }
}

/** Atajo para las pantallas a las que sólo les importa si hay sesión. */
export async function currentSession(): Promise<Session | null> {
  const state = await resolveSession()
  return state.kind === 'active' ? state.session : null
}

function defaultHouseholdName(email: string | null): string {
  if (email === null) return 'Mi hogar'
  const local = email.split('@')[0] ?? ''
  return local === '' ? 'Mi hogar' : `Hogar de ${local}`
}
