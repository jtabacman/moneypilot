/**
 * Lo que comparten la pantalla de movimientos y su acción de clasificar.
 *
 * Vive fuera de actions.ts por una razón del framework y no de gusto: un
 * módulo con 'use server' sólo puede exportar funciones asíncronas, así que un
 * tipo o una constante compartida no caben ahí. Es el mismo motivo por el que
 * existe dimensiones/state.ts.
 *
 * El resultado de clasificar viaja de vuelta en la query string y no en una
 * cookie ni en estado de cliente. La razón es la misma que gobierna toda esta
 * pantalla: el formulario funciona sin JavaScript, así que después de escribir
 * hay una redirección de verdad, y lo único que sobrevive a una redirección sin
 * inventar infraestructura es la URL.
 */

import { aQuery, type Filtros, type SearchParams } from './filters'

/* ── Quién clasifica ─────────────────────────────────────────────────────── */

/**
 * B6: el titular y la pareja escriben; el contador y el asistente **proponen**,
 * y su propuesta la aprueba el titular.
 *
 * Ese circuito de propuestas todavía no existe, y mientras no exista lo
 * correcto es no dejar escribir — no dejar escribir directo y llamarlo
 * equivalente. Lo que sí se hace es explicarlo en la pantalla en vez de
 * esconder el botón: un control que desaparece sin motivo se lee como una
 * avería, y el usuario no aprende nada sobre cómo funciona su hogar.
 */
export function puedeClasificar(role: string): boolean {
  return role === 'titular' || role === 'pareja'
}

/* ── La bolsa del importador ─────────────────────────────────────────────── */

/**
 * ¿Es una de las bolsas donde cae lo que el importador no supo clasificar?
 *
 * Se reconocen por el nombre porque no hay otra cosa por la que reconocerlas:
 * acá una categoría **es** una cuenta y ninguna columna la marca como bolsa.
 * Los nombres son los de import.ts (SUSPENSE_OUTFLOW_NAME y
 * SUSPENSE_INFLOW_NAME) y la variante con la moneda entre paréntesis existe
 * porque el unique de cuenta es (hogar, nombre): hace falta una bolsa por
 * divisa. La misma comprobación, escrita en SQL, está en `esSinCategorizar()`
 * de classify.ts; si algún día esto pasa a ser una columna, hay que tocar los
 * dos sitios.
 */
export function esSinCategorizar(nombre: string): boolean {
  return (
    nombre === 'Sin categorizar' ||
    nombre === 'Ingresos sin categorizar' ||
    nombre.startsWith('Sin categorizar (') ||
    nombre.startsWith('Ingresos sin categorizar (')
  )
}

/* ── Opciones de dimensión ───────────────────────────────────────────────── */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface Opcion {
  readonly dimensionId: string
  /** `null` es «quitá esta dimensión», que es una opción del desplegable. */
  readonly valueId: string | null
}

/**
 * Un `<option>` sólo devuelve una cadena, y para atribuir hacen falta dos
 * datos: qué dimensión y qué valor. Viajan juntos separados por dos puntos —un
 * uuid no lleva ninguno— para que el que llega no tenga que buscar a qué
 * dimensión pertenece el valor. Buscarlo en el cliente y confiar en eso sería
 * además una decisión sin comprobar: `setDimensions` rechaza el cruce, pero el
 * mensaje sería mucho peor que no cometer el error.
 */
export function valorOpcion(dimensionId: string, valueId: string | null): string {
  return `${dimensionId}:${valueId ?? ''}`
}

export function leerOpcion(bruto: string): Opcion | null {
  const corte = bruto.indexOf(':')
  if (corte === -1) return null
  const dimensionId = bruto.slice(0, corte)
  const valueId = bruto.slice(corte + 1)
  if (!UUID.test(dimensionId)) return null
  if (valueId === '') return { dimensionId, valueId: null }
  if (!UUID.test(valueId)) return null
  return { dimensionId, valueId }
}

/* ── El resultado de una pasada ──────────────────────────────────────────── */

