/**
 * Clasificación: mover un movimiento de categoría, atribuirlo a dimensiones, y
 * las reglas que lo hacen solas.
 *
 * Cuatro reglas gobiernan el módulo entero:
 *
 *  1. **La pata bancaria no se toca nunca.** Importe, fecha, cuenta y huella
 *     son el hecho registrado. Clasificar cambia a qué cuenta apunta la pata de
 *     CONTRAPARTIDA, y nada más. Por eso el asiento sigue balanceando a cero
 *     después de reclasificar: el importe no se movió, sólo su destino.
 *
 *  2. **Reclasificar no es corregir**, así que se actualiza en su sitio en vez
 *     de anular y reasentar. El razonamiento completo está en la cabecera de
 *     006_clasificacion.sql; el resumen es que anular duplicaría el libro en
 *     cada pasada de categorización. El precio —que el cambio sería invisible—
 *     lo paga `classification_change`, donde queda quién, cuándo y con qué
 *     regla.
 *
 *  3. **Lo que no se puede clasificar se devuelve, no se silencia.** Las dos
 *     patas de un traspaso interno van contra cuentas de activo: no hay
 *     categoría que cambiar. Un asiento repartido entre varias categorías
 *     tampoco se toca, porque aplastarlo a una sola destruye el reparto sin
 *     avisar. Los dos casos salen en `omitidos` con su motivo.
 *
 *  4. **Nada se hace en bucle.** Categorizar 2.000 movimientos de una es lo
 *     normal en un alta, así que cada operación es una sentencia para N
 *     movimientos. Lo único que se recorre son las reglas, que son decenas.
 *
 * Ninguna consulta filtra por tenant_id: eso lo hace RLS con la variable que
 * fija `withTenant`. Sí se comprueban en cambio las cuentas y dimensiones que
 * llegan por parámetro, porque las claves foráneas de Postgres **no** pasan por
 * RLS: sin la comprobación, un id de otro hogar sería aceptado por la FK aunque
 * la consulta no pueda verlo.
 */

import { descriptionTokens, normalizeDescription } from '@moneypilot/core'
import type { TenantClient } from '../client.js'
import type { DataSource, MovementRow } from './read-ledger.js'

// ── Contrato público ────────────────────────────────────────────────────────

export type MatchKind = 'contiene' | 'empieza' | 'exacto' | 'regex'

/** Por qué un movimiento no se pudo clasificar. */
export type OmitReason =
  /** El asiento no existe en este hogar. */
  | 'inexistente'
  /** Ninguna pata va contra gasto o ingreso: un traspaso entre cuentas propias. */
  | 'sin-contrapartida'
  /** El asiento reparte entre varias categorías; aplastarlo perdería el reparto. */
  | 'reparto'

export interface OmittedMovement {
  readonly entryId: string
  readonly motivo: OmitReason
}

export interface ClassifyResult {
  /** Movimientos cuya categoría cambió de verdad. */
  readonly changed: number
  /** Ya estaban en esa categoría: ni se tocan ni generan auditoría. */
  readonly yaEstaban: number
  readonly omitidos: readonly OmittedMovement[]
}

export interface ReclassifyInput {
  readonly entryIds: readonly string[]
  /** Cuenta de gasto o ingreso. Acá no hay tabla de categorías: son cuentas. */
  readonly categoryId: string
  readonly changedBy: string
  /** Qué regla lo hizo. Sin esto, el registro dice que lo hizo una persona. */
  readonly ruleId?: string | undefined
}

export interface DimensionAssignment {
  readonly dimensionId: string
  /** `null` QUITA esa dimensión del movimiento en vez de ponerla. */
  readonly dimensionValueId: string | null
  /** Partes por millón. Por defecto 1.000.000, que es el 100%. */
  readonly weightPpm?: number | undefined
}

export interface SetDimensionsInput {
  readonly entryIds: readonly string[]
  readonly assignments: readonly DimensionAssignment[]
  readonly changedBy: string
}

export interface SetDimensionsResult {
  /** Movimientos cuya atribución se reescribió. */
  readonly changed: number
  readonly omitidos: readonly OmittedMovement[]
}

export interface RuleDimensionInput {
  readonly dimensionId: string
  readonly dimensionValueId: string
  readonly weightPpm?: number | undefined
}

export interface RuleDimensionRow {
  readonly dimensionId: string
  readonly key: string
  readonly label: string
  readonly valueId: string
  readonly value: string
  readonly weightPpm: number
}

export interface RuleInput {
  readonly name: string
  readonly matchKind: MatchKind
  readonly matchValue: string
  /** Limita la regla a una cuenta bancaria concreta. */
  readonly accountId?: string | null | undefined
  /** Rango de importe CON SIGNO, en unidades mínimas. Un cargo de 45,20 es −4520. */
  readonly minAmount?: bigint | null | undefined
  readonly maxAmount?: bigint | null | undefined
  readonly categoryId?: string | null | undefined
  readonly priority?: number | undefined
  readonly enabled?: boolean | undefined
  readonly dimensions?: readonly RuleDimensionInput[] | undefined
  readonly createdBy?: string | undefined
}

export type RulePatch = Partial<Omit<RuleInput, 'createdBy'>>

export interface RuleRow {
  readonly id: string
  readonly name: string
  readonly matchKind: MatchKind
  readonly matchValue: string
  readonly accountId: string | null
  readonly accountName: string | null
  readonly minAmount: bigint | null
  readonly maxAmount: bigint | null
  readonly categoryId: string | null
  readonly category: string | null
  readonly priority: number
  readonly enabled: boolean
  readonly dimensions: readonly RuleDimensionRow[]
  /** Instante, no fecha de calendario: acá el ISO completo sí es lo correcto. */
  readonly createdAt: string
  readonly updatedAt: string
  readonly createdBy: string | null
}

/** Lo que hace falta para saber qué movimientos coinciden con una regla. */
export interface RuleMatch {
  readonly matchKind: MatchKind
  readonly matchValue: string
  readonly accountId?: string | null | undefined
  readonly minAmount?: bigint | null | undefined
  readonly maxAmount?: bigint | null | undefined
}

export interface PreviewOptions {
  /** Acota la vista previa a un conjunto de movimientos. */
  readonly entryIds?: readonly string[] | undefined
  readonly soloSinCategorizar?: boolean | undefined
  /**
   * Tamaño de la muestra. Por defecto 20, y **0 no la trae**: la lista de
   * reglas pide un recuento por regla y traerle a cada una una fila de ejemplo
   * que nadie mira cuesta una segunda consulta —con sus dos laterales— por
   * regla de la pantalla.
   */
  readonly muestra?: number | undefined
}

export interface RulePreview {
  /** Movimientos que coincidirían. Es el "esta regla afecta 342 transacciones". */
  readonly total: number
  readonly muestra: readonly MovementRow[]
  /**
   * De los que coinciden, cuántos YA tienen una categoría de verdad. Aplicar la
   * regla sobre trabajo hecho a mano es la forma silenciosa de perderlo.
   */
  readonly yaClasificados: number
  /** Coincidencias que la regla no podrá tocar: traspasos y repartos. */
  readonly omitidos: number
}

export interface ApplyRuleOptions {
  readonly soloSinCategorizar: boolean
  readonly changedBy: string
  /** Acota la aplicación a un conjunto de movimientos (lo que trae un alta). */
  readonly entryIds?: readonly string[] | undefined
}

export interface ApplyRuleResult {
  readonly changed: number
  readonly yaEstaban: number
  readonly omitidos: readonly OmittedMovement[]
}

export interface ApplyAllOptions {
  readonly entryIds?: readonly string[] | undefined
  readonly changedBy: string
  /**
   * Por defecto `true`. Aplicar el conjunto de reglas sobre movimientos que
   * alguien ya categorizó a mano le pisaría el trabajo, y en una pasada masiva
   * eso no se nota hasta que ya pasó.
   */
  readonly soloSinCategorizar?: boolean | undefined
}

export interface ApplyAllResult {
  /**
   * Movimientos que cambiaron, contados una sola vez.
   *
   * No es la suma de `porRegla`: una regla puede poner la categoría y otra la
   * atribución sobre el mismo movimiento, y sumar los dos partes diría que la
   * pasada tocó el doble de movimientos de los que existen.
   */
  readonly changed: number
  readonly porRegla: readonly { ruleId: string; name: string; changed: number }[]
  /** Reglas que reventaron al ejecutarse, con el motivo legible. */
  readonly fallidas: readonly { ruleId: string; name: string; error: string }[]
}

export interface UncategorizedMerchant {
  /** Descriptor normalizado: es el que sirve de semilla para una regla. */
  readonly descripcion: string
  /** El texto tal como lo escribe el banco, para que el usuario lo reconozca. */
  readonly ejemplo: string
  readonly veces: number
  /** Suma con signo de la pata bancaria, en la moneda de la cuenta. */
  readonly importe: bigint
  readonly currency: string
}

