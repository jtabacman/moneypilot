/**
 * El objeto "reporte" (IR): el catálogo de medidas, dimensiones y filtros del
 * día 1, y las funciones que lo escriben, lo leen en voz alta y lo traducen a
 * una URL de movimientos.
 *
 * Vive en su propio módulo, y no dentro del constructor, porque el
 * constructor es apenas una de las cinco cosas que producen este objeto. El
 * mismo IR **es** el reporte guardado, la URL que se comparte, el payload del
 * drill-down, el parámetro del PDF programado y la herramienta que invoca el
 * asistente. Si su forma viviera dentro de un componente de interfaz, cada
 * uno de esos cinco consumidores acabaría con su propia versión ligeramente
 * distinta, y el enlace compartido dejaría de significar lo mismo que el PDF.
 *
 * Nada de acá toca la base ni importa `server-only`: lo usan tanto la página
 * del catálogo (servidor) como el constructor (cliente).
 */

import { formatDate } from '@/lib/format'

/* ── Medidas: las 12 del catálogo del día 1 ──────────────────────────────── */

export interface MeasureDef {
  readonly id: string
  readonly label: string
  /** Qué cuenta y qué deja fuera. Sale al lado del selector, no en un tooltip. */
  readonly hint: string
  /** Un stock se mide a una fecha; un flujo, sobre un período. Cambia la frase. */
  readonly shape: 'flujo' | 'stock' | 'conteo'
}

export const MEASURES: readonly MeasureDef[] = [
  {
    id: 'gasto_neto',
    label: 'Gasto neto',
    hint: 'Gasto menos devoluciones y reembolsos. Las transferencias internas nunca cuentan.',
    shape: 'flujo',
  },
  {
    id: 'gasto_bruto',
    label: 'Gasto bruto',
    hint: 'Todo lo que salió, sin restar devoluciones. Sirve para negociar con un proveedor.',
    shape: 'flujo',
  },
  {
    id: 'ingreso',
    label: 'Ingreso',
    hint: 'Nómina, alquileres, honorarios y distribuciones.',
    shape: 'flujo',
  },
  {
    id: 'flujo_neto',
    label: 'Flujo neto',
    hint: 'Ingreso menos gasto del período.',
    shape: 'flujo',
  },
  {
    id: 'saldo',
    label: 'Saldo',
    hint: 'El saldo de las cuentas al cierre del período.',
    shape: 'stock',
  },
  {
    id: 'saldo_proyectado',
    label: 'Saldo proyectado',
    hint: 'Saldo más las obligaciones e ingresos esperados. Depende del motor de recurrentes.',
    shape: 'stock',
  },
  {
    id: 'patrimonio_neto',
    label: 'Patrimonio neto',
    hint: 'Activos menos pasivos. Las transferencias internas sí cuentan: no cambian el total.',
    shape: 'stock',
  },
  {
    id: 'variacion_patrimonio',
    label: 'Variación de patrimonio',
    hint: 'Diferencia entre el patrimonio de apertura y el de cierre.',
    shape: 'flujo',
  },
  {
    id: 'efecto_fx',
    label: 'Efecto FX',
    hint: 'La parte de la variación que explica el tipo de cambio, no el dinero.',
    shape: 'flujo',
  },
  {
    id: 'obligacion_recurrente',
    label: 'Obligación recurrente mensualizada',
    hint: 'Cada serie detectada llevada a su equivalente mensual, en su moneda de facturación.',
    shape: 'flujo',
  },
  {
    id: 'n_transacciones',
    label: 'Nº de transacciones',
    hint: 'Cuántas operaciones, no cuánto dinero.',
    shape: 'conteo',
  },
  {
    id: 'ticket_promedio',
    label: 'Ticket promedio',
    hint: 'Importe medio por operación. Con menos de cinco operaciones no dice nada.',
    shape: 'flujo',
  },
]

export function measure(id: string): MeasureDef | undefined {
  return MEASURES.find((m) => m.id === id)
}

/* ── Dimensiones: las 14 del catálogo del día 1 ──────────────────────────── */

export interface GrainDef {
  readonly id: string
  readonly label: string
}

