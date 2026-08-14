/**
 * El enganche entre la importación y el motor de clasificación.
 *
 * Dos cosas hay que demostrar acá, y las dos son sobre la costura y no sobre el
 * motor —que tiene sus propios tests en `packages/db`—:
 *
 *  1. **Lo que trajo el origen y la base no guarda llega igual al motor.** El
 *     concepto común de la Norma 43 vive en el `raw` de la línea y se pierde al
 *     persistir; este módulo es el único sitio donde ese `raw` y el `entry.id`
 *     existen a la vez. Si el cruce por huella se rompiera, la señal dejaría de
 *     clasificar y nadie se enteraría: el resultado seguiría siendo plausible.
 *
 *  2. **Si la clasificación falla, la importación no se pierde.** Es la promesa
 *     del enganche y no se cumple con un `try/catch`: todo corre dentro de la
 *     misma transacción que acaba de escribir el lote, y en Postgres un error
 *     la deja abortada. El test comprueba lo que de verdad importa — que
 *     después del fallo la transacción **sigue usable**—, porque es lo que
 *     decide si el `commit` de después se lleva los movimientos o no.
 *
 * Contra Postgres de verdad: lo que hay que probar es justamente el
 * comportamiento transaccional, que ningún doble reproduce.
 */

import { createHash } from 'node:crypto'
import type { ClassifiedTransaction, ParsedStatement } from '@moneypilot/core'
import {
  createPool,
  type Db,
  type TenantClient,
  withoutTenantScope,
  withTenant,
} from '@moneypilot/db'
import { migrate } from '@moneypilot/db/migrate'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clasificarLote } from './clasificar'

const ADMIN_URL = process.env['DATABASE_URL']
const APP_URL = process.env['DATABASE_APP_URL']
const suite = ADMIN_URL !== undefined && APP_URL !== undefined ? describe : describe.skip

const RUN = createHash('sha256')
  .update(`${process.pid}-${Date.now()}-${Math.random()}`)
  .digest('hex')
  .slice(0, 12)

function unico<T>(rows: readonly T[], what: string): T {
  const row = rows[0]
  if (row === undefined) throw new Error(`Se esperaba una fila de ${what}`)
  return row
}

interface Hogar {
  readonly tenantId: string
  readonly banco: string
  readonly sinCategorizar: string
  readonly comisiones: string
}

let admin: Db
let app: Db
const hogares: string[] = []

async function nuevoHogar(etiqueta: string): Promise<Hogar> {
  const hogar = await withoutTenantScope(admin, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      'insert into tenant (name, base_currency) values ($1, $2) returning id',
      [`Enganche ${RUN} ${etiqueta}`, 'EUR'],
    )
    const tenantId = unico(rows, 'tenant').id
    const cuenta = async (kind: string, name: string): Promise<string> => {
      const creada = await client.query<{ id: string }>(
        `insert into account (tenant_id, kind, name, currency)
         values ($1, $2::account_kind, $3, 'EUR') returning id`,
        [tenantId, kind, name],
      )
      return unico(creada.rows, 'account').id
    }
    return {
      tenantId,
      banco: await cuenta('asset', 'Sabadell Corriente'),
      sinCategorizar: await cuenta('expense', 'Sin categorizar (EUR)'),
      comisiones: await cuenta('expense', 'Comisiones bancarias'),
    }
  })
  hogares.push(hogar.tenantId)
  return hogar
}

/**
 * Un lote ya escrito, como lo deja `persistImport`: su fila en `import_batch` y
 * un asiento con su huella, su pata bancaria y su contrapartida en la bolsa.
 *
 * Se monta a mano y no corriendo el importador entero porque lo que se prueba
 * es el cruce huella → `raw`, y el importador sólo añadiría ruido entre la
 * causa y el efecto.
 */
async function loteConUnMovimiento(
  client: TenantClient,
  hogar: Hogar,
  huella: string,
): Promise<string> {
  const lote = await client.query<{ id: string }>(
    `insert into import_batch (tenant_id, account_id, file_name, format, content_sha256, status)
     values ($1, $2, 'extracto.n43', 'n43', $3, 'completed') returning id`,
    [hogar.tenantId, hogar.banco, createHash('sha256').update(huella).digest('hex')],
  )
  const batchId = unico(lote.rows, 'import_batch').id

  const entrada = await client.query<{ id: string }>(
    `insert into entry (tenant_id, booked_on, description, source, import_batch_id, fingerprint)
     values ($1, '2026-03-14'::date, 'COMISION MANTENIMIENTO', 'file', $2, $3) returning id`,
    [hogar.tenantId, batchId, huella],
  )
  const entryId = unico(entrada.rows, 'entry').id
  await client.query(
    `insert into posting (tenant_id, entry_id, account_id, ordinal, amount, currency)
     values ($1, $2, $3, 0, -350, 'EUR'), ($1, $2, $4, 1, 350, 'EUR')`,
    [hogar.tenantId, entryId, hogar.banco, hogar.sinCategorizar],
  )
  return batchId
}

