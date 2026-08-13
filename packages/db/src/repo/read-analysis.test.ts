/**
 * La capa analítica contra una base de verdad.
 *
 * Cada bloque monta su propio hogar. No es ceremonia: el patrimonio es un
 * stock que acumula TODA la historia, así que un asiento sembrado para probar
 * los recurrentes cambiaría el waterfall de otro test y las cuentas dejarían
 * de poder calcularse a mano. Hogares separados = aritmética verificable.
 *
 * Sin DATABASE_URL los tests se saltan solos: nadie debería necesitar Docker
 * para correr los parsers.
 */

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
  dimensionsWithValues,
  netWorthAttribution,
  netWorthSeries,
  type RecurringRow,
  recurring,
  reviewQueue,
  spendByCategoryMonth,
  spendByDimension,
  topMerchants,
} from './read-analysis.js'

const ADMIN_URL = process.env['DATABASE_URL']
const APP_URL = process.env['DATABASE_APP_URL']
const enabled = ADMIN_URL !== undefined && APP_URL !== undefined
const suite = enabled ? describe : describe.skip

/**
 * El pid en el nombre del hogar no es decoración.
 *
 * El `beforeAll` empieza con `delete from tenant where name = any(...)`, así
 * que con nombres fijos dos corridas simultáneas —dos agentes, o una suite y
 * un script de sondeo— se borran los hogares la una a la otra a mitad de
 * camino. Los fallos que salen de ahí parecen del código y son del entorno,
 * que es la peor clase de fallo intermitente.
 */
const HOGARES = [
  'Análisis Categorías',
  'Análisis Dimensiones',
  'Análisis Comercios',
  'Análisis Recurrentes',
  'Análisis Patrimonio',
  'Análisis FX',
].map((nombre) => `${nombre} #${process.pid}`)

// ── Utilidades de siembra ───────────────────────────────────────────────────

function unico<T>(rows: readonly T[], what: string): T {
  const row = rows[0]
  if (row === undefined) throw new Error(`Se esperaba una fila de ${what}`)
  return row
}

async function crearHogar(admin: Db, name: string, currency: string): Promise<string> {
  return withoutTenantScope(admin, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      'insert into tenant (name, base_currency) values ($1, $2) returning id',
      [name, currency],
    )
    return unico(rows, 'tenant').id
  })
}

async function cuenta(
  client: TenantClient,
  tenantId: string,
  kind: string,
  name: string,
  currency: string,
  parentId: string | null = null,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into account (tenant_id, kind, name, currency, parent_id)
     values ($1, $2::account_kind, $3, $4, $5) returning id`,
    [tenantId, kind, name, currency, parentId],
  )
  return unico(rows, 'account').id
}

interface PataSpec {
  readonly account: string
  readonly amount: bigint
  readonly currency: string
  /** Importe congelado en la moneda de reporte. Sin esto, no es convertible. */
  readonly base?: bigint
  readonly baseCurrency?: string
  readonly native?: { readonly amount: bigint; readonly currency: string }
  readonly transfer?: boolean
  readonly dims?: readonly {
    readonly dimension: string
    readonly value: string
    readonly ppm: number
  }[]
}

async function asentar(
  client: TenantClient,
  tenantId: string,
  spec: {
    readonly on: string
    readonly description: string
    readonly postings: readonly PataSpec[]
  },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into entry (tenant_id, booked_on, description, source)
     values ($1, $2::date, $3, 'manual') returning id`,
    [tenantId, spec.on, spec.description],
  )
  const entryId = unico(rows, 'entry').id

  for (const [ordinal, pata] of spec.postings.entries()) {
    const inserted = await client.query<{ id: string }>(
      `insert into posting (tenant_id, entry_id, account_id, ordinal, amount, currency,
                            base_amount, base_currency, native_amount, native_currency, is_transfer)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
      [
        tenantId,
        entryId,
        pata.account,
        ordinal,
        pata.amount.toString(),
        pata.currency,
        pata.base === undefined ? null : pata.base.toString(),
        pata.base === undefined ? null : (pata.baseCurrency ?? 'EUR'),
        pata.native === undefined ? null : pata.native.amount.toString(),
        pata.native === undefined ? null : pata.native.currency,
        pata.transfer ?? false,
      ],
    )
    const postingId = unico(inserted.rows, 'posting').id
    for (const dim of pata.dims ?? []) {
      await client.query(
        `insert into posting_dimension (tenant_id, posting_id, dimension_id, dimension_value_id, weight_ppm)
         values ($1, $2, $3, $4, $5)`,
        [tenantId, postingId, dim.dimension, dim.value, dim.ppm],
      )
    }
  }
  return entryId
}

async function dimension(
  client: TenantClient,
  tenantId: string,
  key: string,
  label: string,
  position: number,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    'insert into dimension (tenant_id, key, label, position) values ($1, $2, $3, $4) returning id',
    [tenantId, key, label, position],
  )
  return unico(rows, 'dimension').id
}

async function valor(
  client: TenantClient,
  tenantId: string,
  dimensionId: string,
  label: string,
  parentId: string | null = null,
  archived = false,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into dimension_value (tenant_id, dimension_id, label, parent_id, archived_at)
     values ($1, $2, $3, $4, case when $5 then now() else null end) returning id`,
    [tenantId, dimensionId, label, parentId, archived],
  )
  return unico(rows, 'dimension_value').id
}

