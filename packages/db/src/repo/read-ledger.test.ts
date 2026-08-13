/**
 * Tests de la capa de lectura contra una base real.
 *
 * Contra Postgres de verdad y no con dobles: lo que se prueba acá son las
 * consultas —coalesce de conversión, laterales de saldo declarado, escapado
 * del LIKE, RLS— y un doble de la base sólo probaría el mapeo de filas.
 *
 * Los datos los inserta el propio test con nombres únicos por corrida, así
 * que puede correr en paralelo con otras suites sobre la misma base.
 */

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createPool,
  type Db,
  type TenantClient,
  withoutTenantScope,
  withTenant,
} from '../client.js'
import { migrate } from '../migrate.js'
import {
  accountBalances,
  categoryTree,
  liquidityByCurrency,
  movements,
  reconciliation,
  totals,
} from './read-ledger.js'

const ADMIN_URL = process.env['DATABASE_URL']
const APP_URL = process.env['DATABASE_APP_URL']
const enabled = ADMIN_URL !== undefined && APP_URL !== undefined
const suite = enabled ? describe : describe.skip

interface AccountSpec {
  readonly kind: string
  readonly name: string
  readonly currency: string
  readonly institution?: string
  readonly country?: string
  readonly parentId?: string
  readonly closedAt?: string
}

interface PostingSpec {
  readonly accountId: string
  readonly amount: bigint
  readonly currency: string
  readonly isTransfer?: boolean
  readonly baseAmount?: bigint
  readonly baseCurrency?: string
  readonly memo?: string
}

