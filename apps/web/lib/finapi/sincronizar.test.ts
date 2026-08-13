/**
 * El feed entero, desde lo que contesta finAPI hasta lo que queda en el libro.
 *
 * La red está doblada —no hace falta un agregador alemán para correr los
 * tests— pero **la base no**: estos casos corren contra Postgres de verdad,
 * porque lo que hay que demostrar es justamente lo que un doble no puede.
 *
 * Tres cosas se prueban acá y ninguna es cosmética:
 *
 *  1. **El céntimo llega exacto.** El corpus está elegido para que la suma en
 *     coma flotante NO dé el saldo que declara el banco: 0.10 + 0.20 en
 *     `number` es 0.30000000000000004. Si algún importe pasara por `Number()`
 *     en cualquier punto del camino, el delta dejaría de ser cero y este test
 *     fallaría. Es el motivo por el que existe el módulo de JSON exacto.
 *
 *  2. **El delta se puede comprobar.** Un fichero rara vez declara saldos;
 *     finAPI siempre dice cuánto hay. Contra el saldo que nuestro libro ya
 *     tenía, la ecuación cierra o no cierra, y eso se ve.
 *
 *  3. **Un movimiento corregido se reescribe en su sitio y no se duplica.**
 *     El asiento conserva su id, que es lo que salva la categorización que una
 *     persona hizo a mano.
 */

import { createHash } from 'node:crypto'
import {
  createPool,
  type Db,
  listImportBatches,
  revertImport,
  withoutTenantScope,
  withTenant,
} from '@moneypilot/db'
import { migrate } from '@moneypilot/db/migrate'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepararCuentas, sincronizarCuenta } from './sincronizar'
import type { FinapiRawAccount, FinapiRawTransaction } from './tipos'

/**
 * El estado del finAPI de mentira. Se declara con `vi.hoisted` porque la
 * fábrica de `vi.mock` se eleva por encima de los imports y necesita poder
 * verlo.
 */
const feed = vi.hoisted(() => ({
  cuentas: [] as unknown[],
  movimientos: [] as unknown[],
}))

vi.mock('./client', () => ({
  traerCuentas: async () => feed.cuentas,
  traerMovimientos: async () => feed.movimientos,
  // `hogar.ts` importa estos tres del mismo módulo. No se usan en estos casos,
  // pero un import con nombre que no existe en el doble rompe al cargar.
  crearUsuario: async () => ({ id: 'usuario-de-mentira', password: 'clave' }),
  borrarUsuario: async () => undefined,
  tokenDeUsuario: async () => 'token-de-mentira',
}))

const ADMIN_URL = process.env['DATABASE_URL']
const APP_URL = process.env['DATABASE_APP_URL']
const suite = ADMIN_URL !== undefined && APP_URL !== undefined ? describe : describe.skip

const hash = (seed: string): string => createHash('sha256').update(seed).digest('hex')
const RUN = hash(`${process.pid}-${Date.now()}-${Math.random()}`).slice(0, 12)

const CUENTA_FINAPI = 3587742

