/**
 * Lector de CSV según RFC 4180, con las tolerancias que exige la realidad.
 *
 * Se escribe a mano en vez de traer una dependencia porque son sesenta líneas
 * y porque mantiene la propiedad que define al paquete: los parsers son
 * funciones puras sobre bytes, sin I/O y sin sorpresas de configuración.
 *
 * Lo que hay que soportar sí o sí, porque aparece en extractos reales:
 * comillas alrededor de campos que contienen el separador, comillas dobladas
 * para escapar una comilla, y saltos de línea **dentro** de un campo entre
 * comillas — un concepto bancario de dos renglones es habitual.
 */

export interface CsvRow {
  /** Fila en el fichero, 1-indexada, contando los saltos dentro de comillas. */
  readonly lineNumber: number
  readonly cells: string[]
}

/** Separadores candidatos, en orden de frecuencia en extractos bancarios. */
export const CANDIDATE_DELIMITERS = [';', ',', '\t', '|'] as const
export type Delimiter = (typeof CANDIDATE_DELIMITERS)[number]

/**
 * Detecta el separador por consistencia, no por frecuencia.
 *
 * Contar apariciones falla con el formato europeo: un fichero separado por
 * punto y coma con importes como "1.234,56" tiene más comas que puntos y
 * comas. Lo que sí distingue al separador real es que produce el **mismo
 * número de columnas en todas las filas**.
 */
export function detectDelimiter(text: string): Delimiter {
  const sample = text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .slice(0, 30)
  if (sample.length === 0) return ','

  let best: { delimiter: Delimiter; columns: number; consistency: number } | null = null

  for (const delimiter of CANDIDATE_DELIMITERS) {
    const counts = sample.map((line) => tokenizeLine(line, delimiter).length)
    const frequency = new Map<number, number>()
    for (const count of counts) frequency.set(count, (frequency.get(count) ?? 0) + 1)

    let dominant = 0
    let dominantCount = 0
    for (const [columns, times] of frequency) {
      if (times > dominantCount || (times === dominantCount && columns > dominant)) {
        dominant = columns
        dominantCount = times
      }
    }

    if (dominant < 2) continue
    const consistency = dominantCount / counts.length

    const better =
      best === null ||
      consistency > best.consistency + 0.001 ||
      (Math.abs(consistency - best.consistency) <= 0.001 && dominant > best.columns)

    if (better) best = { delimiter, columns: dominant, consistency }
  }

  return best?.delimiter ?? ','
}

/** Divide una única línea, sin manejar saltos dentro de comillas. Sólo para detectar. */
function tokenizeLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"'
          index += 1
        } else quoted = false
      } else current += char
    } else if (char === '"') quoted = true
    else if (char === delimiter) {
      cells.push(current)
      current = ''
    } else current += char
  }
  cells.push(current)
  return cells
}

/** Lectura completa, con saltos de línea dentro de campos entre comillas. */
export function tokenizeCsv(text: string, delimiter: string): CsvRow[] {
  const rows: CsvRow[] = []
  let cells: string[] = []
  let current = ''
  let quoted = false
  let lineNumber = 1
  let rowStart = 1
  let started = false

  const pushCell = (): void => {
    cells.push(current.trim())
    current = ''
  }
  const pushRow = (): void => {
    pushCell()
    if (cells.some((cell) => cell !== '')) rows.push({ lineNumber: rowStart, cells })
    cells = []
    started = false
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (!started) {
      rowStart = lineNumber
      started = true
    }

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          current += '"'
          index += 1
        } else quoted = false
      } else {
        if (char === '\n') lineNumber += 1
        current += char
      }
      continue
    }

    if (char === '"') {
      quoted = true
    } else if (char === delimiter) {
      pushCell()
    } else if (char === '\r') {
      // Se ignora: el \n que sigue cierra la fila.
    } else if (char === '\n') {
      lineNumber += 1
      pushRow()
    } else {
      current += char
    }
  }

  if (started || current !== '' || cells.length > 0) pushRow()
  return rows
}