export interface DimensionDef {
  readonly id: string
  readonly label: string
  /**
   * De dónde salen sus valores.
   *  - `fecha`     el eje temporal, con grano.
   *  - `hogar`     una dimensión del hogar (propiedad, entidad, persona…).
   *  - `cuenta`    el plan de cuentas de banco y tarjeta.
   *  - `categoria` las cuentas de gasto e ingreso.
   *  - `atributo`  algo que ya viaja en el movimiento (moneda, país, institución).
   *  - `texto`     texto libre del movimiento: comercio, etiquetas.
   */
  readonly source: 'fecha' | 'hogar' | 'cuenta' | 'categoria' | 'atributo' | 'texto'
  /** Clave de la dimensión del hogar. Sólo cuando `source` es 'hogar'. */
  readonly key?: string
  readonly grains?: readonly GrainDef[]
  readonly levels?: readonly GrainDef[]
  /**
   * Por qué este campo todavía no se puede resolver, si es el caso.
   *
   * Va escrito acá y no en un `TODO`: si un campo del catálogo no existe en el
   * libro, el constructor lo tiene que decir en la cara del usuario antes de
   * que arme una pregunta que nunca va a poder responderse.
   */
  readonly missing?: string
}

export const DIMENSIONS: readonly DimensionDef[] = [
  {
    id: 'fecha',
    label: 'Fecha',
    source: 'fecha',
    grains: [
      { id: 'day', label: 'día' },
      { id: 'week', label: 'semana' },
      { id: 'month', label: 'mes' },
      { id: 'quarter', label: 'trimestre' },
      { id: 'year', label: 'año' },
    ],
  },
  { id: 'cuenta', label: 'Cuenta', source: 'cuenta' },
  { id: 'institucion', label: 'Institución', source: 'atributo' },
  { id: 'entidad', label: 'Entidad legal', source: 'hogar', key: 'entidad' },
  {
    id: 'propiedad',
    label: 'Propiedad',
    source: 'hogar',
    key: 'propiedad',
    levels: [
      { id: 'propiedad', label: 'la propiedad entera' },
      { id: 'area', label: 'por área: obra, servicios, personal, impuestos, seguros' },
    ],
  },
  { id: 'persona', label: 'Persona', source: 'hogar', key: 'persona' },
  { id: 'proyecto', label: 'Proyecto', source: 'hogar', key: 'proyecto' },
  { id: 'viaje', label: 'Viaje', source: 'hogar', key: 'viaje' },
  {
    id: 'categoria',
    label: 'Categoría',
    source: 'categoria',
    levels: [
      { id: 'root', label: 'sólo la raíz' },
      { id: 'leaf', label: 'hasta la hoja' },
    ],
  },
  { id: 'comercio', label: 'Comercio o proveedor', source: 'texto' },
  { id: 'moneda', label: 'Moneda original', source: 'atributo' },
  { id: 'pais', label: 'País', source: 'atributo' },
  {
    id: 'metodo_pago',
    label: 'Método de pago',
    source: 'atributo',
    missing: 'El libro todavía no guarda el método de pago del movimiento.',
  },
  {
    id: 'tag',
    label: 'Etiqueta libre',
    source: 'texto',
    missing: 'Las etiquetas libres todavía no existen en el modelo de datos.',
  },
]

export function dimension(id: string): DimensionDef | undefined {
  return DIMENSIONS.find((d) => d.id === id)
}

/* ── Filtros: los 9 tipos del catálogo ───────────────────────────────────── */

export interface OperatorDef {
  readonly id: string
  readonly label: string
  /** Qué control necesita el valor. */
  readonly input: 'valores' | 'texto' | 'importe' | 'ninguno'
}

export const OPERATORS: readonly OperatorDef[] = [
  { id: 'one_of', label: 'es uno de', input: 'valores' },
  { id: 'not_one_of', label: 'no es ninguno de', input: 'valores' },
  { id: 'contains', label: 'contiene', input: 'texto' },
  { id: 'not_contains', label: 'no contiene', input: 'texto' },
  { id: 'gte', label: 'de al menos', input: 'importe' },
  { id: 'lte', label: 'de como mucho', input: 'importe' },
  { id: 'is_null', label: 'está sin asignar', input: 'ninguno' },
  { id: 'not_null', label: 'está asignado', input: 'ninguno' },
]