suite('sincronización del feed de finAPI', () => {
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
        await client.query('delete from tenant where id = any($1::uuid[])', [hogaresCreados])
      })
    }
    await admin?.end()
    await app?.end()
  })

  beforeEach(async () => {
    const creado = await withoutTenantScope(admin, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'insert into tenant (name, base_currency) values ($1, $2) returning id',
        [`Casa Feed Sync ${RUN} ${hogaresCreados.length}`, 'EUR'],
      )
      return rows[0]?.id as string
    })
    hogaresCreados.push(creado)
    hogar = creado
    feed.cuentas = []
    feed.movimientos = []
  })

  const enHogar = <T>(fn: Parameters<typeof withTenant<T>>[2]): Promise<T> =>
    withTenant(app, hogar, fn)

  const preparar = () => enHogar((client) => prepararCuentas(client, 'token', []))
  const sincronizar = () =>
    enHogar((client) =>
      sincronizarCuenta(client, { token: 'token', externalAccountId: String(CUENTA_FINAPI) }),
    )

  async function saldoDelLibro(accountId: string): Promise<string> {
    return enHogar(async (client) => {
      const { rows } = await client.query<{ saldo: string }>(
        'select coalesce(sum(amount), 0)::text as saldo from posting where account_id = $1',
        [accountId],
      )
      return rows[0]?.saldo ?? '0'
    })
  }

  it('crea una cuenta del libro por cada cuenta de finAPI', async () => {
    feed.cuentas = [cuenta({ balance: '0.30' })]
    const plan = await preparar()

    expect(plan).toHaveLength(1)
    expect(plan[0]?.creada).toBe(true)
    expect(plan[0]?.moneda).toBe('EUR')

    const cuentaCreada = await enHogar(async (client) => {
      const { rows } = await client.query<{
        name: string
        kind: string
        account_number: string | null
        country: string | null
      }>('select name, kind, account_number, country from account where id = $1', [
        plan[0]?.accountId,
      ])
      return rows[0]
    })
    expect(cuentaCreada?.kind).toBe('asset')
    // El IBAN propio va enmascarado, como en todos los parsers: sólo los
    // últimos dígitos hacen falta para que una persona reconozca la cuenta.
    expect(cuentaCreada?.account_number).toBe('••••7000')
    expect(cuentaCreada?.country).toBe('DE')
  })

  it('el saldo del libro cuadra al céntimo con el que declara finAPI', async () => {
    // 0.10 + 0.20 en coma flotante da 0.30000000000000004. Si el importe
    // hubiera pasado por `Number()` en cualquier punto —al leer el JSON, al
    // mapear, al persistir— el delta no sería cero y esto fallaría.
    feed.cuentas = [cuenta({ balance: '0.30' })]
    feed.movimientos = [
      movimiento({ id: 1, amount: '0.10', bankBookingDate: '2026-08-01' }),
      movimiento({ id: 2, amount: '0.20', bankBookingDate: '2026-08-02' }),
    ]
    const plan = await preparar()
    const resultado = await sincronizar()

    expect(resultado.kind).toBe('ok')
    if (resultado.kind !== 'ok') return

    expect(resultado.imported).toBe(2)
    expect(resultado.guardado).toBe(true)

    const enElInforme = resultado.report.accounts[0]
    expect(enElInforme?.reportedClosing?.amount).toBe('0.30')
    expect(enElInforme?.computedClosing?.amount).toBe('0.30')
    expect(enElInforme?.delta?.amount).toBe('0.00')
    expect(enElInforme?.status).toBe('conciliada')

    // Y en la base, en unidades mínimas: treinta céntimos exactos.
    expect(await saldoDelLibro(plan[0]?.accountId as string)).toBe('30')
  })

  it('el lote entra como origen api y con el formato del feed', async () => {
    feed.cuentas = [cuenta({ balance: '0.10' })]
    feed.movimientos = [movimiento({ id: 1, amount: '0.10', bankBookingDate: '2026-08-01' })]
    await preparar()
    await sincronizar()

    const origenes = await enHogar(async (client) => {
      const { rows } = await client.query<{ source: string }>(
        'select distinct source::text as source from entry',
      )
      return rows.map((row) => row.source)
    })
    // Es lo que después permite al dedup fiarse del identificador del
    // proveedor y reescribir en su sitio lo que el banco corrija.
    expect(origenes).toEqual(['api'])

    const lotes = await enHogar((client) => listImportBatches(client, 10))
    expect(lotes[0]?.format).toBe('finapi')
  })

  it('un movimiento que el banco corrige se reescribe en su sitio, no se duplica', async () => {
    feed.cuentas = [cuenta({ balance: '0.30' })]
    feed.movimientos = [
      movimiento({ id: 1, amount: '0.10', bankBookingDate: '2026-08-01' }),
      movimiento({ id: 2, amount: '0.20', bankBookingDate: '2026-08-02' }),
    ]
    const plan = await preparar()
    await sincronizar()

    const antes = await enHogar(async (client) => {
      const { rows } = await client.query<{ id: string; external_id: string | null }>(
        'select id, external_id from entry order by external_id',
      )
      return rows
    })

    // El banco asienta lo que estaba pendiente: mismo identificador, otro
    // importe y otra fecha contable.
    feed.cuentas = [cuenta({ balance: '0.35' })]
    feed.movimientos = [
      movimiento({ id: 1, amount: '0.10', bankBookingDate: '2026-08-01' }),
      movimiento({ id: 2, amount: '0.25', bankBookingDate: '2026-08-03' }),
    ]
    const segunda = await sincronizar()

    expect(segunda.kind).toBe('ok')
    if (segunda.kind !== 'ok') return

    expect(segunda.updated).toBe(1)
    expect(segunda.imported).toBe(0)
    expect(segunda.duplicates).toBe(1)

    const despues = await enHogar(async (client) => {
      const { rows } = await client.query<{ id: string; external_id: string | null }>(
        'select id, external_id from entry order by external_id',
      )
      return rows
    })
    // Dos asientos, no tres, y con los MISMOS identificadores: de la fila del
    // posting cuelgan las dimensiones y del asiento la cola de revisión.
    // Recrearlo perdería la atribución que alguien hizo a mano por un cambio
    // de cinco céntimos que decidió el banco.
    expect(despues).toEqual(antes)

    expect(await saldoDelLibro(plan[0]?.accountId as string)).toBe('35')
    expect(segunda.report.accounts[0]?.delta?.amount).toBe('0.00')
    expect(segunda.report.accounts[0]?.status).toBe('conciliada')

    // Y queda contado en el lote: una fila leída que no aparece en ninguna
    // columna del historial es un agujero que hace que nadie crea el informe.
    const lotes = await enHogar((client) => listImportBatches(client, 10))
    expect(lotes[0]?.updated).toBe(1)
    expect(lotes[0]?.linesRead).toBe(2)
  })

  it('resincronizar sin novedades no escribe un lote nuevo', async () => {
    feed.cuentas = [cuenta({ balance: '0.30' })]
    feed.movimientos = [
      movimiento({ id: 1, amount: '0.10', bankBookingDate: '2026-08-01' }),
      movimiento({ id: 2, amount: '0.20', bankBookingDate: '2026-08-02' }),
    ]
    await preparar()
    const primera = await sincronizar()
    const segunda = await sincronizar()

    expect(segunda.kind).toBe('ok')
    if (segunda.kind !== 'ok' || primera.kind !== 'ok') return

    // Mismo contenido, misma huella: `persistImport` reconoce que ya estaba y
    // devuelve el lote anterior en vez de crear uno de 1.612 duplicados.
    expect(segunda.guardado).toBe(false)
    expect(segunda.batchId).toBe(primera.batchId)
    expect(await enHogar((client) => listImportBatches(client, 10))).toHaveLength(1)
  })

  it('el lote del feed se deshace como cualquier otro', async () => {
    feed.cuentas = [cuenta({ balance: '0.30' })]
    feed.movimientos = [
      movimiento({ id: 1, amount: '0.10', bankBookingDate: '2026-08-01' }),
      movimiento({ id: 2, amount: '0.20', bankBookingDate: '2026-08-02' }),
    ]
    const plan = await preparar()
    const resultado = await sincronizar()
    if (resultado.kind !== 'ok') throw new Error('la primera sincronización tenía que funcionar')

    const deshecho = await enHogar((client) => revertImport(client, resultado.batchId))
    expect(deshecho.removedEntries).toBe(2)
    expect(await saldoDelLibro(plan[0]?.accountId as string)).toBe('0')

    // La cuenta sobrevive al deshacer: la creó la preparación, no el lote, y
    // borrarla se llevaría por delante lo que el usuario hubiera escrito ahí.
    const cuentas = await enHogar(async (client) => {
      const { rows } = await client.query('select id from account where id = $1', [
        plan[0]?.accountId,
      ])
      return rows.length
    })
    expect(cuentas).toBe(1)
  })

  it('una cuenta sin movimientos no deja un lote vacío ocupando su huella', async () => {
    feed.cuentas = [cuenta({ balance: '0.00' })]
    feed.movimientos = []
    await preparar()
    const resultado = await sincronizar()

    expect(resultado.kind).toBe('vacia')
    expect(await enHogar((client) => listImportBatches(client, 10))).toHaveLength(0)
  })

  it('se niega a mezclar divisas dentro de una cuenta', async () => {
    feed.cuentas = [cuenta({ balance: '0.30' })]
    await preparar()
    // finAPI cambia la divisa de la cuenta entre dos sincronizaciones: no es
    // un movimiento dudoso, es que la cuenta del libro ya no puede recibirla.
    feed.cuentas = [cuenta({ balance: '0.30', accountCurrency: 'USD' })]
    await expect(sincronizar()).rejects.toThrow(/una sola moneda/)
  })
})