export interface UncategorizedResult {
  /** Movimientos sin categorizar, no comercios. */
  readonly total: number
  readonly porComercio: readonly UncategorizedMerchant[]
  /** Comercios que no entraron en el límite pedido. */
  readonly truncados: number
}

export class ClassifyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClassifyError'
  }
}

// ── Validación de los argumentos ────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MATCH_KINDS: readonly MatchKind[] = ['contiene', 'empieza', 'exacto', 'regex']

const FULL_PPM = 1_000_000

const MUESTRA_DEFECTO = 20
const MUESTRA_MAXIMA = 200
const COMERCIOS_DEFECTO = 20
const COMERCIOS_MAXIMOS = 500

function assertUuid(value: string, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new ClassifyError(`${field} tiene que ser un uuid y llegó ${JSON.stringify(value)}`)
  }
  return value
}

function optionalUuid(value: string | null | undefined, field: string): string | null {
  if (value === undefined || value === null) return null
  return assertUuid(value, field)
}

/**
 * Ids de asiento, sin repetidos.
 *
 * El `Set` no es cosmético: la misma id dos veces en la lista contaría el
 * cambio dos veces en `changed`, y el informe que ve el usuario diría que tocó
 * más movimientos de los que existen.
 */
function assertEntryIds(entryIds: readonly string[], field: string): string[] {
  if (!Array.isArray(entryIds)) {
    throw new ClassifyError(`${field} tiene que ser una lista de uuid`)
  }
  const out = new Set<string>()
  for (const [index, id] of entryIds.entries()) out.add(assertUuid(id, `${field}[${index}]`))
  return [...out]
}

function assertAutor(changedBy: string, field = 'changedBy'): string {
  if (typeof changedBy !== 'string' || changedBy.trim() === '') {
    // Sin autor, la auditoría contesta "cambió" pero no "quién", que es la
    // mitad de la pregunta que B6 obliga a poder responder.
    throw new ClassifyError(`${field} no puede estar vacío: la auditoría necesita saber quién.`)
  }
  return changedBy.trim()
}

function assertPpm(value: number | undefined, field: string): number {
  if (value === undefined) return FULL_PPM
  if (!Number.isInteger(value) || value <= 0 || value > FULL_PPM) {
    throw new ClassifyError(
      `${field} tiene que ser un entero de partes por millón entre 1 y ${FULL_PPM}, y llegó ${String(value)}`,
    )
  }
  return value
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(min, Math.trunc(value)), max)
}

function toBigIntOrNull(value: string | null): bigint | null {
  return value === null ? null : BigInt(value)
}

function toCount(value: number | null): number {
  return value === null ? 0 : Number(value)
}

/**
 * Un '%' o un '_' escritos por el usuario son texto, no comodines.
 *
 * Sin escapar, una regla "contiene 100%" trae también "1005 CAJA": el % final
 * convierte la búsqueda en un prefijo y la regla se come movimientos que nadie
 * pidió. La barra invertida se escapa primero porque si no, las que agrega este
 * mismo reemplazo se volverían a escapar.
 */
function escaparLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

// ── Fragmentos SQL compartidos ──────────────────────────────────────────────

/**
 * Las bolsas por defecto del importador. Ver SUSPENSE_OUTFLOW_NAME y
 * SUSPENSE_INFLOW_NAME en import.ts: son dos porque el signo decide la clase de
 * cuenta, y llevan la moneda entre paréntesis porque `account_name_unique` es
 * (hogar, nombre).
 *
 * Se reconocen por nombre y no por una marca en la tabla porque no hay tal
 * marca: una categoría es una cuenta y nada la distingue de las demás. Si algún
 * día hace falta, el sitio para arreglarlo es una columna en `account`, no un
 * segundo nombre mágico repartido por el código.
 */
function esSinCategorizar(alias: string): string {
  return `(${alias}.name in ('Sin categorizar', 'Ingresos sin categorizar')
      or ${alias}.name like 'Sin categorizar (%)'
      or ${alias}.name like 'Ingresos sin categorizar (%)')`
}

/**
 * Un conjunto de movimientos, expresado como un SELECT que devuelve `entry_id`.
 *
 * Existe para que reclasificar "estos 40 que marqué" y reclasificar "todo lo
 * que coincide con esta regla" sean la misma sentencia con distinto principio.
 * Sus parámetros ocupan $1..$n y los de la operación siguen a partir de ahí.
 */
interface Seleccion {
  readonly sql: string
  readonly params: readonly unknown[]
}

function porIds(entryIds: readonly string[]): Seleccion {
  return {
    sql: 'select distinct t.id as entry_id from unnest($1::uuid[]) as t(id)',
    params: [entryIds],
  }
}

/**
 * Los movimientos que coinciden con una regla.
 *
 * "Movimiento" es la pata contra una cuenta de activo o pasivo — la línea que
 * el usuario reconoce en su extracto—, igual que en `movements()`. Un asiento
 * con dos patas bancarias (un traspaso) aparece una vez gracias al `distinct`.
 */
function porRegla(
  regla: RuleMatch,
  opts: { entryIds?: readonly string[] | undefined; soloSinCategorizar: boolean },
): Seleccion {
  const kind = regla.matchKind
  if (!MATCH_KINDS.includes(kind)) {
    throw new ClassifyError(`matchKind desconocido: ${JSON.stringify(kind)}`)
  }
  const valor = regla.matchValue
  assertPatron(kind, valor)

  // El patrón viaja SIEMPRE como parámetro; lo único que se elige en el texto
  // de la consulta es el operador, y sale de un conjunto cerrado de cuatro.
  const patron =
    kind === 'contiene'
      ? `%${escaparLike(valor)}%`
      : kind === 'empieza'
        ? `${escaparLike(valor)}%`
        : kind === 'exacto'
          ? escaparLike(valor)
          : valor
  // 'exacto' va por ILIKE con el valor escapado, que es igualdad sin distinguir
  // mayúsculas: los descriptores bancarios llegan en mayúsculas unas veces y no
  // otras, y una regla "exacta" sensible a eso fallaría sin motivo visible.
  const comparacion =
    kind === 'regex' ? 'e.description ~* $1' : "e.description ilike $1 escape '\\'"

  return {
    sql: `select distinct p.entry_id
            from posting p
            join entry e   on e.id = p.entry_id
            join account a on a.id = p.account_id
           where a.kind in ('asset', 'liability')
             and ${comparacion}
             and ($2::uuid   is null or p.account_id = $2::uuid)
             and ($3::bigint is null or p.amount    >= $3::bigint)
             and ($4::bigint is null or p.amount    <= $4::bigint)
             and ($5::uuid[] is null or p.entry_id   = any($5::uuid[]))
             and (not $6::boolean or exists (
                   select 1
                     from posting cp
                     join account ca on ca.id = cp.account_id
                    where cp.entry_id = p.entry_id
                      and ca.kind in ('expense', 'income')
                      and ${esSinCategorizar('ca')}))`,
    params: [
      patron,
      optionalUuid(regla.accountId, 'accountId'),
      regla.minAmount === undefined || regla.minAmount === null ? null : regla.minAmount.toString(),
      regla.maxAmount === undefined || regla.maxAmount === null ? null : regla.maxAmount.toString(),
      opts.entryIds === undefined ? null : assertEntryIds(opts.entryIds, 'entryIds'),
      opts.soloSinCategorizar,
    ],
  }
}

/**
 * La pata de categoría de cada asiento candidato, y el recuento que decide si
 * es tocable.
 *
 * `patas` cuenta las patas de gasto/ingreso del asiento. Uno es el caso normal;
 * cero es un traspaso interno y más de uno es un ticket repartido. Los dos
 * últimos se apartan en vez de tocarse.
 */
function patasSql(): string {
  return `pata as (
            select p.id as posting_id, p.entry_id, p.account_id,
                   count(*) over (partition by p.entry_id) as patas
              from posting p
              join account a on a.id = p.account_id
             where p.entry_id in (select entry_id from existente)
               and a.kind in ('expense', 'income')
          ),
          elegible as (
            select posting_id, entry_id, account_id from pata where patas = 1
          )`
}

function omitidosDe(row: {
  inexistentes: string[] | null
  sin_contrapartida: string[] | null
  repartidos: string[] | null
}): OmittedMovement[] {
  return [
    ...(row.inexistentes ?? []).map((entryId) => ({ entryId, motivo: 'inexistente' as const })),
    ...(row.sin_contrapartida ?? []).map((entryId) => ({
      entryId,
      motivo: 'sin-contrapartida' as const,
    })),
    ...(row.repartidos ?? []).map((entryId) => ({ entryId, motivo: 'reparto' as const })),
  ]
}

// ── Reclasificar ────────────────────────────────────────────────────────────

/**
 * Cambia la categoría de N movimientos. Sólo toca la pata de contrapartida.
 *
 * Es UNA sentencia para los N: el caso normal de un alta es categorizar dos mil
 * de golpe, y un bucle de dos mil viajes a la base convierte una operación de
 * medio segundo en una de dos minutos.
 *
 * La pata bancaria no aparece ni en el UPDATE: el `join` con `account` deja
 * fuera todo lo que no sea gasto o ingreso, así que no hay forma de que un
 * error de esta función mueva un importe de cuenta.
 */
