/**
 * El camino de conectar, contra el sandbox de finAPI de verdad y contra
 * Postgres de verdad.
 *
 * `sincronizar.test.ts` dobla la red para poder probar el céntimo y el
 * deshacer sin depender de un agregador alemán. Esto es lo contrario: no dobla
 * nada, y comprueba lo único que un doble no puede — que los caminos que
 * creemos que existen existen, que el usuario que creamos allá queda enlazado
 * con el hogar de acá, y que un usuario recién creado —sin ningún banco
 * conectado todavía— devuelve cero cuentas **sin romperse**, que es el estado
 * real entre pulsar "Conectar" y completar el formulario.
 *
 * Lo que NO se puede automatizar es justamente lo importante: las credenciales
 * del banco las teclea una persona en el formulario de finAPI. Por eso este
 * fichero llega hasta la URL del formulario y se para ahí.
 *
 * Se salta solo sin credenciales de finAPI o sin base, igual que el resto.
 */

import { createHash } from 'node:crypto'
import {
  createPool,
  type Db,
  listConnections,
  readFeedUser,
  recordConnection,
  updateConnection,
  withoutTenantScope,
  withTenant,
} from '@moneypilot/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { catalogoDePrueba } from './catalogo'
import { borrarUsuario, crearWebForm, estadoWebForm, hayCredenciales } from './client'
import { PROVEEDOR, tokenDelHogar, usuarioDelHogar } from './hogar'
import { prepararCuentas } from './sincronizar'
import { esEstadoFinal } from './tipos'

const ADMIN_URL = process.env['DATABASE_URL']
const APP_URL = process.env['DATABASE_APP_URL']
const listo = hayCredenciales() && ADMIN_URL !== undefined && APP_URL !== undefined
const suite = listo ? describe : describe.skip

/** El banco de prueba con datos: credenciales demo/demo, TAN 123456. */
const BANCO_DE_PRUEBA = 280001

const RUN = createHash('sha256')
  .update(`${process.pid}-${Date.now()}-${Math.random()}`)
  .digest('hex')
  .slice(0, 12)

suite('conectar un banco contra el sandbox de finAPI', () => {
  let admin: Db
  let app: Db
  let hogar = ''
  let tokenUsuario = ''

  beforeAll(async () => {
    admin = createPool({ connectionString: ADMIN_URL as string })
    app = createPool({ connectionString: APP_URL as string })
    hogar = await withoutTenantScope(admin, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'insert into tenant (name, base_currency) values ($1, $2) returning id',
        [`Casa Sandbox ${RUN}`, 'EUR'],
      )
      return rows[0]?.id as string
    })
  }, 60_000)

  afterAll(async () => {
    // Un usuario abandonado en el agregador se queda con sus datos bancarios
    // dentro. Hoy son sintéticos; el sitio de la limpieza es el mismo igual.
    if (tokenUsuario !== '') await borrarUsuario(tokenUsuario).catch(() => undefined)
    if (hogar !== '') {
      await withoutTenantScope(admin, (client) =>
        client.query('delete from tenant where id = $1', [hogar]),
      )
    }
    await admin?.end()
    await app?.end()
  }, 60_000)

  const enHogar = <T>(fn: Parameters<typeof withTenant<T>>[2]): Promise<T> =>
    withTenant(app, hogar, fn)

  it('el catálogo trae los bancos de prueba y pone delante los que tienen datos', async () => {
    const catalogo = await catalogoDePrueba()
    expect(catalogo.kind).toBe('ok')
    if (catalogo.kind !== 'ok') return
    expect(catalogo.bancos.length).toBeGreaterThan(0)
    // El primero de la lista tiene que ser uno que devuelva movimientos: la
    // diferencia entre probar esto en dos minutos y abandonarlo.
    expect(catalogo.bancos[0]?.id).toBe(BANCO_DE_PRUEBA)
    expect(catalogo.bancos[0]?.nombre).toContain('finAPI Test Bank')
  }, 60_000)

  it('da de alta al hogar en finAPI y lo deja enlazado, una sola vez', async () => {
    const usuario = await enHogar((client) => usuarioDelHogar(client))
    expect(usuario.externalId).not.toBe('')

    // Idempotente: la segunda llamada NO crea otro usuario en finAPI. Si lo
    // hiciera, el primero quedaría vivo allá con sus datos bancarios dentro y
    // sin nada nuestro que apunte a él.
    const otraVez = await enHogar((client) => usuarioDelHogar(client))
    expect(otraVez.externalId).toBe(usuario.externalId)

    const guardado = await enHogar((client) => readFeedUser(client, PROVEEDOR))
    expect(guardado?.externalId).toBe(usuario.externalId)

    const token = await enHogar((client) => tokenDelHogar(client))
    expect(token).not.toBeNull()
    tokenUsuario = token as string
  }, 60_000)

  it('abre un formulario web de verdad y guarda la conexión para poder sondearla', async () => {
    const formulario = await crearWebForm(tokenUsuario, BANCO_DE_PRUEBA, {
      nombreDeConexion: `moneypilot ${RUN}`,
    })
    expect(formulario.url).toContain(formulario.id)

    const conexion = await enHogar((client) =>
      recordConnection(client, {
        provider: PROVEEDOR,
        bankId: String(BANCO_DE_PRUEBA),
        bankName: 'finAPI Test Bank',
        webFormId: formulario.id,
        status: 'NOT_YET_OPENED',
      }),
    )

    // Sin `redirectUrl` no hay vuelta automática, así que el estado se sondea.
    // Recién creado, nadie lo abrió — que es exactamente lo que la pantalla
    // tiene que saber decir cuando alguien pulsa "Ya terminé" demasiado pronto.
    const estado = await estadoWebForm(tokenUsuario, formulario.id)
    expect(estado.status).toBe('NOT_YET_OPENED')
    expect(esEstadoFinal(estado.status)).toBe(false)

    const actualizada = await enHogar((client) =>
      updateConnection(client, {
        id: conexion.id,
        status: estado.status,
        bankConnectionId: estado.payload.bankConnectionId,
      }),
    )
    expect(actualizada.status).toBe('NOT_YET_OPENED')
    expect(await enHogar((client) => listConnections(client, PROVEEDOR))).toHaveLength(1)
  }, 60_000)

  it('sin banco conectado todavía, preparar devuelve cero cuentas sin romperse', async () => {
    // Es el estado real entre pulsar "Conectar" y terminar el formulario, y no
    // es un error: la pantalla lo traduce a "esperá y volvé a pulsar". Que
    // esto lanzara convertiría un momento normal en una pantalla rota.
    const conexiones = await enHogar((client) => listConnections(client, PROVEEDOR))
    const plan = await enHogar((client) => prepararCuentas(client, tokenUsuario, conexiones))
    expect(plan).toEqual([])
  }, 60_000)
})
