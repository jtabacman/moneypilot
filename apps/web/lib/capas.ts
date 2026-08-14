/**
 * Cómo se llaman las cinco capas del motor cuando se las enseña.
 *
 * Vive fuera de las pantallas porque lo usan tres —el informe de importación,
 * el registro de movimientos y la de reglas— y porque el día que una capa
 * cambie de nombre tiene que cambiar en un sitio. Dos pantallas llamando
 * «diccionario» y «catálogo» a lo mismo es una pregunta de soporte.
 *
 * Los nombres largos están escritos **desde el usuario**: él no tiene por qué
 * saber qué es una «procedencia». Sabe qué es una regla que escribió y qué es
 * algo que ya decidió antes.
 */

import type { Procedencia } from '@moneypilot/db'

/** Para una frase: «lo puso una regla tuya». */
export const CAPA: Record<Procedencia, string> = {
  regla: 'una regla tuya',
  memoria: 'lo que ya decidiste antes',
  senal: 'lo que dice el banco del movimiento',
  proveedor: 'la clasificación del agregador',
  diccionario: 'el diccionario de comercios',
}

/** Para una columna o una etiqueta, donde no cabe la frase. */
export const CAPA_CORTA: Record<Procedencia, string> = {
  regla: 'Regla',
  memoria: 'Memoria',
  senal: 'Señal',
  proveedor: 'Agregador',
  diccionario: 'Diccionario',
}

/**
 * El orden en que mandan, que es también el orden en que se enseñan.
 *
 * Ordenar por cantidad haría que la tabla cambiara de forma entre dos cargas y
 * que el usuario no pudiera aprenderse dónde mirar. Y sobre todo, este orden
 * **significa algo**: es la precedencia, así que verlo repetido en cada
 * pantalla enseña cómo decide el motor sin tener que explicarlo.
 */
export const ORDEN_DE_CAPAS: readonly Procedencia[] = [
  'regla',
  'memoria',
  'senal',
  'proveedor',
  'diccionario',
]

/** `null` en `classification_change.procedencia` significa una persona. */
export function nombreDeCapa(procedencia: Procedencia | null): string {
  return procedencia === null ? 'una persona' : CAPA[procedencia]
}

export function etiquetaDeCapa(procedencia: Procedencia | null): string {
  return procedencia === null ? 'A mano' : CAPA_CORTA[procedencia]
}
