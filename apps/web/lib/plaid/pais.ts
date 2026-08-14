/**
 * De qué país es una cuenta que llegó por Plaid.
 *
 * Vive en su propio módulo y no dentro de la ruta por una razón práctica: es
 * una **regla**, no fontanería, y una regla que decide si un dato se escribe o
 * se deja vacío tiene que poder probarse sola. Dentro de un `route.ts` no se
 * puede exportar para el test sin ensuciar el contrato de la ruta.
 */

import { institucionPorId } from './client'

/**
 * Los países del corredor declarado del producto.
 *
 * `/institutions/get_by_id` los exige en la petición aunque se le esté pidiendo
 * un banco por su identificador. El día que el corredor crezca, se añaden acá.
 */
export const CORREDOR = ['ES', 'US'] as const

/**
 * El país de la entidad **sólo si opera en uno**.
 *
 * Plaid no dice de qué país es una cuenta; dice en qué países opera el banco.
 * Con uno solo las dos cosas coinciden y no hay nada que adivinar. Con varios
 * sí lo habría —una cuenta de la filial mexicana de un banco español no es
 * española—, y ahí el valor correcto es vacío.
 *
 * Medido contra su sandbox: los cinco bancos del catálogo devuelven **un solo
 * país** cada uno, porque Plaid publica una ficha por país y por marca —«BBVA ·
 * Banca Personal» es sólo ES, y la estadounidense es otra institución con otro
 * identificador—. Así que hoy la rama de varios países no se ejecuta nunca. Se
 * escribe igual: el día que un banco aparezca en dos, el fallo sería un
 * patrimonio agrupado bajo una jurisdicción equivocada, y eso no da error.
 *
 * Y si la llamada falla —el banco no está en el corredor, Plaid está caído, el
 * identificador ya no existe— tampoco se asume nada: se sigue sin país. Un país
 * que no se pudo averiguar no puede tumbar una sincronización de movimientos,
 * que es lo que de verdad importa de la petición que lo llama.
 */
export async function paisDeLaEntidad(institutionId: string | null): Promise<string | null> {
  if (institutionId === null || institutionId.trim() === '') return null
  try {
    const ficha = await institucionPorId(institutionId, CORREDOR)
    return ficha.paises.length === 1 ? (ficha.paises[0] ?? null) : null
  } catch {
    return null
  }
}
