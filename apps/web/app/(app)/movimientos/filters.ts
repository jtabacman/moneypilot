/**
 * Los filtros de /movimientos viven en la query string, no en estado de cliente.
 *
 * Esta pantalla es el destino de todo drill-down del producto: cada número de
 * cada tablero termina acá con filtros puestos. Un enlace tiene que reproducir
 * exactamente lo que otra persona está mirando y tiene que poder pegarse en un
 * correo, así que el estado de la pantalla **es** la URL. Estado de cliente
 * daría enlaces que no llevan a ningún sitio.
 *
 * Todo lo que entra por acá es texto de fuera y se valida antes de llegar a la
 * base. Un uuid mal formado dentro de `= any($3::uuid[])` no filtra de menos:
 * revienta la consulta con un error de Postgres, y una fecha imposible hace lo
 * mismo. Lo que no pasa la validación se ignora en silencio — una URL a la que
 * alguien le comió un carácter tiene que degradar a la lista sin ese filtro,
 * nunca a una pantalla de error.
 */

import type { MovementFilter, MovementSort } from '@moneypilot/db'

/** Filas por página. La lectura es la unidad de trabajo, no el scroll infinito. */
export const PAGE_SIZE = 50

/**
 * Tope de ids por parámetro. No es una restricción de producto: es que una URL
 * con doscientos uuid deja de ser un enlace que se pueda pegar en un correo.
 */
const MAX_IDS = 50

/** Tope del texto libre. Más que esto no es una búsqueda, es un pegado accidental. */
const MAX_TEXTO = 120

export interface Filtros {
  readonly desde: string | null
  readonly hasta: string | null
  readonly cuentas: readonly string[]
  readonly categorias: readonly string[]
  readonly dimensiones: readonly string[]
  readonly texto: string | null
  /**
   * Incluir las patas de traspaso. Por defecto no: las dos patas de un
   * traspaso interno no son gasto ni ingreso, y sumarlas duplicaría el total.
   */
  readonly traspasos: boolean
  /**
   * Rango de importe, en unidades mínimas y sobre el valor absoluto.
   *
   * Absoluto porque «de mil euros para arriba» tiene que traer los gastos
   * grandes, que en el libro son negativos. Con el signo dentro, ese filtro
   * devolvería sólo ingresos y contestaría lo contrario de lo que se le pidió.
   */
  readonly importeMin: bigint | null
  readonly importeMax: bigint | null
  /** Un carril de moneda. En un hogar multi-divisa se pide el primer día. */
  readonly moneda: string | null
  /** Sólo los que todavía no tienen categoría. */
  readonly sinCategorizar: boolean
  /** De dónde entró: por fichero o por el feed de un agregador. */
  readonly origen: 'file' | 'api' | null
  readonly orden: MovementSort
  /** Base 1: es lo que se ve en la URL. El offset se calcula al consultar. */
  readonly pagina: number
}

/** El orden por defecto. Lo más nuevo arriba, que es como se lee un extracto. */
export const ORDEN_POR_DEFECTO: MovementSort = 'fecha-desc'

const ORDENES: readonly MovementSort[] = [
  'fecha-desc',
  'fecha-asc',
  'importe-desc',
  'importe-asc',
  'descripcion-asc',
  'cuenta-asc',
]

export const SIN_FILTROS: Filtros = {
  importeMin: null,
  importeMax: null,
  moneda: null,
  sinCategorizar: false,
  origen: null,
  orden: ORDEN_POR_DEFECTO,
  desde: null,
  hasta: null,
  cuentas: [],
  categorias: [],
  dimensiones: [],
  texto: null,
  traspasos: false,
  pagina: 1,
}

export type SearchParams = Record<string, string | string[] | undefined>

/** Valor único de un parámetro que puede venir repetido: gana el primero. */
function uno(valor: string | string[] | undefined): string | null {
  if (valor === undefined) return null
  if (Array.isArray(valor)) return valor[0] ?? null
  return valor
}

