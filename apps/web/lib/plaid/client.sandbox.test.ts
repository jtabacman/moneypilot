/**
 * El cliente contra el sandbox de Plaid de verdad.
 *
 * Sin `PLAID_BASE`, `PLAID_CLIENT_ID` y `PLAID_SECRET` en el entorno se saltan
 * solos, igual que los tests que necesitan Postgres: nadie debería necesitar
 * una cuenta en un agregador para correr `pnpm test`.
 *
 * Lo que se comprueba acá no lo puede comprobar un doble: que los caminos que
 * creemos que existen existen, que los campos se llaman como anotamos, y sobre
 * todo **que el signo es el que creemos**. Esa última parte es la que más
 * duele si se da por supuesta: un signo al revés no rompe nada, el asiento
 * balancea igual, y lo único que pasa es que el patrimonio va en dirección
 * contraria durante meses.
 *
 * Y a diferencia de finAPI, acá no hace falta que nadie teclee credenciales en
 * un formulario: `/sandbox/public_token/create` devuelve una conexión ya
 * autenticada, así que el recorrido entero se prueba sin navegador.
 */

import { fromDecimalString, sum, toDecimalString } from '@moneypilot/core'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  buscarInstituciones,
  canjearPublicToken,
  contarInstituciones,
  crearLinkToken,
  crearPublicTokenDeSandbox,
  enriquecer,
  forzarReautenticacion,
  hayCredenciales,
  sincronizar,
  traerCuentas,
} from './client'
import { necesitaReautenticacion, PlaidError } from './errores'
import { hayHistoricoCompleto, invertirSigno, loteVacio, type MovimientoPlaid } from './tipos'

/** El banco de prueba con datos: 48 movimientos en cinco cuentas. */
const BANCO_DE_PRUEBA = 'ins_109508'

const suite = hayCredenciales() ? describe : describe.skip

async function conectar(usuarioAMedida?: unknown): Promise<string> {
  const publicToken = await crearPublicTokenDeSandbox(
    BANCO_DE_PRUEBA,
    ['transactions'],
    usuarioAMedida === undefined ? {} : { usuarioAMedida },
  )
  const { accessToken } = await canjearPublicToken(publicToken)
  return accessToken
}

interface Descarga {
  readonly movimientos: MovimientoPlaid[]
  readonly corregidos: MovimientoPlaid[]
  readonly cursor: string
  readonly estados: string[]
}

/**
 * Cuántos lotes vacíos seguidos hacen falta para dar por terminada la descarga.
 *
 * No es un número inventado. Ver `EstadoDeActualizacion` en tipos.ts: en dos de
 * cada cinco conexiones aparece **un** lote vacío, con estado
 * `HISTORICAL_UPDATE_COMPLETE`, y después llegan 32 movimientos más. Con uno
 * solo, este test se llevaría 16 de 48 y pasaría igual.
 */
const VACIOS_SEGUIDOS = 3

/**
 * Sincroniza hasta estar de verdad al día.
 *
 * Es, en pequeño, el bucle que va a tener que hacer `sincronizar.ts` mientras
 * no haya webhook — con la salvedad de que en producción el disparador bueno es
 * `SYNC_UPDATES_AVAILABLE` y no el reloj.
 */
async function descargarTodo(accessToken: string): Promise<Descarga> {
  const movimientos: MovimientoPlaid[] = []
  const corregidos: MovimientoPlaid[] = []
  const estados: string[] = []
  let cursor = ''
  let vacios = 0

  for (let intento = 0; intento < 30 && vacios < VACIOS_SEGUIDOS; intento += 1) {
    const lote = await sincronizar(accessToken, cursor, { timeoutMs: 60_000 })
    estados.push(String(lote.estado))
    movimientos.push(...lote.added)
    corregidos.push(...lote.modified)
    cursor = lote.cursor
    vacios = loteVacio(lote) && hayHistoricoCompleto(String(lote.estado)) ? vacios + 1 : 0
    if (vacios < VACIOS_SEGUIDOS) await new Promise((listo) => setTimeout(listo, 2_000))
  }
  return { movimientos, corregidos, cursor, estados }
}