/** Por qué una pasada no hizo nada. El texto vive en MENSAJE_AVISO. */
export type Aviso =
  /** El rol de la sesión propone, no escribe. */
  | 'rol'
  /** No llegó ningún movimiento marcado. */
  | 'nada'
  /** Ni categoría ni dimensiones: no había nada que aplicar. */
  | 'sin-destino'
  /** Más movimientos de los que caben en una página. */
  | 'demasiados'
  /** Dos valores de la misma dimensión: eso es un reparto, y no se inventa. */
  | 'repartida'
  /** Algo llegó mal formado. */
  | 'datos'
  /** La base rechazó el cambio; el motivo va en `detalle`. */
  | 'base'

const AVISOS: readonly Aviso[] = [
  'rol',
  'nada',
  'sin-destino',
  'demasiados',
  'repartida',
  'datos',
  'base',
]

/** Cada mensaje se lee después de «No se cambió nada», así que no lo repite. */
export const MENSAJE_AVISO: Record<Aviso, string> = {
  rol: 'Tu rol propone cambios, no los escribe.',
  nada: 'No marcaste ningún movimiento.',
  'sin-destino': 'No elegiste categoría ni dimensión: no había nada que aplicarles.',
  demasiados:
    'Llegaron más movimientos de los que muestra una página. Trabajá de a una página: aplicar ' +
    'a una parte y contarlo como el todo es justo lo que esta pantalla no hace.',
  repartida:
    'Elegiste dos valores de la misma dimensión. Eso es un reparto —60/40 entre la persona y ' +
    'la sociedad, por ejemplo— y el peso de cada parte lo tenés que decir vos: repartir mitad ' +
    'y mitad por nuestra cuenta sería inventar un dato que nadie escribió.',
  datos: 'Algo del formulario llegó mal formado.',
  base: 'La base rechazó el cambio.',
}

export interface Resultado {
  /** Movimientos que se pidió clasificar. */
  readonly pedidos: number
  /** Los que cambiaron de categoría de verdad. */
  readonly cambiados: number
  /** Los que ya estaban en esa categoría: ni se tocan ni dejan auditoría. */
  readonly yaEstaban: number
  /** Aquellos en los que se reescribió la atribución por dimensiones. */
  readonly conDimensiones: number
  /** Omitidos por no tener pata de gasto ni de ingreso (traspasos, aperturas). */
  readonly sinContrapartida: number
  /** Omitidos porque el asiento reparte entre varias categorías. */
  readonly repartos: number
  /** Omitidos porque el asiento ya no existe. */
  readonly inexistentes: number
  /** Categoría de destino, para poder nombrarla en la confirmación. */
  readonly categoryId: string | null
  /** Valores de dimensión aplicados. */
  readonly valores: readonly string[]
  /** Dimensiones cuya atribución se quitó. */
  readonly quitadas: readonly string[]
  readonly aviso: Aviso | null
  /** Detalle del aviso: el rol, o el motivo que dio la base. */
  readonly detalle: string | null
}

export const SIN_RESULTADO: Resultado = {
  pedidos: 0,
  cambiados: 0,
  yaEstaban: 0,
  conDimensiones: 0,
  sinContrapartida: 0,
  repartos: 0,
  inexistentes: 0,
  categoryId: null,
  valores: [],
  quitadas: [],
  aviso: null,
  detalle: null,
}

export function conAviso(aviso: Aviso, detalle?: string): Resultado {
  return { ...SIN_RESULTADO, aviso, ...(detalle === undefined ? {} : { detalle }) }
}

/** Tope del detalle. Un mensaje de Postgres entero no cabe en una URL. */
const MAX_DETALLE = 240

/**
 * A dónde vuelve el formulario: los mismos filtros y la misma página, más el
 * parte de lo que pasó.
 *
 * El tipo de vuelta es una plantilla y no `string` porque `redirect()` de Next
 * está tipado contra las rutas que existen. Salir de acá con el tipo puesto es
 * lo que evita el `as` en la acción.
 */
