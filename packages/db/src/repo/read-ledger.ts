/**
 * Capa de lectura del libro mayor.
 *
 * Todo lo que la aplicación muestra sale de acá: saldos, listado de
 * movimientos, reconciliación, totales y árbol de categorías. Tres reglas
 * gobiernan el módulo entero:
 *
 *  1. **Nada se convierte a la moneda de reporte por su cuenta.** Un posting
 *     sólo cuenta si trae `base_amount` congelado en esa moneda o si ya está
 *     en ella. Los que quedan fuera se cuentan y se devuelven — nunca se
 *     ignoran en silencio, que es la forma más rápida de emitir un total que
 *     parece completo y no lo es.
 *
 *  2. **`is_transfer` no es gasto ni ingreso.** Vale incluso cuando la pata
 *     cuelga de una cuenta de gasto: el importador categoriza primero y el
 *     matcher de transferencias marca después, así que hay postings contra
 *     'Cajero' que son un traspaso a efectivo y no un gasto.
 *
 *  3. **Los importes viajan como texto desde Postgres y se convierten con
 *     BigInt.** `sum()` sobre bigint devuelve numeric, y numeric por JSON o
 *     por `parseInt` pierde precisión en cuanto el patrimonio pasa de 2^53
 *     unidades mínimas. Por eso hay `::text` en cada importe, también dentro
 *     de los json_build_object.
 *
 * Las fechas salen con to_char y no como `date`: node-postgres convierte
 * `date` a un objeto Date a medianoche **local**, y al oeste de Greenwich eso
 * devuelve el día anterior. El resto del sistema trabaja con 'YYYY-MM-DD'.
 *
 * Ninguna consulta filtra por tenant_id: eso lo hace RLS con la variable que
 * fija `withTenant`. Si una policy faltara, agregar el filtro acá lo taparía.
 */

import type { TenantClient } from '../client.js'
import { sqlSinCategorizar } from './classify.js'

export type AccountKind = 'asset' | 'liability' | 'income' | 'expense' | 'equity' | 'trading'

export type DataSource = 'file' | 'pdf' | 'manual' | 'api'

/** Fecha 'YYYY-MM-DD'. Nunca un Date: ver la nota de husos horarios arriba. */
export type Ymd = string

// ── Utilidades de conversión ────────────────────────────────────────────────

/**
 * Sólo `string`: todos los importes llegan con `::text` desde Postgres.
 *
 * El tipo no admite `number` a propósito. Si alguien quita un `::text` y la
 * columna vuelve como número de JavaScript, esto tiene que dejar de compilar
 * en vez de aceptar un importe que ya perdió precisión antes de llegar acá.
 */
function toBigInt(value: string | null): bigint {
  if (value === null) {
    throw new TypeError('Se esperaba un importe y llegó null')
  }
  return BigInt(value)
}

function toBigIntOrNull(value: string | null): bigint | null {
  return value === null ? null : BigInt(value)
}

/** Contadores de filas, no importes: un count nunca se acerca a 2^53. */
function toCount(value: number | null): number {
  return value === null ? 0 : Number(value)
}

// ── Validación de los argumentos ────────────────────────────────────────────

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * `Ymd` es un alias de `string`, así que el compilador no impide pasar un
 * `Date` desde JavaScript sin tipos (un date picker, un query param). Y un
 * `Date` no falla: `pg` lo serializa con el huso local, y al oeste de
 * Greenwich el corte del período se va un día atrás sin que nada avise.
 * Por eso el formato se comprueba en el borde y no se confía en el tipo.
 */
function assertYmd(value: Ymd, field: string): Ymd {
  if (typeof value !== 'string' || !YMD_RE.test(value)) {
    throw new TypeError(`${field} tiene que ser 'YYYY-MM-DD' y llegó ${JSON.stringify(value)}`)
  }
  return value
}

function optionalYmd(value: Ymd | undefined, field: string): Ymd | null {
  return value === undefined ? null : assertYmd(value, field)
}

function assertPeriod(period: { from: Ymd; to: Ymd }, field: string): void {
  assertYmd(period.from, `${field}.from`)
  assertYmd(period.to, `${field}.to`)
  // Un período invertido devolvería cero movimientos, y "cero" acá se lee como
  // "no pasó nada" en vez de como "preguntaste mal".
  if (period.from > period.to) {
    throw new RangeError(
      `${field}: el período empieza (${period.from}) después de terminar (${period.to})`,
    )
  }
}

const CURRENCY_RE = /^[A-Za-z]{3}$/

