/**
 * La clasificación contra una base de verdad.
 *
 * Lo que hay que demostrar acá es justamente lo que un doble no puede: que la
 * pata bancaria sigue byte por byte como estaba, que el asiento sigue
 * balanceando a cero después de mover la categoría, que la auditoría registra
 * el cambio, y que RLS impide que una regla de un hogar alcance los
 * movimientos de otro.
 *
 * Cada bloque monta su propio hogar. No es ceremonia: las reglas y las
 * dimensiones son estado compartido dentro del hogar, y un test que deja una
 * regla activa cambia el resultado del siguiente.
 *
 * Sin DATABASE_URL se saltan solos, para que `pnpm test` siga corriendo en una
 * máquina sin Docker.
 */

import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createPool,
  type Db,
  type TenantClient,
  withoutTenantScope,
  withTenant,
} from '../client.js'
import { migrate } from '../migrate.js'
import {
  applyAllRules,
  applyRule,
  ClassifyError,
  createRule,
  deleteRule,
  listRules,
  previewRule,
  reclassify,
  setDimensions,
  uncategorized,
  updateRule,
} from './classify.js'

const ADMIN_URL = process.env['DATABASE_URL']
const APP_URL = process.env['DATABASE_APP_URL']
const enabled = ADMIN_URL !== undefined && APP_URL !== undefined
const suite = enabled ? describe : describe.skip

const hash = (seed: string): string => createHash('sha256').update(seed).digest('hex')

/** Sufijo por corrida: otros agentes están usando la misma base al mismo tiempo. */
const RUN = hash(`${process.pid}-${Date.now()}-${Math.random()}`).slice(0, 12)

const AUTOR = 'julian@ejemplo.test'

// ── Utilidades ──────────────────────────────────────────────────────────────

function unico<T>(rows: readonly T[], what: string): T {
  const row = rows[0]
  if (row === undefined) throw new Error(`Se esperaba una fila de ${what}`)
  return row
}

interface Hogar {
  readonly tenantId: string
  readonly banco: string
  readonly tarjeta: string
  readonly sinCategorizar: string
  readonly ingresosSinCategorizar: string
  readonly luz: string
  readonly restaurantes: string
  readonly nomina: string
  readonly ahorro: string
  readonly dimPropiedad: string
  readonly madrid: string
  readonly lisboa: string
  readonly dimEntidad: string
  readonly personal: string
  readonly sociedad: string
}

let admin: Db
let app: Db
const hogaresCreados: string[] = []

async function nuevoHogar(etiqueta: string): Promise<Hogar> {
  const hogar = await withoutTenantScope(admin, async (client) => {
    const tenant = await client.query<{ id: string }>(
      'insert into tenant (name, base_currency) values ($1, $2) returning id',
      [`Clasificación ${RUN} ${etiqueta}`, 'EUR'],
    )
    const tenantId = unico(tenant.rows, 'tenant').id

    const cuenta = async (kind: string, name: string): Promise<string> => {
      const { rows } = await client.query<{ id: string }>(
        `insert into account (tenant_id, kind, name, currency)
         values ($1, $2::account_kind, $3, 'EUR') returning id`,
        [tenantId, kind, name],
      )
      return unico(rows, 'account').id
    }

    const dimension = async (key: string, label: string, position: number): Promise<string> => {
      const { rows } = await client.query<{ id: string }>(
        'insert into dimension (tenant_id, key, label, position) values ($1, $2, $3, $4) returning id',
        [tenantId, key, label, position],
      )
      return unico(rows, 'dimension').id
    }

    const valor = async (dimensionId: string, label: string): Promise<string> => {
      const { rows } = await client.query<{ id: string }>(
        'insert into dimension_value (tenant_id, dimension_id, label) values ($1, $2, $3) returning id',
        [tenantId, dimensionId, label],
      )
      return unico(rows, 'dimension_value').id
    }

    const dimPropiedad = await dimension('propiedad', 'Propiedad', 0)
    const dimEntidad = await dimension('entidad', 'Entidad', 1)

    return {
      tenantId,
      banco: await cuenta('asset', 'BBVA Corriente'),
      tarjeta: await cuenta('liability', 'Visa BBVA'),
      ahorro: await cuenta('asset', 'Cuenta de ahorro'),
      // El nombre importa: es así como el importador marca lo que falta por
      // clasificar, y por ese nombre lo reconoce `soloSinCategorizar`.
      sinCategorizar: await cuenta('expense', 'Sin categorizar (EUR)'),
      ingresosSinCategorizar: await cuenta('income', 'Ingresos sin categorizar (EUR)'),
      luz: await cuenta('expense', 'Luz'),
      restaurantes: await cuenta('expense', 'Restaurantes'),
      nomina: await cuenta('income', 'Nómina'),
      dimPropiedad,
      madrid: await valor(dimPropiedad, 'Casa Madrid'),
      lisboa: await valor(dimPropiedad, 'Piso Lisboa'),
      dimEntidad,
      personal: await valor(dimEntidad, 'Personal'),
      sociedad: await valor(dimEntidad, 'Sociedad patrimonial'),
    }
  })
  hogaresCreados.push(hogar.tenantId)
  return hogar
}

interface AsientoSpec {
  readonly on?: string
  readonly description: string
  /** Importe de la pata bancaria, con el signo del extracto. */
  readonly amount: bigint
  readonly cuenta?: string
  readonly categoria?: string
  readonly transferencia?: boolean
}

/** Un movimiento normal: la pata bancaria y su contrapartida. */
async function asentar(client: TenantClient, hogar: Hogar, spec: AsientoSpec): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into entry (tenant_id, booked_on, description, source)
     values ($1, $2::date, $3, 'file') returning id`,
    [hogar.tenantId, spec.on ?? '2026-03-14', spec.description],
  )
  const entryId = unico(rows, 'entry').id
  const banco = spec.cuenta ?? hogar.banco
  const categoria =
    spec.categoria ?? (spec.amount > 0n ? hogar.ingresosSinCategorizar : hogar.sinCategorizar)

  await client.query(
    `insert into posting (tenant_id, entry_id, account_id, ordinal, amount, currency, is_transfer)
     select $1::uuid, $2::uuid, p.account_id, p.ordinal, p.amount, 'EUR', $3::boolean
       from unnest($4::uuid[], $5::smallint[], $6::bigint[]) as p(account_id, ordinal, amount)`,
    [
      hogar.tenantId,
      entryId,
      spec.transferencia ?? false,
      [banco, categoria],
      [0, 1],
      [spec.amount.toString(), (-spec.amount).toString()],
    ],
  )
  return entryId
}

/** Un traspaso interno: las dos patas contra cuentas propias. */
async function asentarTraspaso(
  client: TenantClient,
  hogar: Hogar,
  amount: bigint,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into entry (tenant_id, booked_on, description, source)
     values ($1, '2026-03-10'::date, 'Traspaso a ahorro', 'file') returning id`,
    [hogar.tenantId],
  )
  const entryId = unico(rows, 'entry').id
  await client.query(
    `insert into posting (tenant_id, entry_id, account_id, ordinal, amount, currency, is_transfer)
     select $1::uuid, $2::uuid, p.account_id, p.ordinal, p.amount, 'EUR', true
       from unnest($3::uuid[], $4::smallint[], $5::bigint[]) as p(account_id, ordinal, amount)`,
    [
      hogar.tenantId,
      entryId,
      [hogar.banco, hogar.ahorro],
      [0, 1],
      [(-amount).toString(), amount.toString()],
    ],
  )
  return entryId
}

