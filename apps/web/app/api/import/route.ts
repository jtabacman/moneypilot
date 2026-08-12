/**
 * Endpoint de importación.
 *
 * Es un route handler y no una server action a propósito: la API de consulta
 * es el contrato que después comparten la UI, los PDF programados, los enlaces
 * compartidos y las herramientas del asistente. Nace como superficie HTTP para
 * que mudarla a un contenedor sea cambiar la URL base, no reescribir.
 *
 * Corre en Node y no en Edge porque los parsers usan `node:crypto` para la
 * huella canónica y `TextDecoder` con encodings legacy.
 */

import { renderImportReport } from '@moneypilot/core'
import { NextResponse } from 'next/server'
import { runPipeline, toWireReport } from '../../../lib/pipeline'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Vercel limita el cuerpo de una petición serverless. Un extracto normal pesa
 * kilobytes, así que el tope sólo se toca con una migración histórica — y esa
 * va por el CLI, que corre en la máquina del operador sin límite.
 */
const MAX_BYTES = 4 * 1024 * 1024

export async function POST(request: Request): Promise<NextResponse> {
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

  const currency = readString(form, 'currency')
  const account = readString(form, 'account')
  const bytes = new Uint8Array(await file.arrayBuffer())

  try {
    const result = runPipeline(bytes, {
      fileName: file.name,
      ...(currency === undefined ? {} : { currency }),
      ...(account === undefined ? {} : { accountLabel: account }),
    })

    return NextResponse.json({
      report: toWireReport(result.report),
      text: renderImportReport(result.report),
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
    })
  } catch (error) {
    // Los errores del pipeline son explicativos por diseño: dicen qué pasó y
    // qué hacer. Se devuelven tal cual en vez de un "error interno".
    const message = error instanceof Error ? error.message : 'Error desconocido al importar.'
    return NextResponse.json({ error: message }, { status: 422 })
  }
}

function readString(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}