/* ── El finAPI de mentira ────────────────────────────────────────────────── */

function cuenta(overrides: Partial<FinapiRawAccount> = {}): FinapiRawAccount {
  return {
    id: CUENTA_FINAPI,
    bankConnectionId: '9911',
    accountName: 'Girokonto',
    iban: 'DE26700800000077777000',
    accountNumber: '77777000',
    accountHolderName: 'Max Mustermann',
    accountCurrency: 'EUR',
    accountType: 'Checking',
    balance: '0.00',
    // Es la fecha a la que corresponde el saldo. Sin ella el mapeador no puede
    // fecharlo y lo descarta con un aviso, que es lo correcto.
    lastSuccessfulUpdate: '2026-08-10 09:00:00.000',
    crudo: {},
    ...overrides,
  }
}

interface MovimientoDePrueba {
  readonly id: number
  /** Cadena decimal exacta, como llega del cuerpo HTTP. Nunca un number. */
  readonly amount: string
  readonly bankBookingDate: string
  readonly purpose?: string
  readonly counterpartName?: string
}

function movimiento(entrada: MovimientoDePrueba): FinapiRawTransaction {
  return {
    id: entrada.id,
    accountId: CUENTA_FINAPI,
    amount: entrada.amount,
    currency: 'EUR',
    valueDate: entrada.bankBookingDate,
    bankBookingDate: entrada.bankBookingDate,
    finapiBookingDate: entrada.bankBookingDate,
    purpose: entrada.purpose ?? `4/302460/${entrada.id}`,
    cleanedPurpose: entrada.purpose ?? `4/302460/${entrada.id}`,
    counterpartName: entrada.counterpartName ?? 'ALLIANZ LV / FLESSA KG',
    counterpartIban: 'DE26700800000077777001',
    counterpartBic: 'DRESDEFF700',
    counterpartAccountNumber: '77777001',
    counterpartBankName: 'Commerzbank vormals Dresdner Bank',
    type: 'Überweisungsauftrag',
    typeCodeZka: '20',
    category: { id: 418, name: 'Versicherung' },
    isPotentialDuplicate: false,
    crudo: {},
  }
}