suite('cliente de Plaid contra el sandbox', () => {
  let accessToken = ''
  let descarga: Descarga

  beforeAll(async () => {
    accessToken = await conectar()
    descarga = await descargarTodo(accessToken)
  }, 180_000)

  it('conecta un banco entero sin navegador y trae sus cuentas', async () => {
    const cuentas = await traerCuentas(accessToken)
    expect(cuentas.length).toBeGreaterThan(0)

    const corriente = cuentas.find((c) => c.subtype === 'checking')
    expect(corriente?.type).toBe('depository')
    expect(corriente?.isoCurrencyCode).toBe('USD')
    expect(corriente?.mask).toMatch(/^\d+$/)
    // El saldo es cadena decimal exacta, no un número.
    expect(typeof corriente?.saldoActual).toBe('string')
  }, 60_000)

  it('entrega los movimientos a plazos, y ninguna señal de la respuesta dice cuándo terminó', () => {
    // Ver la medición en `EstadoDeActualizacion`: llegan 16 y después 32, todas
    // las vueltas vienen con `has_more: false`, y dos de cada cinco veces hay
    // un lote vacío con estado HISTORICAL_UPDATE_COMPLETE **antes** de los 32
    // que faltan. Quien pare ahí se lleva 16 de 48 sin un solo error.
    expect(descarga.estados.length).toBeGreaterThan(1)
    expect(hayHistoricoCompleto(String(descarga.estados.at(-1)))).toBe(true)

    // El número que importa es 16, no 0: es lo que se lleva quien para en la
    // primera tanda o en el primer lote vacío. Que haya más es la prueba de que
    // la espera por varios vacíos seguidos sirve para algo.
    expect(descarga.movimientos.length).toBeGreaterThan(16)

    // Ningún movimiento repetido pese a las varias tandas: el cursor avanza.
    const ids = descarga.movimientos.map((m) => m.transactionId)
    expect(new Set(ids).size).toBe(ids.length)

    // Los `modified` se leen igual que los `added`. No se exige que haya:
    // cuántos llegan depende de cómo Plaid parta la entrega esa vez, y hay
    // corridas en que el histórico viene de una sin corregir nada. El veredicto
    // 'updated' se ejercita de forma determinista en `client.test.ts`.
    for (const corregido of descarga.corregidos) {
      expect(corregido.transactionId).not.toBe('')
      expect(corregido.importeSalidaPositiva).toMatch(/^-?\d+(\.\d+)?$/)
    }
  })

  it('EL SIGNO ESTÁ INVERTIDO: positivo es dinero que sale', () => {
    const gastos = descarga.movimientos.filter((m) => !m.importeSalidaPositiva.startsWith('-'))
    const ingresos = descarga.movimientos.filter((m) => m.importeSalidaPositiva.startsWith('-'))

    // Que haya de los dos es lo que hace que este test valga algo.
    expect(gastos.length).toBeGreaterThan(0)
    expect(ingresos.length).toBeGreaterThan(0)

    // Un gasto de verdad del banco de prueba: la compra en Uber viene POSITIVA.
    const uber = descarga.movimientos.find((m) => m.name?.startsWith('Uber') === true)
    expect(uber?.importeSalidaPositiva.startsWith('-')).toBe(false)

    // Y un ingreso de verdad: el abono de intereses viene NEGATIVO.
    const intereses = descarga.movimientos.find((m) => m.name === 'INTRST PYMNT')
    expect(intereses?.importeSalidaPositiva.startsWith('-')).toBe(true)

    // Puesto en el criterio del núcleo, el gasto tiene que quedar negativo.
    const gastoEnElLibro = fromDecimalString(
      invertirSigno(uber?.importeSalidaPositiva ?? '0'),
      'USD',
    )
    const ingresoEnElLibro = fromDecimalString(
      invertirSigno(intereses?.importeSalidaPositiva ?? '0'),
      'USD',
    )
    expect(toDecimalString(gastoEnElLibro).startsWith('-')).toBe(true)
    expect(toDecimalString(ingresoEnElLibro).startsWith('-')).toBe(false)
  })

  it('cada importe llega como cadena decimal exacta que el núcleo acepta', () => {
    // Lo que se comprueba NO es que tenga dos decimales: un literal de JSON no
    // rellena ceros y el sandbox devuelve `5.4` y `-500`, que son exactos. El
    // síntoma de la coma flotante es el contrario, demasiados decimales
    // (0.30000000000000004), y eso lo caza `fromDecimalString`.
    const CANONICO = /^-?\d+(\.\d+)?$/
    for (const m of descarga.movimientos) {
      expect(m.importeSalidaPositiva).toMatch(CANONICO)
      expect(() =>
        fromDecimalString(m.importeSalidaPositiva, m.isoCurrencyCode ?? 'USD'),
      ).not.toThrow()
    }

    // Y la suma exacta en bigint. Sumando en coma flotante los mismos importes,
    // 13 de las 48 sumas parciales se desvían: la cuarta ya da
    // -478.27000000000004. Acá no hay deriva posible porque no hay flotantes.
    const total = sum(
      descarga.movimientos.map((m) => fromDecimalString(m.importeSalidaPositiva, 'USD')),
      'USD',
    )
    expect(toDecimalString(total)).toMatch(/^-?\d+\.\d{2}$/)
  })

  it('trae TODAS las páginas cuando el lote no cabe en una', async () => {
    // Con diez por vuelta hacen falta varias, y quedarse en la primera daría
    // diez movimientos de cuarenta y ocho con un informe que cuadra consigo
    // mismo. Se parte del cursor vacío para releer el histórico entero.
    //
    // Acá es donde salta `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` si el
    // item todavía se está moviendo: `sincronizar` lo reintenta por dentro
    // desde el cursor de entrada, que es justamente lo que se está probando.
    const troceado = await sincronizar(accessToken, '', { porVuelta: 10, timeoutMs: 60_000 })
    expect(troceado.hasMore).toBe(false)
    expect(troceado.added.length).toBeGreaterThan(10)
    expect(troceado.added).toHaveLength(descarga.movimientos.length)

    // El mismo conjunto en un solo viaje: la paginación no duplica ni se salta.
    const enteroDeUnaVez = await sincronizar(accessToken, '', { timeoutMs: 60_000 })
    expect(new Set(troceado.added.map((m) => m.transactionId))).toEqual(
      new Set(enteroDeUnaVez.added.map((m) => m.transactionId)),
    )
  }, 180_000)

  it('con el cursor final ya no vuelve a mandar nada', async () => {
    const lote = await sincronizar(accessToken, descarga.cursor, { timeoutMs: 60_000 })
    expect(loteVacio(lote)).toBe(true)
    expect(lote.hasMore).toBe(false)
    // Y el cursor sigue siendo utilizable: no se vacía al quedarse sin datos.
    expect(lote.cursor).not.toBe('')
  }, 60_000)

  it('el catálogo tiene los dos lados del corredor', async () => {
    // Es la medición que descartó a finAPI, que daba 0 bancos en España.
    await expect(contarInstituciones(['ES'])).resolves.toBeGreaterThan(0)
    await expect(contarInstituciones(['US'])).resolves.toBeGreaterThan(1_000)
  }, 60_000)

  it('encuentra los bancos españoles que importan, con producto transactions', async () => {
    const bancos = await buscarInstituciones('BBVA', ['ES'], { timeoutMs: 30_000 })
    expect(bancos.length).toBeGreaterThan(0)
    const bbva = bancos[0]
    expect(bbva?.nombre).toContain('BBVA')
    expect(bbva?.paises).toContain('ES')
    // Sin `transactions` el banco no nos sirve, y eso no se ve hasta que ya
    // conectaste.
    expect(bbva?.productos).toContain('transactions')
  }, 60_000)

  it('abre una sesión de Link para España y Estados Unidos a la vez', async () => {
    const token = await crearLinkToken('hogar-de-prueba', ['ES', 'US'], { timeoutMs: 30_000 })
    expect(token.linkToken).toMatch(/^link-sandbox-/)
    expect(token.expiration).not.toBe('')
  }, 60_000)
})

