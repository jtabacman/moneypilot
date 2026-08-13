/**
 * El cliente contra el sandbox de finAPI de verdad.
 *
 * Sin `FINAPI_BASE`, `FINAPI_CLIENT_ID`, `FINAPI_CLIENT_SECRET` y
 * `FINAPI_WEBFORM_BASE` en el entorno se saltan solos, igual que los tests que
 * necesitan Postgres: nadie debería necesitar una cuenta en un agregador
 * alemán para correr `pnpm test`.
 *
 * Lo que se comprueba acá no lo puede comprobar un doble: que los caminos que
 * creemos que existen existen, que los nombres de los campos son los que
 * anotamos y que los errores llegan con la forma que sabemos leer. El
 * formulario web se crea pero no se completa —eso lo teclea una persona—, así
 * que el usuario recién creado no tiene cuentas ni movimientos todavía; que
 * ambas listas vengan vacías **sin fallar** es justamente lo que hay que saber.
 *
 * Cada corrida crea su propio usuario y lo borra al terminar.
 */

import { fromDecimalString, sum, toDecimalString } from '@moneypilot/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  borrarUsuario,
  crearUsuario,
  crearWebForm,
  estadoWebForm,
  hayCredenciales,
  listarBancosDePrueba,
  tokenDeCliente,
  tokenDeUsuario,
  traerCuentas,
  traerMovimientos,
} from './client'
import { esEstadoFinal } from './tipos'

/** El banco de prueba con datos: credenciales demo/demo, TAN 123456. */
const BANCO_DE_PRUEBA = 280001

const suite = hayCredenciales() ? describe : describe.skip

