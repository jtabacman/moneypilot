/**
 * Sondear el formulario y traer los movimientos, de a una cuenta.
 *
 * Es una ruta y no una server action por el tiempo. Traer 1.612 movimientos
 * son cuatro páginas de finAPI más la deduplicación contra lo que ya está en
 * el libro más la escritura de los asientos, y eso necesita un `maxDuration`
 * propio que una acción colgada de una página no puede declarar.
 *
 * ── Por qué hay dos acciones y no una ────────────────────────────────────────
 *
 * `preparar` sondea el formulario y deja creada una cuenta del libro por cada
 * cuenta de finAPI. `cuenta` sincroniza **una** y devuelve su informe. La
 * pantalla llama a la primera y después a la segunda tantas veces como cuentas
 * haya, enseñando el avance.
 *
 * Partirlo así no es para que se vea bonito: es lo que garantiza que ninguna
 * petición se corte a la mitad dejando medio lote escrito. Cada llamada corre
 * dentro de su propia transacción de hogar —`writeHousehold`— y escribe un
 * lote entero o ninguno. Si la tercera cuenta falla, las dos primeras ya están
 * en el libro, completas y reversibles desde el historial, y la tercera no
 * dejó nada.
 *
 * ── El sondeo, y por qué existe ──────────────────────────────────────────────
 *
 * En producción con licencia, finAPI vuelve a la aplicación por `redirectUrl`
 * cuando la persona termina. Este cliente del sandbox está UNLICENSED y
 * cualquier valor de `redirectUrl` da INVALID_REDIRECT_URL, así que no hay
 * vuelta: alguien tiene que preguntar. Eso es lo que hace `preparar`, y es el
 * motivo del botón "Ya terminé" en la pantalla.
 */

import { listConnections, readConnection, updateConnection } from '@moneypilot/db'
import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { writeHousehold } from '@/lib/data'
import { estadoWebForm } from '@/lib/finapi/client'
import { FinapiError } from '@/lib/finapi/errores'
import { PROVEEDOR, tokenDelHogar } from '@/lib/finapi/hogar'
import {
  type CuentaDelFeed,
  prepararCuentas,
  type ResultadoDeCuenta,
  SincronizacionError,
  sincronizarCuenta,
} from '@/lib/finapi/sincronizar'
import { esEstadoFinal } from '@/lib/finapi/tipos'
import { navItem } from '@/lib/nav'
import { resolveSession } from '@/lib/session'

export const runtime = 'nodejs'

/**
 * Cinco minutos. El tope real del trabajo no es éste sino el troceo por
 * cuenta: aunque el despliegue recorte esta cifra, lo peor que puede pasar es
 * que se corte **entre** cuentas, y ahí no hay nada a medio escribir. El
 * número está alto para que una cuenta con 24 meses de histórico quepa entera.
 */
export const maxDuration = 300

export async function POST(request: Request): Promise<NextResponse> {
  const state = await resolveSession()
  if (state.kind === 'anonymous') {
    return NextResponse.json({ error: 'Tenés que entrar para sincronizar.' }, { status: 401 })
  }
  if (state.kind === 'expired') {
    return NextResponse.json(
      { error: 'Tu acceso a este hogar caducó, así que no se puede escribir en él.' },
      { status: 403 },
    )
  }

  const permitidos = navItem('/importar')?.roles
  if (permitidos !== undefined && !permitidos.includes(state.session.role)) {
    return NextResponse.json(
      { error: `Tu rol en este hogar (${state.session.role}) no puede sincronizar bancos.` },
      { status: 403 },
    )
  }

  let cuerpo: unknown
  try {
    cuerpo = await request.json()
  } catch {
    return NextResponse.json({ error: 'El cuerpo de la petición no es JSON.' }, { status: 400 })
  }

  const peticion = leerPeticion(cuerpo)
  if (peticion === null) {
    return NextResponse.json(
      { error: 'Falta decir qué hacer: "preparar" o "cuenta".' },
      { status: 400 },
    )
  }

  try {
    if (peticion.accion === 'preparar') {
      const resultado = await preparar(peticion.conexion)
      return NextResponse.json(resultado, { status: resultado.estado === 'fallo' ? 409 : 200 })
    }
    const resultado = await sincronizar(peticion.cuenta)
    // Los saldos, los tableros y la cola de revisión acaban de cambiar en
    // todas las pantallas, no sólo en ésta.
    revalidatePath('/', 'layout')
    return NextResponse.json(resultado)
  } catch (error) {
    return fallo(error)
  }
}

/* ── Peticiones ───────────────────────────────────────────────────────────── */

type Peticion =
  | { readonly accion: 'preparar'; readonly conexion: string | null }
  | { readonly accion: 'cuenta'; readonly cuenta: string }

function leerPeticion(cuerpo: unknown): Peticion | null {
  if (typeof cuerpo !== 'object' || cuerpo === null) return null
  const raiz = cuerpo as Record<string, unknown>
  const accion = raiz['accion']

  if (accion === 'preparar') {
    const conexion = raiz['conexion']
    return { accion: 'preparar', conexion: typeof conexion === 'string' ? conexion : null }
  }
  if (accion === 'cuenta') {
    const cuenta = raiz['cuenta']
    if (typeof cuenta !== 'string' || cuenta.trim() === '') return null
    return { accion: 'cuenta', cuenta: cuenta.trim() }
  }
  return null
}

