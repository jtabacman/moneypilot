'use server'

/**
 * Escritura de reglas: crear, guardar, aplicar y borrar.
 *
 * Dos cosas gobiernan el módulo:
 *
 *  1. **No se aplica lo que no se vio.** Aplicar una regla mueve la categoría
 *     de cientos de movimientos, así que la acción recalcula la firma de los
 *     criterios que llegan y la compara con la de la vista previa que el
 *     usuario tenía delante. Si no coinciden —tocó un campo y pulsó
 *     directamente— no escribe: devuelve el formulario pidiendo mirar el
 *     impacto otra vez. Es barato, y es la diferencia entre una pasada
 *     revisada y una pasada a ciegas.
 *  2. **Una acción es un endpoint.** Que a un rol no se le pinte el botón no
 *     impide que le llegue la petición, así que el rol se comprueba acá dentro
 *     y no en la pantalla.
 */

import {
  type ApplyRuleResult,
  accountBalances,
  applyRule,
  ClassifyError,
  createRule,
  deleteRule,
  dimensionsWithValues,
  type RuleInput,
  updateRule,
} from '@moneypilot/db'
import type { Route } from 'next'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { writeHousehold } from '@/lib/data'
import type { Session } from '@/lib/session'
import {
  aBusqueda,
  aDimensiones,
  aQuery,
  type Criterios,
  camposDeForm,
  decimalesDe,
  firmaDe,
  leerCriterios,
} from './criterios'
import {
  type EstadoRegla,
  falla,
  hecho,
  porQueNoEscribe,
  propuesta,
  puedeEditarReglas,
} from './state'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/* ── Ver el impacto ──────────────────────────────────────────────────────── */

/**
 * Lleva lo que hay escrito en el formulario a la URL, que es donde vive el
 * estado de esta pantalla.
 *
 * No escribe nada: recalcular la vista previa es una lectura, y por eso la
 * pueden pedir también el contador y el asistente, que es como preparan lo que
 * van a proponer.
 */
export async function verImpacto(form: FormData): Promise<void> {
  const criterios = leerCriterios(camposDeForm(form), {
    dimensionIds: dimensionesDelFormulario(form),
  })
  const query = new URLSearchParams(aQuery(criterios))
  // El otro texto del comercio no es un criterio, pero viaja: si se perdiera al
  // recalcular, el atajo para probar con el descriptor del banco desaparecería
  // justo cuando la vista previa acaba de decir que no coincide con nada.
  const ejemplo = campo(form, 'ejemplo')
  if (ejemplo !== '') query.set('ejemplo', ejemplo)
  // El destino sale del id de la regla y no de un campo con la ruta escrita:
  // un formulario es texto de fuera, y una ruta que llega escrita es una
  // redirección abierta esperando a que alguien la pruebe. Acá lo único que
  // puede llegar es un uuid, y si no lo es, se vuelve a la pantalla de alta.
  const reglaId = campo(form, 'reglaId')
  const destino = UUID.test(reglaId) ? `/reglas/${reglaId}` : '/reglas/nueva'
  // `redirect` está tipado contra las rutas del proyecto y ésta se arma en
  // ejecución; la comprobación de arriba es lo que sostiene la afirmación.
  redirect(`${destino}?${query}` as Route)
}

/** Qué dimensiones trae el formulario, sin ir a preguntárselo a la base. */
function dimensionesDelFormulario(form: FormData): string[] {
  const ids = new Set<string>()
  for (const clave of form.keys()) {
    if (!clave.startsWith('dim.')) continue
    const id = clave.slice('dim.'.length)
    if (UUID.test(id)) ids.add(id)
  }
  return [...ids]
}

/* ── Guardar y aplicar ───────────────────────────────────────────────────── */

/**
 * Guardar y guardar-y-aplicar son dos acciones y no una con un campo oculto.
 *
 * No es gusto: React usa el `name` de un botón para codificar qué acción
 * invocar, así que un `<button name="intencion" value="aplicar">` con una
 * función en `formAction` se queda sin ese valor y avisa por consola. Con dos
 * puntos de entrada, cuál se ejecuta lo dice el botón que se pulsó, que además
 * es lo que hace imposible que «guardar» aplique por accidente.
 */
