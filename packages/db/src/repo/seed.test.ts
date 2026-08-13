/**
 * El hogar de ejemplo es la demo del producto, así que estos tests no
 * comprueban que "el sembrado corre": comprueban que lo que sale es defendible
 * delante de un cliente. Las cuatro cosas que se enseñan en el onboarding —la
 * reconciliación que cierra, el coste por propiedad, el reparto con peso y el
 * efecto cambiario— se verifican contra la base, no contra lo que el sembrado
 * dice de sí mismo.
 *
 * Necesita una base real. Sin DATABASE_URL se saltan, igual que el resto de
 * los tests del paquete.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createPool,
  type Db,
  type TenantClient,
  withoutTenantScope,
  withTenant,
} from '../client.js'
import { migrate } from '../migrate.js'
import { hasDemoData, removeDemoData, type SeedResult, seedDemoHousehold } from './seed.js'

const ADMIN_URL = process.env['DATABASE_URL']
const APP_URL = process.env['DATABASE_APP_URL']
const enabled = ADMIN_URL !== undefined && APP_URL !== undefined
const suite = enabled ? describe : describe.skip

const AS_OF = '2026-08-13'
const MONTHS = 14

const PREFIX = 'Hogar Demo Semilla —'

/**
 * Un hogar por escenario: los tests que borran no pueden pisar a los que leen.
 *
 * El nombre lleva el pid porque la base de desarrollo es una sola y compartida.
 * Sin él, dos corridas simultáneas de este mismo fichero se borran los hogares
 * entre sí a mitad de camino y los fallos parecen del sembrado cuando son del
 * entorno.
 */
const HOUSEHOLDS = {
  base: `${PREFIX} base #${process.pid}`,
  copia: `${PREFIX} copia #${process.pid}`,
  resiembra: `${PREFIX} resiembra #${process.pid}`,
  limpieza: `${PREFIX} limpieza #${process.pid}`,
  vacio: `${PREFIX} vacío #${process.pid}`,
} as const

