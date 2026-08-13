/**
 * Reconciliación e informe de importación.
 *
 * Esto no es una utilidad de diagnóstico: es el primer entregable del producto.
 * La promesa comercial es "cargamos tu historia y te mostramos exactamente qué
 * entró y qué no antes de que confirmes", y este módulo es esa promesa hecha
 * código.
 *
 * El criterio duro: un delta distinto de cero es un fallo **visible**, no un
 * detalle. Si el motor no puede explicar su propia importación, nadie va a
 * creerle un reporte de patrimonio.
 */

import type { CurrencyCode } from './currency.js'
import { formatMoney, type Money, subtract, zero } from './money.js'
import type { PlainDate } from './plain-date.js'
import type { ParseWarning, StatementFormat } from './statement.js'

export type ReconciliationStatus = 'conciliada' | 'delta' | 'sin_saldo_declarado'

export interface AccountReconciliationInput {
  readonly accountId: string
  readonly accountLabel: string
  readonly currency: CurrencyCode
  /** Saldo de apertura declarado por el extracto, si lo trae. */
  readonly openingBalance?: Money
  /** Saldo de cierre declarado por el extracto, si lo trae. */
  readonly closingBalance?: Money
  /** Suma de los movimientos efectivamente cargados para esta cuenta. */
  readonly movements: Money
  readonly linesImported: number
}

export interface AccountReconciliation {
  readonly accountId: string
  readonly accountLabel: string
  readonly currency: CurrencyCode
  readonly openingBalance: Money | null
  readonly movements: Money
  /** Apertura + movimientos. Lo que el sistema cree que debería dar. */
  readonly computedClosing: Money | null
  /** Lo que el banco dice que da. */
  readonly reportedClosing: Money | null
  /** computedClosing − reportedClosing. Cero es lo único aceptable. */
  readonly delta: Money | null
  readonly status: ReconciliationStatus
  readonly linesImported: number
}

export function reconcileAccount(input: AccountReconciliationInput): AccountReconciliation {
  const opening = input.openingBalance ?? null
  const reported = input.closingBalance ?? null

  const computed =
    opening === null
      ? null
      : {
          amount: opening.amount + input.movements.amount,
          currency: input.currency,
        }

  const delta = computed === null || reported === null ? null : subtract(computed, reported)

  const status: ReconciliationStatus =
    delta === null ? 'sin_saldo_declarado' : delta.amount === 0n ? 'conciliada' : 'delta'

  return {
    accountId: input.accountId,
    accountLabel: input.accountLabel,
    currency: input.currency,
    openingBalance: opening,
    movements: input.movements,
    computedClosing: computed,
    reportedClosing: reported,
    delta,
    status,
    linesImported: input.linesImported,
  }
}

/**
 * Importe del asiento de apertura que hay que crear para que la cuenta cuadre.
 *
 * Cuando se importa un recorte de historia (los últimos 24 meses de una cuenta
 * que existe hace 15 años), las transacciones cargadas no explican el saldo
 * actual. La diferencia va a un asiento de apertura contra patrimonio, y se
 * calcula hacia atrás desde el saldo conocido — nunca se asume cero.
 */
export function openingEntryAmount(knownClosing: Money, movements: Money): Money {
  return subtract(knownClosing, movements)
}

export type RejectionReason =
  | 'fecha_ilegible'
  | 'importe_ilegible'
  | 'moneda_desconocida'
  | 'cuenta_desconocida'
  | 'fila_vacia'
  | 'formato_invalido'

export interface RejectedRow {
  readonly lineNumber: number
  readonly reason: RejectionReason
  readonly detail: string
  /** Contenido crudo de la fila, para poder auditarla sin volver al fichero. */
  readonly raw?: string
}