/** Un ticket repartido entre dos categorías. */
async function asentarReparto(client: TenantClient, hogar: Hogar): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into entry (tenant_id, booked_on, description, source)
     values ($1, '2026-03-11'::date, 'Hipermercado con droguería', 'file') returning id`,
    [hogar.tenantId],
  )
  const entryId = unico(rows, 'entry').id
  await client.query(
    `insert into posting (tenant_id, entry_id, account_id, ordinal, amount, currency)
     select $1::uuid, $2::uuid, p.account_id, p.ordinal, p.amount, 'EUR'
       from unnest($3::uuid[], $4::smallint[], $5::bigint[]) as p(account_id, ordinal, amount)`,
    [
      hogar.tenantId,
      entryId,
      [hogar.banco, hogar.restaurantes, hogar.luz],
      [0, 1, 2],
      ['-10000', '6000', '4000'],
    ],
  )
  return entryId
}

interface PostingFila {
  readonly id: string
  readonly ordinal: number
  readonly accountId: string
  readonly amount: string
  readonly currency: string
}

async function postingsDe(client: TenantClient, entryId: string): Promise<PostingFila[]> {
  const { rows } = await client.query<{
    id: string
    ordinal: number
    account_id: string
    amount: string
    currency: string
  }>(
    `select id::text as id, ordinal, account_id, amount::text as amount, currency
       from posting where entry_id = $1 order by ordinal`,
    [entryId],
  )
  return rows.map((row) => ({
    id: row.id,
    ordinal: row.ordinal,
    accountId: row.account_id,
    amount: row.amount,
    currency: row.currency.trim(),
  }))
}

async function dimensionesDe(
  client: TenantClient,
  entryId: string,
): Promise<{ dimension: string; valor: string; ppm: number }[]> {
  const { rows } = await client.query<{
    dimension_id: string
    dimension_value_id: string
    weight_ppm: number
  }>(
    `select pd.dimension_id, pd.dimension_value_id, pd.weight_ppm
       from posting_dimension pd
       join posting p on p.id = pd.posting_id
      where p.entry_id = $1
      order by pd.dimension_id, pd.dimension_value_id`,
    [entryId],
  )
  return rows.map((row) => ({
    dimension: row.dimension_id,
    valor: row.dimension_value_id,
    ppm: row.weight_ppm,
  }))
}

async function auditoriaDe(
  client: TenantClient,
  entryId: string,
): Promise<{ from: string | null; to: string | null; rule: string | null; by: string }[]> {
  const { rows } = await client.query<{
    from_account_id: string | null
    to_account_id: string | null
    rule_id: string | null
    changed_by: string
  }>(
    `select cc.from_account_id, cc.to_account_id, cc.rule_id, cc.changed_by
       from classification_change cc
       join posting p on p.id = cc.posting_id
      where p.entry_id = $1
      order by cc.id`,
    [entryId],
  )
  return rows.map((row) => ({
    from: row.from_account_id,
    to: row.to_account_id,
    rule: row.rule_id,
    by: row.changed_by,
  }))
}

/**
 * El hecho registrado, entero: la pata bancaria de cada asiento y los campos
 * del asiento que la describen.
 *
 * Se compara como un todo y no campo a campo porque lo que hay que demostrar es
 * que **nada** de esto se movió. Una comprobación que mire sólo el importe
 * dejaría pasar una fecha corrida o una huella reescrita, que son igual de
 * graves y bastante más difíciles de notar.
 */
async function fotoDelHecho(client: TenantClient): Promise<Record<string, string>> {
  const { rows } = await client.query<{ clave: string; valor: string }>(
    `select p.id::text as clave,
            concat_ws('|',
              p.entry_id::text, p.account_id::text, p.amount::text, trim(p.currency),
              coalesce(p.base_amount::text, ''), coalesce(trim(p.base_currency), ''),
              coalesce(p.native_amount::text, ''), p.ordinal::text, p.is_transfer::text,
              to_char(e.booked_on, 'YYYY-MM-DD'), e.description, coalesce(e.fingerprint, '')
            ) as valor
       from posting p
       join entry e   on e.id = p.entry_id
       join account a on a.id = p.account_id
      where a.kind in ('asset', 'liability')
      order by p.id`,
  )
  return Object.fromEntries(rows.map((row) => [row.clave, row.valor]))
}

/** Asientos que no suman cero dentro de su moneda. Tiene que estar siempre vacío. */
async function desbalanceados(client: TenantClient): Promise<unknown[]> {
  const { rows } = await client.query(
    `select entry_id, currency, sum(amount)::text as total
       from posting group by entry_id, currency having sum(amount) <> 0`,
  )
  return rows
}

// ── Arranque ────────────────────────────────────────────────────────────────

suite('clasificación', () => {
  beforeAll(async () => {
    await migrate(ADMIN_URL as string)
    admin = createPool({ connectionString: ADMIN_URL as string })
    app = createPool({ connectionString: APP_URL as string })
  }, 60_000)

  afterAll(async () => {
    if (hogaresCreados.length > 0) {
      await withoutTenantScope(admin, async (client) => {
        // Las reglas primero: `rule.category_id` es ON DELETE RESTRICT, así que
        // el cascade del hogar podría intentar borrar la categoría antes que la
        // regla que la apunta.
        for (const table of ['rule', 'entry']) {
          await client.query(`delete from ${table} where tenant_id = any($1::uuid[])`, [
            hogaresCreados,
          ])
        }
        await client.query('delete from tenant where id = any($1::uuid[])', [hogaresCreados])
      })
    }
    await admin?.end()
    await app?.end()
  })

  // ── Reclasificar ──────────────────────────────────────────────────────────

  describe('reclasificar', () => {
    it('cambia la pata de contrapartida y deja la bancaria byte por byte igual', async () => {
      const hogar = await nuevoHogar('pata-bancaria')
      const entryId = await withTenant(app, hogar.tenantId, (client) =>
        asentar(client, hogar, { description: 'IBERDROLA CLIENTES', amount: -12045n }),
      )
      const antes = await withTenant(app, hogar.tenantId, (client) => postingsDe(client, entryId))

      const resultado = await withTenant(app, hogar.tenantId, (client) =>
        reclassify(client, { entryIds: [entryId], categoryId: hogar.luz, changedBy: AUTOR }),
      )
      expect(resultado.changed).toBe(1)

      const despues = await withTenant(app, hogar.tenantId, (client) => postingsDe(client, entryId))
      // La pata 0 es el hecho registrado: mismo id, misma cuenta, mismo importe.
      expect(despues[0]).toEqual(antes[0])
      expect(despues[0]?.accountId).toBe(hogar.banco)
      expect(despues[0]?.amount).toBe('-12045')
      // La pata 1 cambió de cuenta y NADA más: el importe es el mismo.
      expect(despues[1]?.id).toBe(antes[1]?.id)
      expect(despues[1]?.accountId).toBe(hogar.luz)
      expect(despues[1]?.amount).toBe('12045')
    })

    it('el asiento sigue balanceando a cero después de reclasificar', async () => {
      const hogar = await nuevoHogar('balance')
      await withTenant(app, hogar.tenantId, async (client) => {
        const ids = [
          await asentar(client, hogar, { description: 'IBERDROLA', amount: -12045n }),
          await asentar(client, hogar, { description: 'NOMINA MARZO', amount: 250000n }),
        ]
        await reclassify(client, {
          entryIds: ids,
          categoryId: hogar.luz,
          changedBy: AUTOR,
        })
        expect(await desbalanceados(client)).toEqual([])
      })
    })

    it('deja registro de quién, desde dónde y hacia dónde en classification_change', async () => {
      const hogar = await nuevoHogar('auditoria')
      await withTenant(app, hogar.tenantId, async (client) => {
        const entryId = await asentar(client, hogar, {
          description: 'IBERDROLA CLIENTES',
          amount: -12045n,
        })
        await reclassify(client, {
          entryIds: [entryId],
          categoryId: hogar.luz,
          changedBy: AUTOR,
        })

        expect(await auditoriaDe(client, entryId)).toEqual([
          { from: hogar.sinCategorizar, to: hogar.luz, rule: null, by: AUTOR },
        ])
      })
    })

    it('reclasifica los N movimientos de un alta en una sola pasada', async () => {
      const hogar = await nuevoHogar('masivo')
      await withTenant(app, hogar.tenantId, async (client) => {
        const ids: string[] = []
        for (let i = 0; i < 120; i += 1) {
          ids.push(
            await asentar(client, hogar, {
              description: `MERCADONA ${i}`,
              amount: BigInt(-1000 - i),
            }),
          )
        }

        const resultado = await reclassify(client, {
          entryIds: ids,
          categoryId: hogar.restaurantes,
          changedBy: AUTOR,
        })
        expect(resultado).toEqual({ changed: 120, yaEstaban: 0, omitidos: [] })

        const { rows } = await client.query<{ total: string }>(
          `select count(*)::text as total from posting where account_id = $1`,
          [hogar.restaurantes],
        )
        expect(rows[0]?.total).toBe('120')
      })
    })

    it('un traspaso interno no se reclasifica: se cuenta aparte y se devuelve', async () => {
      const hogar = await nuevoHogar('traspaso')
      await withTenant(app, hogar.tenantId, async (client) => {
        const traspaso = await asentarTraspaso(client, hogar, 50000n)
        const gasto = await asentar(client, hogar, { description: 'IBERDROLA', amount: -12045n })
        const antes = await postingsDe(client, traspaso)

        const resultado = await reclassify(client, {
          entryIds: [traspaso, gasto],
          categoryId: hogar.luz,
          changedBy: AUTOR,
        })

        expect(resultado.changed).toBe(1)
        expect(resultado.omitidos).toEqual([{ entryId: traspaso, motivo: 'sin-contrapartida' }])
        // Y sobre todo: no se tocó ninguna de sus dos patas.
        expect(await postingsDe(client, traspaso)).toEqual(antes)
        expect(await auditoriaDe(client, traspaso)).toEqual([])
      })
    })

    it('un asiento repartido entre varias categorías no se aplasta a una sola', async () => {
      const hogar = await nuevoHogar('reparto')
      await withTenant(app, hogar.tenantId, async (client) => {
        const reparto = await asentarReparto(client, hogar)
        const antes = await postingsDe(client, reparto)

        const resultado = await reclassify(client, {
          entryIds: [reparto],
          categoryId: hogar.luz,
          changedBy: AUTOR,
        })

        expect(resultado.changed).toBe(0)
        expect(resultado.omitidos).toEqual([{ entryId: reparto, motivo: 'reparto' }])
        expect(await postingsDe(client, reparto)).toEqual(antes)
      })
    })

    it('lo que ya estaba en esa categoría no se cuenta como cambio ni se audita', async () => {
      const hogar = await nuevoHogar('ya-estaba')
      await withTenant(app, hogar.tenantId, async (client) => {
        const entryId = await asentar(client, hogar, {
          description: 'IBERDROLA',
          amount: -12045n,
          categoria: hogar.luz,
        })

        const resultado = await reclassify(client, {
          entryIds: [entryId],
          categoryId: hogar.luz,
          changedBy: AUTOR,
        })

        expect(resultado).toEqual({ changed: 0, yaEstaban: 1, omitidos: [] })
        expect(await auditoriaDe(client, entryId)).toEqual([])
      })
    })

    it('una cuenta de activo no es una categoría y se rechaza con un mensaje que lo dice', async () => {
      const hogar = await nuevoHogar('no-categoria')
      await withTenant(app, hogar.tenantId, async (client) => {
        const entryId = await asentar(client, hogar, { description: 'X', amount: -100n })
        await expect(
          reclassify(client, {
            entryIds: [entryId],
            categoryId: hogar.ahorro,
            changedBy: AUTOR,
          }),
        ).rejects.toThrow(/no una categoría/)
      })
    })

    it('sin autor no se reclasifica: la auditoría tiene que poder decir quién', async () => {
      const hogar = await nuevoHogar('sin-autor')
      await withTenant(app, hogar.tenantId, async (client) => {
        const entryId = await asentar(client, hogar, { description: 'X', amount: -100n })
        await expect(
          reclassify(client, { entryIds: [entryId], categoryId: hogar.luz, changedBy: '  ' }),
        ).rejects.toThrow(ClassifyError)
      })
    })
  })

  // ── Dimensiones ───────────────────────────────────────────────────────────

  describe('dimensiones', () => {
    it('reemplaza las dimensiones indicadas y deja intactas las demás', async () => {
      const hogar = await nuevoHogar('dim-reemplazo')
      await withTenant(app, hogar.tenantId, async (client) => {
        const entryId = await asentar(client, hogar, { description: 'OBRA', amount: -50000n })

        await setDimensions(client, {
          entryIds: [entryId],
          assignments: [
            { dimensionId: hogar.dimPropiedad, dimensionValueId: hogar.madrid },
            { dimensionId: hogar.dimEntidad, dimensionValueId: hogar.personal, weightPpm: 600_000 },
            { dimensionId: hogar.dimEntidad, dimensionValueId: hogar.sociedad, weightPpm: 400_000 },
          ],
          changedBy: AUTOR,
        })

        // Sólo se toca la propiedad: el 60/40 de entidad tiene que sobrevivir.
        const resultado = await setDimensions(client, {
          entryIds: [entryId],
          assignments: [{ dimensionId: hogar.dimPropiedad, dimensionValueId: hogar.lisboa }],
          changedBy: AUTOR,
        })
        expect(resultado.changed).toBe(1)

        const dims = await dimensionesDe(client, entryId)
        expect(dims).toEqual(
          expect.arrayContaining([
            { dimension: hogar.dimPropiedad, valor: hogar.lisboa, ppm: 1_000_000 },
            { dimension: hogar.dimEntidad, valor: hogar.personal, ppm: 600_000 },
            { dimension: hogar.dimEntidad, valor: hogar.sociedad, ppm: 400_000 },
          ]),
        )
        expect(dims).toHaveLength(3)
      })
    })

    it('cuelga la atribución de la pata de categoría, no de la bancaria', async () => {
      const hogar = await nuevoHogar('dim-pata')
      await withTenant(app, hogar.tenantId, async (client) => {
        const entryId = await asentar(client, hogar, { description: 'OBRA', amount: -50000n })
        await setDimensions(client, {
          entryIds: [entryId],
          assignments: [{ dimensionId: hogar.dimPropiedad, dimensionValueId: hogar.madrid }],
          changedBy: AUTOR,
        })

        const { rows } = await client.query<{ ordinal: number }>(
          `select p.ordinal from posting_dimension pd
             join posting p on p.id = pd.posting_id
            where p.entry_id = $1`,
          [entryId],
        )
        expect(rows.map((row) => row.ordinal)).toEqual([1])
      })
    })

    it('un valor en null quita esa dimensión y no toca las otras', async () => {
      const hogar = await nuevoHogar('dim-quitar')
      await withTenant(app, hogar.tenantId, async (client) => {
        const entryId = await asentar(client, hogar, { description: 'OBRA', amount: -50000n })
        await setDimensions(client, {
          entryIds: [entryId],
          assignments: [
            { dimensionId: hogar.dimPropiedad, dimensionValueId: hogar.madrid },
            { dimensionId: hogar.dimEntidad, dimensionValueId: hogar.personal },
          ],
          changedBy: AUTOR,
        })

        await setDimensions(client, {
          entryIds: [entryId],
          assignments: [{ dimensionId: hogar.dimPropiedad, dimensionValueId: null }],
          changedBy: AUTOR,
        })

        expect(await dimensionesDe(client, entryId)).toEqual([
          { dimension: hogar.dimEntidad, valor: hogar.personal, ppm: 1_000_000 },
        ])
      })
    })

    it('los pesos de una misma dimensión que suman más de 1.000.000 se rechazan', async () => {
      const hogar = await nuevoHogar('dim-pesos')
      await withTenant(app, hogar.tenantId, async (client) => {
        const entryId = await asentar(client, hogar, { description: 'OBRA', amount: -50000n })
        await expect(
          setDimensions(client, {
            entryIds: [entryId],
            assignments: [
              {
                dimensionId: hogar.dimEntidad,
                dimensionValueId: hogar.personal,
                weightPpm: 600_000,
              },
              {
                dimensionId: hogar.dimEntidad,
                dimensionValueId: hogar.sociedad,
                weightPpm: 500_000,
              },
            ],
            changedBy: AUTOR,
          }),
        ).rejects.toThrow(/1100000 ppm/)

        // Y no dejó nada a medio escribir.
        expect(await dimensionesDe(client, entryId)).toEqual([])
      })
    })

    it('un valor que pertenece a otra dimensión se rechaza antes de llegar a la base', async () => {
      const hogar = await nuevoHogar('dim-cruzada')
      await withTenant(app, hogar.tenantId, async (client) => {
        const entryId = await asentar(client, hogar, { description: 'OBRA', amount: -50000n })
        // La base aceptaría el cruce: hay una FK a dimension y otra a
        // dimension_value, pero ninguna que las ate entre sí.
        await expect(
          setDimensions(client, {
            entryIds: [entryId],
            assignments: [{ dimensionId: hogar.dimPropiedad, dimensionValueId: hogar.personal }],
            changedBy: AUTOR,
          }),
        ).rejects.toThrow(/pertenece a la dimensión/)
      })
    })

    it('un traspaso interno tampoco recibe dimensiones y se devuelve', async () => {
      const hogar = await nuevoHogar('dim-traspaso')
      await withTenant(app, hogar.tenantId, async (client) => {
        const traspaso = await asentarTraspaso(client, hogar, 50000n)
        const resultado = await setDimensions(client, {
          entryIds: [traspaso],
          assignments: [{ dimensionId: hogar.dimPropiedad, dimensionValueId: hogar.madrid }],
          changedBy: AUTOR,
        })
        expect(resultado).toEqual({
          changed: 0,
          omitidos: [{ entryId: traspaso, motivo: 'sin-contrapartida' }],
        })
        expect(await dimensionesDe(client, traspaso)).toEqual([])
      })
    })
  })

  // ── Reglas ────────────────────────────────────────────────────────────────

  describe('reglas', () => {
    it("un '%' literal en el texto no convierte la regla en un comodín", async () => {
      const hogar = await nuevoHogar('like-escapado')
      await withTenant(app, hogar.tenantId, async (client) => {
        const exacto = await asentar(client, hogar, {
          description: 'DESCUENTO 100% FARMACIA',
          amount: -1000n,
        })
        await asentar(client, hogar, { description: 'PEAJE 1005 CAJA', amount: -500n })

        const vista = await previewRule(client, { matchKind: 'contiene', matchValue: '100%' })
        expect(vista.total).toBe(1)
        expect(vista.muestra.map((fila) => fila.entryId)).toEqual([exacto])
      })
    })

    it("'empieza' no coincide en medio del descriptor", async () => {
      const hogar = await nuevoHogar('empieza')
      await withTenant(app, hogar.tenantId, async (client) => {
        const alPrincipio = await asentar(client, hogar, {
          description: 'IBERDROLA CLIENTES SAU',
          amount: -12045n,
        })
        await asentar(client, hogar, { description: 'RECIBO IBERDROLA', amount: -9000n })

        const vista = await previewRule(client, { matchKind: 'empieza', matchValue: 'IBERDROLA' })
        expect(vista.total).toBe(1)
        expect(vista.muestra[0]?.entryId).toBe(alPrincipio)
      })
    })

    it('una expresión regular inválida da un error legible y deja la transacción usable', async () => {
      const hogar = await nuevoHogar('regex-invalida')
      await withTenant(app, hogar.tenantId, async (client) => {
        await asentar(client, hogar, { description: 'IBERDROLA', amount: -12045n })

        await expect(
          previewRule(client, { matchKind: 'regex', matchValue: 'FACTURA(' }),
        ).rejects.toThrow(/no es válida/)

        // Lo que hace el savepoint: sin él, la transacción quedaría abortada y
        // cualquier consulta posterior fallaría con un error que no dice nada.
        const vista = await previewRule(client, { matchKind: 'contiene', matchValue: 'IBERDROLA' })
        expect(vista.total).toBe(1)
      })
    })

    it('una expresión regular con un cuantificador dentro de otro se rechaza al crearla', async () => {
      const hogar = await nuevoHogar('regex-anidada')
      await withTenant(app, hogar.tenantId, async (client) => {
        await expect(
          createRule(client, {
            name: 'Peligrosa',
            matchKind: 'regex',
            matchValue: '(a+)+b',
            categoryId: hogar.luz,
          }),
        ).rejects.toThrow(/cuantificador dentro de otro/)
      })
    })

    it('una regla que no manda a ninguna categoría ni pone dimensiones no se guarda', async () => {
      const hogar = await nuevoHogar('regla-vacia')
      await withTenant(app, hogar.tenantId, async (client) => {
        await expect(
          createRule(client, { name: 'No hace nada', matchKind: 'contiene', matchValue: 'X' }),
        ).rejects.toThrow(/no hace nada/i)
      })
    })

    it('guarda, lista, modifica y borra una regla con sus dimensiones', async () => {
      const hogar = await nuevoHogar('crud')
      await withTenant(app, hogar.tenantId, async (client) => {
        const creada = await createRule(client, {
          name: 'Luz de Madrid',
          matchKind: 'contiene',
          matchValue: 'IBERDROLA',
          categoryId: hogar.luz,
          accountId: hogar.banco,
          minAmount: -50000n,
          maxAmount: -100n,
          priority: 10,
          createdBy: AUTOR,
          dimensions: [{ dimensionId: hogar.dimPropiedad, dimensionValueId: hogar.madrid }],
        })

        expect(creada.matchValue).toBe('IBERDROLA')
        expect(creada.category).toBe('Luz')
        expect(creada.accountName).toBe('BBVA Corriente')
        expect(creada.minAmount).toBe(-50000n)
        expect(creada.dimensions).toEqual([
          {
            dimensionId: hogar.dimPropiedad,
            key: 'propiedad',
            label: 'Propiedad',
            valueId: hogar.madrid,
            value: 'Casa Madrid',
            weightPpm: 1_000_000,
          },
        ])

        const modificada = await updateRule(client, creada.id, {
          matchValue: 'IBERDROLA CLIENTES',
          dimensions: [{ dimensionId: hogar.dimPropiedad, dimensionValueId: hogar.lisboa }],
        })
        expect(modificada.matchValue).toBe('IBERDROLA CLIENTES')
        expect(modificada.dimensions[0]?.value).toBe('Piso Lisboa')
        // Lo que no venía en el parche no se toca.
        expect(modificada.categoryId).toBe(hogar.luz)
        expect(modificada.priority).toBe(10)

        expect(await listRules(client, {})).toHaveLength(1)
        expect(await deleteRule(client, creada.id)).toEqual({ deleted: true })
        expect(await listRules(client, {})).toEqual([])
      })
    })

    it('la vista previa cuenta el impacto y avisa de los que ya estaban clasificados a mano', async () => {
      const hogar = await nuevoHogar('preview')
      await withTenant(app, hogar.tenantId, async (client) => {
        for (let i = 0; i < 5; i += 1) {
          await asentar(client, hogar, { description: `IBERDROLA ${i}`, amount: -12045n })
        }
        // Dos que alguien ya categorizó a mano: son los que se perderían.
        await asentar(client, hogar, {
          description: 'IBERDROLA manual A',
          amount: -12045n,
          categoria: hogar.restaurantes,
        })
        await asentar(client, hogar, {
          description: 'IBERDROLA manual B',
          amount: -12045n,
          categoria: hogar.restaurantes,
        })

        const vista = await previewRule(client, {
          matchKind: 'contiene',
          matchValue: 'IBERDROLA',
        })
        expect(vista.total).toBe(7)
        expect(vista.yaClasificados).toBe(2)
        expect(vista.omitidos).toBe(0)
        expect(vista.muestra).toHaveLength(7)
        // La muestra trae la categoría actual: es el "antes" del diff.
        expect(vista.muestra.some((fila) => fila.category === 'Restaurantes')).toBe(true)
      })
    })

    it('una regla limitada a una cuenta no alcanza a las demás', async () => {
      const hogar = await nuevoHogar('regla-cuenta')
      await withTenant(app, hogar.tenantId, async (client) => {
        const enBanco = await asentar(client, hogar, { description: 'AMAZON', amount: -3000n })
        await asentar(client, hogar, {
          description: 'AMAZON',
          amount: -3000n,
          cuenta: hogar.tarjeta,
        })

        const vista = await previewRule(client, {
          matchKind: 'contiene',
          matchValue: 'AMAZON',
          accountId: hogar.banco,
        })
        expect(vista.total).toBe(1)
        expect(vista.muestra[0]?.entryId).toBe(enBanco)
      })
    })

    it('el rango de importe se compara con signo, como aparece en el extracto', async () => {
      const hogar = await nuevoHogar('rango')
      await withTenant(app, hogar.tenantId, async (client) => {
        const pequeno = await asentar(client, hogar, { description: 'AMAZON', amount: -3000n })
        await asentar(client, hogar, { description: 'AMAZON', amount: -90000n })
        await asentar(client, hogar, { description: 'AMAZON', amount: 3000n })

        // "cargos de hasta 100 €" es −10000..0 con signo, no 0..10000.
        const vista = await previewRule(client, {
          matchKind: 'contiene',
          matchValue: 'AMAZON',
          minAmount: -10000n,
          maxAmount: -1n,
        })
        expect(vista.total).toBe(1)
        expect(vista.muestra[0]?.entryId).toBe(pequeno)
      })
    })

    it('un rango invertido se rechaza en vez de devolver cero movimientos', async () => {
      const hogar = await nuevoHogar('rango-invertido')
      await withTenant(app, hogar.tenantId, async (client) => {
        await expect(
          createRule(client, {
            name: 'Al revés',
            matchKind: 'contiene',
            matchValue: 'AMAZON',
            categoryId: hogar.luz,
            minAmount: 1000n,
            maxAmount: -1000n,
          }),
        ).rejects.toThrow(/al revés/)
      })
    })
  })

  // ── Aplicar ───────────────────────────────────────────────────────────────

  describe('aplicar', () => {
    it('aplica la categoría y las dimensiones de la regla, y firma la auditoría con ella', async () => {
      const hogar = await nuevoHogar('aplicar')
      await withTenant(app, hogar.tenantId, async (client) => {
        const entryId = await asentar(client, hogar, {
          description: 'IBERDROLA CLIENTES',
          amount: -12045n,
        })
        const regla = await createRule(client, {
          name: 'Luz',
          matchKind: 'contiene',
          matchValue: 'IBERDROLA',
          categoryId: hogar.luz,
          dimensions: [{ dimensionId: hogar.dimPropiedad, dimensionValueId: hogar.madrid }],
          createdBy: AUTOR,
        })

        const resultado = await applyRule(client, regla.id, {
          soloSinCategorizar: true,
          changedBy: AUTOR,
        })
        expect(resultado.changed).toBe(1)

        const postings = await postingsDe(client, entryId)
        expect(postings[1]?.accountId).toBe(hogar.luz)
        expect(await dimensionesDe(client, entryId)).toEqual([
          { dimension: hogar.dimPropiedad, valor: hogar.madrid, ppm: 1_000_000 },
        ])
        const auditoria = await auditoriaDe(client, entryId)
        expect(auditoria[0]).toEqual({
          from: hogar.sinCategorizar,
          to: hogar.luz,
          rule: regla.id,
          by: AUTOR,
        })
        expect(await desbalanceados(client)).toEqual([])
      })
    })

    it('con soloSinCategorizar no pisa lo que alguien ya clasificó a mano', async () => {
      const hogar = await nuevoHogar('no-pisar')
      await withTenant(app, hogar.tenantId, async (client) => {
        const aMano = await asentar(client, hogar, {
          description: 'IBERDROLA manual',
          amount: -12045n,
          categoria: hogar.restaurantes,
        })
        const pendiente = await asentar(client, hogar, {
          description: 'IBERDROLA pendiente',
          amount: -12045n,
        })
        const regla = await createRule(client, {
          name: 'Luz',
          matchKind: 'contiene',
          matchValue: 'IBERDROLA',
          categoryId: hogar.luz,
        })

        const resultado = await applyRule(client, regla.id, {
          soloSinCategorizar: true,
          changedBy: AUTOR,
        })

        expect(resultado.changed).toBe(1)
        expect((await postingsDe(client, aMano))[1]?.accountId).toBe(hogar.restaurantes)
        expect((await postingsDe(client, pendiente))[1]?.accountId).toBe(hogar.luz)
      })
    })

    it('con soloSinCategorizar en false reclasifica también lo ya categorizado', async () => {
      const hogar = await nuevoHogar('pisar')
      await withTenant(app, hogar.tenantId, async (client) => {
        const aMano = await asentar(client, hogar, {
          description: 'IBERDROLA manual',
          amount: -12045n,
          categoria: hogar.restaurantes,
        })
        const regla = await createRule(client, {
          name: 'Luz',
          matchKind: 'contiene',
          matchValue: 'IBERDROLA',
          categoryId: hogar.luz,
        })

        const resultado = await applyRule(client, regla.id, {
          soloSinCategorizar: false,
          changedBy: AUTOR,
        })
        expect(resultado.changed).toBe(1)
        expect((await postingsDe(client, aMano))[1]?.accountId).toBe(hogar.luz)
      })
    })

    it('cuando dos reglas coinciden, gana la de mayor prioridad', async () => {
      const hogar = await nuevoHogar('prioridad')
      await withTenant(app, hogar.tenantId, async (client) => {
        const entryId = await asentar(client, hogar, {
          description: 'IBERDROLA CLIENTES',
          amount: -12045n,
        })
        await createRule(client, {
          name: 'Cualquier recibo',
          matchKind: 'contiene',
          matchValue: 'IBERDROLA',
          categoryId: hogar.restaurantes,
          priority: 0,
        })
        const especifica = await createRule(client, {
          name: 'Luz de Iberdrola',
          matchKind: 'empieza',
          matchValue: 'IBERDROLA CLIENTES',
          categoryId: hogar.luz,
          priority: 100,
        })

        const resultado = await applyAllRules(client, { changedBy: AUTOR })

        expect(resultado.changed).toBe(1)
        expect(resultado.porRegla[0]).toEqual({
          ruleId: especifica.id,
          name: 'Luz de Iberdrola',
          changed: 1,
        })
        expect((await postingsDe(client, entryId))[1]?.accountId).toBe(hogar.luz)
        // Una sola anotación: el movimiento lo clasificó una regla, no dos.
        expect(await auditoriaDe(client, entryId)).toHaveLength(1)
      })
    })

    it('acotada a los asientos de un alta, la pasada no toca el resto del libro', async () => {
      const hogar = await nuevoHogar('alta')
      await withTenant(app, hogar.tenantId, async (client) => {
        const viejo = await asentar(client, hogar, {
          description: 'IBERDROLA viejo',
          amount: -12045n,
        })
        const nuevo = await asentar(client, hogar, {
          description: 'IBERDROLA nuevo',
          amount: -12045n,
        })
        await createRule(client, {
          name: 'Luz',
          matchKind: 'contiene',
          matchValue: 'IBERDROLA',
          categoryId: hogar.luz,
        })

        const resultado = await applyAllRules(client, { entryIds: [nuevo], changedBy: AUTOR })

        expect(resultado.changed).toBe(1)
        expect((await postingsDe(client, nuevo))[1]?.accountId).toBe(hogar.luz)
        expect((await postingsDe(client, viejo))[1]?.accountId).toBe(hogar.sinCategorizar)
      })
    })

    it('una regla rota no tira la pasada: se informa y las demás se aplican', async () => {
      const hogar = await nuevoHogar('regla-rota')
      await withTenant(app, hogar.tenantId, async (client) => {
        const entryId = await asentar(client, hogar, {
          description: 'IBERDROLA CLIENTES',
          amount: -12045n,
        })
        // Una expresión inválida no se puede crear con createRule, así que se
        // escribe a mano: es el caso de una regla que entró por otra vía.
        const rota = await client.query<{ id: string }>(
          `insert into rule (tenant_id, name, match_kind, match_value, category_id, priority)
           values ($1, 'Rota', 'regex', 'FACTURA(', $2, 100) returning id`,
          [hogar.tenantId, hogar.restaurantes],
        )
        await createRule(client, {
          name: 'Luz',
          matchKind: 'contiene',
          matchValue: 'IBERDROLA',
          categoryId: hogar.luz,
          priority: 10,
        })

        const resultado = await applyAllRules(client, { changedBy: AUTOR })

        expect(resultado.fallidas).toEqual([
          { ruleId: rota.rows[0]?.id, name: 'Rota', error: expect.stringContaining('invalid') },
        ])
        expect(resultado.changed).toBe(1)
        expect((await postingsDe(client, entryId))[1]?.accountId).toBe(hogar.luz)
      })
    })

    it('una regla que sólo pone dimensiones no impide que otra ponga la categoría', async () => {
      const hogar = await nuevoHogar('dimension-no-reclama')
      await withTenant(app, hogar.tenantId, async (client) => {
        const entryId = await asentar(client, hogar, { description: 'IBERDROLA', amount: -12045n })
        // La de mayor prioridad sólo atribuye: no decide ninguna categoría, así
        // que no puede quedarse con el movimiento.
        await createRule(client, {
          name: 'Todo lo de Iberdrola es de Madrid',
          matchKind: 'contiene',
          matchValue: 'IBERDROLA',
          priority: 100,
          dimensions: [{ dimensionId: hogar.dimPropiedad, dimensionValueId: hogar.madrid }],
        })
        await createRule(client, {
          name: 'Luz',
          matchKind: 'contiene',
          matchValue: 'IBERDROLA',
          categoryId: hogar.luz,
          priority: 0,
        })

        const resultado = await applyAllRules(client, { changedBy: AUTOR })

        // Las dos hicieron su trabajo sobre el mismo movimiento...
        expect((await postingsDe(client, entryId))[1]?.accountId).toBe(hogar.luz)
        expect(await dimensionesDe(client, entryId)).toEqual([
          { dimension: hogar.dimPropiedad, valor: hogar.madrid, ppm: 1_000_000 },
        ])
        expect(resultado.porRegla.map((r) => r.changed)).toEqual([1, 1])
        // ...y aun así el movimiento cambiado es UNO, no dos.
        expect(resultado.changed).toBe(1)
      })
    })

    it('una regla de atribución no le pisa la dimensión a otra de más prioridad', async () => {
      const hogar = await nuevoHogar('dimension-prioridad')
      await withTenant(app, hogar.tenantId, async (client) => {
        const entryId = await asentar(client, hogar, { description: 'IBERDROLA', amount: -12045n })
        await createRule(client, {
          name: 'Manda Madrid',
          matchKind: 'contiene',
          matchValue: 'IBERDROLA',
          priority: 100,
          dimensions: [{ dimensionId: hogar.dimPropiedad, dimensionValueId: hogar.madrid }],
        })
        await createRule(client, {
          name: 'Dice Lisboa',
          matchKind: 'contiene',
          matchValue: 'IBERDROLA',
          priority: 1,
          dimensions: [{ dimensionId: hogar.dimPropiedad, dimensionValueId: hogar.lisboa }],
        })

        await applyAllRules(client, { changedBy: AUTOR })

        expect(await dimensionesDe(client, entryId)).toEqual([
          { dimension: hogar.dimPropiedad, valor: hogar.madrid, ppm: 1_000_000 },
        ])
      })
    })

    it('una regla desactivada no entra en la pasada automática', async () => {
      const hogar = await nuevoHogar('desactivada')
      await withTenant(app, hogar.tenantId, async (client) => {
        const entryId = await asentar(client, hogar, { description: 'IBERDROLA', amount: -12045n })
        await createRule(client, {
          name: 'Luz apagada',
          matchKind: 'contiene',
          matchValue: 'IBERDROLA',
          categoryId: hogar.luz,
          enabled: false,
        })

        const resultado = await applyAllRules(client, { changedBy: AUTOR })
        expect(resultado).toEqual({ changed: 0, porRegla: [], fallidas: [] })
        expect((await postingsDe(client, entryId))[1]?.accountId).toBe(hogar.sinCategorizar)
      })
    })
  })

  // ── Lo que falta por categorizar ──────────────────────────────────────────

  describe('sin categorizar', () => {
    it('agrupa los descriptores por comercio y los ordena por impacto', async () => {
      const hogar = await nuevoHogar('pendientes')
      await withTenant(app, hogar.tenantId, async (client) => {
        // Mismo comercio, referencias distintas: tienen que caer en un grupo.
        // Se siembran al revés a propósito: el descriptor de ejemplo se elige
        // por su contenido y no por el orden en que la base devuelva las filas,
        // que no está garantizado.
        await asentar(client, hogar, { description: 'NETFLIX REF 9903', amount: -1599n })
        await asentar(client, hogar, { description: 'NETFLIX REF 8812', amount: -1599n })
        await asentar(client, hogar, { description: 'SEGURO HOGAR', amount: -48000n })
        // Ya categorizado: no es trabajo pendiente.
        await asentar(client, hogar, {
          description: 'IBERDROLA',
          amount: -12045n,
          categoria: hogar.luz,
        })
        // Un traspaso tampoco es trabajo pendiente.
        await asentarTraspaso(client, hogar, 50000n)

        const pendiente = await uncategorized(client, {})

        expect(pendiente.total).toBe(3)
        expect(pendiente.porComercio).toEqual([
          {
            descripcion: 'SEGURO HOGAR',
            ejemplo: 'SEGURO HOGAR',
            veces: 1,
            importe: -48000n,
            currency: 'EUR',
          },
          {
            descripcion: 'NETFLIX',
            ejemplo: 'NETFLIX REF 8812',
            veces: 2,
            importe: -3198n,
            currency: 'EUR',
          },
        ])
      })
    })
  })

  // ── El invariante, sobre el hogar entero ──────────────────────────────────

  /**
   * Los dos tests de arriba miran un asiento cada uno. Éste mira el libro
   * completo después de una pasada masiva, que es donde aparecen los fallos que
   * un caso suelto no enseña: el asiento de tres patas, el que cruza dos
   * monedas contra una cuenta de trading, el traspaso y el saldo de apertura,
   * todos a la vez y contra la misma sentencia.
   */
  describe('invariantes del hogar entero', () => {
    it('tras reclasificar en masa, todos los asientos siguen balanceando a cero', async () => {
      const hogar = await nuevoHogar('invariantes')
      await withTenant(app, hogar.tenantId, async (client) => {
        const cuenta = async (kind: string, name: string, currency: string): Promise<string> => {
          const { rows } = await client.query<{ id: string }>(
            `insert into account (tenant_id, kind, name, currency)
             values ($1, $2::account_kind, $3, $4) returning id`,
            [hogar.tenantId, kind, name, currency],
          )
          return unico(rows, 'account').id
        }
        const dolares = await cuenta('asset', 'Chase Checking', 'USD')
        const tradingUsd = await cuenta('trading', 'Trading USD', 'USD')
        const tradingEur = await cuenta('trading', 'Trading EUR', 'EUR')
        const apertura = await cuenta('equity', 'Saldo de apertura', 'EUR')

        // Cuarenta movimientos corrientes: el volumen es parte del caso, porque
        // es lo que hace que la reclasificación sea una sentencia y no cuarenta.
        for (let i = 0; i < 40; i += 1) {
          await asentar(client, hogar, {
            description: `COMPRA ${i} SUPERMERCADO`,
            amount: BigInt(-100 * (i + 1)),
            on: `2026-03-${String((i % 28) + 1).padStart(2, '0')}`,
          })
        }
        await asentar(client, hogar, {
          description: 'NOMINA',
          amount: 250000n,
          categoria: hogar.nomina,
        })
        await asentarTraspaso(client, hogar, 50000n)
        await asentarReparto(client, hogar)

        // Un cargo en dólares que cierra contra las cuentas de trading: cuatro
        // patas, dos monedas, y una sola pata de gasto.
        const { rows: multiRows } = await client.query<{ id: string }>(
          `insert into entry (tenant_id, booked_on, description, source)
           values ($1, '2026-03-20', 'AMAZON US', 'file') returning id`,
          [hogar.tenantId],
        )
        const multi = unico(multiRows, 'entry').id
        await client.query(
          `insert into posting (tenant_id, entry_id, account_id, ordinal, amount, currency)
           select $1::uuid, $2::uuid, p.account_id, p.ordinal, p.amount, p.currency
             from unnest($3::uuid[], $4::smallint[], $5::bigint[], $6::text[])
                  as p(account_id, ordinal, amount, currency)`,
          [
            hogar.tenantId,
            multi,
            [dolares, tradingUsd, tradingEur, hogar.sinCategorizar],
            [0, 1, 2, 3],
            ['-10000', '10000', '-9200', '9200'],
            ['USD', 'USD', 'EUR', 'EUR'],
          ],
        )

        // Un saldo de apertura: sin pata de gasto ni de ingreso.
        const { rows: aperturaRows } = await client.query<{ id: string }>(
          `insert into entry (tenant_id, booked_on, description, source)
           values ($1, '2026-01-01', 'Saldo inicial', 'manual') returning id`,
          [hogar.tenantId],
        )
        const inicial = unico(aperturaRows, 'entry').id
        await client.query(
          `insert into posting (tenant_id, entry_id, account_id, ordinal, amount, currency)
           values ($1, $2, $3, 0, 1000000, 'EUR'), ($1, $2, $4, 1, -1000000, 'EUR')`,
          [hogar.tenantId, inicial, hogar.banco, apertura],
        )

        const antes = await fotoDelHecho(client)
        expect(await desbalanceados(client)).toEqual([])

        const { rows: todos } = await client.query<{ id: string }>('select id from entry')
        const ids = todos.map((row) => row.id)

        // Primera pasada a mano, sobre todo el libro de una vez.
        const aMano = await reclassify(client, {
          entryIds: ids,
          categoryId: hogar.restaurantes,
          changedBy: AUTOR,
        })
        expect(await desbalanceados(client)).toEqual([])

        // Segunda pasada, esta vez por reglas y encima de lo ya clasificado.
        await createRule(client, {
          name: 'Todo a luz',
          matchKind: 'contiene',
          matchValue: 'A',
          categoryId: hogar.luz,
        })
        await createRule(client, {
          name: 'Todo a Madrid',
          matchKind: 'contiene',
          matchValue: 'A',
          priority: 50,
          dimensions: [{ dimensionId: hogar.dimPropiedad, dimensionValueId: hogar.madrid }],
        })
        await applyAllRules(client, { changedBy: AUTOR, soloSinCategorizar: false })

        // 1. Ningún asiento del hogar dejó de sumar cero dentro de su moneda.
        expect(await desbalanceados(client)).toEqual([])
        // 2. La pata bancaria y el asiento están exactamente como estaban.
        expect(await fotoDelHecho(client)).toEqual(antes)

        // Y lo que se apartó se apartó por su motivo, no por casualidad: el
        // traspaso y la apertura no tienen categoría que cambiar, y el ticket
        // repartido se deja entero.
        const motivos = new Map(aMano.omitidos.map((o) => [o.entryId, o.motivo]))
        expect(motivos.get(inicial)).toBe('sin-contrapartida')
        expect(aMano.omitidos.filter((o) => o.motivo === 'reparto')).toHaveLength(1)
        expect(aMano.changed).toBe(ids.length - aMano.omitidos.length)
        // El multimoneda sí se reclasificó: tiene una sola pata de gasto.
        expect(motivos.has(multi)).toBe(false)
      })
    })
  })

  // ── Aislamiento ───────────────────────────────────────────────────────────

  describe('aislamiento entre hogares', () => {
    it('las reglas y los movimientos de un hogar no alcanzan a los del otro', async () => {
      const uno = await nuevoHogar('aislamiento-uno')
      const otro = await nuevoHogar('aislamiento-otro')

      const ajeno = await withTenant(app, otro.tenantId, async (client) => {
        const entryId = await asentar(client, otro, {
          description: 'IBERDROLA CLIENTES',
          amount: -12045n,
        })
        await createRule(client, {
          name: 'Regla del otro hogar',
          matchKind: 'contiene',
          matchValue: 'IBERDROLA',
          categoryId: otro.luz,
        })
        return entryId
      })

      await withTenant(app, uno.tenantId, async (client) => {
        const propio = await asentar(client, uno, {
          description: 'IBERDROLA CLIENTES',
          amount: -12045n,
        })

        // Ni ve la regla del otro...
        expect(await listRules(client, {})).toEqual([])
        // ...ni cuenta sus movimientos...
        const vista = await previewRule(client, { matchKind: 'contiene', matchValue: 'IBERDROLA' })
        expect(vista.total).toBe(1)
        expect(vista.muestra[0]?.entryId).toBe(propio)
        // ...ni puede reclasificarlos aunque tenga el id en la mano.
        const resultado = await reclassify(client, {
          entryIds: [ajeno],
          categoryId: uno.luz,
          changedBy: AUTOR,
        })
        expect(resultado).toEqual({
          changed: 0,
          yaEstaban: 0,
          omitidos: [{ entryId: ajeno, motivo: 'inexistente' }],
        })
      })

      // El movimiento del otro hogar sigue donde estaba.
      await withTenant(app, otro.tenantId, async (client) => {
        expect((await postingsDe(client, ajeno))[1]?.accountId).toBe(otro.sinCategorizar)
        expect(await auditoriaDe(client, ajeno)).toEqual([])
      })
    })
  })
})
