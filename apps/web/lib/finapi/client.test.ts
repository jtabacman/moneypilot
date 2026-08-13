/**
 * Lo que hay que demostrar acá es una sola cosa, y es la razón de ser del
 * módulo: un importe que sale de finAPI como literal numérico de JSON llega
 * hasta el `bigint` del núcleo **sin perder un céntimo**.
 *
 * Los tests corren contra un servidor HTTP de verdad en localhost y no contra
 * un doble de `fetch`. La diferencia importa: lo que se está probando es el
 * tratamiento del **texto crudo del cuerpo**, y un doble que devolviera un
 * objeto ya deserializado se saltaría justamente el paso donde está el
 * peligro. El servidor manda bytes; el cliente los lee como los leerá en
 * producción.
 *
 * El sandbox de verdad se ejercita en `client.sandbox.test.ts`, que se salta
 * solo cuando no hay credenciales.
 */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { add, fromDecimalString, toDecimalString } from '@moneypilot/core'
import type {
  FinapiRawAccount as RawAccount,
  FinapiRawTransaction as RawTransaction,
} from '@moneypilot/importers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  faltanCredenciales,
  olvidarTokenDeCliente,
  tokenDeCliente,
  traerCuentas,
  traerMovimientos,
} from './client'
import { FinapiError } from './errores'

// ── Cuerpos crudos ──────────────────────────────────────────────────────────
//
// Se escriben como texto y no como objetos serializados con JSON.stringify a
// propósito: `JSON.stringify(99999999999999.99)` ya produciría el número
// redondeado, y el test estaría demostrando que no perdemos algo que ya
// habíamos perdido antes de empezar.

/**
 * 99999999999999.99 es el caso límite: `JSON.parse` lo devuelve como
 * 99999999999999.98. Un céntimo, en silencio, sin error en ningún sitio.
 */
const PAGINA_1 = `{"transactions":[
{"id":1860779443,"accountId":3587742,"amount":99999999999999.99,"currency":"EUR",
 "valueDate":"2024-08-13","bankBookingDate":"2024-08-13","finapiBookingDate":"2024-08-13",
 "purpose":"4/302460/639 -135.89 EUR","cleanedPurpose":"4/302460/639",
 "counterpartName":"ALLIANZ LV / FLESSA KG","counterpartIban":"DE26700800000077777000",
 "type":"Überweisungsauftrag","typeCodeZka":"20",
 "category":{"id":418,"name":"Versicherung","isCustom":false,"children":[419,420]},
 "labels":[],"isPotentialDuplicate":false,"isNew":true},
{"id":1860779444,"accountId":3587742,"amount":0.1,"currency":"EUR",
 "bankBookingDate":"2024-08-14","purpose":"un décimo","isPotentialDuplicate":true}
],"paging":{"page":1,"perPage":2,"pageCount":2,"totalCount":4},
"income":256627.36,"spending":-270214.46,"balance":-13587.10}`

const PAGINA_2 = `{"transactions":[
{"id":1860779445,"accountId":3587742,"amount":0.2,"currency":"EUR",
 "bankBookingDate":"2024-08-15","purpose":"dos décimos","isPotentialDuplicate":false},
{"id":1860779446,"accountId":3587742,"amount":-350.00,"currency":"EUR",
 "bankBookingDate":"2024-08-16","purpose":"Übernachtung","isPotentialDuplicate":false}
],"paging":{"page":2,"perPage":2,"pageCount":2,"totalCount":4}}`

/** Declara cuatro y manda dos: un lote incompleto disfrazado de completo. */
const PAGINA_UNICA_MENTIROSA = `{"transactions":[
{"id":1,"accountId":1,"amount":-1.00,"currency":"EUR","bankBookingDate":"2024-08-13"},
{"id":2,"accountId":1,"amount":-2.00,"currency":"EUR","bankBookingDate":"2024-08-14"}
],"paging":{"page":1,"perPage":2,"pageCount":1,"totalCount":4}}`

/** Sin bloque `paging`: no hay forma de saber si es la única página. */
const SIN_PAGING = `{"transactions":[
{"id":1,"accountId":1,"amount":-1.00,"currency":"EUR","bankBookingDate":"2024-08-13"}
]}`

/**
 * La respuesta real de `GET /accounts` del sandbox: **sin** bloque `paging`.
 * finAPI no pagina las cuentas, y el cliente no se lo puede exigir.
 */
