/**
 * El feed de Plaid entero, desde lo que contesta su API hasta lo que queda en
 * el libro.
 *
 * La red está doblada —no hace falta una cuenta en un agregador para correr los
 * tests— pero **la base no**: estos casos corren contra Postgres de verdad,
 * porque lo que hay que demostrar es justamente lo que un doble no puede.
 *
 * Cuatro cosas se prueban acá y ninguna es cosmética:
 *
 *  1. **El signo NO está invertido.** En Plaid un importe positivo es dinero
 *     que sale. Si el mapeador se equivocara, el asiento balancearía igual, la
 *     importación no daría un aviso y lo único que pasaría es que todos los
 *     gastos serían ingresos. Por eso hay un caso con un gasto y un ingreso en
 *     el mismo lote y se comprueba el neto, que es lo que distingue "invertido"
 *     de "coherentemente invertido".
 *
 *  2. **El cursor se guarda y se reusa.** La segunda sincronización tiene que
 *     pedir desde donde quedó la primera y traer sólo lo nuevo.
 *
 *  3. **'modified' reescribe en su sitio.** El asiento conserva su id, que es
 *     lo que salva la categorización que una persona hizo a mano.
 *
 *  4. **'removed' anula, no borra.** El asiento original se queda, enlazado con
 *     su espejo, y el saldo llega al del banco por suma.
 */

import { createHash } from 'node:crypto'
import {
  createPool,
  type Db,
  listImportBatches,
  readConnection,
  revertImport,
  withoutTenantScope,
  withTenant,
} from '@moneypilot/db'
import { migrate } from '@moneypilot/db/migrate'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { registrarConexion } from './conexion'
import { asentarLectura, leerDelItem } from './sincronizar'
import type { CuentaPlaid, LoteDeSincronizacion, MovimientoPlaid } from './tipos'

/**
 * El estado del Plaid de mentira. Se declara con `vi.hoisted` porque la fábrica
 * de `vi.mock` se eleva por encima de los imports y necesita poder verlo.
 *
 * `lotes` es una cola: cada llamada a `/transactions/sync` consume la primera.
 * Cuando se acaba, se devuelven lotes vacíos con el último cursor, que es
 * exactamente lo que hace Plaid cuando ya no tiene nada que contar.
 */
const plaid = vi.hoisted(() => ({
  cuentas: [] as unknown[],
  lotes: [] as unknown[],
  cursorFinal: '',
  /** Los cursores con los que se llamó, en orden. `null` es "sin cursor". */
  cursores: [] as (string | null)[],
}))

vi.mock('./client', () => ({
  canjearPublicToken: async () => ({
    accessToken: 'access-de-mentira',
    itemId: `item-${Math.random().toString(36).slice(2, 10)}`,
  }),
  traerCuentas: async () => plaid.cuentas,
  sincronizar: async (_token: string, cursor?: string) => {
    plaid.cursores.push(cursor ?? null)
    const siguiente = plaid.lotes.shift()
    if (siguiente !== undefined) {
      const lote = siguiente as LoteDeSincronizacion
      plaid.cursorFinal = lote.cursor
      return lote
    }
    return {
      added: [],
      modified: [],
      removed: [],
      cursor: plaid.cursorFinal,
      hasMore: false,
      estado: 'HISTORICAL_UPDATE_COMPLETE',
      // **Vacío también quiere decir sin cuentas**, y esto no es un detalle del
      // doble: es lo que hace Plaid. Medido contra su sandbox — en cuanto un
      // lote no trae movimientos, `accounts` viene con cero elementos, así que
      // toda sincronización incremental termina sin lista de cuentas y cae al
      // reemplazo `/accounts/get`. Mientras acá se devolvía `plaid.cuentas`,
      // este doble contaba una historia que el proveedor no cuenta y tapaba el
      // fallo que arregla `cuentasAsentables`.
      cuentas: [],
    }
  },
}))

const ADMIN_URL = process.env['DATABASE_URL']
const APP_URL = process.env['DATABASE_APP_URL']
const suite = ADMIN_URL !== undefined && APP_URL !== undefined ? describe : describe.skip

const hash = (seed: string): string => createHash('sha256').update(seed).digest('hex')
const RUN = hash(`${process.pid}-${Date.now()}-${Math.random()}`).slice(0, 12)

const CUENTA = 'cuenta-de-plaid-1'
const HOY = '2026-08-31'

