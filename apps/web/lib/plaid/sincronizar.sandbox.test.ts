/**
 * El recorrido entero contra el sandbox de Plaid **y** contra Postgres.
 *
 * Sin `PLAID_BASE`, `PLAID_CLIENT_ID` y `PLAID_SECRET`, o sin base, se salta
 * solo: nadie debería necesitar una cuenta en un agregador para correr
 * `pnpm test`.
 *
 * Lo que se comprueba acá no lo puede comprobar un doble. Los tests con la red
 * doblada demuestran que la lógica hace lo que creemos; éste demuestra que lo
 * que creemos sobre Plaid es cierto:
 *
 *  · Que un banco español real —BBVA, `ins_68`— se conecta en sandbox **sin
 *    navegador** y devuelve cuentas en euros. Es la diferencia con finAPI, cuyo
 *    catálogo entero no tiene un solo banco español.
 *  · Que el sondeo hasta tres lotes vacíos trae los 45 movimientos y no los 15
 *    de la primera vuelta.
 *  · Que el libro llega **al céntimo** al saldo que declara el banco, con la
 *    apertura absorbiendo la historia que la ventana no trajo.
 *  · Que la segunda sincronización, con el cursor guardado, no trae nada.
 */

import { createHash } from 'node:crypto'
import {
  createPool,
  type Db,
  listImportBatches,
  readConnection,
  withoutTenantScope,
  withTenant,
} from '@moneypilot/db'
import { migrate } from '@moneypilot/db/migrate'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearPublicTokenDeSandbox, esSandbox, hayCredenciales } from './client'
import { conexionConToken, registrarConexion } from './conexion'
import { asentarLectura, leerDelItem } from './sincronizar'

/** BBVA Banca Personal. En sandbox devuelve seis cuentas en EUR. */
const BBVA = 'ins_68'

const ADMIN_URL = process.env['DATABASE_URL']
const APP_URL = process.env['DATABASE_APP_URL']
const listo = hayCredenciales() && esSandbox() && ADMIN_URL !== undefined && APP_URL !== undefined
const suite = listo ? describe : describe.skip

const hash = (seed: string): string => createHash('sha256').update(seed).digest('hex')
const RUN = hash(`${process.pid}-${Date.now()}-${Math.random()}`).slice(0, 12)

const HOY = new Date().toISOString().slice(0, 10)