const CUENTAS = `{"accounts":[
{"id":3587742,"bankConnectionId":3540249,"accountName":"Main-TestAccount",
 "iban":"DE77533700080111111100","accountNumber":"111111100",
 "accountHolderName":"Tommy Sternen-Himmel","accountCurrency":"EUR","accountType":"Checking",
 "balance":16978.51,"isSeized":false,
 "interfaces":[
   {"bankingInterface":"FINTS_SERVER","status":"UPDATED",
    "lastSuccessfulUpdate":"2026-08-13T18:16:44.000+02:00"},
   {"bankingInterface":"XS2A","status":"UPDATED",
    "lastSuccessfulUpdate":"2026-08-13T19:02:11.000+02:00"}]},
{"id":3587743,"accountName":"Cuenta sin moneda","balance":0.00,"isSeized":false}
]}`

const TOKEN =
  '{"access_token":"tk-de-mentira","token_type":"bearer","expires_in":3599,"scope":"all"}'

/** El error real que devolvió el sandbox al intentar la importación directa. */
const ERROR_ALEMAN = `{"errors":[{"message":"Für diesen Client sind direkte API-Aufrufe nicht zulässig. Bitte führen Sie den Aufruf über das finAPI Web Form durch.","code":"ILLEGAL_ENTITY_STATE","type":"TECHNICAL"}],"date":"2026-08-13T18:12:22.011+02:00","endpoint":"POST /api/v2/bankConnections/import"}`

// ── Servidor de mentira ─────────────────────────────────────────────────────

type Modo = 'normal' | 'mentirosa' | 'sin-paging' | 'error' | 'mudo'

let servidor: Server
let base = ''
let modo: Modo = 'normal'
let recibidas: string[] = []
const entornoPrevio = new Map<string, string | undefined>()

function fijar(nombre: string, valor: string): void {
  entornoPrevio.set(nombre, process.env[nombre])
  process.env[nombre] = valor
}

beforeAll(async () => {
  servidor = createServer((peticion, respuesta) => {
    recibidas.push(peticion.url ?? '')
    // Nunca contesta: así se prueba que el corte por tiempo existe de verdad.
    if (modo === 'mudo') return

    const url = new URL(peticion.url ?? '/', 'http://local')
    const enviar = (status: number, cuerpo: string): void => {
      respuesta.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
      respuesta.end(cuerpo)
    }

    if (url.pathname === '/api/v2/oauth/token') return enviar(200, TOKEN)
    if (url.pathname === '/api/v2/accounts') return enviar(200, CUENTAS)
    if (url.pathname === '/api/v2/transactions') {
      if (modo === 'error') return enviar(403, ERROR_ALEMAN)
      if (modo === 'mentirosa') return enviar(200, PAGINA_UNICA_MENTIROSA)
      if (modo === 'sin-paging') return enviar(200, SIN_PAGING)
      return enviar(200, url.searchParams.get('page') === '2' ? PAGINA_2 : PAGINA_1)
    }
    return enviar(404, '{"errors":[{"message":"no existe"}]}')
  })

  await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo))
  const direccion = servidor.address() as AddressInfo
  base = `http://127.0.0.1:${direccion.port}`

  fijar('FINAPI_BASE', base)
  fijar('FINAPI_CLIENT_ID', 'cliente-de-mentira')
  fijar('FINAPI_CLIENT_SECRET', 'secreto-de-mentira')
  olvidarTokenDeCliente()
})

afterAll(async () => {
  for (const [nombre, valor] of entornoPrevio) {
    if (valor === undefined) delete process.env[nombre]
    else process.env[nombre] = valor
  }
  olvidarTokenDeCliente()
  servidor.closeAllConnections()
  await new Promise<void>((listo) => servidor.close(() => listo()))
})

// ── Lo que de verdad importa ────────────────────────────────────────────────