/**
 * Normaliza y comprueba el código de moneda antes de que lo vea el SQL.
 *
 * Dos formas silenciosas de arruinar un reporte que esto corta: 'eur' no
 * compara igual que el 'EUR' guardado —y entonces TODO queda sin convertir y
 * el total sale cero—, y `'EURO'::char(3)` en Postgres trunca sin error a
 * 'EUR', así que una moneda mal escrita produciría un total creíble y ajeno.
 */
function assertCurrency(value: string, field: string): string {
  if (typeof value !== 'string' || !CURRENCY_RE.test(value)) {
    throw new TypeError(
      `${field} tiene que ser un código ISO de 3 letras y llegó ${JSON.stringify(value)}`,
    )
  }
  return value.toUpperCase()
}

/** Un limit NaN llegaría al SQL como 'NaN' y reventaría la consulta entera. */
function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(min, Math.trunc(value)), max)
}

/**
 * Un '%' o un '_' escritos por el usuario son texto, no comodines.
 *
 * Sin escapar, buscar "100%" trae también "1005 caja": el % final convierte la
 * búsqueda en un prefijo. La barra invertida se escapa primero porque si no,
 * las que agrega este mismo reemplazo se volverían a escapar.
 */
function likePattern(search: string | undefined): string | null {
  if (search === undefined) return null
  const trimmed = search.trim()
  if (trimmed === '') return null
  return `%${trimmed.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

// ── Saldos por cuenta ───────────────────────────────────────────────────────

export interface AccountBalance {
  readonly id: string
  readonly name: string
  readonly kind: AccountKind
  readonly currency: string
  readonly institution: string | null
  readonly country: string | null
  readonly parentId: string | null
  readonly closedAt: Ymd | null
  /** Suma de los postings de la cuenta, en su propia moneda. */
  readonly balance: bigint
  /** Último saldo declarado por el banco con fecha <= asOf. */
  readonly declared: bigint | null
  readonly declaredOn: Ymd | null
  /** balance - declared. Null cuando no hay nada contra qué comparar. */
  readonly delta: bigint | null
  /**
   * El último saldo que el agregador leyó del banco, y cuándo.
   *
   * Es **otra comprobación**, no la misma: `declared` viene de un extracto y
   * tiene grano de día; esto viene de una lectura del proveedor y tiene grano
   * de instante. Una cuenta alimentada por feed no tiene extracto declarado
   * nunca, y sin esto las pantallas decían «no se pudo comprobar» justo después
   * de haberla comprobado al céntimo. Ver la migración 012.
   */
  readonly providerBalance: bigint | null
  /** ISO 8601 con hora. No es un `Ymd`: el instante es el punto. */
  readonly providerBalanceAt: string | null
  readonly providerName: string | null
  /** balance - providerBalance. Null cuando el proveedor no dijo nada. */
  readonly providerDelta: bigint | null
  readonly movements: number
  /**
   * Postings de la cuenta en una moneda distinta a la suya, que por eso
   * **no** están sumados en `balance`. Debería ser siempre 0: el esquema da
   * por sentado que una cuenta tiene una sola moneda. Si no lo es, hay datos
   * corruptos y el saldo está incompleto — que se vea es el punto.
   */
  readonly foreignPostings: number
  readonly lastMovementOn: Ymd | null
}

interface AccountBalanceRow {
  id: string
  name: string
  kind: AccountKind
  currency: string
  institution: string | null
  country: string | null
  parent_id: string | null
  closed_at: string | null
  balance: string
  provider_balance: string | null
  provider_balance_at: string | null
  provider_name: string | null
  movements: number
  foreign_postings: number
  last_movement_on: string | null
  declared: string | null
  declared_on: string | null
}

/**
 * Saldo de cada cuenta y su distancia contra el extracto del banco.
 *
 * No se filtran las cuentas cerradas ni las de sistema: quien pinta la
 * pantalla decide qué esconder, y una cuenta cerrada con saldo distinto de
 * cero es exactamente lo que hay que poder ver.
 *
 * Los asientos anulados (`reversed_by`) tampoco se excluyen. Anular crea un
 * asiento inverso, así que el par ya suma cero; quitar sólo el anulado y
 * dejar el que lo anula daría un saldo con el signo cambiado.
 *
 * La suma cuenta sólo los postings en la moneda de la cuenta, y lo mismo con
 * el saldo declarado. Sumar 100 USD a un saldo en euros da un número que no
 * es dinero de nada, y restarle al saldo un extracto en otra moneda produce
 * un delta inventado. Lo que queda fuera se devuelve en `foreignPostings`.
 */
export async function accountBalances(
  client: TenantClient,
  opts: { asOf?: Ymd | undefined } = {},
): Promise<AccountBalance[]> {
  const asOf = optionalYmd(opts.asOf, 'asOf')
  const { rows } = await client.query<AccountBalanceRow>(
    `select
       a.id,
       a.name,
       a.kind,
       a.currency,
       a.institution,
       a.country,
       a.parent_id,
       to_char(a.closed_at, 'YYYY-MM-DD') as closed_at,
       m.balance,
       m.movements,
       m.foreign_postings,
       to_char(m.last_movement_on, 'YYYY-MM-DD') as last_movement_on,
       d.amount::text as declared,
       to_char(d.as_of, 'YYYY-MM-DD') as declared_on,
       pv.amount::text as provider_balance,
       to_char(pv.observed_at, 'YYYY-MM-DD"T"HH24:MI:SSOF:00') as provider_balance_at,
       pv.provider::text as provider_name
     from account a
     left join lateral (
       select
         coalesce(sum(p.amount) filter (where p.currency = a.currency), 0)::text as balance,
         count(*)::int                                                           as movements,
         (count(*) filter (where p.currency <> a.currency))::int as foreign_postings,
         max(e.booked_on)                                                        as last_movement_on
       from posting p
       join entry e on e.id = p.entry_id
       where p.account_id = a.id
         and ($1::date is null or e.booked_on <= $1::date)
     ) m on true
     left join lateral (
       select db.amount, db.as_of
       from declared_balance db
       where db.account_id = a.id
         and db.currency = a.currency
         and ($1::date is null or db.as_of <= $1::date)
       order by db.as_of desc
       limit 1
     ) d on true
     left join lateral (
       -- La moneda se compara igual que arriba: un saldo en otra divisa daría
       -- un delta inventado, que es la trampa que esta consulta se niega a
       -- hacer en los tres sitios donde compara.
       select pb.amount, pb.observed_at, pb.provider
       from provider_balance pb
       where pb.account_id = a.id
         and pb.currency = a.currency
         and ($1::date is null or pb.observed_at::date <= $1::date)
       order by pb.observed_at desc
       limit 1
     ) pv on true
     order by a.kind, a.name`,
    [asOf],
  )

  return rows.map((row) => {
    const balance = toBigInt(row.balance)
    const declared = toBigIntOrNull(row.declared)
    const proveedor = toBigIntOrNull(row.provider_balance)
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      currency: row.currency,
      institution: row.institution,
      country: row.country,
      parentId: row.parent_id,
      closedAt: row.closed_at,
      balance,
      declared,
      declaredOn: row.declared_on,
      delta: declared === null ? null : balance - declared,
      providerBalance: proveedor,
      providerBalanceAt: row.provider_balance_at,
      providerName: row.provider_name,
      providerDelta: proveedor === null ? null : balance - proveedor,
      movements: toCount(row.movements),
      foreignPostings: toCount(row.foreign_postings),
      lastMovementOn: row.last_movement_on,
    }
  })
}

// ── Liquidez ────────────────────────────────────────────────────────────────

export interface LiquidityLane {
  readonly currency: string
  readonly total: bigint
  readonly accounts: number
  /** Postings en una moneda distinta a la de su cuenta, fuera de `total`. */
  readonly foreignPostings: number
}

/**
 * Efectivo disponible, un carril por moneda y **sin consolidar**.
 *
 * Consolidar sería mentir: tener 50.000 EUR y -50.000 USD no es tener cero,
 * es tener un problema de liquidez en dólares. El problema de liquidez es por
 * moneda, así que el reporte también.
 *
 * Sólo cuentas 'asset' abiertas: una cuenta cerrada no aporta liquidez, y una
 * de pasivo es deuda, no caja.
 */
export async function liquidityByCurrency(client: TenantClient): Promise<LiquidityLane[]> {
  const { rows } = await client.query<{
    currency: string
    total: string
    accounts: number
    foreign_postings: number
  }>(
    // El carril es el de la moneda de la CUENTA, así que un posting en otra
    // moneda no pertenece a este carril ni a ninguno: se cuenta aparte en vez
    // de engordar el total con unidades que no son las que dice la etiqueta.
    `select
       a.currency,
       coalesce(sum(p.amount) filter (where p.currency = a.currency), 0)::text as total,
       count(distinct a.id)::int                                               as accounts,
       (count(p.id) filter (where p.currency <> a.currency))::int as foreign_postings
     from account a
     left join posting p on p.account_id = a.id
     where a.kind = 'asset'
       and a.closed_at is null
     group by a.currency
     order by a.currency`,
  )

  return rows.map((row) => ({
    currency: row.currency,
    total: toBigInt(row.total),
    accounts: toCount(row.accounts),
    foreignPostings: toCount(row.foreign_postings),
  }))
}

// ── Movimientos ─────────────────────────────────────────────────────────────

export interface MovementDimension {
  readonly dimensionId: string
  readonly key: string
  readonly label: string
  readonly valueId: string
  readonly value: string
  readonly weightPpm: number
}

export interface MovementRow {
  readonly entryId: string
  readonly postingId: string
  readonly bookedOn: Ymd
  readonly description: string
  readonly accountId: string
  readonly accountName: string
  readonly currency: string
  readonly amount: bigint
  readonly baseAmount: bigint | null
  readonly baseCurrency: string | null
  readonly categoryId: string | null
  readonly category: string | null
  readonly isTransfer: boolean
  readonly source: DataSource
  readonly memo: string | null
  readonly needsReview: boolean
  readonly dimensions: MovementDimension[]
}

export interface MovementFilter {
  readonly from?: Ymd | undefined
  readonly to?: Ymd | undefined
  readonly accountIds?: readonly string[] | undefined
  /** Cuentas de gasto/ingreso de la contrapartida, no de la pata listada. */
  readonly categoryIds?: readonly string[] | undefined
  readonly dimensionValueIds?: readonly string[] | undefined
  readonly search?: string | undefined
  /**
   * Por defecto **sí** se listan. Esconder una pata de transferencia en el
   * extracto haría que la suma de lo que se ve no dé el saldo de la cuenta, y
   * el usuario no tendría forma de saber por qué. La exclusión por defecto
   * rige en las agregaciones de gasto/ingreso (`totals`), no en el listado.
   */
  readonly includeTransfers?: boolean | undefined
  /**
   * Rango de importe, en unidades mínimas y **sobre el valor absoluto**.
   *
   * Absoluto porque la pregunta que se hace una persona es «los movimientos de
   * más de mil euros», no «los de más de mil euros positivos». Con el signo
   * dentro, «desde 100.000» dejaría fuera todos los gastos grandes, que son
   * negativos, y el filtro contestaría lo contrario de lo que se le pidió.
   */
  readonly minAmount?: bigint | undefined
  readonly maxAmount?: bigint | undefined
  /** La moneda de la pata listada. Un hogar multi-divisa lo pide el primer día. */
  readonly currency?: string | undefined
  /** Sólo los que no tienen categoría todavía. */
  readonly onlyUncategorized?: boolean | undefined
  /** De dónde entró: 'file' o 'api'. */
  readonly source?: DataSource | undefined
  /**
   * Por qué columna ordenar. Por defecto, fecha descendente.
   *
   * Es una lista cerrada y no un texto: el valor llega de la URL y concatenarlo
   * en el `order by` sería inyección. Lo que se recibe es una etiqueta y lo que
   * se ejecuta es SQL escrito acá.
   */
  readonly sort?: MovementSort | undefined
  readonly limit?: number | undefined
  readonly offset?: number | undefined
}

export type MovementSort =
  | 'fecha-desc'
  | 'fecha-asc'
  | 'importe-desc'
  | 'importe-asc'
  | 'descripcion-asc'
  | 'cuenta-asc'

const ORDEN: Readonly<Record<MovementSort, string>> = {
  // El desempate por `p.id` no es cosmético: sin un orden total, dos páginas
  // consecutivas pueden repetir una fila y saltarse otra.
  'fecha-desc': 'e.booked_on desc, e.id desc, p.ordinal, p.id',
  'fecha-asc': 'e.booked_on asc, e.id asc, p.ordinal, p.id',
  'importe-desc': 'abs(p.amount) desc, e.booked_on desc, p.id',
  'importe-asc': 'abs(p.amount) asc, e.booked_on desc, p.id',
  'descripcion-asc': 'e.description asc, e.booked_on desc, p.id',
  'cuenta-asc': 'a.name asc, e.booked_on desc, p.id',
}

export interface MovementPage {
  readonly rows: MovementRow[]
  /** Filas que cumplen el filtro, ignorando limit/offset. */
  readonly total: number
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 500

/**
 * Condición compartida por la página y por el conteo.
 *
 * Tienen que ser literalmente la misma o el paginador miente: un `total` que
 * no cuenta lo mismo que la consulta de filas produce páginas vacías al final.
 */
const MOVEMENT_WHERE = `
  a.kind in ('asset', 'liability')
  and ($1::date   is null or e.booked_on   >= $1::date)
  and ($2::date   is null or e.booked_on   <= $2::date)
  and ($3::uuid[] is null or p.account_id   = any($3::uuid[]))
  and ($6::text   is null or e.description ilike $6::text escape '\\')
  and ($7::boolean or not p.is_transfer)
  and ($4::uuid[] is null or exists (
        select 1 from posting cp
        where cp.entry_id = p.entry_id
          and cp.account_id = any($4::uuid[])))
  and ($5::uuid[] is null or exists (
        select 1
        from posting_dimension pd
        join posting sp on sp.id = pd.posting_id
        where sp.entry_id = p.entry_id
          and pd.dimension_value_id = any($5::uuid[])))
  and ($8::bigint is null or abs(p.amount) >= $8::bigint)
  and ($9::bigint is null or abs(p.amount) <= $9::bigint)
  and ($10::text  is null or trim(p.currency) = $10::text)
  and ($11::text  is null or e.source = $11::text::data_source)
  and (not $12::boolean or exists (
        select 1 from posting up
        join account ua on ua.id = up.account_id
        where up.entry_id = p.entry_id
          and ua.kind in ('expense', 'income')
          and ${sqlSinCategorizar('ua')}))
`

interface MovementQueryRow {
  entry_id: string
  posting_id: string
  booked_on: string
  description: string
  account_id: string
  account_name: string
  currency: string
  amount: string
  base_amount: string | null
  base_currency: string | null
  category_id: string | null
  category: string | null
  is_transfer: boolean
  source: DataSource
  memo: string | null
  needs_review: boolean
  dimensions: {
    dimensionId: string
    key: string
    label: string
    valueId: string
    value: string
    weightPpm: number
  }[]
}

/**
 * Listado de movimientos con paginación real.
 *
 * Un "movimiento" es la pata contra una cuenta de activo o pasivo — lo que el
 * usuario reconoce como una línea de su extracto — y su categoría es la
 * cuenta de gasto/ingreso de la contrapartida del mismo asiento.
 *
 * Cuando el asiento reparte contra varias categorías (un ticket con comida y
 * droguería) se muestra la de mayor importe. Inventar una categoría "varias"
 * sería un dato que no existe en el libro; el desglose completo está en el
 * asiento, que es donde hay que ir a buscarlo.
 *
 * Las dimensiones se toman de **todo el asiento**, no sólo de esta pata: la
 * atribución cuelga normalmente de la pata de gasto, así que un movimiento
 * que mirara sólo su propio posting saldría siempre sin dimensiones.
 */
export async function movements(
  client: TenantClient,
  filter: MovementFilter = {},
): Promise<MovementPage> {
  const limit = clampInt(filter.limit, DEFAULT_LIMIT, 1, MAX_LIMIT)
  const offset = clampInt(filter.offset, 0, 0, Number.MAX_SAFE_INTEGER)

  const params = [
    optionalYmd(filter.from, 'filter.from'),
    optionalYmd(filter.to, 'filter.to'),
    filter.accountIds === undefined ? null : [...filter.accountIds],
    filter.categoryIds === undefined ? null : [...filter.categoryIds],
    filter.dimensionValueIds === undefined ? null : [...filter.dimensionValueIds],
    likePattern(filter.search),
    filter.includeTransfers !== false,
    filter.minAmount === undefined ? null : filter.minAmount.toString(),
    filter.maxAmount === undefined ? null : filter.maxAmount.toString(),
    filter.currency === undefined || filter.currency.trim() === ''
      ? null
      : filter.currency.trim().toUpperCase(),
    filter.source ?? null,
    filter.onlyUncategorized === true,
  ]

  const page = await client.query<MovementQueryRow>(
    `select
       e.id                                    as entry_id,
       p.id::text                              as posting_id,
       to_char(e.booked_on, 'YYYY-MM-DD')      as booked_on,
       e.description,
       e.source,
       p.account_id,
       a.name                                  as account_name,
       p.currency,
       p.amount::text                          as amount,
       p.base_amount::text                     as base_amount,
       p.base_currency,
       p.memo,
       p.is_transfer,
       cat.id                                  as category_id,
       cat.name                                as category,
       exists (
         select 1 from review_item ri
         where ri.entry_id = e.id and ri.state = 'pendiente'
       )                                       as needs_review,
       dim.items                               as dimensions
     from posting p
     join entry e   on e.id = p.entry_id
     join account a on a.id = p.account_id
     left join lateral (
       select ca.id, ca.name
       from posting cp
       join account ca on ca.id = cp.account_id
       where cp.entry_id = p.entry_id
         and ca.kind in ('expense', 'income')
       order by abs(cp.amount) desc, cp.ordinal
       limit 1
     ) cat on true
     left join lateral (
       select coalesce(
                json_agg(
                  json_build_object(
                    'dimensionId', d.id,
                    'key',         d.key,
                    'label',       d.label,
                    'valueId',     dv.id,
                    'value',       dv.label,
                    'weightPpm',   x.weight_ppm
                  ) order by d.position, d.key, dv.label
                ),
                '[]'::json
              ) as items
       from (
         -- max y no sum: si dos patas del mismo asiento están atribuidas al
         -- mismo valor, sumar los pesos daría más de 1.000.000 ppm, que es
         -- imposible por definición. El peso por pata vive en el asiento.
         select pd.dimension_id, pd.dimension_value_id, max(pd.weight_ppm) as weight_ppm
         from posting_dimension pd
         join posting sp on sp.id = pd.posting_id
         where sp.entry_id = p.entry_id
         group by pd.dimension_id, pd.dimension_value_id
       ) x
       join dimension d        on d.id  = x.dimension_id
       join dimension_value dv on dv.id = x.dimension_value_id
     ) dim on true
     where ${MOVEMENT_WHERE}
     order by ${ORDEN[filter.sort ?? 'fecha-desc']}
     limit $13 offset $14`,
    [...params, limit, offset],
  )

  // Conteo aparte y no window function: con limit/offset, `count(*) over ()`
  // se calcula sobre la página, no sobre el filtro.
  const counted = await client.query<{ total: number }>(
    `select count(*)::int as total
     from posting p
     join entry e   on e.id = p.entry_id
     join account a on a.id = p.account_id
     where ${MOVEMENT_WHERE}`,
    params,
  )

  return {
    rows: page.rows.map((row) => ({
      entryId: row.entry_id,
      postingId: row.posting_id,
      bookedOn: row.booked_on,
      description: row.description,
      accountId: row.account_id,
      accountName: row.account_name,
      currency: row.currency,
      amount: toBigInt(row.amount),
      baseAmount: toBigIntOrNull(row.base_amount),
      baseCurrency: row.base_currency,
      categoryId: row.category_id,
      category: row.category,
      isTransfer: row.is_transfer,
      source: row.source,
      memo: row.memo,
      needsReview: row.needs_review,
      dimensions: row.dimensions ?? [],
    })),
    total: toCount(counted.rows[0]?.total ?? 0),
  }
}

// ── Reconciliación ──────────────────────────────────────────────────────────

export type ReconciliationStatus = 'cuadra' | 'delta' | 'sin-declarar' | 'incompleto'

export interface ReconciliationRow {
  readonly accountId: string
  readonly accountName: string
  readonly currency: string
  /** Saldo declarado ANTERIOR al período. Null si el banco no lo dio. */
  readonly opening: bigint | null
  readonly openingOn: Ymd | null
  /** Movimientos desde el día siguiente a la apertura hasta el cierre. */
  readonly movements: bigint
  /**
   * Apertura + movimientos. **Null cuando no hay apertura declarada**: sin un
   * punto de partida, la suma de los movimientos del período es la variación,
   * no el saldo. Devolverla como si fuera el saldo calculado es exactamente el
   * número que después alguien compara contra su extracto.
   */
  readonly closingCalculated: bigint | null
  /** Saldo declarado DENTRO del período. */
  readonly declared: bigint | null
  readonly declaredOn: Ymd | null
  readonly delta: bigint | null
  /** Movimientos del período en otra moneda, que no se pudieron sumar. */
  readonly foreignPostings: number
  readonly status: ReconciliationStatus
}

interface ReconciliationQueryRow {
  account_id: string
  account_name: string
  currency: string
  opening: string | null
  opening_on: string | null
  declared: string | null
  declared_on: string | null
  movements: string
  foreign_postings: number
}

/**
 * El bloque de confianza: ¿lo que dice el banco coincide con lo que tenemos?
 *
 * Dos decisiones sostienen que esta comprobación signifique algo:
 *
 *  1. **La apertura sale de un saldo declarado, nunca de restar movimientos.**
 *     Derivarla daría delta cero siempre y la comprobación sería una
 *     tautología: estaríamos comparando el sistema consigo mismo.
 *
 *  2. **Los movimientos se suman desde el día siguiente al saldo de apertura,
 *     no desde `from`.** Si el extracto de apertura es del 25 de febrero y el
 *     período arranca el 1 de marzo, los movimientos del medio forman parte de
 *     la diferencia entre esos dos saldos declarados. Omitirlos convierte un
 *     descuadre real en un cuadre falso, que es el peor resultado posible acá.
 *     Por lo mismo, si el extracto de cierre es del 28 y el período termina el
 *     31, se corta en el 28: comparar contra movimientos que el banco todavía
 *     no vio inventa un delta que no existe.
 *
 * Sin apertura declarada o sin cierre declarado el estado es 'sin-declarar' y
 * el delta es null. Nunca 'cuadra': no cuadra nada que no se haya comprobado.
 * Y si algún movimiento del período está en otra moneda, la suma no está
 * completa: el estado es 'incompleto' y tampoco hay delta. Un cuadre calculado
 * sobre una suma a la que le faltan movimientos es peor que no dar ninguno.
 */
export async function reconciliation(
  client: TenantClient,
  period: { from: Ymd; to: Ymd },
): Promise<ReconciliationRow[]> {
  assertPeriod(period, 'period')
  const { rows } = await client.query<ReconciliationQueryRow>(
    `select
       a.id                               as account_id,
       a.name                             as account_name,
       a.currency,
       o.amount::text                     as opening,
       to_char(o.as_of, 'YYYY-MM-DD')     as opening_on,
       c.amount::text                     as declared,
       to_char(c.as_of, 'YYYY-MM-DD')     as declared_on,
       m.total                            as movements,
       m.foreign_postings
     from account a
     left join lateral (
       select db.amount, db.as_of
       from declared_balance db
       where db.account_id = a.id
         and db.currency = a.currency
         and db.as_of < $1::date
       order by db.as_of desc
       limit 1
     ) o on true
     left join lateral (
       select db.amount, db.as_of
       from declared_balance db
       where db.account_id = a.id
         and db.currency = a.currency
         and db.as_of >= $1::date
         and db.as_of <= $2::date
       order by db.as_of desc
       limit 1
     ) c on true
     left join lateral (
       select
         coalesce(sum(p.amount) filter (where p.currency = a.currency), 0)::text as total,
         (count(*) filter (where p.currency <> a.currency))::int as foreign_postings
       from posting p
       join entry e on e.id = p.entry_id
       where p.account_id = a.id
         and e.booked_on >  coalesce(o.as_of, $1::date - 1)
         and e.booked_on <= coalesce(c.as_of, $2::date)
     ) m on true
     where a.kind in ('asset', 'liability')
     order by a.name`,
    [period.from, period.to],
  )

  return rows.map((row) => {
    const opening = toBigIntOrNull(row.opening)
    const declared = toBigIntOrNull(row.declared)
    const movementsTotal = toBigInt(row.movements)
    const foreignPostings = toCount(row.foreign_postings)
    const complete = opening !== null && foreignPostings === 0
    const closingCalculated = complete ? opening + movementsTotal : null
    const delta =
      closingCalculated === null || declared === null ? null : closingCalculated - declared

    const status: ReconciliationStatus =
      foreignPostings > 0
        ? 'incompleto'
        : delta === null
          ? 'sin-declarar'
          : delta === 0n
            ? 'cuadra'
            : 'delta'

    return {
      accountId: row.account_id,
      accountName: row.account_name,
      currency: row.currency,
      opening,
      openingOn: row.opening_on,
      movements: movementsTotal,
      closingCalculated,
      declared,
      declaredOn: row.declared_on,
      delta,
      foreignPostings,
      status,
    }
  })
}

// ── Totales del período ─────────────────────────────────────────────────────

export interface UnconvertedLane {
  readonly currency: string
  readonly income: bigint
  readonly expense: bigint
  readonly postings: number
}

export interface PeriodTotals {
  readonly income: bigint
  readonly expense: bigint
  readonly net: bigint
  readonly currency: string
  readonly transactions: number
  /** Postings del período que no se pudieron llevar a `currency`. */
  readonly unconverted: number
  readonly unconvertedByCurrency: UnconvertedLane[]
}

/**
 * Postings de gasto e ingreso del período, ya convertidos o marcados como no
 * convertibles.
 *
 * `base_currency` se compara de verdad en vez de dar por hecho que
 * `base_amount` está en la moneda de reporte. Un hogar que cambió su moneda de
 * consolidación tiene base_amount congelados en la anterior, y tomarlos como
 * si fueran de la nueva sumaría euros con dólares sin que nada avise.
 */
const FLOW_CTE = `
  with flow as (
    select
      p.entry_id,
      a.kind,
      p.currency,
      p.amount,
      coalesce(
        case when p.base_currency = $3::char(3) then p.base_amount end,
        case when p.currency      = $3::char(3) then p.amount      end
      ) as converted
    from posting p
    join account a on a.id = p.account_id
    join entry e   on e.id = p.entry_id
    where a.kind in ('expense', 'income')
      and not p.is_transfer
      and e.booked_on >= $1::date
      and e.booked_on <= $2::date
  )
`

/**
 * Gasto, ingreso y neto del período en la moneda de reporte.
 *
 * El signo se normaliza para la lectura: en partida doble un ingreso es un
 * posting negativo contra una cuenta 'income', así que se invierte para que
 * "cobré 2.500" se muestre como 2.500 y no como -2.500. El gasto ya es
 * positivo contra una cuenta 'expense' y se deja como está.
 *
 * `transactions` cuenta los asientos del período **con movimiento de gasto o
 * ingreso**, incluidos aquellos cuyos postings no se pudieron convertir:
 * existieron igual, y no contarlos haría que el número de operaciones tampoco
 * cuadre. Los traspasos y los asientos de apertura no son operaciones acá.
 */
export async function totals(
  client: TenantClient,
  period: { from: Ymd; to: Ymd; currency: string },
): Promise<PeriodTotals> {
  assertPeriod(period, 'period')
  const currency = assertCurrency(period.currency, 'period.currency')
  const params = [period.from, period.to, currency]

  const summary = await client.query<{
    income: string
    expense: string
    transactions: number
    unconverted: number
  }>(
    `${FLOW_CTE}
     select
       (-coalesce(sum(converted) filter (where kind = 'income'), 0))::bigint::text  as income,
       coalesce(sum(converted) filter (where kind = 'expense'), 0)::bigint::text    as expense,
       count(distinct entry_id)::int                                               as transactions,
       count(*) filter (where converted is null)::int                              as unconverted
     from flow`,
    params,
  )

  const pending = await client.query<{
    currency: string
    income: string
    expense: string
    postings: number
  }>(
    `${FLOW_CTE}
     select
       currency,
       (-coalesce(sum(amount) filter (where kind = 'income'), 0))::bigint::text  as income,
       coalesce(sum(amount) filter (where kind = 'expense'), 0)::bigint::text    as expense,
       count(*)::int                                                            as postings
     from flow
     where converted is null
     group by currency
     order by currency`,
    params,
  )

  const row = summary.rows[0]
  const income = toBigInt(row?.income ?? '0')
  const expense = toBigInt(row?.expense ?? '0')

  return {
    income,
    expense,
    net: income - expense,
    currency,
    transactions: toCount(row?.transactions ?? 0),
    unconverted: toCount(row?.unconverted ?? 0),
    unconvertedByCurrency: pending.rows.map((lane) => ({
      currency: lane.currency,
      income: toBigInt(lane.income),
      expense: toBigInt(lane.expense),
      postings: toCount(lane.postings),
    })),
  }
}

// ── Árbol de categorías ─────────────────────────────────────────────────────

export interface CategoryNode {
  readonly id: string
  readonly name: string
  readonly kind: 'expense' | 'income'
  readonly parentId: string | null
  /** "Casa > Servicios > Luz". */
  readonly path: string
  readonly depth: number
  /**
   * No se pudo resolver su camino —hay un ciclo en `parent_id` o cuelga a más
   * de 16 niveles— y se devuelve como raíz suelta. Una categoría con gasto
   * dentro que desaparece del árbol es plata que no aparece en ningún sitio.
   */
  readonly detached: boolean
}

/**
 * Las categorías no son una tabla aparte: son las cuentas de gasto e ingreso
 * con su jerarquía por parent_id. Que sean cuentas es lo que permite que un
 * gasto categorizado siga siendo un asiento que balancea.
 *
 * El límite de profundidad no es cosmético: `parent_id` no impide un ciclo
 * (A hijo de B, B hijo de A), y un ciclo en un CTE recursivo no da error —
 * gira hasta que salta el statement_timeout y la pantalla queda colgada.
 *
 * Pero cortar la recursión no alcanza. En un ciclo ninguna de las cuentas es
 * raíz, así que la parte recursiva **nunca las alcanza y desaparecían del
 * árbol enteras**, con todo el gasto que cuelga de ellas. Por eso el segundo
 * brazo: lo que el recorrido no alcanzó se devuelve igual, como raíz y
 * marcado `detached`. Preferimos un árbol raro a un árbol incompleto que se
 * ve bien.
 */
export async function categoryTree(client: TenantClient): Promise<CategoryNode[]> {
  const { rows } = await client.query<{
    id: string
    name: string
    kind: 'expense' | 'income'
    parent_id: string | null
    path: string
    depth: number
    detached: boolean
  }>(
    `with recursive tree as (
       select a.id, a.name, a.kind, a.parent_id, a.name::text as path, 0 as depth,
              array[a.id] as trail
       from account a
       where a.kind in ('expense', 'income')
         and (
           a.parent_id is null
           or not exists (
             select 1 from account p
             where p.id = a.parent_id and p.kind in ('expense', 'income')
           )
         )
       union all
       select c.id, c.name, c.kind, c.parent_id, t.path || ' > ' || c.name, t.depth + 1,
              t.trail || c.id
       from account c
       join tree t on t.id = c.parent_id
       where c.kind in ('expense', 'income')
         and t.depth < 16
         and not c.id = any(t.trail)
     )
     select id, name, kind, parent_id, path, depth, false as detached
     from tree
     union all
     select a.id, a.name, a.kind, a.parent_id, a.name::text, 0, true
     from account a
     where a.kind in ('expense', 'income')
       and not exists (select 1 from tree t where t.id = a.id)
     order by detached, path`,
  )

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    parentId: row.parent_id,
    path: row.path,
    depth: toCount(row.depth),
    detached: row.detached,
  }))
}
