/**
 * Del cuerpo HTTP al bigint de la base, sin doblar nada por el medio.
 *
 * `sincronizar.test.ts` dobla `./client`, o sea que empieza **después** de la
 * frontera de red: sus movimientos ya llegan con `amount` como string porque
 * los escribe el propio test. Eso deja sin probar justamente el tramo donde el
 * importe se puede romper — el `JSON.parse` del cuerpo de la respuesta.
 *
 * Acá se levanta un servidor HTTP de verdad que contesta el JSON de finAPI
 * **como texto**, con los importes escritos como literales numéricos desnudos
 * igual que los manda el sandbox (`"amount":-135.89`). El único doble es el
 * servidor; de ahí para adentro corre el código de producción entero: cliente,
 * mapeador, pipeline, dedup, `persistImport` y Postgres.
 *
 * El corpus está elegido para que un solo `Number()` en cualquier punto del
 * camino haga fallar el test:
 *
 *  · `99999999999999.99` — `JSON.parse` lo devuelve como 99999999999999.98.
 *    Un céntimo perdido en la primera línea del cliente. Y en unidades mínimas
 *    son 9.999.999.999.999.999, que no es un entero exacto de IEEE-754: si
 *    alguien lo pasara por `number` tampoco sobreviviría a la ida y vuelta.
 *  · `0.10`, `0.20` y `-0.30` — suman cero exacto, y en coma flotante suman
 *    5,55e-17. Es el clásico, y es lo que convierte un delta de cero en un
 *    delta que no lo es.
 *
 * El saldo que declara la cuenta es la suma exacta. Si el importe se degrada,
 * el delta deja de ser cero y la reconciliación lo canta.
 */

import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  createPool,
  type Db,
  listImportBatches,
  revertImport,
  withoutTenantScope,
  withTenant,
} from '@moneypilot/db'
import { migrate } from '@moneypilot/db/migrate'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { olvidarTokenDeCliente } from './client'
import { tokenDelHogar, usuarioDelHogar } from './hogar'
import { prepararCuentas, sincronizarCuenta } from './sincronizar'

const ADMIN_URL = process.env['DATABASE_URL']
const APP_URL = process.env['DATABASE_APP_URL']
const suite = ADMIN_URL !== undefined && APP_URL !== undefined ? describe : describe.skip

const RUN = createHash('sha256')
  .update(`${process.pid}-${Date.now()}-${Math.random()}`)
  .digest('hex')
  .slice(0, 12)

const CUENTA = 3587742

/* ── El corpus venenoso ──────────────────────────────────────────────────── */

interface MovimientoCrudo {
  readonly id: number
  /** Tal cual se escribe en el cuerpo HTTP: literal numérico, sin comillas. */
  readonly amount: string
  readonly fecha: string
}

const CORPUS: readonly MovimientoCrudo[] = [
  { id: 1860779443, amount: '99999999999999.99', fecha: '2026-08-01' },
  { id: 1860779444, amount: '0.10', fecha: '2026-08-02' },
  { id: 1860779445, amount: '0.20', fecha: '2026-08-03' },
  { id: 1860779446, amount: '-0.30', fecha: '2026-08-04' },
]

/** La suma exacta del corpus, en unidades mínimas. */
const TOTAL_EXACTO = 9999999999999999n
/** El mismo número como decimal, que es lo que declara la cuenta. */
const SALDO_DECLARADO = '99999999999999.99'

/* ── El finAPI de mentira, pero por HTTP de verdad ───────────────────────── */

interface EstadoDelServidor {
  /** Cuántos movimientos por página. Con 2 y un corpus de 4 son dos páginas. */
  porPagina: number
  /** Para el caso de la página que se pierde: miente en `totalCount`. */
  totalCountFalso: number | null
  movimientos: readonly MovimientoCrudo[]
  saldo: string
}

