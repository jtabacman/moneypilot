/**
 * La memoria del hogar: aprender de lo que esta familia ya decidió, sin modelo.
 *
 * Si el hogar mandó tres veces un comercio a "Vivienda > Suministros > Luz y
 * gas", el cuarto va solo. Eso es todo. No hay entrenamiento, no hay pesos y no
 * hay nada que no se pueda enseñar en una frase: la respuesta a "¿por qué esta
 * categoría?" es "porque usted la puso ahí siete veces, la última el martes".
 *
 * El diccionario de comercios sabe lo que es cierto para cualquier familia
 * (Iberdrola es luz). Esto sabe lo que es cierto **para ésta** (el seguro del
 * coche va a la sociedad, no a gasto personal), que es justamente lo que ningún
 * diccionario ni ningún agregador puede saber y lo que hace que el producto
 * mejore con el uso.
 *
 * ── Precaución 1: sólo cuenta lo que decidió una persona ────────────────────
 *
 * Es la que sostiene todo lo demás. Si la memoria se alimentara de sus propias
 * propuestas, el primer error se confirmaría a sí mismo hasta volverse "la
 * verdad del hogar", y con cada pasada estaría más seguro de estar equivocado.
 * Una decisión cuenta como humana cuando cumple **las tres**:
 *
 *   1. `rule_id is null` — no la escribió una regla.
 *   2. `changed_by` no empieza por `sistema:` — no la escribió un automatismo.
 *      Ver `autorAutomatico`: quien aplique una propuesta de la memoria o del
 *      diccionario **tiene que** firmar así, y si no lo hace, esta capa se
 *      empieza a creer a sí misma. Es la única obligación que este módulo le
 *      impone a los demás y no hay forma de comprobarla desde acá.
 *   3. `from_account_id is distinct from to_account_id` — movió la categoría de
 *      verdad. Las filas con origen y destino iguales son cambios de
 *      atribución, no de categoría (ver 006_clasificacion.sql).
 *
 * Y dos filtros más que no son sobre el autor sino sobre la decisión:
 *
 *   · **La última palabra de cada movimiento, no todas.** `classification_change`
 *     es un registro: si alguien puso "Ocio" y al rato lo corrigió a
 *     "Supermercado", las dos filas están ahí. Contarlas las dos haría que el
 *     comercio pareciera ambiguo para siempre por culpa de un error que ya se
 *     arregló. Se toma la más reciente por movimiento y se ignoran las
 *     anteriores.
 *   · **Decisiones que siguen en pie.** Si después de la persona pasó algo que
 *     movió esa pata a otro sitio, lo que hay hoy en el libro no es lo que ella
 *     decidió, y la memoria tiene que parecerse al libro. Se exige que la pata
 *     siga apuntando a la cuenta que eligió.
 *   · **Mandar algo a "Sin categorizar" no es una decisión.** Es decir "no sé",
 *     y aprender de eso sería aprender a no clasificar.
 *
 * ── Precaución 2: unanimidad ────────────────────────────────────────────────
 *
 * Si el mismo comercio fue a dos categorías, no se propone nada automático: se
 * ofrecen las dos, con cuántas veces fue a cada una, para que elija una
 * persona. Amazon y El Corte Inglés son ambiguos de verdad, y en un hogar
 * concreto lo son todavía más — la misma tienda es material de oficina de la
 * sociedad un martes y un regalo el sábado. Adivinar ahí no ahorra trabajo:
 * lo cambia por trabajo de revisión, que es más caro.
 *
 * La unanimidad es estricta. Un 20 contra 1 no propone solo. Es deliberado y
 * tiene un coste conocido —un despiste antiguo bloquea un comercio hasta que
 * alguien lo corrija—, y a cambio no hay ningún umbral de mayoría que discutir
 * ni ninguna sorpresa que explicar.
 *
 * ── Precaución 3: las dimensiones viajan con la categoría ───────────────────
 *
 * Categorizar es media respuesta. En este producto el gasto además se imputa a
 * una propiedad, a una persona o a una entidad, y una propuesta que ponga la
 * categoría y deje la atribución vacía deja el trabajo a medias justo en lo que
 * diferencia al producto.
 *
 * Viajan con la misma exigencia de unanimidad, dimensión por dimensión: se
 * propone la propiedad si **todos** los movimientos recordados de ese comercio
 * y esa categoría llevan exactamente la misma —mismos valores y mismos pesos—,
 * y si uno discrepa, esa dimensión no viaja y las demás sí.
 *
 * Hay una asimetría declarada acá: la categoría exige decisión humana y la
 * atribución que la acompaña se lee del estado actual de esos movimientos, la
 * haya puesto una persona o una regla. No es lo mismo y no se disimula: la
 * atribución no se está infiriendo, se está copiando de unos movimientos
 * concretos que el hogar tiene delante y puede ver.
 *
 * ── El umbral ───────────────────────────────────────────────────────────────
 *
 * Tres. Es una decisión de producto y se justifica en `MINIMO_POR_DEFECTO`.
 *
 * ── Qué es "el mismo comercio" ──────────────────────────────────────────────
 *
 * Lo que diga `merchantKey`, ni más ni menos. Esa función agrupa con la clave
 * entera y conserva los números cortos, porque "STUDIO 54" es un nombre: la
 * consecuencia es que un banco que numere cada cargo sin anunciarlo con una
 * palabra de referencia deja un comercio distinto por movimiento, y entonces la
 * memoria no aprende. Es el lado barato de equivocarse —fragmentar en vez de
 * confundir— y se arregla en la limpieza, que es de `merchant.ts`, no aflojando
 * el criterio acá.
 *
 * ── Lo que esta capa NO ve, y conviene saberlo ──────────────────────────────
 *
 * Un movimiento creado a mano con su categoría ya puesta (`bookTransaction`) no
 * deja fila en `classification_change`, así que esa decisión —que es humana y
 * de las mejores— no entra en la memoria. No se arregla acá inventando una
 * heurística sobre el libro: se arregla escribiendo la auditoría donde se toma
 * la decisión.
 */