export async function reclassify(
  client: TenantClient,
  input: ReclassifyInput,
): Promise<ClassifyResult> {
  const entryIds = assertEntryIds(input.entryIds, 'entryIds')
  const changedBy = assertAutor(input.changedBy)
  const ruleId = optionalUuid(input.ruleId, 'ruleId')
  const categoryId = assertUuid(input.categoryId, 'categoryId')

  if (entryIds.length === 0) return { changed: 0, yaEstaban: 0, omitidos: [] }

  const tenantId = await currentTenant(client)
  await assertCategoria(client, categoryId)

  // Se devuelven los recuentos y no la lista de ids: quién cambió qué se
  // pregunta a `classification_change`, que es donde vive esa respuesta entera
  // —con el autor y la hora— y no a medias.
  const { changed, yaEstaban, omitidos } = await aplicarCategoria(client, porIds(entryIds), {
    tenantId,
    categoryId,
    ruleId,
    changedBy,
  })
  return { changed, yaEstaban, omitidos }
}

interface AplicacionRow {
  changed: number
  ya_estaban: number
  cambiados: string[] | null
  inexistentes: string[] | null
  sin_contrapartida: string[] | null
  repartidos: string[] | null
}

/**
 * Lo mismo que `ClassifyResult` más QUÉ movimientos cambiaron, no sólo cuántos.
 *
 * No sale al contrato público: lo necesita la pasada de reglas para contar los
 * movimientos una sola vez cuando dos reglas tocan el mismo —una la categoría y
 * otra la atribución—, y para eso hacen falta los ids, no un número.
 */
interface AplicacionCategoria extends ClassifyResult {
  readonly cambiados: readonly string[]
}

async function aplicarCategoria(
  client: TenantClient,
  seleccion: Seleccion,
  opts: {
    tenantId: string
    categoryId: string
    ruleId: string | null
    changedBy: string
  },
): Promise<AplicacionCategoria> {
  const base = seleccion.params.length
  const pCat = `$${base + 1}`
  const pRegla = `$${base + 2}`
  const pAutor = `$${base + 3}`
  const pHogar = `$${base + 4}`

  const { rows } = await client.query<AplicacionRow>(
    `with candidato as (${seleccion.sql}),
          -- Un id que no existe (o que es de otro hogar, que bajo RLS es lo
          -- mismo) tiene que salir nombrado en el informe. Si se contara como
          -- "sin contrapartida" el usuario buscaría un traspaso que no hay.
          existente as (
            select c.entry_id from candidato c join entry e on e.id = c.entry_id
          ),
          ${patasSql()},
          mover as (
            select posting_id, account_id from elegible where account_id <> ${pCat}::uuid
          ),
          cambio as (
            update posting p
               set account_id = ${pCat}::uuid
              from mover m
             where p.id = m.posting_id
            returning p.id as posting_id, p.entry_id, m.account_id as from_account_id
          ),
          -- Las CTE que escriben corren siempre y hasta el final, se lean o no.
          -- La auditoría se alimenta de "cambio", así que registra exactamente
          -- las filas que se movieron: ni las que ya estaban, ni las omitidas.
          auditoria as (
            insert into classification_change
                   (tenant_id, posting_id, from_account_id, to_account_id, rule_id, changed_by)
            select ${pHogar}::uuid, c.posting_id, c.from_account_id,
                   ${pCat}::uuid, ${pRegla}::uuid, ${pAutor}::text
              from cambio c
            returning 1
          )
     select
       (select count(*) from cambio)::int as changed,
       (select count(*) from elegible where account_id = ${pCat}::uuid)::int as ya_estaban,
       coalesce((select array_agg(c.entry_id) from cambio c), '{}'::uuid[]) as cambiados,
       coalesce((select array_agg(c.entry_id) from candidato c
                  where not exists (select 1 from existente x where x.entry_id = c.entry_id)),
                '{}'::uuid[]) as inexistentes,
       coalesce((select array_agg(x.entry_id) from existente x
                  where not exists (select 1 from pata pp where pp.entry_id = x.entry_id)),
                '{}'::uuid[]) as sin_contrapartida,
       coalesce((select array_agg(distinct pp.entry_id) from pata pp where pp.patas > 1),
                '{}'::uuid[]) as repartidos`,
    [...seleccion.params, opts.categoryId, opts.ruleId, opts.changedBy, opts.tenantId],
  )

  const row = rows[0]
  if (row === undefined) throw new ClassifyError('La reclasificación no devolvió resultado.')
  return {
    changed: toCount(row.changed),
    yaEstaban: toCount(row.ya_estaban),
    cambiados: row.cambiados ?? [],
    omitidos: omitidosDe(row),
  }
}

// ── Dimensiones ─────────────────────────────────────────────────────────────

/**
 * Pone o quita dimensiones sobre los postings de N movimientos.
 *
 * Reemplaza las asignaciones **de esas dimensiones** y deja intactas las demás:
 * poner la propiedad no puede borrar el reparto 60/40 entre la persona y la
 * sociedad que alguien configuró la semana pasada.
 *
 * La atribución cuelga de la pata de categoría, no de la bancaria — es donde la
 * pone el sembrador y donde la busca `movements()`. Colgarla de las dos patas
 * haría que el mismo gasto contara dos veces en el informe por dimensión.
 */
export async function setDimensions(
  client: TenantClient,
  input: SetDimensionsInput,
): Promise<SetDimensionsResult> {
  const entryIds = assertEntryIds(input.entryIds, 'entryIds')
  const changedBy = assertAutor(input.changedBy)
  const asignaciones = normalizarAsignaciones(input.assignments)

  if (entryIds.length === 0) return { changed: 0, omitidos: [] }

  const tenantId = await currentTenant(client)
  await assertDimensiones(client, asignaciones)

  const { elegibles, omitidos } = await resolverPatas(client, porIds(entryIds))
  if (elegibles.length === 0) return { changed: 0, omitidos }

  await escribirDimensiones(client, {
    tenantId,
    changedBy,
    elegibles,
    asignaciones,
  })
  return { changed: elegibles.length, omitidos }
}

interface AsignacionNormalizada {
  readonly dimensionId: string
  readonly dimensionValueId: string | null
  readonly weightPpm: number
}

/**
 * Comprueba los pesos antes de que los vea la base.
 *
 * La restricción de la tabla acota cada peso por separado (0 < ppm <= 1.000.000)
 * pero no puede acotar la SUMA de una dimensión sobre un mismo posting: eso son
 * varias filas. Sin esta comprobación, un 60/60 entra sin protestar y el gasto
 * por propiedad devuelve el 120% del importe, que es peor que devolver un error.
 */
function normalizarAsignaciones(
  assignments: readonly DimensionAssignment[],
): AsignacionNormalizada[] {
  if (!Array.isArray(assignments) || assignments.length === 0) {
    throw new ClassifyError(
      'assignments está vacío: para quitar una dimensión, pasala con dimensionValueId en null.',
    )
  }

  const out: AsignacionNormalizada[] = []
  const suma = new Map<string, number>()
  const vistos = new Set<string>()

  for (const [index, item] of assignments.entries()) {
    const dimensionId = assertUuid(item.dimensionId, `assignments[${index}].dimensionId`)
    const valueId = optionalUuid(item.dimensionValueId, `assignments[${index}].dimensionValueId`)
    if (valueId === null) {
      out.push({ dimensionId, dimensionValueId: null, weightPpm: FULL_PPM })
      continue
    }
    const weightPpm = assertPpm(item.weightPpm, `assignments[${index}].weightPpm`)
    const clave = `${dimensionId}:${valueId}`
    if (vistos.has(clave)) {
      throw new ClassifyError(
        `assignments repite el valor ${valueId} de la dimensión ${dimensionId}: los pesos de un ` +
          'mismo valor van en una sola línea, no en dos que después nadie suma.',
      )
    }
    vistos.add(clave)
    const total = (suma.get(dimensionId) ?? 0) + weightPpm
    suma.set(dimensionId, total)
    if (total > FULL_PPM) {
      throw new ClassifyError(
        `Los pesos de la dimensión ${dimensionId} suman ${total} ppm y el máximo es ${FULL_PPM} ` +
          '(el 100%). Un reparto que suma más del total atribuye más dinero del que hubo.',
      )
    }
    out.push({ dimensionId, dimensionValueId: valueId, weightPpm })
  }

  return out
}

/**
 * Que la dimensión y el valor existan **y que el valor sea de esa dimensión**.
 *
 * `posting_dimension` tiene una clave foránea a `dimension` y otra a
 * `dimension_value`, pero ninguna que las ate entre sí: la base acepta
 * encantada el valor "Casa Madrid" colgado de la dimensión "persona". El
 * informe que salga de ahí no da error, da otra cosa.
 */