export async function guardarSinAplicar(previo: EstadoRegla, form: FormData): Promise<EstadoRegla> {
  return guardar('guardar', previo, form)
}

export async function guardarYAplicar(previo: EstadoRegla, form: FormData): Promise<EstadoRegla> {
  return guardar('aplicar', previo, form)
}

async function guardar(
  intencion: 'guardar' | 'aplicar',
  _previo: EstadoRegla,
  form: FormData,
): Promise<EstadoRegla> {
  const reglaId = campo(form, 'reglaId')
  const firmaVista = campo(form, 'firma')

  if (reglaId !== '' && !UUID.test(reglaId)) return falla('No se sabe qué regla estás guardando.')

  let aplicado = false
  let resultado: EstadoRegla
  try {
    const salida = await writeHousehold(async (client, session) => {
      if (!puedeEditarReglas(session.role)) {
        return { estado: propuesta(porQueNoEscribe(session.role)), aplicado: false }
      }

      const [cuentas, dimensiones] = await Promise.all([
        accountBalances(client),
        dimensionsWithValues(client),
      ])
      const criterios = leerCriterios(camposDeForm(form), {
        dimensionIds: dimensiones.map((dim) => dim.id),
      })

      const moneda = cuentas.find((cuenta) => cuenta.id === criterios.cuentaId)?.currency ?? null
      const digits = decimalesDe(moneda, session.baseCurrency)

      const busqueda = aBusqueda(criterios, digits)
      if (!busqueda.ok) return { estado: falla(busqueda.error), aplicado: false }

      const atribucion = aDimensiones(
        criterios,
        new Map(dimensiones.map((dim) => [dim.id, dim.label])),
      )
      if (!atribucion.ok) return { estado: falla(atribucion.error), aplicado: false }

      if (intencion === 'aplicar' && firmaVista !== firmaDe(criterios)) {
        return {
          estado: falla(
            'Los criterios cambiaron desde la última vista previa, así que no se aplicó nada. ' +
              'Pulsá «Ver el impacto» y revisá a cuántos movimientos alcanza ahora antes de ' +
              'aplicar: es el paso que evita reclasificar cientos de movimientos sin mirar.',
          ),
          aplicado: false,
        }
      }

      const entrada: RuleInput = {
        name: criterios.nombre,
        matchKind: busqueda.valor.matchKind,
        matchValue: busqueda.valor.matchValue,
        accountId: busqueda.valor.accountId ?? null,
        minAmount: busqueda.valor.minAmount ?? null,
        maxAmount: busqueda.valor.maxAmount ?? null,
        categoryId: criterios.categoriaId,
        priority: criterios.prioridad,
        enabled: criterios.activa,
        dimensions: atribucion.valor,
        createdBy: autor(session),
      }

      const regla =
        reglaId === ''
          ? await createRule(client, entrada)
          : await updateRule(client, reglaId, {
              name: entrada.name,
              matchKind: entrada.matchKind,
              matchValue: entrada.matchValue,
              accountId: entrada.accountId,
              minAmount: entrada.minAmount,
              maxAmount: entrada.maxAmount,
              categoryId: entrada.categoryId,
              priority: entrada.priority,
              enabled: entrada.enabled,
              dimensions: entrada.dimensions,
            })

      if (intencion === 'guardar') {
        return {
          estado: hecho(
            `«${regla.name}» ${reglaId === '' ? 'creada' : 'guardada'}. Todavía no tocó ningún ` +
              'movimiento: se aplicará sola a lo que entre de acá en adelante, y sobre lo que ya ' +
              'está sólo si pulsás «Guardar y aplicar».',
            regla.id,
          ),
          aplicado: false,
        }
      }

      const efecto = await applyRule(client, regla.id, {
        soloSinCategorizar: criterios.soloSinCategorizar,
        changedBy: autor(session),
      })
      return {
        estado: hecho(resumenDeAplicacion(regla.name, criterios, efecto), regla.id),
        aplicado: efecto.changed > 0,
      }
    })
    resultado = salida.estado
    aplicado = salida.aplicado
  } catch (error) {
    // Los mensajes de ClassifyError están escritos para leerse en pantalla
    // —dicen qué falta y por qué—, así que se devuelven tal cual en vez de
    // convertirse en una página de error que le pierde el sitio al usuario.
    if (error instanceof ClassifyError) return falla(error.message)
    throw error
  }

  // Aplicar mueve categorías, y de ahí cuelgan el gasto del mes, el coste por
  // propiedad y el cierre. Guardar sin aplicar sólo cambia esta sección — pero
  // sí las dos pantallas: la lista y la de la propia regla, que si no seguiría
  // enseñando el impacto y el nombre de antes de guardar.
  if (resultado.status === 'ok' && aplicado) revalidatePath('/', 'layout')
  else if (resultado.status === 'ok') {
    revalidatePath('/reglas')
    revalidatePath('/reglas/[id]', 'page')
  }
  return resultado
}

