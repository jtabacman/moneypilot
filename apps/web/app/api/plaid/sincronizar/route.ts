/**
 * Traer los movimientos de un item de Plaid y asentarlos.
 *
 * Es una ruta y no una server action por el tiempo: sondear un item recién
 * conectado son varias vueltas con espera entre medias —ver `leerDelItem`— más
 * la deduplicación contra el libro y la escritura de los asientos, y eso
 * necesita un `maxDuration` propio que una acción colgada de una página no
 * puede declarar.
 *
 * ── Tres pasos, y el orden es el diseño ──────────────────────────────────────
 *
 *  1. Leer la credencial del item. Transacción corta.
 *  2. Sondear a Plaid hasta tener todo lo que tenga que contar. **Sin ninguna
 *     transacción abierta**: es la parte lenta, y retener una conexión del pool
 *     mientras un tercero contesta es cómo se agota un pool.
 *  3. Asentarlo todo y guardar el cursor, en UNA transacción.
 *
 * El paso 3 es el que importa. A diferencia de finAPI, acá la unidad de trabajo
 * no puede ser una cuenta: el cursor de `/transactions/sync` es del item entero
 * y avanzarlo después de escribir una sola cuenta perdería, para siempre, los
 * movimientos que esa misma lectura traía para las otras. Así que o entran
 * todas las cuentas y el cursor, o no entra nada — y si la petición se corta a
 * la mitad no queda medio lote escrito: queda cero, y la próxima llamada
 * empieza desde el mismo cursor.
 */

import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { readHousehold, today, writeHousehold } from '@/lib/data'
import { SincronizacionError } from '@/lib/feed/errores'
import { navItem } from '@/lib/nav'
import { conexionConToken } from '@/lib/plaid/conexion'
import { necesitaReautenticacion, PlaidError } from '@/lib/plaid/errores'
import { paisDeLaEntidad } from '@/lib/plaid/pais'
import { asentarLectura, leerDelItem, type ResultadoDelItem } from '@/lib/plaid/sincronizar'
import { resolveSession } from '@/lib/session'

export const runtime = 'nodejs'

/**
 * Cinco minutos. Lo normal son segundos; el techo está alto para que la carga
 * inicial de un item con doce cuentas quepa entera, porque cortarla no deja
 * nada escrito y habría que volver a empezar.
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

  const conexionId = leerConexion(cuerpo)
  if (conexionId === null) {
    return NextResponse.json({ error: 'Falta decir qué conexión sincronizar.' }, { status: 400 })
  }

  try {
    const resultado = await sincronizar(conexionId)
    // Los saldos, los tableros y la cola de revisión acaban de cambiar en todas
    // las pantallas, no sólo en ésta.
    revalidatePath('/', 'layout')
    return NextResponse.json(resultado)
  } catch (error) {
    return fallo(error)
  }
}

function leerConexion(cuerpo: unknown): string | null {
  if (typeof cuerpo !== 'object' || cuerpo === null) return null
  const conexion = (cuerpo as Record<string, unknown>)['conexion']
  if (typeof conexion !== 'string' || conexion.trim() === '') return null
  return conexion.trim()
}

async function sincronizar(conexionId: string): Promise<ResultadoDelItem> {
  // Paso 1: la credencial, y nada más. `conexionConToken` comprueba de paso que
  // la conexión sea de Plaid y de este hogar.
  const { accessToken, conexion } = (
    await readHousehold((client) => conexionConToken(client, conexionId))
  ).data

  // Paso 2: la red, sin transacción abierta. Acá entra también la ficha de la
  // institución, por el mismo motivo: es una llamada HTTP y no puede ocurrir
  // con la transacción del paso 3 abierta.
  const lectura = await leerDelItem(accessToken, conexion.syncCursor)
  const pais = await paisDeLaEntidad(conexion.bankId)

  // Paso 3: todo el libro, en una transacción.
  return writeHousehold((client) =>
    asentarLectura(client, {
      connectionId: conexionId,
      lectura,
      // El día en que preguntamos, que es lo que fecha el saldo declarado. Lo
      // pone acá quien llama porque el mapeador no mira el reloj: si lo mirara,
      // dos ejecuciones del mismo lote darían informes distintos.
      balanceAsOf: today(),
      paisDeLaEntidad: pais,
      // El instante en que se preguntó. `today()` fecha el saldo declarado con
      // grano de día porque eso es lo que admite el informe; esto lo fecha con
      // hora, que es lo que distingue dos lecturas del mismo día.
      observadoEn: new Date().toISOString(),
    }),
  )
}

/**
 * Los errores de este camino son explicativos por diseño: dicen qué se estaba
 * intentando y qué contestó Plaid, con su `error_code` detrás. Se devuelven tal
 * cual en vez de un "error interno" que obliga a mirar los logs del servidor.
 */
function fallo(error: unknown): NextResponse {
  if (necesitaReautenticacion(error)) {
    return NextResponse.json(
      {
        error:
          'La conexión con el banco caducó y Plaid pide volver a autenticarse (ITEM_LOGIN_REQUIRED). ' +
          'Hasta que eso pase no va a entrar un solo movimiento nuevo, y el libro se va a ir ' +
          'alejando del banco sin dar ningún error. Hay que reconectar el banco.',
      },
      { status: 409 },
    )
  }
  if (error instanceof PlaidError) {
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
          'Algunos movimientos de esta conexión ya están en el libro con la misma huella y otro ' +
          'identificador. No se guardó nada. Suele significar que los mismos movimientos entraron ' +
          'antes por fichero: deshacé aquel lote si querés que los traiga el banco.',
      },
      { status: 409 },
    )
  }
  const message =
    error instanceof Error ? error.message : 'Error desconocido al sincronizar con Plaid.'
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
