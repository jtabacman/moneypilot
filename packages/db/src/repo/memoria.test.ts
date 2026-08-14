/**
 * La memoria del hogar, contra una base de verdad.
 *
 * Lo que hay que demostrar acá no es que agrupe: es que **no aprenda de lo que
 * no debe**. Una regla, un automatismo o un "mandalo a Sin categorizar" no son
 * decisiones del hogar, y si se colaran, la memoria se convertiría en un
 * repetidor de sus propios errores con cara de haber aprendido algo.
 *
 * Por eso las decisiones de los tests se escriben llamando a `reclassify`, que
 * es el camino real: si mañana la auditoría cambia de forma, estos tests se
 * enteran. Insertar las filas de `classification_change` a mano probaría que el
 * agrupador sabe agrupar filas que yo misma inventé.
 *
 * Cada bloque monta su propio hogar: la memoria es estado compartido dentro del
 * hogar, y un test que deja una decisión puesta cambia el resultado del
 * siguiente.
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
import { applyRule, createRule, reclassify, setDimensions } from './classify.js'
import {
  autorAutomatico,
  MemoriaError,
  proponerPorMemoria,
  recordarPorComercio,
} from './memoria.js'

const ADMIN_URL = process.env['DATABASE_URL']
const APP_URL = process.env['DATABASE_APP_URL']
const enabled = ADMIN_URL !== undefined && APP_URL !== undefined
const suite = enabled ? describe : describe.skip

const hash = (seed: string): string => createHash('sha256').update(seed).digest('hex')

/** Sufijo por corrida: otros agentes están usando la misma base al mismo tiempo. */
const RUN = hash(`${process.pid}-${Date.now()}-${Math.random()}`).slice(0, 12)

const ANA = 'ana@ejemplo.test'
const LUIS = 'luis@ejemplo.test'

// ── Utilidades ──────────────────────────────────────────────────────────────

function unico<T>(rows: readonly T[], what: string): T {
  const row = rows[0]
  if (row === undefined) throw new Error(`Se esperaba una fila de ${what}`)
  return row
}

interface Hogar {
  readonly tenantId: string
  readonly banco: string
  readonly sinCategorizar: string
  readonly luz: string
  readonly supermercado: string
  readonly oficina: string
  readonly dimPropiedad: string
  readonly madrid: string
  readonly lisboa: string
}

let admin: Db
let app: Db
const hogaresCreados: string[] = []