/** Lo que de verdad cambió, que no es lo mismo que lo que coincidía. */
function resumenDeAplicacion(
  nombre: string,
  criterios: Criterios,
  efecto: ApplyRuleResult,
): string {
  const partes: string[] = []

  partes.push(
    efecto.changed === 0
      ? `«${nombre}» no cambió ningún movimiento.`
      : `«${nombre}» cambió ${efecto.changed} ${efecto.changed === 1 ? 'movimiento' : 'movimientos'}.`,
  )

  if (efecto.yaEstaban > 0) {
    partes.push(
      `${efecto.yaEstaban} ya ${efecto.yaEstaban === 1 ? 'estaba' : 'estaban'} en esa categoría y no se ${efecto.yaEstaban === 1 ? 'tocó' : 'tocaron'}.`,
    )
  }

  const traspasos = efecto.omitidos.filter((o) => o.motivo === 'sin-contrapartida').length
  const repartos = efecto.omitidos.filter((o) => o.motivo === 'reparto').length
  if (traspasos > 0) {
    partes.push(
      `${traspasos} ${traspasos === 1 ? 'era un traspaso' : 'eran traspasos'} entre cuentas tuyas: no hay categoría que cambiar.`,
    )
  }
  if (repartos > 0) {
    partes.push(
      `${repartos} ${repartos === 1 ? 'reparte' : 'reparten'} entre varias categorías y se ${repartos === 1 ? 'dejó' : 'dejaron'} como ${repartos === 1 ? 'estaba' : 'estaban'}: aplastarlos a una sola categoría destruiría el reparto.`,
    )
  }

  if (efecto.changed === 0 && criterios.soloSinCategorizar) {
    partes.push('Con la casilla marcada sólo se tocan los que están sin categorizar.')
  }

  return partes.join(' ')
}

/* ── Borrar ──────────────────────────────────────────────────────────────── */

/**
 * Borra la regla. Lo que ya clasificó **se queda como está**: la auditoría
 * conserva la fila y suelta el puntero, así que la historia sigue diciendo que
 * hubo un cambio automático. Deshacer una clasificación es reclasificar, no
 * borrar la regla que la hizo.
 */
export async function borrarRegla(_previo: EstadoRegla, form: FormData): Promise<EstadoRegla> {
  const reglaId = campo(form, 'reglaId')
  if (!UUID.test(reglaId)) return falla('No se sabe qué regla borrar.')

  let resultado: EstadoRegla
  try {
    resultado = await writeHousehold(async (client, session) => {
      if (!puedeEditarReglas(session.role)) return propuesta(porQueNoEscribe(session.role))
      const { deleted } = await deleteRule(client, reglaId)
      return deleted ? hecho('Regla borrada.') : falla('Esa regla ya no existe.')
    })
  } catch (error) {
    if (error instanceof ClassifyError) return falla(error.message)
    throw error
  }

  if (resultado.status !== 'ok') return resultado
  revalidatePath('/reglas')
  // Fuera del try: `redirect` funciona lanzando, y capturarlo acá lo dejaría
  // en «borrada» sin moverse de una pantalla que ya no tiene qué enseñar.
  redirect('/reglas')
}

/* ── Piezas ──────────────────────────────────────────────────────────────── */

function campo(form: FormData, nombre: string): string {
  const valor = form.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

/**
 * Quién lo hizo, para `classification_change`.
 *
 * El correo y no el uuid: la tabla la lee una persona buscando quién movió una
 * categoría, y un uuid no contesta esa pregunta sin otra consulta.
 */
function autor(session: Session): string {
  return session.user.email ?? session.user.id
}