async function insertAccount(
  client: TenantClient,
  tenantId: string,
  spec: AccountSpec,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into account (tenant_id, kind, name, currency, institution, country, parent_id, closed_at)
     values ($1, $2::account_kind, $3, $4, $5, $6, $7, $8::date)
     returning id`,
    [
      tenantId,
      spec.kind,
      spec.name,
      spec.currency,
      spec.institution ?? null,
      spec.country ?? null,
      spec.parentId ?? null,
      spec.closedAt ?? null,
    ],
  )
  return rows[0]?.id as string
}

/** Devuelve el id del asiento y los ids de sus postings, en orden. */
async function insertEntry(
  client: TenantClient,
  tenantId: string,
  entry: { bookedOn: string; description: string; source?: string },
  postings: readonly PostingSpec[],
): Promise<{ entryId: string; postingIds: string[] }> {
  const created = await client.query<{ id: string }>(
    `insert into entry (tenant_id, booked_on, description, source)
     values ($1, $2::date, $3, $4::data_source)
     returning id`,
    [tenantId, entry.bookedOn, entry.description, entry.source ?? 'file'],
  )
  const entryId = created.rows[0]?.id as string

  const postingIds: string[] = []
  for (const [index, posting] of postings.entries()) {
    const { rows } = await client.query<{ id: string }>(
      `insert into posting
         (tenant_id, entry_id, account_id, ordinal, amount, currency,
          base_amount, base_currency, memo, is_transfer)
       values ($1, $2, $3, $4, $5::bigint, $6, $7::bigint, $8, $9, $10)
       returning id::text as id`,
      [
        tenantId,
        entryId,
        posting.accountId,
        index,
        posting.amount.toString(),
        posting.currency,
        posting.baseAmount === undefined ? null : posting.baseAmount.toString(),
        posting.baseCurrency ?? null,
        posting.memo ?? null,
        posting.isTransfer ?? false,
      ],
    )
    postingIds.push(rows[0]?.id as string)
  }

  return { entryId, postingIds }
}

async function insertDeclared(
  client: TenantClient,
  tenantId: string,
  accountId: string,
  asOf: string,
  amount: bigint,
  currency: string,
): Promise<void> {
  await client.query(
    `insert into declared_balance (tenant_id, account_id, as_of, amount, currency)
     values ($1, $2, $3::date, $4::bigint, $5)`,
    [tenantId, accountId, asOf, amount.toString(), currency],
  )
}

suite('lectura del libro mayor', () => {
  let admin: Db
  let app: Db
  let casa: string
  let vecina: string
  /** Hogar con datos rotos a propósito: monedas cruzadas y un ciclo de padres. */
  let rara: string

  const account: Record<string, string> = {}
  const raro: Record<string, string> = {}
  let dimensionValueId: string
  let vecinaAccountId: string

  const read = <T>(fn: (client: TenantClient) => Promise<T>, tenantId = casa): Promise<T> =>
    withTenant(app, tenantId, fn)

  beforeAll(async () => {
    await migrate(ADMIN_URL as string)
    admin = createPool({ connectionString: ADMIN_URL as string })
    app = createPool({ connectionString: APP_URL as string })

    const suffix = randomUUID().slice(0, 8)

    await withoutTenantScope(admin, async (client) => {
      const created = await client.query<{ id: string }>(
        `insert into tenant (name, base_currency)
         values ($1, 'EUR'), ($2, 'EUR'), ($3, 'EUR')
         returning id`,
        [`Casa Lectura ${suffix}`, `Casa Vecina ${suffix}`, `Casa Rara ${suffix}`],
      )
      casa = created.rows[0]?.id as string
      vecina = created.rows[1]?.id as string
      rara = created.rows[2]?.id as string

      account['bancoEur'] = await insertAccount(client, casa, {
        kind: 'asset',
        name: 'Banco Principal',
        currency: 'EUR',
        institution: 'BBVA',
        country: 'ES',
      })
      account['bancoUsd'] = await insertAccount(client, casa, {
        kind: 'asset',
        name: 'Banco Dólar',
        currency: 'USD',
      })
      account['ajuste'] = await insertAccount(client, casa, {
        kind: 'asset',
        name: 'Banco Ajuste',
        currency: 'EUR',
      })
      account['cerrada'] = await insertAccount(client, casa, {
        kind: 'asset',
        name: 'Cuenta Cerrada',
        currency: 'EUR',
        closedAt: '2026-01-31',
      })
      account['tarjeta'] = await insertAccount(client, casa, {
        kind: 'liability',
        name: 'Tarjeta Visa',
        currency: 'EUR',
      })
      account['apertura'] = await insertAccount(client, casa, {
        kind: 'equity',
        name: 'Saldo de apertura',
        currency: 'EUR',
      })
      account['casa'] = await insertAccount(client, casa, {
        kind: 'expense',
        name: 'Casa',
        currency: 'EUR',
      })
      account['servicios'] = await insertAccount(client, casa, {
        kind: 'expense',
        name: 'Servicios',
        currency: 'EUR',
        parentId: account['casa'],
      })
      account['luz'] = await insertAccount(client, casa, {
        kind: 'expense',
        name: 'Luz',
        currency: 'EUR',
        parentId: account['servicios'],
      })
      account['comida'] = await insertAccount(client, casa, {
        kind: 'expense',
        name: 'Comida',
        currency: 'EUR',
      })
      account['cajero'] = await insertAccount(client, casa, {
        kind: 'expense',
        name: 'Cajero',
        currency: 'EUR',
      })
      account['viajes'] = await insertAccount(client, casa, {
        kind: 'expense',
        name: 'Viajes',
        currency: 'USD',
      })
      account['sueldo'] = await insertAccount(client, casa, {
        kind: 'income',
        name: 'Sueldo',
        currency: 'EUR',
      })

      const eur = 'EUR'
      const usd = 'USD'

      await insertEntry(
        client,
        casa,
        { bookedOn: '2026-01-01', description: 'Apertura Banco Principal', source: 'manual' },
        [
          { accountId: account['bancoEur'] as string, amount: 500_000n, currency: eur },
          { accountId: account['apertura'] as string, amount: -500_000n, currency: eur },
        ],
      )

      // Cae entre el saldo declarado de apertura (25/2) y el inicio del
      // período (1/3): es el movimiento que delata si la reconciliación suma
      // desde la fecha equivocada.
      await insertEntry(
        client,
        casa,
        { bookedOn: '2026-02-27', description: 'Ajuste previo', source: 'manual' },
        [
          { accountId: account['ajuste'] as string, amount: 5_000n, currency: eur },
          { accountId: account['apertura'] as string, amount: -5_000n, currency: eur },
        ],
      )

      await insertEntry(
        client,
        casa,
        { bookedOn: '2026-03-02', description: 'Mercadona 100% descuento' },
        [
          { accountId: account['comida'] as string, amount: 12_000n, currency: eur },
          { accountId: account['bancoEur'] as string, amount: -12_000n, currency: eur },
        ],
      )

      await insertEntry(
        client,
        casa,
        { bookedOn: '2026-03-03', description: 'Mercadona 1005 caja' },
        [
          { accountId: account['comida'] as string, amount: 10_050n, currency: eur },
          { accountId: account['bancoEur'] as string, amount: -10_050n, currency: eur },
        ],
      )

      await insertEntry(client, casa, { bookedOn: '2026-03-10', description: 'Nómina marzo' }, [
        { accountId: account['bancoEur'] as string, amount: 250_000n, currency: eur },
        { accountId: account['sueldo'] as string, amount: -250_000n, currency: eur },
      ])

      await insertEntry(
        client,
        casa,
        { bookedOn: '2026-03-10', description: 'Ajuste marzo', source: 'manual' },
        [
          { accountId: account['ajuste'] as string, amount: 3_000n, currency: eur },
          { accountId: account['apertura'] as string, amount: -3_000n, currency: eur },
        ],
      )

      await insertEntry(client, casa, { bookedOn: '2026-03-12', description: 'Pago tarjeta' }, [
        {
          accountId: account['bancoEur'] as string,
          amount: -100_000n,
          currency: eur,
          isTransfer: true,
        },
        {
          accountId: account['tarjeta'] as string,
          amount: 100_000n,
          currency: eur,
          isTransfer: true,
        },
      ])

      await insertEntry(client, casa, { bookedOn: '2026-03-15', description: 'Hotel Lisboa' }, [
        {
          accountId: account['viajes'] as string,
          amount: 5_000n,
          currency: usd,
          baseAmount: 4_400n,
          baseCurrency: eur,
        },
        {
          accountId: account['bancoUsd'] as string,
          amount: -5_000n,
          currency: usd,
          baseAmount: -4_400n,
          baseCurrency: eur,
        },
      ])

      // Sin base_amount: el caso que NO se puede consolidar y que el producto
      // promete contar en vez de esconder.
      const taxi = await insertEntry(
        client,
        casa,
        { bookedOn: '2026-03-18', description: 'Taxi sin cambio' },
        [
          { accountId: account['viajes'] as string, amount: 3_000n, currency: usd },
          { accountId: account['bancoUsd'] as string, amount: -3_000n, currency: usd },
        ],
      )

      const luz = await insertEntry(
        client,
        casa,
        { bookedOn: '2026-03-20', description: 'Factura luz' },
        [
          { accountId: account['luz'] as string, amount: 8_000n, currency: eur, memo: 'Iberdrola' },
          { accountId: account['tarjeta'] as string, amount: -8_000n, currency: eur },
        ],
      )

      // Retirada de cajero: el importador la categorizó como gasto y el
      // matcher de transferencias la marcó después. Las dos patas son
      // is_transfer aunque una cuelgue de una cuenta 'expense'.
      await insertEntry(client, casa, { bookedOn: '2026-03-22', description: 'Retirada cajero' }, [
        {
          accountId: account['cajero'] as string,
          amount: 70_000n,
          currency: eur,
          isTransfer: true,
        },
        {
          accountId: account['bancoEur'] as string,
          amount: -70_000n,
          currency: eur,
          isTransfer: true,
        },
      ])

      await insertDeclared(client, casa, account['bancoEur'] as string, '2026-02-28', 500_000n, eur)
      await insertDeclared(client, casa, account['bancoEur'] as string, '2026-03-31', 557_950n, eur)
      await insertDeclared(client, casa, account['bancoUsd'] as string, '2026-02-28', 200_000n, usd)
      await insertDeclared(client, casa, account['bancoUsd'] as string, '2026-03-31', 190_000n, usd)
      await insertDeclared(client, casa, account['tarjeta'] as string, '2026-02-28', -50_000n, eur)
      await insertDeclared(client, casa, account['ajuste'] as string, '2026-02-25', 100_000n, eur)
      await insertDeclared(client, casa, account['ajuste'] as string, '2026-03-31', 108_000n, eur)

      const dimension = await client.query<{ id: string }>(
        `insert into dimension (tenant_id, key, label) values ($1, 'propiedad', 'Propiedad')
         returning id`,
        [casa],
      )
      const value = await client.query<{ id: string }>(
        `insert into dimension_value (tenant_id, dimension_id, label)
         values ($1, $2, 'Casa Madrid') returning id`,
        [casa, dimension.rows[0]?.id as string],
      )
      dimensionValueId = value.rows[0]?.id as string

      // La atribución cuelga de la pata de gasto, no de la del banco.
      await client.query(
        `insert into posting_dimension
           (tenant_id, posting_id, dimension_id, dimension_value_id, weight_ppm)
         values ($1, $2::bigint, $3, $4, 1000000)`,
        [casa, luz.postingIds[0] as string, dimension.rows[0]?.id as string, dimensionValueId],
      )

      await client.query(
        `insert into review_item (tenant_id, kind, state, entry_id)
         values ($1, 'posible_duplicado', 'pendiente', $2)`,
        [casa, taxi.entryId],
      )

      // Hogar vecino: mismos importes, para que un fallo de aislamiento se
      // note como un total distinto y no como una fila de más.
      vecinaAccountId = await insertAccount(client, vecina, {
        kind: 'asset',
        name: 'Banco Vecino',
        currency: 'EUR',
      })
      const gastoVecino = await insertAccount(client, vecina, {
        kind: 'expense',
        name: 'Gasto Vecino',
        currency: 'EUR',
      })
      await insertEntry(
        client,
        vecina,
        { bookedOn: '2026-03-05', description: 'Compra del vecino' },
        [
          { accountId: gastoVecino, amount: 99_999n, currency: 'EUR' },
          { accountId: vecinaAccountId, amount: -99_999n, currency: 'EUR' },
        ],
      )

      // ── Hogar con datos corruptos ──────────────────────────────────────
      // Nada de esto debería existir: el importador valida la moneda y nadie
      // arma un ciclo de categorías a mano. Existe igual, porque el esquema no
      // lo impide, y lo que se prueba acá es que la capa de lectura lo diga en
      // vez de devolver un número redondo y equivocado.
      raro['mixta'] = await insertAccount(client, rara, {
        kind: 'asset',
        name: 'Cuenta Mixta',
        currency: 'EUR',
      })
      raro['limpia'] = await insertAccount(client, rara, {
        kind: 'asset',
        name: 'Cuenta Limpia',
        currency: 'EUR',
      })
      raro['gasto'] = await insertAccount(client, rara, {
        kind: 'expense',
        name: 'Gasto Raro',
        currency: 'EUR',
      })
      raro['cicloA'] = await insertAccount(client, rara, {
        kind: 'expense',
        name: 'Ciclo A',
        currency: 'EUR',
      })
      raro['cicloB'] = await insertAccount(client, rara, {
        kind: 'expense',
        name: 'Ciclo B',
        currency: 'EUR',
        parentId: raro['cicloA'],
      })
      await client.query('update account set parent_id = $1 where id = $2', [
        raro['cicloB'],
        raro['cicloA'],
      ])

      // La pata del banco quedó grabada en USD contra una cuenta en EUR.
      await insertEntry(client, rara, { bookedOn: '2026-03-05', description: 'Compra mixta' }, [
        { accountId: raro['gasto'] as string, amount: 10_000n, currency: 'EUR' },
        { accountId: raro['mixta'] as string, amount: -10_000n, currency: 'USD' },
      ])
      await insertEntry(client, rara, { bookedOn: '2026-03-06', description: 'Compra limpia' }, [
        { accountId: raro['gasto'] as string, amount: 5_000n, currency: 'EUR' },
        { accountId: raro['limpia'] as string, amount: -5_000n, currency: 'EUR' },
      ])

      await insertDeclared(client, rara, raro['mixta'] as string, '2026-03-31', -10_000n, 'EUR')
      await insertDeclared(client, rara, raro['limpia'] as string, '2026-03-20', -5_000n, 'EUR')
      // Extracto posterior en otra moneda: es el más reciente, así que sin
      // filtrar por moneda sería el que se usa para calcular el delta.
      await insertDeclared(client, rara, raro['limpia'] as string, '2026-04-30', 999_999n, 'USD')
    })
  }, 60_000)

  afterAll(async () => {
    if (admin !== undefined) {
      await withoutTenantScope(admin, async (client) => {
        // El ciclo de padres impide el borrado en cascada (parent_id es
        // `on delete restrict`), así que hay que romperlo antes.
        await client.query('update account set parent_id = null where tenant_id = $1', [rara])
        await client.query('delete from tenant where id = any($1::uuid[])', [[casa, vecina, rara]])
      })
    }
    await admin?.end()
    await app?.end()
  })

  const byName = <T extends { name: string }>(rows: readonly T[], name: string): T | undefined =>
    rows.find((row) => row.name === name)

  // ── Saldos ────────────────────────────────────────────────────────────────

  it('el saldo de una cuenta es la suma de sus postings', async () => {
    const rows = await read(accountBalances)
    const banco = byName(rows, 'Banco Principal')

    expect(banco?.balance).toBe(557_950n)
    expect(banco?.movements).toBe(6)
    expect(banco?.lastMovementOn).toBe('2026-03-22')
    expect(banco?.institution).toBe('BBVA')
    expect(banco?.currency).toBe('EUR')
  })

  it('el delta es la distancia contra el último saldo declarado por el banco', async () => {
    const rows = await read(accountBalances)

    expect(byName(rows, 'Banco Principal')?.declared).toBe(557_950n)
    expect(byName(rows, 'Banco Principal')?.declaredOn).toBe('2026-03-31')
    expect(byName(rows, 'Banco Principal')?.delta).toBe(0n)
    expect(byName(rows, 'Banco Dólar')?.delta).toBe(-198_000n)
  })

  it('una cuenta sin saldo declarado no inventa un delta de cero', async () => {
    const cerrada = byName(await read(accountBalances), 'Cuenta Cerrada')

    expect(cerrada?.balance).toBe(0n)
    expect(cerrada?.declared).toBeNull()
    expect(cerrada?.delta).toBeNull()
    expect(cerrada?.closedAt).toBe('2026-01-31')
    expect(cerrada?.lastMovementOn).toBeNull()
  })

  it('asOf recorta tanto los movimientos como el saldo declarado', async () => {
    const rows = await read((client) => accountBalances(client, { asOf: '2026-03-10' }))
    const banco = byName(rows, 'Banco Principal')

    expect(banco?.balance).toBe(727_950n)
    expect(banco?.movements).toBe(4)
    // El extracto del 31/3 todavía no existe a esa fecha de corte.
    expect(banco?.declared).toBe(500_000n)
    expect(banco?.declaredOn).toBe('2026-02-28')
    expect(banco?.delta).toBe(227_950n)
  })

  // ── Liquidez ──────────────────────────────────────────────────────────────

  it('la liquidez va por moneda y no se consolida en una sola cifra', async () => {
    const lanes = await read(liquidityByCurrency)

    expect(lanes).toEqual([
      { currency: 'EUR', total: 565_950n, accounts: 2, foreignPostings: 0 },
      { currency: 'USD', total: -8_000n, accounts: 1, foreignPostings: 0 },
    ])
  })

  it('la liquidez ignora las cuentas cerradas y las que no son de activo', async () => {
    const lanes = await read(liquidityByCurrency)
    const eur = lanes.find((lane) => lane.currency === 'EUR')

    // Banco Principal y Banco Ajuste: ni la cerrada, ni la tarjeta, ni equity.
    expect(eur?.accounts).toBe(2)
    expect(eur?.total).toBe(557_950n + 8_000n)
  })

  // ── Movimientos ───────────────────────────────────────────────────────────

  it('la categoría de un movimiento sale de la contrapartida del asiento', async () => {
    const page = await read((client) =>
      movements(client, { accountIds: [account['bancoEur'] as string], from: '2026-03-01' }),
    )
    const nomina = page.rows.find((row) => row.description === 'Nómina marzo')
    const compra = page.rows.find((row) => row.description === 'Mercadona 1005 caja')

    expect(nomina?.category).toBe('Sueldo')
    expect(nomina?.amount).toBe(250_000n)
    expect(compra?.category).toBe('Comida')
    expect(compra?.categoryId).toBe(account['comida'])
  })

  it('un traspaso entre cuentas propias no tiene categoría y viene marcado', async () => {
    const page = await read((client) => movements(client, { search: 'Pago tarjeta' }))

    expect(page.total).toBe(2)
    for (const row of page.rows) {
      expect(row.isTransfer).toBe(true)
      expect(row.category).toBeNull()
    }
  })

  it('las transferencias se listan salvo que se pidan fuera', async () => {
    const conTransferencias = await read((client) =>
      movements(client, { accountIds: [account['bancoEur'] as string] }),
    )
    const sinTransferencias = await read((client) =>
      movements(client, {
        accountIds: [account['bancoEur'] as string],
        includeTransfers: false,
      }),
    )

    expect(conTransferencias.total).toBe(6)
    expect(sinTransferencias.total).toBe(4)
    expect(sinTransferencias.rows.every((row) => !row.isTransfer)).toBe(true)
  })

  it('la paginación devuelve el total del filtro, no el de la página', async () => {
    const primera = await read((client) =>
      movements(client, { accountIds: [account['bancoEur'] as string], limit: 2 }),
    )
    const segunda = await read((client) =>
      movements(client, { accountIds: [account['bancoEur'] as string], limit: 2, offset: 2 }),
    )

    expect(primera.total).toBe(6)
    expect(segunda.total).toBe(6)
    expect(primera.rows).toHaveLength(2)
    expect(primera.rows.map((row) => row.bookedOn)).toEqual(['2026-03-22', '2026-03-12'])
    expect(segunda.rows.map((row) => row.bookedOn)).toEqual(['2026-03-10', '2026-03-03'])
    // Ninguna fila se repite entre páginas: el orden es total y estable.
    const repetida = primera.rows.some((row) =>
      segunda.rows.some((other) => other.postingId === row.postingId),
    )
    expect(repetida).toBe(false)
  })

  it('la búsqueda trata un % escrito por el usuario como texto y no como comodín', async () => {
    const page = await read((client) => movements(client, { search: '100%' }))

    // Sin escapar, '%100%%' traería también "Mercadona 1005 caja".
    expect(page.total).toBe(1)
    expect(page.rows[0]?.description).toBe('Mercadona 100% descuento')
  })

  it('filtra por rango de fechas y por categoría de la contrapartida', async () => {
    const porFecha = await read((client) =>
      movements(client, { from: '2026-03-15', to: '2026-03-18' }),
    )
    const porCategoria = await read((client) =>
      movements(client, { categoryIds: [account['comida'] as string] }),
    )

    expect(porFecha.rows.map((row) => row.description)).toEqual(['Taxi sin cambio', 'Hotel Lisboa'])
    expect(porCategoria.total).toBe(2)
    expect(porCategoria.rows.every((row) => row.accountId === account['bancoEur'])).toBe(true)
  })

  it('un movimiento arrastra las dimensiones del asiento aunque cuelguen de la otra pata', async () => {
    const page = await read((client) =>
      movements(client, { dimensionValueIds: [dimensionValueId] }),
    )

    // Un solo movimiento: la pata de gasto no es una línea del extracto.
    expect(page.total).toBe(1)
    const tarjeta = page.rows.find((row) => row.accountId === account['tarjeta'])
    expect(tarjeta?.description).toBe('Factura luz')
    expect(tarjeta?.dimensions).toEqual([
      {
        dimensionId: expect.any(String),
        key: 'propiedad',
        label: 'Propiedad',
        valueId: dimensionValueId,
        value: 'Casa Madrid',
        weightPpm: 1_000_000,
      },
    ])
  })

  it('marca needsReview sólo en los asientos con una revisión pendiente', async () => {
    const page = await read((client) => movements(client, { from: '2026-03-15', to: '2026-03-20' }))
    const taxi = page.rows.find((row) => row.description === 'Taxi sin cambio')
    const hotel = page.rows.find((row) => row.description === 'Hotel Lisboa')

    expect(taxi?.needsReview).toBe(true)
    expect(hotel?.needsReview).toBe(false)
    // Los tres números de un gasto en el exterior, sin recalcular nada.
    expect(hotel?.amount).toBe(-5_000n)
    expect(hotel?.currency).toBe('USD')
    expect(hotel?.baseAmount).toBe(-4_400n)
    expect(hotel?.baseCurrency).toBe('EUR')
    expect(taxi?.baseAmount).toBeNull()
  })

  // ── Reconciliación ────────────────────────────────────────────────────────

  it('cuadra cuando el saldo calculado coincide con el declarado', async () => {
    const rows = await read((client) =>
      reconciliation(client, { from: '2026-03-01', to: '2026-03-31' }),
    )
    const banco = rows.find((row) => row.accountName === 'Banco Principal')

    expect(banco?.opening).toBe(500_000n)
    expect(banco?.movements).toBe(57_950n)
    expect(banco?.closingCalculated).toBe(557_950n)
    expect(banco?.declared).toBe(557_950n)
    expect(banco?.delta).toBe(0n)
    expect(banco?.status).toBe('cuadra')
  })

  it('informa el delta en vez de esconderlo cuando el banco dice otra cosa', async () => {
    const rows = await read((client) =>
      reconciliation(client, { from: '2026-03-01', to: '2026-03-31' }),
    )
    const dolar = rows.find((row) => row.accountName === 'Banco Dólar')

    expect(dolar?.closingCalculated).toBe(192_000n)
    expect(dolar?.declared).toBe(190_000n)
    expect(dolar?.delta).toBe(2_000n)
    expect(dolar?.status).toBe('delta')
  })

  it('sin saldo declarado en el período el estado es sin-declarar y nunca cuadra', async () => {
    const rows = await read((client) =>
      reconciliation(client, { from: '2026-03-01', to: '2026-03-31' }),
    )
    const tarjeta = rows.find((row) => row.accountName === 'Tarjeta Visa')
    const cerrada = rows.find((row) => row.accountName === 'Cuenta Cerrada')

    expect(tarjeta?.declared).toBeNull()
    expect(tarjeta?.delta).toBeNull()
    expect(tarjeta?.status).toBe('sin-declarar')
    // Y una cuenta sin ningún movimiento tampoco "cuadra" por omisión.
    expect(cerrada?.opening).toBeNull()
    expect(cerrada?.movements).toBe(0n)
    expect(cerrada?.status).toBe('sin-declarar')
  })

  it('suma los movimientos desde el día siguiente al extracto de apertura', async () => {
    const rows = await read((client) =>
      reconciliation(client, { from: '2026-03-01', to: '2026-03-31' }),
    )
    const ajuste = rows.find((row) => row.accountName === 'Banco Ajuste')

    // El extracto de apertura es del 25/2 y hay un movimiento el 27/2.
    // Sumando desde el 1/3 darían 3.000 y un delta falso de -5.000.
    expect(ajuste?.openingOn).toBe('2026-02-25')
    expect(ajuste?.movements).toBe(8_000n)
    expect(ajuste?.closingCalculated).toBe(108_000n)
    expect(ajuste?.status).toBe('cuadra')
  })

  // ── Totales ───────────────────────────────────────────────────────────────

  it('no cuenta las transferencias internas como gasto', async () => {
    const resumen = await read((client) =>
      totals(client, { from: '2026-03-01', to: '2026-03-31', currency: 'EUR' }),
    )

    // La retirada de cajero son 70.000 contra una cuenta 'expense', pero está
    // marcada como transferencia: mover dinero de sitio no es gastarlo.
    expect(resumen.expense).toBe(34_450n)
    expect(resumen.transactions).toBe(6)
  })

  it('los ingresos se reportan en positivo aunque en el libro sean negativos', async () => {
    const resumen = await read((client) =>
      totals(client, { from: '2026-03-01', to: '2026-03-31', currency: 'EUR' }),
    )

    expect(resumen.income).toBe(250_000n)
    expect(resumen.net).toBe(215_550n)
    expect(resumen.currency).toBe('EUR')
  })

  it('devuelve cuántos postings no se pudieron convertir y en qué moneda', async () => {
    const resumen = await read((client) =>
      totals(client, { from: '2026-03-01', to: '2026-03-31', currency: 'EUR' }),
    )

    // El taxi en dólares sin base_amount: fuera del total, pero contado.
    expect(resumen.unconverted).toBe(1)
    expect(resumen.unconvertedByCurrency).toEqual([
      { currency: 'USD', income: 0n, expense: 3_000n, postings: 1 },
    ])
  })

  it('cambiar la moneda de reporte cambia qué se puede consolidar', async () => {
    const enDolares = await read((client) =>
      totals(client, { from: '2026-03-01', to: '2026-03-31', currency: 'USD' }),
    )

    // Los base_amount están congelados en EUR: para un reporte en USD sólo
    // sirven los postings que ya nacieron en USD.
    expect(enDolares.expense).toBe(8_000n)
    expect(enDolares.income).toBe(0n)
    expect(enDolares.unconverted).toBe(4)
    expect(enDolares.unconvertedByCurrency).toEqual([
      { currency: 'EUR', income: 250_000n, expense: 30_050n, postings: 4 },
    ])
  })

  it('un período sin movimientos devuelve ceros y no null', async () => {
    const resumen = await read((client) =>
      totals(client, { from: '2026-06-01', to: '2026-06-30', currency: 'EUR' }),
    )

    expect(resumen).toEqual({
      income: 0n,
      expense: 0n,
      net: 0n,
      currency: 'EUR',
      transactions: 0,
      unconverted: 0,
      unconvertedByCurrency: [],
    })
  })

  // ── Categorías ────────────────────────────────────────────────────────────

  it('el árbol de categorías arma el camino completo desde la raíz', async () => {
    const nodos = await read(categoryTree)
    const paths = nodos.map((nodo) => nodo.path)

    expect(paths).toContain('Casa')
    expect(paths).toContain('Casa > Servicios')
    expect(paths).toContain('Casa > Servicios > Luz')
    const luz = nodos.find((nodo) => nodo.path === 'Casa > Servicios > Luz')
    expect(luz?.id).toBe(account['luz'])
    expect(luz?.depth).toBe(2)
    expect(luz?.parentId).toBe(account['servicios'])
  })

  it('el árbol sólo trae cuentas de gasto e ingreso', async () => {
    const nodos = await read(categoryTree)

    expect(nodos.map((nodo) => nodo.name).sort()).toEqual([
      'Cajero',
      'Casa',
      'Comida',
      'Luz',
      'Servicios',
      'Sueldo',
      'Viajes',
    ])
    expect(nodos.find((nodo) => nodo.name === 'Sueldo')?.kind).toBe('income')
  })

  // ── Aislamiento ───────────────────────────────────────────────────────────

  it('un hogar no ve ni un movimiento del otro', async () => {
    const mios = await read((client) => movements(client, {}))
    const suyos = await read((client) => movements(client, {}), vecina)

    expect(mios.rows.some((row) => row.description === 'Compra del vecino')).toBe(false)
    expect(suyos.total).toBe(1)
    expect(suyos.rows[0]?.accountId).toBe(vecinaAccountId)
  })

  // ── Datos que no se pueden calcular ───────────────────────────────────────

  it('un posting en otra moneda no se suma al saldo: se cuenta aparte', async () => {
    const saldos = await read(accountBalances, rara)
    const mixta = byName(saldos, 'Cuenta Mixta')

    // Los -10.000 están en USD contra una cuenta en EUR. Sumarlos daría un
    // saldo de -10.000 EUR que no es dinero de ninguna moneda.
    expect(mixta?.balance).toBe(0n)
    expect(mixta?.foreignPostings).toBe(1)
    expect(byName(saldos, 'Cuenta Limpia')?.foreignPostings).toBe(0)

    const lanes = await read(liquidityByCurrency, rara)
    expect(lanes).toEqual([{ currency: 'EUR', total: -5_000n, accounts: 2, foreignPostings: 1 }])
  })

  it('un extracto en otra moneda no sirve para comparar el saldo', async () => {
    const limpia = byName(await read(accountBalances, rara), 'Cuenta Limpia')

    // El extracto más reciente es el del 30/4, pero está en USD: usarlo daría
    // un delta de más de un millón salido de la nada.
    expect(limpia?.declaredOn).toBe('2026-03-20')
    expect(limpia?.declared).toBe(-5_000n)
    expect(limpia?.delta).toBe(0n)
  })

  it('sin saldo de apertura declarado no hay saldo calculado, aunque haya movimientos', async () => {
    const rows = await read(
      (client) => reconciliation(client, { from: '2026-03-01', to: '2026-03-31' }),
      rara,
    )
    const limpia = rows.find((row) => row.accountName === 'Cuenta Limpia')

    // Los movimientos del período son la variación, no el saldo: sin punto de
    // partida, dar -5.000 como "calculado" invita a compararlo con el extracto.
    expect(limpia?.opening).toBeNull()
    expect(limpia?.movements).toBe(-5_000n)
    expect(limpia?.closingCalculated).toBeNull()
    expect(limpia?.delta).toBeNull()
    expect(limpia?.status).toBe('sin-declarar')
  })

  it('con movimientos en otra moneda la reconciliación se declara incompleta', async () => {
    const rows = await read(
      (client) => reconciliation(client, { from: '2026-03-01', to: '2026-03-31' }),
      rara,
    )
    const mixta = rows.find((row) => row.accountName === 'Cuenta Mixta')

    expect(mixta?.foreignPostings).toBe(1)
    expect(mixta?.closingCalculated).toBeNull()
    expect(mixta?.delta).toBeNull()
    expect(mixta?.status).toBe('incompleto')
  })

  it('una categoría atrapada en un ciclo de padres se devuelve igual, marcada', async () => {
    const nodos = await read(categoryTree, rara)

    // Ninguna de las dos es raíz, así que el recorrido no las alcanza. Si no
    // se devolvieran, el gasto que cuelga de ellas no aparecería en ningún
    // sitio del árbol y la suma de las categorías no daría el total.
    expect(nodos.map((nodo) => nodo.name).sort()).toEqual(['Ciclo A', 'Ciclo B', 'Gasto Raro'])
    expect(nodos.find((nodo) => nodo.name === 'Ciclo A')?.detached).toBe(true)
    expect(nodos.find((nodo) => nodo.name === 'Ciclo B')?.detached).toBe(true)
    expect(nodos.find((nodo) => nodo.name === 'Gasto Raro')?.detached).toBe(false)
  })

  // ── Argumentos que mienten ────────────────────────────────────────────────

  it('la moneda de reporte se normaliza y una que no es ISO se rechaza', async () => {
    const enMinusculas = await read((client) =>
      totals(client, { from: '2026-03-01', to: '2026-03-31', currency: 'eur' }),
    )

    // Sin normalizar, 'eur' no compara igual que el 'EUR' guardado y TODO
    // quedaría sin convertir: un informe de cero euros de gasto.
    expect(enMinusculas.currency).toBe('EUR')
    expect(enMinusculas.expense).toBe(34_450n)
    expect(enMinusculas.unconverted).toBe(1)

    // 'EURO' castea a char(3) truncando sin error: daría el total de EUR.
    await expect(
      read((client) => totals(client, { from: '2026-03-01', to: '2026-03-31', currency: 'EURO' })),
    ).rejects.toThrow(/ISO/)
  })

  it('una fecha que no es YYYY-MM-DD se rechaza en vez de correr con el huso local', async () => {
    const comoDate = new Date('2026-03-10T00:00:00Z') as unknown as string

    await expect(read((client) => accountBalances(client, { asOf: comoDate }))).rejects.toThrow(
      /YYYY-MM-DD/,
    )
    await expect(read((client) => movements(client, { from: '10/03/2026' }))).rejects.toThrow(
      /YYYY-MM-DD/,
    )
  })

  it('un período invertido es un error, no un informe vacío', async () => {
    await expect(
      read((client) => totals(client, { from: '2026-03-31', to: '2026-03-01', currency: 'EUR' })),
    ).rejects.toThrow(/período/)
    await expect(
      read((client) => reconciliation(client, { from: '2026-03-31', to: '2026-03-01' })),
    ).rejects.toThrow(/período/)
  })

  it('un guion bajo escrito por el usuario tampoco funciona como comodín', async () => {
    const literal = await read((client) => movements(client, { search: 'Mercadona 100_' }))
    const prefijo = await read((client) => movements(client, { search: 'Mercadona 100' }))

    // Sin escapar, el '_' comodín haría que 'Mercadona 100_' trajera las dos.
    expect(prefijo.total).toBe(2)
    expect(literal.total).toBe(0)
  })

  it('los saldos y totales de un hogar no incluyen los del otro', async () => {
    const saldos = await read(accountBalances, vecina)
    const resumen = await read(
      (client) => totals(client, { from: '2026-03-01', to: '2026-03-31', currency: 'EUR' }),
      vecina,
    )

    expect(saldos.map((row) => row.name)).toEqual(['Banco Vecino', 'Gasto Vecino'])
    expect(byName(saldos, 'Banco Vecino')?.balance).toBe(-99_999n)
    expect(resumen.expense).toBe(99_999n)
    expect(resumen.income).toBe(0n)
  })
})

if (!enabled) {
  describe('lectura del libro mayor', () => {
    it.skip('necesita DATABASE_URL y DATABASE_APP_URL (pnpm db:up)', () => {})
  })
}