/**
 * El cuerpo se compone como TEXTO a mano y no con `JSON.stringify`.
 *
 * No es un capricho del test: `JSON.stringify(99999999999999.99)` ya habría
 * pasado por un `number` y escribiría 99999999999999.98. El corpus tiene que
 * salir del servidor con los dígitos que declara, o no se está probando nada.
 */
function cuerpoDeMovimientos(estado: EstadoDelServidor, pagina: number): string {
  const porPagina = estado.porPagina
  const total = estado.movimientos.length
  const pageCount = Math.max(Math.ceil(total / porPagina), 1)
  const trozo = estado.movimientos.slice((pagina - 1) * porPagina, pagina * porPagina)

  const filas = trozo.map(
    (m) => `{
      "id": ${m.id},
      "parentId": null,
      "accountId": ${CUENTA},
      "valueDate": "${m.fecha}",
      "bankBookingDate": "${m.fecha}",
      "finapiBookingDate": "${m.fecha}",
      "amount": ${m.amount},
      "currency": "EUR",
      "purpose": "4/302460/${m.id}",
      "cleanedPurpose": "4/302460/${m.id}",
      "counterpartName": "ALLIANZ LV / FLESSA KG",
      "counterpartIban": "DE26700800000077777001",
      "counterpartBic": "DRESDEFF700",
      "counterpartAccountNumber": "77777001",
      "counterpartBankName": "Commerzbank vormals Dresdner Bank",
      "type": "Überweisungsauftrag",
      "typeCodeZka": "20",
      "category": { "id": 418, "name": "Versicherung", "parentId": null },
      "labels": [],
      "isPotentialDuplicate": false,
      "isNew": true
    }`,
  )

  const totalCount = estado.totalCountFalso ?? total
  return `{
    "transactions": [${filas.join(',')}],
    "paging": { "page": ${pagina}, "perPage": ${porPagina}, "pageCount": ${pageCount}, "totalCount": ${totalCount} },
    "income": 0.30,
    "spending": -0.30,
    "balance": ${estado.saldo}
  }`
}

function cuerpoDeCuentas(estado: EstadoDelServidor): string {
  // `balance` va como literal numérico desnudo, igual que en el sandbox.
  return `{
    "accounts": [{
      "id": ${CUENTA},
      "bankConnectionId": 3540249,
      "accountName": "Main-TestAccount",
      "iban": "DE26700800000077777000",
      "accountNumber": "77777000",
      "accountHolderName": "Max Mustermann",
      "accountCurrency": "EUR",
      "accountType": "Checking",
      "balance": ${estado.saldo},
      "overdraft": 0.0,
      "interfaces": [
        { "bankingInterface": "FINTS_SERVER", "lastSuccessfulUpdate": "2026-08-10 09:00:00.000" },
        { "bankingInterface": "XS2A", "lastSuccessfulUpdate": "2026-08-11 07:30:00.000" }
      ]
    }],
    "paging": { "page": 1, "perPage": 100, "pageCount": 1, "totalCount": 1 }
  }`
}

async function levantarServidor(
  estado: EstadoDelServidor,
): Promise<{ server: Server; base: string }> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const responder = (cuerpo: string, status = 200): void => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
      res.end(cuerpo)
    }

    if (url.pathname === '/api/v2/oauth/token') {
      responder(
        '{"access_token":"token-de-mentira","token_type":"bearer","expires_in":3599,"scope":"all"}',
      )
      return
    }
    if (url.pathname === '/api/v2/users' && req.method === 'POST') {
      responder(`{"id":"usuario-${RUN}","password":"clave-${RUN}"}`)
      return
    }
    if (url.pathname === '/api/v2/accounts') {
      responder(cuerpoDeCuentas(estado))
      return
    }
    if (url.pathname === '/api/v2/transactions') {
      // `view=userView` es obligatorio en finAPI: sin él contesta 400. Se
      // reproduce para que el test note si alguien lo quita del cliente.
      if (url.searchParams.get('view') !== 'userView') {
        responder('{"errors":[{"message":"view is required"}]}', 400)
        return
      }
      const pagina = Number(url.searchParams.get('page') ?? '1')
      responder(cuerpoDeMovimientos(estado, pagina))
      return
    }
    responder('{"errors":[{"message":"not found"}]}', 404)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { server, base: `http://127.0.0.1:${port}` }
}

