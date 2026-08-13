/**
 * El listado de personas de un hogar.
 *
 * Estos tests existen por una razón concreta: la policy que los hace posibles
 * consulta la misma tabla que protege, y esa forma se rompe con «infinite
 * recursion detected in policy for relation membership». La versión que está
 * en la migración 007 evita la recursión con una función SECURITY DEFINER,
 * pero eso es exactamente el tipo de arreglo que parece correcto leyéndolo y
 * sólo se puede confirmar ejecutándolo.
 *
 * El segundo test es el que importa de verdad: que abrir la tabla al hogar no
 * la haya abierto al de al lado.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPool, type Db, withoutTenantScope, withTenant } from './client.js'
import { migrate } from './migrate.js'

const ADMIN_URL = process.env['DATABASE_URL']
const APP_URL = process.env['DATABASE_APP_URL']
const enabled = ADMIN_URL !== undefined && APP_URL !== undefined
const suite = enabled ? describe : describe.skip

// Igual que el resto de la suite: la base es compartida y dos corridas
// simultáneas con nombres fijos se borran los datos entre sí.
const P = `#${process.pid}`
const cola = String(process.pid).padStart(12, '0').slice(-12)

const TITULAR = `aaaaaaaa-aaaa-4aaa-8aaa-${cola}`
const CONTADOR = `bbbbbbbb-bbbb-4bbb-8bbb-${cola}`
const VECINO = `cccccccc-cccc-4ccc-8ccc-${cola}`

suite('roster del hogar', () => {
  let admin: Db
  let app: Db
  let casa = ''
  let otraCasa = ''

  beforeAll(async () => {
    await migrate(ADMIN_URL as string)
    admin = createPool({ connectionString: ADMIN_URL as string })
    app = createPool({ connectionString: APP_URL as string })

    await withoutTenantScope(admin, async (client) => {
      await client.query('delete from membership where user_id = any($1::uuid[])', [
        [TITULAR, CONTADOR, VECINO],
      ])
      await client.query('delete from tenant where name = any($1::text[])', [
        [`Roster ${P}`, `Roster vecino ${P}`],
      ])

      const a = await client.query<{ id: string }>(
        "insert into tenant (name, base_currency) values ($1, 'EUR') returning id",
        [`Roster ${P}`],
      )
      const b = await client.query<{ id: string }>(
        "insert into tenant (name, base_currency) values ($1, 'EUR') returning id",
        [`Roster vecino ${P}`],
      )
      casa = a.rows[0]?.id as string
      otraCasa = b.rows[0]?.id as string

      await client.query(
        `insert into membership (tenant_id, user_id, role, email, expires_at)
         values ($1, $2, 'titular',  'titular@ejemplo',  null),
                ($1, $3, 'contador', 'contador@ejemplo', now() + interval '90 days'),
                ($4, $5, 'titular',  'vecino@ejemplo',   null)`,
        [casa, TITULAR, CONTADOR, otraCasa, VECINO],
      )
    })
  }, 60_000)

  afterAll(async () => {
    await withoutTenantScope(admin, async (client) => {
      await client.query('delete from membership where user_id = any($1::uuid[])', [
        [TITULAR, CONTADOR, VECINO],
      ])
      await client.query('delete from tenant where id = any($1::uuid[])', [[casa, otraCasa]])
    })
    await admin?.end()
    await app?.end()
  })

  it('el titular ve a todas las personas de su hogar, no sólo a sí mismo', async () => {
    const correos = await withTenant(
      app,
      casa,
      async (client) =>
        (
          await client.query<{ email: string }>('select email from membership order by email')
        ).rows.map((r) => r.email),
      { role: null, userId: TITULAR },
    )

    expect(correos).toEqual(['contador@ejemplo', 'titular@ejemplo'])
  })

  it('no ve a nadie del hogar de al lado', async () => {
    // El vecino existe y tiene su propia membresía: si apareciera acá, la
    // policy estaría abriendo la tabla entera en vez de un hogar.
    const filas = await withTenant(
      app,
      casa,
      async (client) =>
        (await client.query<{ email: string }>('select email from membership')).rows,
      { role: null, userId: TITULAR },
    )

    expect(filas.map((f) => f.email)).not.toContain('vecino@ejemplo')
  })

  it('el contador ve el hogar al que lo invitaron y nada más', async () => {
    const correos = await withTenant(
      app,
      casa,
      async (client) =>
        (
          await client.query<{ email: string }>('select email from membership order by email')
        ).rows.map((r) => r.email),
      { role: null, userId: CONTADOR },
    )

    expect(correos).toEqual(['contador@ejemplo', 'titular@ejemplo'])
  })

  it('quien no pertenece al hogar no ve ninguna fila', async () => {
    const filas = await withTenant(
      app,
      casa,
      async (client) => (await client.query('select email from membership')).rows,
      { role: null, userId: VECINO },
    )

    expect(filas).toEqual([])
  })

  it('con el acceso caducado seguís viendo tu propia fila, y sólo esa', async () => {
    // `membership_own` no mira la caducidad a propósito: es lo que permite
    // decirle a alguien "tu acceso caducó" en vez de tratarlo como a un
    // desconocido. Pero el roster sí la mira, así que deja de ver al resto.
    await withoutTenantScope(admin, async (client) => {
      await client.query(
        "update membership set expires_at = now() - interval '1 day' where user_id = $1",
        [CONTADOR],
      )
    })

    const correos = await withTenant(
      app,
      casa,
      async (client) =>
        (await client.query<{ email: string }>('select email from membership')).rows.map(
          (r) => r.email,
        ),
      { role: null, userId: CONTADOR },
    )

    expect(correos).toEqual(['contador@ejemplo'])

    await withoutTenantScope(admin, async (client) => {
      await client.query(
        "update membership set expires_at = now() + interval '90 days' where user_id = $1",
        [CONTADOR],
      )
    })
  })

  it('app_my_tenants no acepta que le pidan los hogares de otro', async () => {
    // Es SECURITY DEFINER, así que corre por encima de RLS. La única defensa
    // contra que devuelva de más es que no reciba parámetros: lee app.user_id
    // y nada más. Si alguien le añadiera un argumento, este test se cae.
    const { rows } = await withoutTenantScope(admin, async (client) =>
      client.query<{ n: number }>(
        `select count(*)::int as n
           from pg_proc p
           join pg_namespace ns on ns.oid = p.pronamespace
          where p.proname = 'app_my_tenants'
            and ns.nspname = 'public'
            and p.pronargs = 0`,
      ),
    )
    expect(rows[0]?.n).toBe(1)
  })
})