export function destinoConResultado(f: Filtros, r: Resultado): `/movimientos?${string}` {
  const params = new URLSearchParams(aCadena(f))

  params.set('res', '1')
  params.set('p', String(r.pedidos))
  if (r.cambiados > 0) params.set('c', String(r.cambiados))
  if (r.yaEstaban > 0) params.set('y', String(r.yaEstaban))
  if (r.conDimensiones > 0) params.set('d', String(r.conDimensiones))
  if (r.sinContrapartida > 0) params.set('t', String(r.sinContrapartida))
  if (r.repartos > 0) params.set('rp', String(r.repartos))
  if (r.inexistentes > 0) params.set('nx', String(r.inexistentes))
  if (r.categoryId !== null) params.set('cat', r.categoryId)
  if (r.valores.length > 0) params.set('val', r.valores.join(','))
  if (r.quitadas.length > 0) params.set('qui', r.quitadas.join(','))
  if (r.aviso !== null) params.set('av', r.aviso)
  if (r.detalle !== null) params.set('det', r.detalle.slice(0, MAX_DETALLE))

  return `/movimientos?${params.toString()}`
}

/**
 * El parte, leído de la URL.
 *
 * Todo lo que entra por acá es texto de fuera —cualquiera puede escribir a mano
 * `?res=1&c=9999`— así que se valida igual que los filtros: números acotados,
 * uuid con forma de uuid y avisos de un conjunto cerrado. Lo peor que puede
 * hacer una URL retocada es enseñarle a quien la abre un recuento que no pasó,
 * y eso ya lo delata que la lista de abajo no haya cambiado.
 */
export function leerResultado(params: SearchParams): Resultado | null {
  if (uno(params['res']) !== '1') return null
  const avisoBruto = uno(params['av'])
  const aviso = AVISOS.find((candidato) => candidato === avisoBruto) ?? null
  const detalle = uno(params['det'])

  return {
    pedidos: entero(params['p']),
    cambiados: entero(params['c']),
    yaEstaban: entero(params['y']),
    conDimensiones: entero(params['d']),
    sinContrapartida: entero(params['t']),
    repartos: entero(params['rp']),
    inexistentes: entero(params['nx']),
    categoryId: unUuid(params['cat']),
    valores: listaDeUuid(params['val']),
    quitadas: listaDeUuid(params['qui']),
    aviso,
    detalle: detalle === null ? null : detalle.slice(0, MAX_DETALLE),
  }
}

/** La query string de los filtros, para devolvérsela a la acción tal cual. */
export function aCadena(f: Filtros): string {
  const params = new URLSearchParams()
  for (const [clave, valor] of Object.entries(aQuery(f))) {
    if (Array.isArray(valor)) for (const item of valor) params.append(clave, item)
    else params.append(clave, valor)
  }
  return params.toString()
}

/**
 * De vuelta a `SearchParams` desde una query string.
 *
 * `Object.fromEntries` no sirve: se come los valores repetidos, y `cuenta` y
 * `categoria` viajan repetidos. Perder el segundo id no daría error, daría otra
 * lista.
 */
export function aSearchParams(query: string): SearchParams {
  const params = new URLSearchParams(query)
  const out: SearchParams = {}
  for (const clave of new Set(params.keys())) {
    const valores = params.getAll(clave)
    out[clave] = valores.length === 1 ? (valores[0] ?? '') : valores
  }
  return out
}

function uno(valor: string | string[] | undefined): string | null {
  if (valor === undefined) return null
  if (Array.isArray(valor)) return valor[0] ?? null
  return valor
}

/** Un entero no negativo y acotado: acá no hay ningún número que valga millones. */
function entero(valor: string | string[] | undefined): number {
  const bruto = Number.parseInt(uno(valor) ?? '', 10)
  if (!Number.isFinite(bruto) || bruto < 0) return 0
  return Math.min(bruto, 1_000_000)
}

function unUuid(valor: string | string[] | undefined): string | null {
  const bruto = uno(valor)
  return bruto !== null && UUID.test(bruto) ? bruto : null
}

function listaDeUuid(valor: string | string[] | undefined): string[] {
  const bruto = uno(valor)
  if (bruto === null) return []
  return [...new Set(bruto.split(',').filter((id) => UUID.test(id)))].slice(0, 20)
}
