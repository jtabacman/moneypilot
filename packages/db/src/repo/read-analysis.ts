/**
 * Capa de lectura analítica: las consultas que alimentan los informes.
 *
 * Tres reglas gobiernan todo el módulo y explican casi cada decisión rara:
 *
 *  1. **Lo que no se pudo convertir se declara.** Un posting sin `base_amount`
 *     en la moneda de reporte no se suma y no se ignora: se cuenta y se
 *     devuelve en `unconverted`. Un total que esconde diez movimientos en
 *     libras es un total falso, y el usuario no tiene forma de saberlo.
 *  2. **Las transferencias internas no son ni gasto ni ingreso.** Mover plata
 *     de la cuenta corriente al ahorro no empobrece a nadie; contarlo como
 *     gasto duplica el gasto del mes.
 *  3. **Los importes nunca pasan por `number`.** Postgres devuelve `bigint`
 *     como string y acá se convierte con `BigInt`. Los únicos `number` que
 *     salen de este módulo son conteos, días y porcentajes.
 *
 * Nada de esto crea conexiones: toda función recibe un `TenantClient` que ya
 * está dentro de una transacción con `app.tenant_id` fijado, así que RLS es
 * quien decide qué filas existen. Por eso ninguna consulta lleva
 * `where tenant_id = ...`: si lo llevara, sería una segunda barrera que puede
 * discrepar de la primera.
 */

import {
  addDays,
  allocate,
  currencyCode,
  daysInMonth,
  descriptionTokens,
  differenceInDays,
  money,
  normalizeDescription,
  type PlainDate,
  parsePlainDate,
  plainDate,
} from '@moneypilot/core'
import type { TenantClient } from '../client.js'

// ── Piezas compartidas ──────────────────────────────────────────────────────

/**
 * Importe del posting en la moneda de reporte, o NULL si no se pudo convertir.
 *
 * El `base_currency` se comprueba a propósito. `base_amount` está CONGELADO a
 * la fecha del asiento junto con la moneda en que se congeló; si el hogar
 * cambió de moneda de reporte, ese importe es un número correcto de otra
 * pregunta. Sumarlo daría un total que parece bueno y no lo es, así que ese
 * posting cuenta como no convertido, que es la verdad.
 *
 * `param` es el número de parámetro posicional ($1, $2...) que lleva la moneda:
 * lo que se interpola es el placeholder, nunca el valor.
 */
function convertedAmount(param: number): string {
  return `coalesce(
    case when p.base_currency = $${param} then p.base_amount end,
    case when p.currency = $${param} then p.amount end
  )`
}

// Ninguna consulta filtra `entry.reversed_by`, y es deliberado. Anular acá es
// append-only: se crea un asiento nuevo con los postings invertidos y el
// original queda marcado. Los dos suman cero. Filtrar sólo el anulado dejaría
// dentro su contrapartida y el informe mostraría el gasto en negativo.

function assertRange(from: string, to: string): { from: PlainDate; to: PlainDate } {
  const desde = parsePlainDate(from)
  const hasta = parsePlainDate(to)
  if (desde > hasta) {
    throw new RangeError(`El rango está al revés: ${desde} es posterior a ${hasta}`)
  }
  return { from: desde, to: hasta }
}

/**
 * Clave de agrupación por comercio, y la etiqueta con la que mostrarlo.
 *
 * Se calcula en TypeScript y no en SQL porque la normalización canónica vive
 * en core: escribirla otra vez en SQL garantiza que las dos versiones se
 * separen en la primera corrección, y entonces el dedup del importador y el
 * informe de comercios verían comercios distintos para el mismo descriptor.
 *
 * `descriptionTokens` ya quita el ruido que impide agrupar —referencias,
 * números de autorización, fechas embebidas—, que es justo lo que convierte
 * "NETFLIX REF 8812" y "NETFLIX REF 9903" en un solo comercio.
 *
 * La clave ORDENA los tokens y la etiqueta no. Son dos cosas distintas y
 * mezclarlas cuesta caro: `descriptionTokens` devuelve un conjunto, así que
 * "ZARA ESPANA" y "ESPANA ZARA" son el mismo comercio, pero unirlos en el
 * orden en que aparecen da dos claves y el comercio se parte en dos filas. Al
 * revés también molesta: mostrar "ESPANA ZARA" porque el alfabeto lo puso
 * primero le deja al usuario un nombre que no reconoce en su extracto.
 */
interface Merchant {
  readonly key: string
  readonly label: string
}

function merchantKey(description: string): Merchant {
  const tokens = [...descriptionTokens(description)]
  if (tokens.length > 0) {
    return { key: [...tokens].sort().join(' '), label: tokens.join(' ') }
  }
  // Descriptor hecho sólo de ruido y palabras vacías: mejor agrupar por el
  // texto normalizado que meter comercios distintos en el mismo cajón.
  const normalized = normalizeDescription(description)
  const fallback = normalized === '' ? 'SIN DESCRIPCION' : normalized
  return { key: fallback, label: fallback }
}

/**
 * Mediana sobre enteros, sin pasar por coma flotante.
 *
 * Con número par de elementos el medio céntimo se redondea alejándose del
 * cero: es la convención bancaria y evita que la mediana de dos importes
 * iguales y opuestos dependa del orden.
 */
