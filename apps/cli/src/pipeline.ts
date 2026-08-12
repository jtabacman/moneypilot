/**
 * El camino completo de un fichero a un informe, sin tocar la base.
 *
 * Está separado del comando a propósito: es una función pura de bytes a
 * informe, así que se puede testear entera y reusar desde la web sin arrastrar
 * nada de la terminal.
 */

import {
  accountMovement,
  assignOrdinals,
  type ClassifiedTransaction,
  classifyIncoming,
  type ImportReport,
  type IncomingTransaction,
  matchTransfers,
  type ParsedStatement,
  reconcileAccount,
  summarizeDedup,
  type TransactionRef,
  type TransferPair,
  totalMovements,
} from '@moneypilot/core'
import {
  detectFormat,
  inspectCsv,
  parseCsv,
  parseN43,
  parseOfx,
  parseQif,
} from '@moneypilot/importers'

export interface PipelineOptions {
  readonly fileName: string
  /** Obligatoria para QIF y CSV, que no declaran moneda. */
  readonly currency?: string
  readonly accountLabel?: string
  /** Transacciones ya persistidas contra las que deduplicar. */
  readonly existing?: readonly TransactionRef[]
}

export interface PipelineResult {
  readonly statements: ParsedStatement[]
  readonly classified: ClassifiedTransaction[]
  readonly transfers: readonly TransferPair[]
  readonly report: ImportReport
}

export class UnsupportedFormatError extends Error {
  constructor(readonly evidence: string) {
    super(`No se reconoció el formato del fichero: ${evidence}`)
    this.name = 'UnsupportedFormatError'
  }
}

export class UnsupportedStatementError extends Error {
  constructor(
    readonly format: string,
    readonly detail: string,
  ) {
    super(
      `El fichero es ${format.toUpperCase()} válido pero no se pudo extraer ningún extracto: ${detail}`,
    )
    this.name = 'UnsupportedStatementError'
  }
}

export class MissingCurrencyError extends Error {
  constructor(format: string) {
    super(
      `El formato ${format.toUpperCase()} no declara moneda. Indicá una con --currency, ` +
        'por ejemplo --currency EUR.',
    )
    this.name = 'MissingCurrencyError'
  }
}

export function runPipeline(bytes: Uint8Array, options: PipelineOptions): PipelineResult {
  const detection = detectFormat(bytes)
  if (detection.format === null) throw new UnsupportedFormatError(detection.evidence)

  const statements = parseByFormat(bytes, detection.format, options)

  // Un formato reconocido que no produce ni un extracto es casi siempre un
  // subtipo no soportado, y hay que nombrarlo. Devolver un informe vacío que
  // dice "todo cuadra" es peor que fallar.
  if (statements.length === 0) {
    throw new UnsupportedStatementError(detection.format, describeEmptyOfx(bytes, detection.format))
  }

  // Los ordinales se asignan por cuenta sobre todo el lote: es lo que hace que
  // dos cafés idénticos del mismo día sean dos transacciones y no un duplicado,
  // y que reimportar el mismo fichero produzca exactamente las mismas huellas.
  const incoming: IncomingTransaction[] = []
  for (const [index, statement] of statements.entries()) {
    const accountKey = accountIdFor(statement, index, options)
    const withOrdinals = assignOrdinals(
      statement.lines.map((line) => ({
        accountId: accountKey,
        bookedOn: line.bookedOn,
        amount: line.amount,
        descriptionRaw: line.description,
      })),
    )
    for (const [position, row] of withOrdinals.entries()) {
      const line = statement.lines[position]
      if (line === undefined) continue
      incoming.push({
        lineNumber: line.lineNumber,
        accountId: accountKey,
        bookedOn: line.bookedOn,
        amount: line.amount,
        description: line.description,
        ordinal: row.ordinal,
        ...(line.externalId === undefined ? {} : { externalId: line.externalId }),
      })
    }
  }

  const classified = classifyIncoming(incoming, options.existing ?? [])
  const summary = summarizeDedup(classified)

  const accepted = classified.filter((item) => item.verdict.kind === 'new')
  const transfers = matchTransfers(
    accepted.map((item) => ({
      id: `${item.incoming.accountId}#${item.incoming.lineNumber}`,
      accountId: item.incoming.accountId,
      bookedOn: item.incoming.bookedOn,
      amount: item.incoming.amount,
      description: item.incoming.description,
    })),
  ).pairs

  const accounts = statements.map((statement, index) => {
    const accountKey = accountIdFor(statement, index, options)
    const importedHere = accepted.filter((item) => item.incoming.accountId === accountKey)
    return reconcileAccount({
      accountId: accountKey,
      accountLabel: labelFor(statement, index, options),
      currency: statement.account.currency,
      movements: totalMovements(
        importedHere.map((item) => item.incoming.amount),
        statement.account.currency,
      ),
      linesImported: importedHere.length,
      ...(statement.openingBalance === undefined
        ? {}
        : { openingBalance: statement.openingBalance.amount }),
      ...(statement.closingBalance === undefined
        ? {}
        : { closingBalance: statement.closingBalance.amount }),
    })
  })

  const allLines = statements.flatMap((statement) => statement.lines)
  const dates = allLines.map((line) => line.bookedOn).sort()

  const report: ImportReport = {
    batchId: 'dry-run',
    fileName: options.fileName,
    format: detection.format,
    importedAt: new Date().toISOString(),
    linesRead: allLines.length,
    imported: summary.fresh,
    duplicates: summary.duplicates,
    needsReview: summary.needsReview,
    rejected: statements.flatMap((statement) =>
      statement.warnings
        .filter((warning) => warning.severity === 'error' && warning.lineNumber !== undefined)
        .map((warning) => ({
          lineNumber: warning.lineNumber ?? 0,
          reason: reasonFor(warning.code),
          detail: warning.message,
        })),
    ),
    transfersMatched: transfers.length,
    accounts,
    warnings: statements.flatMap((statement) => statement.warnings),
    periodFrom: dates[0] ?? null,
    periodTo: dates[dates.length - 1] ?? null,
  }

  return { statements, classified, transfers, report }
}

