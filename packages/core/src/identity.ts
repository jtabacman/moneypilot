/**
 * Identidad canónica de una transacción.
 *
 * El principio: el identificador que trae el banco (FITID en OFX) es un
 * *atributo*, nunca la clave primaria. Está documentado que el FITID sólo es
 * único dentro del alcance de la cuenta, y que los bancos reemiten FITIDs
 * distintos para la misma transacción tras un rebooking. Tratarlo como clave
 * global rechaza transacciones legítimas y duplica las reemitidas.
 *
 * Por eso el sistema calcula su propia huella determinista y guarda el FITID
 * al lado, como una señal más para el dedup.
 */

import { createHash } from 'node:crypto'
import { type Money, toDecimalString } from './money.js'
import { normalizeDescription } from './normalize.js'
import type { PlainDate } from './plain-date.js'

/**
 * Versión del algoritmo de huella. Si cambia `normalizeDescription` o la
 * composición del string canónico, esto sube y hay que re-hashear la base.
 * Va dentro del hash para que dos versiones nunca colisionen.
 */
export const IDENTITY_VERSION = 1

/**
 * Separador de unidad ASCII (0x1F). Escrito como escape a propósito: un
 * carácter de control literal en el fuente es invisible al leer y cualquier
 * formateador puede comérselo, lo que cambiaría todas las huellas en silencio.
 *
 * Va entre campos para que dos entradas distintas no puedan producir el mismo
 * string canónico por concatenación ("ab"+"c" contra "a"+"bc").
 */
const SEP = '\u001F'

export interface IdentityInput {
  readonly accountId: string
  /** Fecha contable (booking), no la de valor. Mezclarlas rompe el dedup. */
  readonly bookedOn: PlainDate
  readonly amount: Money
  readonly descriptionRaw: string
  /**
   * Desempate para filas genuinamente idénticas dentro del mismo origen:
   * dos cafés de 3,50 el mismo día en el mismo comercio son dos transacciones
   * reales, no un duplicado. El ordinal es su posición entre las idénticas.
   */
  readonly ordinal: number
}

export function canonicalIdentityString(input: IdentityInput): string {
  return [
    `v${IDENTITY_VERSION}`,
    input.accountId,
    input.bookedOn,
    toDecimalString(input.amount),
    input.amount.currency,
    normalizeDescription(input.descriptionRaw),
    String(input.ordinal),
  ].join(SEP)
}

export function transactionFingerprint(input: IdentityInput): string {
  return createHash('sha256').update(canonicalIdentityString(input), 'utf8').digest('hex')
}

/**
 * Asigna ordinales a un lote de filas ya parseadas.
 *
 * Dos filas con la misma cuenta, fecha, importe y descripción normalizada son
 * indistinguibles: se numeran 0, 1, 2… en el orden en que vienen en el fichero.
 * Esto hace que reimportar el mismo fichero produzca exactamente las mismas
 * huellas — que es lo que da idempotencia.
 */
export function assignOrdinals<T extends Omit<IdentityInput, 'ordinal'>>(
  rows: readonly T[],
): (T & { ordinal: number })[] {
  const seen = new Map<string, number>()
  return rows.map((row) => {
    const key = [
      row.accountId,
      row.bookedOn,
      toDecimalString(row.amount),
      row.amount.currency,
      normalizeDescription(row.descriptionRaw),
    ].join(SEP)
    const ordinal = seen.get(key) ?? 0
    seen.set(key, ordinal + 1)
    return { ...row, ordinal }
  })
}