suite('hogar de ejemplo', () => {
  let admin: Db
  let app: Db
  const ids: Record<keyof typeof HOUSEHOLDS, string> = {
    base: '',
    copia: '',
    resiembra: '',
    limpieza: '',
    vacio: '',
  }
  let seeded: SeedResult

  const inTenant = async <T>(
    key: keyof typeof HOUSEHOLDS,
    fn: (client: TenantClient) => Promise<T>,
  ): Promise<T> => withTenant(app, ids[key], fn)

  beforeAll(async () => {
    await migrate(ADMIN_URL as string)
    admin = createPool({ connectionString: ADMIN_URL as string })
    app = createPool({ connectionString: APP_URL as string })

    await withoutTenantScope(admin, async (client) => {
      // Sólo lo que dejó una corrida vieja que murió antes del afterAll. Por
      // antigüedad y no por nombre: borrar todos los del prefijo mataría a una
      // corrida que esté pasando ahora mismo.
      await client.query(
        `delete from tenant where name like $1 and created_at < now() - interval '1 hour'`,
        [`${PREFIX}%`],
      )
      await client.query('delete from tenant where name = any($1::text[])', [
        Object.values(HOUSEHOLDS),
      ])
      for (const [key, name] of Object.entries(HOUSEHOLDS)) {
        const { rows } = await client.query<{ id: string }>(
          'insert into tenant (name, base_currency) values ($1, $2) returning id',
          [name, 'EUR'],
        )
        ids[key as keyof typeof HOUSEHOLDS] = rows[0]?.id as string
      }
    })

    seeded = await inTenant('base', (client) =>
      seedDemoHousehold(client, { asOf: AS_OF, months: MONTHS }),
    )
  }, 180_000)

  afterAll(async () => {
    if (admin !== undefined) {
      await withoutTenantScope(admin, (client) =>
        client.query('delete from tenant where name = any($1::text[])', [
          Object.values(HOUSEHOLDS),
        ]),
      )
    }
    await admin?.end()
    await app?.end()
  })

  it('siembra las 18 cuentas del arquetipo en tres países y dos monedas', async () => {
    const rows = await inTenant(
      'base',
      async (client) =>
        (
          await client.query<{ country: string; currency: string; kind: string }>(
            'select country, currency, kind from account where country is not null',
          )
        ).rows,
    )

    expect(rows).toHaveLength(18)
    expect(seeded.bankAccounts).toBe(18)
    expect(new Set(rows.map((r) => r.country.trim()))).toEqual(new Set(['ES', 'PT', 'US']))
    expect(new Set(rows.map((r) => r.currency.trim()))).toEqual(new Set(['EUR', 'USD']))
    // Las tarjetas son pasivo, no una cuenta de activo con saldo negativo: si
    // no, el patrimonio neto sale mal y el reporte no se puede defender.
    expect(rows.filter((r) => r.kind === 'liability')).toHaveLength(5)
    expect(rows.filter((r) => r.kind === 'asset')).toHaveLength(13)
  })

  it('las categorías tienen jerarquía real: Luz cuelga de Servicios y Servicios de Casa', async () => {
    const path = await inTenant('base', async (client) =>
      (
        await client.query<{ hijo: string; padre: string | null; abuelo: string | null }>(
          `select hijo.name as hijo, padre.name as padre, abuelo.name as abuelo
             from account hijo
             left join account padre on padre.id = hijo.parent_id
             left join account abuelo on abuelo.id = padre.parent_id
            where hijo.name = 'Luz'`,
        )
      ).rows.at(0),
    )

    expect(path).toEqual({ hijo: 'Luz', padre: 'Servicios', abuelo: 'Casa' })
  })

  it('cada asiento balancea a cero dentro de cada moneda', async () => {
    const descuadres = await inTenant(
      'base',
      async (client) =>
        (
          await client.query<{ entry_id: string; currency: string; total: string }>(
            `select entry_id, currency, sum(amount)::text as total
             from posting
            group by entry_id, currency
           having sum(amount) <> 0`,
          )
        ).rows,
    )

    expect(descuadres).toEqual([])
  })

  it('17 de las 18 cuentas cuadran contra el saldo declarado, y la que falla trae el motivo', async () => {
    const rows = await inTenant(
      'base',
      async (client) =>
        (
          await client.query<{ name: string; computed: string; declared: string }>(
            `select a.name,
                  coalesce(sum(p.amount), 0)::text as computed,
                  d.amount::text                   as declared
             from account a
             join declared_balance d on d.account_id = a.id
             left join posting p     on p.account_id = a.id
            group by a.id, a.name, d.amount`,
          )
        ).rows,
    )

    expect(rows).toHaveLength(18)
    const conDelta = rows.filter((r) => BigInt(r.computed) - BigInt(r.declared) !== 0n)
    const cuadran = rows.length - conDelta.length

    expect(cuadran).toBe(17)
    expect(conDelta).toHaveLength(1)
    expect(seeded.reconciled).toBe(17)
    expect(seeded.deltas).toHaveLength(1)

    const [delta] = seeded.deltas
    expect(delta?.account).toBe(conDelta[0]?.name)
    expect(delta?.delta).toBe('47.35')
    // Un delta sin explicación es exactamente lo que el producto promete no
    // hacer: la cuenta que no cierra tiene que venir con el motivo.
    expect(delta?.reason.length).toBeGreaterThan(20)
  })

  it('no genera ni un movimiento posterior a la fecha de corte', async () => {
    const rango = await inTenant('base', async (client) =>
      (
        await client.query<{ primero: string; ultimo: string }>(
          'select min(booked_on)::text as primero, max(booked_on)::text as ultimo from entry',
        )
      ).rows.at(0),
    )

    expect(rango?.ultimo <= AS_OF).toBe(true)
    expect(rango?.primero).toBe(seeded.from)
    // 14 meses de histórico son más de un año: si el rango fuera de semanas, la
    // estacionalidad y los recurrentes no se podrían enseñar.
    expect((rango?.primero ?? '').slice(0, 7)).toBe('2025-06')
  })

  it('hay una serie recurrente que subió y otra que dejó de cobrarse', async () => {
    expect(seeded.raisedSeries.length).toBeGreaterThan(0)
    expect(seeded.stoppedSeries.length).toBeGreaterThan(0)

    const subio = seeded.raisedSeries[0] as string
    const importes = await inTenant(
      'base',
      async (client) =>
        (
          await client.query<{ mes: string; amount: string }>(
            `select to_char(e.booked_on, 'YYYY-MM') as mes, p.amount::text as amount
             from entry e
             join posting p on p.entry_id = e.id
             join account a on a.id = p.account_id
            where e.description = $1 and a.kind = 'expense'
            order by e.booked_on`,
            [subio],
          )
        ).rows,
    )

    expect(importes.length).toBeGreaterThanOrEqual(12)
    const primero = BigInt(importes[0]?.amount ?? '0')
    const ultimo = BigInt(importes[importes.length - 1]?.amount ?? '0')
    // Sube más de un 20%: es el hallazgo que la pantalla de fugas tiene que
    // encontrar sola, así que tiene que estar por encima del ruido.
    expect(ultimo * 100n).toBeGreaterThan(primero * 120n)

    const ceso = seeded.stoppedSeries[0] as string
    const cesada = await inTenant('base', async (client) =>
      (
        await client.query<{ n: number; ultimo: string }>(
          `select count(*)::int as n, max(booked_on)::text as ultimo
             from entry where description = $1`,
          [ceso],
        )
      ).rows.at(0),
    )

    expect(cesada?.n).toBeGreaterThan(5)
    // Cobrada durante meses y después nunca más: eso es lo que hace que valga
    // la pena mirarla, y no una suscripción que simplemente no existe.
    expect((cesada?.ultimo ?? '').slice(0, 7)).toBe('2026-03')
  })

  it('no deja ninguna categoría hoja vacía en el histórico completo', async () => {
    const vacias = await inTenant('base', async (client) =>
      (
        await client.query<{ name: string }>(
          `select a.name
             from account a
            where a.kind in ('expense', 'income')
              and not exists (select 1 from account h where h.parent_id = a.id)
              and not exists (select 1 from posting p where p.account_id = a.id)
            order by a.name`,
        )
      ).rows.map((r) => r.name),
    )

    // Una categoría sin un solo movimiento delata que el ejemplo se armó por
    // acumulación y no por diseño: en la demo se ve como una rama muerta.
    expect(vacias).toEqual([])
  })

  it('reparte la obra 60/40 entre la persona y la sociedad sin perder un céntimo de peso', async () => {
    const reparto = await inTenant(
      'base',
      async (client) =>
        (
          await client.query<{ label: string; weight_ppm: number; n: number }>(
            `select v.label, pd.weight_ppm, count(*)::int as n
             from posting_dimension pd
             join dimension_value v on v.id = pd.dimension_value_id
             join dimension d       on d.id = pd.dimension_id
             join posting p         on p.id = pd.posting_id
             join entry e           on e.id = p.entry_id
            where d.key = 'entidad' and e.description like 'Reforma cocina Madrid%'
            group by v.label, pd.weight_ppm
            order by pd.weight_ppm desc`,
          )
        ).rows,
    )

    expect(reparto).toHaveLength(2)
    expect(reparto[0]?.weight_ppm).toBe(600_000)
    expect(reparto[1]?.weight_ppm).toBe(400_000)
    expect((reparto[0]?.weight_ppm ?? 0) + (reparto[1]?.weight_ppm ?? 0)).toBe(1_000_000)
    expect(reparto[0]?.n).toBe(3)
  })

  it('cada propiedad tiene sus áreas hijas y gasto imputado a ellas', async () => {
    const propiedades = await inTenant(
      'base',
      async (client) =>
        (
          await client.query<{ propiedad: string; areas: number; patas: number }>(
            `select padre.label as propiedad,
                  count(distinct hijo.id)::int as areas,
                  count(pd.posting_id)::int    as patas
             from dimension_value padre
             join dimension_value hijo on hijo.parent_id = padre.id
             left join posting_dimension pd on pd.dimension_value_id = hijo.id
            where padre.parent_id is null
            group by padre.label
            order by padre.label`,
          )
        ).rows,
    )

    expect(propiedades.map((p) => p.propiedad)).toEqual([
      'Apartamento Miami',
      'Casa Madrid',
      'Piso Lisboa',
    ])
    for (const propiedad of propiedades) {
      expect(propiedad.areas, `${propiedad.propiedad}: áreas`).toBe(5)
      expect(propiedad.patas, `${propiedad.propiedad}: gasto imputado`).toBeGreaterThan(0)
    }
  })

  it('el gasto en dólares trae los tres números y cierra contra las cuentas de cambio', async () => {
    const datos = await inTenant('base', async (client) => {
      const nativos = (
        await client.query<{ moneda: string; n: number }>(
          `select native_currency as moneda, count(*)::int as n
             from posting where native_amount is not null
            group by native_currency`,
        )
      ).rows
      const multimoneda = (
        await client.query<{ n: number }>(
          `select count(*)::int as n from (
             select entry_id from posting group by entry_id having count(distinct currency) > 1
           ) t`,
        )
      ).rows.at(0)
      const cambio = (
        await client.query<{ moneda: string; saldo: string }>(
          `select p.currency as moneda, sum(p.amount)::text as saldo
             from posting p join account a on a.id = p.account_id
            where a.kind = 'trading'
            group by p.currency`,
        )
      ).rows
      const sinBase = (
        await client.query<{ n: number }>(
          'select count(*)::int as n from posting where base_amount is null',
        )
      ).rows.at(0)
      return { nativos, multimoneda, cambio, sinBase }
    })

    // Los tres números en los dos sentidos: tarjeta española cobrando en
    // dólares y tarjeta americana cobrando en euros.
    expect(new Set(datos.nativos.map((r) => r.moneda.trim()))).toEqual(new Set(['EUR', 'USD']))
    expect(datos.multimoneda?.n).toBeGreaterThan(0)
    // Las cuentas de cambio existen y tienen saldo: si cerraran en cero en las
    // dos monedas, no habría efecto cambiario que mostrar.
    expect(datos.cambio).toHaveLength(2)
    expect(datos.cambio.some((r) => BigInt(r.saldo) !== 0n)).toBe(true)
    // Todo convertido a la moneda de reporte. El sembrado además lo declara.
    expect(datos.sinBase?.n).toBe(0)
    expect(seeded.postingsWithoutBase).toBe(0)
  })

  it('las patas de una transferencia interna quedan marcadas como tales', async () => {
    const traspasos = await inTenant('base', async (client) =>
      (
        await client.query<{ total: number; marcadas: number }>(
          `select count(*)::int as total,
                  count(*) filter (where p.is_transfer)::int as marcadas
             from posting p
             join entry e on e.id = p.entry_id
            where e.description like 'Traspaso a cuenta de ahorro%'`,
        )
      ).rows.at(0),
    )

    // Sin la marca, mover plata al ahorro aparecería como gasto y como ingreso
    // a la vez, y el gasto del mes saldría inflado.
    expect(traspasos?.marcadas).toBe(traspasos?.total)
    // Trece meses y no catorce: el traspaso es el día 27 y el mes en curso se
    // corta el 13. Lo que cae después de la fecha de corte no existe.
    expect(traspasos?.total).toBe((MONTHS - 1) * 2)
  })

  it('deja movimientos pendientes de revisión, con evidencia y sin descartar nada', async () => {
    const revisiones = await inTenant(
      'base',
      async (client) =>
        (
          await client.query<{
            kind: string
            state: string
            entry_id: string | null
            counterpart_id: string | null
            evidence: Record<string, unknown>
          }>('select kind, state, entry_id, counterpart_id, evidence from review_item')
        ).rows,
    )

    const pendientes = revisiones.filter((r) => r.state === 'pendiente')
    expect(pendientes.length).toBeGreaterThanOrEqual(3)
    expect(seeded.pendingReviews).toBe(pendientes.length)
    expect(new Set(revisiones.map((r) => r.kind))).toEqual(
      new Set(['posible_duplicado', 'transferencia_sugerida', 'sin_categorizar']),
    )

    const duplicado = revisiones.find((r) => r.kind === 'posible_duplicado')
    expect(duplicado?.counterpart_id).not.toBeNull()
    expect(duplicado?.evidence['motivo']).toBeTypeOf('string')

    // El duplicado dudoso NO se descartó: los dos asientos están en el libro y
    // es una persona la que decide. Descartar en silencio es el modo de fallo
    // que el producto se niega a tener.
    const enElLibro = await inTenant('base', async (client) =>
      (
        await client.query<{ n: number }>(
          'select count(*)::int as n from entry where id = any($1)',
          [[duplicado?.entry_id, duplicado?.counterpart_id]],
        )
      ).rows.at(0),
    )
    expect(enElLibro?.n).toBe(2)
  })

  it('sembrar dos veces sobre la misma base da exactamente lo mismo, ids incluidos', async () => {
    const primera = await inTenant('resiembra', (client) =>
      seedDemoHousehold(client, { asOf: AS_OF, months: MONTHS }),
    )
    const antes = await inTenant('resiembra', dumpConIds)

    const borrado = await inTenant('resiembra', removeDemoData)
    expect(borrado.removed).toBeGreaterThan(0)

    const segunda = await inTenant('resiembra', (client) =>
      seedDemoHousehold(client, { asOf: AS_OF, months: MONTHS }),
    )
    const despues = await inTenant('resiembra', dumpConIds)

    expect(despues).toBe(antes)
    expect(segunda).toEqual(primera)
  }, 180_000)

  it('dos hogares distintos sembrados con la misma fecha de corte tienen los mismos movimientos', async () => {
    await inTenant('copia', (client) => seedDemoHousehold(client, { asOf: AS_OF, months: MONTHS }))

    const [uno, otro] = await Promise.all([
      inTenant('base', dumpPorNombre),
      inTenant('copia', dumpPorNombre),
    ])

    // Mismo contenido con ids distintos: los ids llevan el hogar dentro del
    // hash a propósito, porque son clave primaria global.
    expect(otro).toBe(uno)
  }, 180_000)

  it('removeDemoData deja el hogar exactamente como estaba', async () => {
    await inTenant('limpieza', async (client) => {
      // El hogar no está vacío: ya tiene la cuenta de apertura que crea el alta
      // y una cuenta propia. El ejemplo no puede llevárselas al desinstalarse.
      await client.query(
        `insert into account (tenant_id, kind, name, currency)
         values (app_current_tenant(), 'equity', 'Saldo de apertura', 'EUR'),
                (app_current_tenant(), 'asset',  'Caja fuerte de casa', 'EUR')`,
      )
    })

    const antes = await inTenant('limpieza', snapshot)

    await inTenant('limpieza', (client) => seedDemoHousehold(client, { asOf: AS_OF, months: 3 }))
    expect(await inTenant('limpieza', hasDemoData)).toBe(true)

    const { removed } = await inTenant('limpieza', removeDemoData)
    expect(removed).toBeGreaterThan(0)

    expect(await inTenant('limpieza', snapshot)).toBe(antes)
    expect(await inTenant('limpieza', hasDemoData)).toBe(false)
  }, 120_000)

  it('hasDemoData distingue un hogar sembrado de uno que nunca lo estuvo', async () => {
    expect(await inTenant('base', hasDemoData)).toBe(true)
    expect(await inTenant('vacio', hasDemoData)).toBe(false)
    expect(await inTenant('vacio', removeDemoData)).toEqual({ removed: 0 })
  })

  it('se niega a sembrar dos veces sobre el mismo hogar', async () => {
    // Dos ejemplos superpuestos dan saldos que no cuadran con nada, y el
    // primer entregable del producto es justamente que cuadren.
    await expect(inTenant('base', (client) => seedDemoHousehold(client))).rejects.toThrow(
      /ya tiene el ejemplo/i,
    )
  })

  it('el lote lleva la marca del ejemplo y su informe explica el delta', async () => {
    const lote = await inTenant('base', async (client) =>
      (
        await client.query<{
          file_name: string
          format: string
          status: string
          imported: number
          report: Record<string, unknown>
        }>('select file_name, format, status, imported, report from import_batch')
      ).rows.at(0),
    )

    expect(lote?.file_name).toBe('ejemplo:hogar-demo')
    expect(lote?.format).toBe('seed')
    expect(lote?.status).toBe('completed')
    expect(lote?.imported).toBe(seeded.entries)
    expect(lote?.report['ejemplo']).toBe(true)
    expect(lote?.report['cuentas_conciliadas']).toBe(17)
    expect(String(lote?.report['nota'])).toMatch(/no son movimientos reales/i)
  })
})