suite('cliente de finAPI contra el sandbox', () => {
  let tokenUsuario = ''
  let usuarioId = ''

  beforeAll(async () => {
    const usuario = await crearUsuario()
    usuarioId = usuario.id
    tokenUsuario = await tokenDeUsuario(usuario.id, usuario.password)
  }, 60_000)

  afterAll(async () => {
    // Un usuario abandonado en el agregador se queda con sus datos bancarios
    // dentro. Hoy son sintéticos; el sitio de la limpieza es el mismo igual.
    if (tokenUsuario !== '') await borrarUsuario(tokenUsuario).catch(() => undefined)
  }, 30_000)

  it('obtiene el token de cliente con client_credentials', async () => {
    const token = await tokenDeCliente()
    expect(token.length).toBeGreaterThan(20)
  })

  it('crea un usuario y consigue su token con grant_type=password', () => {
    expect(usuarioId).not.toBe('')
    expect(tokenUsuario.length).toBeGreaterThan(20)
  })

  it('encuentra el banco de prueba 280001 en el catálogo', async () => {
    const bancos = await listarBancosDePrueba(tokenUsuario)
    expect(bancos.length).toBeGreaterThan(0)
    const prueba = bancos.find((banco) => banco.id === BANCO_DE_PRUEBA)
    expect(prueba?.nombre).toContain('finAPI Test Bank')
    expect(prueba?.esDePrueba).toBe(true)
    expect(prueba?.interfaces.length).toBeGreaterThan(0)
  }, 30_000)

  it('abre un formulario web con una URL que la persona tiene que abrir a mano', async () => {
    const formulario = await crearWebForm(tokenUsuario, BANCO_DE_PRUEBA)
    expect(formulario.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(formulario.url).toContain(formulario.id)
    expect(formulario.expiresAt).not.toBe('')

    // No hay `redirectUrl`: el cliente del sandbox es UNLICENSED y cualquier
    // valor da INVALID_REDIRECT_URL. O sea que no hay vuelta automática a la
    // aplicación y el estado hay que sondearlo. Recién creado, nadie lo abrió.
    const estado = await estadoWebForm(tokenUsuario, formulario.id)
    expect(estado.status).toBe('NOT_YET_OPENED')
    expect(esEstadoFinal(estado.status)).toBe(false)
    expect(estado.payload.bankConnectionId).toBeNull()
  }, 30_000)

  it('devuelve una lista vacía de cuentas mientras nadie completó el formulario', async () => {
    // Vacío no es un fallo: es el estado real de un usuario sin banco
    // conectado, y el cliente tiene que saber decirlo sin romperse.
    await expect(traerCuentas(tokenUsuario)).resolves.toEqual([])
  }, 30_000)

  it('devuelve una lista vacía de movimientos, con view=userView aceptado', async () => {
    // Si el parámetro `view` faltara, finAPI contestaría 400 y esto fallaría.
    await expect(traerMovimientos(tokenUsuario)).resolves.toEqual([])
  }, 60_000)
})

/**
 * El corpus entero, contra un usuario que **ya** completó el formulario web.
 *
 * Esa parte no se puede automatizar —las credenciales del banco las teclea una
 * persona en el formulario de finAPI, que es justamente el punto—, así que
 * este bloque se salta salvo que alguien ponga en el entorno el usuario y la
 * contraseña que finAPI devolvió al crearlo:
 *
 *     FINAPI_SANDBOX_USER, FINAPI_SANDBOX_PASSWORD
 *
 * Vale la pena tenerlo escrito porque es el único test que ejercita las cuatro
 * páginas de verdad y los 1.612 movimientos que nadie de este equipo redactó.
 * La última vez que se corrió, la suma exacta de los 1.612 importes dio
 * -13587.10, que es exactamente el `balance` que declara finAPI; sumándolos
 * como `number` da -13587.099999999928. Esa diferencia es la que este módulo
 * entero existe para que no ocurra.
 */
const usuarioConDatos = process.env['FINAPI_SANDBOX_USER']
const claveConDatos = process.env['FINAPI_SANDBOX_PASSWORD']
const suiteCorpus =
  hayCredenciales() && usuarioConDatos !== undefined && claveConDatos !== undefined
    ? describe
    : describe.skip

suiteCorpus('corpus completo de un usuario ya conectado', () => {
  it('trae todas las páginas y cada importe llega exacto al núcleo', async () => {
    const token = await tokenDeUsuario(usuarioConDatos as string, claveConDatos as string)
    const movimientos = await traerMovimientos(token, { timeoutMs: 60_000 })

    // Más de una página: si la paginación estuviera rota se quedaría en 500.
    expect(movimientos.length).toBeGreaterThan(500)

    // Lo que hay que comprobar es que el importe llega como el literal exacto
    // del cuerpo y que el núcleo lo acepta, NO que tenga dos decimales.
    //
    // La diferencia importa: finAPI escribe los números como literales de JSON,
    // y un literal de JSON no rellena ceros. El sandbox devuelve saldos `0.0` y
    // `4111.3`, que son perfectamente exactos y no tienen dos decimales. Exigir
    // `\d{2}` haría fallar este test contra datos correctos, que es la forma
    // más cara de equivocarse: obliga a aflojar la comprobación justo cuando
    // saltó, y la próxima vez ya nadie se fía de ella.
    //
    // El síntoma de la coma flotante no es "pocos decimales" sino "demasiados":
    // 0.30000000000000004. Eso lo caza `fromDecimalString`, que se niega a
    // truncar por su cuenta.
    const CANONICO = /^-?\d+(\.\d+)?$/
    for (const movimiento of movimientos) {
      expect(movimiento.amount).toMatch(CANONICO)
      expect(() => fromDecimalString(movimiento.amount, movimiento.currency)).not.toThrow()
    }

    const total = sum(
      movimientos.map((m) => fromDecimalString(m.amount, 'EUR')),
      'EUR',
    )
    expect(toDecimalString(total)).toMatch(/^-?\d+\.\d{2}$/)

    const cuentas = await traerCuentas(token)
    expect(cuentas.length).toBeGreaterThan(0)
    for (const cuenta of cuentas) {
      expect(cuenta.balance).toMatch(CANONICO)
      expect(() => fromDecimalString(cuenta.balance as string, 'EUR')).not.toThrow()
    }
  }, 180_000)
})
