/**
 * Prueba de que el aislamiento entre hogares funciona de verdad.
 *
 * Este es el test más importante del paquete, y existe porque **RLS mal
 * configurado no da ningún error**: simplemente no aísla. Los tres modos de
 * fallo silencioso son:
 *
 *   1. Olvidar `force row level security` — el dueño de la tabla queda exento
 *      de sus propias policies, y las migraciones corren con ese rol.
 *   2. Conectarse con un superusuario — Postgres ignora RLS, sin avisar.
 *   3. Olvidar fijar `app.tenant_id` — sin la comprobación, se ve todo.
 *
 * Ninguno rompe nada en desarrollo con un solo hogar cargado. Los tres son
 * catastróficos con dos.
 *
 * Necesita una base real. Sin DATABASE_URL los tests se saltan, para que
 * `pnpm test` siga corriendo en una máquina sin Docker.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPool, type Db, withoutTenantScope, withTenant } from './client.js'
import { migrate } from './migrate.js'

const ADMIN_URL = process.env['DATABASE_URL']
const APP_URL = process.env['DATABASE_APP_URL']
const enabled = ADMIN_URL !== undefined && APP_URL !== undefined

const suite = enabled ? describe : describe.skip

/**
 * Los nombres de hogar llevan el pid a propósito.
 *
 * El `beforeAll` borra por nombre antes de crear, así que con nombres fijos
 * dos corridas simultáneas contra la misma base se borran los hogares la una a
 * la otra a mitad de camino. Los fallos que salen de ahí parecen del código y
 * son del entorno, que es la peor clase de fallo intermitente.
 */
const NOMBRE_A = `Casa A #${process.pid}`
const NOMBRE_B = `Casa B #${process.pid}`

suite('aislamiento entre hogares', () => {
  let admin: Db
  let app: Db
  let casaA: string
  let casaB: string

  beforeAll(async () => {
    await migrate(ADMIN_URL as string)

    admin = createPool({ connectionString: ADMIN_URL as string })
    app = createPool({ connectionString: APP_URL as string })

    // El alta del primer hogar es una de las pocas operaciones legítimamente
    // fuera de alcance: todavía no hay tenant al que pertenecer.
    await withoutTenantScope(admin, async (client) => {
      await client.query('delete from tenant where name in ($1, $2)', [NOMBRE_A, NOMBRE_B])
      const a = await client.query<{ id: string }>(
        "insert into tenant (name, base_currency) values ($1, 'EUR') returning id",
        [NOMBRE_A],
      )
      const b = await client.query<{ id: string }>(
        "insert into tenant (name, base_currency) values ($1, 'USD') returning id",
        [NOMBRE_B],
      )
      casaA = a.rows[0]?.id as string
      casaB = b.rows[0]?.id as string

      await client.query(
        `insert into account (tenant_id, kind, name, currency)
         values ($1, 'asset', 'BBVA Corriente', 'EUR'), ($2, 'asset', 'Chase Checking', 'USD')`,
        [casaA, casaB],
      )
    })
  }, 60_000)

  afterAll(async () => {
    await admin?.end()
    await app?.end()
  })

  it('cada hogar ve sólo sus cuentas', async () => {
    const seenByA = await withTenant(app, casaA, async (client) =>
      (await client.query<{ name: string }>('select name from account')).rows.map((r) => r.name),
    )
    const seenByB = await withTenant(app, casaB, async (client) =>
      (await client.query<{ name: string }>('select name from account')).rows.map((r) => r.name),
    )

    expect(seenByA).toEqual(['BBVA Corriente'])
    expect(seenByB).toEqual(['Chase Checking'])
  })

  it('una consulta sin filtro explícito tampoco cruza el límite', async () => {
    // Este es el punto entero de RLS: la aplicación se olvidó el where y no
    // pasa nada, porque el filtro no vive en la aplicación.
    const rows = await withTenant(
      app,
      casaA,
      async (client) => (await client.query('select * from account')).rows,
    )
    expect(rows).toHaveLength(1)
  })

  it('no se puede escribir en el hogar de otro', async () => {
    await expect(
      withTenant(app, casaA, async (client) => {
        await client.query(
          "insert into account (tenant_id, kind, name, currency) values ($1, 'asset', 'Robada', 'USD')",
          [casaB],
        )
      }),
    ).rejects.toThrow(/row-level security/i)
  })

  it('sin tenant fijado no se ve absolutamente nada', async () => {
    // El comportamiento por defecto seguro: cero filas, no todas.
    const rows = await withoutTenantScope(
      app,
      async (client) => (await client.query('select * from account')).rows,
    )
    expect(rows).toHaveLength(0)
  })

  it('el rol de aplicación no es superusuario', async () => {
    // Si lo fuera, todo lo de arriba pasaría igual y no probaría nada:
    // Postgres ignora RLS para superusuarios, en silencio.
    const { rows } = await withoutTenantScope(app, async (client) =>
      client.query<{ usesuper: boolean }>(
        'select usesuper from pg_user where usename = current_user',
      ),
    )
    expect(rows[0]?.usesuper).toBe(false)
  })

  it('RLS está forzado, no sólo habilitado', async () => {
    // Sin `force`, el dueño de la tabla queda exento de sus propias policies.
    const { rows } = await withoutTenantScope(admin, async (client) =>
      client.query<{
        relname: string
        relrowsecurity: boolean
        relforcerowsecurity: boolean
      }>(
        `select relname, relrowsecurity, relforcerowsecurity
           from pg_class
          where relname in ('tenant','account','entry','posting','posting_dimension')
            and relkind = 'r'`,
      ),
    )
    expect(rows).toHaveLength(5)
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname}: RLS habilitado`).toBe(true)
      expect(row.relforcerowsecurity, `${row.relname}: RLS forzado`).toBe(true)
    }
  })

  it('la variable de tenant no sobrevive a la transacción', async () => {
    // Es lo que impide que una conexión devuelta al pool arrastre el hogar
    // anterior. Con una variable de sesión, esto sería una fuga bajo carga.
    await withTenant(app, casaA, async (client) => {
      const inside = await client.query<{ v: string }>(
        "select current_setting('app.tenant_id', true) as v",
      )
      expect(inside.rows[0]?.v).toBe(casaA)
    })

    const after = await withoutTenantScope(app, async (client) =>
      client.query<{ v: string | null }>("select current_setting('app.tenant_id', true) as v"),
    )
    expect(after.rows[0]?.v ?? '').toBe('')
  })

  it('rechaza un tenantId inválido antes de llegar a la base', async () => {
    await expect(withTenant(app, 'no-es-un-uuid', async () => 1)).rejects.toThrow(/tenantId/)
  })
})

if (!enabled) {
  describe('aislamiento entre hogares', () => {
    it.skip('necesita DATABASE_URL y DATABASE_APP_URL (pnpm db:up)', () => {})
  })
}