import { canonicalMerchant, merchantKey } from '@moneypilot/core'
import type { TenantClient } from '../client.js'
import type { RuleDimensionRow } from './classify.js'
import { categoryTree } from './read-ledger.js'

// ── Quién es una persona ────────────────────────────────────────────────────

/**
 * Prefijo con el que firman los automatismos en `classification_change`.
 *
 * `changed_by` es texto libre y hoy lleva el correo de quien clasificó (ver
 * `autor()` en las acciones de la web). Un prefijo reservado con dos puntos no
 * choca con ningún correo ni con ningún uuid, así que distingue a la persona
 * del proceso sin migrar la tabla ni añadir una columna que habría que
 * rellenar hacia atrás.
 *
 * Ojo con el caso que parece un contraejemplo y no lo es: cuando alguien
 * **confirma** en pantalla una propuesta de la memoria, eso sí es una decisión
 * humana y se firma con su correo. Lo que no puede firmarse como persona es lo
 * que se aplicó sin que nadie lo mirara.
 */
export const AUTOR_AUTOMATICO = 'sistema:'

/** `autorAutomatico('memoria')` → `'sistema:memoria'`. */
export function autorAutomatico(quien: string): string {
  const limpio = quien.trim()
  if (limpio === '') throw new MemoriaError('Un autor automático necesita nombre.')
  return `${AUTOR_AUTOMATICO}${limpio}`
}

export function esAutorAutomatico(changedBy: string): boolean {
  return changedBy.trim().toLowerCase().startsWith(AUTOR_AUTOMATICO)
}

/**
 * Cuántas veces hace falta antes de proponer algo solo.
 *
 * Tres, y el razonamiento es de producto y no estadístico:
 *
 *  · **Una vez es un hecho, no una costumbre.** El primer cargo de un comercio
 *    nuevo puede ir a cualquier sitio; proponer con uno convierte cualquier
 *    excepción en la norma del hogar.
 *  · **Dos veces puede ser la misma tarde.** Lo normal al empezar es
 *    categorizar un lote entero de golpe, y ahí "dos" no es repetición: es un
 *    clic.
 *  · **Tres ya es un patrón que el usuario reconoce como suyo**, y sobre todo
 *    es el número que se puede explicar en una frase en la pantalla: "lo has
 *    mandado ahí tres veces, ¿lo hago yo a partir de ahora?".
 *
 * Es configurable por llamada (`minimo`) porque no es una verdad: es un ajuste,
 * y un hogar que importa quince años de historia probablemente quiera más.
 */
export const MINIMO_POR_DEFECTO = 3

// ── Contrato público ────────────────────────────────────────────────────────

/**
 * Una dimensión recordada, con la misma forma que las de una regla, para que se
 * pueda pasar a `setDimensions` sin traducir nada por el camino.
 */
