/**
 * Parser de CSV bancario con detección de esquema.
 *
 * Es el formato más universal —todo banco exporta uno— y el que menos se
 * parece a sí mismo entre bancos. No hay especificación: hay que inferir el
 * separador, dónde empieza la tabla, qué columna es cada cosa, cómo se
 * expresa el signo y en qué orden va la fecha.
 *
 * La regla que gobierna el módulo: **inferir sí, adivinar en silencio no.**
 * `inspectCsv` devuelve el esquema detectado con su nivel de confianza para
 * que una persona lo confirme antes de importar. El coste de equivocarse acá
 * no es un error visible: es una columna de saldo interpretada como importe,
 * o todos los gastos con el signo invertido.
 */

import {
  type CurrencyCode,
  currencyCode,
  fromDecimalString,
  type Money,
  type ParsedStatement,
  type ParseWarning,
  type StatementLine,
} from '@moneypilot/core'
import { type DateOrder, detectDateOrder, parseDateWithOrder } from '../shared/dates.js'
import { decodeBuffer } from '../shared/decode.js'
import { parseAmount } from '../shared/numeric.js'
import { type CsvRow, type Delimiter, detectDelimiter, tokenizeCsv } from './tokenize.js'

// ── Vocabulario de cabeceras ────────────────────────────────────────────────
// Español e inglés. El orden importa: se prueba de más específico a menos,
// porque "fecha valor" también contiene "fecha".

const HEADERS = {
  valueDate: ['fecha valor', 'f. valor', 'fecha de valor', 'value date', 'valuta'],
  date: [
    'fecha operacion',
    'fecha de operacion',
    'f. operacion',
    'fecha contable',
    'fecha',
    'date',
    'transaction date',
    'posted date',
    'posted',
    'data',
  ],
  description: [
    'concepto',
    'descripcion',
    'description',
    'detalle',
    'referencia',
    'payee',
    'merchant',
    'memo',
    'narrative',
    'beneficiario',
    'observaciones',
    'name',
  ],
  debit: [
    'debe',
    'cargo',
    'cargos',
    'debit',
    'salida',
    'pagos',
    'withdrawal',
    'gasto',
    'importe debe',
  ],
  credit: ['haber', 'abono', 'abonos', 'credit', 'entrada', 'ingreso', 'deposit', 'importe haber'],
  amount: ['importe', 'amount', 'cantidad', 'monto', 'valor', 'movimiento'],
  balance: ['saldo', 'balance', 'saldo posterior', 'running balance'],
  currency: ['divisa', 'moneda', 'currency'],
  sign: ['d/h', 'debe/haber', 'tipo', 'signo', 'dc', 'indicador'],
} as const

type Field = keyof typeof HEADERS

export interface ColumnMapping {
  readonly date?: number
  readonly valueDate?: number
  readonly description: number[]
  readonly amount?: number
  readonly debit?: number
  readonly credit?: number
  readonly balance?: number
  readonly currency?: number
  readonly sign?: number
}

export type AmountLayout = 'signed' | 'debit_credit' | 'sign_column' | 'unknown'

export interface CsvInspection {
  readonly delimiter: Delimiter
  /**
   * Posición de la cabecera **entre las filas no vacías**, 0-based. Es el
   * índice interno que usa el parser, no lo que un humano cuenta al abrir el
   * fichero: para eso está `headerLine`.
   */
  readonly headerRow: number | null
  /** Número de línea de la cabecera en el fichero original, 1-based. */
  readonly headerLine: number | null
  readonly headers: string[]
  readonly mapping: ColumnMapping
  readonly layout: AmountLayout
  readonly dateOrder: DateOrder
  readonly dateAmbiguous: boolean
  readonly dateEvidence: string
  readonly decimalSeparator: '.' | ','
  readonly dataRows: number
  /** 0..1. Por debajo de 0,8 conviene que alguien confirme el mapeo. */
  readonly confidence: number
  readonly notes: string[]
}

export interface CsvParseOptions {
  readonly currency: string
  readonly delimiter?: Delimiter
  readonly dateOrder?: DateOrder
  readonly decimalSeparator?: '.' | ','
  /** Sobrescribe el mapeo detectado. Lo usa la UI cuando el humano corrige. */
  readonly mapping?: Partial<ColumnMapping>
  /** Invierte el signo. Necesario en exports de tarjeta donde el cargo es positivo. */
  readonly invertSign?: boolean
}

// ── Inspección ──────────────────────────────────────────────────────────────