/* ── Preparar ─────────────────────────────────────────────────────────────── */

interface Preparado {
  readonly estado: 'listo' | 'esperando' | 'fallo'
  /** El estado tal cual lo dice finAPI, sin traducir. */
  readonly status: string | null
  readonly mensaje: string | null
  readonly cuentas: readonly CuentaDelFeed[]
}

async function preparar(conexionId: string | null): Promise<Preparado> {
  return writeHousehold(async (client) => {
    const token = await tokenDelHogar(client)
    if (token === null) {
      return {
        estado: 'fallo' as const,
        status: null,
        mensaje:
          'Este hogar todavía no tiene usuario en finAPI. Conectá un banco primero: el usuario ' +
          'se crea en ese momento.',
        cuentas: [],
      }
    }

    const conexion = conexionId === null ? null : await readConnection(client, conexionId)

    if (conexion !== null) {
      const estado = await estadoWebForm(token, conexion.webFormId)
      await updateConnection(client, {
        id: conexion.id,
        status: estado.status,
        bankConnectionId: estado.payload.bankConnectionId,
        errorDetail: mensajeDeError(estado.payload.errorCode, estado.payload.errorMessage),
      })

      if (!esEstadoFinal(estado.status)) {
        return {
          estado: 'esperando' as const,
          status: estado.status,
          mensaje:
            estado.status === 'NOT_YET_OPENED'
              ? 'El formulario de finAPI todavía no se abrió. Abrilo en la pestaña nueva, ' +
                'completalo y volvé a pulsar acá.'
              : 'El formulario está a medias. Terminalo en la pestaña de finAPI y volvé a ' +
                'pulsar acá.',
          cuentas: [],
        }
      }

      if (estado.status !== 'COMPLETED' && estado.payload.bankConnectionId === null) {
        return {
          estado: 'fallo' as const,
          status: estado.status,
          mensaje:
            `finAPI terminó el formulario como ${estado.status} y no creó ninguna conexión ` +
            `bancaria. ${mensajeDeError(estado.payload.errorCode, estado.payload.errorMessage) ?? ''}`.trim(),
          cuentas: [],
        }
      }
    }

    // Todas las conexiones del hogar, no sólo la recién completada: las cuentas
    // de finAPI llegan mezcladas y hay que saber de qué banco es cada una.
    const conexiones = await listConnections(client, PROVEEDOR)
    const cuentas = await prepararCuentas(client, token, conexiones)

    if (cuentas.length === 0) {
      return {
        estado: 'fallo' as const,
        status: conexion?.status ?? null,
        mensaje:
          'finAPI no devuelve ninguna cuenta para este hogar. Si acabás de completar el ' +
          'formulario, la descarga puede seguir en curso del lado de ellos: esperá unos segundos ' +
          'y volvé a pulsar.',
        cuentas: [],
      }
    }

    return { estado: 'listo' as const, status: conexion?.status ?? null, mensaje: null, cuentas }
  })
}

function mensajeDeError(codigo: string | null, mensaje: string | null): string | null {
  if (codigo === null && mensaje === null) return null
  return [mensaje, codigo === null ? null : `[${codigo}]`].filter((p) => p !== null).join(' ')
}

/* ── Sincronizar una cuenta ───────────────────────────────────────────────── */

async function sincronizar(externalAccountId: string): Promise<ResultadoDeCuenta> {
  return writeHousehold(async (client) => {
    const token = await tokenDelHogar(client)
    if (token === null) {
      throw new SincronizacionError('Este hogar todavía no tiene usuario en finAPI.')
    }
    return sincronizarCuenta(client, { token, externalAccountId })
  })
}

/* ── Fallos ───────────────────────────────────────────────────────────────── */

/**
 * Los errores de este camino son explicativos por diseño: dicen qué se estaba
 * intentando y qué contestó finAPI, aunque sea en alemán. Se devuelven tal cual
 * en vez de un "error interno" que obliga a mirar los logs del servidor.
 */
function fallo(error: unknown): NextResponse {
  if (error instanceof FinapiError) {
    return NextResponse.json({ error: error.message }, { status: 502 })
  }
  if (error instanceof SincronizacionError) {
    return NextResponse.json({ error: error.message }, { status: 409 })
  }
  if (error instanceof Error && error.name === 'ImportPersistError') {
    return NextResponse.json({ error: error.message }, { status: 409 })
  }
  if (error instanceof Error && error.name === 'ParseError') {
    return NextResponse.json({ error: error.message }, { status: 422 })
  }
  if (esHuellaRepetida(error)) {
    return NextResponse.json(
      {
        error:
          'Algunos movimientos de esta cuenta ya están en el libro con la misma huella y otro ' +
          'identificador. No se guardó nada. Suele significar que los mismos movimientos entraron ' +
          'antes por fichero: deshacé aquel lote si querés que los traiga el banco.',
      },
      { status: 409 },
    )
  }
  const message =
    error instanceof Error ? error.message : 'Error desconocido al sincronizar con finAPI.'
  return NextResponse.json({ error: message }, { status: 500 })
}

/** 23505 es unique_violation. El índice de huellas es el que puede saltar acá. */
function esHuellaRepetida(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  )
}