export type DimensionRecordada = RuleDimensionRow

export interface OpcionDeCategoria {
  readonly categoryId: string
  /** Ruta completa, "Vivienda > Suministros > Luz y gas": es lo que se enseña. */
  readonly categoria: string
  /** Movimientos de este comercio que una persona mandó a esta categoría. */
  readonly veces: number
  /**
   * Actos distintos de clasificación, que no es lo mismo que `veces`: mandar
   * cuarenta movimientos de golpe es una decisión, no cuarenta. Se publica para
   * que la pantalla pueda decir la verdad ("en una sola vez") y para que
   * endurecer el umbral el día de mañana sea cambiar de campo.
   */
  readonly decisiones: number
  /** Instante ISO de la última vez. Acá el instante completo sí es lo correcto. */
  readonly ultimaVez: string
  /** Sólo las dimensiones en las que TODOS esos movimientos coinciden. */
  readonly dimensiones: readonly DimensionRecordada[]
}

export interface RecuerdoDeComercio {
  /** Clave canónica del comercio (`merchantKey`). Es la que agrupa. */
  readonly clave: string
  /** El nombre tal como se lee en el extracto. */
  readonly comercio: string
  /** Movimientos con decisión humana de este comercio, en todas las categorías. */
  readonly veces: number
  readonly decisiones: number
  /** Todas las decisiones fueron a la misma categoría. */
  readonly unanime: boolean
  /** Llegó al umbral. Se cuenta sobre `veces`, no sobre `decisiones`. */
  readonly suficiente: boolean
  /**
   * La opción que se puede aplicar sin preguntar: unánime y por encima del
   * umbral. `null` significa que hay que preguntar, y entonces `opciones` es lo
   * que se ofrece.
   */
  readonly automatica: OpcionDeCategoria | null
  /** Todas las categorías que este hogar usó, la más usada primero. */
  readonly opciones: readonly OpcionDeCategoria[]
}

/** Lo mínimo que hace falta de un movimiento para buscarle memoria. */
export interface MovimientoAClasificar {
  readonly entryId: string
  /** El descriptor tal como lo escribió el banco. */
  readonly description: string
}

export interface Propuesta {
  readonly entryId: string
  readonly recuerdo: RecuerdoDeComercio
  /**
   * Por qué, en castellano llano y con los números delante. Es el texto que
   * contesta "¿por qué esta categoría?" y el que se enseña al usuario tal cual:
   * si no se puede escribir la frase, la propuesta no debería existir.
   */
  readonly motivo: string
}

export interface MemoriaOptions {
  /** Cuántas veces hacen falta. Por defecto `MINIMO_POR_DEFECTO`. */
  readonly minimo?: number | undefined
}

export class MemoriaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MemoriaError'
  }
}

// ── Recordar ────────────────────────────────────────────────────────────────

interface FilaDeDecision {
  posting_id: string
  category_id: string
  description: string
  changed_at: Date
  changed_by: string
  dimensiones: DimensionRecordada[] | null
}

/**
 * Lo que este hogar ya decidió, agrupado por comercio.
 *
 * Devuelve **todos** los comercios recordados, también los que no llegan al
 * umbral y los que no son unánimes, con la bandera puesta. Filtrarlos acá
 * dejaría a la pantalla sin poder decir "te falta una vez" ni "elegí entre
 * estas dos", que es la mitad del valor.
 *
 * Una sola consulta y el agrupado en memoria, igual que `uncategorized`: la
 * clave de comercio la calcula `merchantKey`, que es JavaScript, así que
 * agrupar en SQL exigiría reimplementarla en plpgsql y mantener dos copias de
 * la misma limpieza. La consulta trae una fila por decisión vigente, que son
 * como mucho tantas como movimientos clasificados a mano tenga el hogar.
 */
