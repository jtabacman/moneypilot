/**
 * Cómo se busca un comercio en el diccionario.
 *
 * ── La comparación ──────────────────────────────────────────────────────────
 *
 * Los dos lados pasan por `merchantKey`, la limpieza canónica de comercios: el
 * alias del diccionario y el descriptor del banco. Es la condición que pide
 * `merchant.ts` en su propia cabecera, y el motivo es el fallo silencioso que
 * evita — escribir "Iberdrola S.A." acá y buscar `IBERDROLA` en tiempo de
 * ejecución no encontraría nada y nadie se enteraría.
 *
 * Esa limpieza es la que corta por el "·" que separa quién cobró del concepto,
 * la que quita la referencia y el final de la tarjeta, la que se lleva la
 * forma societaria del final y la calle del medio. Después de ella,
 * `Aldi Sued · Vielen Dank für Ihren Einkauf` es `ALDI SUED`.
 *
 * Un alias coincide cuando **todos sus tokens están en el descriptor limpio**.
 * Se comparan CONJUNTOS, y las dos mitades de esa decisión importan:
 *
 *  · Conjunto y no subcadena, porque `IBERDROLA CLIENTES` y `IBERDROLA` no
 *    comparten un prefijo pero son el mismo comercio, y porque una subcadena
 *    reconocería "IBERDROLA" dentro de una palabra más larga.
 *  · Conjunto y no secuencia, porque el orden del descriptor no es de nadie:
 *    `ZARA ESPANA` y `ESPANA ZARA` son la misma tienda.
 *
 * Ojo con la asimetría, que es deliberada: `merchantKey` **agrupa** con la
 * clave entera —"Bar Centrale" y "Bar Manolo" son dos comercios distintos— y el
 * diccionario **busca** por subconjunto. Puede hacerlo porque acá sí sabemos
 * cuál de los tokens es la marca: lo escribió una persona en el alias. Esa
 * información no existe cuando hay que agrupar descriptores a ciegas.
 *
 * ── Cuando coinciden varios ─────────────────────────────────────────────────
 *
 * Gana **el más específico**: el alias con más tokens. Es lo que hace que
 * "MOVISTAR PLUS" no se lea como la factura del teléfono y que "UBER EATS" no
 * se lea como un taxi.
 *
 * A igualdad de tokens pierde el comercio ambiguo, que es el caso de
 * `PAYPAL *SPOTIFY`: los dos están en el descriptor, pero uno dice qué se pagó
 * y el otro sólo por dónde pasó el dinero. Después va el alias más largo, y el
 * desempate final es la clave por orden alfabético, que no significa nada:
 * está para que la respuesta no dependa nunca del orden en que se escribieron
 * los ficheros de datos. Misma entrada, misma salida.
 *
 * Que dos comercios distintos compitan de verdad —mismos tokens exactos— es un
 * error del diccionario y no algo que se resuelva al buscar: se rechaza al
 * cargar.
 *
 * ── Por qué se valida al importar el módulo ─────────────────────────────────
 *
 * El diccionario es un dato estático, así que sus errores son de escritura y no
 * de ejecución: una clave repetida, un alias del que no queda ningún token, una
 * entrada marcada `ambigua` con categoría puesta. Comprobarlo al cargar
 * convierte todos esos en un fallo inmediato y ruidoso, en vez de en un
 * comercio que calladamente deja de reconocerse. Un diccionario que se equivoca
 * es peor que no tener diccionario.
 */

import { merchantKey } from '../merchant.js'
import { COMERCIOS_DE } from './comercios-de.js'
import { COMERCIOS_ES } from './comercios-es.js'
import { COMERCIOS_INTERNACIONALES } from './comercios-internacionales.js'
import type { Coincidencia, Comercio, EntradaDeDiccionario } from './tipos.js'

export class DiccionarioError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DiccionarioError'
  }
}

interface AliasIndexado {
  readonly comercio: Comercio
  /** El alias tal como está escrito, para poder explicar la coincidencia. */
  readonly alias: string
  readonly tokens: readonly string[]
}

const CLAVE_VALIDA = /^[a-z0-9]+(?:[:-][a-z0-9]+)*$/

/** "Vivienda > Suministros > Luz y gas": tramos con contenido, unidos por " > ". */
const RUTA_VALIDA = /^[^>\s][^>]*(?: > [^>\s][^>]*)*$/

function tokensDe(texto: string): string[] {
  const clave = merchantKey(texto)
  return clave === '' ? [] : clave.split(' ')
}

function comparar(a: AliasIndexado, b: AliasIndexado): number {
  if (a.tokens.length !== b.tokens.length) return b.tokens.length - a.tokens.length
  // A igualdad de especificidad, pierde el ambiguo. Es el caso de
  // `PAYPAL *SPOTIFY`: los dos comercios están en el descriptor, pero uno dice
  // qué se pagó y el otro sólo por dónde pasó el dinero. Sin esta regla la
  // decisión la tomaría el desempate siguiente —la longitud del alias—, que no
  // significa nada.
  const ambiguoA = a.comercio.confianza === 'ambigua'
  const ambiguoB = b.comercio.confianza === 'ambigua'
  if (ambiguoA !== ambiguoB) return ambiguoA ? 1 : -1
  if (a.alias.length !== b.alias.length) return b.alias.length - a.alias.length
  if (a.comercio.clave !== b.comercio.clave) {
    return a.comercio.clave < b.comercio.clave ? -1 : 1
  }
  return a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0
}