export function inspectCsv(bytes: Uint8Array, options?: Partial<CsvParseOptions>): CsvInspection {
  const { text } = decodeBuffer(bytes)
  const delimiter = options?.delimiter ?? detectDelimiter(text)
  const rows = tokenizeCsv(text, delimiter)
  const notes: string[] = []

  const headerRow = findHeaderRow(rows)
  const headers = headerRow === null ? [] : (rows[headerRow]?.cells ?? [])
  const dataRows = rows.slice(headerRow === null ? 0 : headerRow + 1)

  // El mapeo manual se aplica SIEMPRE, haya cabecera o no. Antes sólo se
  // aplicaba en la rama con cabecera, y era justo al revés de lo útil: el
  // fichero sin cabecera es donde más falta hace poder corregir a mano.
  const detected =
    headerRow === null ? inferMappingFromData(dataRows, notes) : mapFromHeaders(headers)
  const mapping: ColumnMapping = {
    ...detected,
    ...stripUndefined(options?.mapping ?? {}),
  }

  const layout: AmountLayout =
    mapping.debit !== undefined || mapping.credit !== undefined
      ? 'debit_credit'
      : mapping.sign !== undefined
        ? 'sign_column'
        : mapping.amount !== undefined
          ? 'signed'
          : 'unknown'

  const dateColumn = mapping.date
  const dateSamples =
    dateColumn === undefined ? [] : dataRows.map((row) => row.cells[dateColumn] ?? '')
  const detection = detectDateOrder(dateSamples)

  const amountColumns = [mapping.amount, mapping.debit, mapping.credit].filter(
    (value): value is number => value !== undefined,
  )
  const decimalSeparator =
    options?.decimalSeparator ?? detectDecimalSeparator(dataRows, amountColumns)

  let confidence = 1
  if (headerRow === null) {
    confidence -= 0.4
    notes.push('No se encontró fila de cabecera')
  }
  if (mapping.date === undefined) {
    confidence -= 0.4
    notes.push('No se identificó columna de fecha')
  }
  if (layout === 'unknown') {
    confidence -= 0.4
    notes.push('No se identificó columna de importe')
  }
  if (mapping.description.length === 0) {
    confidence -= 0.2
    notes.push('No se identificó columna de concepto')
  }
  if (detection.ambiguous) {
    confidence -= 0.2
    notes.push(`Orden de fecha ambiguo: ${detection.evidence}`)
  }

  return {
    delimiter,
    headerRow,
    headerLine: headerRow === null ? null : (rows[headerRow]?.lineNumber ?? null),
    headers,
    mapping,
    layout,
    dateOrder: options?.dateOrder ?? detection.order,
    dateAmbiguous: detection.ambiguous,
    dateEvidence: detection.evidence,
    decimalSeparator,
    dataRows: dataRows.length,
    confidence: Math.max(0, Math.round(confidence * 100) / 100),
    notes,
  }
}

/**
 * La tabla no siempre empieza en la primera fila: muchos bancos ponen encima
 * el nombre del titular, el número de cuenta y el período. Se busca la fila
 * que más parece una cabecera y que además tiene filas de datos debajo.
 */
