/**
 * Cuánta historia anterior a la ventana descargada hay que asentar.
 *
 * Esto no es de finAPI ni de Plaid: es de **cualquier** feed. Todos entregan un
 * recorte —los últimos 24 meses de una cuenta que existe hace quince años— y
 * todos declaran el saldo de hoy. La diferencia entre las dos cosas no es un
 * error: es la historia que nadie descargó, y se asienta contra 'Saldo de
 * apertura' para que el libro llegue al saldo que declara el banco **porque
 * llega**, no porque se haya tapado nada.
 *
 * El módulo es puro a propósito —ni red, ni base, ni reloj— para que la parte
 * que decide la cifra se pueda razonar y probar sin levantar Postgres.
 */

import {
  addDays,
  type Money,
  money,
  openingEntryAmount,
  type ParsedStatement,
  parsePlainDate,
  toDecimalString,
} from '@moneypilot/core'
import type { PipelineResult } from '../pipeline'

export interface Apertura {
  /**
   * Lo que la cuenta tenía **antes** de la ventana descargada. Va al informe
   * como apertura, y es lo que hace que el cierre calculado llegue al real.
   */
  readonly delInforme: Money
  /**
   * Importe TOTAL con el que tiene que quedar el asiento de apertura, no un
   * incremento. Ver abajo por qué la diferencia es todo.
   */
  readonly importe: bigint
  /** Día anterior al primer movimiento de la ventana. */
  readonly fecha: string
  /** El saldo que declara el banco. Todo esto sale de acá y de ningún otro sitio. */
  readonly cierreDeclarado: Money
}

export interface AperturaInput {
  readonly statement: ParsedStatement
  readonly sonda: PipelineResult
  readonly accountId: string
  readonly currency: string
  /** Saldo del libro antes de esta sincronización, apertura vieja incluida. */
  readonly saldoPrevio: Money
  /** Importe del asiento de apertura que ya hubiera. Cero si no hay ninguno. */
  readonly aperturaPrevia: bigint
  /**
   * Lo que esta sincronización mueve en el saldo **sin ser una línea nueva**:
   * las correcciones en su sitio y las anulaciones de lo que el banco retiró.
   */
  readonly ajustes: Money
  /**
   * Primer día de la ventana. La apertura se fecha el día anterior. Cuando no
   * hay ningún movimiento nuevo —una sincronización que sólo trae una
   * anulación— lo pone quien llama con la fecha de lo que sí trajo.
   */
  readonly primerMovimiento: string
}

/**
 * **Sólo cuando el banco declara saldo.** Si no lo declara devuelve null y no
 * se inventa ninguna apertura: la reconciliación se queda en
 * 'sin_saldo_declarado', que es la verdad. Derivar la apertura restando los
 * movimientos de NUESTRO cierre calculado daría delta cero siempre y
 * convertiría la comprobación en una tautología — sólo vale restar de un cierre
 * que viene de fuera.
 *
 * ── Ajustar, no acumular ─────────────────────────────────────────────────────
 *
 * Acá es donde esto se rompe si se hace de la forma obvia. La cifra que la
 * cuenta necesita antes de la ventana es `cierre declarado − movimientos de
 * esta ventana`, y es tentador asentar eso directamente. Pero en la segunda
 * sincronización los movimientos ya no son los mismos —entraron los del mes
 * nuevo— y el resultado sería un segundo asiento por casi el mismo importe: la
 * historia que falta contada dos veces, y el saldo al doble.
 *
 * Por eso lo que se asienta es un total y no un incremento: se calcula qué
 * tiene que valer el asiento de apertura para que el libro entero llegue al
 * saldo del banco, restándole lo que el libro ya tiene **sin contar la apertura
 * vieja**. Si la primera sincronización dejó 23.772,06 y la segunda trae
 * movimientos nuevos que el banco ya tenía contados en su saldo, el total sigue
 * siendo 23.772,06 y no se toca nada. Si cambió —porque la ventana se movió,
 * porque una fila se fue a revisión y no se asentó— el asiento se ajusta a la
 * cifra nueva, en su sitio, sin crear otro.
 */
export function aperturaNecesaria(input: AperturaInput): Apertura | null {
  const cierre = input.statement.closingBalance
  if (cierre === undefined) return null

  // Los movimientos que esta importación mete en el libro: las filas nuevas
  // más el desplazamiento de lo que se corrigió o se anuló en su sitio. Es
  // exactamente lo que el informe enseña en la columna "movimientos".
  const enElInforme = input.sonda.report.accounts.find(
    (cuenta) => cuenta.accountId === input.accountId,
  )
  const movimientos = money(
    (enElInforme?.movements.amount ?? 0n) + input.ajustes.amount,
    input.currency,
  )

  // `cierre − movimientos`: lo que la cuenta tenía antes de la ventana.
  const delInforme = openingEntryAmount(cierre.amount, movimientos)
  // Y de ahí se descuenta lo que el libro ya tiene por su cuenta, para que lo
  // que se escriba sea el total del asiento y no una capa más encima.
  const saldoSinApertura = input.saldoPrevio.amount - input.aperturaPrevia

  return {
    delInforme,
    importe: delInforme.amount - saldoSinApertura,
    fecha: addDays(parsePlainDate(input.primerMovimiento), -1),
    cierreDeclarado: cierre.amount,
  }
}

/**
 * El mismo extracto con un aviso que cuenta lo que se asentó de apertura.
 *
 * El aviso va al informe que se guarda con el lote, o sea a lo que alguien lee
 * dentro de seis meses. Sin él, la columna "apertura" aparecería con una cifra
 * que no estaba en ningún sitio del banco y nadie podría reconstruir de dónde
 * salió. Es `info` y no `warning` a propósito: no es un problema, es el hecho
 * de que la ventana descargada no es toda la historia de la cuenta.
 */
export function conAvisoDeApertura(
  statement: ParsedStatement,
  apertura: Apertura | null,
  aperturaPrevia: bigint,
): ParsedStatement {
  if (apertura === null || apertura.importe === aperturaPrevia) return statement

  const importe = toDecimalString(money(apertura.importe, apertura.cierreDeclarado.currency))
  const message =
    aperturaPrevia === 0n
      ? `La cuenta ya tenía saldo antes del primer movimiento descargado. Se asienta una ` +
        `apertura de ${importe} ${apertura.cierreDeclarado.currency} con fecha ${apertura.fecha}, ` +
        `contra 'Saldo de apertura', para que el libro llegue al saldo que declara el banco.`
      : `La apertura de esta cuenta pasa de ` +
        `${toDecimalString(money(aperturaPrevia, apertura.cierreDeclarado.currency))} a ${importe} ` +
        `${apertura.cierreDeclarado.currency}: se ajusta el asiento que ya estaba, no se añade otro.`

  return {
    ...statement,
    warnings: [
      ...statement.warnings,
      { severity: 'info', code: 'apertura_del_historico', message },
    ],
  }
}