async function assertDimensiones(
  client: TenantClient,
  asignaciones: readonly AsignacionNormalizada[],
): Promise<void> {
  const dimensionIds = [...new Set(asignaciones.map((a) => a.dimensionId))]
  const valueIds = [
    ...new Set(
      asignaciones.map((a) => a.dimensionValueId).filter((id): id is string => id !== null),
    ),
  ]

  const dims = await client.query<{ id: string }>(
    'select id from dimension where id = any($1::uuid[])',
    [dimensionIds],
  )
  const conocidas = new Set(dims.rows.map((row) => row.id))
  for (const id of dimensionIds) {
    if (!conocidas.has(id)) {
      throw new ClassifyError(`La dimensión ${id} no existe en este hogar.`)
    }
  }

  if (valueIds.length === 0) return
  const values = await client.query<{ id: string; dimension_id: string }>(
    'select id, dimension_id from dimension_value where id = any($1::uuid[])',
    [valueIds],
  )
  const porId = new Map(values.rows.map((row) => [row.id, row]))
  for (const asignacion of asignaciones) {
    if (asignacion.dimensionValueId === null) continue
    const valor = porId.get(asignacion.dimensionValueId)
    if (valor === undefined) {
      throw new ClassifyError(
        `El valor de dimensión ${asignacion.dimensionValueId} no existe en este hogar.`,
      )
    }
    if (valor.dimension_id !== asignacion.dimensionId) {
      throw new ClassifyError(
        `El valor ${asignacion.dimensionValueId} pertenece a la dimensión ${valor.dimension_id}, ` +
          `no a ${asignacion.dimensionId}. La base aceptaría el cruce y el informe saldría mal.`,
      )
    }
  }
}

interface PataElegible {
  readonly postingId: string
  readonly entryId: string
  readonly accountId: string
}

async function escribirDimensiones(
  client: TenantClient,
  opts: {
    tenantId: string
    changedBy: string
    elegibles: readonly PataElegible[]
    asignaciones: readonly AsignacionNormalizada[]
  },
): Promise<void> {
  const postingIds = opts.elegibles.map((pata) => pata.postingId)
  const dimensionIds = [...new Set(opts.asignaciones.map((a) => a.dimensionId))]

  // Borrar y volver a insertar en DOS sentencias y no en una con CTE: las CTE
  // que escriben ven todas la misma foto de la tabla, así que el insert no
  // vería el borrado y chocaría contra la clave primaria de las filas que la
  // otra rama acaba de quitar.
  await client.query(
    `delete from posting_dimension
      where posting_id = any($1::bigint[])
        and dimension_id = any($2::uuid[])`,
    [postingIds, dimensionIds],
  )

  const puestas = opts.asignaciones.filter((a) => a.dimensionValueId !== null)
  if (puestas.length > 0) {
    await client.query(
      `insert into posting_dimension
              (tenant_id, posting_id, dimension_id, dimension_value_id, weight_ppm)
       select $1::uuid, p.posting_id, x.dimension_id, x.dimension_value_id, x.weight_ppm
         from unnest($2::bigint[]) as p(posting_id)
        cross join unnest($3::uuid[], $4::uuid[], $5::int[])
              as x(dimension_id, dimension_value_id, weight_ppm)`,
      [
        opts.tenantId,
        postingIds,
        puestas.map((a) => a.dimensionId),
        puestas.map((a) => a.dimensionValueId),
        puestas.map((a) => a.weightPpm),
      ],
    )
  }

  // La atribución también es clasificación, así que también deja rastro. Estas
  // filas llevan from_account_id = to_account_id, y así se leen: la categoría
  // no se movió, lo que cambió fue a quién se le imputa. Quien quiera sólo el
  // historial de categorías filtra por `from_account_id is distinct from
  // to_account_id`.
  await client.query(
    `insert into classification_change
            (tenant_id, posting_id, from_account_id, to_account_id, rule_id, changed_by)
     select $1::uuid, x.posting_id, x.account_id, x.account_id, null, $4::text
       from unnest($2::bigint[], $3::uuid[]) as x(posting_id, account_id)`,
    [opts.tenantId, postingIds, opts.elegibles.map((pata) => pata.accountId), opts.changedBy],
  )
}

interface PatasResueltas {
  readonly elegibles: PataElegible[]
  readonly omitidos: OmittedMovement[]
}

async function resolverPatas(client: TenantClient, seleccion: Seleccion): Promise<PatasResueltas> {
  const { rows } = await client.query<{
    entry_id: string
    existe: boolean
    patas: number
    posting_id: string | null
    account_id: string | null
  }>(
    `with candidato as (${seleccion.sql})
     select c.entry_id,
            (e.id is not null) as existe,
            count(pt.posting_id)::int as patas,
            -- Con patas = 1 el min es la única fila; con más, el valor no se
            -- usa porque el asiento se aparta como reparto.
            min(pt.posting_id)::text  as posting_id,
            min(pt.account_id::text)  as account_id
       from candidato c
       left join entry e on e.id = c.entry_id
       left join lateral (
         select p.id as posting_id, p.account_id
           from posting p
           join account a on a.id = p.account_id
          where p.entry_id = c.entry_id
            and a.kind in ('expense', 'income')
       ) pt on true
      group by c.entry_id, e.id`,
    [...seleccion.params],
  )

  const elegibles: PataElegible[] = []
  const omitidos: OmittedMovement[] = []
  for (const row of rows) {
    if (!row.existe) {
      omitidos.push({ entryId: row.entry_id, motivo: 'inexistente' })
      continue
    }
    if (row.patas === 0) {
      omitidos.push({ entryId: row.entry_id, motivo: 'sin-contrapartida' })
      continue
    }
    if (row.patas > 1) {
      omitidos.push({ entryId: row.entry_id, motivo: 'reparto' })
      continue
    }
    if (row.posting_id === null || row.account_id === null) {
      throw new ClassifyError(`El asiento ${row.entry_id} devolvió una pata incompleta.`)
    }
    elegibles.push({
      postingId: row.posting_id,
      entryId: row.entry_id,
      accountId: row.account_id,
    })
  }
  return { elegibles, omitidos }
}

// ── Reglas ──────────────────────────────────────────────────────────────────

const MAX_PATRON = 200
const MAX_NOMBRE = 120

/**
 * Un patrón que el motor de expresiones regulares no pueda con él.
 *
 * El motor de Postgres es híbrido: intenta primero un autómata determinista, y
 * por eso aguanta patrones que en JavaScript explotan. Pero no es inmune —las
 * referencias hacia atrás lo obligan a la rama con retroceso—, y el precio de
 * equivocarse acá lo paga toda la base: una consulta que no termina ocupa una
 * conexión hasta el statement_timeout, y RLS aísla filas, no CPU.
 *
 * Esto NO es una prueba de que el patrón sea seguro; es un cepo para las dos
 * formas que aparecen de verdad: el cuantificador anidado —(a+)+ y familia— y
 * la referencia hacia atrás, que en una regla de categorización no tiene ningún
 * uso legítimo. El límite de longitud es lo que acota el resto.
 */
const CUANTIFICADOR_ANIDADO = /\([^()]*[*+][^()]*\)\s*[*+]|\([^()]*[*+][^()]*\)\s*\{\d+,\s*\}/
const REFERENCIA_ATRAS = /\\[1-9]/

function assertPatron(kind: MatchKind, value: string): void {
  if (typeof value !== 'string' || value === '') {
    throw new ClassifyError('matchValue no puede estar vacío: coincidiría con todo el libro.')
  }
  if (value.length > MAX_PATRON) {
    throw new ClassifyError(
      `matchValue no puede pasar de ${MAX_PATRON} caracteres y llegó con ${value.length}.`,
    )
  }
  if (kind !== 'regex') return
  if (CUANTIFICADOR_ANIDADO.test(value)) {
    throw new ClassifyError(
      `La expresión ${JSON.stringify(value)} tiene un cuantificador dentro de otro —del estilo ` +
        '(a+)+—, que es la forma clásica de hacer que la búsqueda tarde una eternidad. ' +
        'Escribila sin repetir un grupo que ya repite.',
    )
  }
  if (REFERENCIA_ATRAS.test(value)) {
    throw new ClassifyError(
      `La expresión ${JSON.stringify(value)} usa una referencia hacia atrás (\\1). No hacen falta ` +
        'para clasificar movimientos y obligan al motor a la estrategia lenta.',
    )
  }
}

let savepointSeq = 0

/**
 * Ejecuta `fn` dentro de un savepoint y lo deshace si falla.
 *
 * Sin esto, un error de Postgres —una regex inválida es el caso— aborta la
 * transacción entera: capturarlo en TypeScript devolvería un mensaje bonito y
 * la siguiente consulta fallaría igual con "current transaction is aborted".
 * El savepoint es lo que convierte "se rompió todo" en "esta regla no anduvo".
 */
async function conSavepoint<T>(client: TenantClient, fn: () => Promise<T>): Promise<T> {
  savepointSeq += 1
  const nombre = `clasificacion_${savepointSeq}`
  await client.query(`savepoint ${nombre}`)
  try {
    const result = await fn()
    await client.query(`release savepoint ${nombre}`)
    return result
  } catch (error) {
    await client.query(`rollback to savepoint ${nombre}`)
    throw error
  }
}