suite('cuentas en euros con importes elegidos por nosotros', () => {
  it('devuelve exactamente los importes que se pusieron, en EUR', async () => {
    // El usuario a medida del sandbox es lo que permite probar el corredor
    // español de verdad: el banco de prueba por defecto es de Estados Unidos y
    // sólo tiene dólares.
    const accessToken = await conectar({
      override_accounts: [
        {
          type: 'depository',
          subtype: 'checking',
          starting_balance: 1000.11,
          currency: 'EUR',
          meta: { name: 'Cuenta corriente ES', official_name: 'Cuenta corriente', limit: 0 },
          transactions: [
            {
              date_transacted: '2026-08-01',
              date_posted: '2026-08-02',
              amount: 101.01,
              description: 'RECIBO IBERDROLA',
              currency: 'EUR',
            },
            {
              date_transacted: '2026-08-03',
              date_posted: '2026-08-03',
              amount: -2500.55,
              description: 'NOMINA AGOSTO',
              currency: 'EUR',
            },
            {
              date_transacted: '2026-08-05',
              date_posted: '2026-08-06',
              amount: 8.7,
              description: 'COMPRA MERCADONA',
              currency: 'EUR',
            },
          ],
        },
      ],
    })

    const { movimientos } = await descargarTodo(accessToken)
    const porConcepto = new Map(movimientos.map((m) => [m.name, m.importeSalidaPositiva]))

    expect(porConcepto.get('RECIBO IBERDROLA')).toBe('101.01')
    // La nómina: en Plaid un ingreso es NEGATIVO.
    expect(porConcepto.get('NOMINA AGOSTO')).toBe('-2500.55')
    // 8.7 y no 8.70: un literal de JSON no rellena ceros, y sigue siendo exacto.
    expect(porConcepto.get('COMPRA MERCADONA')).toBe('8.7')

    const cuentas = await traerCuentas(accessToken)
    expect(cuentas[0]?.isoCurrencyCode).toBe('EUR')
    expect(cuentas[0]?.saldoActual).toBe('1000.11')

    // El cierre en el criterio del libro: 2500.55 − 101.01 − 8.7 = 2390.84.
    const total = sum(
      movimientos.map((m) => fromDecimalString(invertirSigno(m.importeSalidaPositiva), 'EUR')),
      'EUR',
    )
    expect(toDecimalString(total)).toBe('2390.84')
  }, 180_000)
})

