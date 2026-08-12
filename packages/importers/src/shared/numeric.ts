/**
 * Parseo de importes desde texto de banco a la forma canónica del núcleo.
 *
 * El problema real: "1.234" vale mil doscientos treinta y cuatro en España y
 * uno coma doscientos treinta y cuatro en Estados Unidos. Adivinar mal no da
 * un error, da un importe mil veces distinto. Por eso esta función devuelve
 * también si la interpretación fue ambigua, y el importador lo registra como
 * aviso en vez de tragárselo.
 */

export interface ParsedAmount {
  /** Forma canónica que acepta `fromDecimalString`: signo, dígitos, punto. */
  readonly canonical: string
  /** true si hubo que elegir entre dos lecturas posibles. */
  readonly ambiguous: boolean
  readonly note?: string
}

/** Todo lo que no sea dígito, separador o signo: símbolos, letras, espacios duros. */
const NOISE = /[^\d.,+-]/g

export interface ParseAmountOptions {
  /**
   * Decimales que admite la moneda. Se usa para desempatar "1.234": con
   * exponente 2, tres dígitos detrás del separador sólo pueden ser miles.
   */
  readonly exponent?: number
  /** Fuerza la interpretación cuando el formato del fichero ya se conoce. */
  readonly decimalSeparator?: '.' | ','
}

export function parseAmount(raw: string, options: ParseAmountOptions = {}): ParsedAmount | null {
  const exponent = options.exponent ?? 2
  let text = raw.trim()
  if (text === '') return null

  // Contabilidad clásica: los negativos entre paréntesis.
  let negative = false
  if (/^\(.*\)$/.test(text)) {
    negative = true
    text = text.slice(1, -1)
  }

  // Signo al final, típico de exports de bancos alemanes y de MT940.
  if (/[-+]$/.test(text)) {
    if (text.endsWith('-')) negative = !negative
    text = text.slice(0, -1)
  }

  const cleaned = text.replace(NOISE, '')
  if (cleaned === '') return null

  const body = cleaned.replace(/^[+-]/, '')
  if (cleaned.startsWith('-')) negative = !negative
  if (!/^[\d.,]+$/.test(body) || !/\d/.test(body)) return null

  const decision = splitIntegerAndFraction(body, exponent, options.decimalSeparator)
  if (decision === null) return null

  const { integer, fraction, ambiguous, note } = decision
  const digits = integer.replace(/^0+(?=\d)/, '')
  const canonical =
    (negative && /[1-9]/.test(digits + fraction) ? '-' : '') +
    (digits === '' ? '0' : digits) +
    (fraction === '' ? '' : `.${fraction}`)

  return { canonical, ambiguous, ...(note === undefined ? {} : { note }) }
}

interface SplitResult {
  readonly integer: string
  readonly fraction: string
  readonly ambiguous: boolean
  readonly note?: string
}

function splitIntegerAndFraction(
  body: string,
  exponent: number,
  forced: '.' | ',' | undefined,
): SplitResult | null {
  const lastDot = body.lastIndexOf('.')
  const lastComma = body.lastIndexOf(',')

  if (forced !== undefined) {
    const at = forced === '.' ? lastDot : lastComma
    if (at === -1) return { integer: stripSeparators(body), fraction: '', ambiguous: false }
    return {
      integer: stripSeparators(body.slice(0, at)),
      fraction: stripSeparators(body.slice(at + 1)),
      ambiguous: false,
    }
  }

  // Los dos separadores presentes: el último es el decimal, sin ambigüedad.
  if (lastDot !== -1 && lastComma !== -1) {
    const at = Math.max(lastDot, lastComma)
    return {
      integer: stripSeparators(body.slice(0, at)),
      fraction: stripSeparators(body.slice(at + 1)),
      ambiguous: false,
    }
  }

  const at = lastDot !== -1 ? lastDot : lastComma
  if (at === -1) return { integer: body, fraction: '', ambiguous: false }

  const separator = body[at] ?? '.'
  const occurrences = body.split(separator).length - 1
  const tail = body.slice(at + 1)

  // Aparece más de una vez: sólo puede ser separador de miles.
  if (occurrences > 1) {
    return { integer: stripSeparators(body), fraction: '', ambiguous: false }
  }

  if (tail.length === exponent) {
    return { integer: body.slice(0, at), fraction: tail, ambiguous: false }
  }

  if (tail.length === 3 && exponent !== 3) {
    // "1.234" con moneda de dos decimales: son miles. La lectura alternativa
    // convertiría 1234 en 1,23 — un error de tres órdenes de magnitud, así
    // que se elige la segura y se avisa.
    return {
      integer: body.slice(0, at) + tail,
      fraction: '',
      ambiguous: true,
      note: `"${body}" se interpretó como separador de miles`,
    }
  }

  if (tail.length > exponent) return null

  return {
    integer: body.slice(0, at),
    fraction: tail.padEnd(exponent, '0'),
    ambiguous: false,
  }
}

function stripSeparators(value: string): string {
  return value.replace(/[.,]/g, '')
}