function varios(valor: string | string[] | undefined): string[] {
  if (valor === undefined) return []
  return Array.isArray(valor) ? valor : [valor]
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Fecha real, no sólo con forma de fecha.
 *
 * Se comprueba el día del mes a mano en vez de construir un `Date`: además de
 * que `new Date('2026-02-30')` no falla —desborda a marzo—, en este código no
 * entra ni un objeto Date, que es lo que evita que un huso al oeste convierta
 * el día 1 en el 31 anterior.
 */
function esFecha(valor: string): boolean {
  const partes = YMD.exec(valor)
  if (partes === null) return false
  const anio = Number.parseInt(partes[1] ?? '', 10)
  const mes = Number.parseInt(partes[2] ?? '', 10)
  const dia = Number.parseInt(partes[3] ?? '', 10)
  if (mes < 1 || mes > 12 || dia < 1) return false
  const bisiesto = (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0
  const largos = [31, bisiesto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return dia <= (largos[mes - 1] ?? 31)
}

function fecha(valor: string | string[] | undefined): string | null {
  const bruto = uno(valor)
  if (bruto === null || !esFecha(bruto)) return null
  return bruto
}

/**
 * Ids de un parámetro, venga repetido (`?cuenta=a&cuenta=b`) o separado por
 * comas (`?cuenta=a,b`).
 *
 * Las dos formas existen en el producto: el constructor de reportes y el
 * cierre arman la lista con `join(',')`, y los tableros la repiten. Aceptar
 * sólo una de las dos haría que la mitad de los drill-down llegaran acá sin
 * filtro y enseñaran el total del hogar en vez del detalle pedido — un número
 * equivocado con cara de correcto, que es el peor resultado posible.
 */
function ids(valor: string | string[] | undefined): { lista: string[]; recortada: boolean } {
  const vistos = new Set<string>()
  let recortada = false
  for (const bruto of varios(valor)) {
    for (const trozo of bruto.split(',')) {
      const id = trozo.trim()
      if (!UUID.test(id)) continue
      // Un mismo id repetido filtraría igual pero pintaría dos chips.
      if (vistos.size >= MAX_IDS && !vistos.has(id)) {
        // Recortar en silencio es el fallo entero del producto en pequeño: el
        // usuario llegó desde un número que sumaba N cosas y vería el detalle
        // de 50 con cara de estar completo. Se recorta igual —una URL con
        // doscientos uuid no es un enlace— pero se declara en pantalla.
        recortada = true
        continue
      }
      vistos.add(id)
    }
  }
  return { lista: [...vistos], recortada }
}

/**
 * Lo que llegó por la URL: el filtro, y qué se tuvo que dejar por el camino.
 *
 * El recorte va aparte de `Filtros` a propósito. `Filtros` **es** la URL y se
 * usa para construir enlaces; meter dentro un dato que no viaja en la query
 * string haría que un enlace armado con `con()` arrastrara un aviso que ya no
 * corresponde.
 */
export interface Entrada {
  readonly filtros: Filtros
  /** Nombres de los parámetros cuya lista de ids no cupo entera. */
  readonly recortados: readonly string[]
}

export function parseEntrada(params: SearchParams): Entrada {
  const cuentas = ids(params['cuenta'])
  const categorias = ids(params['categoria'])
  const dimensiones = ids(params['dimension'])
  const recortados: string[] = []
  if (cuentas.recortada) recortados.push('cuentas')
  if (categorias.recortada) recortados.push('categorías')
  if (dimensiones.recortada) recortados.push('dimensiones')
  return { filtros: parseFiltros(params), recortados }
}

export function parseFiltros(params: SearchParams): Filtros {
  const desde = fecha(params['desde'])
  const hasta = fecha(params['hasta'])
  // `buscar` es como llega el comercio desde el tablero del mes. El parámetro
  // canónico es `q` —es el que emite esta pantalla— pero descartar el otro
  // dejaría ese drill-down enseñando el período entero en lugar del comercio.
  const textoBruto = (uno(params['q']) ?? uno(params['buscar']))?.trim().slice(0, MAX_TEXTO) ?? ''
  const paginaBruta = Number.parseInt(uno(params['pagina']) ?? '', 10)

  return {
    // Un rango invertido no devuelve nada y no hay forma de que el usuario
    // entienda por qué, así que se da vuelta y se muestra lo que pidió.
    desde: desde !== null && hasta !== null && desde > hasta ? hasta : desde,
    hasta: desde !== null && hasta !== null && desde > hasta ? desde : hasta,
    cuentas: ids(params['cuenta']).lista,
    categorias: ids(params['categoria']).lista,
    dimensiones: ids(params['dimension']).lista,
    texto: textoBruto === '' ? null : textoBruto,
    traspasos: uno(params['transferencias']) === '1',
    importeMin: importe(params['min']),
    importeMax: importe(params['max']),
    moneda: moneda(params['moneda']),
    sinCategorizar: uno(params['sincat']) === '1',
    origen: origen(params['origen']),
    orden: ordenDe(params['orden']),
    pagina: Number.isFinite(paginaBruta) && paginaBruta > 1 ? paginaBruta : 1,
  }
}

/**
 * Un importe de la URL a unidades mínimas.
 *
 * Se admite «1.234,56» y «1234.56»: la URL la escribe una persona tanto como la
 * escribe la pantalla, y rechazar la coma decimal en un producto español sería
 * rechazar la forma normal de escribirlo. Lo que no se admite es cualquier otra
 * cosa: un texto raro se descarta en vez de convertirse en cero, porque un cero
 * es un filtro que sí hace algo.
 */
function importe(valor: string | string[] | undefined): bigint | null {
  const texto = uno(valor)?.trim()
  if (texto === undefined || texto === '') return null
  const limpio = texto.replace(/\./g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null
  const [entera = '0', decimal = ''] = limpio.split('.')
  return BigInt(entera) * 100n + BigInt(decimal.padEnd(2, '0'))
}

function moneda(valor: string | string[] | undefined): string | null {
  const texto = uno(valor)?.trim().toUpperCase()
  return texto !== undefined && /^[A-Z]{3}$/.test(texto) ? texto : null
}

function origen(valor: string | string[] | undefined): 'file' | 'api' | null {
  const texto = uno(valor)
  return texto === 'file' || texto === 'api' ? texto : null
}

/**
 * El orden de la URL. Lista cerrada: lo que llega es una etiqueta y lo que se
 * ejecuta es SQL escrito en el repositorio, nunca el texto del parámetro.
 */
function ordenDe(valor: string | string[] | undefined): MovementSort {
  const texto = uno(valor)
  return ORDENES.find((o) => o === texto) ?? ORDEN_POR_DEFECTO
}

/** ¿Hay algo que quitar? El botón de limpiar no aparece si no hay nada puesto. */
export function hayFiltros(f: Filtros): boolean {
  return (
    f.desde !== null ||
    f.hasta !== null ||
    f.cuentas.length > 0 ||
    f.categorias.length > 0 ||
    f.dimensiones.length > 0 ||
    f.texto !== null ||
    f.traspasos ||
    f.importeMin !== null ||
    f.importeMax !== null ||
    f.moneda !== null ||
    f.sinCategorizar ||
    f.origen !== null
  )
}

/** El importe en el formato que espera el campo del formulario. */
export function importeATexto(valor: bigint | null): string {
  if (valor === null) return ''
  const entera = valor / 100n
  const decimal = valor % 100n
  return `${entera},${decimal.toString().padStart(2, '0')}`
}

export type Query = Record<string, string | string[]>

/** La query string canónica: sólo lo que se aparta del valor por defecto. */
export function aQuery(f: Filtros): Query {
  const q: Query = {}
  if (f.desde !== null) q['desde'] = f.desde
  if (f.hasta !== null) q['hasta'] = f.hasta
  if (f.cuentas.length > 0) q['cuenta'] = [...f.cuentas]
  if (f.categorias.length > 0) q['categoria'] = [...f.categorias]
  if (f.dimensiones.length > 0) q['dimension'] = [...f.dimensiones]
  if (f.texto !== null) q['q'] = f.texto
  if (f.traspasos) q['transferencias'] = '1'
  if (f.importeMin !== null) q['min'] = importeATexto(f.importeMin)
  if (f.importeMax !== null) q['max'] = importeATexto(f.importeMax)
  if (f.moneda !== null) q['moneda'] = f.moneda
  if (f.sinCategorizar) q['sincat'] = '1'
  if (f.origen !== null) q['origen'] = f.origen
  if (f.orden !== ORDEN_POR_DEFECTO) q['orden'] = f.orden
  if (f.pagina > 1) q['pagina'] = String(f.pagina)
  return q
}

/**
 * Destino para `Link`. Se pasa como objeto y no como string armado a mano para
 * que sea Next quien codifique los valores repetidos y los acentos.
 */
export function ruta(f: Filtros): { pathname: string; query: Query } {
  return { pathname: '/movimientos', query: aQuery(f) }
}

/** Cambia algo del filtro y vuelve a la primera página: otra página no existe. */
export function con(f: Filtros, cambios: Partial<Filtros>): Filtros {
  return { ...f, ...cambios, pagina: cambios.pagina ?? 1 }
}

export type ClaveLista = 'cuentas' | 'categorias' | 'dimensiones'

function conLista(f: Filtros, clave: ClaveLista, valores: readonly string[]): Filtros {
  if (clave === 'cuentas') return con(f, { cuentas: valores })
  if (clave === 'categorias') return con(f, { categorias: valores })
  return con(f, { dimensiones: valores })
}

/** Añade un id a una lista si no estaba. Es el pivote desde una fila de la tabla. */
export function mas(f: Filtros, clave: ClaveLista, id: string): Filtros {
  if (f[clave].includes(id)) return con(f, {})
  return conLista(f, clave, [...f[clave], id])
}

/** Quita un id de una lista. Es el aspa del chip de filtro activo. */
export function menos(f: Filtros, clave: ClaveLista, id: string): Filtros {
  return conLista(
    f,
    clave,
    f[clave].filter((otro) => otro !== id),
  )
}

/**
 * El filtro tal como lo entiende el repositorio.
 *
 * `limit` y `offset` no salen de acá a propósito: la misma condición se usa
 * para la página que se pinta y para el recorrido que suma el período, y esos
 * dos usos piden ventanas distintas.
 */
export function aFiltroDb(f: Filtros): MovementFilter {
  return {
    from: f.desde ?? undefined,
    to: f.hasta ?? undefined,
    accountIds: f.cuentas.length > 0 ? f.cuentas : undefined,
    categoryIds: f.categorias.length > 0 ? f.categorias : undefined,
    dimensionValueIds: f.dimensiones.length > 0 ? f.dimensiones : undefined,
    search: f.texto ?? undefined,
    includeTransfers: f.traspasos,
    minAmount: f.importeMin ?? undefined,
    maxAmount: f.importeMax ?? undefined,
    currency: f.moneda ?? undefined,
    onlyUncategorized: f.sinCategorizar ? true : undefined,
    source: f.origen ?? undefined,
    sort: f.orden,
  }
}