suite('la conexión que se cae', () => {
  it('tras forzar la reautenticación, sincronizar falla con ITEM_LOGIN_REQUIRED', async () => {
    // Es el camino que más va a doler en producción y el único que no se puede
    // probar esperando: la conexión se cae, deja de entrar un solo movimiento,
    // y si nadie lo detecta el informe sigue cuadrando consigo mismo mientras
    // se aleja del banco.
    const accessToken = await conectar()
    await forzarReautenticacion(accessToken, { timeoutMs: 30_000 })

    const error = await sincronizar(accessToken, '', { timeoutMs: 30_000 }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PlaidError)
    expect(necesitaReautenticacion(error)).toBe(true)
    expect((error as PlaidError).errorCode).toBe('ITEM_LOGIN_REQUIRED')
    // Y el mensaje dice qué se estaba intentando, no sólo el código.
    expect((error as PlaidError).message).toContain('sincronizar los movimientos')
  }, 120_000)
})

suite('enriquecimiento de movimientos propios', () => {
  it('pone comercio y categoría a una línea que no vino de Plaid', async () => {
    // Sirve para las líneas que entran por fichero (OFX, N43, CSV).
    //
    // En el sandbox sólo funciona con la lista de muestra de Plaid; con
    // cualquier otro concepto contesta INVALID_SANDBOX_TRANSACTION. Estas dos
    // salen de esa lista.
    const enriquecidos = await enriquecer(
      [
        {
          id: '101',
          description: 'GRUBHUBCHICKFILA',
          importe: '30.28',
          direction: 'OUTFLOW',
          isoCurrencyCode: 'USD',
        },
        {
          id: '103',
          description: 'HOME DEPOT',
          importe: '115.23',
          direction: 'OUTFLOW',
          isoCurrencyCode: 'USD',
          ciudad: 'CAMPBELL',
          region: 'CA',
        },
      ],
      'depository',
      { timeoutMs: 60_000 },
    )

    expect(enriquecidos).toHaveLength(2)
    const porId = new Map(enriquecidos.map((e) => [e.id, e]))
    expect(porId.get('101')?.merchantName).toBe('Chick-fil-A')
    expect(porId.get('101')?.categoriaPersonal?.primary).toBe('FOOD_AND_DRINK')
    // Plaid reconoce la plataforma además del comercio.
    expect(porId.get('101')?.contrapartes.map((c) => c.name)).toContain('Grubhub')
    expect(porId.get('103')?.merchantName).toBe('The Home Depot')
  }, 60_000)

  it('el error del sandbox se explica en vez de salir como un 400 pelado', async () => {
    const error = await enriquecer(
      [
        {
          id: '1',
          description: 'RECIBO IBERDROLA CLIENTES SAU',
          importe: '101.01',
          direction: 'OUTFLOW',
          isoCurrencyCode: 'EUR',
        },
      ],
      'depository',
      { timeoutMs: 30_000 },
    ).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PlaidError)
    expect((error as PlaidError).message).toContain('no se pudo enriquecer los movimientos')
    expect((error as PlaidError).errorCode).toBe('INVALID_SANDBOX_TRANSACTION')
  }, 60_000)
})
