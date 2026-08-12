/**
 * El pipeline de importación, compartido entre el CLI y la web.
 *
 * Vive acá y no en `apps/cli` porque no es de la terminal: es una función pura
 * de bytes a informe. Cuando exista el contenedor de API, se mueve a un
 * paquete sin que ninguno de los dos consumidores cambie.
 *
 * `toWireReport` existe por un detalle real: los importes son `bigint` y
 * `JSON.stringify` los rechaza. Se serializan como string decimal canónico, no
 * como número — convertirlos a `number` en la frontera reintroduciría en el
 * JSON exactamente el error de coma flotante que el núcleo elimina.
 */

import {
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
  toDecimalString,
  totalMovements,
} from '@moneypilot/core'
import { detectFormat, parseCsv, parseN43, parseOfx, parseQif } from '@moneypilot/importers'

export interface PipelineOptions {
  readonly fileName: string
  readonly currency?: string
  readonly accountLabel?: string
  readonly existing?: readonly TransactionRef[]
}

export interface PipelineResult {
  readonly statements: ParsedStatement[]
  readonly classified: ClassifiedTransaction[]
  readonly transfers: readonly TransferPair[]
  readonly report: ImportReport
}

export class PipelineError extends Error {}

export function runPipeline(bytes: Uint8Array, options: PipelineOptions): PipelineResult {
  const detection = detectFormat(bytes)
  if (detection.format === null) {
    throw new PipelineError(`No se reconoció el formato del fichero: ${detection.evidence}.`)
  }

  const statements = parseByFormat(bytes, detection.format, options)
  if (statements.length === 0) {
    throw new PipelineError(
      `El fichero es ${detection.format.toUpperCase()} válido pero no se pudo extraer ningún ` +
        `extracto: ${describeEmpty(bytes, detection.format)}.`,
    )
  }

  const incoming: IncomingTransaction[] = []
  for (const [index, statement] of statements.entries()) {
    const accountKey = accountIdFor(statement, index, options)
    const ordinals = assignOrdinals(
      statement.lines.map((line) => ({
        accountId: accountKey,
        bookedOn: line.bookedOn,
        amount: line.amount,
        descriptionRaw: line.description,
      })),
    )
    for (const [position, row] of ordinals.entries()) {
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
    const here = accepted.filter((item) => item.incoming.accountId === accountKey)
    return reconcileAccount({
      accountId: accountKey,
      accountLabel: labelFor(statement, index, options),
      currency: statement.account.currency,
      movements: totalMovements(
        here.map((item) => item.incoming.amount),
        statement.account.currency,
      ),
      linesImported: here.length,
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
    batchId: 'preview',
    fileName: options.fileName,
    format: detection.format,
    importedAt: new Date().toISOString(),
    linesRead: allLines.length,
    imported: summary.fresh,
    duplicates: summary.duplicates,
    needsReview: summary.needsReview,
    rejected: statements.flatMap((statement) =>
      statement.warnings
        .filter((w) => w.severity === 'error' && w.lineNumber !== undefined)
        .map((w) => ({
          lineNumber: w.lineNumber ?? 0,
          reason: reasonFor(w.code),
          detail: w.message,
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
      if (options.currency === undefined) throw missingCurrency(format)
      return [parseQif(bytes, { currency: options.currency })]
    case 'csv':
      if (options.currency === undefined) throw missingCurrency(format)
      return [parseCsv(bytes, { currency: options.currency })]
    default:
      throw new PipelineError(`El formato ${format} todavía no está implementado.`)
  }
}

function missingCurrency(format: string): PipelineError {
  return new PipelineError(
    `El formato ${format.toUpperCase()} no declara la moneda. Elegila arriba antes de subir el fichero.`,
  )
}

function describeEmpty(bytes: Uint8Array, format: string): string {
  if (format !== 'ofx' && format !== 'qfx') return 'no contiene movimientos'
  const head = new TextDecoder('windows-1252').decode(bytes.subarray(0, 8192))
  if (/<INVSTMTRS[\s>]/i.test(head)) {
    return (
      'es un extracto de inversión (INVSTMTRS), que todavía no está soportado. ' +
      'Se leen cuentas bancarias (STMTRS) y tarjetas (CCSTMTRS)'
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

// ── Serialización ───────────────────────────────────────────────────────────

export interface WireMoney {
  readonly amount: string
  readonly currency: string
}

export interface WireAccount {
  readonly accountLabel: string
  readonly currency: string
  readonly openingBalance: WireMoney | null
  readonly movements: WireMoney
  readonly computedClosing: WireMoney | null
  readonly reportedClosing: WireMoney | null
  readonly delta: WireMoney | null
  readonly status: string
  readonly linesImported: number
}

export interface WireReport {
  readonly fileName: string
  readonly format: string
  readonly linesRead: number
  readonly imported: number
  readonly duplicates: number
  readonly needsReview: number
  readonly rejected: { lineNumber: number; reason: string; detail: string }[]
  readonly transfersMatched: number
  readonly periodFrom: string | null
  readonly periodTo: string | null
  readonly accounts: WireAccount[]
  readonly warnings: {
    severity: string
    code: string
    message: string
    lineNumber?: number
  }[]
  readonly verifiedAccounts: number
  readonly isEmpty: boolean
  readonly isClean: boolean
}

const wireMoney = (value: { amount: bigint; currency: string } | null): WireMoney | null =>
  value === null ? null : { amount: toDecimalString(value as never), currency: value.currency }

export function toWireReport(report: ImportReport): WireReport {
  const verified = report.accounts.filter((a) => a.status === 'conciliada').length
  const isEmpty = report.linesRead === 0
  return {
    fileName: report.fileName,
    format: report.format,
    linesRead: report.linesRead,
    imported: report.imported,
    duplicates: report.duplicates,
    needsReview: report.needsReview,
    rejected: [...report.rejected],
    transfersMatched: report.transfersMatched,
    periodFrom: report.periodFrom,
    periodTo: report.periodTo,
    verifiedAccounts: verified,
    isEmpty,
    isClean:
      !isEmpty &&
      report.rejected.length === 0 &&
      report.accounts.every((a) => a.status !== 'delta'),
    accounts: report.accounts.map((account) => ({
      accountLabel: account.accountLabel,
      currency: account.currency,
      openingBalance: wireMoney(account.openingBalance),
      movements: wireMoney(account.movements) as WireMoney,
      computedClosing: wireMoney(account.computedClosing),
      reportedClosing: wireMoney(account.reportedClosing),
      delta: wireMoney(account.delta),
      status: account.status,
      linesImported: account.linesImported,
    })),
    warnings: report.warnings.map((w) => ({
      severity: w.severity,
      code: w.code,
      message: w.message,
      ...(w.lineNumber === undefined ? {} : { lineNumber: w.lineNumber }),
    })),
  }
}