suite('sincronización contra el sandbox de Plaid', () => {
  let admin: Db
  let app: Db
  let hogar = ''
  let conexionId = ''

  beforeAll(async () => {
    await migrate(ADMIN_URL as string)
    admin = createPool({ connectionString: ADMIN_URL as string })
    app = createPool({ connectionString: APP_URL as string })

    hogar = await withoutTenantScope(admin, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'insert into tenant (name, base_currency) values ($1, $2) returning id',
        [`Casa Plaid Sandbox ${RUN}`, 'EUR'],
      )
      const id = rows[0]?.id as string
      await client.query(
        `insert into account (tenant_id, kind, name, currency)
         values ($1, 'equity', 'Saldo de apertura', 'EUR')`,
        [id],
      )
      return id
    })

    const publicToken = await crearPublicTokenDeSandbox(BBVA, ['transactions'])
    const conexion = await withTenant(app, hogar, (client) =>
      registrarConexion(client, {
        publicToken,
        institutionId: BBVA,
        institutionName: 'BBVA · Banca Personal',
      }),
    )
    conexionId = conexion.id
  }, 120_000)

  afterAll(async () => {
    if (hogar !== '') {
      await withoutTenantScope(admin, async (client) => {
        await client.query('update entry set reversed_by = null where tenant_id = $1', [hogar])
        for (const table of ['review_item', 'declared_balance', 'entry', 'import_batch']) {
          await client.query(`delete from ${table} where tenant_id = $1`, [hogar])
        }
        await client.query('delete from tenant where id = $1', [hogar])
      })
    }
    await admin?.end()
    await app?.end()
  })

  const enHogar = <T>(fn: Parameters<typeof withTenant<T>>[2]): Promise<T> =>
    withTenant(app, hogar, fn)

  async function cuentasDelLibro(): Promise<string[]> {
    return enHogar(async (client) => {
      const { rows } = await client.query<{ name: string }>(
        'select name from account order by name',
      )
      return rows.map((fila) => fila.name)
    })
  }

  async function sincronizar() {
    const { conexion, accessToken } = await enHogar((client) =>
      conexionConToken(client, conexionId),
    )
    const lectura = await leerDelItem(accessToken, conexion.syncCursor)
    const resultado = await enHogar((client) =>
      asentarLectura(client, { connectionId: conexionId, lectura, balanceAsOf: HOY }),
    )
    return { lectura, resultado }
  }

  it('conecta BBVA sin navegador, trae el histórico entero y cuadra al céntimo', async () => {
    const { lectura, resultado } = await sincronizar()

    // Seis cuentas en euros. Es el dato que decidió el proveedor: finAPI no
    // tiene un solo banco español en todo su catálogo.
    expect(lectura.cuentas.length).toBeGreaterThanOrEqual(4)
    expect(lectura.cuentas.every((cuenta) => cuenta.isoCurrencyCode === 'EUR')).toBe(true)

    // El histórico llega a plazos: la primera vuelta con datos trae 15 y
    // después llegan 30 más. Parar en el primer lote vacío se llevaría un
    // tercio, con un informe que cuadra consigo mismo.
    expect(lectura.movimientos.length).toBeGreaterThan(20)
    expect(lectura.vueltas).toBeGreaterThan(2)
    expect(lectura.incompleta).toBe(false)

    const conLote = resultado.cuentas.filter((cuenta) => cuenta.kind === 'ok')
    expect(conLote.length).toBeGreaterThan(0)

    // Y lo que de verdad importa: cada cuenta que trajo movimientos llega al
    // saldo que declara el banco. La apertura absorbe la historia anterior a
    // la ventana, y el delta es cero porque el libro llega ahí, no porque se
    // haya tapado nada.
    for (const cuenta of conLote) {
      if (cuenta.kind !== 'ok') continue
      const enElInforme = cuenta.report.accounts[0]
      expect(enElInforme?.status).toBe('conciliada')
      expect(enElInforme?.delta?.amount).toBe('0.00')
    }

    const saldos = await enHogar(async (client) => {
      const { rows } = await client.query<{ nombre: string; saldo: string }>(
        `select a.name as nombre, coalesce(sum(p.amount), 0)::text as saldo
             from account a join posting p on p.account_id = a.id
            where a.institution = 'BBVA · Banca Personal'
            group by a.name order by a.name`,
      )
      return rows
    })
    expect(saldos.length).toBeGreaterThan(0)

    // El cursor quedó guardado: es lo que hace incremental a la siguiente.
    const conexion = await enHogar((client) => readConnection(client, conexionId))
    expect(conexion?.syncCursor).not.toBeNull()
  }, 180_000)

  it('la segunda sincronización arranca del cursor y no trae nada', async () => {
    const antes = await enHogar((client) => listImportBatches(client, 50))
    const cuentasAntes = await cuentasDelLibro()
    const { lectura, resultado } = await sincronizar()

    // Lo primero, porque es lo que no se veía. Un lote vacío de Plaid viene
    // **sin cuentas**, así que esta segunda lectura no las saca de
    // `/transactions/sync` sino del reemplazo `/accounts/get`, que devuelve el
    // item entero —planes de pensiones y préstamos incluidos, cuentas que este
    // producto no alimenta jamás—. Antes de `cuentasAsentables`, esta segunda
    // pasada creaba siete cuentas nuevas en cero que ya no se iban nunca.
    expect(await cuentasDelLibro()).toEqual(cuentasAntes)

    // Con cursor guardado alcanza un lote vacío para dar por terminado: el
    // histórico ya se entregó y no hay nada nuevo que esperar.
    expect(lectura.movimientos).toHaveLength(0)
    expect(lectura.vueltas).toBe(1)
    expect(resultado.cuentas.every((cuenta) => cuenta.kind === 'vacia')).toBe(true)

    // Y no se escribe un lote vacío, que ocuparía su huella de contenido.
    const despues = await enHogar((client) => listImportBatches(client, 50))
    expect(despues).toHaveLength(antes.length)
  }, 120_000)
})
