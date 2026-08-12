/**
 * El aislamiento tiene que sobrevivir a conectarse con un rol privilegiado.
 *
 * Los tests de `rls.test.ts` conectan con un rol sin privilegios y demuestran
 * que las policies funcionan. Pero en producción **no conectamos así**: la
 * cadena que da Supabase entra como `postgres`, dueño de las tablas y con
 * BYPASSRLS. Con esa conexión, las policies quedan decorativas y nadie se
 * entera, porque no hay ningún error.
 *
 * Estos tests prueban las dos mitades del argumento:
 *   - Sin cambio de rol, un usuario privilegiado ve TODO (el peligro es real).
 *   - Con `set local role`, ve sólo su hogar (la defensa funciona).
 *
 * El primero importa tanto como el segundo: un test que sólo verifica el
 * camino bueno no demuestra que la protección haga algo.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bypassesRls, createPool, type Db, withoutTenantScope, withTenant } from './client.js'
import { migrate } from './migrate.js'

const ADMIN_URL = process.env['DATABASE_URL']
const enabled = ADMIN_URL !== undefined

const suite = enabled ? describe : describe.skip

suite('cambio de rol dentro de la transacción', () => {
  let admin: Db
  let casaA: string
  let casaB: string

  beforeAll(async () => {
    await migrate(ADMIN_URL as string)
    admin = createPool({ connectionString: ADMIN_URL as string })

    await withoutTenantScope(admin, async (client) => {
      await client.query("delete from tenant where name in ('Rol A', 'Rol B')")
      const a = await client.query<{ id: string }>(
        "insert into tenant (name, base_currency) values ('Rol A', 'EUR') returning id",
      )
      const b = await client.query<{ id: string }>(
        "insert into tenant (name, base_currency) values ('Rol B', 'USD') returning id",
      )
      casaA = a.rows[0]?.id as string
      casaB = b.rows[0]?.id as string
      await client.query(
        `insert into account (tenant_id, kind, name, currency)
         values ($1, 'asset', 'Cuenta de A', 'EUR'), ($2, 'asset', 'Cuenta de B', 'USD')`,
        [casaA, casaB],
      )
    })
  }, 60_000)

  afterAll(async () => {
    await admin?.end()
  })

  it('la conexión de administración efectivamente puede saltarse RLS', async () => {
    // Si esto fuera false, el resto de los tests de este fichero no probarían
    // nada: estarían midiendo una defensa contra un ataque imposible.
    expect(await bypassesRls(admin)).toBe(true)
  })

  it('SIN cambio de rol, un rol privilegiado ve los datos de todos', async () => {
    const names = await withTenant(
      admin,
      casaA,
      async (client) =>
        (await client.query<{ name: string }>('select name from account order by name')).rows.map(
          (r) => r.name,
        ),
      { role: null },
    )
    // Ve la cuenta del otro hogar pese a haber declarado el tenant.
    expect(names).toContain('Cuenta de A')
    expect(names).toContain('Cuenta de B')
  })

  it('CON cambio de rol, ve sólo su hogar', async () => {
    const seenByA = await withTenant(admin, casaA, async (client) =>
      (await client.query<{ name: string }>('select name from account')).rows.map((r) => r.name),
    )
    const seenByB = await withTenant(admin, casaB, async (client) =>
      (await client.query<{ name: string }>('select name from account')).rows.map((r) => r.name),
    )

    expect(seenByA).toEqual(['Cuenta de A'])
    expect(seenByB).toEqual(['Cuenta de B'])
  })

  it('el rol vuelve solo al terminar la transacción', async () => {
    // Igual que app.tenant_id: lo que dura más que la transacción se filtra
    // cuando el pool recicla la conexión.
    await withTenant(admin, casaA, async (client) => {
      const inside = await client.query<{ role: string }>('select current_user as role')
      expect(inside.rows[0]?.role).toBe('moneypilot_app')
    })

    const after = await withoutTenantScope(admin, async (client) =>
      client.query<{ role: string }>('select current_user as role'),
    )
    expect(after.rows[0]?.role).not.toBe('moneypilot_app')
  })

  it('falla ruidosamente si el rol no existe, en vez de servir sin aislamiento', async () => {
    await expect(
      withTenant(admin, casaA, async () => 1, { role: 'rol_que_no_existe' }),
    ).rejects.toThrow(/Row Level Security no se aplicaría/)
  })

  it('rechaza un nombre de rol que no sea un identificador simple', async () => {
    // El nombre se interpola en el SQL porque `set role` no admite parámetros.
    await expect(
      withTenant(admin, casaA, async () => 1, { role: 'app; drop table tenant' }),
    ).rejects.toThrow(/Nombre de rol inválido/)
  })
})

suite('alta de hogar', () => {
  let admin: Db

  beforeAll(async () => {
    await migrate(ADMIN_URL as string)
    admin = createPool({ connectionString: ADMIN_URL as string })
  }, 60_000)

  afterAll(async () => {
    await admin?.end()
  })

  it('crea tenant, membresía y cuenta de apertura en una sola operación', async () => {
    const userId = '11111111-1111-4111-8111-111111111111'
    const tenantId = await withoutTenantScope(admin, async (client) => {
      await client.query('delete from membership where user_id = $1', [userId])
      await client.query("delete from tenant where name = 'Hogar de prueba'")
      const { rows } = await client.query<{ provision_household: string }>(
        'select provision_household($1, $2, $3, $4)',
        [userId, 'test@example.com', 'Hogar de prueba', 'EUR'],
      )
      return rows[0]?.provision_household as string
    })

    expect(tenantId).toMatch(/^[0-9a-f-]{36}$/)

    const state = await withTenant(
      admin,
      tenantId,
      async (client) => ({
        accounts: (await client.query('select name, kind from account')).rows,
      }),
      { userId },
    )
    // La cuenta de apertura es lo que absorbe la diferencia cuando se importa
    // un recorte de historia. Sin ella los saldos no cuadran nunca.
    expect(state.accounts).toEqual([{ name: 'Saldo de apertura', kind: 'equity' }])
  })

  it('es idempotente: un doble click no crea dos hogares', async () => {
    const userId = '22222222-2222-4222-8222-222222222222'
    const call = async (): Promise<string> =>
      withoutTenantScope(admin, async (client) => {
        const { rows } = await client.query<{ provision_household: string }>(
          'select provision_household($1, $2, $3, $4)',
          [userId, 'dup@example.com', 'Hogar duplicado', 'EUR'],
        )
        return rows[0]?.provision_household as string
      })

    await withoutTenantScope(admin, async (client) => {
      await client.query('delete from membership where user_id = $1', [userId])
      await client.query("delete from tenant where name = 'Hogar duplicado'")
    })

    expect(await call()).toBe(await call())
  })
})