export async function recordarPorComercio(
  client: TenantClient,
  opts: MemoriaOptions = {},
): Promise<RecuerdoDeComercio[]> {
  const minimo = validarMinimo(opts.minimo)

  const { rows } = await client.query<FilaDeDecision>(
    `with humano as (
       -- Una fila por movimiento: la última palabra de la persona. El
       -- 'distinct on' necesita que el orden empiece por la misma columna.
       select distinct on (cc.posting_id)
              cc.posting_id, cc.to_account_id, cc.changed_at, cc.changed_by
         from classification_change cc
        where cc.rule_id is null
          and cc.to_account_id is not null
          and cc.from_account_id is distinct from cc.to_account_id
          and not starts_with(lower(cc.changed_by), $1::text)
        order by cc.posting_id, cc.changed_at desc, cc.id desc
     ),
     vigente as (
       select h.posting_id, h.to_account_id as category_id, h.changed_at, h.changed_by,
              p.entry_id
         from humano h
         -- La igualdad en el join es el filtro de "la decisión sigue en pie":
         -- si algo movió la pata después, esta fila no sale.
         join posting p  on p.id = h.posting_id and p.account_id = h.to_account_id
         join account a  on a.id = h.to_account_id
        where a.kind in ('expense', 'income')
          -- Las bolsas del importador se reconocen por nombre porque no hay
          -- otra cosa por la que reconocerlas: acá una categoría es una cuenta
          -- y ninguna columna la marca. La misma comprobación está en
          -- esSinCategorizar() de classify.ts y en la de la web; el día que sea
          -- una columna hay que tocar los tres sitios.
          and not (a.name in ('Sin categorizar', 'Ingresos sin categorizar')
                   or a.name like 'Sin categorizar (%)'
                   or a.name like 'Ingresos sin categorizar (%)')
     )
     select v.posting_id::text as posting_id,
            v.category_id,
            e.description,
            v.changed_at,
            v.changed_by,
            dim.items as dimensiones
       from vigente v
       join entry e on e.id = v.entry_id
       left join lateral (
         select coalesce(
                  json_agg(
                    json_build_object(
                      'dimensionId', d.id,
                      'key',         d.key,
                      'label',       d.label,
                      'valueId',     dv.id,
                      'value',       dv.label,
                      'weightPpm',   pd.weight_ppm
                    ) order by d.position, d.key, dv.label
                  ),
                  '[]'::json
                ) as items
           from posting_dimension pd
           join dimension d        on d.id  = pd.dimension_id
           join dimension_value dv on dv.id = pd.dimension_value_id
          where pd.posting_id = v.posting_id
       ) dim on true`,
    [AUTOR_AUTOMATICO],
  )

  if (rows.length === 0) return []

  const rutas = await rutasDeCategoria(client)
  return agrupar(rows, rutas, minimo)
}

/** id de cuenta → ruta completa. Sin ella, la memoria hablaría en uuid. */
async function rutasDeCategoria(client: TenantClient): Promise<Map<string, string>> {
  const nodos = await categoryTree(client)
  return new Map(nodos.map((nodo) => [nodo.id, nodo.path]))
}

/**
 * Separador de unidad (0x1F), escrito como escape a propósito y por el mismo
 * motivo que en `identity.ts`: un carácter de control literal en el fuente es
 * invisible al leerlo y cualquier formateador se lo puede comer. Va entre los
 * dos campos de la clave para que dos pares distintos no puedan producir la
 * misma cadena al concatenarse.
 */
const SEPARADOR = '\u001F'

interface AcumuladorCategoria {
  readonly categoryId: string
  veces: number
  readonly decisiones: Set<string>
  ultimaVez: string
  /**
   * Dimensión → cómo estaba atribuido el primer movimiento, y sus filas. Se van
   * borrando las que discrepan; lo que queda al final es lo unánime.
   */
  firmas: Map<string, { firma: string; filas: DimensionRecordada[] }> | null
}

interface AcumuladorComercio {
  readonly clave: string
  etiqueta: string
  readonly decisiones: Set<string>
  readonly porCategoria: Map<string, AcumuladorCategoria>
}

