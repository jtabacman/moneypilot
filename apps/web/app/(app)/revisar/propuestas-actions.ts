'use server'

/**
 * Aceptar o descartar una categoría que propone el motor.
 *
 * ── Por qué en un módulo aparte de `actions.ts` ─────────────────────────────
 *
 * Porque no son la misma decisión, y la cabecera de `actions.ts` lo fija por
 * escrito: allá «aceptar» significa **este movimiento vale, que cuente en el
 * libro**, y «rechazar» significa que no entra. Acá el movimiento ya está en el
 * libro y nadie lo discute; lo que se acepta o se descarta es **una categoría
 * concreta**. Meter las dos cosas en la misma acción obligaría a que los
 * botones significaran cosas distintas según la fila, que es exactamente lo que
 * `rotulosDeDecision` existe para evitar.
 *
 * ── Aceptar es lo que enseña al motor ───────────────────────────────────────
 *
 * No hay ninguna función «recordar»: la memoria del hogar se alimenta sola
 * leyendo `classification_change`, y cuenta una fila como decisión de una
 * persona cuando no tiene `rule_id` y su autor no lleva el prefijo `sistema:`.
 * O sea: **firmar la reclasificación con el correo de quien confirma es lo que
 * hace que el recuerdo cuente hacia el mínimo de tres**. Firmarla como el motor
 * la dejaría aplicada y no enseñaría nada, y el producto seguiría preguntando
 * lo mismo para siempre.
 *
 * Por eso tampoco se copia la `procedencia` de la propuesta: la decisión es de
 * la persona. La capa que la sugirió va en el motivo, que es donde se puede
 * leer sin que el sistema se atribuya lo que decidió otro.
 */

import {
  ClassifyError,
  type DimensionAssignment,
  rechazarPropuesta,
  reclassify,
  setDimensions,
} from '@moneypilot/db'
import { revalidatePath } from 'next/cache'
import { CAPA_CORTA } from '@/lib/capas'
import { writeHousehold } from '@/lib/data'
import { motivoSinPermiso, puedeResolver } from './decision'

/**
 * El estado inicial NO se exporta desde acá, aunque sería el sitio natural.
 *
 * Un módulo `'use server'` **sólo puede exportar funciones async**: cualquier
 * otra cosa hace que Next tire «A "use server" file can only export async
 * functions, found object» en cuanto se renderiza la pantalla. No lo detecta el
 * compilador —el build de producción pasa— y aparece al primer clic. Vive en
 * `propuestas.tsx`, que es del cliente. Es la misma piedra que ya se pisó con
 * las acciones de Plaid.
 */