export interface ImportReport {
  readonly batchId: string
  readonly fileName: string
  readonly format: StatementFormat
  readonly importedAt: string
  readonly linesRead: number
  readonly imported: number
  readonly duplicates: number
  /**
   * Movimientos que ya estaban en el libro y que el origen corrigió: mismo
   * identificador de proveedor, otro importe, otra fecha u otra descripción.
   * Sólo puede pasar con un feed; un fichero siempre trae 0.
   *
   * Va contado aparte y no sumado a `imported` porque no entró nada nuevo al
   * libro: se reescribió un asiento en su sitio. Sumarlo inflaría el número
   * con el que alguien comprueba cuánto se cargó.
   */
  readonly updated: number
  readonly needsReview: number
  readonly rejected: readonly RejectedRow[]
  readonly transfersMatched: number
  readonly accounts: readonly AccountReconciliation[]
  readonly warnings: readonly ParseWarning[]
  readonly periodFrom: PlainDate | null
  readonly periodTo: PlainDate | null
}

/**
 * Un informe está limpio sólo si además **leyó algo**.
 *
 * Sin esa condición, un fichero de un formato no soportado —o uno vacío— sale
 * con cero filas, cero rechazos y cero deltas, y el informe declara que todo
 * cuadra. Es la peor forma de fallar de este producto: dice que salió bien
 * cuando no pasó nada. La ausencia no se ve; hay que declararla.
 */
export function importReportIsClean(report: ImportReport): boolean {
  return (
    report.linesRead > 0 &&
    // `updated` cuenta acá porque también es una fila que se entendió y se
    // resolvió: una sincronización que sólo trae correcciones hizo su trabajo.
    report.imported + report.duplicates + report.updated + report.needsReview > 0 &&
    report.rejected.length === 0 &&
    report.accounts.every((account) => account.status !== 'delta')
  )
}

/** true si el fichero se reconoció pero no produjo ni una sola fila. */
export function importReportIsEmpty(report: ImportReport): boolean {
  return report.linesRead === 0
}

/** Cuentas cuyo saldo no cuadra. Es la lista que hay que resolver antes de cerrar. */
export function accountsWithDelta(report: ImportReport): AccountReconciliation[] {
  return report.accounts.filter((account) => account.status === 'delta')
}

const STATUS_LABEL: Record<ReconciliationStatus, string> = {
  conciliada: 'OK',
  delta: 'DELTA',
  sin_saldo_declarado: 'sin saldo',
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length)
}

function padLeft(value: string, width: number): string {
  return value.length >= width ? value : ' '.repeat(width - value.length) + value
}

/**
 * Renderiza el informe en texto plano.
 *
 * Es deliberadamente el mismo contenido que después va al PDF: la versión de
 * consola no es un resumen degradado, es el informe completo. Lo que el
 * operador ve en la terminal es lo que el cliente va a ver.
 */
