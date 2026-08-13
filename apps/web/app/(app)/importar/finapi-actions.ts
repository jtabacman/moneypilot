'use server'

/**
 * Conectar un banco: dar de alta al hogar en finAPI y abrir el formulario.
 *
 * Lo que **no** hace esta acción es pedir credenciales bancarias, y no es una
 * omisión: las teclea la persona en el sitio de finAPI y nunca pasan por
 * nosotros. Este cliente tiene prohibidas las llamadas directas de importación
 * —`POST /bankConnections/import` contesta "Für diesen Client sind direkte
 * API-Aufrufe nicht zulässig"—, así que el formulario web no es una comodidad:
 * es el único camino, y además es el correcto.
 *
 * La acción devuelve una URL y ahí se acaba su trabajo. No hay vuelta
 * automática: el sandbox es UNLICENSED y cualquier `redirectUrl` da
 * INVALID_REDIRECT_URL, así que nadie nos avisa de que la persona terminó. El
 * estado se sondea desde /api/finapi/sincronizar, y la pantalla lo dice.
 */

import { recordConnection } from '@moneypilot/db'
import { revalidatePath } from 'next/cache'
import { writeHousehold } from '@/lib/data'
import { crearWebForm, tokenDeUsuario } from '@/lib/finapi/client'
import { FinapiError } from '@/lib/finapi/errores'
import { PROVEEDOR, usuarioDelHogar } from '@/lib/finapi/hogar'
import { navItem } from '@/lib/nav'

export interface EstadoConexion {
  readonly ok: boolean
  readonly mensaje: string | null
  /** La URL del formulario de finAPI. Se abre en una pestaña nueva. */
  readonly url: string | null
  readonly conexionId: string | null
  readonly banco: string | null
  /** Instante de caducidad tal cual lo manda finAPI. */
  readonly expiraEn: string | null
}

/**
 * El estado inicial NO se exporta desde acá, aunque sería el sitio natural.
 *
 * Un módulo `'use server'` sólo exporta funciones al cliente: cualquier otra
 * cosa llega como `undefined`, sin ningún error. Con el objeto declarado acá,
 * `useActionState` arrancaba con un estado cuyos campos eran todos `undefined`,
 * y como `undefined !== null`, la pantalla pintaba de entrada "no se abrió la
 * conexión" —sin decir por qué, porque no había por qué— y el bloque del
 * sondeo con cero botones. Vive en `banco.tsx`, que es del cliente.
 */
const SIN_CONEXION_INTERNO: EstadoConexion = {
  ok: false,
  mensaje: null,
  url: null,
  conexionId: null,
  banco: null,
  expiraEn: null,
}

/** Los ids de banco de finAPI son enteros. Se valida antes de llegar a la red. */
const ID_DE_BANCO = /^\d{1,12}$/

export async function conectarBanco(
  _previo: EstadoConexion,
  form: FormData,
): Promise<EstadoConexion> {
  const bankId = leer(form, 'banco')
  const bankName = leer(form, 'nombre') ?? 'Banco de prueba'

  if (bankId === undefined || !ID_DE_BANCO.test(bankId)) {
    return { ...SIN_CONEXION_INTERNO, mensaje: 'No llegó qué banco conectar.' }
  }

  try {
    const abierto = await writeHousehold(async (client, session) => {
      // Una server action es un endpoint público como cualquier otro: que el
      // botón no se le pinte a un rol no impide que le llegue la petición.
      const permitidos = navItem('/importar')?.roles
      if (permitidos !== undefined && !permitidos.includes(session.role)) {
        return {
          error: `Tu rol en este hogar (${session.role}) no puede conectar bancos.`,
        } as const
      }

      const usuario = await usuarioDelHogar(client)
      const token = await tokenDeUsuario(usuario.externalId, usuario.accessSecret)

      const formulario = await crearWebForm(token, Number(bankId), {
        nombreDeConexion: `${bankName} · ${session.householdName}`,
      })

      const conexion = await recordConnection(client, {
        provider: PROVEEDOR,
        bankId,
        bankName,
        webFormId: formulario.id,
        // El estado inicial que declara finAPI para un formulario recién
        // creado. Se guarda desde el principio para que el sondeo tenga contra
        // qué comparar aunque la persona cierre la pestaña ahora mismo.
        status: 'NOT_YET_OPENED',
      })

      return { conexion, formulario } as const
    })

    if ('error' in abierto) return { ...SIN_CONEXION_INTERNO, mensaje: abierto.error }

    revalidatePath('/importar')

    return {
      ok: true,
      mensaje: null,
      url: abierto.formulario.url,
      conexionId: abierto.conexion.id,
      banco: bankName,
      expiraEn: abierto.formulario.expiresAt,
    }
  } catch (error) {
    return { ...SIN_CONEXION_INTERNO, mensaje: explicar(error) }
  }
}

/**
 * Los errores de finAPI vienen con la operación que fallaba delante y el texto
 * del servidor detrás, a veces en alemán. Se devuelven tal cual: es la única
 * pista para buscarlo en su documentación, y traducirlo a "no se pudo" borra
 * justamente lo que sirve.
 */
function explicar(error: unknown): string {
  if (error instanceof FinapiError) return error.message
  return error instanceof Error ? error.message : 'No se pudo abrir el formulario de finAPI.'
}

function leer(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}
