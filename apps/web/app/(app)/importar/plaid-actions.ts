'use server'

/**
 * Conectar un banco por Plaid, sin navegador.
 *
 * ── Por qué esto no abre ningún formulario ──────────────────────────────────
 *
 * El camino de verdad de Plaid es **Link**: un widget suyo que se abre en el
 * navegador, que necesita un `link_token` del servidor y su script cargado en
 * la página, y dentro del cual la persona teclea las credenciales del banco —
 * que nunca pasan por nosotros. Ese camino está preparado del lado del
 * servidor: `crearLinkToken` existe, acepta `redirectUri` (obligatorio para los
 * bancos OAuth, que en España son casi todos) y `webhook` (que es como se
 * resuelve de verdad el sondeo). Lo único que falta es el script de Link en el
 * navegador y la vuelta desde el banco.
 *
 * En sandbox se puede saltar entero: `/sandbox/public_token/create` devuelve un
 * token público **ya autenticado** para la institución que se le pida, y se
 * canjea igual que el que devolvería Link. Eso es lo que hace esta acción, y es
 * la diferencia práctica más grande con finAPI — allá hacía falta que una
 * persona completase un formulario web y volviera a pulsar un botón porque el
 * cliente del sandbox está UNLICENSED y no admite dirección de retorno.
 *
 * `crearPublicTokenDeSandbox` comprueba el host antes de salir a la red, así
 * que esta acción **no puede funcionar contra producción**: ahí devuelve el
 * error explicándolo, que es exactamente lo que tiene que pasar el día que
 * alguien despliegue esto con credenciales reales.
 */

import { revalidatePath } from 'next/cache'
import { writeHousehold } from '@/lib/data'
import { navItem } from '@/lib/nav'
import { ID_DE_INSTITUCION, institucionDePrueba } from '@/lib/plaid/catalogo'
import { crearPublicTokenDeSandbox } from '@/lib/plaid/client'
import { registrarConexion } from '@/lib/plaid/conexion'
import { PlaidError } from '@/lib/plaid/errores'
import { hogarDePrueba } from '@/lib/plaid/hogar-de-prueba'

export interface EstadoConexionPlaid {
  readonly ok: boolean
  readonly mensaje: string | null
  readonly conexionId: string | null
  readonly banco: string | null
}

/**
 * El estado inicial NO se exporta desde acá, aunque sería el sitio natural: un
 * módulo `'use server'` sólo exporta funciones al cliente y cualquier otra cosa
 * llega como `undefined`, sin ningún error. Vive en `plaid.tsx`, que es del
 * cliente. Es una piedra genérica de las server actions, no de este proveedor.
 */
const SIN_CONEXION: EstadoConexionPlaid = {
  ok: false,
  mensaje: null,
  conexionId: null,
  banco: null,
}

export async function conectarPlaid(
  _previo: EstadoConexionPlaid,
  form: FormData,
): Promise<EstadoConexionPlaid> {
  const institutionId = leer(form, 'banco')
  if (institutionId === undefined || !ID_DE_INSTITUCION.test(institutionId)) {
    return { ...SIN_CONEXION, mensaje: 'No llegó qué institución conectar.' }
  }

  const banco = institucionDePrueba(institutionId)
  // Sólo las del catálogo, y no el nombre que mande el formulario. El nombre se
  // guarda en la conexión y se enseña como institución de las cuentas que se
  // creen: dejar que lo ponga el cliente sería dejar que una cuenta del libro
  // se llame como se le ocurra a quien sepa abrir las herramientas de
  // desarrollo, y ese nombre después parece un dato del banco.
  if (banco === null) {
    return {
      ...SIN_CONEXION,
      mensaje: `La institución ${institutionId} no está en la lista de prueba de esta pantalla.`,
    }
  }

  try {
    const conectado = await writeHousehold(async (client, session) => {
      // Una server action es un endpoint público como cualquier otro: que el
      // botón no se le pinte a un rol no impide que le llegue la petición.
      const permitidos = navItem('/importar')?.roles
      if (permitidos !== undefined && !permitidos.includes(session.role)) {
        return {
          error: `Tu rol en este hogar (${session.role}) no puede conectar bancos.`,
        } as const
      }

      // El usuario por defecto del sandbox devuelve los movimientos de Plaid:
      // `Uber`, `United Airlines`, `INTRST PYMNT`. Se conecta «BBVA» y se ve la
      // vida de un americano inventado, que no prueba nada de lo que este
      // producto tiene que hacer. Con el hogar a medida los descriptores son
      // españoles y **Plaid los enriquece igual**, así que la categoría que
      // vuelve es la que le pondría a un cliente de verdad.
      const hogar = hogarDePrueba(banco.id)
      const publicToken = await crearPublicTokenDeSandbox(
        banco.id,
        ['transactions'],
        hogar === undefined ? {} : { usuarioAMedida: hogar },
      )
      const conexion = await registrarConexion(client, {
        publicToken,
        institutionId: banco.id,
        institutionName: banco.nombre,
      })
      return { conexion } as const
    })

    if ('error' in conectado) return { ...SIN_CONEXION, mensaje: conectado.error }

    revalidatePath('/importar')
    return { ok: true, mensaje: null, conexionId: conectado.conexion.id, banco: banco.nombre }
  } catch (error) {
    return { ...SIN_CONEXION, mensaje: explicar(error) }
  }
}

/**
 * Los errores de Plaid ya vienen con la operación delante y su par
 * `error_type/error_code` detrás. Se devuelven tal cual: el código es lo único
 * que se puede buscar en su documentación, y traducirlo a "no se pudo" borra
 * justamente lo que sirve.
 */
function explicar(error: unknown): string {
  if (error instanceof PlaidError) return error.message
  return error instanceof Error ? error.message : 'No se pudo conectar el banco con Plaid.'
}

function leer(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}
