'use server'

/**
 * Clasificar desde el listado: mover N movimientos de categoría y atribuirlos.
 *
 * Cuatro decisiones gobiernan el módulo:
 *
 *  1. **La pata bancaria no se toca.** Todo lo que escribe esta acción lo
 *     escriben `reclassify` y `setDimensions`, que sólo tocan la pata de
 *     contrapartida y dejan el hecho registrado —fecha, importe, cuenta,
 *     huella— como estaba. Reclasificar no es corregir: el asiento no cambia,
 *     cambia cómo lo clasificamos, y por eso se actualiza en su sitio y queda
 *     en `classification_change` en vez de duplicar el libro. El razonamiento
 *     entero está en la cabecera de 006_clasificacion.sql.
 *  2. **Todo se valida antes de escribir.** Lo que llega es un formulario, o
 *     sea texto de fuera, aunque lo haya pintado esta misma pantalla.
 *  3. **O se hace todo o no se hace nada.** Si la segunda operación falla
 *     después de que la primera funcionó, el error sube y la transacción se
 *     deshace entera. Un parte que dice "no se tocó nada" con media pasada ya
 *     escrita es peor que un error.
 *  4. **El resultado vuelve por la URL.** El formulario funciona sin
 *     JavaScript, así que después de escribir hay una redirección de verdad y
 *     el parte tiene que sobrevivirla. Va a los mismos filtros y a la misma
 *     página desde donde se envió.
 */

import { ClassifyError, type DimensionAssignment, reclassify, setDimensions } from '@moneypilot/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { writeHousehold } from '@/lib/data'
import {
  type Aviso,
  aSearchParams,
  conAviso,
  destinoConResultado,
  leerOpcion,
  puedeClasificar,
  type Resultado,
  SIN_RESULTADO,
} from './clasificacion'
import { PAGE_SIZE, parseFiltros } from './filters'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function clasificar(form: FormData): Promise<void> {
  // El destino se reconstruye pasando la query string por el mismo parseador
  // que usa la pantalla. Es lo que impide que un campo retocado a mano mande
  // la redirección a cualquier sitio: de acá sólo salen filtros válidos de
  // /movimientos, y lo que no lo sea se cae por el camino.
  const filtros = parseFiltros(aSearchParams(texto(form, 'volver')))
  const resultado = await aplicar(form)

  // Sólo si algo cambió de verdad, y fuera de la transacción: dentro estaría
  // invalidando la caché de un cambio que todavía podría deshacerse.
  if (resultado.cambiados > 0 || resultado.conDimensiones > 0) revalidatePath('/movimientos')

  redirect(destinoConResultado(filtros, resultado))
}

/* ── Lo que llegó del formulario ─────────────────────────────────────────── */

interface Peticion {
  readonly entryIds: readonly string[]
  /** Cadena vacía = no cambiar la categoría. */
  readonly categoryId: string
  readonly assignments: readonly DimensionAssignment[]
  readonly valores: readonly string[]
  readonly quitadas: readonly string[]
}

async function aplicar(form: FormData): Promise<Resultado> {
  const peticion = leerPeticion(form)
  if (typeof peticion === 'string') return conAviso(peticion)

  return escribir(peticion)
}

/** La petición, o el aviso que explica por qué no hay ninguna. */
function leerPeticion(form: FormData): Peticion | Aviso {
  // "Todos los de esta página" viaja como los ids que la página pintó y no
  // como una orden de repetir la consulta: lo que se clasifica tiene que ser
  // exactamente lo que el usuario vio, no lo que la base devuelva ahora, que
  // con una importación de por medio puede ser otra cosa.
  const marcados = uuids(form, 'mov')
  const dePagina = texto(form, 'todos') === '1' ? uuids(form, 'mov_pagina') : []
  const entryIds = [...new Set([...marcados, ...dePagina])]

  // Una página trae como mucho PAGE_SIZE movimientos, así que más que eso no
  // salió de esta pantalla. Recortar en silencio sería lo de siempre: aplicar
  // a una parte y contarlo como el todo.
  if (entryIds.length > PAGE_SIZE) return 'demasiados'
  if (entryIds.length === 0) return 'nada'

  const categoryId = texto(form, 'categoria')
  if (categoryId !== '' && !UUID.test(categoryId)) return 'datos'

  const porDimension = new Map<string, Set<string>>()
  const aQuitar = new Set<string>()
  for (const bruto of cadenas(form, 'valor')) {
    const opcion = leerOpcion(bruto)
    if (opcion === null) return 'datos'
    if (opcion.valueId === null) {
      aQuitar.add(opcion.dimensionId)
      continue
    }
    const valores = porDimension.get(opcion.dimensionId) ?? new Set<string>()
    valores.add(opcion.valueId)
    porDimension.set(opcion.dimensionId, valores)
  }

  // Dos valores de la misma dimensión es un reparto, y el peso de cada parte
  // no lo podemos poner nosotros. Mitad y mitad sería un dato inventado con
  // cara de decisión del usuario.
  for (const valores of porDimension.values()) {
    if (valores.size > 1) return 'repartida'
  }

  const assignments: DimensionAssignment[] = []
  const valores: string[] = []
  for (const [dimensionId, elegidos] of porDimension) {
    const valueId = [...elegidos][0]
    if (valueId === undefined) continue
    // Elegir un valor y además "quitar esta dimensión" es contradictorio.
    // Gana poner: es la opción concreta, y quitar es la genérica del grupo.
    aQuitar.delete(dimensionId)
    assignments.push({ dimensionId, dimensionValueId: valueId })
    valores.push(valueId)
  }
  for (const dimensionId of aQuitar) {
    assignments.push({ dimensionId, dimensionValueId: null })
  }

  if (categoryId === '' && assignments.length === 0) return 'sin-destino'

  return { entryIds, categoryId, assignments, valores, quitadas: [...aQuitar] }
}

