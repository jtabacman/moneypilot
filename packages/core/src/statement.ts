/**
 * El contrato entre los parsers y el motor.
 *
 * Un parser es una función pura `bytes -> ParsedStatement`. No toca la base de
 * datos, no decide si algo es duplicado y no categoriza. Su único trabajo es
 * convertir un formato concreto en esta estructura, **sin perder nada**: lo que
 * no cabe en un campo tipado va a `raw`.
 *
 * Ese "sin perder nada" es literal. Cuando dentro de seis meses haya que
 * responder por qué una transacción quedó como quedó, `raw` es la única prueba.
 */

import type { CurrencyCode } from './currency.js'
import type { FxRate } from './entry.js'
import type { Money } from './money.js'
import type { PlainDate } from './plain-date.js'

/**
 * 'finapi' sigue en la lista aunque su código se haya eliminado, y es
 * deliberado: hay lotes ya guardados con ese formato, y quitarlo dejaría el
 * historial de importaciones sin poder decir de dónde salió cada uno. Un valor
 * de enum es barato; reescribir historia que alguien ya vio, no.
 *
 * 'finapi' y 'plaid' no son formatos de fichero: son feeds de agregador. Están
 * en la misma lista a propósito, porque para el motor la diferencia no existe —
 * entran por `ParsedStatement` igual que un OFX y se persisten con el mismo
 * `persistImport`. Lo que cambia es el origen (`data_source = 'api'`), no el
 * camino.
 *
 * Que el proveedor quede escrito en el lote no es decorativo: cada uno tiene su
 * propio convenio de signo y su propia idea de qué es una fecha, así que es el
 * dato que dice cómo hay que leer el `raw` de esas filas dentro de seis meses.
 */
export type StatementFormat =
  | 'ofx'
  | 'qfx'
  | 'qif'
  | 'csv'
  | 'n43'
  | 'camt053'
  | 'pdf'
  | 'finapi'
  | 'plaid'

export type WarningSeverity = 'info' | 'warning' | 'error'

export interface ParseWarning {
  readonly severity: WarningSeverity
  readonly code: string
  readonly message: string
  /** Fila del fichero de origen, cuando aplica. 1-indexada. */
  readonly lineNumber?: number
}

export interface StatementLine {
  /** Fila en el fichero de origen, 1-indexada. Va en el informe de importación. */
  readonly lineNumber: number
  /** Fecha contable. La canónica para cortes de período e identidad. */
  readonly bookedOn: PlainDate
  /** Fecha de valor, si el origen la trae. Se conserva; nunca se mezcla con la contable. */
  readonly valuedOn?: PlainDate
  /**
   * Importe en la moneda de la cuenta, con el signo ya normalizado:
   * negativo = sale de la cuenta. Cada parser es responsable de esa
   * normalización porque cada formato la expresa distinto (columnas
   * débito/crédito separadas, signo invertido en tarjetas, valor absoluto
   * con indicador C/D).
   */
  readonly amount: Money
  /** Importe en la moneda del comercio, si difiere de la de la cuenta. */
  readonly native?: Money
  /** Tasa aplicada por el banco, cuando el formato la declara. */
  readonly fxRate?: FxRate
  readonly description: string
  /** FITID u otra referencia del origen. Atributo, nunca clave primaria. */
  readonly externalId?: string
  /** Saldo posterior al movimiento, si el formato lo trae. Sirve para reconciliar. */
  readonly balanceAfter?: Money
  /** Todo lo que vino en el origen, tal cual. */
  readonly raw: Readonly<Record<string, string>>
}

export interface StatementBalance {
  readonly amount: Money
  readonly on: PlainDate
}

export interface StatementAccount {
  readonly institution?: string
  /** Enmascarado por los parsers: nunca se guarda el número completo. */
  readonly accountNumber?: string
  readonly currency: CurrencyCode
}

export interface ParsedStatement {
  readonly format: StatementFormat
  readonly account: StatementAccount
  readonly openingBalance?: StatementBalance
  readonly closingBalance?: StatementBalance
  readonly lines: readonly StatementLine[]
  readonly warnings: readonly ParseWarning[]
}

export class ParseError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly lineNumber?: number,
  ) {
    super(message)
    this.name = 'ParseError'
  }
}