describe('los importes no pasan nunca por coma flotante', () => {
  it('conserva el céntimo que JSON.parse pierde en un importe de catorce dígitos', async () => {
    // Primero, la premisa: por el camino ingenuo el céntimo ya no está.
    const ingenuo = JSON.parse(PAGINA_1).transactions[0].amount
    expect(ingenuo.toFixed(2)).toBe('99999999999999.98')

    modo = 'normal'
    const movimientos = await traerMovimientos('tk')

    // Y por el nuestro llega la cadena exacta que mandó el servidor...
    expect(movimientos[0]?.amount).toBe('99999999999999.99')
    // ...y de ahí al entero del núcleo sin tocar un `number` por el camino.
    const dinero = fromDecimalString(movimientos[0]?.amount as string, 'EUR')
    expect(dinero.amount).toBe(9999999999999999n)
    expect(toDecimalString(dinero)).toBe('99999999999999.99')
  })

  it('suma 0,1 y 0,2 y da exactamente 0,30', async () => {
    // El ejemplo canónico: en coma flotante esta suma no da 0,3.
    expect(0.1 + 0.2).not.toBe(0.3)

    modo = 'normal'
    const movimientos = await traerMovimientos('tk')
    const un = movimientos.find((m) => m.purpose === 'un décimo')
    const dos = movimientos.find((m) => m.purpose === 'dos décimos')

    const total = add(
      fromDecimalString(un?.amount as string, 'EUR'),
      fromDecimalString(dos?.amount as string, 'EUR'),
    )
    expect(total.amount).toBe(30n)
    expect(toDecimalString(total)).toBe('0.30')
  })

  it('conserva los ceros de la derecha de un importe redondo', async () => {
    modo = 'normal'
    const movimientos = await traerMovimientos('tk')
    const hotel = movimientos.find((m) => m.purpose === 'Übernachtung')
    expect(hotel?.amount).toBe('-350.00')
    expect(fromDecimalString(hotel?.amount as string, 'EUR').amount).toBe(-35000n)
  })

  it('tampoco redondea el saldo de una cuenta', async () => {
    const cuentas = await traerCuentas('tk')
    expect(cuentas[0]?.balance).toBe('16978.51')
    expect(fromDecimalString(cuentas[0]?.balance as string, 'EUR').amount).toBe(1697851n)
  })

  it('no confunde un importe escrito dentro del concepto', async () => {
    modo = 'normal'
    const movimientos = await traerMovimientos('tk')
    // El concepto trae "-135.89" como texto; el importe de la fila es otro.
    expect(movimientos[0]?.purpose).toBe('4/302460/639 -135.89 EUR')
    expect(movimientos[0]?.amount).toBe('99999999999999.99')
  })
})

describe('paginación', () => {
  it('trae todas las páginas y no sólo la primera', async () => {
    modo = 'normal'
    recibidas = []
    const movimientos = await traerMovimientos('tk', { porPagina: 2 })

    expect(movimientos).toHaveLength(4)
    expect(movimientos.map((m) => m.id)).toEqual([1860779443, 1860779444, 1860779445, 1860779446])
    expect(recibidas.filter((u) => u.startsWith('/api/v2/transactions'))).toHaveLength(2)
  })

  it('manda view=userView, que sin él finAPI contesta 400', async () => {
    modo = 'normal'
    recibidas = []
    await traerMovimientos('tk')
    expect(recibidas[0]).toContain('view=userView')
  })

  it('rechaza el lote cuando llegan menos elementos de los que finAPI declara', async () => {
    // Un lote incompleto no da error en ningún sitio más: da un informe que
    // cuadra consigo mismo y no con el banco.
    modo = 'mentirosa'
    await expect(traerMovimientos('tk')).rejects.toThrow(/declaró 4 elementos y llegaron 2/)
    modo = 'normal'
  })

  it('sin bloque "paging" no se da por buena la primera página de movimientos', async () => {
    // El otro camino hacia el mismo desastre: sin `paging` no hay `totalCount`
    // que comparar, así que la comprobación de arriba no corre y 500
    // movimientos pasarían por 1.612. Se corta antes de importar nada.
    modo = 'sin-paging'
    await expect(traerMovimientos('tk')).rejects.toThrow(/sin bloque "paging"/)
    modo = 'normal'
  })

  it('las cuentas SÍ pueden venir sin "paging", porque finAPI no las pagina', async () => {
    // Comprobado contra el sandbox: `GET /accounts` devuelve sólo la clave
    // `accounts`. Exigirle paginación dejaría el feed entero sin poder leer una
    // sola cuenta, así que la exigencia es por endpoint y no global.
    const cuentas = await traerCuentas('tk')
    expect(cuentas.length).toBeGreaterThan(0)
  })
})

describe('errores', () => {
  it('envuelve el error alemán de finAPI diciendo qué se estaba intentando', async () => {
    modo = 'error'
    const fallo = await traerMovimientos('tk').catch((error: unknown) => error)
    modo = 'normal'

    expect(fallo).toBeInstanceOf(FinapiError)
    const error = fallo as FinapiError
    expect(error.status).toBe(403)
    expect(error.message).toContain('no se pudo traer los movimientos')
    expect(error.message).toContain('(HTTP 403)')
    // El texto del servidor va detrás y sin tocar: es lo único que sirve para
    // buscarlo en su documentación.
    expect(error.message).toContain('direkte API-Aufrufe nicht zulässig')
    expect(error.message).toContain('[ILLEGAL_ENTITY_STATE]')
  })

  it('corta una llamada que no contesta en vez de colgar la petición web', async () => {
    modo = 'mudo'
    const fallo = await traerMovimientos('tk', { timeoutMs: 200 }).catch((e: unknown) => e)
    modo = 'normal'

    expect(fallo).toBeInstanceOf(FinapiError)
    expect((fallo as FinapiError).message).toMatch(/no contestó/)
  })

  it('dice qué variable de entorno falta en vez de fallar por dentro', async () => {
    const previo = process.env['FINAPI_CLIENT_SECRET']
    delete process.env['FINAPI_CLIENT_SECRET']
    olvidarTokenDeCliente()
    try {
      await expect(tokenDeCliente()).rejects.toThrow(/FINAPI_CLIENT_SECRET/)
      expect(faltanCredenciales()).toContain('FINAPI_CLIENT_SECRET')
    } finally {
      if (previo !== undefined) process.env['FINAPI_CLIENT_SECRET'] = previo
      olvidarTokenDeCliente()
    }
  })
})