async function nuevoHogar(etiqueta: string): Promise<Hogar> {
  const hogar = await withoutTenantScope(admin, async (client) => {
    const tenant = await client.query<{ id: string }>(
      'insert into tenant (name, base_currency) values ($1, $2) returning id',
      [`Memoria ${RUN} ${etiqueta}`, 'EUR'],
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

    const { rows: dims } = await client.query<{ id: string }>(
      'insert into dimension (tenant_id, key, label) values ($1, $2, $3) returning id',
      [tenantId, 'propiedad', 'Propiedad'],
    )
    const dimPropiedad = unico(dims, 'dimension').id
    const valor = async (label: string): Promise<string> => {
      const { rows } = await client.query<{ id: string }>(
        'insert into dimension_value (tenant_id, dimension_id, label) values ($1, $2, $3) returning id',
        [tenantId, dimPropiedad, label],
      )
      return unico(rows, 'dimension_value').id
    }

    return {
      tenantId,
      banco: await cuenta('asset', 'BBVA Corriente'),
      // El nombre es el que pone el importador y por el que se reconoce la
      // bolsa: mandar algo ahí no es clasificar.
      sinCategorizar: await cuenta('expense', 'Sin categorizar (EUR)'),
      luz: await cuenta('expense', 'Luz'),
      supermercado: await cuenta('expense', 'Supermercado'),
      oficina: await cuenta('expense', 'Oficina'),
      dimPropiedad,
      madrid: await valor('Casa Madrid'),
      lisboa: await valor('Piso Lisboa'),
    }
  })
  hogaresCreados.push(hogar.tenantId)
  return hogar
}

/** Un movimiento con su pata bancaria y su contrapartida sin categorizar. */
async function asentar(
  client: TenantClient,
  hogar: Hogar,
  description: string,
  amount = -4520n,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into entry (tenant_id, booked_on, description, source)
     values ($1, '2026-03-14'::date, $2, 'file') returning id`,
    [hogar.tenantId, description],
  )
  const entryId = unico(rows, 'entry').id
  await client.query(
    `insert into posting (tenant_id, entry_id, account_id, ordinal, amount, currency)
     select $1::uuid, $2::uuid, p.account_id, p.ordinal, p.amount, 'EUR'
       from unnest($3::uuid[], $4::smallint[], $5::bigint[]) as p(account_id, ordinal, amount)`,
    [
      hogar.tenantId,
      entryId,
      [hogar.banco, hogar.sinCategorizar],
      [0, 1],
      [amount.toString(), (-amount).toString()],
    ],
  )
  return entryId
}

/**
 * N movimientos del mismo comercio, ya clasificados por una persona.
 *
 * Cada uno lleva su referencia, como los manda un banco de verdad, y es la
 * referencia lo que los distingue. No vale variar el descriptor de otra forma:
 * `merchantKey` conserva los números cortos a propósito —"STUDIO 54" es un
 * nombre— así que "MERCADONA 1000" y "MERCADONA 1001" serían dos comercios
 * distintos y la memoria contaría uno cada uno. La memoria agrupa exactamente
 * como agrupa `merchantKey`, ni más ni menos.
 */
async function decididos(
  client: TenantClient,
  hogar: Hogar,
  opts: { descripcion: string; cuantos: number; categoria: string; quien?: string },
): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < opts.cuantos; i += 1) {
    ids.push(await asentar(client, hogar, `${opts.descripcion} REF ${1000 + i}`))
  }
  await reclassify(client, {
    entryIds: ids,
    categoryId: opts.categoria,
    changedBy: opts.quien ?? ANA,
  })
  return ids
}

// ── Arranque ────────────────────────────────────────────────────────────────

suite('memoria del hogar', () => {
  beforeAll(async () => {
    await migrate(ADMIN_URL as string)
    admin = createPool({ connectionString: ADMIN_URL as string })
    app = createPool({ connectionString: APP_URL as string })
  }, 60_000)

  afterAll(async () => {
    if (hogaresCreados.length > 0) {
      await withoutTenantScope(admin, async (client) => {
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

  // ── Lo que cuenta y lo que no ─────────────────────────────────────────────

  describe('sólo cuenta lo que decidió una persona', () => {
    it('un hogar sin decisiones no recuerda nada', async () => {
      // El resultado honesto cuando no hay historia. Devolver algo acá sería
      // habérselo inventado.
      const hogar = await nuevoHogar('vacío')
      await withTenant(app, hogar.tenantId, async (client) => {
        await asentar(client, hogar, 'MERCADONA 4021')
        expect(await recordarPorComercio(client)).toEqual([])
      })
    })

    it('tres decisiones de una persona sobre el mismo comercio se proponen solas', async () => {
      const hogar = await nuevoHogar('tres')
      await withTenant(app, hogar.tenantId, async (client) => {
        await decididos(client, hogar, {
          descripcion: 'IBERDROLA CLIENTES',
          cuantos: 3,
          categoria: hogar.luz,
        })

        const recuerdos = await recordarPorComercio(client)
        expect(recuerdos).toHaveLength(1)
        const recuerdo = unico(recuerdos, 'recuerdo')
        expect(recuerdo.clave).toBe('IBERDROLA CLIENTES')
        expect(recuerdo.veces).toBe(3)
        expect(recuerdo.unanime).toBe(true)
        expect(recuerdo.automatica?.categoryId).toBe(hogar.luz)
        expect(recuerdo.automatica?.categoria).toBe('Luz')
        // Los tres se clasificaron en la misma llamada: eso es UNA decisión, y
        // decirlo es la diferencia entre informar y adornar.
        expect(recuerdo.decisiones).toBe(1)
      })
    })

    it('lo que hizo una regla no es memoria del hogar', async () => {
      // La precaución que sostiene el módulo entero: si esto fallara, cada
      // pasada de reglas se confirmaría a sí misma y un error se volvería
      // "la verdad del hogar".
      const hogar = await nuevoHogar('regla')
      await withTenant(app, hogar.tenantId, async (client) => {
        for (let i = 0; i < 4; i += 1) await asentar(client, hogar, `IBERDROLA CLIENTES ${i}`)
        const regla = await createRule(client, {
          name: 'Luz',
          matchKind: 'contiene',
          matchValue: 'IBERDROLA',
          categoryId: hogar.luz,
        })
        const aplicada = await applyRule(client, regla.id, {
          soloSinCategorizar: true,
          changedBy: ANA,
        })
        expect(aplicada.changed).toBe(4)

        expect(await recordarPorComercio(client)).toEqual([])
      })
    })

    it('lo que hizo un automatismo tampoco, aunque no haya regla detrás', async () => {
      // Éste es el bucle de verdad: aplicar una propuesta de la memoria no crea
      // ninguna regla, así que `rule_id` sigue nulo. Lo único que lo distingue
      // de una persona es la firma.
      const hogar = await nuevoHogar('automatismo')
      await withTenant(app, hogar.tenantId, async (client) => {
        await decididos(client, hogar, {
          descripcion: 'MERCADONA',
          cuantos: 4,
          categoria: hogar.supermercado,
          quien: autorAutomatico('memoria'),
        })
        expect(await recordarPorComercio(client)).toEqual([])
      })
    })

    it('mandar algo a la bolsa de sin categorizar no enseña nada', async () => {
      // "No sé" no es una decisión sobre la categoría, y aprenderlo sería
      // aprender a no clasificar.
      const hogar = await nuevoHogar('bolsa')
      await withTenant(app, hogar.tenantId, async (client) => {
        const ids = await decididos(client, hogar, {
          descripcion: 'MERCADONA',
          cuantos: 3,
          categoria: hogar.supermercado,
        })
        await reclassify(client, {
          entryIds: ids,
          categoryId: hogar.sinCategorizar,
          changedBy: ANA,
        })
        expect(await recordarPorComercio(client)).toEqual([])
      })
    })

    it('sólo cuenta la última palabra: corregirse no deja el error en la memoria', async () => {
      // Sin esto, arreglar un despiste dejaría el comercio marcado como ambiguo
      // para siempre — y la unanimidad, que es la otra precaución, se volvería
      // inalcanzable en cuanto alguien se equivocara una vez.
      const hogar = await nuevoHogar('corrección')
      await withTenant(app, hogar.tenantId, async (client) => {
        const ids = await decididos(client, hogar, {
          descripcion: 'MERCADONA',
          cuantos: 3,
          categoria: hogar.oficina,
        })
        await reclassify(client, { entryIds: ids, categoryId: hogar.supermercado, changedBy: ANA })

        const recuerdo = unico(await recordarPorComercio(client), 'recuerdo')
        expect(recuerdo.unanime).toBe(true)
        expect(recuerdo.veces).toBe(3)
        expect(recuerdo.automatica?.categoryId).toBe(hogar.supermercado)
      })
    })
  })

  // ── Unanimidad ────────────────────────────────────────────────────────────

  describe('unanimidad', () => {
    it('un comercio que fue a dos categorías ofrece las dos y no propone ninguna', async () => {
      const hogar = await nuevoHogar('ambiguo')
      await withTenant(app, hogar.tenantId, async (client) => {
        await decididos(client, hogar, {
          descripcion: 'AMAZON EU',
          cuantos: 4,
          categoria: hogar.oficina,
        })
        await decididos(client, hogar, {
          descripcion: 'AMAZON EU',
          cuantos: 2,
          categoria: hogar.supermercado,
          quien: LUIS,
        })

        const recuerdo = unico(await recordarPorComercio(client), 'recuerdo')
        expect(recuerdo.unanime).toBe(false)
        expect(recuerdo.automatica).toBeNull()
        // Ordenadas por uso: la pantalla enseña primero la que más se repite.
        expect(recuerdo.opciones.map((opcion) => opcion.categoria)).toEqual([
          'Oficina',
          'Supermercado',
        ])
        expect(recuerdo.opciones.map((opcion) => opcion.veces)).toEqual([4, 2])
        expect(recuerdo.decisiones).toBe(2)
      })
    })

    it('el umbral es de producto y se puede mover', async () => {
      const hogar = await nuevoHogar('umbral')
      await withTenant(app, hogar.tenantId, async (client) => {
        await decididos(client, hogar, {
          descripcion: 'LIDL SUPERMERCADOS',
          cuantos: 2,
          categoria: hogar.supermercado,
        })

        const conTres = unico(await recordarPorComercio(client), 'recuerdo')
        expect(conTres.suficiente).toBe(false)
        expect(conTres.automatica).toBeNull()
        // Unánime pero corto: la diferencia importa porque la pantalla dice
        // cosas distintas ("te falta una" contra "elegí una").
        expect(conTres.unanime).toBe(true)

        const conDos = unico(await recordarPorComercio(client, { minimo: 2 }), 'recuerdo')
        expect(conDos.automatica?.categoryId).toBe(hogar.supermercado)
      })
    })

    it('un umbral de cero no se acepta', async () => {
      const hogar = await nuevoHogar('umbral cero')
      await withTenant(app, hogar.tenantId, async (client) => {
        await expect(recordarPorComercio(client, { minimo: 0 })).rejects.toBeInstanceOf(
          MemoriaError,
        )
      })
    })
  })

  // ── Dimensiones ───────────────────────────────────────────────────────────

  describe('las dimensiones viajan con la categoría', () => {
    it('propone la atribución cuando todos los movimientos recordados coinciden', async () => {
      const hogar = await nuevoHogar('dimensión')
      await withTenant(app, hogar.tenantId, async (client) => {
        const ids = await decididos(client, hogar, {
          descripcion: 'IBERDROLA CLIENTES',
          cuantos: 3,
          categoria: hogar.luz,
        })
        await setDimensions(client, {
          entryIds: ids,
          assignments: [{ dimensionId: hogar.dimPropiedad, dimensionValueId: hogar.madrid }],
          changedBy: ANA,
        })

        const recuerdo = unico(await recordarPorComercio(client), 'recuerdo')
        expect(recuerdo.automatica?.dimensiones).toEqual([
          {
            dimensionId: hogar.dimPropiedad,
            key: 'propiedad',
            label: 'Propiedad',
            valueId: hogar.madrid,
            value: 'Casa Madrid',
            weightPpm: 1_000_000,
          },
        ])
      })
    })

    it('si uno discrepa, esa dimensión no viaja y la categoría sí', async () => {
      // La luz de Madrid y la de Lisboa son el mismo comercio y la misma
      // categoría, y la propiedad la decide la factura. Proponer una de las dos
      // sería atribuirle a una casa el gasto de la otra.
      const hogar = await nuevoHogar('dimensión discrepante')
      await withTenant(app, hogar.tenantId, async (client) => {
        const ids = await decididos(client, hogar, {
          descripcion: 'IBERDROLA CLIENTES',
          cuantos: 3,
          categoria: hogar.luz,
        })
        const [primero, ...resto] = ids
        await setDimensions(client, {
          entryIds: resto,
          assignments: [{ dimensionId: hogar.dimPropiedad, dimensionValueId: hogar.madrid }],
          changedBy: ANA,
        })
        await setDimensions(client, {
          entryIds: [primero as string],
          assignments: [{ dimensionId: hogar.dimPropiedad, dimensionValueId: hogar.lisboa }],
          changedBy: ANA,
        })

        const recuerdo = unico(await recordarPorComercio(client), 'recuerdo')
        expect(recuerdo.automatica?.categoryId).toBe(hogar.luz)
        expect(recuerdo.automatica?.dimensiones).toEqual([])
      })
    })
  })

  // ── Proponer ──────────────────────────────────────────────────────────────

  describe('proponerPorMemoria', () => {
    it('propone para un movimiento nuevo del mismo comercio, con su motivo', async () => {
      const hogar = await nuevoHogar('propuesta')
      await withTenant(app, hogar.tenantId, async (client) => {
        await decididos(client, hogar, {
          descripcion: 'IBERDROLA CLIENTES',
          cuantos: 3,
          categoria: hogar.luz,
        })
        const nuevo = await asentar(client, hogar, 'IBERDROLA CLIENTES SAU · Recibo 04/2026')

        const propuestas = await proponerPorMemoria(client, [
          { entryId: nuevo, description: 'IBERDROLA CLIENTES SAU · Recibo 04/2026' },
        ])
        expect(propuestas).toHaveLength(1)
        const propuesta = unico(propuestas, 'propuesta')
        expect(propuesta.entryId).toBe(nuevo)
        expect(propuesta.recuerdo.automatica?.categoryId).toBe(hogar.luz)
        // El motivo es lo que se le enseña al usuario: tiene que contestar
        // "¿por qué esta categoría?" con números y sin jerga.
        expect(propuesta.motivo).toContain('3 veces')
        expect(propuesta.motivo).toContain('Luz')
      })
    })

    it('un comercio del que no hay memoria no produce propuesta', async () => {
      const hogar = await nuevoHogar('sin memoria')
      await withTenant(app, hogar.tenantId, async (client) => {
        await decididos(client, hogar, {
          descripcion: 'IBERDROLA CLIENTES',
          cuantos: 3,
          categoria: hogar.luz,
        })
        const otro = await asentar(client, hogar, 'FERRETERIA LOS ROSALES')

        expect(
          await proponerPorMemoria(client, [
            { entryId: otro, description: 'FERRETERIA LOS ROSALES' },
          ]),
        ).toEqual([])
        expect(await proponerPorMemoria(client, [])).toEqual([])
      })
    })

    it('el mismo movimiento dos veces produce una sola propuesta', async () => {
      // Contarlo dos veces diría que la memoria alcanza a más libro del que hay.
      const hogar = await nuevoHogar('repetido')
      await withTenant(app, hogar.tenantId, async (client) => {
        await decididos(client, hogar, {
          descripcion: 'MERCADONA',
          cuantos: 3,
          categoria: hogar.supermercado,
        })
        const nuevo = await asentar(client, hogar, 'MERCADONA REF 9931')
        const propuestas = await proponerPorMemoria(client, [
          { entryId: nuevo, description: 'MERCADONA REF 9931' },
          { entryId: nuevo, description: 'MERCADONA REF 9931' },
        ])
        expect(propuestas).toHaveLength(1)
      })
    })

    it('cuando el hogar no fue unánime, la propuesta ofrece y no decide', async () => {
      const hogar = await nuevoHogar('propuesta ambigua')
      await withTenant(app, hogar.tenantId, async (client) => {
        await decididos(client, hogar, {
          descripcion: 'AMAZON EU',
          cuantos: 3,
          categoria: hogar.oficina,
        })
        await decididos(client, hogar, {
          descripcion: 'AMAZON EU',
          cuantos: 3,
          categoria: hogar.supermercado,
          quien: LUIS,
        })
        const nuevo = await asentar(client, hogar, 'AMAZON EU REF 7781')

        const propuesta = unico(
          await proponerPorMemoria(client, [{ entryId: nuevo, description: 'AMAZON EU REF 7781' }]),
          'propuesta',
        )
        expect(propuesta.recuerdo.automatica).toBeNull()
        expect(propuesta.recuerdo.opciones).toHaveLength(2)
        expect(propuesta.motivo).toContain('la elige una persona')
      })
    })
  })

  // ── Aislamiento ───────────────────────────────────────────────────────────

  it('la memoria de un hogar no se ve desde otro', async () => {
    // No es una comprobación de cortesía: la memoria es lo más parecido a un
    // perfil de gasto que produce este sistema, y filtrarla entre hogares sería
    // filtrar cómo vive una familia.
    const uno = await nuevoHogar('aislado A')
    const otro = await nuevoHogar('aislado B')

    await withTenant(app, uno.tenantId, async (client) => {
      await decididos(client, uno, {
        descripcion: 'IBERDROLA CLIENTES',
        cuantos: 3,
        categoria: uno.luz,
      })
    })

    await withTenant(app, otro.tenantId, async (client) => {
      expect(await recordarPorComercio(client)).toEqual([])
      const suyo = await asentar(client, otro, 'IBERDROLA CLIENTES REF 1001')
      expect(
        await proponerPorMemoria(client, [
          { entryId: suyo, description: 'IBERDROLA CLIENTES REF 1001' },
        ]),
      ).toEqual([])
    })
  })
})
