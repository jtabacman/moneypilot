/**
 * El impacto de una regla antes de aplicarla.
 *
 * Es el paso 4 de B7 —«reglas propuestas con diff e impacto»— y el motivo por
 * el que esta pantalla existe. El formulario es lo de menos: lo que decide si
 * alguien se anima a categorizar dos años de golpe es leer «afecta a 342
 * movimientos, y 40 de ellos ya tienen categoría» **antes** de tocar nada.
 */

import type { TenantClient } from '@moneypilot/db'
import { ClassifyError, type MovementRow, previewRule, type RuleMatch } from '@moneypilot/db'

/** Movimientos de la muestra. Los pide B7 y veinte es lo que se lee de un vistazo. */
export const MUESTRA = 20

export interface FilaImpacto {
  readonly movimiento: MovementRow
  /**
   * Su contrapartida sigue en la bolsa de «Sin categorizar», así que la regla
   * no le pisa nada a nadie.
   */
  readonly sinCategorizar: boolean
}

export interface Impacto {
  /** «Esta regla afecta a N movimientos». */
  readonly total: number
  /**
   * De esos, cuántos ya tienen una categoría puesta. Puede ser trabajo hecho a
   * mano o de otra regla: la auditoría lo distingue, esta cuenta no, y por eso
   * la pantalla no dice «a mano» cuando no lo sabe.
   */
  readonly yaClasificados: number
  /** Traspasos y tickets repartidos: coinciden, pero la regla no los toca. */
  readonly omitidos: number
  /** Los que se tocarían de verdad con la casilla tal como está ahora. */
  readonly aTocar: number
  readonly muestra: readonly FilaImpacto[]
}

export type ResultadoImpacto =
  | { readonly estado: 'ok'; readonly impacto: Impacto }
  | { readonly estado: 'error'; readonly motivo: string }

const VACIO: Impacto = {
  total: 0,
  yaClasificados: 0,
  omitidos: 0,
  aTocar: 0,
  muestra: [],
}

/**
 * Pregunta el impacto tres veces y por qué hacen falta las tres:
 *
 *  1. **Sin restringir**: el total de coincidencias, los que ya tienen
 *     categoría y la muestra. Restringiendo desde el principio, «ya
 *     clasificados» daría cero siempre —quedan fuera del filtro— y el aviso
 *     que evita perder trabajo no aparecería nunca.
 *  2. **Restringida a la muestra**: para saber cuáles de esas veinte filas
 *     están sin categorizar. Sale de la misma función en vez de mirar el
 *     nombre de la categoría acá, que sería copiar en la interfaz la
 *     convención de nombres de las bolsas del importador y romperla el día que
 *     alguien la cambie en la base.
 *  3. **Restringida entera**: cuántos se tocarían de verdad. Sólo hace falta
 *     cuando la casilla está marcada.
 */
export async function calcularImpacto(
  client: TenantClient,
  busqueda: RuleMatch,
  soloSinCategorizar: boolean,
): Promise<ResultadoImpacto> {
  try {
    const completo = await previewRule(client, busqueda, {
      soloSinCategorizar: false,
      muestra: MUESTRA,
    })
    if (completo.total === 0) return { estado: 'ok', impacto: VACIO }

    const ids = completo.muestra.map((fila) => fila.entryId)
    const libres =
      ids.length === 0
        ? new Set<string>()
        : new Set(
            (
              await previewRule(client, busqueda, {
                soloSinCategorizar: true,
                entryIds: ids,
                muestra: ids.length,
              })
            ).muestra.map((fila) => fila.entryId),
          )

    const aTocar = soloSinCategorizar
      ? (await previewRule(client, busqueda, { soloSinCategorizar: true, muestra: 0 })).total
      : completo.total

    return {
      estado: 'ok',
      impacto: {
        total: completo.total,
        yaClasificados: completo.yaClasificados,
        omitidos: completo.omitidos,
        aTocar,
        muestra: completo.muestra.map((movimiento) => ({
          movimiento,
          sinCategorizar: libres.has(movimiento.entryId),
        })),
      },
    }
  } catch (error) {
    // Un patrón que Postgres rechaza es un error del usuario y se contesta con
    // el mensaje puesto en el formulario. Cualquier otra cosa es un fallo
    // nuestro y tiene que romper: taparlo con «no se pudo calcular» convierte
    // una avería en un número que falta.
    if (error instanceof ClassifyError) return { estado: 'error', motivo: error.message }
    throw error
  }
}

/**
 * Sólo el recuento, para la columna «afecta hoy» del listado.
 *
 * Va sin muestra —`muestra: 0`— porque el listado no la enseña: esta función se
 * llama una vez por regla, y traerle a cada una una fila de ejemplo que nadie
 * mira duplicaba las consultas de la pantalla para nada.
 *
 * Devuelve `null` cuando la regla no se puede evaluar —una expresión regular
 * que ya no compila—, y la lista lo pinta como tal. Una regla rota no puede
 * tirar la pantalla que sirve justamente para encontrarla.
 */
export async function contarAfectados(
  client: TenantClient,
  busqueda: RuleMatch,
): Promise<number | null> {
  try {
    const preview = await previewRule(client, busqueda, { soloSinCategorizar: false, muestra: 0 })
    return preview.total
  } catch (error) {
    if (error instanceof ClassifyError) return null
    throw error
  }
}