/** Traduce el error de Postgres a algo que se pueda enseñar en una pantalla. */
function errorDeRegex(patron: string, error: unknown): ClassifyError {
  const causa = error instanceof Error ? error.message : String(error)
  return new ClassifyError(`La expresión regular ${JSON.stringify(patron)} no es válida: ${causa}`)
}

/**
 * Comprueba el patrón contra el mismo motor que lo va a ejecutar.
 *
 * Validarlo con `new RegExp` en JavaScript no serviría: la sintaxis de Postgres
 * no es la de ECMAScript, así que aceptaría patrones que después revientan y
 * rechazaría otros que funcionan.
 */
async function assertRegexValida(client: TenantClient, patron: string): Promise<void> {
  try {
    await conSavepoint(client, () => client.query("select ''::text ~* $1::text", [patron]))
  } catch (error) {
    throw errorDeRegex(patron, error)
  }
}

interface RuleQueryRow {
  id: string
  name: string
  match_kind: MatchKind
  match_value: string
  account_id: string | null
  account_name: string | null
  min_amount: string | null
  max_amount: string | null
  category_id: string | null
  category: string | null
  priority: number
  enabled: boolean
  created_at: Date
  updated_at: Date
  created_by: string | null
  dimensions: RuleDimensionRow[] | null
}

const RULE_SELECT = `
  select r.id, r.name, r.match_kind, r.match_value,
         r.account_id, ba.name as account_name,
         r.min_amount::text as min_amount, r.max_amount::text as max_amount,
         r.category_id, ca.name as category,
         r.priority, r.enabled, r.created_at, r.updated_at, r.created_by,
         dim.items as dimensions
    from rule r
    left join account ba on ba.id = r.account_id
    left join account ca on ca.id = r.category_id
    left join lateral (
      select coalesce(
               json_agg(
                 json_build_object(
                   'dimensionId', d.id,
                   'key',         d.key,
                   'label',       d.label,
                   'valueId',     dv.id,
                   'value',       dv.label,
                   'weightPpm',   rd.weight_ppm
                 ) order by d.position, d.key, dv.label
               ),
               '[]'::json
             ) as items
        from rule_dimension rd
        join dimension d        on d.id  = rd.dimension_id
        join dimension_value dv on dv.id = rd.dimension_value_id
       where rd.rule_id = r.id
    ) dim on true
`

function toRuleRow(row: RuleQueryRow): RuleRow {
  return {
    id: row.id,
    name: row.name,
    matchKind: row.match_kind,
    matchValue: row.match_value,
    accountId: row.account_id,
    accountName: row.account_name,
    minAmount: toBigIntOrNull(row.min_amount),
    maxAmount: toBigIntOrNull(row.max_amount),
    categoryId: row.category_id,
    category: row.category,
    priority: toCount(row.priority),
    enabled: row.enabled,
    dimensions: row.dimensions ?? [],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    createdBy: row.created_by,
  }
}

/**
 * Las reglas del hogar, en el orden en que se aplican: primero la de mayor
 * prioridad, y a igualdad la más vieja — la que el usuario lleva más tiempo
 * dando por buena.
 */
export async function listRules(
  client: TenantClient,
  opts: { soloActivas?: boolean | undefined } = {},
): Promise<RuleRow[]> {
  const { rows } = await client.query<RuleQueryRow>(
    `${RULE_SELECT}
      where (not $1::boolean or r.enabled)
      order by r.priority desc, r.created_at, r.id`,
    [opts.soloActivas === true],
  )
  return rows.map(toRuleRow)
}

async function loadRule(client: TenantClient, ruleId: string): Promise<RuleRow> {
  const { rows } = await client.query<RuleQueryRow>(`${RULE_SELECT} where r.id = $1::uuid`, [
    ruleId,
  ])
  const row = rows[0]
  if (row === undefined) {
    // Con RLS, la regla de otro hogar es indistinguible de una que no existe, y
    // así tiene que ser: la respuesta no puede confirmar que existe.
    throw new ClassifyError(`La regla ${ruleId} no existe en este hogar.`)
  }
  return toRuleRow(row)
}

interface ReglaValidada {
  readonly name: string
  readonly matchKind: MatchKind
  readonly matchValue: string
  readonly accountId: string | null
  readonly minAmount: bigint | null
  readonly maxAmount: bigint | null
  readonly categoryId: string | null
  readonly priority: number
  readonly enabled: boolean
  readonly dimensions: AsignacionNormalizada[]
}

function assertBigIntOrNull(value: bigint | null | undefined, field: string): bigint | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'bigint') {
    // Un number acá sería un importe que ya perdió precisión antes de llegar.
    throw new ClassifyError(`${field} tiene que ser bigint en unidades mínimas, no ${typeof value}`)
  }
  return value
}

async function validarRegla(
  client: TenantClient,
  input: {
    name: string
    matchKind: MatchKind
    matchValue: string
    accountId?: string | null | undefined
    minAmount?: bigint | null | undefined
    maxAmount?: bigint | null | undefined
    categoryId?: string | null | undefined
    priority?: number | undefined
    enabled?: boolean | undefined
    dimensions?: readonly RuleDimensionInput[] | undefined
  },
): Promise<ReglaValidada> {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (name === '') throw new ClassifyError('La regla necesita un nombre.')
  if (name.length > MAX_NOMBRE) {
    throw new ClassifyError(`El nombre no puede pasar de ${MAX_NOMBRE} caracteres.`)
  }
  if (!MATCH_KINDS.includes(input.matchKind)) {
    throw new ClassifyError(
      `matchKind tiene que ser uno de ${MATCH_KINDS.join(', ')} y llegó ${JSON.stringify(input.matchKind)}`,
    )
  }
  assertPatron(input.matchKind, input.matchValue)
  if (input.matchKind === 'regex') await assertRegexValida(client, input.matchValue)

  const minAmount = assertBigIntOrNull(input.minAmount, 'minAmount')
  const maxAmount = assertBigIntOrNull(input.maxAmount, 'maxAmount')
  if (minAmount !== null && maxAmount !== null && minAmount > maxAmount) {
    throw new ClassifyError(
      `El rango de importe está al revés: min ${minAmount} es mayor que max ${maxAmount}. ` +
        'Recordá que se compara con signo, así que un cargo de 45,20 es −4520.',
    )
  }

  const priority = input.priority ?? 0
  if (!Number.isInteger(priority) || priority < -1_000_000 || priority > 1_000_000) {
    throw new ClassifyError(
      `priority tiene que ser un entero razonable y llegó ${String(priority)}`,
    )
  }

  const accountId = optionalUuid(input.accountId, 'accountId')
  if (accountId !== null) await assertCuentaBancaria(client, accountId)
  const categoryId = optionalUuid(input.categoryId, 'categoryId')
  if (categoryId !== null) await assertCategoria(client, categoryId)

  const dimensions =
    input.dimensions === undefined || input.dimensions.length === 0
      ? []
      : normalizarAsignaciones(
          input.dimensions.map((dim) => ({
            dimensionId: dim.dimensionId,
            dimensionValueId: dim.dimensionValueId,
            ...(dim.weightPpm === undefined ? {} : { weightPpm: dim.weightPpm }),
          })),
        )
  if (dimensions.length > 0) await assertDimensiones(client, dimensions)

  if (categoryId === null && dimensions.length === 0) {
    // Una regla sin destino ni dimensiones coincide con movimientos y no les
    // hace nada. Guardarla deja al usuario esperando un efecto que no llega.
    throw new ClassifyError(
      'La regla no hace nada: tiene que mandar a una categoría o poner al menos una dimensión.',
    )
  }

  return {
    name,
    matchKind: input.matchKind,
    matchValue: input.matchValue,
    accountId,
    minAmount,
    maxAmount,
    categoryId,
    priority,
    enabled: input.enabled ?? true,
    dimensions,
  }
}

export async function createRule(client: TenantClient, input: RuleInput): Promise<RuleRow> {
  const tenantId = await currentTenant(client)
  const regla = await validarRegla(client, input)
  const createdBy = input.createdBy === undefined ? null : assertAutor(input.createdBy, 'createdBy')

  const { rows } = await client.query<{ id: string }>(
    `insert into rule (tenant_id, name, match_kind, match_value, account_id,
                       min_amount, max_amount, category_id, priority, enabled, created_by)
     values ($1, $2, $3::rule_match_kind, $4, $5, $6::bigint, $7::bigint, $8, $9, $10, $11)
     returning id`,
    [
      tenantId,
      regla.name,
      regla.matchKind,
      regla.matchValue,
      regla.accountId,
      regla.minAmount === null ? null : regla.minAmount.toString(),
      regla.maxAmount === null ? null : regla.maxAmount.toString(),
      regla.categoryId,
      regla.priority,
      regla.enabled,
      createdBy,
    ],
  )
  const id = rows[0]?.id
  if (id === undefined) throw new ClassifyError('No se pudo crear la regla.')

  await escribirDimensionesDeRegla(client, tenantId, id, regla.dimensions)
  return loadRule(client, id)
}

