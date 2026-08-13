/**
 * Importación con sesión: el mismo motor que /api/import, pero que guarda.
 *
 * La diferencia con la ruta anónima no es un parámetro: es una promesa
 * distinta. Allá se lee el fichero y se devuelve el informe; acá el lote entra
 * al libro, con sus asientos balanceados, sus saldos declarados y su cola de
 * revisión, y queda un identificador con el que deshacerlo entero.
 *
 * Por eso es una ruta aparte y no una bandera de la otra. Una bandera
 * `?guardar=1` en un endpoint público significa que la única cosa que separa
 * "mirar" de "escribir en la base de alguien" es que nadie se equivoque al
 * construir la URL.
 *
 * Todo el trabajo ocurre dentro de una sola transacción: se lee contra qué
 * deduplicar y se escribe el lote sin soltar el hogar en el medio. Si se
 * hicieran en dos, dos importaciones simultáneas del mismo extracto se
 * clasificarían las dos contra el libro de antes y la segunda rebotaría contra
 * el índice único a mitad de camino.
 */

import { accountBalances, persistImport, type TenantClient } from '@moneypilot/db'
import { NextResponse } from 'next/server'
import { writeHousehold } from '@/lib/data'
import {
  conNombreDeCuenta,
  contentHash,
  existingForAccount,
  toPersistInput,
} from '@/lib/importacion'
import { navItem } from '@/lib/nav'
import { PipelineError, runPipeline, toWireReport, type WireReport } from '@/lib/pipeline'
import { resolveSession } from '@/lib/session'

export const runtime = 'nodejs'
export const maxDuration = 60

/** El mismo tope que la ruta anónima: una migración histórica va por el CLI. */
const MAX_BYTES = 4 * 1024 * 1024

/** Sólo se importa contra cuentas de banco, tarjeta o efectivo, y abiertas. */
const IMPORTABLES = new Set(['asset', 'liability'])

export interface CuentaElegible {
  readonly id: string
  readonly name: string
  readonly currency: string
  readonly institution: string | null
}

interface Salida {
  readonly report: WireReport
  readonly batchId: string
  /** false cuando el fichero ya estaba cargado y no se escribió nada nuevo. */
  readonly guardado: boolean
  readonly imported: number
  readonly duplicates: number
  readonly needsReview: number
  readonly cuenta: CuentaElegible
  readonly review: { lineNumber: number; bookedOn: string; description: string }[]
  readonly transfers: { from: string; to: string; on: string; confidence: string }[]
}

export async function POST(request: Request): Promise<NextResponse> {
  const state = await resolveSession()
  if (state.kind === 'anonymous') {
    return NextResponse.json(
      { error: 'Tenés que entrar para importar. En /probar podés leer un extracto sin guardarlo.' },
      { status: 401 },
    )
  }
  if (state.kind === 'expired') {
    return NextResponse.json(
      { error: 'Tu acceso a este hogar caducó, así que no se puede escribir en él.' },
      { status: 403 },
    )
  }

  // El rol sale del mismo sitio que el menú: si mañana el contador deja de
  // poder importar, se cambia en lib/nav.ts y esta comprobación lo sigue.
  const permitidos = navItem('/importar')?.roles
  if (permitidos !== undefined && !permitidos.includes(state.session.role)) {
    return NextResponse.json(
      { error: `Tu rol en este hogar (${state.session.role}) no puede importar extractos.` },
      { status: 403 },
    )
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'No se pudo leer el formulario.' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Falta el fichero.' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'El fichero está vacío.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error:
          `El fichero pesa ${(file.size / 1024 / 1024).toFixed(1)} MB y el límite acá es 4 MB. ` +
          'Para una migración histórica completa usá el CLI, que corre sin límite.',
      },
      { status: 413 },
    )
  }

  const cuentaPedida = readString(form, 'cuenta')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const fileName = file.name === '' ? 'extracto' : file.name

  try {
    const resultado = await writeHousehold(async (client) => {
      const cuentas = (await accountBalances(client))
        .filter((cuenta) => IMPORTABLES.has(cuenta.kind) && cuenta.closedAt === null)
        .map(
          (cuenta): CuentaElegible => ({
            id: cuenta.id,
            name: cuenta.name,
            currency: cuenta.currency,
            institution: cuenta.institution,
          }),
        )

      if (cuentas.length === 0) return { kind: 'sin-cuentas' } as const

      const cuenta = cuentas.find((candidata) => candidata.id === cuentaPedida)
      if (cuenta === undefined) return { kind: 'sin-cuenta-valida', cuentas } as const

      return await importar(client, { bytes, fileName, cuenta })
    })

    return responder(resultado)
  } catch (error) {
    return fallo(error)
  }
}

type Resultado =
  | { readonly kind: 'sin-cuentas' }
  | { readonly kind: 'sin-cuenta-valida'; readonly cuentas: readonly CuentaElegible[] }
  | { readonly kind: 'vacio'; readonly report: WireReport }
  | { readonly kind: 'varias-cuentas'; readonly cuantas: number }
  | { readonly kind: 'ok'; readonly salida: Salida }