/** Volcado con ids: sirve para comparar dos sembrados del MISMO hogar. */
async function dumpConIds(client: TenantClient): Promise<string> {
  const { rows } = await client.query(
    `select e.id::text as entry_id, e.booked_on::text, coalesce(e.valued_on::text, '') as valued_on,
            e.description, e.fingerprint, p.ordinal, p.account_id::text,
            p.amount::text, p.currency,
            coalesce(p.native_amount::text, '')   as native_amount,
            coalesce(p.base_amount::text, '')     as base_amount,
            coalesce(p.fx_numerator::text, '')    as fx_numerator,
            coalesce(p.fx_denominator::text, '')  as fx_denominator,
            p.is_transfer
       from entry e
       join posting p on p.entry_id = e.id
      order by e.booked_on, e.fingerprint, p.ordinal`,
  )
  return JSON.stringify(rows)
}

/** Volcado por nombre: sirve para comparar dos hogares distintos. */
async function dumpPorNombre(client: TenantClient): Promise<string> {
  const { rows } = await client.query(
    `select e.booked_on::text, e.description, e.fingerprint is not null as tiene_huella,
            p.ordinal, a.name as cuenta, p.amount::text, p.currency,
            coalesce(p.base_amount::text, '') as base_amount, p.is_transfer,
            coalesce(string_agg(v.label || ':' || pd.weight_ppm, '|' order by v.label), '') as dims
       from entry e
       join posting p on p.entry_id = e.id
       join account a on a.id = p.account_id
       left join posting_dimension pd on pd.posting_id = p.id
       left join dimension_value v    on v.id = pd.dimension_value_id
      group by e.booked_on, e.description, e.fingerprint, p.ordinal, a.name,
               p.amount, p.currency, p.base_amount, p.is_transfer
      order by e.booked_on, e.description, a.name, p.ordinal, p.amount`,
  )
  return JSON.stringify(rows)
}

/** Estado completo del hogar, para comprobar que el borrado no deja rastro. */
async function snapshot(client: TenantClient): Promise<string> {
  const queries: readonly [string, string][] = [
    [
      'cuentas',
      `select name, kind, currency, coalesce(parent_id::text, '') as parent
         from account order by name`,
    ],
    ['dimensiones', 'select key, label from dimension order by key'],
    ['valores', 'select label from dimension_value order by label'],
    ['asientos', 'select count(*)::int as n from entry'],
    ['patas', 'select count(*)::int as n from posting'],
    ['atribuciones', 'select count(*)::int as n from posting_dimension'],
    ['saldos', 'select count(*)::int as n from declared_balance'],
    ['revisiones', 'select count(*)::int as n from review_item'],
    ['lotes', 'select count(*)::int as n from import_batch'],
  ]
  const out: Record<string, unknown> = {}
  for (const [name, sql] of queries) {
    out[name] = (await client.query(sql)).rows
  }
  return JSON.stringify(out)
}

if (!enabled) {
  describe('hogar de ejemplo', () => {
    it.skip('necesita DATABASE_URL y DATABASE_APP_URL (pnpm db:up)', () => {})
  })
}