/** Qué operadores acepta cada campo. Un campo de texto no tiene "uno de". */
export function operatorsFor(field: string): readonly OperatorDef[] {
  if (field === 'importe') return OPERATORS.filter((o) => o.input === 'importe')
  if (field === 'adjunto' || field === 'origen') {
    return OPERATORS.filter((o) => o.id === 'one_of' || o.id === 'not_one_of')
  }
  const def = dimension(field)
  if (def === undefined) return OPERATORS
  if (def.source === 'texto') {
    return OPERATORS.filter((o) => o.input === 'texto' || o.input === 'ninguno')
  }
  return OPERATORS.filter((o) => o.input === 'valores' || o.input === 'ninguno')
}

/**
 * Campos que se pueden filtrar y no son dimensiones: los tres últimos tipos de
 * filtro del catálogo. Se filtra por ellos, pero no se agrupa: "el gasto por
 * tiene-adjunto" no es una pregunta que nadie haga.
 */
export const EXTRA_FILTER_FIELDS: readonly { id: string; label: string }[] = [
  { id: 'importe', label: 'Importe (en moneda de reporte)' },
  { id: 'adjunto', label: 'Adjunto' },
  { id: 'origen', label: 'Origen del dato' },
]

export const ADJUNTO_VALUES: readonly { id: string; label: string }[] = [
  { id: 'con_adjunto', label: 'con adjunto' },
  { id: 'sin_adjunto', label: 'sin adjunto' },
]

export const ORIGEN_VALUES: readonly { id: string; label: string }[] = [
  { id: 'api', label: 'conexión bancaria' },
  { id: 'file', label: 'extracto importado' },
  { id: 'pdf', label: 'PDF' },
  { id: 'manual', label: 'cargado a mano' },
]

/* ── Comparaciones y gráficos ────────────────────────────────────────────── */

export const COMPARISONS: readonly { id: string; label: string }[] = [
  { id: 'none', label: 'sin comparación' },
  { id: 'previous_period', label: 'el período anterior' },
  { id: 'same_period_last_year', label: 'el mismo período del año anterior' },
  { id: 'average_n_periods', label: 'el promedio de N períodos' },
  { id: 'budget', label: 'el presupuesto' },
]

export interface VizDef {
  readonly id: string
  readonly label: string
  readonly hint: string
}

/**
 * Los siete gráficos del día 1. No están el treemap, el heatmap de calendario,
 * la torta ni el gauge, y el Sankey es material de marketing: la tabla los gana
 * en todos los casos donde alguien tiene que decidir algo con el número.
 */
export const VIZ: readonly VizDef[] = [
  {
    id: 'table',
    label: 'Tabla',
    hint: 'La más usada y la menos citada. Todo gráfico lleva la suya debajo.',
  },
  {
    id: 'time_series',
    label: 'Serie temporal',
    hint: 'El default correcto para mirar una tendencia.',
  },
  { id: 'stacked_bar', label: 'Barras apiladas', hint: 'Mix por categoría a lo largo del tiempo.' },
  { id: 'bullet', label: 'Presupuesto vs. real', hint: 'Lo primero que mira quien administra.' },
  {
    id: 'waterfall',
    label: 'Waterfall de variación',
    hint: 'Donde vive la atribución del efecto FX.',
  },
  {
    id: 'projection',
    label: 'Proyección con banda',
    hint: 'Un carril por moneda, sin consolidar.',
  },
  {
    id: 'pareto',
    label: 'Pareto de proveedores',
    hint: '"El 20% de tus proveedores es el 63% del gasto".',
  },
]

/* ── El estado del constructor ───────────────────────────────────────────── */

export interface SelectedDimension {
  readonly field: string
  readonly grain?: string
  readonly level?: string
}

export interface FilterRow {
  readonly id: string
  readonly field: string
  readonly operator: string
  readonly values: readonly string[]
  readonly text: string
  /**
   * Cómo se une con la fila anterior. 'and' es el nivel 2 del builder; 'or'
   * agrupa filas consecutivas y es la puerta al árbol anidado del nivel 3.
   */
  readonly join: 'and' | 'or'
}

export type RangeSelection =
  | { readonly kind: 'relative'; readonly id: string }
  | { readonly kind: 'absolute'; readonly from: string; readonly to: string }

export interface BuilderState {
  readonly name: string
  readonly measure: string
  readonly dimensions: readonly SelectedDimension[]
  readonly range: RangeSelection
  readonly filters: readonly FilterRow[]
  readonly compare: string
  readonly averageN: number
  readonly viz: string
  readonly topN: number
  readonly others: boolean
  readonly excludeTransfers: boolean
}

