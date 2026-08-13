/**
 * El cableado del feed, contra Postgres de verdad.
 *
 * Lo que hay que demostrar acá no lo puede demostrar un doble: que RLS aísla
 * la credencial del agregador entre hogares, que guardar dos veces el usuario
 * no pisa el primero —perderlo sería perder el acceso a todas las conexiones
 * bancarias de ese hogar— y que un choque de nombre de cuenta desambigua en
 * vez de tumbar la sincronización o de mezclar dos cuentas distintas.
 *
 * Sin DATABASE_URL se saltan solos, igual que el resto de los tests de base.
 */

import { createHash } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createPool, type Db, withoutTenantScope, withTenant } from '../client.js'
import { migrate } from '../migrate.js'
import {
  deleteFeedUser,
  ensureLedgerAccount,
  listConnections,
  listFeedAccounts,
  markFeedAccountSynced,
  readConnection,
  readFeedUser,
  recordConnection,
  saveFeedUser,
  updateConnection,
} from './feed.js'

const ADMIN_URL = process.env['DATABASE_URL']
const APP_URL = process.env['DATABASE_APP_URL']
const enabled = ADMIN_URL !== undefined && APP_URL !== undefined
const suite = enabled ? describe : describe.skip

const hash = (seed: string): string => createHash('sha256').update(seed).digest('hex')

/** Sufijo por corrida: otros agentes están usando la misma base al mismo tiempo. */
const RUN = hash(`${process.pid}-${Date.now()}-${Math.random()}`).slice(0, 12)