suite('sincronización del feed de Plaid', () => {
  let admin: Db
  let app: Db
  const hogaresCreados: string[] = []
  let hogar = ''
  let conexionId = ''

  beforeAll(async () => {
    await migrate(ADMIN_URL as string)
    admin = createPool({ connectionString: ADMIN_URL as string })
    app = createPool({ connectionString: APP_URL as string })
  }, 60_000)

  afterAll(async () => {
    if (hogaresCreados.length > 0) {
      await withoutTenantScope(admin, async (client) => {
        // `entry` dos veces: la primera no puede borrar los asientos que
        // todavía tienen otro apuntándolos por `reversed_by`, que es on delete
        // restrict. Se sueltan los enlaces y recién entonces se borran.
        await client.query(
          'update entry set reversed_by = null where tenant_id = any($1::uuid[])',
          [hogaresCreados],
        )
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
        [`Casa Plaid ${RUN} ${hogaresCreados.length}`, 'EUR'],
      )
      const id = rows[0]?.id as string
      // La cuenta de patrimonio que `provision_household` crea con cada hogar.
      // Acá el hogar se inserta a mano —el test no pasa por el alta— así que
      // hay que ponerla, y es la que la apertura tiene que reutilizar.
      await client.query(
        `insert into account (tenant_id, kind, name, currency)
         values ($1, 'equity', 'Saldo de apertura', 'EUR')`,
        [id],
      )
      return id
    })
    hogaresCreados.push(creado)
    hogar = creado
    plaid.cuentas = []
    plaid.lotes = []
    plaid.cursorFinal = ''
    plaid.cursores = []

    const conexion = await withTenant(app, hogar, (client) =>
      registrarConexion(client, {
        publicToken: 'public-de-mentira',
        institutionId: 'ins_68',
        institutionName: 'BBVA · Banca Personal',
      }),
    )
    conexionId = conexion.id
  })

  const enHogar = <T>(fn: Parameters<typeof withTenant<T>>[2]): Promise<T> =>
    withTenant(app, hogar, fn)

  /**
   * El recorrido de la ruta, sin la ruta: leer del proveedor (sin transacción)
   * y asentar (en una). `esperaMs: 0` porque acá no hay nada que esperar.
   */
  async function sincronizar() {
    const lectura = await leerDelItem('access-de-mentira', await cursorGuardado(), {
      esperaMs: 0,
    })
    return enHogar((client) =>
      asentarLectura(client, { connectionId: conexionId, lectura, balanceAsOf: HOY }),
    )
  }

  async function cursorGuardado(): Promise<string | null> {
    const conexion = await enHogar((client) => readConnection(client, conexionId))
    return conexion?.syncCursor ?? null
  }

  async function saldo(accountId: string): Promise<string> {
    return enHogar(async (client) => {
      const { rows } = await client.query<{ saldo: string }>(
        'select coalesce(sum(amount), 0)::text as saldo from posting where account_id = $1',
        [accountId],
      )
      return rows[0]?.saldo ?? '0'
    })
  }

  async function cuentaDelLibro(): Promise<string> {
    return enHogar(async (client) => {
      const { rows } = await client.query<{ account_id: string }>(
        'select account_id from feed_account where external_account_id = $1',
        [CUENTA],
      )
      return rows[0]?.account_id as string
    })
  }

  /* ── El signo ──────────────────────────────────────────────────────────── */

  it('un gasto sale y un ingreso entra: el signo de Plaid se invierte una sola vez', async () => {
    plaid.cuentas = [cuenta({ saldoActual: '90.00' })]
    plaid.lotes = [
      lote({
        added: [
          // En Plaid, POSITIVO = sale de la cuenta.
          movimiento({ id: 'gasto', importe: '10.00', fecha: '2026-08-01', nombre: 'MERCADONA' }),
          // Y negativo = entra.
          movimiento({ id: 'sueldo', importe: '-100.00', fecha: '2026-08-02', nombre: 'NOMINA' }),
        ],
        cursor: 'cursor-1',
      }),
    ]

    const resultado = await sincronizar()
    const cuentaId = await cuentaDelLibro()
    const primera = resultado.cuentas[0]

    expect(primera?.kind).toBe('ok')
    if (primera?.kind !== 'ok') return
    expect(primera.imported).toBe(2)

    // Lo que decide todo: +90,00 y no −90,00. Un mapeo invertido daría el
    // mismo asiento balanceado, el mismo informe conciliado y el patrimonio al
    // revés.
    expect(await saldo(cuentaId)).toBe('9000')
    expect(primera.report.accounts[0]?.movements.amount).toBe('90.00')
    expect(primera.report.accounts[0]?.delta?.amount).toBe('0.00')
    expect(primera.report.accounts[0]?.status).toBe('conciliada')

    // Y fila por fila, que es donde se ve que no están las dos invertidas.
    const patas = await enHogar(async (client) => {
      const { rows } = await client.query<{ external_id: string; amount: string }>(
        `select e.external_id, p.amount::text as amount
           from entry e join posting p on p.entry_id = e.id and p.account_id = $1
          order by e.external_id`,
        [cuentaId],
      )
      return rows
    })
    expect(patas).toEqual([
      { external_id: 'gasto', amount: '-1000' },
      { external_id: 'sueldo', amount: '10000' },
    ])
  })

  /* ── El nombre de la cuenta ────────────────────────────────────────────── */

  it('el banco no se mete dentro del nombre: para eso está la columna', async () => {
    // La etiqueta que se vio en pantalla era «BBVA · Banca Personal · BBVA ·
    // Banca Personal · Cuenta Corriente 0000»: el nombre guardado ya traía el
    // banco y el selector de importación lo anteponía otra vez. Ninguno de los
    // dos estaba mal por su cuenta; el dato estaba en dos sitios.
    plaid.cuentas = [cuenta({ nombre: 'Cuenta Corriente', saldoActual: '0.00' })]
    plaid.lotes = [
      lote({
        added: [movimiento({ id: 'x', importe: '0.00', fecha: '2026-08-01' })],
        cursor: 'c1',
      }),
    ]
    await sincronizar()

    const fila = await enHogar(async (client) => {
      const { rows } = await client.query<{ name: string; institution: string | null }>(
        `select a.name, a.institution
           from account a
           join feed_account fa on fa.account_id = a.id
          where fa.external_account_id = $1`,
        [CUENTA],
      )
      return rows[0]
    })

    // Los últimos dígitos sí van pegados: distinguen dos cuentas del mismo
    // banco que si no se llamarían igual.
    expect(fila?.name).toBe('Cuenta Corriente 0000')
    expect(fila?.institution).toBe('BBVA · Banca Personal')
    expect(fila?.name).not.toContain('BBVA')
  })

  it('el saldo del libro cuadra al céntimo con el que declara Plaid', async () => {
    // 0.10 + 0.20 en coma flotante da 0.30000000000000004. Si el importe
    // hubiera pasado por `Number()` en cualquier punto —al leer el JSON, al
    // adaptar, al mapear, al persistir— el delta no sería cero y esto fallaría.
    plaid.cuentas = [cuenta({ saldoActual: '0.30' })]
    plaid.lotes = [
      lote({
        added: [
          movimiento({ id: 'a', importe: '-0.10', fecha: '2026-08-01' }),
          movimiento({ id: 'b', importe: '-0.20', fecha: '2026-08-02' }),
        ],
        cursor: 'cursor-1',
      }),
    ]

    await sincronizar()
    expect(await saldo(await cuentaDelLibro())).toBe('30')
  })

  it('una tarjeta de crédito entra como deuda y su saldo se invierte', async () => {
    plaid.cuentas = [
      cuenta({ saldoActual: '410.00', tipo: 'credit', subtipo: 'credit card', nombre: 'Visa' }),
    ]
    plaid.lotes = [
      lote({
        added: [movimiento({ id: 'compra', importe: '10.00', fecha: '2026-08-10' })],
        cursor: 'cursor-1',
      }),
    ]

    const resultado = await sincronizar()
    const cuentaId = await cuentaDelLibro()

    const clase = await enHogar(async (client) => {
      const { rows } = await client.query<{ kind: string }>(
        'select kind::text as kind from account where id = $1',
        [cuentaId],
      )
      return rows[0]?.kind
    })
    expect(clase).toBe('liability')

    // Plaid declara 410 de deuda en positivo; el libro la ve como −410. Si se
    // copiara tal cual, el patrimonio sumaría la deuda en vez de restarla.
    expect(await saldo(cuentaId)).toBe('-41000')
    expect(resultado.cuentas[0]?.kind).toBe('ok')
    if (resultado.cuentas[0]?.kind !== 'ok') return
    expect(resultado.cuentas[0].report.accounts[0]?.delta?.amount).toBe('0.00')
  })

  /* ── Los pendientes ────────────────────────────────────────────────────── */

  it('un movimiento pendiente no entra al libro y se dice por qué', async () => {
    plaid.cuentas = [cuenta({ saldoActual: '-10.00' })]
    plaid.lotes = [
      lote({
        added: [
          movimiento({ id: 'asentado', importe: '10.00', fecha: '2026-08-01' }),
          movimiento({ id: 'pendiente', importe: '25.00', fecha: '2026-08-02', pending: true }),
        ],
        cursor: 'cursor-1',
      }),
    ]

    const resultado = await sincronizar()
    const primera = resultado.cuentas[0]
    expect(primera?.kind).toBe('ok')
    if (primera?.kind !== 'ok') return

    expect(primera.imported).toBe(1)
    expect(await saldo(await cuentaDelLibro())).toBe('-1000')

    const avisos = primera.report.warnings.map((aviso) => aviso.code)
    expect(avisos).toContain('movimiento_pendiente')
    expect(avisos).toContain('pendientes_no_asentados')
  })

  /* ── El cursor ─────────────────────────────────────────────────────────── */

  it('el cursor se guarda y la segunda sincronización trae sólo lo nuevo', async () => {
    plaid.cuentas = [cuenta({ saldoActual: '-10.00' })]
    plaid.lotes = [
      lote({
        added: [movimiento({ id: 'uno', importe: '10.00', fecha: '2026-08-01' })],
        cursor: 'cursor-1',
      }),
    ]
    const primera = await sincronizar()
    expect(primera.cursorGuardado).toBe(true)

    // La primera vez se pide sin cursor y se sondea hasta tres lotes vacíos
    // seguidos: es la única regla que aguantó la medición contra el sandbox.
    expect(plaid.cursores[0]).toBeNull()
    expect(plaid.cursores.filter((cursor) => cursor === 'cursor-1')).toHaveLength(3)
    expect(await cursorGuardado()).toBe('cursor-1')

    // Segunda vuelta: un movimiento nuevo y nada más.
    plaid.cursores = []
    plaid.cuentas = [cuenta({ saldoActual: '-30.00' })]
    plaid.lotes = [
      lote({
        added: [movimiento({ id: 'dos', importe: '20.00', fecha: '2026-08-05' })],
        cursor: 'cursor-2',
      }),
    ]
    const segunda = await sincronizar()

    // Con cursor guardado alcanza un lote vacío: el histórico ya se entregó.
    expect(plaid.cursores[0]).toBe('cursor-1')
    expect(plaid.cursores).toHaveLength(2)
    expect(await cursorGuardado()).toBe('cursor-2')

    const cuenta2 = segunda.cuentas[0]
    expect(cuenta2?.kind).toBe('ok')
    if (cuenta2?.kind !== 'ok') return
    // Sólo el nuevo: el primero ni siquiera volvió a llegar.
    expect(cuenta2.imported).toBe(1)
    expect(cuenta2.report.linesRead).toBe(1)
    expect(await saldo(await cuentaDelLibro())).toBe('-3000')
    expect(await enHogar((client) => listImportBatches(client, 10))).toHaveLength(2)
  })

  it('un item que todavía no está listo no se toma por un item sin movimientos', async () => {
    // Esto pasó de verdad contra el sandbox y no dio ningún error: la primera
    // sincronización de un item recién conectado contestó tres lotes vacíos
    // seguidos con `NOT_READY` —Plaid seguía hablando con el banco— y se
    // guardó el cursor con cero movimientos. La cuenta quedaba conciliada,
    // vacía y con el cursor adelantado.
    plaid.cuentas = [cuenta({ saldoActual: '-10.00' })]
    plaid.lotes = [
      lote({ estado: 'NOT_READY', cursor: '' }),
      lote({ estado: 'NOT_READY', cursor: '' }),
      lote({ estado: 'INITIAL_UPDATE_COMPLETE', cursor: '' }),
      lote({
        added: [movimiento({ id: 'tarde', importe: '10.00', fecha: '2026-08-01' })],
        estado: 'HISTORICAL_UPDATE_COMPLETE',
        cursor: 'cursor-1',
      }),
    ]

    const resultado = await sincronizar()
    const primera = resultado.cuentas[0]
    expect(primera?.kind).toBe('ok')
    if (primera?.kind !== 'ok') return

    expect(primera.imported).toBe(1)
    expect(await saldo(await cuentaDelLibro())).toBe('-1000')
  })

  it('sin novedades no se escribe ningún lote', async () => {
    plaid.cuentas = [cuenta({ saldoActual: '-10.00' })]
    plaid.lotes = [
      lote({
        added: [movimiento({ id: 'uno', importe: '10.00', fecha: '2026-08-01' })],
        cursor: 'cursor-1',
      }),
    ]
    await sincronizar()
    const segunda = await sincronizar()

    expect(segunda.cuentas[0]?.kind).toBe('vacia')
    // Un lote vacío ocuparía su huella de contenido y el día que la cuenta
    // tenga movimientos, sincronizarla no haría nada.
    expect(await enHogar((client) => listImportBatches(client, 10))).toHaveLength(1)
  })

  /* ── Corregidos y retirados ────────────────────────────────────────────── */

  it("un 'modified' reescribe el asiento en su sitio y no lo duplica", async () => {
    plaid.cuentas = [cuenta({ saldoActual: '-10.00' })]
    plaid.lotes = [
      lote({
        added: [movimiento({ id: 'uno', importe: '10.00', fecha: '2026-08-01' })],
        cursor: 'cursor-1',
      }),
    ]
    await sincronizar()

    const antes = await enHogar(async (client) => {
      const { rows } = await client.query<{ id: string; external_id: string | null }>(
        'select id, external_id from entry order by external_id',
      )
      return rows
    })

    // El banco asienta lo que estaba pendiente: mismo identificador, otro
    // importe. Es el veredicto 'updated' del dedup.
    plaid.cuentas = [cuenta({ saldoActual: '-12.50' })]
    plaid.lotes = [
      lote({
        modified: [movimiento({ id: 'uno', importe: '12.50', fecha: '2026-08-01' })],
        cursor: 'cursor-2',
      }),
    ]
    const segunda = await sincronizar()

    const cuenta1 = segunda.cuentas[0]
    expect(cuenta1?.kind).toBe('ok')
    if (cuenta1?.kind !== 'ok') return
    expect(cuenta1.updated).toBe(1)
    expect(cuenta1.imported).toBe(0)

    const despues = await enHogar(async (client) => {
      const { rows } = await client.query<{ id: string; external_id: string | null }>(
        'select id, external_id from entry order by external_id',
      )
      return rows
    })
    // El mismo asiento con el mismo id: de la fila del posting cuelgan las
    // dimensiones, y recrearlo perdería lo que alguien atribuyó a mano.
    expect(despues).toEqual(antes)
    expect(await saldo(await cuentaDelLibro())).toBe('-1250')
    expect(cuenta1.report.accounts[0]?.delta?.amount).toBe('0.00')
  })

  it("un 'removed' de algo ya asentado se anula con un espejo y no se borra", async () => {
    plaid.cuentas = [cuenta({ saldoActual: '-30.00' })]
    plaid.lotes = [
      lote({
        added: [
          movimiento({ id: 'queda', importe: '10.00', fecha: '2026-08-01' }),
          movimiento({ id: 'retirado', importe: '20.00', fecha: '2026-08-02' }),
        ],
        cursor: 'cursor-1',
      }),
    ]
    const primera = await sincronizar()
    const cuentaId = await cuentaDelLibro()
    expect(await saldo(cuentaId)).toBe('-3000')

    const original = await enHogar(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        "select id from entry where external_id = 'retirado'",
      )
      return rows[0]?.id as string
    })

    // El banco retira el segundo. Su saldo ya no lo cuenta.
    plaid.cuentas = [cuenta({ saldoActual: '-10.00' })]
    plaid.lotes = [
      lote({ removed: [{ transactionId: 'retirado', accountId: CUENTA }], cursor: 'c2' }),
    ]
    const segunda = await sincronizar()

    const resultado = segunda.cuentas[0]
    // Sin líneas nuevas no hay lote, pero la cuenta no está "vacía" de trabajo.
    expect(resultado?.kind).toBe('vacia')
    expect(resultado?.anulados).toHaveLength(1)
    expect(resultado?.anulados[0]?.externalId).toBe('retirado')
    expect(resultado?.anulados[0]?.importe).toBe('-20.00')

    // El saldo llega al del banco por suma y no por omisión.
    expect(await saldo(cuentaId)).toBe('-1000')

    const asientos = await enHogar(async (client) => {
      const { rows } = await client.query<{
        id: string
        description: string
        external_id: string | null
        reversed_by: string | null
        importe: string | null
      }>(
        `select e.id, e.description, e.external_id, e.reversed_by,
                (select p.amount::text from posting p
                  where p.entry_id = e.id and p.account_id = $1) as importe
           from entry e order by e.created_at`,
        [cuentaId],
      )
      return rows
    })

    const anulado = asientos.find((fila) => fila.id === original)
    const espejo = asientos.find((fila) => fila.id === anulado?.reversed_by)
    // El original sigue ahí, con su identificador y su importe intactos.
    expect(anulado?.importe).toBe('-2000')
    expect(anulado?.reversed_by).not.toBeNull()
    // Y el espejo es exacto y no lleva identidad propia: sin huella y sin
    // identificador externo, para que el dedup no lo confunda nunca con un
    // movimiento del banco.
    expect(espejo?.importe).toBe('2000')
    expect(espejo?.external_id).toBeNull()
    expect(espejo?.description).toContain('Plaid retiró este movimiento')

    // Y la consecuencia declarada: el lote que trajo el movimiento anulado ya
    // no se puede deshacer de un click, porque borrarlo dejaría a su espejo
    // moviendo el saldo solo. Se dice con todas las letras en vez de romper.
    if (primera.cuentas[0]?.kind !== 'ok') return
    await expect(
      enHogar((client) =>
        revertImport(client, (primera.cuentas[0] as { batchId: string }).batchId),
      ),
    ).rejects.toThrow(/asientos de anulación/)
  })

  it('un retirado que nunca se asentó no hace nada: es el caso normal', async () => {
    plaid.cuentas = [cuenta({ saldoActual: '-10.00' })]
    plaid.lotes = [
      lote({
        added: [
          movimiento({ id: 'firme', importe: '10.00', fecha: '2026-08-01' }),
          movimiento({ id: 'pendiente', importe: '25.00', fecha: '2026-08-02', pending: true }),
        ],
        removed: [{ transactionId: 'pendiente', accountId: CUENTA }],
        cursor: 'cursor-1',
      }),
    ]

    const resultado = await sincronizar()
    const primera = resultado.cuentas[0]
    expect(primera?.kind).toBe('ok')
    if (primera?.kind !== 'ok') return

    // El pendiente nunca entró al libro, así que retirarlo no anula nada.
    expect(primera.anulados).toHaveLength(0)
    expect(primera.imported).toBe(1)
    expect(await saldo(await cuentaDelLibro())).toBe('-1000')
  })

  it('la segunda sincronización no inventa las cuentas que este feed no alimenta', async () => {
    // Esto pasó contra el sandbox y no dio ni un error. `/transactions/sync`
    // sólo devuelve las cuentas que cubre el producto `transactions` —cinco, en
    // su banco de prueba— y en un lote vacío no devuelve ninguna, así que la
    // sincronización incremental cae siempre a `/accounts/get`, que devuelve el
    // item entero: doce, con el plan de pensiones, el 401k, la hipoteca y el
    // préstamo de estudios. Resultado medido: la primera sincronización creaba
    // cinco cuentas y la segunda añadía siete más, en cero y para siempre —el
    // hogar veía aparecer 'Plaid Mortgage' con 0,00 mientras el banco declara
    // 56.302,06 adeudados—, y qué cuentas existían dependía de por qué camino
    // se hubiera leído.
    plaid.cuentas = [
      cuenta({ saldoActual: '-10.00' }),
      cuenta({
        id: 'hipoteca-de-plaid',
        nombre: 'Plaid Mortgage',
        tipo: 'loan',
        subtipo: 'mortgage',
        saldoActual: '56302.06',
      }),
    ]
    plaid.lotes = [
      // Y la página que sí trae movimientos trae sólo la cuenta que los tiene.
      lote({
        added: [movimiento({ id: 'uno', importe: '10.00', fecha: '2026-08-01' })],
        cuentas: [cuenta({ saldoActual: '-10.00' })],
        cursor: 'cursor-1',
      }),
    ]
    await sincronizar()

    const nombres = async (): Promise<string[]> =>
      enHogar(async (client) => {
        const { rows } = await client.query<{ name: string }>(
          'select name from account order by name',
        )
        return rows.map((fila) => fila.name)
      })
    const antes = await nombres()
    expect(antes).not.toContain('BBVA · Banca Personal · Plaid Mortgage')

    // Segunda vuelta sin novedades: la lista de cuentas ya no la dice
    // `/transactions/sync` sino el reemplazo, con el item entero dentro.
    const segunda = await sincronizar()
    expect(segunda.cuentas.every((fila) => fila.kind === 'vacia')).toBe(true)
    expect(await nombres()).toEqual(antes)
  })

  /* ── La apertura ───────────────────────────────────────────────────────── */

  it('asienta la historia anterior a la ventana y deja el delta en cero', async () => {
    plaid.cuentas = [cuenta({ saldoActual: '23631.98' })]
    plaid.lotes = [
      lote({
        added: [movimiento({ id: 'uno', importe: '478.27', fecha: '2026-08-01' })],
        cursor: 'cursor-1',
      }),
    ]

    const resultado = await sincronizar()
    const primera = resultado.cuentas[0]
    expect(primera?.kind).toBe('ok')
    if (primera?.kind !== 'ok') return

    // El movimiento resta 478,27 y el banco declara 23.631,98: la diferencia no
    // es un error, es la historia que la ventana no trajo.
    expect(primera.apertura?.outcome).toBe('created')
    expect(primera.apertura?.importe).toBe('24110.25')
    expect(primera.apertura?.fecha).toBe('2026-07-31')
    expect(primera.report.accounts[0]?.delta?.amount).toBe('0.00')
    expect(await saldo(await cuentaDelLibro())).toBe('2363198')
  })
})