function findHeaderRow(rows: readonly CsvRow[]): number | null {
  let best: { index: number; score: number } | null = null

  for (let index = 0; index < Math.min(rows.length, 25); index += 1) {
    const cells = rows[index]?.cells ?? []
    if (cells.length < 2) continue

    let score = 0
    for (const cell of cells) {
      if (matchField(cell) !== null) score += 1
    }
    // Una cabecera no tiene celdas numéricas.
    const numeric = cells.filter((cell) => /^[\d.,\- ]+$/.test(cell) && /\d/.test(cell)).length
    score -= numeric

    if (score >= 2 && (best === null || score > best.score)) best = { index, score }
  }

  return best?.index ?? null
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function matchField(header: string): Field | null {
  const text = normalize(header)
  if (text === '') return null
  // De más específico a menos: "fecha valor" antes que "fecha".
  const order: Field[] = [
    'valueDate',
    'debit',
    'credit',
    'balance',
    'currency',
    'sign',
    'date',
    'amount',
    'description',
  ]
  for (const field of order) {
    for (const keyword of HEADERS[field]) {
      if (text === keyword) return field
      if (text.includes(keyword)) return field
    }
  }
  return null
}

function mapFromHeaders(headers: readonly string[]): ColumnMapping {
  const mapping: {
    date?: number
    valueDate?: number
    description: number[]
    amount?: number
    debit?: number
    credit?: number
    balance?: number
    currency?: number
    sign?: number
  } = { description: [] }

  for (const [index, header] of headers.entries()) {
    const field = matchField(header)
    if (field === null) continue
    if (field === 'description') mapping.description.push(index)
    else if (mapping[field] === undefined) mapping[field] = index
  }

  return mapping
}

/** Sin cabecera: se infiere por la forma del contenido. */
function inferMappingFromData(rows: readonly CsvRow[], notes: string[]): ColumnMapping {
  const sample = rows.slice(0, 20)
  if (sample.length === 0) return { description: [] }
  const columns = Math.max(...sample.map((row) => row.cells.length))

  let date: number | undefined
  let amount: number | undefined
  const description: number[] = []

  for (let column = 0; column < columns; column += 1) {
    const values = sample.map((row) => row.cells[column] ?? '').filter((value) => value !== '')
    if (values.length === 0) continue

    const looksLikeDate = values.filter((v) =>
      /^\s*\d{1,4}[/\-.]\d{1,2}[/\-.]\d{2,4}\s*$/.test(v),
    ).length
    const looksLikeAmount = values.filter((v) => parseAmount(v) !== null).length

    if (date === undefined && looksLikeDate / values.length > 0.8) date = column
    else if (amount === undefined && looksLikeAmount / values.length > 0.8) amount = column
    else description.push(column)
  }

  notes.push('Sin cabecera: el mapeo se infirió por la forma de los datos y hay que confirmarlo')
  return {
    description,
    ...(date === undefined ? {} : { date }),
    ...(amount === undefined ? {} : { amount }),
  }
}

/**
 * El separador decimal se decide para el fichero entero, no celda por celda.
 *
 * Una sola celda como "1.234" es indecidible, pero si en la misma columna hay
 * un "12,50" entonces la coma es el decimal y el punto es de miles en todo el
 * fichero. Decidir por columna completa elimina la ambigüedad que decidir por
 * celda deja abierta.
 */
function detectDecimalSeparator(rows: readonly CsvRow[], columns: readonly number[]): '.' | ',' {
  let commaDecimal = 0
  let dotDecimal = 0

  for (const row of rows.slice(0, 200)) {
    for (const column of columns) {
      const value = (row.cells[column] ?? '').trim()
      if (value === '') continue
      const lastDot = value.lastIndexOf('.')
      const lastComma = value.lastIndexOf(',')
      if (lastDot !== -1 && lastComma !== -1) {
        if (lastComma > lastDot) commaDecimal += 1
        else dotDecimal += 1
        continue
      }
      // Un único separador con uno o dos dígitos detrás sólo puede ser decimal.
      const single = /^[+-]?\d+([.,])(\d{1,2})$/.exec(value)
      if (single !== null) {
        if (single[1] === ',') commaDecimal += 1
        else dotDecimal += 1
      }
    }
  }

  return commaDecimal > dotDecimal ? ',' : '.'
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>
}

// ── Parseo ──────────────────────────────────────────────────────────────────

export function parseCsv(bytes: Uint8Array, options: CsvParseOptions): ParsedStatement {
  const currency = currencyCode(options.currency)
  const { text } = decodeBuffer(bytes)
  const inspection = inspectCsv(bytes, options)
  const rows = tokenizeCsv(text, inspection.delimiter)
  const dataRows = rows.slice(inspection.headerRow === null ? 0 : inspection.headerRow + 1)

  const warnings: ParseWarning[] = []
  for (const note of inspection.notes) {
    warnings.push({
      severity: 'warning',
      code: 'esquema_incierto',
      message: note,
    })
  }
  if (inspection.confidence < 1) {
    warnings.push({
      severity: inspection.confidence < 0.8 ? 'warning' : 'info',
      code: 'esquema_detectado',
      message:
        `Esquema detectado con confianza ${inspection.confidence}: separador "${inspection.delimiter}", ` +
        `fechas ${inspection.dateOrder}, decimales con "${inspection.decimalSeparator}", ` +
        `importes en formato ${inspection.layout}. Confirmá antes de importar.`,
    })
  }

  const lines: StatementLine[] = []
  const { mapping } = inspection

  for (const row of dataRows) {
    const line = buildLine(row, inspection, mapping, currency, options, warnings)
    if (line !== null) lines.push(line)
  }

  return { format: 'csv', account: { currency }, lines, warnings }
}

function buildLine(
  row: CsvRow,
  inspection: CsvInspection,
  mapping: ColumnMapping,
  currency: CurrencyCode,
  options: CsvParseOptions,
  warnings: ParseWarning[],
): StatementLine | null {
  const cell = (index: number | undefined): string =>
    index === undefined ? '' : (row.cells[index] ?? '').trim()

  const dateRaw = cell(mapping.date)
  if (dateRaw === '') return null

  const bookedOn = parseDateWithOrder(dateRaw, inspection.dateOrder)
  if (bookedOn === null) {
    warnings.push({
      severity: 'error',
      code: 'fecha_ilegible',
      message: `Fecha ilegible: ${JSON.stringify(dateRaw)}`,
      lineNumber: row.lineNumber,
    })
    return null
  }

  const amount = readAmount(row, inspection, mapping, currency, options, warnings)
  if (amount === null) return null

  const description =
    mapping.description
      .map((index) => cell(index))
      .filter((value) => value !== '')
      .join(' · ') || 'Sin descripción'

  const valueDateRaw = cell(mapping.valueDate)
  const valuedOn =
    valueDateRaw === '' ? null : parseDateWithOrder(valueDateRaw, inspection.dateOrder)

  const raw: Record<string, string> = {}
  for (const [index, value] of row.cells.entries()) {
    const header = inspection.headers[index]
    if (value.trim() !== '')
      raw[header !== undefined && header !== '' ? header : `col_${index}`] = value
  }

  return {
    lineNumber: row.lineNumber,
    bookedOn,
    amount,
    description,
    raw,
    ...(valuedOn === null ? {} : { valuedOn }),
  }
}

/**
 * Las tres formas en que un CSV bancario expresa el signo:
 *
 *  1. Una columna con el importe ya firmado.
 *  2. Dos columnas, debe y haber, con valores siempre positivos.
 *  3. Una columna de importe más otra con un indicador D/H o D/C.
 *
 * Confundir la segunda con la primera hace que todos los ingresos aparezcan
 * como gastos. Por eso el layout se detecta y se declara, no se asume.
 */
function readAmount(
  row: CsvRow,
  inspection: CsvInspection,
  mapping: ColumnMapping,
  currency: CurrencyCode,
  options: CsvParseOptions,
  warnings: ParseWarning[],
): Money | null {
  const cell = (index: number | undefined): string =>
    index === undefined ? '' : (row.cells[index] ?? '').trim()

  const parse = (raw: string): bigint | null => {
    const parsed = parseAmount(raw, {
      decimalSeparator: inspection.decimalSeparator,
    })
    if (parsed === null) return null
    try {
      return fromDecimalString(parsed.canonical, currency).amount
    } catch {
      return null
    }
  }

  let minor: bigint | null = null

  if (inspection.layout === 'debit_credit') {
    const debit = cell(mapping.debit)
    const credit = cell(mapping.credit)
    const debitValue = debit === '' ? null : parse(debit)
    const creditValue = credit === '' ? null : parse(credit)

    if (debitValue !== null && debitValue !== 0n) {
      // La columna "debe" trae el importe en positivo: sale de la cuenta.
      minor = debitValue > 0n ? -debitValue : debitValue
    } else if (creditValue !== null && creditValue !== 0n) {
      minor = creditValue < 0n ? -creditValue : creditValue
    } else if (debitValue === null && creditValue === null) {
      warnings.push({
        severity: 'error',
        code: 'importe_ilegible',
        message: `Ni debe ni haber legibles: ${JSON.stringify([debit, credit])}`,
        lineNumber: row.lineNumber,
      })
      return null
    } else {
      minor = 0n
    }
  } else {
    const raw = cell(mapping.amount)
    if (raw === '') return null
    const value = parse(raw)
    if (value === null) {
      warnings.push({
        severity: 'error',
        code: 'importe_ilegible',
        message: `Importe ilegible: ${JSON.stringify(raw)}`,
        lineNumber: row.lineNumber,
      })
      return null
    }
    minor = value

    if (inspection.layout === 'sign_column') {
      const indicator = normalize(cell(mapping.sign))
      const magnitude = minor < 0n ? -minor : minor
      if (/^(d|debe|debito|debit|cargo|s|salida)$/.test(indicator)) minor = -magnitude
      else if (/^(h|haber|c|credito|credit|abono|e|entrada)$/.test(indicator)) minor = magnitude
      else {
        warnings.push({
          severity: 'warning',
          code: 'signo_desconocido',
          message: `Indicador de signo no reconocido: ${JSON.stringify(cell(mapping.sign))}`,
          lineNumber: row.lineNumber,
        })
      }
    }
  }

  if (options.invertSign === true) minor = -minor
  return { amount: minor, currency }
}
