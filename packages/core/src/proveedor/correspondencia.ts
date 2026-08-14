/**
 * La traducción entre la taxonomía de un proveedor y la nuestra.
 *
 * ── Por qué existe esta capa ────────────────────────────────────────────────
 *
 * Plaid manda `personal_finance_category` en cada movimiento sincronizado, y
 * también sabe ponérsela a movimientos que no vienen de sus conexiones
 * (`/transactions/enrich`), así que la señal llega igual por el feed que por
 * fichero. Pero llega en **su** taxonomía y en inglés:
 * `GENERAL_SERVICES_INSURANCE`, `TRANSPORTATION_PUBLIC_TRANSIT`. La nuestra es
 * el plan de cuentas del hogar y está en español.
 *
 * Esta tabla es la aduana entre las dos, y tiene dos consecuencias que valen lo
 * que cuesta mantenerla:
 *
 *  1. **Al usuario nunca se le enseña una categoría de Plaid.** Ni en la
 *     pantalla, ni en un informe, ni en el "¿por qué esta categoría?". Lo que
 *     ve es 'Seguros', que es una cuenta suya.
 *  2. **No quedamos atados.** El día que entre otro proveedor se añade otra
 *     tabla a este mismo mapa; lo que no se toca es el árbol. Sin esta capa, la
 *     taxonomía del proveedor se filtraría al modelo y cambiar de proveedor
 *     sería cambiar de producto.
 *
 * ── Qué NO es ───────────────────────────────────────────────────────────────
 *
 * No es el clasificador. Devuelve una **ruta** del árbol por defecto, no una
 * cuenta: los uuid no existen hasta que el hogar se crea, y si el hogar
 * reorganizó su plan de cuentas la ruta puede no resolver, en cuyo caso lo
 * correcto es no clasificar. Y no toca la base: es una función pura, misma
 * entrada, misma salida, sin reloj y sin red.
 *
 * Tampoco sustituye al diccionario de comercios propio. Está medido contra
 * descriptores españoles reales: Plaid resuelve bien `RENFE VIAJEROS` y
 * `EL CORTE INGLES`, y clasifica `REPSOL E.S.` como comercio general cuando es
 * combustible. Es una señal más, útil e imperfecta.
 */

import type { RutaDeCategoria } from './arbol.js'
import { CORRESPONDENCIAS_DE_PLAID } from './plaid.js'

/**
 * Un proveedor de enriquecimiento. Es una unión de un solo miembro hoy, y esa
 * es la forma: añadir otro es añadir una tabla y un literal, no una taxonomía.
 */
export type Proveedor = 'plaid'

/**
 * Cuánto nos fiamos de **la traducción**, que no es lo mismo que cuánto se fía
 * el proveedor de su propia clasificación.
 *
 * Plaid manda su `confidence_level` (VERY_HIGH…UNKNOWN): ésa es la duda de si
 * el movimiento es realmente un seguro. La nuestra es la duda de si "seguro"
 * significa una sola categoría en el plan de cuentas de este hogar. Son dos
 * incertidumbres distintas y quien decide aplicar tiene que mirar las dos; si
 * se confunden, un `VERY_HIGH` de ellos justifica una correspondencia floja
 * nuestra, que es como se cuelan los errores que nadie revisa.
 *
 *  - `'alta'`: la categoría del proveedor significa **una sola** de las
 *    nuestras. `TRANSPORTATION_GAS` sólo puede ser combustible.
 *  - `'media'`: la equivalencia es razonable pero el hogar podría querer otra,
 *    o la categoría del proveedor mezcla varias de las nuestras.
 *    `GENERAL_MERCHANDISE_SUPERSTORES` es supermercado casi siempre, y a veces
 *    es una lavadora.
 *
 * No hay `'baja'` a propósito: si la correspondencia no llega a media, no hay
 * entrada. Un hueco se ve en la cola de revisión; una correspondencia forzada
 * se convierte en un número del informe que nadie sabe que está mal.
 *
 * Qué hacer con cada nivel —aplicar sólo las altas, proponer las medias— es
 * decisión del motor, no de esta tabla.
 */
export type ConfianzaDeCorrespondencia = 'alta' | 'media'

export interface CorrespondenciaDeCategoria {
  /** Ruta en `ARBOL_POR_DEFECTO`. Ver `buscarPorRuta`. */
  readonly ruta: RutaDeCategoria
  readonly confianza: ConfianzaDeCorrespondencia
}

/**
 * Una tabla por proveedor. El registro es lo que hace que el llamador no tenga
 * que saber de quién viene el dato más allá del literal.
 */
export const CORRESPONDENCIAS_POR_PROVEEDOR: Readonly<
  Record<Proveedor, ReadonlyMap<string, CorrespondenciaDeCategoria>>
> = {
  plaid: CORRESPONDENCIAS_DE_PLAID,
}

/**
 * La categoría del proveedor traducida a una ruta nuestra, o `undefined`.
 *
 * `undefined` no es un fallo: es la respuesta correcta cuando no hay
 * equivalencia clara. Quien llama tiene que tratarlo como "esto sigue sin
 * categorizar", nunca como "ponelo en la que más se parezca".
 *
 * La categoría se compara en mayúsculas y sin espacios alrededor porque el
 * valor puede llegar desde `raw` —una columna de texto por la que ya pasó un
 * aplanador— y no desde la respuesta HTTP. Es la única tolerancia: no hay
 * emparejado por prefijo ni por parecido, porque adivinar acá es exactamente lo
 * que esta tabla existe para no hacer.
 */
export function mapearCategoriaDeProveedor(
  proveedor: Proveedor,
  categoria: string,
): CorrespondenciaDeCategoria | undefined {
  return CORRESPONDENCIAS_POR_PROVEEDOR[proveedor].get(categoria.trim().toUpperCase())
}