// ── Arranque ────────────────────────────────────────────────────────────────

let admin: Db
let app: Db

const ids = {
  cat: '',
  dim: '',
  mer: '',
  rec: '',
  pat: '',
  fx: '',
}
const dimIds = { propiedad: '', casaMadrid: '', obra: '', pisoLisboa: '', oficina: '', chalet: '' }

suite('lectura analítica', () => {
  beforeAll(async () => {
    await migrate(ADMIN_URL as string)
    admin = createPool({ connectionString: ADMIN_URL as string })
    app = createPool({ connectionString: APP_URL as string })

    await withoutTenantScope(admin, async (client) => {
      await client.query('delete from tenant where name = any($1::text[])', [HOGARES])
    })

    ids.cat = await crearHogar(admin, 'Análisis Categorías', 'EUR')
    ids.dim = await crearHogar(admin, 'Análisis Dimensiones', 'EUR')
    ids.mer = await crearHogar(admin, 'Análisis Comercios', 'EUR')
    ids.rec = await crearHogar(admin, 'Análisis Recurrentes', 'EUR')
    ids.pat = await crearHogar(admin, 'Análisis Patrimonio', 'EUR')
    ids.fx = await crearHogar(admin, 'Análisis FX', 'EUR')

    await sembrarCategorias()
    await sembrarDimensiones()
    await sembrarComercios()
    await sembrarRecurrentes()
    await sembrarPatrimonio()
    await sembrarFx()
  }, 120_000)

  afterAll(async () => {
    await admin?.end()
    await app?.end()
  })

  // ── Gasto por categoría ───────────────────────────────────────────────────

  describe('gasto por categoría y mes', () => {
    it('pliega la jerarquía de cuentas hasta la categoría raíz', async () => {
      const rows = await withTenant(app, ids.cat, (client) =>
        spendByCategoryMonth(client, { from: '2026-06-01', to: '2026-07-31', currency: 'EUR' }),
      )

      // Luz (120,00) + cine (25,00) + el taxi convertido (46,00). El hotel de
      // Lisboa no se pudo convertir y por eso no está sumado.
      expect(rows).toEqual([
        {
          month: '2026-06',
          categoryId: expect.any(String),
          category: 'Gastos',
          amount: 19100n,
          unconverted: 1,
        },
        {
          month: '2026-07',
          categoryId: expect.any(String),
          category: 'Gastos',
          amount: 13000n,
          unconverted: 0,
        },
      ])
    })

    it('con profundidad 2 baja un nivel y separa las ramas', async () => {
      const rows = await withTenant(app, ids.cat, (client) =>
        spendByCategoryMonth(client, {
          from: '2026-06-01',
          to: '2026-06-30',
          currency: 'EUR',
          depth: 2,
        }),
      )

      expect(rows.map((row) => [row.category, row.amount])).toEqual([
        ['Gastos:Casa', 12000n],
        ['Gastos:Viajes', 4600n],
        ['Gastos:Ocio', 2500n],
      ])
    })

    it('no cuenta como gasto una pata marcada como transferencia interna', async () => {
      // La regla vive en el posting, no en la cuenta: aunque el importe esté
      // contra una cuenta de gasto, si es una transferencia no es un gasto.
      const rows = await withTenant(app, ids.cat, (client) =>
        spendByCategoryMonth(client, {
          from: '2026-06-01',
          to: '2026-06-30',
          currency: 'EUR',
          depth: 2,
        }),
      )
      const ocio = rows.find((row) => row.category === 'Gastos:Ocio')
      expect(ocio?.amount).toBe(2500n)
    })

    it('declara los postings que no pudo convertir en vez de ignorarlos', async () => {
      const rows = await withTenant(app, ids.cat, (client) =>
        spendByCategoryMonth(client, {
          from: '2026-06-01',
          to: '2026-06-30',
          currency: 'EUR',
          depth: 2,
        }),
      )
      const viajes = rows.find((row) => row.category === 'Gastos:Viajes')
      expect(viajes).toEqual({
        month: '2026-06',
        categoryId: expect.any(String),
        category: 'Gastos:Viajes',
        amount: 4600n,
        unconverted: 1,
      })
    })

    it('un base_amount congelado en otra moneda no se suma como si fuera bueno', async () => {
      // El mismo mes pedido en dólares. El taxi tiene base_amount 46,00 pero
      // congelado en EUR: para un informe en USD ese número es la respuesta
      // correcta a otra pregunta, así que vale su importe de origen (50,00) y
      // no los 46. Lo que está en euros directamente no es convertible.
      const rows = await withTenant(app, ids.cat, (client) =>
        spendByCategoryMonth(client, { from: '2026-06-01', to: '2026-06-30', currency: 'USD' }),
      )

      expect(rows.map((row) => [row.category, row.amount, row.unconverted])).toEqual([
        ['Gastos', 25000n, 2],
      ])
    })
  })

  // ── Gasto por dimensión ───────────────────────────────────────────────────

  describe('gasto por dimensión', () => {
    it('reparte por weight_ppm y las partes suman exactamente el total', async () => {
      // 10,00 € al 33,3333 / 33,3333 / 33,3334 por ciento. En aritmética
      // entera las tres partes dan 999 y el céntimo que falta tiene dueño.
      const rows = await withTenant(app, ids.dim, (client) =>
        spendByDimension(client, {
          dimensionKey: 'propiedad',
          from: '2026-06-12',
          to: '2026-06-12',
          currency: 'EUR',
        }),
      )

      expect(rows.map((row) => row.amount)).toEqual([334n, 333n, 333n])
      expect(rows.reduce((acc, row) => acc + row.amount, 0n)).toBe(1000n)
    })

    it('un peso parcial no le regala a nadie la parte sin atribuir', async () => {
      const rows = await withTenant(app, ids.dim, (client) =>
        spendByDimension(client, {
          dimensionKey: 'propiedad',
          from: '2026-06-18',
          to: '2026-06-18',
          currency: 'EUR',
        }),
      )
      // 100,00 € atribuidos al 70% a Obra: los 30,00 restantes no son de Obra.
      expect(rows).toEqual([
        {
          valueId: dimIds.obra,
          label: 'Obra',
          parentId: dimIds.casaMadrid,
          amount: 7000n,
          transactions: 1,
          unconverted: 0,
          overAttributed: 0,
        },
      ])
    })

    it('declara el posting cuyos pesos pasaban del 100% en vez de reescalar en silencio', async () => {
      // 200,00 € atribuidos 100% a Casa Madrid y 100% a Obra: la base lo
      // permite y el usuario lo hace sin pensarlo. Reescalar a 50/50 es lo
      // menos malo, pero el importe resultante es una interpretación nuestra y
      // la fila tiene que poder decirlo.
      const rows = await withTenant(app, ids.dim, (client) =>
        spendByDimension(client, {
          dimensionKey: 'propiedad',
          from: '2026-08-01',
          to: '2026-08-31',
          currency: 'EUR',
        }),
      )

      expect(rows.map((row) => [row.label, row.amount, row.overAttributed])).toEqual([
        ['Casa Madrid', 10000n, 1],
        ['Obra', 10000n, 1],
      ])
    })

    it('suma el mes entero por valor y cuenta las transacciones de cada uno', async () => {
      const rows = await withTenant(app, ids.dim, (client) =>
        spendByDimension(client, {
          dimensionKey: 'propiedad',
          from: '2026-06-01',
          to: '2026-06-30',
          currency: 'EUR',
        }),
      )

      expect(rows.map((row) => [row.label, row.amount, row.transactions])).toEqual([
        ['Casa Madrid', 42333n, 3],
        ['Piso Lisboa', 20333n, 2],
        ['Obra', 7000n, 1],
        ['Oficina Barcelona', 334n, 1],
      ])
      // Ni un céntimo se pierde ni se inventa por el camino.
      expect(rows.reduce((acc, row) => acc + row.amount, 0n)).toBe(70000n)
    })

    it('sólo mira la dimensión pedida, aunque el posting tenga otras', async () => {
      const rows = await withTenant(app, ids.dim, (client) =>
        spendByDimension(client, {
          dimensionKey: 'persona',
          from: '2026-06-01',
          to: '2026-06-30',
          currency: 'EUR',
        }),
      )
      expect(rows.map((row) => [row.label, row.amount])).toEqual([['Julián', 12000n]])
    })
  })

  // ── Comercios ─────────────────────────────────────────────────────────────

  describe('top de comercios', () => {
    it('agrupa los descriptores con ruido bajo el mismo comercio', async () => {
      const { rows } = await withTenant(app, ids.mer, (client) =>
        topMerchants(client, {
          from: '2026-06-01',
          to: '2026-06-30',
          currency: 'EUR',
          limit: 10,
        }),
      )

      expect(rows.map((row) => [row.merchant, row.amount, row.transactions])).toEqual([
        ['MERCADONA VALENCIA', 10000n, 2],
        ['AMAZON MKTP ES', 3000n, 1],
        ['CEPSA', 2000n, 1],
        ['FARMACIA', 1000n, 1],
      ])
      expect(rows.map((row) => row.share)).toEqual([0.625, 0.8125, 0.9375, 1])
    })

    it('agrupa el mismo comercio aunque el banco reordene los tokens', async () => {
      // "ZARA ESPANA" y "ESPANA ZARA" son el mismo comercio: el conjunto de
      // tokens es idéntico y sólo cambia el orden en que el banco los escribe.
      const { rows } = await withTenant(app, ids.mer, (client) =>
        topMerchants(client, { from: '2026-09-01', to: '2026-09-30', currency: 'EUR', limit: 10 }),
      )
      expect(rows.map((row) => [row.merchant, row.amount, row.transactions])).toEqual([
        ['ZARA ESPANA', 7000n, 2],
      ])
    })

    it('el acumulado del Pareto se calcula sobre el gasto total, no sobre el recorte', async () => {
      // Si el denominador fuera el de los devueltos, el último siempre daría
      // 100% y la frase "estos dos son el 81% de tu gasto" sería mentira.
      const { rows, totalSpend, truncated } = await withTenant(app, ids.mer, (client) =>
        topMerchants(client, { from: '2026-06-01', to: '2026-06-30', currency: 'EUR', limit: 2 }),
      )
      expect(rows).toHaveLength(2)
      expect(rows[1]?.share).toBe(0.8125)
      expect(totalSpend).toBe(16000n)
      expect(truncated).toBe(2)
    })

    it('cuenta lo no convertible de todo el período, no sólo el de las filas devueltas', async () => {
      // El comercio no convertible vale cero, se hunde al fondo del orden y es
      // lo primero que recorta el limit. Si `unconverted` se leyera de las
      // filas, el informe diría "800,00 € y nada raro" mientras esconde un
      // gasto de 500,00 USD que nadie pudo convertir.
      const resultado = await withTenant(app, ids.mer, (client) =>
        topMerchants(client, { from: '2026-10-01', to: '2026-10-31', currency: 'EUR', limit: 1 }),
      )

      expect(resultado.rows.map((row) => [row.merchant, row.amount, row.unconverted])).toEqual([
        ['ELCORTEINGLES', 80000n, 0],
      ])
      expect(resultado.totalSpend).toBe(80000n)
      expect(resultado.unconverted).toBe(1)
      expect(resultado.truncated).toBe(1)
    })
  })

  // ── Recurrentes ───────────────────────────────────────────────────────────

  describe('recurrentes', () => {
    const traer = async (): Promise<RecurringRow[]> =>
      withTenant(app, ids.rec, (client) => recurring(client, { asOf: '2026-05-01' }))

    const buscar = (rows: readonly RecurringRow[], merchant: string): RecurringRow => {
      const row = rows.find((item) => item.merchant === merchant)
      if (row === undefined) throw new Error(`No se detectó el recurrente ${merchant}`)
      return row
    }

    it('marca subio una serie de importe fijo que sube más del 5% y del piso', async () => {
      const row = buscar(await traer(), 'IBERDROLA')
      expect(row.state).toBe('subio')
      expect(row.current).toBe(9000n)
      expect(row.median).toBe(8000n)
      expect(row.deltaPct).toBe(12.5)
      expect(row.occurrences).toBe(4)
      expect(row.confidence).toBe('confirmado')
      expect(row.frequencyDays).toBe(31)
      expect(row.lastOn).toBe('2026-04-10')
      expect(row.nextExpectedOn).toBe('2026-05-11')
      expect(row.history).toEqual([8000n, 8000n, 8000n, 9000n])
    })

    it('una serie de importe variable no se marca subio ni aunque duplique', async () => {
      // El súper sube y baja todos los meses. Avisar acá es enseñarle al
      // usuario a ignorar los avisos.
      const row = buscar(await traer(), 'SUPERCOR')
      expect(row.history).toEqual([5000n, 7000n, 12000n])
      expect(row.deltaPct).toBe(100)
      expect(row.state).toBe('activo')
    })

    it('una subida del 3% no dispara nada', async () => {
      const row = buscar(await traer(), 'MAPFRE SEGURO')
      expect(row.deltaPct).toBe(3)
      expect(row.state).toBe('activo')
    })

    it('una subida del 40% sobre 2 unidades mínimas tampoco dispara', async () => {
      // 0,05 a 0,07 es un 40%. Sin piso absoluto, el café dispara una alerta
      // todos los meses y el usuario apaga las notificaciones para siempre.
      const row = buscar(await traer(), 'CAFE ORUGA')
      expect(row.current).toBe(7n)
      expect(row.median).toBe(5n)
      expect(row.deltaPct).toBe(40)
      expect(row.state).toBe('activo')
    })

    it('la mediana con número par de elementos es el promedio de los dos centrales', async () => {
      const row = buscar(await traer(), 'GIMNASIO')
      expect(row.history).toEqual([3000n, 4000n, 5000n, 8000n, 9000n])
      // Referencia = las cuatro anteriores: (4000 + 5000) / 2.
      expect(row.median).toBe(4500n)
      expect(row.frequencyDays).toBe(31)
    })

    it('marca no-cobro cuando pasó más de una vez y media la frecuencia', async () => {
      const row = buscar(await traer(), 'NETFLIX COM')
      expect(row.lastOn).toBe('2026-03-05')
      expect(row.frequencyDays).toBe(30)
      expect(row.state).toBe('no-cobro')
    })

    it('con dos ocurrencias la serie es probable y no puede marcar una subida', async () => {
      const row = buscar(await traer(), 'MUTUA')
      expect(row.occurrences).toBe(2)
      expect(row.confidence).toBe('probable')
      // Sube un 33% con piso de sobra, pero un solo precio anterior no es una
      // serie de importe fijo: no hay contra qué comparar.
      expect(row.deltaPct).toBe(33.33)
      expect(row.state).toBe('activo')
    })

    it('compara en la moneda de facturación y marca huérfano lo que nadie reclama', async () => {
      const row = buscar(await traer(), 'SPOTIFY')
      // En euros la serie sube (10,50 → 11,50) sólo por el tipo de cambio.
      expect(row.currency).toBe('USD')
      expect(row.history).toEqual([1199n, 1199n, 1199n])
      expect(row.deltaPct).toBe(0)
      expect(row.state).toBe('huerfano')
    })

    it('no dice no-cobro si el cargo siguió apareciendo en otra moneda de facturación', async () => {
      // El banco dejó de informar la moneda de origen en abril, así que la
      // serie en dólares se corta en marzo. Avisar de una baja que no ocurrió
      // es el falso positivo más caro: el usuario lo comprueba y no hay nada.
      const row = buscar(await traer(), 'DROPBOX')
      expect(row.currency).toBe('USD')
      expect(row.occurrences).toBe(3)
      expect(row.lastOn).toBe('2026-03-07')
      expect(row.state).toBe('activo')
    })

    it('no confunde una transferencia mensual al ahorro con una obligación', async () => {
      const rows = await traer()
      expect(rows.map((row) => row.merchant)).not.toContain('TRASPASO AHORRO')
    })
  })

  // ── Patrimonio ────────────────────────────────────────────────────────────

  describe('patrimonio', () => {
    it('arrastra el saldo mes a mes y avisa de lo que no pudo convertir', async () => {
      const puntos = await withTenant(app, ids.pat, (client) =>
        netWorthSeries(client, { from: '2026-01-01', to: '2026-03-31', currency: 'EUR' }),
      )

      expect(puntos).toEqual([
        { month: '2026-01', assets: 320000n, liabilities: 0n, net: 320000n, unconverted: 0 },
        { month: '2026-02', assets: 300000n, liabilities: 30000n, net: 270000n, unconverted: 0 },
        // Marzo no mueve el saldo: el cargo en dólares no es convertible y se
        // declara en vez de colarse como un cero.
        { month: '2026-03', assets: 300000n, liabilities: 30000n, net: 270000n, unconverted: 1 },
      ])
    })

    it('el waterfall cierra: apertura + aportes - gastos + revaluación + FX = cierre', async () => {
      const w = await withTenant(app, ids.pat, (client) =>
        netWorthAttribution(client, { from: '2026-01-01', to: '2026-02-28', currency: 'EUR' }),
      )

      expect(w.opening).toBe(100000n)
      expect(w.contributions).toBe(300000n)
      expect(w.spending).toBe(130000n)
      expect(w.assetRevaluation).toBe(0n)
      expect(w.closing).toBe(270000n)
      expect(w.opening + w.contributions - w.spending + w.assetRevaluation + w.fxEffect).toBe(
        w.closing,
      )
    })

    it('sin cuentas de revaluación FX lo dice, en vez de mostrar un cero que parece un dato', async () => {
      const w = await withTenant(app, ids.pat, (client) =>
        netWorthAttribution(client, { from: '2026-01-01', to: '2026-02-28', currency: 'EUR' }),
      )
      expect(w.fxModelled).toBe(false)
      expect(w.fxEffect).toBe(0n)
    })

    it('con cuentas Equity:FX-Revaluation separa el efecto cambiario de la revaluación', async () => {
      const w = await withTenant(app, ids.fx, (client) =>
        netWorthAttribution(client, { from: '2026-01-01', to: '2026-03-31', currency: 'EUR' }),
      )

      expect(w.fxModelled).toBe(true)
      expect(w.fxEffect).toBe(5000n)
      expect(w.assetRevaluation).toBe(20000n)
      expect(w.opening).toBe(100000n)
      expect(w.closing).toBe(125000n)
      expect(w.opening + w.contributions - w.spending + w.assetRevaluation + w.fxEffect).toBe(
        w.closing,
      )
    })
  })

  // ── Cola de revisión y dimensiones ────────────────────────────────────────

  describe('cola de revisión', () => {
    it('filtra por estado y trae el importe y la cuenta del cargo', async () => {
      const rows = await withTenant(app, ids.cat, (client) =>
        reviewQueue(client, { state: 'pendiente' }),
      )

      expect(rows).toHaveLength(1)
      const row = rows[0]
      expect(row?.kind).toBe('posible_duplicado')
      expect(row?.description).toBe('IBERDROLA')
      expect(row?.bookedOn).toBe('2026-06-05')
      expect(row?.amount).toBe(-12000n)
      expect(row?.currency).toBe('EUR')
      expect(row?.accountName).toBe('BBVA')
      expect(row?.evidence['similitud']).toBe(0.82)
      expect(row?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    })

    it('sin filtro devuelve también lo ya resuelto', async () => {
      const rows = await withTenant(app, ids.cat, (client) => reviewQueue(client))
      expect(rows.map((row) => row.state).sort()).toEqual(['aceptado', 'pendiente'])
    })
  })

  describe('dimensiones', () => {
    it('devuelve los valores con cuántos postings los usan, archivados incluidos', async () => {
      const dims = await withTenant(app, ids.dim, (client) => dimensionsWithValues(client))

      expect(dims.map((d) => d.key)).toEqual(['propiedad', 'persona'])
      const propiedad = dims[0]
      expect(propiedad?.values.map((v) => [v.label, v.usage])).toEqual([
        ['Casa Madrid', 4],
        ['Chalet Vendido', 0],
        ['Obra', 2],
        ['Oficina Barcelona', 1],
        ['Piso Lisboa', 2],
      ])
      const chalet = propiedad?.values.find((v) => v.label === 'Chalet Vendido')
      expect(chalet?.archivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      const obra = propiedad?.values.find((v) => v.label === 'Obra')
      expect(obra?.parentId).toBe(dimIds.casaMadrid)
    })
  })
})

// ── Siembra por hogar ───────────────────────────────────────────────────────

async function sembrarCategorias(): Promise<void> {
  await withTenant(app, ids.cat, async (client) => {
    const t = ids.cat
    const bbva = await cuenta(client, t, 'asset', 'BBVA', 'EUR')
    const chase = await cuenta(client, t, 'asset', 'Chase', 'USD')
    const gastos = await cuenta(client, t, 'expense', 'Gastos', 'EUR')
    const casa = await cuenta(client, t, 'expense', 'Gastos:Casa', 'EUR', gastos)
    const luz = await cuenta(client, t, 'expense', 'Gastos:Casa:Luz', 'EUR', casa)
    const ocio = await cuenta(client, t, 'expense', 'Gastos:Ocio', 'EUR', gastos)
    const viajes = await cuenta(client, t, 'expense', 'Gastos:Viajes', 'USD', gastos)

    const iberdrola = await asentar(client, t, {
      on: '2026-06-05',
      description: 'IBERDROLA',
      postings: [
        { account: luz, amount: 12000n, currency: 'EUR' },
        { account: bbva, amount: -12000n, currency: 'EUR' },
      ],
    })
    const cine = await asentar(client, t, {
      on: '2026-06-20',
      description: 'CINE',
      postings: [
        { account: ocio, amount: 2500n, currency: 'EUR' },
        { account: bbva, amount: -2500n, currency: 'EUR' },
      ],
    })
    await asentar(client, t, {
      on: '2026-07-05',
      description: 'IBERDROLA',
      postings: [
        { account: luz, amount: 13000n, currency: 'EUR' },
        { account: bbva, amount: -13000n, currency: 'EUR' },
      ],
    })
    // Una pata contra una cuenta de gasto marcada como transferencia interna.
    await asentar(client, t, {
      on: '2026-06-28',
      description: 'REGULARIZACION INTERNA',
      postings: [
        { account: ocio, amount: 9999n, currency: 'EUR', transfer: true },
        { account: bbva, amount: -9999n, currency: 'EUR', transfer: true },
      ],
    })
    // Gasto en dólares sin conversión congelada: no se puede sumar en euros.
    await asentar(client, t, {
      on: '2026-06-15',
      description: 'HOTEL LISBOA',
      postings: [
        { account: viajes, amount: 20000n, currency: 'USD' },
        { account: chase, amount: -20000n, currency: 'USD' },
      ],
    })
    await asentar(client, t, {
      on: '2026-06-16',
      description: 'TAXI LISBOA',
      postings: [
        { account: viajes, amount: 5000n, currency: 'USD', base: 4600n, baseCurrency: 'EUR' },
        { account: chase, amount: -5000n, currency: 'USD', base: -4600n, baseCurrency: 'EUR' },
      ],
    })

    await client.query(
      `insert into review_item (tenant_id, kind, state, entry_id, evidence)
       values ($1, 'posible_duplicado', 'pendiente', $2, $3::jsonb),
              ($1, 'sin_categorizar', 'aceptado', $4, '{}'::jsonb)`,
      [t, iberdrola, JSON.stringify({ similitud: 0.82, dias: 2 }), cine],
    )
  })
}

async function sembrarDimensiones(): Promise<void> {
  await withTenant(app, ids.dim, async (client) => {
    const t = ids.dim
    const bbva = await cuenta(client, t, 'asset', 'BBVA', 'EUR')
    const gasto = await cuenta(client, t, 'expense', 'Gastos:Casa', 'EUR')

    const propiedad = await dimension(client, t, 'propiedad', 'Propiedad', 0)
    const persona = await dimension(client, t, 'persona', 'Persona', 1)
    const casaMadrid = await valor(client, t, propiedad, 'Casa Madrid')
    const obra = await valor(client, t, propiedad, 'Obra', casaMadrid)
    const pisoLisboa = await valor(client, t, propiedad, 'Piso Lisboa')
    const oficina = await valor(client, t, propiedad, 'Oficina Barcelona')
    const chalet = await valor(client, t, propiedad, 'Chalet Vendido', null, true)
    const julian = await valor(client, t, persona, 'Julián')

    dimIds.propiedad = propiedad
    dimIds.casaMadrid = casaMadrid
    dimIds.obra = obra
    dimIds.pisoLisboa = pisoLisboa
    dimIds.oficina = oficina
    dimIds.chalet = chalet

    const cargo = (
      on: string,
      description: string,
      amount: bigint,
      dims: readonly { dimension: string; value: string; ppm: number }[],
    ) =>
      asentar(client, t, {
        on,
        description,
        postings: [
          { account: gasto, amount, currency: 'EUR', dims },
          { account: bbva, amount: -amount, currency: 'EUR' },
        ],
      })

    await cargo('2026-06-05', 'LUZ CASA', 12000n, [
      { dimension: propiedad, value: casaMadrid, ppm: 1_000_000 },
      { dimension: persona, value: julian, ppm: 1_000_000 },
    ])
    await cargo('2026-06-10', 'REFORMA', 50000n, [
      { dimension: propiedad, value: casaMadrid, ppm: 600_000 },
      { dimension: propiedad, value: pisoLisboa, ppm: 400_000 },
    ])
    await cargo('2026-06-12', 'GESTORIA', 1000n, [
      { dimension: propiedad, value: casaMadrid, ppm: 333_333 },
      { dimension: propiedad, value: pisoLisboa, ppm: 333_333 },
      { dimension: propiedad, value: oficina, ppm: 333_334 },
    ])
    await cargo('2026-06-18', 'JARDINERO', 10000n, [
      { dimension: propiedad, value: obra, ppm: 700_000 },
    ])
    // 100% al padre y 100% a la hija: los pesos suman el 200%.
    await cargo('2026-08-04', 'DERRAMA', 20000n, [
      { dimension: propiedad, value: casaMadrid, ppm: 1_000_000 },
      { dimension: propiedad, value: obra, ppm: 1_000_000 },
    ])
  })
}

async function sembrarComercios(): Promise<void> {
  await withTenant(app, ids.mer, async (client) => {
    const t = ids.mer
    const bbva = await cuenta(client, t, 'asset', 'BBVA', 'EUR')
    const gasto = await cuenta(client, t, 'expense', 'Gastos', 'EUR')
    const compra = (on: string, description: string, amount: bigint) =>
      asentar(client, t, {
        on,
        description,
        postings: [
          { account: gasto, amount, currency: 'EUR' },
          { account: bbva, amount: -amount, currency: 'EUR' },
        ],
      })

    await compra('2026-06-03', 'MERCADONA VALENCIA REF 8811', 6000n)
    await compra('2026-06-17', 'MERCADONA VALENCIA REF 9422', 4000n)
    await compra('2026-06-08', 'AMAZON MKTP ES', 3000n)
    await compra('2026-06-11', 'CEPSA', 2000n)
    await compra('2026-06-22', 'FARMACIA', 1000n)

    // Mismo comercio con los tokens en distinto orden.
    await compra('2026-09-05', 'PAGO TARJETA ZARA ESPANA', 3000n)
    await compra('2026-09-19', 'ESPANA ZARA COMPRA', 4000n)

    // Octubre: un gasto grande en euros y otro en dólares sin conversión
    // congelada, para que el no convertible quede fuera del top.
    const chase = await cuenta(client, t, 'asset', 'Chase', 'USD')
    const viajes = await cuenta(client, t, 'expense', 'Gastos:Viajes', 'USD')
    await compra('2026-10-02', 'ELCORTEINGLES', 80000n)
    await asentar(client, t, {
      on: '2026-10-09',
      description: 'RESORT MALDIVAS',
      postings: [
        { account: viajes, amount: 50000n, currency: 'USD' },
        { account: chase, amount: -50000n, currency: 'USD' },
      ],
    })
  })
}

async function sembrarRecurrentes(): Promise<void> {
  await withTenant(app, ids.rec, async (client) => {
    const t = ids.rec
    const bbva = await cuenta(client, t, 'asset', 'BBVA', 'EUR')
    const visa = await cuenta(client, t, 'liability', 'Visa Oro', 'EUR')
    const ahorro = await cuenta(client, t, 'asset', 'Ahorro', 'EUR')
    const gasto = await cuenta(client, t, 'expense', 'Gastos', 'EUR')

    const persona = await dimension(client, t, 'persona', 'Persona', 0)
    const julian = await valor(client, t, persona, 'Julián')
    const reclamado = [{ dimension: persona, value: julian, ppm: 1_000_000 }]

    const cargo = (
      on: string,
      description: string,
      amount: bigint,
      account: string,
      atribuido: boolean,
      native?: { amount: bigint; currency: string },
    ) =>
      asentar(client, t, {
        on,
        description,
        postings: [
          { account: gasto, amount, currency: 'EUR', ...(atribuido ? { dims: reclamado } : {}) },
          {
            account,
            amount: -amount,
            currency: 'EUR',
            ...(native === undefined
              ? {}
              : { native: { amount: -native.amount, currency: native.currency } }),
          },
        ],
      })

    for (const [on, amount] of [
      ['2026-01-10', 8000n],
      ['2026-02-10', 8000n],
      ['2026-03-10', 8000n],
      ['2026-04-10', 9000n],
    ] as const) {
      await cargo(on, 'IBERDROLA', amount, bbva, true)
    }

    for (const on of ['2026-01-05', '2026-02-05', '2026-03-05']) {
      await cargo(on, 'NETFLIX COM', 1299n, visa, true)
    }

    for (const [on, amount] of [
      ['2026-01-20', 5000n],
      ['2026-02-20', 7000n],
      ['2026-03-20', 12000n],
    ] as const) {
      await cargo(on, 'SUPERCOR', amount, bbva, true)
    }

    for (const [on, amount] of [
      ['2026-01-25', 10000n],
      ['2026-02-25', 10000n],
      ['2026-03-25', 10000n],
      ['2026-04-25', 10300n],
    ] as const) {
      await cargo(on, 'MAPFRE SEGURO', amount, bbva, true)
    }

    for (const [on, amount] of [
      ['2026-01-08', 5n],
      ['2026-02-08', 5n],
      ['2026-03-08', 5n],
      ['2026-04-08', 7n],
    ] as const) {
      await cargo(on, 'CAFE ORUGA', amount, bbva, true)
    }

    for (const [on, amount] of [
      ['2025-12-12', 3000n],
      ['2026-01-12', 4000n],
      ['2026-02-12', 5000n],
      ['2026-03-12', 8000n],
      ['2026-04-12', 9000n],
    ] as const) {
      await cargo(on, 'GIMNASIO', amount, bbva, true)
    }

    await cargo('2026-03-01', 'MUTUA', 4500n, bbva, true)
    await cargo('2026-04-01', 'MUTUA', 6000n, bbva, true)

    // Facturada en dólares: en euros la serie sube sola por el tipo de cambio.
    // Y nadie la atribuyó a ninguna dimensión, así que está huérfana.
    for (const [on, amount] of [
      ['2026-02-15', 1050n],
      ['2026-03-15', 1099n],
      ['2026-04-15', 1150n],
    ] as const) {
      await cargo(on, 'SPOTIFY', amount, visa, false, { amount: 1199n, currency: 'USD' })
    }

    // El origen trae la moneda de facturación en los tres primeros cargos y
    // deja de traerla en el cuarto: la serie se parte en dos por moneda.
    for (const on of ['2026-01-07', '2026-02-07', '2026-03-07']) {
      await cargo(on, 'DROPBOX', 1100n, visa, true, { amount: 1199n, currency: 'USD' })
    }
    await cargo('2026-04-07', 'DROPBOX', 1100n, visa, true)

    for (const on of ['2026-01-28', '2026-02-28', '2026-03-28']) {
      await asentar(client, t, {
        on,
        description: 'TRASPASO AHORRO',
        postings: [
          { account: ahorro, amount: 20000n, currency: 'EUR', transfer: true },
          { account: bbva, amount: -20000n, currency: 'EUR', transfer: true },
        ],
      })
    }
  })
}

async function sembrarPatrimonio(): Promise<void> {
  await withTenant(app, ids.pat, async (client) => {
    const t = ids.pat
    const bbva = await cuenta(client, t, 'asset', 'BBVA', 'EUR')
    const chase = await cuenta(client, t, 'asset', 'Chase', 'USD')
    const visa = await cuenta(client, t, 'liability', 'Visa', 'EUR')
    const nomina = await cuenta(client, t, 'income', 'Ingresos:Nómina', 'EUR')
    const gasto = await cuenta(client, t, 'expense', 'Gastos', 'EUR')
    const apertura = await cuenta(client, t, 'equity', 'Saldo de apertura', 'EUR')
    const viajes = await cuenta(client, t, 'expense', 'Gastos:Viajes', 'USD')

    await asentar(client, t, {
      on: '2025-12-31',
      description: 'Saldo de apertura',
      postings: [
        { account: bbva, amount: 100000n, currency: 'EUR' },
        { account: apertura, amount: -100000n, currency: 'EUR' },
      ],
    })
    await asentar(client, t, {
      on: '2026-01-15',
      description: 'NOMINA',
      postings: [
        { account: bbva, amount: 300000n, currency: 'EUR' },
        // Los ingresos son postings negativos contra cuentas de ingreso.
        { account: nomina, amount: -300000n, currency: 'EUR' },
      ],
    })
    await asentar(client, t, {
      on: '2026-01-20',
      description: 'ALQUILER',
      postings: [
        { account: gasto, amount: 80000n, currency: 'EUR' },
        { account: bbva, amount: -80000n, currency: 'EUR' },
      ],
    })
    await asentar(client, t, {
      on: '2026-02-10',
      description: 'COMPRA CON VISA',
      postings: [
        { account: gasto, amount: 50000n, currency: 'EUR' },
        { account: visa, amount: -50000n, currency: 'EUR' },
      ],
    })
    await asentar(client, t, {
      on: '2026-02-25',
      description: 'PAGO VISA',
      postings: [
        { account: visa, amount: 20000n, currency: 'EUR', transfer: true },
        { account: bbva, amount: -20000n, currency: 'EUR', transfer: true },
      ],
    })
    await asentar(client, t, {
      on: '2026-03-05',
      description: 'HOTEL NUEVA YORK',
      postings: [
        { account: viajes, amount: 15000n, currency: 'USD' },
        { account: chase, amount: -15000n, currency: 'USD' },
      ],
    })
  })
}

async function sembrarFx(): Promise<void> {
  await withTenant(app, ids.fx, async (client) => {
    const t = ids.fx
    const inmueble = await cuenta(client, t, 'asset', 'Inmueble Lisboa', 'EUR')
    const apertura = await cuenta(client, t, 'equity', 'Saldo de apertura', 'EUR')
    const fx = await cuenta(client, t, 'equity', 'Equity:FX-Revaluation:USD', 'EUR')
    const revaluacion = await cuenta(client, t, 'equity', 'Equity:Revaluation', 'EUR')

    await asentar(client, t, {
      on: '2025-12-31',
      description: 'Saldo de apertura',
      postings: [
        { account: inmueble, amount: 100000n, currency: 'EUR' },
        { account: apertura, amount: -100000n, currency: 'EUR' },
      ],
    })
    await asentar(client, t, {
      on: '2026-02-15',
      description: 'Revaluación cambiaria',
      postings: [
        { account: inmueble, amount: 5000n, currency: 'EUR' },
        { account: fx, amount: -5000n, currency: 'EUR' },
      ],
    })
    await asentar(client, t, {
      on: '2026-03-01',
      description: 'Tasación anual',
      postings: [
        { account: inmueble, amount: 20000n, currency: 'EUR' },
        { account: revaluacion, amount: -20000n, currency: 'EUR' },
      ],
    })
  })
}

if (!enabled) {
  describe('lectura analítica', () => {
    it.skip('necesita DATABASE_URL y DATABASE_APP_URL (pnpm db:up)', () => {})
  })
}