/** Un rango relativo ya resuelto a fechas por el servidor. */
export interface ResolvedRange {
  readonly id: string
  readonly label: string
  readonly from: string
  readonly to: string
}

export interface Option {
  readonly id: string
  readonly label: string
}

/**
 * Todo lo que el constructor necesita saber del hogar para armar el IR.
 *
 * Sale entero del servidor y viaja como props: ids y textos, ningún bigint.
 * Los importes no cruzan al cliente porque el constructor no calcula dinero —
 * compone una pregunta.
 */
export interface BuilderContext {
  readonly tenantId: string
  readonly userId: string
  readonly reportCurrency: string
  readonly flowPolicy: string
  readonly stockPolicy: string
  readonly ranges: readonly ResolvedRange[]
  /** Valores por campo, ya filtrados a lo que este hogar tiene de verdad. */
  readonly values: Readonly<Record<string, readonly Option[]>>
  /** Campos del catálogo que este hogar no puede resolver, con el motivo. */
  readonly unavailable: Readonly<Record<string, string>>
}

export function resolveRange(
  state: BuilderState,
  ctx: BuilderContext,
): { from: string; to: string } {
  const range = state.range
  if (range.kind === 'absolute') return { from: range.from, to: range.to }
  const id = range.id
  const found = ctx.ranges.find((r) => r.id === id)
  return found === undefined
    ? { from: ctx.ranges[0]?.from ?? '', to: ctx.ranges[0]?.to ?? '' }
    : { from: found.from, to: found.to }
}

/* ── El IR ───────────────────────────────────────────────────────────────── */

export interface IrDimension {
  readonly field: string
  readonly grain?: string
  readonly level?: string
}

export type IrFilterNode =
  | { readonly op: 'and' | 'or'; readonly children: readonly IrFilterNode[] }
  | { readonly field: string; readonly operator: string; readonly value?: unknown }

export interface Ir {
  /** Null hasta que se guarde: no hay tabla de reportes todavía. */
  readonly id: string | null
  readonly version: number
  readonly tenant_id: string
  readonly name: string
  readonly measures: readonly string[]
  readonly dimensions: readonly IrDimension[]
  readonly filter: IrFilterNode
  readonly compare: { readonly type: string; readonly periods?: number } | null
  readonly currency: {
    readonly report: string
    readonly flow_policy: string
    readonly stock_policy: string
  }
  readonly exclusions: readonly string[]
  readonly sensitivity_policy: string
  readonly sort: readonly { readonly field: string; readonly dir: 'asc' | 'desc' }[]
  readonly limit: { readonly top_n: number; readonly others: boolean }
  readonly viz: { readonly type: string; readonly secondary: string; readonly drill: boolean }
  readonly sharing: { readonly mode: string }
  readonly schedule: null
  readonly created_by: string
  /** Se sella al guardar. Ponerle la hora del navegador sería inventar un dato. */
  readonly updated_at: string | null
}

const IMPORTE_RE = /^-?\d{1,15}(?:[.,]\d{1,6})?$/

/**
 * Normaliza el importe escrito a mano a decimal canónico, **como texto**.
 *
 * No pasa por `Number`. Este valor viaja dentro del IR, y el IR es el reporte
 * guardado, el enlace que se comparte y el parámetro del PDF: un importe que
 * en algún punto de esa cadena fue coma flotante vuelve como 1234,5599999 y
 * el filtro deja de significar lo que el usuario escribió. Devuelve `null`
 * cuando lo escrito todavía no es un importe, para que la fila no entre en el
 * árbol a medio escribir.
 */
export function importeCanonico(texto: string): string | null {
  const limpio = texto.trim().replace(/\s/g, '')
  if (!IMPORTE_RE.test(limpio)) return null
  return limpio.replace(',', '.')
}

function filterLeaf(row: FilterRow): IrFilterNode | null {
  const op = OPERATORS.find((o) => o.id === row.operator)
  if (op === undefined) return null
  if (op.input === 'ninguno') return { field: row.field, operator: row.operator }
  if (op.input === 'valores') {
    if (row.values.length === 0) return null
    return { field: row.field, operator: row.operator, value: [...row.values] }
  }
  if (row.text.trim() === '') return null
  if (op.input === 'importe') {
    const amount = importeCanonico(row.text)
    if (amount === null) return null
    return { field: row.field, operator: row.operator, value: amount }
  }
  return { field: row.field, operator: row.operator, value: row.text.trim() }
}