export async function updateRule(
  client: TenantClient,
  ruleId: string,
  patch: RulePatch,
): Promise<RuleRow> {
  assertUuid(ruleId, 'ruleId')
  const tenantId = await currentTenant(client)
  const actual = await loadRule(client, ruleId)

  // Se valida la regla RESULTANTE y no el parche: cambiar sólo el matchKind a
  // 'regex' deja un match_value que era un literal, y por separado los dos
  // campos parecen correctos.
  const fusionada = {
    name: patch.name ?? actual.name,
    matchKind: patch.matchKind ?? actual.matchKind,
    matchValue: patch.matchValue ?? actual.matchValue,
    accountId: patch.accountId === undefined ? actual.accountId : patch.accountId,
    minAmount: patch.minAmount === undefined ? actual.minAmount : patch.minAmount,
    maxAmount: patch.maxAmount === undefined ? actual.maxAmount : patch.maxAmount,
    categoryId: patch.categoryId === undefined ? actual.categoryId : patch.categoryId,
    priority: patch.priority ?? actual.priority,
    enabled: patch.enabled ?? actual.enabled,
    dimensions:
      patch.dimensions ??
      actual.dimensions.map((dim) => ({
        dimensionId: dim.dimensionId,
        dimensionValueId: dim.valueId,
        weightPpm: dim.weightPpm,
      })),
  }
  const regla = await validarRegla(client, fusionada)

  await client.query(
    `update rule
        set name = $2, match_kind = $3::rule_match_kind, match_value = $4,
            account_id = $5, min_amount = $6::bigint, max_amount = $7::bigint,
            category_id = $8, priority = $9, enabled = $10, updated_at = now()
      where id = $1::uuid`,
    [
      ruleId,
      regla.name,
      regla.matchKind,
      regla.matchValue,
      regla.accountId,
      regla.minAmount === null ? null : regla.minAmount.toString(),
      regla.maxAmount === null ? null : regla.maxAmount.toString(),
      regla.categoryId,
      regla.priority,
      regla.enabled,
    ],
  )

  if (patch.dimensions !== undefined) {
    await client.query('delete from rule_dimension where rule_id = $1::uuid', [ruleId])
    await escribirDimensionesDeRegla(client, tenantId, ruleId, regla.dimensions)
  }
  return loadRule(client, ruleId)
}

async function escribirDimensionesDeRegla(
  client: TenantClient,
  tenantId: string,
  ruleId: string,
  dimensiones: readonly AsignacionNormalizada[],
): Promise<void> {
  const puestas = dimensiones.filter((dim) => dim.dimensionValueId !== null)
  if (puestas.length === 0) return
  await client.query(
    `insert into rule_dimension (tenant_id, rule_id, dimension_id, dimension_value_id, weight_ppm)
     select $1::uuid, $2::uuid, x.dimension_id, x.dimension_value_id, x.weight_ppm
       from unnest($3::uuid[], $4::uuid[], $5::int[])
            as x(dimension_id, dimension_value_id, weight_ppm)`,
    [
      tenantId,
      ruleId,
      puestas.map((dim) => dim.dimensionId),
      puestas.map((dim) => dim.dimensionValueId),
      puestas.map((dim) => dim.weightPpm),
    ],
  )
}

/**
 * Borra la regla. Lo que la regla ya clasificó **se queda como está**: el
 * registro de auditoría conserva la fila y suelta el puntero (rule_id a null),
 * así que la historia dice que hubo un cambio automático aunque la regla que lo
 * hizo ya no exista. Deshacer una clasificación es reclasificar, no borrar la
 * regla.
 */
export async function deleteRule(
  client: TenantClient,
  ruleId: string,
): Promise<{ deleted: boolean }> {
  assertUuid(ruleId, 'ruleId')
  const result = await client.query('delete from rule where id = $1::uuid', [ruleId])
  return { deleted: (result.rowCount ?? 0) > 0 }
}

// ── Vista previa ────────────────────────────────────────────────────────────

/**
 * Qué haría la regla si se aplicara, antes de aplicarla.
 *
 * Es el paso 4 de B7: una regla propuesta se enseña con su impacto —"esta regla
 * afecta 342 transacciones"— y no se ejecuta sola. `yaClasificados` es la parte
 * que evita el accidente: si de esos 342 hay 200 que alguien categorizó a mano,
 * aplicar la regla a todo le borra dos tardes de trabajo.
 */
export async function previewRule(
  client: TenantClient,
  regla: RuleMatch,
  opts: PreviewOptions = {},
): Promise<RulePreview> {
  const seleccion = porRegla(regla, {
    entryIds: opts.entryIds,
    soloSinCategorizar: opts.soloSinCategorizar === true,
  })
  const limite = clampInt(opts.muestra, MUESTRA_DEFECTO, 0, MUESTRA_MAXIMA)

  const ejecutar = async (): Promise<RulePreview> => {
    const resumen = await client.query<{
      total: number
      ya_clasificados: number
      omitidos: number
    }>(
      `with candidato as (${seleccion.sql}),
            resumen as (
              select c.entry_id,
                     count(pt.posting_id)::int as patas,
                     bool_or(pt.sin_categorizar) as sin_categorizar
                from candidato c
                left join lateral (
                  select p.id as posting_id, ${esSinCategorizar('a')} as sin_categorizar
                    from posting p
                    join account a on a.id = p.account_id
                   where p.entry_id = c.entry_id
                     and a.kind in ('expense', 'income')
                ) pt on true
               group by c.entry_id
            )
       select count(*)::int as total,
              count(*) filter (where patas >= 1 and sin_categorizar is not true)::int
                as ya_clasificados,
              count(*) filter (where patas <> 1)::int as omitidos
         from resumen`,
      [...seleccion.params],
    )

    // Con límite cero no se pide: quien sólo quiere el recuento no tiene por
    // qué pagar la consulta de la muestra, que trae dos laterales por fila.
    const muestra = limite === 0 ? [] : await muestraDe(client, seleccion, limite)
    const row = resumen.rows[0]
    return {
      total: toCount(row?.total ?? 0),
      muestra,
      yaClasificados: toCount(row?.ya_clasificados ?? 0),
      omitidos: toCount(row?.omitidos ?? 0),
    }
  }

  // Un patrón que Postgres rechaza aborta la transacción; el savepoint la deja
  // utilizable para que la pantalla pueda seguir mostrando el formulario.
  if (regla.matchKind !== 'regex') return ejecutar()
  try {
    return await conSavepoint(client, ejecutar)
  } catch (error) {
    if (error instanceof ClassifyError) throw error
    throw errorDeRegex(regla.matchValue, error)
  }
}

interface MuestraQueryRow {
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
  dimensions: MovementRow['dimensions'] | null
}

/**
 * La muestra tiene la misma forma que una fila del listado de movimientos: la
 * pantalla de propuesta enseña exactamente lo que el usuario ya sabe leer, con
 * su categoría actual al lado — que es el "diff" que pide B7.
 */
async function muestraDe(
  client: TenantClient,
  seleccion: Seleccion,
  limite: number,
): Promise<MovementRow[]> {
  const pLimite = `$${seleccion.params.length + 1}`
  const { rows } = await client.query<MuestraQueryRow>(
    `with candidato as (${seleccion.sql})
     select
       e.id                               as entry_id,
       p.id::text                         as posting_id,
       to_char(e.booked_on, 'YYYY-MM-DD') as booked_on,
       e.description,
       e.source,
       p.account_id,
       a.name                             as account_name,
       p.currency,
       p.amount::text                     as amount,
       p.base_amount::text                as base_amount,
       p.base_currency,
       p.memo,
       p.is_transfer,
       cat.id                             as category_id,
       cat.name                           as category,
       exists (
         select 1 from review_item ri
         where ri.entry_id = e.id and ri.state = 'pendiente'
       )                                  as needs_review,
       dim.items                          as dimensions
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
         select pd.dimension_id, pd.dimension_value_id, max(pd.weight_ppm) as weight_ppm
         from posting_dimension pd
         join posting sp on sp.id = pd.posting_id
         where sp.entry_id = p.entry_id
         group by pd.dimension_id, pd.dimension_value_id
       ) x
       join dimension d        on d.id  = x.dimension_id
       join dimension_value dv on dv.id = x.dimension_value_id
     ) dim on true
     where a.kind in ('asset', 'liability')
       and p.entry_id in (select entry_id from candidato)
     order by e.booked_on desc, p.id desc
     limit ${pLimite}`,
    [...seleccion.params, limite],
  )

  return rows.map((row) => ({
    entryId: row.entry_id,
    postingId: row.posting_id,
    bookedOn: row.booked_on,
    description: row.description,
    accountId: row.account_id,
    accountName: row.account_name,
    currency: row.currency,
    amount: BigInt(row.amount),
    baseAmount: toBigIntOrNull(row.base_amount),
    baseCurrency: row.base_currency,
    categoryId: row.category_id,
    category: row.category,
    isTransfer: row.is_transfer,
    source: row.source,
    memo: row.memo,
    needsReview: row.needs_review,
    dimensions: row.dimensions ?? [],
  }))
}

