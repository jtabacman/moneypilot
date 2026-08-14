/**
 * Diccionario de comercios: de un descriptor de banco a un comercio conocido y,
 * cuando el comercio lo determina, a una ruta de categoría.
 *
 * ── Qué es esto y qué NO es ─────────────────────────────────────────────────
 *
 * Es un artefacto del producto, del mismo tipo que la tabla de códigos de un
 * parser: datos genéricos que el motor consulta en tiempo de ejecución. No es
 * —y no puede volverse— una lista de los descriptores concretos de un cliente
 * ni de un corpus de prueba. La diferencia se nota en una pregunta: si esta
 * entrada apareciera en el extracto de otra familia, ¿seguiría siendo cierta?
 * Si la respuesta es no, la entrada no va.
 *
 * Tampoco decide nada. Propone una ruta en texto; quién la aplica, con qué
 * cuenta y bajo qué confianza es asunto de quien la use.
 *
 * Y no canoniza descriptores: de eso se ocupa `merchant.ts`, que contesta
 * "¿quién cobró?". Este módulo contesta la siguiente, "¿y eso qué es?", y usa
 * la misma limpieza para no desencontrarse con él (ver `buscar.ts`).
 *
 * ── Cómo crece, sin mirar los datos de nadie ────────────────────────────────
 *
 * La fuente natural de crecimiento es la memoria agregada de muchos hogares, y
 * hay una línea exacta por la que pasa:
 *
 *   · **descriptor → comercio es transversal.** Que "AMZN MKTP ES*1A2B3" sea
 *     Amazon es un hecho sobre cómo escriben los bancos, no sobre una familia.
 *     Se puede aprender de la agregación —qué descriptores se agrupan bajo la
 *     misma clave en muchos hogares a la vez— y publicarlo acá sin exponer
 *     nada: el alias que se sube no dice quién compró ni cuánto.
 *
 *   · **comercio → categoría NO es transversal.** Que el seguro vaya a la
 *     sociedad o a gasto personal, o que el colegio sea "Familia > Colegio" o
 *     "Hijos > Educación", depende del plan de cuentas y de la estructura de
 *     cada familia. Eso se queda en la memoria del hogar
 *     (`recordarPorComercio`), que es local por definición, y no sube nunca.
 *
 * La consecuencia práctica: una entrada nueva entra acá cuando el comercio es
 * real y su categoría es la misma para cualquier familia. Cuando la categoría
 * depende de la familia, la entrada se sube igual pero con `confianza:
 * 'ambigua'` y sin categoría — reconocer al comercio ya es la mitad del
 * trabajo, y la otra mitad la pone el hogar.
 *
 * El umbral para publicar tiene que ser alto: cien entradas correctas antes que
 * quinientas dudosas. Una entrada equivocada no se nota —el motor clasifica
 * "bien" y calladamente manda mal el dinero de todos los hogares a la vez—, que
 * es peor que no tener diccionario.
 */

export {
  buscarEnDiccionario,
  DiccionarioError,
  entradasDeDiccionario,
  rutasDelDiccionario,
} from './buscar.js'
export type {
  Coincidencia,
  Comercio,
  Confianza,
  EntradaDeDiccionario,
  Pais,
  RutaDeCategoria,
} from './tipos.js'
