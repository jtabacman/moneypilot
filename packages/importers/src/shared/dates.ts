/**
 * Resolución del orden de fecha en formatos ambiguos.
 *
 * `03/04/2026` es el 3 de abril en España y el 4 de marzo en Estados Unidos.
 * Ni QIF ni la mayoría de los CSV declaran cuál usan, y elegir mal no produce
 * un error: produce transacciones en el mes equivocado, lo que corre los
 * cortes de período y descuadra el cierre.
 *
 * La regla: **escanear el fichero entero antes de parsear ninguna fila.** Un
 * solo día mayor que 12 en cualquier parte del fichero desambigua todas las
 * demás. Sólo cuando el fichero completo es ambiguo hay que preguntar, y
 * entonces se pregunta — no se adivina en silencio.
 */

import { type PlainDate, tryParsePlainDate } from '@moneypilot/core'

export type DateOrder = 'DMY' | 'MDY' | 'YMD'

export interface DateOrderDetection {
  readonly order: DateOrder
  /** true si el fichero entero era compatible con más de un orden. */
  readonly ambiguous: boolean
  /** Qué evidencia resolvió la ambigüedad, para poder explicarlo. */
  readonly evidence: string
}

const SEPARATED = /^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{2,4})$/

/**
 * Quicken escribe los años 2000 con apóstrofo: `12/31'05` es 2005, y
 * `12/31/99` es 1999. Además rellena con espacios: `1/ 3'98`.
 */
function normalizeQuickenYear(raw: string): string {
  return raw.replace(/\s+/g, '').replace(/'(\d{2})$/, '/20$1')
}

interface Triple {
  readonly a: number
  readonly b: number
  readonly c: number
}

function split(raw: string): Triple | null {
  const match = SEPARATED.exec(normalizeQuickenYear(raw.trim()))
  if (!match) return null
  const [, a = '', b = '', c = ''] = match
  return { a: Number(a), b: Number(b), c: Number(c) }
}

/**
 * Determina el orden mirando todas las fechas del fichero a la vez.
 *
 * Si alguna tiene el primer componente mayor que 12, ese componente es el día
 * y el orden es DMY. Si alguna tiene el segundo mayor que 12, es MDY. Que
 * ambas cosas pasen en el mismo fichero significa que el fichero está roto, y
 * eso también hay que decirlo en vez de elegir una.
 */
export function detectDateOrder(samples: readonly string[]): DateOrderDetection {
  let firstOverTwelve = 0
  let secondOverTwelve = 0
  let fourDigitFirst = 0
  let parsed = 0

  for (const sample of samples) {
    const triple = split(sample)
    if (triple === null) continue
    parsed += 1
    if (triple.a > 31) fourDigitFirst += 1
    else if (triple.a > 12) firstOverTwelve += 1
    if (triple.b > 12) secondOverTwelve += 1
  }

  if (parsed === 0) {
    return {
      order: 'MDY',
      ambiguous: true,
      evidence: 'no se pudo leer ninguna fecha',
    }
  }

  if (fourDigitFirst > 0) {
    return {
      order: 'YMD',
      ambiguous: false,
      evidence: `${fourDigitFirst} fecha(s) empiezan por un año de cuatro dígitos`,
    }
  }

  if (firstOverTwelve > 0 && secondOverTwelve > 0) {
    return {
      order: 'DMY',
      ambiguous: true,
      evidence:
        `el fichero contiene ${firstOverTwelve} fecha(s) que sólo pueden ser DMY y ` +
        `${secondOverTwelve} que sólo pueden ser MDY: es inconsistente`,
    }
  }

  if (firstOverTwelve > 0) {
    return {
      order: 'DMY',
      ambiguous: false,
      evidence: `${firstOverTwelve} fecha(s) con día mayor que 12 en primera posición`,
    }
  }

  if (secondOverTwelve > 0) {
    return {
      order: 'MDY',
      ambiguous: false,
      evidence: `${secondOverTwelve} fecha(s) con día mayor que 12 en segunda posición`,
    }
  }

  return {
    order: 'MDY',
    ambiguous: true,
    evidence: `las ${parsed} fechas del fichero son válidas en ambos órdenes`,
  }
}

export interface ParseDateOptions {
  /** Corte para años de dos dígitos: por debajo es 2000, por encima 1900. */
  readonly centuryPivot?: number
}

export function parseDateWithOrder(
  raw: string,
  order: DateOrder,
  options: ParseDateOptions = {},
): PlainDate | null {
  const pivot = options.centuryPivot ?? 70
  const triple = split(raw)
  if (triple === null) return null

  const { a, b, c } = triple
  const [day, month, yearPart] =
    order === 'DMY' ? [a, b, c] : order === 'MDY' ? [b, a, c] : [c, b, a]

  const year = yearPart >= 100 ? yearPart : yearPart < pivot ? 2000 + yearPart : 1900 + yearPart

  return tryParsePlainDate(
    `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  )
}
