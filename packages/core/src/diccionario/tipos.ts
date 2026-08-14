/**
 * Las piezas de las que está hecho el diccionario de comercios.
 *
 * Tres decisiones viven en estos tipos y conviene leerlas antes que el dato:
 *
 *  1. **La categoría es una RUTA EN TEXTO, no un id.** Acá una categoría es una
 *     cuenta de gasto o ingreso, y el plan de cuentas es de cada hogar: no hay
 *     ningún identificador que valga para dos familias. El diccionario escribe
 *     "Casa > Servicios > Luz" —exactamente el formato de `CategoryNode.path`—
 *     y quien aplique lo resuelve contra las cuentas que existan. Si no existe,
 *     **propone crearla**; crearla sola y en silencio le cambiaría el plan de
 *     cuentas a alguien que no lo pidió.
 *
 *  2. **`confianza` no es una probabilidad, es un permiso.** Dice qué se puede
 *     hacer con la entrada sin preguntar:
 *       · `alta`   — el comercio determina la categoría sin ambigüedad
 *                    (Iberdrola es luz siempre). Se puede proponer y aplicar.
 *       · `media`  — casi siempre es esa categoría, pero el comercio vende en
 *                    varias (Carrefour, Repsol —que también factura luz y gas).
 *                    Se propone; la aplica una persona.
 *       · `ambigua`— el comercio NO determina ninguna categoría. Amazon no es
 *                    una categoría, y El Corte Inglés tampoco. Entonces
 *                    `categoria` es `null` y lo único que aporta la entrada es
 *                    reconocer al comercio.
 *     El invariante `ambigua ⟺ categoria === null` se comprueba al cargar el
 *     diccionario, no se confía en que quien lo edite se acuerde.
 *
 *  3. **Los alias son textos, no expresiones regulares.** Se comparan por
 *     tokens contra el descriptor, con la misma función que el resto del
 *     sistema (`descriptionTokens`), así que se escriben como se leen —"El
 *     Corte Inglés"— y los acentos, las mayúsculas y la puntuación dan igual.
 *     Ver `buscar.ts`.
 */

import type { RutaDeCategoria } from '../proveedor/arbol.js'

/**
 * De dónde es el comercio. Sirve para dos cosas: acotar la búsqueda el día que
 * el diccionario crezca, y avisar al que lo mantiene de que "Netto" en España
 * no es "Netto" en Alemania.
 *
 * Los comercios de verdad internacionales —Netflix, Amazon, Booking— **no
 * llevan país**, y eso es información: no hay un país desde el que mirarlos.
 */
export type Pais = 'ES' | 'DE' | 'PT' | 'US'

/** Ver la cabecera: es un permiso, no una probabilidad. */
export type Confianza = 'alta' | 'media' | 'ambigua'

/**
 * Ruta de categoría con el formato de `CategoryNode.path`: los nombres de las
 * cuentas desde la raíz, separados por " > ".
 *
 * Se toma prestada del plan de cuentas (`proveedor/arbol.ts`) en vez de
 * declararla otra vez acá, que es lo que había antes. Dos alias de `string` con
 * el mismo nombre en el barril de `@moneypilot/core` son un error de
 * compilación (TS2308) esperando a que alguien exporte el otro, y sobre todo
 * son dos sitios donde escribir qué formato tiene una ruta. El dueño del
 * formato es el árbol de cuentas; el diccionario lo usa.
 *
 * Es `string` y no una unión cerrada de rutas conocidas: una unión obligaría a
 * que el diccionario y el plan de cuentas de cada hogar evolucionaran juntos,
 * que es justo lo que no puede pasar — el hogar manda sobre su plan.
 */
export type { RutaDeCategoria }

/** Lo que el diccionario sabe de un comercio. */
export interface EntradaDeDiccionario {
  /** Identificador estable del comercio dentro del diccionario ('iberdrola'). */
  readonly clave: string
  /** Cómo se llama el comercio para una persona ('Iberdrola'). */
  readonly etiqueta: string
  /** Ruta de categoría, o `null` cuando el comercio no la determina. */
  readonly categoria: RutaDeCategoria | null
  readonly pais?: Pais
  readonly confianza: Confianza
}

/** Una entrada con los textos por los que se la reconoce en un extracto. */
export interface Comercio extends EntradaDeDiccionario {
  /**
   * Los nombres con los que aparece en el descriptor. Se comparan por tokens,
   * así que "El Corte Inglés" reconoce también "EL CORTE INGLES SA 4412".
   */
  readonly alias: readonly string[]
}

/** Lo que devuelve una búsqueda: la entrada y por qué coincidió. */
export interface Coincidencia extends EntradaDeDiccionario {
  /**
   * El alias que coincidió, tal como está escrito en el diccionario.
   *
   * Existe para poder contestar "¿por qué esta categoría?" con algo mejor que
   * "porque sí": la respuesta completa es este alias más la entrada.
   */
  readonly coincidencia: string
}