function medianBigint(values: readonly bigint[]): bigint {
  if (values.length === 0) throw new RangeError('La mediana necesita al menos un valor')
  const sorted = [...values].sort((a, b) => (a === b ? 0 : a < b ? -1 : 1))
  const middle = sorted.length >> 1
  if (sorted.length % 2 === 1) return sorted[middle] as bigint
  const lower = sorted[middle - 1] as bigint
  const upper = sorted[middle] as bigint
  const total = lower + upper
  const half = total / 2n
  const rest = total % 2n
  if (rest === 0n) return half
  return total > 0n ? half + 1n : half - 1n
}

function monthKey(date: PlainDate): string {
  return date.slice(0, 7)
}

/** Lista de meses 'YYYY-MM' de `from` a `to`, ambos incluidos. */
function monthsBetween(from: PlainDate, to: PlainDate): string[] {
  const last = monthKey(to)
  const months: string[] = []
  let year = Number(from.slice(0, 4))
  let month = Number(from.slice(5, 7))
  while (`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}` <= last) {
    months.push(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`)
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return months
}

/** Resta meses de calendario recortando el día al último del mes destino. */
function monthsBefore(date: PlainDate, months: number): PlainDate {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  const day = Number(date.slice(8, 10))
  const index = year * 12 + (month - 1) - months
  const targetYear = Math.floor(index / 12)
  const targetMonth = (((index % 12) + 12) % 12) + 1
  return plainDate(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)))
}

// ── Gasto por categoría y mes ───────────────────────────────────────────────

export interface SpendByCategoryMonthOptions {
  readonly from: string
  readonly to: string
  readonly currency: string
  /** Niveles de la jerarquía de cuentas a conservar. 1 = categoría raíz. */
  readonly depth?: number
}

export interface SpendByCategoryMonthRow {
  /** 'YYYY-MM'. */
  readonly month: string
  readonly categoryId: string
  readonly category: string
  readonly amount: bigint
  /** Postings de ese mes y categoría que no se pudieron convertir. */
  readonly unconverted: number
}

interface CategoryRow {
  month: string
  category_id: string
  category: string
  amount: string
  unconverted: number
}

/**
 * Gasto agrupado por categoría y mes.
 *
 * La "categoría" es la cuenta de gasto plegada hasta `depth` niveles desde la
 * raíz: con depth 1, 'Gastos:Casa:Luz' cuenta bajo 'Gastos'; con depth 2, bajo
 * 'Gastos:Casa'. Cuando la rama es más corta que `depth`, se usa la cuenta tal
 * cual — plegar de menos es preferible a inventar un nivel que no existe.
 */
export async function spendByCategoryMonth(
  client: TenantClient,
  options: SpendByCategoryMonthOptions,
): Promise<SpendByCategoryMonthRow[]> {
  const { from, to } = assertRange(options.from, options.to)
  const currency = currencyCode(options.currency)
  const depth = options.depth ?? 1
  if (!Number.isInteger(depth) || depth < 1) {
    throw new RangeError(`depth tiene que ser un entero >= 1, no ${String(options.depth)}`)
  }

  const converted = convertedAmount(1)
  const { rows } = await client.query<CategoryRow>(
    `with recursive chain as (
       select a.id as leaf, a.id as node, a.parent_id, a.name, 1 as height
         from account a
        where a.kind = 'expense'
       union all
       select c.leaf, parent.id, parent.parent_id, parent.name, c.height + 1
         from chain c
         join account parent on parent.id = c.parent_id
        -- Tope de seguridad: un parent_id en ciclo colgaría la consulta entera
        -- y ninguna jerarquía de categorías real llega a doce niveles.
        where c.height < 12
     ),
     ranked as (
       select leaf, node, name,
              row_number() over (partition by leaf order by height desc) as from_root
         from chain
     ),
     category as (
       select distinct on (leaf) leaf, node as category_id, name as category
         from ranked
        where from_root <= $4
        order by leaf, from_root desc
     )
     select to_char(e.booked_on, 'YYYY-MM')            as month,
            c.category_id                              as category_id,
            c.category                                 as category,
            coalesce(sum(${converted}), 0)::bigint     as amount,
            count(*) filter (where ${converted} is null)::int as unconverted
       from posting p
       join entry e   on e.id = p.entry_id
       join account a on a.id = p.account_id
       join category c on c.leaf = a.id
      where a.kind = 'expense'
        and not p.is_transfer
        and e.booked_on between $2::date and $3::date
      group by 1, 2, 3
      order by 1 asc, 4 desc, 3 asc`,
    [currency, from, to, depth],
  )

  return rows.map((row) => ({
    month: row.month,
    categoryId: row.category_id,
    category: row.category,
    amount: BigInt(row.amount),
    unconverted: row.unconverted,
  }))
}

// ── Gasto por dimensión ─────────────────────────────────────────────────────

export interface SpendByDimensionOptions {
  readonly dimensionKey: string
  readonly from: string
  readonly to: string
  readonly currency: string
}

export interface SpendByDimensionRow {
  readonly valueId: string
  readonly label: string
  readonly parentId: string | null
  readonly amount: bigint
  readonly transactions: number
  /** Postings atribuidos a este valor que no se pudieron convertir. */
  readonly unconverted: number
  /**
   * Postings cuyos pesos sumaban más del 100% y hubo que reescalar.
   *
   * El importe de esas filas es una interpretación, no un dato: hay que poder
   * decirlo. Ver el comentario del reparto.
   */
  readonly overAttributed: number
}

interface DimensionRow {
  posting_id: string
  entry_id: string
  value_id: string
  weight_ppm: number
  label: string
  parent_id: string | null
  amount: string | null
}

/**
 * "¿Cuánto me cuesta la casa de Madrid?" — gasto por valor de una dimensión.
 *
 * El reparto por peso se hace acá y no en SQL por una razón concreta: un
 * posting de 10,00 € al 33,3333% / 33,3333% / 33,3334% da tres partes que en
 * aritmética entera suman 999 céntimos, y el céntimo que falta tiene que ir a
 * alguna parte de forma determinista. `allocate` reparte por resto mayor y
 * garantiza que las partes sumen exactamente el total; `sum(amount * w / 1e6)`
 * en SQL, no.
 *
 * Cuando los pesos de un posting no llegan al millón (sólo se atribuyó el 70%,
 * por ejemplo), el 30% restante entra en el reparto como una parte que se
 * descarta. Así la porción no atribuida no se le regala a nadie.
 *
 * Devuelve los valores tal como están atribuidos, sin plegar la jerarquía: el
 * `parentId` viaja en cada fila para que quien la muestre decida si suma
 * "Obra" dentro de "Casa Madrid" o los enseña por separado.
 */
export async function spendByDimension(
  client: TenantClient,
  options: SpendByDimensionOptions,
): Promise<SpendByDimensionRow[]> {
  const { from, to } = assertRange(options.from, options.to)
  const currency = currencyCode(options.currency)

  const converted = convertedAmount(1)
  const { rows } = await client.query<DimensionRow>(
    `select p.id                    as posting_id,
            p.entry_id              as entry_id,
            pd.dimension_value_id   as value_id,
            pd.weight_ppm           as weight_ppm,
            dv.label                as label,
            dv.parent_id            as parent_id,
            ${converted}            as amount
       from posting p
       join entry e            on e.id = p.entry_id
       join account a          on a.id = p.account_id
       join posting_dimension pd on pd.posting_id = p.id
       join dimension d        on d.id = pd.dimension_id
       join dimension_value dv on dv.id = pd.dimension_value_id
      where d.key = $2
        and a.kind = 'expense'
        and not p.is_transfer
        and e.booked_on between $3::date and $4::date
      order by p.id, pd.dimension_value_id`,
    [currency, options.dimensionKey, from, to],
  )

  interface Bucket {
    label: string
    parentId: string | null
    amount: bigint
    entries: Set<string>
    unconverted: number
    overAttributed: number
  }
  const buckets = new Map<string, Bucket>()
  const bucketFor = (row: DimensionRow): Bucket => {
    const found = buckets.get(row.value_id)
    if (found !== undefined) return found
    const fresh: Bucket = {
      label: row.label,
      parentId: row.parent_id,
      amount: 0n,
      entries: new Set<string>(),
      unconverted: 0,
      overAttributed: 0,
    }
    buckets.set(row.value_id, fresh)
    return fresh
  }

  // Las filas vienen ordenadas por posting, así que el grupo se cierra solo.
  let group: DimensionRow[] = []
  const flush = (): void => {
    if (group.length === 0) return
    const first = group[0] as DimensionRow
    if (first.amount === null) {
      for (const row of group) {
        const bucket = bucketFor(row)
        bucket.unconverted += 1
        bucket.entries.add(row.entry_id)
      }
      group = []
      return
    }

    const weights = group.map((row) => row.weight_ppm)
    const assigned = weights.reduce((acc, w) => acc + w, 0)
    // El resto no atribuido participa del reparto y después se tira: si no
    // estuviera, el 70% atribuido se llevaría el 100% del importe.
    const withRest = assigned < 1_000_000 ? [...weights, 1_000_000 - assigned] : weights
    // Los pesos pueden pasar del millón: la base limita cada uno a 1.000.000
    // pero no su suma, y atribuir un gasto 100% a "Casa Madrid" y 100% a su
    // hija "Obra" es algo que un usuario hace sin pensarlo. Reescalar es mejor
    // que repartir más plata de la que se gastó, pero el importe resultante
    // deja de ser un dato y pasa a ser una interpretación nuestra, así que se
    // cuenta y se devuelve. Un 1.000 € que aparece como 500 + 500 sin decir
    // por qué es exactamente el total falso que este módulo no quiere emitir.
    const rescaled = assigned > 1_000_000
    const parts = allocate(money(BigInt(first.amount), currency), withRest)

    for (const [index, row] of group.entries()) {
      const bucket = bucketFor(row)
      bucket.amount += (parts[index] as { amount: bigint }).amount
      bucket.entries.add(row.entry_id)
      if (rescaled) bucket.overAttributed += 1
    }
    group = []
  }

  for (const row of rows) {
    const previous = group[0]
    if (previous !== undefined && previous.posting_id !== row.posting_id) flush()
    group.push(row)
  }
  flush()

  return [...buckets.entries()]
    .map(([valueId, bucket]) => ({
      valueId,
      label: bucket.label,
      parentId: bucket.parentId,
      amount: bucket.amount,
      transactions: bucket.entries.size,
      unconverted: bucket.unconverted,
      overAttributed: bucket.overAttributed,
    }))
    .sort((a, b) =>
      a.amount === b.amount ? a.label.localeCompare(b.label) : a.amount > b.amount ? -1 : 1,
    )
}

// ── Pareto de comercios ─────────────────────────────────────────────────────

export interface TopMerchantsOptions {
  readonly from: string
  readonly to: string
  readonly currency: string
  readonly limit: number
}

export interface TopMerchantRow {
  readonly merchant: string
  readonly amount: bigint
  readonly transactions: number
  /** Fracción ACUMULADA de `totalSpend`, 0..1. Ver la advertencia de abajo. */
  readonly share: number
  readonly unconverted: number
}

export interface TopMerchantsResult {
  readonly rows: TopMerchantRow[]
  /**
   * Gasto convertido del período: el denominador REAL de `share`.
   *
   * No es "el gasto del período" si `unconverted` no es cero, y por eso viaja
   * junto a él.
   */
  readonly totalSpend: bigint
  /**
   * Postings del período que no se pudieron convertir, estén sus comercios
   * dentro del top o fuera.
   */
  readonly unconverted: number
  /** Comercios que existen en el período y que `limit` dejó fuera. */
  readonly truncated: number
}

interface MerchantQueryRow {
  entry_id: string
  description: string
  amount: string | null
}

/**
 * Top de comercios con acumulado de Pareto.
 *
 * `share` es acumulado y se calcula sobre el gasto total del período, no sobre
 * el de los comercios devueltos: la frase que el informe quiere poder decir es
 * "estos diez son el 63% de tu gasto", y con el denominador recortado por
 * `limit` el último siempre daría 100%.
 *
 * El resumen del período no es decoración. `share` es una fracción del gasto
 * que se PUDO convertir, y sola no se distingue de una fracción del gasto real:
 * un hogar con la mitad de sus movimientos en libras vería "este comercio es el
 * 90% de tu gasto" y sería mentira. Además, un comercio cuyos postings no se
 * pudieron convertir ni uno vale cero y se hunde al fondo del orden, así que es
 * lo PRIMERO que `limit` recorta — justo la señal de que el total está
 * incompleto es la que se perdería. Por eso `unconverted` se cuenta sobre todo
 * el período y no sólo sobre las filas devueltas.
 */
export async function topMerchants(
  client: TenantClient,
  options: TopMerchantsOptions,
): Promise<TopMerchantsResult> {
  const { from, to } = assertRange(options.from, options.to)
  const currency = currencyCode(options.currency)
  if (!Number.isInteger(options.limit) || options.limit < 1) {
    throw new RangeError(`limit tiene que ser un entero >= 1, no ${String(options.limit)}`)
  }

  const converted = convertedAmount(1)
  const { rows } = await client.query<MerchantQueryRow>(
    `select e.id          as entry_id,
            e.description as description,
            ${converted}  as amount
       from posting p
       join entry e   on e.id = p.entry_id
       join account a on a.id = p.account_id
      where a.kind = 'expense'
        and not p.is_transfer
        and e.booked_on between $2::date and $3::date
      -- Ordenar por fecha fija la etiqueta del comercio al descriptor más
      -- viejo. Sin esto, dos descriptores del mismo comercio devuelven el
      -- nombre que el planificador quiera y el informe cambia entre llamadas.
      order by e.booked_on, e.id`,
    [currency, from, to],
  )

  interface Bucket {
    label: string
    amount: bigint
    entries: Set<string>
    unconverted: number
  }
  const buckets = new Map<string, Bucket>()
  let total = 0n
  let unconverted = 0
  for (const row of rows) {
    const { key, label } = merchantKey(row.description)
    const bucket = buckets.get(key) ?? {
      label,
      amount: 0n,
      entries: new Set<string>(),
      unconverted: 0,
    }
    if (row.amount === null) {
      bucket.unconverted += 1
      unconverted += 1
    } else {
      const value = BigInt(row.amount)
      bucket.amount += value
      total += value
    }
    bucket.entries.add(row.entry_id)
    buckets.set(key, bucket)
  }

  const ordered = [...buckets.entries()].sort(([leftKey, left], [rightKey, right]) =>
    left.amount === right.amount
      ? leftKey.localeCompare(rightKey)
      : left.amount > right.amount
        ? -1
        : 1,
  )

  const rowsOut: TopMerchantRow[] = []
  let cumulative = 0n
  for (const [, bucket] of ordered.slice(0, options.limit)) {
    cumulative += bucket.amount
    rowsOut.push({
      merchant: bucket.label,
      amount: bucket.amount,
      transactions: bucket.entries.size,
      // El único float del módulo, y es una fracción para dibujar una curva:
      // el acumulado en sí se lleva en bigint hasta el último momento.
      share: total === 0n ? 0 : Number(cumulative) / Number(total),
      unconverted: bucket.unconverted,
    })
  }
  return {
    rows: rowsOut,
    totalSpend: total,
    unconverted,
    truncated: Math.max(0, ordered.length - rowsOut.length),
  }
}

// ── Recurrentes ─────────────────────────────────────────────────────────────

export type RecurringState = 'activo' | 'subio' | 'no-cobro' | 'huerfano'

export interface RecurringOptions {
  readonly asOf: string
  /** Historia a mirar hacia atrás. Por debajo de 6 no hay serie que valga. */
  readonly lookbackMonths?: number
}

export interface RecurringRow {
  readonly merchant: string
  readonly accountId: string
  readonly accountName: string
  /** Moneda de FACTURACIÓN. Nunca convertida: ver el comentario de abajo. */
  readonly currency: string
  readonly current: bigint
  /** Mediana de las ocurrencias ANTERIORES: es la referencia del cargo actual. */
  readonly median: bigint
  readonly deltaPct: number | null
  readonly frequencyDays: number
  readonly occurrences: number
  readonly lastOn: string
  readonly nextExpectedOn: string
  readonly state: RecurringState
  /** Confirmado con 3 ocurrencias o más; con 2, apenas probable. */
  readonly confidence: 'confirmado' | 'probable'
  readonly history: readonly bigint[]
}

interface ChargeRow {
  entry_id: string
  booked_on: string
  description: string
  account_id: string
  account_name: string
  amount: string
  currency: string
  attributed: boolean
}

/** Δ mínimo para avisar de una subida, en porcentaje. */
const RISE_MIN_PCT = 5n
/**
 * Piso absoluto, en unidades mínimas de la moneda de facturación.
 *
 * Sin él, un café que pasa de 0,05 a 0,07 es una "subida del 40%". Tres falsos
 * positivos seguidos y el usuario apaga las notificaciones para siempre, que
 * es el modo de fallo que mata a esta clase de producto.
 */
const RISE_MIN_ABSOLUTE = 100n

/**
 * Obligaciones recurrentes detectadas sobre los cargos de las cuentas.
 *
 * Se mira el lado del PAGO (cuentas de activo y pasivo, importe negativo) y no
 * el de la categoría de gasto: lo que el usuario quiere ver es "Netflix, Visa
 * Oro, 12,99 el día 5", y la cuenta y la moneda de ese cargo sólo existen del
 * lado del pago. Las patas de una transferencia interna quedan fuera: mover
 * plata al ahorro todos los meses es regular, pero no es una obligación.
 *
 * Los importes van en la moneda de facturación original —`native_amount`
 * cuando el origen la trae, si no la de la cuenta— y NUNCA convertidos. Una
 * suscripción de 9,99 USD cobrada a una tarjeta en euros cambia de importe
 * todos los meses sin que nadie haya subido nada: comparar la versión
 * convertida es fabricar subidas de precio que no ocurrieron.
 */
export async function recurring(
  client: TenantClient,
  options: RecurringOptions,
): Promise<RecurringRow[]> {
  const asOf = parsePlainDate(options.asOf)
  const lookback = options.lookbackMonths ?? 12
  if (!Number.isInteger(lookback) || lookback < 1) {
    throw new RangeError(
      `lookbackMonths tiene que ser un entero >= 1, no ${String(options.lookbackMonths)}`,
    )
  }
  const from = monthsBefore(asOf, lookback)

  const { rows } = await client.query<ChargeRow>(
    `select e.id                                     as entry_id,
            to_char(e.booked_on, 'YYYY-MM-DD')       as booked_on,
            e.description                            as description,
            p.account_id                             as account_id,
            a.name                                   as account_name,
            coalesce(p.native_amount, p.amount)      as amount,
            coalesce(p.native_currency, p.currency)  as currency,
            -- La atribución se mira sobre el ASIENTO entero y no sobre esta
            -- pata: quien etiqueta un gasto lo etiqueta del lado del gasto,
            -- no del lado de la tarjeta con la que lo pagó.
            exists (
              select 1
                from posting_dimension pd
                join posting q on q.id = pd.posting_id
               where q.entry_id = e.id
            )                                        as attributed
       from posting p
       join entry e   on e.id = p.entry_id
       join account a on a.id = p.account_id
      where a.kind in ('asset', 'liability')
        and not p.is_transfer
        and p.amount < 0
        and e.booked_on between $1::date and $2::date
      order by e.booked_on, p.id`,
    [from, asOf],
  )

  interface Series {
    merchant: string
    accountId: string
    accountName: string
    currency: string
    dates: PlainDate[]
    amounts: bigint[]
    attributed: boolean
    /** Comercio + cuenta, sin la moneda. Ver `lastCharge`. */
    timelineKey: string
  }
  const series = new Map<string, Series>()
  // Último cargo del comercio en esa cuenta, en CUALQUIER moneda de
  // facturación. La serie se parte por moneda a propósito —comparar precios
  // entre monedas fabrica subidas— pero "¿me lo siguen cobrando?" no es una
  // pregunta sobre la moneda. Si el origen deja de traer `native_currency` a
  // mitad de la historia, la serie se corta en dos y la mitad vieja parecería
  // impagada: avisaríamos de una baja que no ocurrió, que es el falso positivo
  // más caro de todos porque el usuario va a comprobarlo y no habrá nada.
  const lastCharge = new Map<string, PlainDate>()
  for (const row of rows) {
    const { key: merchant, label } = merchantKey(row.description)
    const timelineKey = JSON.stringify([merchant, row.account_id])
    const key = JSON.stringify([merchant, row.account_id, row.currency])
    const found = series.get(key)
    const bucket: Series = found ?? {
      merchant: label,
      accountId: row.account_id,
      accountName: row.account_name,
      currency: row.currency,
      dates: [],
      amounts: [],
      attributed: false,
      timelineKey,
    }
    const date = parsePlainDate(row.booked_on)
    bucket.dates.push(date)
    // Los cargos se guardan en positivo: la serie se lee como precio, y
    // "subió de 9,99 a 12,99" con signo negativo se lee al revés.
    bucket.amounts.push(-BigInt(row.amount))
    bucket.attributed = bucket.attributed || row.attributed
    if (found === undefined) series.set(key, bucket)
    const seen = lastCharge.get(timelineKey)
    if (seen === undefined || date > seen) lastCharge.set(timelineKey, date)
  }

  const out: RecurringRow[] = []
  for (const bucket of series.values()) {
    const occurrences = bucket.amounts.length
    // Una sola aparición no es una serie: sin un segundo cargo no hay ni
    // frecuencia que estimar ni precio anterior contra el que comparar.
    if (occurrences < 2) continue

    const lastOn = bucket.dates[occurrences - 1] as PlainDate
    const current = bucket.amounts[occurrences - 1] as bigint
    const previous = bucket.amounts.slice(0, -1)
    const median = medianBigint(previous)

    const gaps = bucket.dates
      .slice(1)
      .map((date, index) => BigInt(differenceInDays(bucket.dates[index] as PlainDate, date)))
    // Piso de un día: dos cargos el mismo día darían frecuencia cero y todo
    // retraso posterior se leería como "no cobró".
    const frequencyDays = Math.max(1, Number(medianBigint(gaps)))

    const rise =
      // Sólo series de importe FIJO. En una serie variable —el súper, la
      // nafta— cualquier mes caro dispararía la alerta, y la alerta que se
      // dispara siempre no la lee nadie.
      previous.length >= 2 &&
      previous.every((value) => value === (previous[0] as bigint)) &&
      current > median &&
      // Comparación entera: el porcentaje que se muestra es un float, pero la
      // decisión de avisar no puede depender de un redondeo.
      (current - median) * 100n > median * RISE_MIN_PCT &&
      current - median >= RISE_MIN_ABSOLUTE

    // `lastOn` es el último cargo EN ESTA MONEDA y es lo que se muestra; el
    // corte de "dejó de cobrarse" mira el último cargo en cualquiera.
    const daysSinceLast = differenceInDays(lastCharge.get(bucket.timelineKey) ?? lastOn, asOf)
    const missing = daysSinceLast * 2 > frequencyDays * 3

    // Precedencia: primero lo que pasó (dejó de cobrarse), después lo que
    // cambió (subió), después lo que falta (nadie lo reclama).
    const state: RecurringState = missing
      ? 'no-cobro'
      : rise
        ? 'subio'
        : bucket.attributed
          ? 'activo'
          : 'huerfano'

    out.push({
      merchant: bucket.merchant,
      accountId: bucket.accountId,
      accountName: bucket.accountName,
      currency: bucket.currency,
      current,
      median,
      deltaPct:
        median === 0n
          ? null
          : Math.round((Number(current - median) / Number(median)) * 10_000) / 100,
      frequencyDays,
      occurrences,
      lastOn,
      nextExpectedOn: addDays(lastOn, frequencyDays),
      state,
      confidence: occurrences >= 3 ? 'confirmado' : 'probable',
      history: bucket.amounts,
    })
  }

  return out.sort((a, b) =>
    a.current === b.current ? a.merchant.localeCompare(b.merchant) : a.current > b.current ? -1 : 1,
  )
}

// ── Patrimonio ──────────────────────────────────────────────────────────────

export interface NetWorthSeriesOptions {
  readonly from: string
  readonly to: string
  readonly currency: string
}

export interface NetWorthPoint {
  readonly month: string
  readonly assets: bigint
  /** En positivo: es deuda, no un activo con signo. */
  readonly liabilities: bigint
  readonly net: bigint
  /** Postings acumulados hasta ese mes que no se pudieron convertir. */
  readonly unconverted: number
}

interface BalanceBucketRow {
  bucket: string
  assets: string
  liabilities: string
  unconverted: number
}

/**
 * Serie mensual de patrimonio neto.
 *
 * El patrimonio es un stock, no un flujo: el punto de marzo es el saldo de
 * TODA la historia hasta el 31 de marzo, no el movimiento de marzo. Por eso la
 * consulta no filtra por `from` — lo anterior al rango se acumula en un cubo
 * de apertura y arrastra desde ahí.
 *
 * Las transferencias internas SÍ cuentan acá: mover plata entre dos cuentas
 * propias no cambia el patrimonio, y como cambia las dos cuentas a la vez, la
 * suma sola se encarga. Excluirlas descuadraría los saldos.
 */
export async function netWorthSeries(
  client: TenantClient,
  options: NetWorthSeriesOptions,
): Promise<NetWorthPoint[]> {
  const { from, to } = assertRange(options.from, options.to)
  const currency = currencyCode(options.currency)

  const converted = convertedAmount(1)
  const { rows } = await client.query<BalanceBucketRow>(
    `select case when e.booked_on < $2::date then '0000-00'
                 else to_char(e.booked_on, 'YYYY-MM') end          as bucket,
            coalesce(sum(${converted}) filter (where a.kind = 'asset'), 0)::bigint     as assets,
            coalesce(sum(${converted}) filter (where a.kind = 'liability'), 0)::bigint as liabilities,
            count(*) filter (where ${converted} is null)::int                          as unconverted
       from posting p
       join entry e   on e.id = p.entry_id
       join account a on a.id = p.account_id
      where a.kind in ('asset', 'liability')
        and e.booked_on <= $3::date
      group by 1`,
    [currency, from, to],
  )

  const byBucket = new Map<string, BalanceBucketRow>()
  for (const row of rows) byBucket.set(row.bucket, row)

  const opening = byBucket.get('0000-00')
  let assets = opening === undefined ? 0n : BigInt(opening.assets)
  let liabilities = opening === undefined ? 0n : BigInt(opening.liabilities)
  let unconverted = opening?.unconverted ?? 0

  const points: NetWorthPoint[] = []
  for (const month of monthsBetween(from, to)) {
    const row = byBucket.get(month)
    if (row !== undefined) {
      assets += BigInt(row.assets)
      liabilities += BigInt(row.liabilities)
      unconverted += row.unconverted
    }
    points.push({
      month,
      assets,
      // Los pasivos viven en negativo en partida doble; se muestran en
      // positivo por la misma razón que los ingresos: nadie lee "deuda -1.200".
      liabilities: -liabilities,
      net: assets + liabilities,
      unconverted,
    })
  }
  return points
}

export interface NetWorthAttributionOptions {
  readonly from: string
  readonly to: string
  readonly currency: string
}

export interface NetWorthAttribution {
  readonly opening: bigint
  readonly contributions: bigint
  /** En positivo: en el waterfall es la barra que baja. */
  readonly spending: bigint
  readonly assetRevaluation: bigint
  readonly fxEffect: bigint
  readonly closing: bigint
  readonly unconverted: number
  /** false = todavía no hay cuentas de revaluación FX, no "el efecto fue cero". */
  readonly fxModelled: boolean
}

interface AttributionRow {
  opening: string
  closing: string
  contributions: string
  spending: string
  fx_effect: string
  unconverted: number
}

/** Prefijo de las cuentas donde vive la revaluación cambiaria (método Selinger). */
const FX_ACCOUNT_PREFIX = 'Equity:FX-Revaluation'

/**
 * Waterfall de variación patrimonial: las seis barras del informe.
 *
 * `assetRevaluation` es un RESIDUO declarado, y conviene saberlo: es todo lo
 * que movió el patrimonio y no fue ingreso, gasto ni efecto cambiario —
 * revaluaciones de activos, sí, pero también asientos de apertura. Se calcula
 * así a propósito: si cada barra se computara por su lado, la suma no daría el
 * saldo final y el usuario vería un waterfall que no cierra, que es la peor
 * forma posible de mostrar una cuenta.
 *
 * `fxEffect` sale de las cuentas `Equity:FX-Revaluation:*`. Si el hogar todavía
 * no las tiene, se devuelve `fxModelled: false` en vez de un cero: un cero en
 * esa barra se lee como "no hubo efecto cambiario", y la verdad es "nadie lo
 * calculó todavía".
 */
export async function netWorthAttribution(
  client: TenantClient,
  options: NetWorthAttributionOptions,
): Promise<NetWorthAttribution> {
  const { from, to } = assertRange(options.from, options.to)
  const currency = currencyCode(options.currency)

  const converted = convertedAmount(1)
  const { rows } = await client.query<AttributionRow>(
    `with base as (
       select p.id                as posting_id,
              a.kind              as kind,
              a.name              as name,
              e.booked_on         as booked_on,
              p.is_transfer       as is_transfer,
              ${converted}        as amount
         from posting p
         join entry e   on e.id = p.entry_id
         join account a on a.id = p.account_id
        where (a.kind in ('asset', 'liability') and e.booked_on <= $3::date)
           or (a.kind in ('income', 'expense', 'equity', 'trading')
               and e.booked_on between $2::date and $3::date)
     )
     select
       coalesce(sum(amount) filter (
         where kind in ('asset', 'liability') and booked_on < $2::date), 0)::bigint  as opening,
       coalesce(sum(amount) filter (
         where kind in ('asset', 'liability')), 0)::bigint                           as closing,
       -- Los ingresos son postings negativos: se invierte el signo para que un
       -- ingreso se lea como una barra que sube.
       coalesce(-sum(amount) filter (
         where kind = 'income' and not is_transfer
           and booked_on >= $2::date), 0)::bigint                                    as contributions,
       coalesce(sum(amount) filter (
         where kind = 'expense' and not is_transfer
           and booked_on >= $2::date), 0)::bigint                                    as spending,
       coalesce(-sum(amount) filter (
         where kind = 'equity' and name like $4
           and booked_on >= $2::date), 0)::bigint                                    as fx_effect,
       count(*) filter (where amount is null)::int                                   as unconverted
     from base`,
    [currency, from, to, `${FX_ACCOUNT_PREFIX}%`],
  )

  const { rows: fxRows } = await client.query<{ modelled: boolean }>(
    'select exists (select 1 from account where name like $1) as modelled',
    [`${FX_ACCOUNT_PREFIX}%`],
  )
  const fxModelled = fxRows[0]?.modelled === true

  const row = rows[0]
  if (row === undefined) {
    throw new Error('La consulta de atribución patrimonial no devolvió ninguna fila')
  }

  const opening = BigInt(row.opening)
  const closing = BigInt(row.closing)
  const contributions = BigInt(row.contributions)
  const spending = BigInt(row.spending)
  const fxEffect = fxModelled ? BigInt(row.fx_effect) : 0n

  return {
    opening,
    contributions,
    spending,
    assetRevaluation: closing - opening - contributions + spending - fxEffect,
    fxEffect,
    closing,
    unconverted: row.unconverted,
    fxModelled,
  }
}

// ── Cola de revisión ────────────────────────────────────────────────────────

export type ReviewState = 'pendiente' | 'aceptado' | 'rechazado'

export interface ReviewQueueOptions {
  readonly state?: ReviewState
  readonly limit?: number
}

export interface ReviewRow {
  readonly id: string
  readonly kind: string
  readonly state: ReviewState
  readonly entryId: string | null
  readonly description: string | null
  /** 'YYYY-MM-DD'. */
  readonly bookedOn: string | null
  /** En la moneda de la cuenta del cargo, sin convertir. */
  readonly amount: bigint | null
  readonly currency: string | null
  readonly accountName: string | null
  readonly evidence: Record<string, unknown>
  /** ISO-8601 en UTC. */
  readonly createdAt: string
}

interface ReviewQueryRow {
  id: string
  kind: string
  state: ReviewState
  entry_id: string | null
  description: string | null
  booked_on: string | null
  amount: string | null
  currency: string | null
  account_name: string | null
  evidence: Record<string, unknown> | null
  created_at: string
}

/**
 * La cola de revisión humana, que es donde termina todo lo que el sistema no
 * quiso decidir solo.
 *
 * De cada asiento se trae UN posting para poder mostrar "de cuánto y de qué
 * cuenta": el del lado del dinero (activo o pasivo) y, entre varios, el de
 * mayor importe. Sin eso, la fila de la cola no dice nada accionable.
 */
export async function reviewQueue(
  client: TenantClient,
  options: ReviewQueueOptions = {},
): Promise<ReviewRow[]> {
  const limit = options.limit ?? 100
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`limit tiene que ser un entero >= 1, no ${String(options.limit)}`)
  }

  const { rows } = await client.query<ReviewQueryRow>(
    `select r.id                              as id,
            r.kind::text                      as kind,
            r.state::text                     as state,
            r.entry_id                        as entry_id,
            e.description                     as description,
            to_char(e.booked_on, 'YYYY-MM-DD') as booked_on,
            m.amount                          as amount,
            m.currency                        as currency,
            m.account_name                    as account_name,
            r.evidence                        as evidence,
            to_char(r.created_at at time zone 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
       from review_item r
       left join entry e on e.id = r.entry_id
       left join lateral (
         select p.amount, p.currency, a.name as account_name
           from posting p
           join account a on a.id = p.account_id
          where p.entry_id = e.id
          order by (a.kind in ('asset', 'liability')) desc, abs(p.amount) desc, p.ordinal
          limit 1
       ) m on true
      where $1::review_state is null or r.state = $1::review_state
      order by r.created_at desc, r.id
      limit $2`,
    [options.state ?? null, limit],
  )

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    state: row.state,
    entryId: row.entry_id,
    description: row.description,
    bookedOn: row.booked_on,
    amount: row.amount === null ? null : BigInt(row.amount),
    currency: row.currency,
    accountName: row.account_name,
    evidence: row.evidence ?? {},
    createdAt: row.created_at,
  }))
}

// ── Dimensiones ─────────────────────────────────────────────────────────────

export interface DimensionValueSummary {
  readonly id: string
  readonly label: string
  readonly parentId: string | null
  /** ISO-8601 en UTC, o null si el valor sigue vivo. */
  readonly archivedAt: string | null
  /** Cuántos postings tienen atribución a este valor. */
  readonly usage: number
}

export interface DimensionSummary {
  readonly id: string
  readonly key: string
  readonly label: string
  readonly position: number
  readonly values: DimensionValueSummary[]
}

interface DimensionQueryRow {
  dimension_id: string
  key: string
  dimension_label: string
  position: number
  value_id: string | null
  value_label: string | null
  parent_id: string | null
  archived_at: string | null
  usage: number
}

/**
 * Las dimensiones del hogar con sus valores y cuánto se usa cada uno.
 *
 * Los valores archivados se devuelven igual, con su `archivedAt`: ocultarlos
 * acá dejaría al usuario sin poder ver que un valor con 300 postings detrás
 * sigue existiendo en su historia aunque ya no se ofrezca para etiquetar.
 */
export async function dimensionsWithValues(client: TenantClient): Promise<DimensionSummary[]> {
  const { rows } = await client.query<DimensionQueryRow>(
    `select d.id       as dimension_id,
            d.key      as key,
            d.label    as dimension_label,
            d.position as position,
            v.id       as value_id,
            v.label    as value_label,
            v.parent_id as parent_id,
            to_char(v.archived_at at time zone 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as archived_at,
            coalesce(u.usage_count, 0)::int          as usage
       from dimension d
       left join dimension_value v on v.dimension_id = d.id
       left join lateral (
         select count(*) as usage_count
           from posting_dimension pd
          where pd.dimension_value_id = v.id
       ) u on true
      order by d.position, d.key, v.label`,
  )

  const dimensions = new Map<string, DimensionSummary>()
  const order: string[] = []
  for (const row of rows) {
    let dimension = dimensions.get(row.dimension_id)
    if (dimension === undefined) {
      dimension = {
        id: row.dimension_id,
        key: row.key,
        label: row.dimension_label,
        position: row.position,
        values: [],
      }
      dimensions.set(row.dimension_id, dimension)
      order.push(row.dimension_id)
    }
    if (row.value_id !== null) {
      dimension.values.push({
        id: row.value_id,
        label: row.value_label ?? '',
        parentId: row.parent_id,
        archivedAt: row.archived_at,
        usage: row.usage,
      })
    }
  }
  return order.map((id) => dimensions.get(id) as DimensionSummary)
}