function agrupar(
  filas: readonly FilaDeDecision[],
  rutas: ReadonlyMap<string, string>,
  minimo: number,
): RecuerdoDeComercio[] {
  const comercios = new Map<string, AcumuladorComercio>()

  for (const fila of filas) {
    const comercio = canonicalMerchant({ description: fila.description })
    // La cadena vacía es "no hay comercio identificable", y agrupar por ella
    // metería en el mismo cajón todo lo ilegible del hogar. Ver merchant.ts.
    if (comercio.key === '') continue

    const grupo = comercios.get(comercio.key) ?? {
      clave: comercio.key,
      etiqueta: comercio.label,
      decisiones: new Set<string>(),
      porCategoria: new Map<string, AcumuladorCategoria>(),
    }
    // El nombre que se enseña es el menor alfabéticamente del grupo, no el
    // primero que devuelva Postgres: sin un criterio que salga del contenido,
    // la misma pantalla cambiaría de texto entre dos cargas.
    if (comercio.label < grupo.etiqueta) grupo.etiqueta = comercio.label

    const cuando = fila.changed_at.toISOString()
    // Un acto de clasificación es "esta persona en esta transacción":
    // `now()` es el instante de la transacción, así que las cuarenta filas
    // de un lote comparten instante y cuentan como UNA decisión.
    const acto = `${fila.changed_by}${SEPARADOR}${cuando}`
    grupo.decisiones.add(acto)

    const categoria = grupo.porCategoria.get(fila.category_id) ?? {
      categoryId: fila.category_id,
      veces: 0,
      decisiones: new Set<string>(),
      ultimaVez: cuando,
      firmas: null,
    }
    categoria.veces += 1
    categoria.decisiones.add(acto)
    if (cuando > categoria.ultimaVez) categoria.ultimaVez = cuando
    categoria.firmas = cruzarDimensiones(categoria.firmas, fila.dimensiones ?? [])

    grupo.porCategoria.set(fila.category_id, categoria)
    comercios.set(comercio.key, grupo)
  }

  const salida: RecuerdoDeComercio[] = []
  for (const grupo of comercios.values()) {
    const opciones = [...grupo.porCategoria.values()]
      .map((categoria) => aOpcion(categoria, rutas))
      .sort(compararOpciones)
    const veces = opciones.reduce((total, opcion) => total + opcion.veces, 0)
    const unanime = opciones.length === 1
    const suficiente = veces >= minimo
    const primera = opciones[0]
    salida.push({
      clave: grupo.clave,
      comercio: grupo.etiqueta,
      veces,
      decisiones: grupo.decisiones.size,
      unanime,
      suficiente,
      automatica: unanime && suficiente && primera !== undefined ? primera : null,
      opciones,
    })
  }

  return salida.sort((a, b) => {
    if (a.veces !== b.veces) return b.veces - a.veces
    return a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0
  })
}

/**
 * Deja sólo las dimensiones en las que este movimiento coincide con los
 * anteriores.
 *
 * La firma incluye el peso además del valor: un 60/40 entre la persona y la
 * sociedad no es lo mismo que un 100% a la persona, y proponer el reparto
 * equivocado es peor que no proponer ninguno.
 *
 * Una dimensión que el primer movimiento no llevaba no entra nunca, aunque los
 * demás la lleven: "todos coinciden" incluye al que no tiene nada.
 */
function cruzarDimensiones(
  acumulado: AcumuladorCategoria['firmas'],
  dimensiones: readonly DimensionRecordada[],
): AcumuladorCategoria['firmas'] {
  const actual = new Map<string, { firma: string; filas: DimensionRecordada[] }>()
  for (const dimension of dimensiones) {
    const entrada = actual.get(dimension.dimensionId) ?? { firma: '', filas: [] }
    entrada.filas.push(dimension)
    actual.set(dimension.dimensionId, entrada)
  }
  for (const entrada of actual.values()) {
    entrada.firma = entrada.filas
      .map((fila) => `${fila.valueId}:${fila.weightPpm}`)
      .sort()
      .join('|')
  }

  if (acumulado === null) return actual
  for (const [dimensionId, entrada] of acumulado) {
    if (actual.get(dimensionId)?.firma !== entrada.firma) acumulado.delete(dimensionId)
  }
  return acumulado
}

function aOpcion(
  categoria: AcumuladorCategoria,
  rutas: ReadonlyMap<string, string>,
): OpcionDeCategoria {
  const dimensiones: DimensionRecordada[] = []
  for (const entrada of categoria.firmas?.values() ?? []) dimensiones.push(...entrada.filas)
  return {
    categoryId: categoria.categoryId,
    // El árbol no la trae si la cuenta se borró entre las dos consultas. El
    // uuid es feo pero es la verdad; inventar un nombre sería peor.
    categoria: rutas.get(categoria.categoryId) ?? categoria.categoryId,
    veces: categoria.veces,
    decisiones: categoria.decisiones.size,
    ultimaVez: categoria.ultimaVez,
    dimensiones,
  }
}

function compararOpciones(a: OpcionDeCategoria, b: OpcionDeCategoria): number {
  if (a.veces !== b.veces) return b.veces - a.veces
  if (a.ultimaVez !== b.ultimaVez) return a.ultimaVez > b.ultimaVez ? -1 : 1
  return a.categoria < b.categoria ? -1 : a.categoria > b.categoria ? 1 : 0
}

// ── Proponer ────────────────────────────────────────────────────────────────