// ── Aplicar ─────────────────────────────────────────────────────────────────

/**
 * Aplica una regla guardada.
 *
 * `soloSinCategorizar` es obligatorio y no tiene valor por defecto a propósito:
 * es la decisión que separa "rellenar lo que falta" de "pisar lo que alguien ya
 * decidió", y quien llama tiene que haberla tomado.
 *
 * Una regla desactivada se puede aplicar a mano: desactivada significa que no
 * entra en la pasada automática, no que esté prohibida. Ejecutarla es un acto
 * explícito de alguien que la está mirando.
 */
export async function applyRule(
  client: TenantClient,
  ruleId: string,
  opts: ApplyRuleOptions,
): Promise<ApplyRuleResult> {
  assertUuid(ruleId, 'ruleId')
  const changedBy = assertAutor(opts.changedBy)
  if (typeof opts.soloSinCategorizar !== 'boolean') {
    throw new ClassifyError('soloSinCategorizar tiene que ser true o false, explícitamente.')
  }
  const tenantId = await currentTenant(client)
  const regla = await loadRule(client, ruleId)
  const ids = await coincidencias(client, regla, {
    entryIds: opts.entryIds,
    soloSinCategorizar: opts.soloSinCategorizar,
  })
  // Aplicar una regla a mano no reparte nada: la categoría y la atribución van
  // a los mismos movimientos, que son todos los que coinciden.
  const { changed, yaEstaban, omitidos } = await aplicarReglaSobre(
    client,
    regla,
    { categoria: ids, dimensiones: ids },
    { tenantId, changedBy },
  )
  return { changed, yaEstaban, omitidos }
}

interface AplicacionRegla extends ApplyRuleResult {
  /** Los movimientos que esta regla tocó, sea por categoría o por atribución. */
  readonly tocados: readonly string[]
}

/**
 * Aplica una regla a un conjunto de movimientos YA resuelto.
 *
 * Los ids se resuelven una sola vez, antes de tocar nada, y no se vuelven a
 * calcular entre la categoría y las dimensiones. No es una optimización: con
 * `soloSinCategorizar`, la primera operación saca a esos movimientos de la
 * bolsa de "Sin categorizar", así que volver a evaluar la condición devolvería
 * cero y las dimensiones no se pondrían en ninguna parte.
 *
 * Los dos conjuntos llegan por separado porque en una pasada de varias reglas
 * no siempre coinciden: la categoría de un movimiento la decide una sola regla,
 * pero una que sólo pone dimensiones no decide ninguna categoría y por tanto no
 * puede quitarle el movimiento a la que sí. Ver `applyAllRules`.
 */
async function aplicarReglaSobre(
  client: TenantClient,
  regla: RuleRow,
  ids: { categoria: readonly string[]; dimensiones: readonly string[] },
  opts: { tenantId: string; changedBy: string },
): Promise<AplicacionRegla> {
  let resultado: AplicacionCategoria = { changed: 0, yaEstaban: 0, cambiados: [], omitidos: [] }
  if (regla.categoryId !== null && ids.categoria.length > 0) {
    resultado = await aplicarCategoria(client, porIds(ids.categoria), {
      tenantId: opts.tenantId,
      categoryId: regla.categoryId,
      ruleId: regla.id,
      changedBy: opts.changedBy,
    })
  }

  if (regla.dimensions.length === 0 || ids.dimensiones.length === 0) {
    return { ...resultado, tocados: resultado.cambiados }
  }

  const { elegibles, omitidos } = await resolverPatas(client, porIds(ids.dimensiones))
  if (elegibles.length > 0) {
    await escribirDimensiones(client, {
      tenantId: opts.tenantId,
      changedBy: opts.changedBy,
      elegibles,
      asignaciones: regla.dimensions.map((dim) => ({
        dimensionId: dim.dimensionId,
        dimensionValueId: dim.valueId,
        weightPpm: dim.weightPpm,
      })),
    })
  }

  const atribuidos = elegibles.map((pata) => pata.entryId)
  return {
    // Una regla que sólo pone dimensiones también "cambió" esos movimientos:
    // devolver cero haría que la pasada dijera que no hizo nada.
    changed: regla.categoryId === null ? atribuidos.length : resultado.changed,
    yaEstaban: resultado.yaEstaban,
    omitidos: regla.categoryId === null ? omitidos : resultado.omitidos,
    tocados: [...new Set([...resultado.cambiados, ...atribuidos])],
  }
}

/**
 * El conjunto entero de reglas, en orden de prioridad. Es lo que corre detrás
 * de una importación nueva: `entryIds` acota la pasada a lo que acaba de entrar.
 *
 * La CATEGORÍA de un movimiento la decide UNA regla: la primera que lo alcance
 * en orden de prioridad. Por eso se recorren las reglas —decenas— y no los
 * movimientos —miles—, y cada una se aplica sobre lo que las anteriores no
 * reclamaron.
 *
 * Lo que se reclama, sin embargo, no es el movimiento entero sino cada cosa que
 * se le escribe: la categoría por un lado y cada dimensión por el suyo. Una
 * regla que sólo pone la propiedad no decide ninguna categoría, así que no
 * puede impedir que otra se la ponga. Reclamar el movimiento entero hacía que
 * una regla de atribución de prioridad alta dejara el movimiento sin
 * categorizar para siempre —y encima informara de que lo había cambiado—, que
 * es la peor combinación posible: trabajo perdido con parte de conformidad.
 *
 * Se recorre en TypeScript en vez de resolverlo con un DISTINCT ON sobre la
 * unión de todas las reglas porque cada regla lleva su propio operador de
 * comparación: la consulta única existiría, pero se armaría concatenando tantas
 * ramas como reglas haya y sería ilegible justo donde importa entender qué se
 * aplicó y por qué.
 */
export async function applyAllRules(
  client: TenantClient,
  opts: ApplyAllOptions,
): Promise<ApplyAllResult> {
  const changedBy = assertAutor(opts.changedBy)
  const soloSinCategorizar = opts.soloSinCategorizar !== false
  const entryIds =
    opts.entryIds === undefined ? undefined : assertEntryIds(opts.entryIds, 'entryIds')
  if (entryIds !== undefined && entryIds.length === 0) {
    return { changed: 0, porRegla: [], fallidas: [] }
  }

  const tenantId = await currentTenant(client)
  const reglas = await listRules(client, { soloActivas: true })

  const porRegla: { ruleId: string; name: string; changed: number }[] = []
  const fallidas: { ruleId: string; name: string; error: string }[] = []
  const categoriaTomada = new Set<string>()
  const dimensionTomada = new Map<string, Set<string>>()
  // Los movimientos, no las veces: el que una regla categoriza y otra atribuye
  // cambió una vez, y contarlo dos diría que la pasada tocó más libro del que
  // hay.
  const tocados = new Set<string>()

  for (const regla of reglas) {
    // Cada regla, entera, dentro de su propio savepoint. Sin él, "una regla
    // rota no tira la pasada" sería mentira: cualquier error de Postgres deja
    // la transacción abortada, y las reglas siguientes fallarían todas con
    // "current transaction is aborted". El informe diría que están rotas las
    // veinte cuando la rota es una.
    try {
      const hecho = await conSavepoint(client, async () => {
        const candidatos = await coincidenciasDe(client, regla, { entryIds, soloSinCategorizar })
        if (candidatos.length === 0) return null

        // La categoría ya la decidió una regla de mayor prioridad.
        const categoria =
          regla.categoryId === null ? [] : candidatos.filter((id) => !categoriaTomada.has(id))

        // La atribución se reclama por dimensión: una regla que pone la
        // propiedad no le quita a otra el derecho de poner la entidad. Se
        // aparta el movimiento sólo cuando TODAS las dimensiones que esta
        // regla escribiría ya las escribió una anterior, porque pisarlas
        // invertiría el orden de prioridad sin que nada lo dijera.
        const dims = regla.dimensions.map((dim) => dim.dimensionId)
        const dimensiones =
          dims.length === 0
            ? []
            : candidatos.filter((id) => dims.some((d) => dimensionTomada.get(d)?.has(id) !== true))

        if (categoria.length === 0 && dimensiones.length === 0) return null
        return {
          categoria,
          dimensiones,
          dims,
          resultado: await aplicarReglaSobre(
            client,
            regla,
            { categoria, dimensiones },
            { tenantId, changedBy },
          ),
        }
      })
      if (hecho === null) continue
      for (const id of hecho.categoria) categoriaTomada.add(id)
      for (const dimensionId of hecho.dims) {
        const tomados = dimensionTomada.get(dimensionId) ?? new Set<string>()
        for (const id of hecho.dimensiones) tomados.add(id)
        dimensionTomada.set(dimensionId, tomados)
      }
      for (const id of hecho.resultado.tocados) tocados.add(id)
      porRegla.push({ ruleId: regla.id, name: regla.name, changed: hecho.resultado.changed })
    } catch (error) {
      fallidas.push({ ruleId: regla.id, name: regla.name, error: mensaje(error) })
    }
  }

  return { changed: tocados.size, porRegla, fallidas }
}