export function renderImportReport(report: ImportReport): string {
  const lines: string[] = []
  const rule = '─'.repeat(78)

  lines.push(rule)
  lines.push(`INFORME DE IMPORTACIÓN — ${report.fileName}`)
  lines.push(
    `lote ${report.batchId} · formato ${report.format.toUpperCase()} · ${report.importedAt}`,
  )
  if (report.periodFrom !== null && report.periodTo !== null) {
    lines.push(`período ${report.periodFrom} a ${report.periodTo}`)
  }
  lines.push(rule)
  lines.push('')

  lines.push('FILAS')
  lines.push(`  leídas                  ${padLeft(String(report.linesRead), 6)}`)
  lines.push(`  importadas              ${padLeft(String(report.imported), 6)}`)
  lines.push(`  duplicadas descartadas  ${padLeft(String(report.duplicates), 6)}`)
  // Sólo cuando las hay: un fichero nunca corrige nada en su sitio, y una
  // línea fija en cero enseñaría un concepto que no aplica en ese caso.
  if (report.updated > 0) {
    lines.push(`  corregidas en su sitio  ${padLeft(String(report.updated), 6)}`)
  }
  lines.push(`  a revisión humana       ${padLeft(String(report.needsReview), 6)}`)
  lines.push(`  rechazadas              ${padLeft(String(report.rejected.length), 6)}`)
  lines.push(`  transferencias emparejadas ${padLeft(String(report.transfersMatched), 3)}`)
  lines.push('')

  lines.push('RECONCILIACIÓN POR CUENTA')
  lines.push(
    `  ${pad('cuenta', 24)}${padLeft('apertura', 16)}${padLeft('movimientos', 16)}${padLeft('calculado', 16)}${padLeft('real', 16)}${padLeft('delta', 14)}  estado`,
  )
  for (const account of report.accounts) {
    const cells = [
      pad(account.accountLabel.slice(0, 23), 24),
      padLeft(account.openingBalance === null ? '—' : formatMoney(account.openingBalance), 16),
      padLeft(formatMoney(account.movements), 16),
      padLeft(account.computedClosing === null ? '—' : formatMoney(account.computedClosing), 16),
      padLeft(account.reportedClosing === null ? '—' : formatMoney(account.reportedClosing), 16),
      padLeft(account.delta === null ? '—' : formatMoney(account.delta), 14),
      `  ${STATUS_LABEL[account.status]}`,
    ]
    lines.push(`  ${cells.join('')}`)
  }
  lines.push('')

  if (report.rejected.length > 0) {
    lines.push('FILAS RECHAZADAS')
    for (const row of report.rejected) {
      lines.push(
        `  línea ${padLeft(String(row.lineNumber), 5)}  ${pad(row.reason, 20)} ${row.detail}`,
      )
      if (row.raw !== undefined) lines.push(`             ${row.raw.slice(0, 100)}`)
    }
    lines.push('')
  }

  if (report.warnings.length > 0) {
    lines.push('AVISOS')
    for (const warning of report.warnings) {
      const where = warning.lineNumber === undefined ? '' : ` (línea ${warning.lineNumber})`
      lines.push(`  [${warning.severity}] ${warning.code}: ${warning.message}${where}`)
    }
    lines.push('')
  }

  const deltas = accountsWithDelta(report)
  lines.push(rule)
  if (importReportIsEmpty(report)) {
    lines.push('RESULTADO: el fichero se reconoció pero no contenía ninguna transacción legible.')
    lines.push('Revisá los avisos de arriba: puede ser un subtipo no soportado o un fichero vacío.')
  } else if (importReportIsClean(report)) {
    const verified = report.accounts.filter((a) => a.status === 'conciliada').length
    if (verified === 0) {
      // Decir "cuadra" cuando no había nada contra qué cuadrar es la misma
      // falsa tranquilidad que declarar éxito sin haber leído una fila.
      lines.push('RESULTADO: sin filas rechazadas, pero NINGUNA cuenta se pudo verificar.')
      lines.push('El fichero no declara saldos, así que la conciliación queda pendiente de')
      lines.push('contrastar contra el histórico ya cargado o contra el saldo real del banco.')
    } else {
      lines.push(
        `RESULTADO: ${verified} de ${report.accounts.length} cuenta(s) verificadas contra el ` +
          'saldo del banco, sin filas rechazadas.',
      )
    }
  } else {
    const parts: string[] = []
    if (deltas.length > 0) parts.push(`${deltas.length} cuenta(s) con delta`)
    if (report.rejected.length > 0) parts.push(`${report.rejected.length} fila(s) rechazada(s)`)
    lines.push(`RESULTADO: revisar — ${parts.join(', ')}.`)
  }
  lines.push(rule)

  return lines.join('\n')
}

/** Suma de movimientos por cuenta, para alimentar la reconciliación. */
export function totalMovements(amounts: readonly Money[], currency: CurrencyCode): Money {
  let total = 0n
  for (const amount of amounts) {
    if (amount.currency !== currency) continue
    total += amount.amount
  }
  return total === 0n ? zero(currency) : { amount: total, currency }
}