export interface EstadoDePropuesta {
  readonly ok: boolean
  readonly mensaje: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function decidirPropuesta(
  _previo: EstadoDePropuesta,
  form: FormData,
): Promise<EstadoDePropuesta> {
  const entryId = campo(form, 'entryId')
  const categoryId = campo(form, 'categoryId')
  const decision = campo(form, 'decision')

  if (!UUID.test(entryId) || !UUID.test(categoryId)) {
    return { ok: false, mensaje: 'No llegó sobre qué movimiento se estaba decidiendo.' }
  }
  if (decision !== 'aceptar' && decision !== 'descartar') {
    return { ok: false, mensaje: 'No llegó qué se decidió.' }
  }

  const procedencia = campo(form, 'procedencia')
  const motivo = campo(form, 'motivo')
  const categoria = campo(form, 'categoria')

  try {
    const resultado = await writeHousehold(async (client, session) => {
      // Una server action es un endpoint público: que el botón no se le pinte a
      // un rol no impide que le llegue la petición.
      if (!puedeResolver(session.role)) {
        return { ok: false, mensaje: motivoSinPermiso(session.role) } as const
      }
      const autor = session.user.email ?? session.user.id

      if (decision === 'descartar') {
        await rechazarPropuesta(client, {
          entryId,
          categoryId,
          ...(esProcedencia(procedencia) ? { procedencia } : {}),
          ...(motivo === '' ? {} : { motivo }),
          rechazadoPor: autor,
        })
        return {
          ok: true,
          mensaje: `Descartada. El movimiento se queda sin categorizar y no se te va a volver a ofrecer ${categoria === '' ? 'esa categoría' : `«${categoria}»`}.`,
        } as const
      }

      const hecho = await reclassify(client, {
        entryIds: [entryId],
        categoryId,
        changedBy: autor,
        motivo: comoMotivo(procedencia, motivo),
      })

      if (hecho.changed === 0) {
        const omitido = hecho.omitidos[0]
        return {
          ok: false,
          mensaje:
            omitido === undefined
              ? 'No se pudo mover ese movimiento y no se dijo por qué.'
              : `No se movió: ${omitido.motivo}.`,
        } as const
      }

      const dimensiones = leerDimensiones(form)
      // `setDimensions` lanza si la lista llega vacía: no es lo mismo «sin
      // dimensiones» que «quitarle las que tenga».
      if (dimensiones.length > 0) {
        await setDimensions(client, {
          entryIds: [entryId],
          assignments: dimensiones,
          changedBy: autor,
        })
      }

      return {
        ok: true,
        mensaje: `Hecho${categoria === '' ? '' : `: ${categoria}`}. Confirmá dos veces más el mismo comercio y a partir de ahí se clasifica solo.`,
      } as const
    })

    // Cambia la cola, cambian los totales por categoría y cambia el registro.
    if (resultado.ok) revalidatePath('/', 'layout')
    return resultado
  } catch (error) {
    if (error instanceof ClassifyError) return { ok: false, mensaje: error.message }
    return {
      ok: false,
      mensaje: error instanceof Error ? error.message : 'No se pudo aplicar la decisión.',
    }
  }
}

/**
 * El motivo que queda en la auditoría.
 *
 * Cita de dónde salió la sugerencia sin atribuirle la decisión: dentro de un
 * año, «lo puso el diccionario» y «lo confirmaste vos cuando el diccionario lo
 * sugirió» llevan a acciones distintas si el número sale raro.
 */
function comoMotivo(procedencia: string, motivo: string): string {
  // `CAPA` son frases completas con su artículo dentro —«el diccionario de
  // comercios»—, así que no se les puede anteponer «de»: salía «la sugerencia
  // de el diccionario». Se usa la etiqueta corta, que sí encaja en una
  // preposición, y la frase larga se queda para donde va sola.
  const capa = esProcedencia(procedencia) ? CAPA_CORTA[procedencia] : null
  const origen = capa === null ? 'la sugerencia del motor' : `la sugerencia de ${capa}`
  return motivo === '' ? `Confirmaste ${origen}.` : `Confirmaste ${origen}: ${motivo}`
}

const PROCEDENCIAS = ['regla', 'memoria', 'senal', 'proveedor', 'diccionario'] as const
type ProcedenciaConocida = (typeof PROCEDENCIAS)[number]

function esProcedencia(valor: string): valor is ProcedenciaConocida {
  return (PROCEDENCIAS as readonly string[]).includes(valor)
}

/**
 * Las dimensiones que traía la propuesta, si traía.
 *
 * Viajan por el formulario y no se recalculan acá a propósito: lo que se acepta
 * es lo que se vio en pantalla. Recalcular abriría la puerta a que la persona
 * confirme una cosa y se guarde otra porque el motor cambió de opinión entre el
 * render y el clic.
 */
function leerDimensiones(form: FormData): DimensionAssignment[] {
  const crudo = campo(form, 'dimensiones')
  if (crudo === '') return []
  try {
    const leido: unknown = JSON.parse(crudo)
    if (!Array.isArray(leido)) return []
    return leido.flatMap((item) => {
      if (typeof item !== 'object' || item === null) return []
      const fila = item as Record<string, unknown>
      const dimensionId = fila['dimensionId']
      const dimensionValueId = fila['dimensionValueId']
      const weightPpm = fila['weightPpm']
      if (typeof dimensionId !== 'string' || !UUID.test(dimensionId)) return []
      if (typeof dimensionValueId !== 'string' || !UUID.test(dimensionValueId)) return []
      if (typeof weightPpm !== 'number' || !Number.isFinite(weightPpm)) return []
      return [{ dimensionId, dimensionValueId, weightPpm }]
    })
  } catch {
    return []
  }
}

function campo(form: FormData, nombre: string): string {
  const valor = form.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}