describe('caché del token de cliente', () => {
  it('no vuelve a pedirlo mientras siga vigente', async () => {
    olvidarTokenDeCliente()
    recibidas = []

    const primero = await tokenDeCliente()
    const segundo = await tokenDeCliente()

    expect(primero).toBe(segundo)
    expect(recibidas.filter((u) => u.startsWith('/api/v2/oauth/token'))).toHaveLength(1)
  })

  it('lo vuelve a pedir cuando se olvida', async () => {
    olvidarTokenDeCliente()
    recibidas = []
    await tokenDeCliente()
    olvidarTokenDeCliente()
    await tokenDeCliente()
    expect(recibidas.filter((u) => u.startsWith('/api/v2/oauth/token'))).toHaveLength(2)
  })
})

describe('el resto de los campos', () => {
  it('guarda en crudo todo lo que vino, incluido lo anidado', async () => {
    modo = 'normal'
    const movimientos = await traerMovimientos('tk')
    const primero = movimientos[0]

    expect(primero?.category).toEqual({ id: 418, name: 'Versicherung' })
    expect(primero?.counterpartIban).toBe('DE26700800000077777000')
    expect(primero?.type).toBe('Überweisungsauftrag')
    expect(primero?.isPotentialDuplicate).toBe(false)
    expect(movimientos[1]?.isPotentialDuplicate).toBe(true)

    // `raw` es la única prueba dentro de seis meses: tiene que estar todo.
    expect(primero?.crudo['category.name']).toBe('Versicherung')
    expect(primero?.crudo['category.children.0']).toBe('419')
    expect(primero?.crudo['amount']).toBe('99999999999999.99')
  })

  it('deja las tres fechas separadas, sin elegir por el mapeador', async () => {
    modo = 'normal'
    const primero = (await traerMovimientos('tk'))[0]
    expect(primero?.bankBookingDate).toBe('2024-08-13')
    expect(primero?.valueDate).toBe('2024-08-13')
    expect(primero?.finapiBookingDate).toBe('2024-08-13')
  })

  it('no inventa la moneda de una cuenta que no la declara', async () => {
    // 'EUR' por defecto acá se comería el aviso 'moneda_no_declarada' del
    // mapeador, que es el único sitio donde alguien se enteraría.
    const cuentas = await traerCuentas('tk')
    expect(cuentas[0]?.accountCurrency).toBe('EUR')
    expect(cuentas[1]?.accountCurrency).toBeNull()
  })

  it('fecha el saldo con la última sincronización correcta, la más reciente', async () => {
    // La fecha no está en la raíz de la cuenta sino dentro de interfaces[], una
    // por interfaz. El saldo es el más fresco, así que le toca la mayor.
    const cuentas = await traerCuentas('tk')
    expect(cuentas[0]?.lastSuccessfulUpdate).toBe('2026-08-13T19:02:11.000+02:00')
    expect(cuentas[1]?.lastSuccessfulUpdate).toBeNull()
  })
})

describe('compatibilidad con el mapeador', () => {
  it('lo que devuelve el cliente entra en mapFinapiStatements sin traducción', async () => {
    modo = 'normal'
    const movimientos = await traerMovimientos('tk')
    const cuentas = await traerCuentas('tk')

    // La comprobación de verdad la hace el compilador: estas dos asignaciones
    // fallan al construir si los dos DTO se separan. Es la única forma de que
    // una divergencia entre `apps/web/lib/finapi` y `packages/importers` se
    // note antes de que alguien la descubra cableando la ruta.
    const paraElMapeador: RawTransaction[] = movimientos
    const cuentaParaElMapeador: RawAccount = cuentas[0] as RawAccount

    expect(paraElMapeador).toHaveLength(4)
    expect(cuentaParaElMapeador.id).toBe(3587742)
  })
})