async function importar(
  client: TenantClient,
  args: { bytes: Uint8Array; fileName: string; cuenta: CuentaElegible },
): Promise<Resultado> {
  const opciones = {
    fileName: args.fileName,
    // La moneda la manda la cuenta, no un desplegable: importar un extracto en
    // dólares contra una cuenta en euros no es una preferencia, es un error, y
    // `persistImport` lo va a rechazar con ese mismo argumento.
    currency: args.cuenta.currency,
    // Ver la cabecera de persist.ts: el uuid es lo único estable para la huella.
    accountLabel: args.cuenta.id,
  }

  // Primera pasada sin histórico, sólo para saber qué período cubre el fichero.
  // Cuesta un parseo de más y evita traerse a memoria el histórico entero de la
  // cuenta para deduplicar contra movimientos de hace tres años que no pueden
  // ser candidatos de nada.
  const sonda = runPipeline(args.bytes, opciones)

  if (sonda.report.linesRead === 0) {
    // No se guarda un lote vacío: el hash del contenido quedaría ocupado y el
    // día que el fichero se pueda leer bien, reimportarlo no haría nada.
    return { kind: 'vacio', report: toWireReport(sonda.report) }
  }
  if (sonda.statements.length > 1) {
    return { kind: 'varias-cuentas', cuantas: sonda.statements.length }
  }

  const desde = sonda.report.periodFrom
  const hasta = sonda.report.periodTo
  const existing =
    desde === null || hasta === null
      ? []
      : await existingForAccount(client, args.cuenta.id, { from: desde, to: hasta })

  // Sin nada contra qué comparar, la segunda pasada daría exactamente lo mismo.
  const result = existing.length === 0 ? sonda : runPipeline(args.bytes, { ...opciones, existing })

  const report = conNombreDeCuenta(toWireReport(result.report), args.cuenta.id, args.cuenta.name)

  const guardado = await persistImport(
    client,
    toPersistInput({
      result,
      accountId: args.cuenta.id,
      fileName: args.fileName,
      contentSha256: contentHash(args.bytes),
      report,
    }),
  )

  return {
    kind: 'ok',
    salida: {
      report,
      batchId: guardado.batchId,
      guardado: !guardado.skippedByContentHash,
      imported: guardado.imported,
      duplicates: guardado.duplicates,
      needsReview: guardado.needsReview,
      cuenta: args.cuenta,
      review: result.classified
        .filter((item) => item.verdict.kind === 'review')
        .map((item) => ({
          lineNumber: item.incoming.lineNumber,
          bookedOn: item.incoming.bookedOn,
          description: item.incoming.description,
        })),
      transfers: result.transfers.map((pair) => ({
        from: pair.outgoing.accountId,
        to: pair.incoming.accountId,
        on: pair.outgoing.bookedOn,
        confidence: pair.confidence,
      })),
    },
  }
}

function responder(resultado: Resultado): NextResponse {
  switch (resultado.kind) {
    case 'sin-cuentas':
      return NextResponse.json(
        {
          error:
            'Todavía no tenés ninguna cuenta abierta donde guardar esto. Un extracto se importa ' +
            'contra una cuenta concreta, y no vamos a inventarte una: creála primero en Cuentas.',
          code: 'sin-cuentas',
        },
        { status: 409 },
      )
    case 'sin-cuenta-valida':
      return NextResponse.json(
        {
          error: 'Elegí contra qué cuenta se importa antes de subir el fichero.',
          code: 'sin-cuenta-valida',
          cuentas: resultado.cuentas,
        },
        { status: 400 },
      )
    case 'vacio':
      return NextResponse.json(
        {
          error:
            'El fichero se reconoció pero no contenía ninguna transacción legible, así que no se ' +
            'guardó nada. Puede ser un subtipo no soportado o un fichero vacío.',
          code: 'vacio',
          report: resultado.report,
        },
        { status: 422 },
      )
    case 'varias-cuentas':
      return NextResponse.json(
        {
          error:
            `El fichero trae ${resultado.cuantas} cuentas y acá se importa contra una sola. ` +
            'Separalo por cuenta y subí cada extracto contra la suya: meterlas todas en la que ' +
            'elegiste daría un saldo que no es el de ninguna.',
          code: 'varias-cuentas',
        },
        { status: 422 },
      )
    default:
      return NextResponse.json(resultado.salida)
  }
}

/**
 * Los errores del pipeline y de la persistencia son explicativos por diseño:
 * dicen qué pasó y qué hacer. Se devuelven tal cual en vez de un "error
 * interno" que obliga a mirar los logs del servidor.
 */
function fallo(error: unknown): NextResponse {
  if (error instanceof PipelineError) {
    return NextResponse.json({ error: error.message }, { status: 422 })
  }
  if (error instanceof Error && error.name === 'ImportPersistError') {
    return NextResponse.json({ error: error.message }, { status: 409 })
  }
  if (esHuellaRepetida(error)) {
    return NextResponse.json(
      {
        error:
          'Algunos movimientos de este extracto ya están en el libro con la misma huella. No se ' +
          'guardó nada. Si el extracto anterior era el bueno, no hace falta reimportar; si no, ' +
          'deshacé aquel lote y volvé a subir éste.',
      },
      { status: 409 },
    )
  }
  const message =
    error instanceof Error ? error.message : 'Error desconocido al importar el extracto.'
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

function readString(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}