/**
 * Arma el árbol de filtros: AND entre campos, OR dentro de cada uno.
 *
 * Las filas marcadas con 'o' se agrupan con la anterior en un nodo `or`. Es la
 * única forma de anidamiento que ofrece el nivel 2, y alcanza para el 90% de
 * las preguntas sin que nadie vea un operador booleano.
 */
function buildFilterTree(state: BuilderState, range: { from: string; to: string }): IrFilterNode {
  const groups: IrFilterNode[][] = []
  for (const row of state.filters) {
    const leaf = filterLeaf(row)
    if (leaf === null) continue
    const last = groups[groups.length - 1]
    if (row.join === 'or' && last !== undefined) last.push(leaf)
    else groups.push([leaf])
  }

  const children: IrFilterNode[] = groups.map((group) => {
    const first = group[0]
    if (group.length === 1 && first !== undefined) return first
    return { op: 'or', children: group }
  })

  children.push(
    state.range.kind === 'relative'
      ? { field: 'fecha', operator: 'relative_range', value: state.range.id }
      : { field: 'fecha', operator: 'absolute_range', value: { from: range.from, to: range.to } },
  )

  return { op: 'and', children }
}

export function buildIr(state: BuilderState, ctx: BuilderContext): Ir {
  const range = resolveRange(state, ctx)
  const compare =
    state.compare === 'none'
      ? null
      : state.compare === 'average_n_periods'
        ? { type: state.compare, periods: state.averageN }
        : { type: state.compare }

  return {
    id: null,
    version: 0,
    tenant_id: ctx.tenantId,
    name: state.name.trim() === '' ? 'Sin nombre' : state.name.trim(),
    measures: [state.measure],
    dimensions: state.dimensions.map((d) => ({
      field: d.field,
      ...(d.grain === undefined ? {} : { grain: d.grain }),
      ...(d.level === undefined ? {} : { level: d.level }),
    })),
    filter: buildFilterTree(state, range),
    compare,
    currency: {
      report: ctx.reportCurrency,
      flow_policy: ctx.flowPolicy,
      stock_policy: ctx.stockPolicy,
    },
    exclusions: state.excludeTransfers ? ['internal_transfers'] : [],
    sensitivity_policy: 'declare_hidden',
    sort: [{ field: state.measure, dir: 'desc' }],
    limit: { top_n: state.topN, others: state.others },
    viz: { type: state.viz, secondary: 'table', drill: true },
    sharing: { mode: 'private' },
    schedule: null,
    created_by: ctx.userId,
    updated_at: null,
  }
}

/* ── La pregunta en castellano ───────────────────────────────────────────── */

function labelOf(field: string, id: string, ctx: BuilderContext): string {
  const options = ctx.values[field]
  return options?.find((o) => o.id === id)?.label ?? id
}

function describeFilter(row: FilterRow, ctx: BuilderContext): string | null {
  const op = OPERATORS.find((o) => o.id === row.operator)
  if (op === undefined) return null
  const fieldLabel = (
    dimension(row.field)?.label ??
    EXTRA_FILTER_FIELDS.find((f) => f.id === row.field)?.label ??
    row.field
  )
    // El paréntesis aclara en el selector y estorba en la oración.
    .replace(/\s*\(.*\)$/, '')
    .toLowerCase()

  if (op.input === 'ninguno') return `${fieldLabel} ${op.label}`
  if (op.input === 'valores') {
    if (row.values.length === 0) return null
    const names = row.values.map((v) => labelOf(row.field, v, ctx))
    const primero = names[0]
    if (names.length === 1 && primero !== undefined) {
      return `${fieldLabel} ${row.operator === 'one_of' ? 'es' : 'no es'} ${primero}`
    }
    const list =
      names.length <= 3
        ? names.join(', ')
        : `${names.slice(0, 3).join(', ')} y ${names.length - 3} más`
    return `${fieldLabel} ${op.label} ${list}`
  }
  if (row.text.trim() === '') return null
  if (op.input === 'importe') {
    // La frase y el IR tienen que decir lo mismo. Si lo escrito todavía no es
    // un importe, `filterLeaf` no lo pone en el árbol; narrarlo igual dejaría
    // al usuario leyendo una condición que el objeto no lleva.
    const amount = importeCanonico(row.text)
    if (amount === null) return null
    return `${fieldLabel} ${op.label} ${amount.replace('.', ',')} ${ctx.reportCurrency}`
  }
  return `${fieldLabel} ${op.label} ${row.text.trim()}`
}