/* ── La escritura ────────────────────────────────────────────────────────── */

/**
 * Un rechazo que hay que contar, no un error que haya que tragarse.
 *
 * Se lanza para que la transacción se deshaga —si `reclassify` funcionó y
 * `setDimensions` no, nada tiene que quedar escrito— y se atrapa fuera para
 * poder contestar con una explicación en vez de con una pantalla de error.
 */
class Rechazo extends Error {
  readonly resultado: Resultado

  constructor(resultado: Resultado) {
    super(resultado.detalle ?? 'clasificación rechazada')
    this.name = 'Rechazo'
    this.resultado = resultado
  }
}

async function escribir(peticion: Peticion): Promise<Resultado> {
  try {
    return await writeHousehold(async (client, session) => {
      // B6. El rol se comprueba acá y no sólo en la pantalla: esconder el
      // botón no es un control de acceso, es una sugerencia.
      if (!puedeClasificar(session.role)) throw new Rechazo(conAviso('rol', session.role))

      // El correo y no el uuid: la auditoría la va a leer una persona, y
      // "quién" con un uuid delante no contesta la pregunta de B6.
      const autor = session.user.email ?? session.user.id
      const entryIds = [...peticion.entryIds]

      // Los dos motivos de omisión son el mismo asiento visto dos veces, así
      // que se juntan por id: contar dos veces el mismo traspaso diría que
      // quedaron fuera más movimientos de los que se pidieron.
      const omitidos = new Map<string, string>()
      let cambiados = 0
      let yaEstaban = 0
      let conDimensiones = 0

      try {
        if (peticion.categoryId !== '') {
          const hecho = await reclassify(client, {
            entryIds,
            categoryId: peticion.categoryId,
            changedBy: autor,
          })
          cambiados = hecho.changed
          yaEstaban = hecho.yaEstaban
          for (const omitido of hecho.omitidos) omitidos.set(omitido.entryId, omitido.motivo)
        }

        if (peticion.assignments.length > 0) {
          const hecho = await setDimensions(client, {
            entryIds,
            assignments: peticion.assignments,
            changedBy: autor,
          })
          conDimensiones = hecho.changed
          for (const omitido of hecho.omitidos) omitidos.set(omitido.entryId, omitido.motivo)
        }
      } catch (error) {
        if (error instanceof ClassifyError) throw new Rechazo(conAviso('base', error.message))
        throw error
      }

      return {
        ...SIN_RESULTADO,
        pedidos: entryIds.length,
        cambiados,
        yaEstaban,
        conDimensiones,
        sinContrapartida: cuantos(omitidos, 'sin-contrapartida'),
        repartos: cuantos(omitidos, 'reparto'),
        inexistentes: cuantos(omitidos, 'inexistente'),
        categoryId: peticion.categoryId === '' ? null : peticion.categoryId,
        valores: peticion.valores,
        quitadas: peticion.quitadas,
      }
    })
  } catch (error) {
    if (error instanceof Rechazo) return error.resultado
    throw error
  }
}

function cuantos(omitidos: ReadonlyMap<string, string>, motivo: string): number {
  let total = 0
  for (const valor of omitidos.values()) if (valor === motivo) total += 1
  return total
}

/* ── Lectura del FormData ────────────────────────────────────────────────── */

function texto(form: FormData, nombre: string): string {
  const valor = form.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

function cadenas(form: FormData, nombre: string): string[] {
  return form.getAll(nombre).filter((valor): valor is string => typeof valor === 'string')
}

function uuids(form: FormData, nombre: string): string[] {
  return cadenas(form, nombre).filter((valor) => UUID.test(valor))
}