function validarEntrada(comercio: Comercio, claves: ReadonlySet<string>): void {
  if (!CLAVE_VALIDA.test(comercio.clave)) {
    throw new DiccionarioError(
      `La clave ${JSON.stringify(comercio.clave)} no vale: va en minúsculas, con guiones, y ` +
        'dos puntos sólo para el prefijo de las clases de comercio.',
    )
  }
  if (claves.has(comercio.clave)) {
    throw new DiccionarioError(
      `La clave ${JSON.stringify(comercio.clave)} está dos veces en el diccionario.`,
    )
  }
  if (comercio.etiqueta.trim() === '') {
    throw new DiccionarioError(`El comercio ${comercio.clave} no tiene etiqueta.`)
  }
  // El invariante que sostiene el contrato de `confianza`: si el comercio no
  // determina la categoría, no puede haber una categoría escrita al lado. Con
  // las dos cosas puestas, quien lea la entrada elige cuál de las dos creer.
  if ((comercio.confianza === 'ambigua') !== (comercio.categoria === null)) {
    throw new DiccionarioError(
      `El comercio ${comercio.clave} dice confianza ${comercio.confianza} y categoría ` +
        `${JSON.stringify(comercio.categoria)}. "ambigua" y categoría nula van siempre juntas: ` +
        'una entrada ambigua reconoce al comercio y no propone nada.',
    )
  }
  if (comercio.categoria !== null && !RUTA_VALIDA.test(comercio.categoria)) {
    throw new DiccionarioError(
      `La categoría ${JSON.stringify(comercio.categoria)} de ${comercio.clave} no es una ruta: ` +
        'se escribe como el camino de la cuenta, "Vivienda > Suministros > Luz y gas".',
    )
  }
  if (comercio.alias.length === 0) {
    throw new DiccionarioError(`El comercio ${comercio.clave} no tiene con qué reconocerse.`)
  }
}

function construir(comercios: readonly Comercio[]): readonly AliasIndexado[] {
  const claves = new Set<string>()
  /** Firma de tokens → quién la reclamó. Detecta dos alias indistinguibles. */
  const firmas = new Map<string, string>()
  const indice: AliasIndexado[] = []

  for (const comercio of comercios) {
    validarEntrada(comercio, claves)
    claves.add(comercio.clave)

    for (const alias of comercio.alias) {
      const tokens = tokensDe(alias)
      if (tokens.length === 0) {
        throw new DiccionarioError(
          `Del alias ${JSON.stringify(alias)} de ${comercio.clave} no queda ningún token después ` +
            'de normalizar, así que no reconocería nunca nada.',
        )
      }
      const firma = [...tokens].sort().join(' ')
      const duena = firmas.get(firma)
      if (duena !== undefined) {
        throw new DiccionarioError(
          `Los alias de ${duena} y ${comercio.clave} se reducen a los mismos tokens (${firma}), ` +
            'así que un descriptor los activaría a los dos y ganaría uno por orden alfabético. ' +
            'Eso no se desempata al buscar: se arregla acá.',
        )
      }
      firmas.set(firma, comercio.clave)
      indice.push({ comercio, alias, tokens })
    }
  }

  indice.sort(comparar)
  return indice
}

const INDICE = construir([...COMERCIOS_ES, ...COMERCIOS_DE, ...COMERCIOS_INTERNACIONALES])

function sinAlias(comercio: Comercio): EntradaDeDiccionario {
  return {
    clave: comercio.clave,
    etiqueta: comercio.etiqueta,
    categoria: comercio.categoria,
    // El país se omite en vez de ponerse a undefined: con
    // exactOptionalPropertyTypes no son lo mismo, y "no tiene país" es un dato.
    ...(comercio.pais === undefined ? {} : { pais: comercio.pais }),
    confianza: comercio.confianza,
  }
}

/**
 * Busca un comercio a partir de un descriptor.
 *
 * Acepta indistintamente el descriptor tal como lo escribió el banco y la clave
 * que devuelve `merchantKey` o `canonicalMerchant`: la limpieza es idempotente,
 * así que quien ya tenga una lista agrupada por comercio puede buscar con la
 * clave y no pierde nada.
 *
 * Devuelve `undefined` cuando no lo reconoce, que es la respuesta más frecuente
 * y no es un fallo. Y cuando lo reconoce puede devolver `categoria: null`: eso
 * es "sé quién es y no sé a qué categoría va", que es distinto de no saber nada
 * y mucho mejor que inventarse una.
 */
export function buscarEnDiccionario(clave: string): Coincidencia | undefined {
  if (typeof clave !== 'string') return undefined
  const tokens = new Set(tokensDe(clave))
  if (tokens.size === 0) return undefined

  for (const entrada of INDICE) {
    if (entrada.tokens.every((token) => tokens.has(token))) {
      return { ...sinAlias(entrada.comercio), coincidencia: entrada.alias }
    }
  }
  return undefined
}

/** Todo el diccionario, por clave. Para inventariarlo y para los tests. */
export function entradasDeDiccionario(): readonly EntradaDeDiccionario[] {
  const porClave = new Map<string, EntradaDeDiccionario>()
  for (const entrada of INDICE) porClave.set(entrada.comercio.clave, sinAlias(entrada.comercio))
  return [...porClave.values()].sort((a, b) => (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0))
}

/**
 * Las rutas distintas que el diccionario puede proponer, ordenadas.
 *
 * Quien aplique tiene que traducir rutas a cuentas del hogar, y esa traducción
 * se hace una vez para todo el diccionario y no una vez por movimiento. Además
 * contesta de un vistazo qué plan de cuentas hace falta para aprovecharlo
 * entero, y qué se le propondría crear al hogar que no lo tenga.
 */
export function rutasDelDiccionario(): readonly string[] {
  const rutas = new Set<string>()
  for (const entrada of INDICE) {
    if (entrada.comercio.categoria !== null) rutas.add(entrada.comercio.categoria)
  }
  return [...rutas].sort()
}