suite('cableado del feed de agregador', () => {
  let admin: Db
  let app: Db
  const hogaresCreados: string[] = []
  let hogar = ''

  beforeAll(async () => {
    await migrate(ADMIN_URL as string)
    admin = createPool({ connectionString: ADMIN_URL as string })
    app = createPool({ connectionString: APP_URL as string })
  }, 60_000)

  afterAll(async () => {
    if (hogaresCreados.length > 0) {
      await withoutTenantScope(admin, async (client) => {
        for (const table of ['review_item', 'declared_balance', 'entry', 'import_batch']) {
          await client.query(`delete from ${table} where tenant_id = any($1::uuid[])`, [
            hogaresCreados,
          ])
        }
        // feed_user, feed_connection, feed_account y account caen por cascada.
        await client.query('delete from tenant where id = any($1::uuid[])', [hogaresCreados])
      })
    }
    await admin?.end()
    await app?.end()
  })

  async function nuevoHogar(etiqueta: string): Promise<string> {
    const creado = await withoutTenantScope(admin, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'insert into tenant (name, base_currency) values ($1, $2) returning id',
        [`Casa Feed ${RUN} ${etiqueta}`, 'EUR'],
      )
      return rows[0]?.id as string
    })
    hogaresCreados.push(creado)
    return creado
  }

  beforeEach(async () => {
    hogar = await nuevoHogar(`t${hogaresCreados.length}`)
  })

  const enHogar = <T>(fn: Parameters<typeof withTenant<T>>[2], tenantId = hogar): Promise<T> =>
    withTenant(app, tenantId, fn)

  /* ── Usuario del hogar ─────────────────────────────────────────────────── */

  it('un hogar sin feed no tiene usuario, y eso no es un error', async () => {
    const usuario = await enHogar((client) => readFeedUser(client, 'finapi'))
    expect(usuario).toBeNull()
  })

  it('guarda el usuario del proveedor y lo devuelve entero', async () => {
    await enHogar((client) =>
      saveFeedUser(client, {
        provider: 'finapi',
        externalId: 'usuario-alpha',
        accessSecret: 'clave-alpha',
      }),
    )
    const leido = await enHogar((client) => readFeedUser(client, 'finapi'))
    expect(leido?.externalId).toBe('usuario-alpha')
    expect(leido?.accessSecret).toBe('clave-alpha')
  })

  it('guardar por segunda vez NO pisa el usuario que ya estaba', async () => {
    // Es la regla que impide perder el acceso: el identificador del usuario es
    // la llave de todas sus conexiones bancarias en finAPI, y sobrescribirlo
    // deja aquéllas vivas y sin dueño conocido — ni se leen ni se borran.
    await enHogar((client) =>
      saveFeedUser(client, {
        provider: 'finapi',
        externalId: 'el-bueno',
        accessSecret: 'clave-buena',
      }),
    )
    const segundo = await enHogar((client) =>
      saveFeedUser(client, {
        provider: 'finapi',
        externalId: 'el-de-la-carrera',
        accessSecret: 'otra',
      }),
    )
    // Devuelve el que quedó, no el que se pidió: así quien llama sabe que
    // acaba de crear un usuario huérfano en el proveedor y tiene que borrarlo.
    expect(segundo.externalId).toBe('el-bueno')
    expect(segundo.accessSecret).toBe('clave-buena')
  })

  it('la credencial del agregador no se ve desde otro hogar', async () => {
    // El modo de fallo que esta prueba descarta es el peor de todos: la fila
    // de feed_user es la llave de los datos bancarios de una familia.
    await enHogar((client) =>
      saveFeedUser(client, { provider: 'finapi', externalId: 'secreto', accessSecret: 'ssh' }),
    )
    const vecino = await nuevoHogar('vecino')
    const desdeFuera = await enHogar((client) => readFeedUser(client, 'finapi'), vecino)
    expect(desdeFuera).toBeNull()
  })

  it('borrar el usuario lo quita y dice si había algo que quitar', async () => {
    await enHogar((client) =>
      saveFeedUser(client, { provider: 'finapi', externalId: 'u', accessSecret: 'c' }),
    )
    expect(await enHogar((client) => deleteFeedUser(client, 'finapi'))).toBe(true)
    expect(await enHogar((client) => deleteFeedUser(client, 'finapi'))).toBe(false)
    expect(await enHogar((client) => readFeedUser(client, 'finapi'))).toBeNull()
  })

  /* ── Conexiones ────────────────────────────────────────────────────────── */

  it('registra una conexión y la deja lista para sondear', async () => {
    const conexion = await enHogar((client) =>
      recordConnection(client, {
        provider: 'finapi',
        bankId: '280001',
        bankName: 'finAPI Test Bank',
        webFormId: 'form-1',
        status: 'NOT_YET_OPENED',
      }),
    )
    expect(conexion.bankConnectionId).toBeNull()
    expect(await enHogar((client) => listConnections(client, 'finapi'))).toHaveLength(1)
  })

  it('un sondeo posterior no borra el identificador de conexión que ya sabíamos', async () => {
    // finAPI rellena `bankConnectionId` cuando el formulario termina; los
    // sondeos siguientes pueden no traerlo. Si lo pisáramos con null,
    // perderíamos el único puntero a la conexión bancaria de esa persona.
    const conexion = await enHogar((client) =>
      recordConnection(client, {
        provider: 'finapi',
        bankId: '280001',
        bankName: 'finAPI Test Bank',
        webFormId: 'form-2',
        status: 'NOT_YET_OPENED',
      }),
    )
    await enHogar((client) =>
      updateConnection(client, {
        id: conexion.id,
        status: 'COMPLETED',
        bankConnectionId: '77123',
      }),
    )
    const despues = await enHogar((client) =>
      updateConnection(client, { id: conexion.id, status: 'COMPLETED' }),
    )
    expect(despues.bankConnectionId).toBe('77123')
  })

  it('la conexión de otro hogar es indistinguible de una inexistente', async () => {
    const conexion = await enHogar((client) =>
      recordConnection(client, {
        provider: 'finapi',
        bankId: '280001',
        bankName: 'finAPI Test Bank',
        webFormId: 'form-3',
        status: 'COMPLETED',
      }),
    )
    const vecino = await nuevoHogar('mirón')
    expect(await enHogar((client) => readConnection(client, conexion.id), vecino)).toBeNull()
    await expect(
      enHogar((client) => updateConnection(client, { id: conexion.id, status: 'ABORTED' }), vecino),
    ).rejects.toThrow(/no existe en este hogar/)
  })

  /* ── Cuentas ───────────────────────────────────────────────────────────── */

  it('crea la cuenta del libro la primera vez y la reutiliza después', async () => {
    const primera = await enHogar((client) =>
      ensureLedgerAccount(client, {
        provider: 'finapi',
        externalAccountId: '3587742',
        name: 'finAPI Test Bank · Girokonto',
        kind: 'asset',
        currency: 'EUR',
        institution: 'finAPI Test Bank',
        accountNumber: '••••7000',
        country: 'DE',
      }),
    )
    expect(primera.created).toBe(true)

    const segunda = await enHogar((client) =>
      ensureLedgerAccount(client, {
        provider: 'finapi',
        externalAccountId: '3587742',
        name: 'finAPI Test Bank · Girokonto',
        kind: 'asset',
        currency: 'EUR',
      }),
    )
    expect(segunda.created).toBe(false)
    expect(segunda.accountId).toBe(primera.accountId)
    expect(await enHogar((client) => listFeedAccounts(client, 'finapi'))).toHaveLength(1)
  })

  it('no pisa el nombre que la persona le puso a su cuenta', async () => {
    // Renombrar "Girokonto" a "Cuenta de la sociedad" es una decisión del
    // usuario. Que la próxima sincronización la deshiciera convertiría su
    // plan de cuentas en un dato volátil del agregador.
    const creada = await enHogar((client) =>
      ensureLedgerAccount(client, {
        provider: 'finapi',
        externalAccountId: '99',
        name: 'Girokonto',
        kind: 'asset',
        currency: 'EUR',
      }),
    )
    await enHogar((client) =>
      client.query('update account set name = $2 where id = $1', [
        creada.accountId,
        'Cuenta de la sociedad',
      ]),
    )
    const otra = await enHogar((client) =>
      ensureLedgerAccount(client, {
        provider: 'finapi',
        externalAccountId: '99',
        name: 'Girokonto',
        kind: 'asset',
        currency: 'EUR',
      }),
    )
    expect(otra.name).toBe('Cuenta de la sociedad')
    expect(otra.accountId).toBe(creada.accountId)
  })

  it('un nombre ya ocupado se desambigua en vez de fallar o de mezclarse', async () => {
    // Reutilizar la cuenta que se llama igual mezclaría dos cuentas distintas
    // y daría un saldo que no es el de ninguna; fallar dejaría muerta la
    // sincronización por un nombre.
    const ajena = await enHogar((client) =>
      client.query<{ id: string }>(
        `insert into account (tenant_id, kind, name, currency)
         values ($1, 'asset', 'Girokonto', 'EUR') returning id`,
        [hogar],
      ),
    )
    const nueva = await enHogar((client) =>
      ensureLedgerAccount(client, {
        provider: 'finapi',
        externalAccountId: '4242',
        name: 'Girokonto',
        kind: 'asset',
        currency: 'EUR',
      }),
    )
    expect(nueva.created).toBe(true)
    expect(nueva.accountId).not.toBe(ajena.rows[0]?.id)
    expect(nueva.name).toBe('Girokonto (finapi 4242)')
  })

  it('una cuenta del libro no la puede alimentar un segundo feed', async () => {
    // Dos cuentas del agregador escribiendo en la misma cuenta nuestra darían
    // un saldo que no es el de ninguna, y el delta contra el saldo declarado
    // —que es lo que hace comprobable esta importación— dejaría de significar
    // nada. Lo impide `feed_account_once`.
    const primera = await enHogar((client) =>
      ensureLedgerAccount(client, {
        provider: 'finapi',
        externalAccountId: '1000',
        name: 'Compartida',
        kind: 'asset',
        currency: 'EUR',
      }),
    )
    await expect(
      enHogar((client) =>
        client.query(
          `insert into feed_account (tenant_id, provider, external_account_id, account_id)
           values ($1, 'finapi', '2000', $2)`,
          [hogar, primera.accountId],
        ),
      ),
    ).rejects.toThrow(/feed_account_once/)
  })

  it('marca la última sincronización sin tocar nada más', async () => {
    await enHogar((client) =>
      ensureLedgerAccount(client, {
        provider: 'finapi',
        externalAccountId: '555',
        name: 'Tagesgeld',
        kind: 'asset',
        currency: 'EUR',
      }),
    )
    expect(
      (await enHogar((client) => listFeedAccounts(client, 'finapi')))[0]?.lastSyncedAt,
    ).toBeNull()

    await enHogar((client) => markFeedAccountSynced(client, 'finapi', '555'))
    const despues = await enHogar((client) => listFeedAccounts(client, 'finapi'))
    expect(despues[0]?.lastSyncedAt).not.toBeNull()
  })

  it('las cuentas enlazadas de un hogar no se ven desde otro', async () => {
    await enHogar((client) =>
      ensureLedgerAccount(client, {
        provider: 'finapi',
        externalAccountId: '7777',
        name: 'Privada',
        kind: 'asset',
        currency: 'EUR',
      }),
    )
    const vecino = await nuevoHogar('curioso')
    expect(await enHogar((client) => listFeedAccounts(client, 'finapi'), vecino)).toEqual([])
  })
})
