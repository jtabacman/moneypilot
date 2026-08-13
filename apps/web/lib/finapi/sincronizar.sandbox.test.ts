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
 * fichero llega hasta la URL del formulario y se para ahí — y por eso el
 * segundo bloque, el que sincroniza el corpus entero, necesita un usuario que
 * **ya** completó el formulario alguna vez.
 *
 * Se salta solo sin credenciales de finAPI o sin base, igual que el resto.
 */

import { createHash } from 'node:crypto'
import { fromDecimalString } from '@moneypilot/core'
import {
  createPool,
  type Db,
  listConnections,
  readFeedUser,
  recordConnection,
  revertImport,
  updateConnection,
  withoutTenantScope,
  withTenant,
} from '@moneypilot/db'
import { migrate } from '@moneypilot/db/migrate'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { catalogoDePrueba } from './catalogo'
import {
  borrarUsuario,
  crearWebForm,
  estadoWebForm,
  hayCredenciales,
  tokenDeUsuario,
} from './client'
import { PROVEEDOR, tokenDelHogar, usuarioDelHogar } from './hogar'
import { prepararCuentas, sincronizarCuenta } from './sincronizar'
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

/**
 * El corpus entero del sandbox, sincronizado de verdad, y la reconciliación
 * cerrando a cero.
 *
 * Necesita un usuario de finAPI que **ya** completó el formulario web y tiene
 * el banco de prueba conectado — eso lo teclea una persona una vez, y a partir
 * de ahí sus credenciales viven en el entorno:
 *
 *     FINAPI_SANDBOX_USER, FINAPI_SANDBOX_PASSWORD
 *
 * `FINAPI_WEBFORM_BASE` no hace falta acá y por eso este bloque no usa
 * `hayCredenciales()`: no se abre ningún formulario, sólo se lee. Pedir una
 * variable que no se usa haría que el test se saltara justo donde sí se puede
 * comprobar algo.
 *
 * Lo que demuestra, y que ningún doble puede demostrar: la cuenta principal del
 * banco de prueba declara 16.978,51 EUR y los movimientos que entran en la
 * ventana descargada suman −6.793,55. Sin asiento de apertura eso es un delta
 * de −23.772,06 y la cuenta sale en rojo aunque todo esté bien; con él, el
 * libro llega al saldo del banco y el delta es 0,00 **porque coinciden**.
 */
const USUARIO_CON_DATOS = process.env['FINAPI_SANDBOX_USER']
const CLAVE_CON_DATOS = process.env['FINAPI_SANDBOX_PASSWORD']
const hayLectura = ['FINAPI_BASE', 'FINAPI_CLIENT_ID', 'FINAPI_CLIENT_SECRET'].every(
  (nombre) => (process.env[nombre] ?? '').trim() !== '',
)
const suiteCorpus =
  hayLectura &&
  USUARIO_CON_DATOS !== undefined &&
  CLAVE_CON_DATOS !== undefined &&
  ADMIN_URL !== undefined &&
  APP_URL !== undefined
    ? describe
    : describe.skip