function mensaje(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Los ids que coinciden. Sin savepoint: lo pone quien la llama si hace falta. */
async function coincidenciasDe(
  client: TenantClient,
  regla: RuleMatch,
  opts: { entryIds?: readonly string[] | undefined; soloSinCategorizar: boolean },
): Promise<string[]> {
  const seleccion = porRegla(regla, opts)
  const { rows } = await client.query<{ entry_id: string }>(seleccion.sql, [...seleccion.params])
  return rows.map((row) => row.entry_id)
}

async function coincidencias(
  client: TenantClient,
  regla: RuleMatch,
  opts: { entryIds?: readonly string[] | undefined; soloSinCategorizar: boolean },
): Promise<string[]> {
  if (regla.matchKind !== 'regex') return coincidenciasDe(client, regla, opts)
  try {
    return await conSavepoint(client, () => coincidenciasDe(client, regla, opts))
  } catch (error) {
    if (error instanceof ClassifyError) throw error
    throw errorDeRegex(regla.matchValue, error)
  }
}

// ── Lo que falta por categorizar ────────────────────────────────────────────

/**
 * Los descriptores sin categorizar, agrupados por comercio y ordenados por
 * impacto. Es la lista por la que se empieza a crear reglas: veinte líneas acá
 * suelen cubrir el ochenta por ciento de los movimientos de un alta.
 *
 * Se agrupa por moneda además de por comercio porque sumar euros con dólares
 * daría un número que no es dinero de nada — la misma regla que rige toda la
 * capa de lectura.
 */
export async function uncategorized(
  client: TenantClient,
  opts: { limit?: number | undefined } = {},
): Promise<UncategorizedResult> {
  const limite = clampInt(opts.limit, COMERCIOS_DEFECTO, 1, COMERCIOS_MAXIMOS)

  const { rows } = await client.query<{
    description: string
    amount: string
    currency: string
  }>(
    `select e.description, p.amount::text as amount, p.currency
       from posting p
       join entry e   on e.id = p.entry_id
       join account a on a.id = p.account_id
      where a.kind in ('asset', 'liability')
        and not p.is_transfer
        and exists (
          select 1
            from posting cp
            join account ca on ca.id = cp.account_id
           where cp.entry_id = p.entry_id
             and ca.kind in ('expense', 'income')
             and ${esSinCategorizar('ca')}
        )`,
  )

  interface Grupo {
    descripcion: string
    ejemplo: string
    veces: number
    importe: bigint
    currency: string
  }
  const grupos = new Map<string, Grupo>()
  for (const row of rows) {
    const { key, label } = claveDeComercio(row.description)
    const clave = `${row.currency} ${key}`
    const grupo = grupos.get(clave) ?? {
      descripcion: label,
      ejemplo: row.description,
      veces: 0,
      importe: 0n,
      currency: row.currency,
    }
    // El descriptor que se enseña es el MENOR alfabéticamente del grupo, y no
    // "el primero que salga". Sin ORDER BY, Postgres devuelve las filas en el
    // orden que le conviene; pero ordenar tampoco alcanzaría, porque "NETFLIX
    // REF 8812" y "NETFLIX REF 9903" son el mismo comercio el mismo día y
    // ningún criterio de fecha los desempata. El desempate tiene que salir del
    // contenido o la lista de trabajo pendiente cambia de texto entre dos
    // cargas de la misma pantalla.
    if (row.description < grupo.ejemplo) {
      grupo.ejemplo = row.description
      grupo.descripcion = label
    }
    grupo.veces += 1
    grupo.importe += BigInt(row.amount)
    grupos.set(clave, grupo)
  }

  // Por impacto, que es el valor absoluto: los cobros sin categorizar importan
  // tanto como los cargos, y su importe tiene el signo al revés.
  const ordenados = [...grupos.entries()].sort(([claveA, a], [claveB, b]) => {
    const absA = a.importe < 0n ? -a.importe : a.importe
    const absB = b.importe < 0n ? -b.importe : b.importe
    if (absA !== absB) return absA > absB ? -1 : 1
    return claveA.localeCompare(claveB)
  })

  return {
    total: rows.length,
    porComercio: ordenados.slice(0, limite).map(([, grupo]) => ({
      descripcion: grupo.descripcion,
      ejemplo: grupo.ejemplo,
      veces: grupo.veces,
      importe: grupo.importe,
      currency: grupo.currency,
    })),
    truncados: Math.max(0, ordenados.length - limite),
  }
}

/**
 * Clave de agrupación por comercio, y la etiqueta con la que mostrarlo.
 *
 * Es la misma que usa `topMerchants` en read-analysis.ts, y por la misma razón:
 * `descriptionTokens` quita el ruido —referencias, números de autorización,
 * fechas embebidas— que impide ver que "NETFLIX REF 8812" y "NETFLIX REF 9903"
 * son un solo comercio. La clave ordena los tokens y la etiqueta no: así "ZARA
 * ESPANA" y "ESPANA ZARA" caen en el mismo grupo, pero el nombre que se muestra
 * es el que el usuario reconoce en su extracto.
 */
function claveDeComercio(description: string): { key: string; label: string } {
  const tokens = [...descriptionTokens(description)]
  if (tokens.length > 0) {
    return { key: [...tokens].sort().join(' '), label: tokens.join(' ') }
  }
  const normalized = normalizeDescription(description)
  const fallback = normalized === '' ? 'SIN DESCRIPCION' : normalized
  return { key: fallback, label: fallback }
}

// ── Piezas ──────────────────────────────────────────────────────────────────

async function currentTenant(client: TenantClient): Promise<string> {
  const { rows } = await client.query<{ tenant_id: string | null }>(
    'select app_current_tenant() as tenant_id',
  )
  const tenantId = rows[0]?.tenant_id ?? null
  if (tenantId === null) {
    throw new ClassifyError(
      'No hay hogar fijado en la transacción: la clasificación tiene que correr dentro de withTenant.',
    )
  }
  return tenantId
}

/**
 * Que la categoría exista en ESTE hogar y sea de gasto o ingreso.
 *
 * La comprobación no es redundante con la clave foránea: las FK de Postgres se
 * evalúan por encima de RLS, así que un id de otro hogar pasaría el control de
 * integridad sin que la policy lo vea. Y la clase importa porque apuntar una
 * contrapartida a una cuenta de activo convertiría el gasto en un traspaso
 * silencioso.
 *
 * Lo que NO se comprueba es que la moneda de la categoría coincida con la del
 * movimiento, y conviene saber qué se está aceptando: el importador abre una
 * bolsa de "Sin categorizar" por divisa, así que mandar un cargo en dólares a
 * "Restaurantes" —que está en euros— deja un posting en USD colgado de una
 * cuenta en EUR. Se acepta a propósito por tres razones:
 *
 *  · una categoría es una taxonomía, no una cuenta con saldo, y exigir que
 *    coincidan partiría "Restaurantes" en una por divisa;
 *  · los informes no se apoyan en la moneda de la CUENTA sino en la del
 *    posting, con `base_amount` cuando hay que consolidar (`convertedAmount` en
 *    read-analysis.ts), así que el gasto sigue contando bien;
 *  · el asiento sigue balanceando a cero por moneda, que es el invariante de
 *    verdad, porque el importe y la divisa del posting no se tocan.
 *
 * Lo que sí queda raro es el saldo de esa categoría, y no se esconde:
 * `accountBalances` suma sólo lo que está en la moneda de la cuenta y publica
 * el resto como `foreign_postings`, que la pantalla de cuentas enseña.
 */
async function assertCategoria(client: TenantClient, categoryId: string): Promise<void> {
  const { rows } = await client.query<{ kind: string; name: string }>(
    'select kind, name from account where id = $1::uuid',
    [categoryId],
  )
  const cuenta = rows[0]
  if (cuenta === undefined) {
    throw new ClassifyError(`La categoría ${categoryId} no existe en este hogar.`)
  }
  if (cuenta.kind !== 'expense' && cuenta.kind !== 'income') {
    throw new ClassifyError(
      `"${cuenta.name}" es una cuenta de tipo ${cuenta.kind}, no una categoría. ` +
        'Una categoría es una cuenta de gasto o de ingreso.',
    )
  }
}

async function assertCuentaBancaria(client: TenantClient, accountId: string): Promise<void> {
  const { rows } = await client.query<{ kind: string; name: string }>(
    'select kind, name from account where id = $1::uuid',
    [accountId],
  )
  const cuenta = rows[0]
  if (cuenta === undefined) {
    throw new ClassifyError(`La cuenta ${accountId} no existe en este hogar.`)
  }
  if (cuenta.kind !== 'asset' && cuenta.kind !== 'liability') {
    throw new ClassifyError(
      `"${cuenta.name}" es de tipo ${cuenta.kind}: una regla se limita a una cuenta bancaria ` +
        '(activo o pasivo), que es la que aparece en el extracto.',
    )
  }
}