function parseByFormat(
  bytes: Uint8Array,
  format: string,
  options: PipelineOptions,
): ParsedStatement[] {
  switch (format) {
    case 'ofx':
    case 'qfx':
      return parseOfx(
        bytes,
        options.currency === undefined ? {} : { fallbackCurrency: options.currency },
      )
    case 'n43':
      return parseN43(bytes)
    case 'qif':
      if (options.currency === undefined) throw new MissingCurrencyError(format)
      return [parseQif(bytes, { currency: options.currency })]
    case 'csv':
      if (options.currency === undefined) throw new MissingCurrencyError(format)
      return [parseCsv(bytes, { currency: options.currency })]
    default:
      throw new UnsupportedFormatError(`el formato ${format} todavía no está implementado`)
  }
}

/**
 * OFX tiene tres tipos de extracto y sólo dos están implementados. Cuando
 * llega el tercero conviene decir cuál es, en vez de "no se encontró nada".
 */
function describeEmptyOfx(bytes: Uint8Array, format: string): string {
  if (format !== 'ofx' && format !== 'qfx') return 'el fichero no contiene movimientos'
  const head = new TextDecoder('windows-1252').decode(bytes.subarray(0, 8192))
  if (/<INVSTMTRS[\s>]/i.test(head)) {
    return (
      'es un extracto de inversión (INVSTMTRS), que todavía no está soportado. ' +
      'Sólo se leen cuentas bancarias (STMTRS) y tarjetas (CCSTMTRS)'
    )
  }
  return 'no contiene ni STMTRS ni CCSTMTRS'
}

function accountIdFor(statement: ParsedStatement, index: number, options: PipelineOptions): string {
  return (
    options.accountLabel ??
    statement.account.accountNumber ??
    statement.account.institution ??
    `cuenta-${index + 1}`
  )
}

function labelFor(statement: ParsedStatement, index: number, options: PipelineOptions): string {
  const parts = [
    options.accountLabel ?? statement.account.institution,
    statement.account.accountNumber,
  ].filter((value): value is string => value !== undefined && value !== '')
  return parts.length > 0 ? parts.join(' ') : `Cuenta ${index + 1}`
}

function reasonFor(code: string): ImportReport['rejected'][number]['reason'] {
  if (code.startsWith('fecha')) return 'fecha_ilegible'
  if (code.startsWith('importe')) return 'importe_ilegible'
  if (code.startsWith('divisa') || code.startsWith('moneda')) return 'moneda_desconocida'
  return 'formato_invalido'
}

/** Suma de lo aceptado por cuenta, para mostrar el efecto de la importación. */
export function movementByAccount(result: PipelineResult, accountId: string): bigint {
  return result.classified
    .filter((item) => item.verdict.kind === 'new' && item.incoming.accountId === accountId)
    .reduce((total, item) => total + item.incoming.amount.amount, 0n)
}

export { accountMovement }