/* ── Dobles ───────────────────────────────────────────────────────────────── */

function cuenta(
  parcial: {
    saldoActual?: string | null
    tipo?: string
    subtipo?: string
    nombre?: string
    id?: string
  } = {},
): CuentaPlaid {
  return {
    accountId: parcial.id ?? CUENTA,
    name: parcial.nombre ?? 'Plaid Current Account',
    officialName: null,
    mask: '0000',
    type: parcial.tipo ?? 'depository',
    subtype: parcial.subtipo ?? 'checking',
    holderCategory: 'personal',
    saldoActual: parcial.saldoActual ?? null,
    saldoDisponible: null,
    limite: null,
    isoCurrencyCode: 'EUR',
    unofficialCurrencyCode: null,
    crudo: {},
  }
}

function movimiento(parcial: {
  id: string
  /** Con el signo de Plaid: POSITIVO = sale de la cuenta. */
  importe: string
  fecha: string
  nombre?: string
  pending?: boolean
}): MovimientoPlaid {
  return {
    transactionId: parcial.id,
    accountId: CUENTA,
    importeSalidaPositiva: parcial.importe,
    isoCurrencyCode: 'EUR',
    unofficialCurrencyCode: null,
    date: parcial.fecha,
    authorizedDate: null,
    datetime: null,
    authorizedDatetime: null,
    name: parcial.nombre ?? `Movimiento ${parcial.id}`,
    originalDescription: null,
    merchantName: null,
    pending: parcial.pending ?? false,
    pendingTransactionId: null,
    paymentChannel: 'in store',
    transactionCode: null,
    checkNumber: null,
    categoriaPersonal: null,
    merchantCategoryCode: null,
    website: null,
    logoUrl: null,
    contrapartes: [],
    crudo: {},
  }
}

function lote(parcial: Partial<LoteDeSincronizacion>): LoteDeSincronizacion {
  const conContenido =
    (parcial.added?.length ?? 0) +
      (parcial.modified?.length ?? 0) +
      (parcial.removed?.length ?? 0) >
    0
  return {
    added: [],
    modified: [],
    removed: [],
    cursor: 'cursor-1',
    hasMore: false,
    estado: 'HISTORICAL_UPDATE_COMPLETE',
    // Como Plaid: la página que trae algo trae también sus cuentas, y la vacía
    // no trae ninguna. La diferencia decide de dónde sale la lista de cuentas
    // —de `/transactions/sync` o del reemplazo `/accounts/get`— y esas dos
    // listas no significan lo mismo. Ver `cuentasAsentables`.
    cuentas: conContenido ? (plaid.cuentas as CuentaPlaid[]) : [],
    ...parcial,
  }
}