/** El extracto y el veredicto del dedup, con el `raw` que emite el parser N43. */
function loQueTraeElParser(huella: string): {
  statements: ParsedStatement[]
  classified: ClassifiedTransaction[]
} {
  const statements: ParsedStatement[] = [
    {
      format: 'n43',
      account: { currency: 'EUR' },
      lines: [
        {
          lineNumber: 7,
          bookedOn: '2026-03-14',
          amount: { amount: -350n, currency: 'EUR' },
          description: 'COMISION MANTENIMIENTO',
          // El 17 de la Norma 43 es «intereses, comisiones, gastos e
          // impuestos». Es lo único de esta estructura que el motor mira.
          raw: { concepto_comun: '17', concepto_propio: '007' },
        },
      ],
      warnings: [],
    },
  ]
  const classified: ClassifiedTransaction[] = [
    {
      incoming: {
        lineNumber: 7,
        accountId: 'da-igual',
        bookedOn: '2026-03-14',
        amount: { amount: -350n, currency: 'EUR' },
        description: 'COMISION MANTENIMIENTO',
        ordinal: 0,
      },
      fingerprint: huella,
      ordinal: 0,
      verdict: { kind: 'new' },
    },
  ]
  return { statements, classified }
}

suite('enganche de la clasificación a la importación', () => {
  beforeAll(async () => {
    await migrate(ADMIN_URL as string)
    admin = createPool({ connectionString: ADMIN_URL as string })
    app = createPool({ connectionString: APP_URL as string })
  }, 60_000)

  afterAll(async () => {
    if (hogares.length > 0) {
      await withoutTenantScope(admin, async (client) => {
        for (const tabla of ['entry', 'import_batch']) {
          await client.query(`delete from ${tabla} where tenant_id = any($1::uuid[])`, [hogares])
        }
        await client.query('delete from tenant where id = any($1::uuid[])', [hogares])
      })
    }
    await admin?.end()
    await app?.end()
  })

  it('el concepto de la Norma 43 viaja del raw al motor y clasifica el movimiento', async () => {
    const hogar = await nuevoHogar('n43')
    const huella = createHash('sha256').update(`comision-${RUN}`).digest('hex')

    await withTenant(app, hogar.tenantId, async (client) => {
      const batchId = await loteConUnMovimiento(client, hogar, huella)
      const resultado = await clasificarLote(client, {
        batchId,
        ...loQueTraeElParser(huella),
      })

      expect(resultado.error).toBeNull()
      expect(resultado.aplicadas).toBe(1)
      expect(resultado.porCapa).toEqual([{ procedencia: 'senal', propuestas: 1, aplicadas: 1 }])

      const { rows } = await client.query<{ name: string }>(
        `select a.name
           from posting p
           join account a on a.id = p.account_id
           join entry e on e.id = p.entry_id
          where e.import_batch_id = $1::uuid and a.kind = 'expense'`,
        [batchId],
      )
      expect(unico(rows, 'categoría').name).toBe('Comisiones bancarias')
    })
  })

  it('sin el raw de la línea, el mismo movimiento no se clasifica', async () => {
    // El contraste que demuestra que lo de arriba mide el cruce y no otra cosa.
    // Es además el estado real de todo lo que ya está en el libro: el esquema no
    // guarda el concepto, así que fuera de la importación esa capa está ciega.
    const hogar = await nuevoHogar('sin-raw')
    const huella = createHash('sha256').update(`sin-raw-${RUN}`).digest('hex')

    await withTenant(app, hogar.tenantId, async (client) => {
      const batchId = await loteConUnMovimiento(client, hogar, huella)
      const resultado = await clasificarLote(client, { batchId, statements: [], classified: [] })
      expect(resultado.aplicadas).toBe(0)
      expect(resultado.sinPropuesta).toBe(1)
    })
  })

  it('si la clasificación revienta, el lote sobrevive y la transacción sigue usable', async () => {
    // La promesa entera del enganche. El batchId inválido hace que Postgres
    // rechace la consulta, que es la forma más fiel de reproducir un fallo
    // dentro de la pasada: sin el savepoint, la transacción quedaría abortada y
    // el `commit` de después se llevaría por delante la importación completa.
    const hogar = await nuevoHogar('savepoint')

    const sobrevivio = await withTenant(app, hogar.tenantId, async (client) => {
      const resultado = await clasificarLote(client, {
        batchId: 'esto-no-es-un-uuid',
        statements: [],
        classified: [],
      })
      expect(resultado.error).not.toBeNull()
      expect(resultado.aplicadas).toBe(0)

      // Y acá está la prueba: la transacción acepta escribir después del fallo.
      const { rows } = await client.query<{ id: string }>(
        `insert into entry (tenant_id, booked_on, description, source)
         values ($1, '2026-03-14'::date, 'DESPUES DEL FALLO', 'file') returning id`,
        [hogar.tenantId],
      )
      return unico(rows, 'entry').id
    })

    // Y el commit llegó a la base: no es que la escritura pareciera funcionar.
    await withTenant(app, hogar.tenantId, async (client) => {
      const { rows } = await client.query<{ n: string }>(
        'select count(*) as n from entry where id = $1::uuid',
        [sobrevivio],
      )
      expect(unico(rows, 'recuento').n).toBe('1')
    })
  })
})