suiteCorpus('sincronizar el corpus del sandbox deja la reconciliación en cero', () => {
  let admin: Db
  let app: Db
  const hogares: string[] = []
  let hogar = ''
  let token = ''

  beforeAll(async () => {
    await migrate(ADMIN_URL as string)
    admin = createPool({ connectionString: ADMIN_URL as string })
    app = createPool({ connectionString: APP_URL as string })
    token = await tokenDeUsuario(USUARIO_CON_DATOS as string, CLAVE_CON_DATOS as string)
  }, 120_000)

  afterAll(async () => {
    // El usuario de finAPI NO se borra: es el que alguien conectó a mano y el
    // que hace que este bloque se pueda volver a correr. Lo que se limpia es
    // nuestro hogar.
    if (hogares.length > 0) {
      await withoutTenantScope(admin, async (client) => {
        for (const tabla of ['review_item', 'declared_balance', 'entry', 'import_batch']) {
          await client.query(`delete from ${tabla} where tenant_id = any($1::uuid[])`, [hogares])
        }
        await client.query('delete from tenant where id = any($1::uuid[])', [hogares])
      })
    }
    await admin?.end()
    await app?.end()
  }, 60_000)

  // Un hogar nuevo por caso: la apertura se crea una sola vez por cuenta, así
  // que un caso que reutilizara el hogar del anterior ya la encontraría hecha
  // y no probaría lo que dice probar.
  beforeEach(async () => {
    hogar = await withoutTenantScope(admin, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'insert into tenant (name, base_currency) values ($1, $2) returning id',
        [`Casa Corpus ${RUN} ${hogares.length}`, 'EUR'],
      )
      return rows[0]?.id as string
    })
    hogares.push(hogar)
  })

  const enHogar = <T>(fn: Parameters<typeof withTenant<T>>[2]): Promise<T> =>
    withTenant(app, hogar, fn)

  const saldoDe = (accountId: string): Promise<string> =>
    enHogar(async (client) => {
      const { rows } = await client.query<{ saldo: string }>(
        'select coalesce(sum(amount), 0)::text as saldo from posting where account_id = $1::uuid',
        [accountId],
      )
      return rows[0]?.saldo as string
    })

  it('cada cuenta con movimientos cierra contra el saldo que declara el banco', async () => {
    const plan = await enHogar((client) => prepararCuentas(client, token, []))
    expect(plan.length).toBeGreaterThan(0)

    let conMovimientos = 0
    for (const cuenta of plan) {
      const resultado = await enHogar((client) =>
        sincronizarCuenta(client, { token, externalAccountId: cuenta.externalAccountId }),
      )
      if (resultado.kind !== 'ok') continue
      conMovimientos += 1

      const enElInforme = resultado.report.accounts[0]
      // El cierre real sigue siendo el del banco y el calculado se sigue
      // calculando: lo que cambia es que ahora coinciden.
      expect(enElInforme?.reportedClosing?.amount).toBe(cuenta.saldoDeclarado)
      expect(enElInforme?.computedClosing?.amount).toBe(enElInforme?.reportedClosing?.amount)
      expect(enElInforme?.delta?.amount).toBe('0.00')
      expect(enElInforme?.status).toBe('conciliada')

      // Y el libro, que es lo que sostiene el informe: la suma de los postings
      // de la cuenta tiene que dar el saldo del banco al céntimo. Un informe
      // que cuadra sobre un libro que no, es exactamente lo que no queremos.
      const declarado = fromDecimalString(cuenta.saldoDeclarado as string, cuenta.moneda)
      expect(await saldoDe(cuenta.accountId)).toBe(declarado.amount.toString())
    }

    expect(conMovimientos).toBeGreaterThan(0)
  }, 300_000)

  it('deshacer el lote se lleva también la apertura que creó', async () => {
    const plan = await enHogar((client) => prepararCuentas(client, token, []))
    const conSaldo = plan.find((cuenta) => cuenta.saldoDeclarado !== '0.00')
    expect(conSaldo).toBeDefined()
    if (conSaldo === undefined) return

    const resultado = await enHogar((client) =>
      sincronizarCuenta(client, { token, externalAccountId: conSaldo.externalAccountId }),
    )
    if (resultado.kind !== 'ok') throw new Error('la cuenta principal tenía que traer movimientos')
    expect(resultado.apertura?.outcome).toBe('created')

    await enHogar((client) => revertImport(client, resultado.batchId))

    // Cero y no "el saldo menos los movimientos": si la apertura sobreviviera
    // al deshacer, la cuenta se quedaría con la historia que falta y ningún
    // movimiento que la acompañe.
    expect(await saldoDe(conSaldo.accountId)).toBe('0')
  }, 300_000)
})