/**
 * Qué diría la memoria de estos movimientos.
 *
 * No escribe nada: devuelve propuestas con su motivo escrito. Quien aplique
 * decide, y si aplica sin preguntar tiene que firmar con `autorAutomatico` para
 * que la memoria no se coma su propia cola.
 *
 * No mira si el movimiento ya tiene categoría, porque no lo sabe: llegan el id
 * y el descriptor, nada más. Quien llama es el que sabe si está rellenando
 * huecos o pisando trabajo hecho, igual que en `applyRule` con
 * `soloSinCategorizar`. La lista natural para pasarle acá es la que devuelve
 * `uncategorized`.
 */
export async function proponerPorMemoria(
  client: TenantClient,
  movimientos: readonly MovimientoAClasificar[],
  opts: MemoriaOptions = {},
): Promise<Propuesta[]> {
  const minimo = validarMinimo(opts.minimo)
  if (!Array.isArray(movimientos)) {
    throw new MemoriaError('movimientos tiene que ser una lista.')
  }
  if (movimientos.length === 0) return []

  const recuerdos = await recordarPorComercio(client, { minimo })
  if (recuerdos.length === 0) return []
  const porClave = new Map(recuerdos.map((recuerdo) => [recuerdo.clave, recuerdo]))

  const propuestas: Propuesta[] = []
  const vistos = new Set<string>()
  for (const movimiento of movimientos) {
    const entryId = typeof movimiento.entryId === 'string' ? movimiento.entryId.trim() : ''
    if (entryId === '') {
      throw new MemoriaError('Cada movimiento necesita su entryId.')
    }
    // El mismo movimiento dos veces en la lista produciría dos propuestas
    // idénticas, y quien las cuente diría que la memoria alcanza a más libro
    // del que hay.
    if (vistos.has(entryId)) continue
    vistos.add(entryId)

    const descripcion = typeof movimiento.description === 'string' ? movimiento.description : ''
    const clave = merchantKey(descripcion)
    if (clave === '') continue
    const recuerdo = porClave.get(clave)
    if (recuerdo === undefined) continue

    propuestas.push({ entryId, recuerdo, motivo: motivoDe(recuerdo, minimo) })
  }
  return propuestas
}

/**
 * La frase que se le enseña al usuario. Se arma acá y no en la pantalla porque
 * los números y la regla que los interpreta viven acá: partirlos garantiza que
 * un día digan cosas distintas.
 */
function motivoDe(recuerdo: RecuerdoDeComercio, minimo: number): string {
  const veces = (opcion: OpcionDeCategoria): string =>
    opcion.veces === 1 ? '1 vez' : `${opcion.veces} veces`

  if (!recuerdo.unanime) {
    const detalle = recuerdo.opciones
      .map((opcion) => `«${opcion.categoria}» (${veces(opcion)})`)
      .join(' y ')
    return (
      `Este hogar mandó «${recuerdo.comercio}» a ${recuerdo.opciones.length} categorías ` +
      `distintas: ${detalle}. Como no hay una sola respuesta, la elige una persona.`
    )
  }

  const unica = recuerdo.opciones[0]
  if (unica === undefined) return `No hay ninguna decisión registrada sobre «${recuerdo.comercio}».`

  if (!recuerdo.suficiente) {
    return (
      `Este hogar mandó «${recuerdo.comercio}» a «${unica.categoria}» ${veces(unica)}, y hacen ` +
      `falta ${minimo} para proponerlo solo.`
    )
  }

  const actos =
    unica.decisiones === 1 ? 'en una sola vez' : `en ${unica.decisiones} decisiones distintas`
  const conDimensiones =
    unica.dimensiones.length === 0
      ? ''
      : ` Con ${unica.dimensiones.map((d) => `${d.label}: ${d.value}`).join(', ')}.`
  return (
    `Este hogar mandó «${recuerdo.comercio}» a «${unica.categoria}» ${veces(unica)} ` +
    `(${actos}) y nunca a otra categoría.${conDimensiones}`
  )
}

function validarMinimo(minimo: number | undefined): number {
  if (minimo === undefined) return MINIMO_POR_DEFECTO
  if (!Number.isInteger(minimo) || minimo < 1) {
    throw new MemoriaError(
      `minimo tiene que ser un entero de 1 para arriba y llegó ${String(minimo)}. ` +
        'Con cero, la primera vez que alguien clasifica algo la memoria ya lo da por costumbre.',
    )
  }
  return minimo
}