/* ── Los casos ───────────────────────────────────────────────────────────── */

suite('del cuerpo HTTP al bigint de la base', () => {
  let admin: Db
  let app: Db
  let server: Server
  const hogares: string[] = []
  let hogar = ''

  const estado: EstadoDelServidor = {
    porPagina: 2,
    totalCountFalso: null,
    movimientos: CORPUS,
    saldo: SALDO_DECLARADO,
  }

  const entornoPrevio = {
    base: process.env['FINAPI_BASE'],
    id: process.env['FINAPI_CLIENT_ID'],
    secret: process.env['FINAPI_CLIENT_SECRET'],
  }

  beforeAll(async () => {
    await migrate(ADMIN_URL as string)
    admin = createPool({ connectionString: ADMIN_URL as string })
    app = createPool({ connectionString: APP_URL as string })

    const levantado = await levantarServidor(estado)
    server = levantado.server
    process.env['FINAPI_BASE'] = levantado.base
    process.env['FINAPI_CLIENT_ID'] = 'cliente-de-mentira'
    process.env['FINAPI_CLIENT_SECRET'] = 'secreto-de-mentira'
    olvidarTokenDeCliente()
  }, 60_000)

  afterAll(async () => {
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
    await new Promise<void>((resolve) => server.close(() => resolve()))

    process.env['FINAPI_BASE'] = entornoPrevio.base
    process.env['FINAPI_CLIENT_ID'] = entornoPrevio.id
    process.env['FINAPI_CLIENT_SECRET'] = entornoPrevio.secret
    olvidarTokenDeCliente()
  }, 60_000)

  beforeEach(async () => {
    estado.porPagina = 2
    estado.totalCountFalso = null
    estado.movimientos = CORPUS
    estado.saldo = SALDO_DECLARADO

    hogar = await withoutTenantScope(admin, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'insert into tenant (name, base_currency) values ($1, $2) returning id',
        [`Casa HTTP ${RUN} ${hogares.length}`, 'EUR'],
      )
      return rows[0]?.id as string
    })
    hogares.push(hogar)
  })

  const enHogar = <T>(fn: Parameters<typeof withTenant<T>>[2]): Promise<T> =>
    withTenant(app, hogar, fn)

  async function conectarYPreparar(): Promise<string> {
    return enHogar(async (client) => {
      await usuarioDelHogar(client)
      const token = (await tokenDelHogar(client)) as string
      const plan = await prepararCuentas(client, token, [])
      return plan[0]?.accountId as string
    })
  }

  const sincronizar = () =>
    enHogar(async (client) => {
      const token = (await tokenDelHogar(client)) as string
      return sincronizarCuenta(client, { token, externalAccountId: String(CUENTA) })
    })

  it('el importe que rompe en coma flotante llega exacto a la base', async () => {
    const accountId = await conectarYPreparar()
    const resultado = await sincronizar()

    expect(resultado.kind).toBe('ok')
    if (resultado.kind !== 'ok') return
    // Dos páginas de dos: si la paginación se quedara en la primera, serían 2.
    expect(resultado.imported).toBe(4)

    const filas = await enHogar(async (client) => {
      const { rows } = await client.query<{ external_id: string; amount: string }>(
        `select e.external_id, p.amount::text as amount
           from entry e join posting p on p.entry_id = e.id
          where p.account_id = $1::uuid
          order by e.booked_on`,
        [accountId],
      )
      return rows
    })

    // El grande, dígito a dígito. `JSON.parse` habría dado 9999999999999998.
    expect(filas[0]?.amount).toBe('9999999999999999')
    expect(filas.map((f) => f.amount)).toEqual(['9999999999999999', '10', '20', '-30'])

    // Y la suma, que es lo que ve el usuario.
    const saldo = await enHogar(async (client) => {
      const { rows } = await client.query<{ saldo: string }>(
        'select coalesce(sum(amount), 0)::text as saldo from posting where account_id = $1::uuid',
        [accountId],
      )
      return rows[0]?.saldo as string
    })
    expect(BigInt(saldo)).toBe(TOTAL_EXACTO)

    // El informe cierra contra el saldo que declaró finAPI. Con un solo
    // `Number()` por el camino, este delta sería 0,01 o 5,55e-17.
    const cuenta = resultado.report.accounts[0]
    expect(cuenta?.reportedClosing?.amount).toBe(SALDO_DECLARADO)
    expect(cuenta?.computedClosing?.amount).toBe(SALDO_DECLARADO)
    expect(cuenta?.delta?.amount).toBe('0.00')
    expect(cuenta?.status).toBe('conciliada')

    // La fecha valor llega separada de la contable, que es una de las cosas que
    // un feed da y un fichero rara vez: se guarda, no se tira por el camino.
    const fechas = await enHogar(async (client) => {
      const { rows } = await client.query<{ booked_on: string; valued_on: string | null }>(
        `select to_char(e.booked_on, 'YYYY-MM-DD') as booked_on,
                to_char(e.valued_on, 'YYYY-MM-DD') as valued_on
           from entry e join posting p on p.entry_id = e.id
          where p.account_id = $1::uuid
          order by e.booked_on`,
        [accountId],
      )
      return rows
    })
    expect(fechas[0]).toEqual({ booked_on: '2026-08-01', valued_on: '2026-08-01' })
    expect(fechas.every((f) => f.valued_on !== null)).toBe(true)
  }, 60_000)

  it('un literal con un solo decimal entra exacto, no truncado ni redondeado', async () => {
    // No es un caso inventado: el sandbox devuelve `"balance":0.0` en la cuenta
    // de ahorro y `"balance":4111.3` en la de valores. Un literal de JSON no
    // rellena ceros, así que dar por sentado que siempre vienen dos decimales
    // es dar por sentado algo que los datos reales desmienten.
    estado.movimientos = [
      { id: 1860779450, amount: '4111.3', fecha: '2026-08-01' },
      { id: 1860779451, amount: '0.0', fecha: '2026-08-02' },
    ]
    estado.saldo = '4111.3'

    const accountId = await conectarYPreparar()
    const resultado = await sincronizar()
    expect(resultado.kind).toBe('ok')
    if (resultado.kind !== 'ok') return

    const saldo = await enHogar(async (client) => {
      const { rows } = await client.query<{ saldo: string }>(
        'select coalesce(sum(amount), 0)::text as saldo from posting where account_id = $1::uuid',
        [accountId],
      )
      return rows[0]?.saldo as string
    })
    // 4111,30 EUR son 411130 unidades mínimas: ni 41113 ni 4111.
    expect(saldo).toBe('411130')
    expect(resultado.report.accounts[0]?.delta?.amount).toBe('0.00')
  }, 60_000)

  it('cada asiento balancea a cero por moneda', async () => {
    await conectarYPreparar()
    await sincronizar()

    const descuadres = await enHogar(async (client) => {
      const { rows } = await client.query<{ entry_id: string; currency: string; total: string }>(
        `select p.entry_id, trim(p.currency) as currency, sum(p.amount)::text as total
           from posting p
          group by p.entry_id, trim(p.currency)
         having sum(p.amount) <> 0`,
      )
      return rows
    })
    expect(descuadres).toEqual([])
  }, 60_000)

  it('sincronizar dos veces no mete un solo movimiento nuevo', async () => {
    const accountId = await conectarYPreparar()
    const primera = await sincronizar()
    if (primera.kind !== 'ok') throw new Error('la primera tenía que funcionar')

    const contar = () =>
      enHogar(async (client) => {
        const { rows } = await client.query<{ n: string }>('select count(*)::text as n from entry')
        return rows[0]?.n as string
      })

    const antes = await contar()
    const segunda = await sincronizar()

    expect(segunda.kind).toBe('ok')
    if (segunda.kind !== 'ok') return
    expect(segunda.guardado).toBe(false)
    expect(segunda.batchId).toBe(primera.batchId)
    expect(await contar()).toBe(antes)
    expect(await enHogar((client) => listImportBatches(client, 10))).toHaveLength(1)

    // Y el saldo no se movió ni un céntimo.
    const saldo = await enHogar(async (client) => {
      const { rows } = await client.query<{ saldo: string }>(
        'select coalesce(sum(amount), 0)::text as saldo from posting where account_id = $1::uuid',
        [accountId],
      )
      return rows[0]?.saldo as string
    })
    expect(BigInt(saldo)).toBe(TOTAL_EXACTO)
  }, 60_000)

  it('la segunda sincronización sólo trae lo nuevo, sin duplicar lo anterior', async () => {
    // El caso de verdad, y el que la huella de contenido NO cubre: el banco
    // añadió un movimiento, así que el contenido cambió y `persistImport` sí
    // corre. Lo que impide los 4 duplicados es el dedup, no el atajo del hash.
    const accountId = await conectarYPreparar()
    const primera = await sincronizar()
    if (primera.kind !== 'ok') throw new Error('la primera tenía que funcionar')
    expect(primera.imported).toBe(4)

    estado.movimientos = [...CORPUS, { id: 1860779447, amount: '-1.25', fecha: '2026-08-05' }]
    estado.saldo = '99999999999998.74'

    const segunda = await sincronizar()
    expect(segunda.kind).toBe('ok')
    if (segunda.kind !== 'ok') return

    expect(segunda.imported).toBe(1)
    expect(segunda.duplicates).toBe(4)
    expect(segunda.updated).toBe(0)
    expect(segunda.batchId).not.toBe(primera.batchId)

    const asientos = await enHogar(async (client) => {
      const { rows } = await client.query<{ n: string }>('select count(*)::text as n from entry')
      return rows[0]?.n as string
    })
    expect(asientos).toBe('5')

    // Y el saldo sigue cuadrando al céntimo contra lo que declara finAPI.
    const saldo = await enHogar(async (client) => {
      const { rows } = await client.query<{ saldo: string }>(
        'select coalesce(sum(amount), 0)::text as saldo from posting where account_id = $1::uuid',
        [accountId],
      )
      return rows[0]?.saldo as string
    })
    expect(BigInt(saldo)).toBe(TOTAL_EXACTO - 125n)
    expect(segunda.report.accounts[0]?.delta?.amount).toBe('0.00')
    expect(segunda.report.accounts[0]?.status).toBe('conciliada')
  }, 60_000)

  it('el lote sincronizado se deshace y deja el libro en cero', async () => {
    const accountId = await conectarYPreparar()
    const resultado = await sincronizar()
    if (resultado.kind !== 'ok') throw new Error('la sincronización tenía que funcionar')

    const deshecho = await enHogar((client) => revertImport(client, resultado.batchId))
    expect(deshecho.removedEntries).toBe(4)

    const saldo = await enHogar(async (client) => {
      const { rows } = await client.query<{ saldo: string }>(
        'select coalesce(sum(amount), 0)::text as saldo from posting where account_id = $1::uuid',
        [accountId],
      )
      return rows[0]?.saldo as string
    })
    expect(saldo).toBe('0')
  }, 60_000)

  it('si falta una página, la sincronización falla en vez de declarar éxito', async () => {
    // finAPI dice que hay cinco y manda cuatro. Es el modo de fallo que produce
    // un informe que cuadra consigo mismo y miente sobre el banco: "1.612
    // importados" cuando sólo llegó la primera página.
    estado.totalCountFalso = 5
    await conectarYPreparar()
    await expect(sincronizar()).rejects.toThrow(/declaró 5 elementos y llegaron 4/)

    // Y no dejó nada a medias.
    expect(await enHogar((client) => listImportBatches(client, 10))).toHaveLength(0)
  }, 60_000)
})