/**
 * La pregunta escrita como la diría el usuario.
 *
 * Es la comprobación que hace que el constructor no sea un mini-BI: si la
 * oración no se entiende leída en voz alta, la pregunta tampoco.
 */
export function describe(state: BuilderState, ctx: BuilderContext): string {
  const m = measure(state.measure)
  const parts: string[] = [m?.label ?? state.measure]

  if (state.dimensions.length > 0) {
    const dims = state.dimensions.map((d) => {
      const def = dimension(d.field)
      const base = (def?.label ?? d.field).toLowerCase()
      if (d.field === 'fecha' && d.grain !== undefined) {
        return def?.grains?.find((g) => g.id === d.grain)?.label ?? base
      }
      if (d.level !== undefined && d.field === 'propiedad' && d.level === 'area')
        return 'área de cada propiedad'
      if (d.level !== undefined && d.field === 'categoria' && d.level === 'leaf')
        return 'categoría hasta la hoja'
      return base
    })
    parts.push(`por ${dims.join(' y ')}`)
  }

  const filtros = state.filters
    .map((row) => describeFilter(row, ctx))
    .filter((text): text is string => text !== null)
  if (filtros.length > 0) parts.push(`donde ${filtros.join(', y ')}`)

  const seleccion = state.range
  if (seleccion.kind === 'relative') {
    const id = seleccion.id
    parts.push(
      `en ${ctx.ranges.find((r) => r.id === id)?.label.toLowerCase() ?? 'el período elegido'}`,
    )
  } else {
    parts.push(
      `entre el ${formatDate(seleccion.from, 'long')} y el ${formatDate(seleccion.to, 'long')}`,
    )
  }

  if (state.compare !== 'none') {
    const label = COMPARISONS.find((c) => c.id === state.compare)?.label ?? state.compare
    parts.push(
      state.compare === 'average_n_periods'
        ? `comparado con el promedio de ${state.averageN} períodos`
        : `comparado con ${label}`,
    )
  }

  parts.push(`en ${ctx.reportCurrency}`)
  if (state.excludeTransfers) parts.push('sin transferencias internas')

  const viz = VIZ.find((v) => v.id === state.viz)?.label.toLowerCase()
  if (viz !== undefined && state.viz !== 'table') parts.push(`en ${viz}, con su tabla debajo`)

  return `${parts.join(', ')}.`
}

/* ── La traducción a movimientos ─────────────────────────────────────────── */

export type MovimientosHref = `/movimientos?${string}`

/**
 * El drill-down que sí se puede hacer hoy.
 *
 * El listado de movimientos entiende cuatro filtros —fecha, cuenta, categoría
 * y valor de dimensión— y el IR puede llevar bastantes más. Se traduce lo que
 * se puede y `untranslated` devuelve lo que se quedó fuera, para poder
 * decirlo al lado del enlace. Un "ver el detalle" que aplica la mitad de los
 * filtros sin avisar es peor que no tenerlo: el usuario cuenta las filas,
 * no le cuadran con el agregado y deja de confiar en los dos números.
 */
export function movimientosHref(
  state: BuilderState,
  ctx: BuilderContext,
): { href: MovimientosHref; untranslated: readonly string[] } {
  const range = resolveRange(state, ctx)
  const params = new URLSearchParams()
  params.set('desde', range.from)
  params.set('hasta', range.to)

  const untranslated: string[] = []
  const bucket: Record<string, string[]> = {}

  for (const row of state.filters) {
    if (row.operator !== 'one_of') {
      const described = describeFilter(row, ctx)
      if (described !== null) untranslated.push(described)
      continue
    }
    const target =
      row.field === 'cuenta'
        ? 'cuenta'
        : row.field === 'categoria'
          ? 'categoria'
          : dimension(row.field)?.source === 'hogar'
            ? 'dimension'
            : null
    if (target === null || row.values.length === 0) {
      const described = describeFilter(row, ctx)
      if (described !== null) untranslated.push(described)
      continue
    }
    const list = bucket[target] ?? []
    list.push(...row.values)
    bucket[target] = list
  }

  for (const [key, list] of Object.entries(bucket)) params.set(key, list.join(','))

  return { href: `/movimientos?${params.toString()}`, untranslated }
}
