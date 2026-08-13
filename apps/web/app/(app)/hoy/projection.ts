/**
 * Proyección de liquidez a 13 semanas.
 *
 * Esto **no es una predicción**, y la diferencia no es semántica: una
 * predicción diría cuánta plata vas a tener, y nadie puede. Lo que hay acá es
 * una extrapolación de obligaciones ya observadas — las series recurrentes que
 * el motor detectó con tres cargos o más — restadas del saldo de hoy.
 *
 * Cuatro decisiones sostienen que el número signifique algo:
 *
 *  1. **Un carril por moneda, sin consolidar.** Es la misma regla que
 *     `liquidityByCurrency`: tener 50.000 EUR y −50.000 USD no es tener cero,
 *     es tener un problema de liquidez en dólares. Consolidar la proyección lo
 *     escondería justo cuando importa.
 *  2. **Sólo series confirmadas.** Con dos ocurrencias no hay frecuencia que
 *     estimar: la "próxima fecha" sería el eco de una casualidad, y proyectarla
 *     trece semanas la multiplica por trece.
 *  3. **Cada serie se proyecta por el importe de su ÚLTIMO cargo**, en su
 *     moneda de facturación y sin convertir. Una regla, sin excepciones, que
 *     cabe en una frase que el usuario puede comprobar a mano. Si la serie
 *     subió de precio, el último cargo ya es el precio nuevo.
 *  4. **Lo que queda fuera se cuenta y se devuelve.** Una proyección a la que
 *     le faltan obligaciones y no lo dice es peor que no dar ninguna: el
 *     usuario la lee como completa porque no tiene forma de saber que no lo es.
 *
 * El hueco grande —y hay que decirlo en la pantalla, no acá— es que
 * `recurring` mira sólo el lado del cargo, así que **no hay ingresos**. El
 * carril baja siempre. Eso lo hace útil como "¿me alcanza la caja para lo que
 * ya sé que viene?" e inútil como saldo futuro.
 */

import { addDays, differenceInDays, parsePlainDate } from '@moneypilot/core'
import type { RecurringRow, RecurringState } from '@moneypilot/db'
import type { CarrilCaja } from './lanes'

export const SEMANAS = 13
const DIAS = SEMANAS * 7

export interface CargoProyectado {
  /** Clave estable de la serie: comercio, cuenta y moneda de facturación. */
  readonly serie: string
  readonly merchant: string
  readonly accountId: string
  readonly accountName: string
  readonly currency: string
  /** Positivo: es una salida. */
  readonly amount: bigint
  /** 'YYYY-MM-DD'. */
  readonly on: string
  /** 0..12 */
  readonly semana: number
  readonly frequencyDays: number
  readonly state: RecurringState
}

export interface SemanaProyectada {
  /** Primer día de la semana, 'YYYY-MM-DD'. */
  readonly inicio: string
  readonly salida: bigint
  /** Saldo al cierre de esa semana. */
  readonly saldo: bigint
}

export interface CarrilProyeccion {
  readonly currency: string
  readonly saldoHoy: bigint
  readonly cuentas: number
  /** Las cuentas del carril, para abrir el saldo de partida en el registro. */
  readonly accountIds: readonly string[]
  /**
   * Postings que faltan en `saldoHoy` por estar en otra moneda. Si no es cero,
   * el punto de partida de la proyección está incompleto y hay que decirlo.
   */
  readonly foreignPostings: number
  readonly semanas: readonly SemanaProyectada[]
  readonly salidaTotal: bigint
  readonly saldoFinal: bigint
  /** Series distintas que alimentan el carril. */
  readonly series: number
  /** Cargos individuales, ordenados por fecha. Es el desglose del gráfico. */
  readonly cargos: readonly CargoProyectado[]
}

/** Series recurrentes que no entraron, por qué. Se enseña, no se descarta en silencio. */
export interface FueraDeProyeccion {
  /** Menos de tres ocurrencias: no hay serie que valga. */
  readonly probables: number
  /** En estado 'no-cobro': dejaron de cobrarse, proyectarlas inventa una salida. */
  readonly cesadas: number
  /** Su moneda de facturación no tiene caja propia contra la que proyectar. */
  readonly sinCaja: number
  /** Su último importe de facturación no es un cargo. Ver el comentario abajo. */
  readonly sinCargo: number
}

export interface Proyeccion {
  readonly desde: string
  readonly hasta: string
  readonly carriles: readonly CarrilProyeccion[]
  readonly fuera: FueraDeProyeccion
  /** ¿Hay al menos un cargo proyectado? Sin esto el gráfico es una línea plana. */
  readonly hayCargos: boolean
}

export function proyectar(
  recurrentes: readonly RecurringRow[],
  liquidez: readonly CarrilCaja[],
  hoy: string,
): Proyeccion {
  const desde = parsePlainDate(hoy)
  const hasta = addDays(desde, DIAS - 1)
  const conCaja = new Set(liquidez.map((carril) => carril.currency))

  const cargos: CargoProyectado[] = []
  const fuera = { probables: 0, cesadas: 0, sinCaja: 0, sinCargo: 0 }

  for (const serie of recurrentes) {
    if (serie.confidence !== 'confirmado') {
      fuera.probables += 1
      continue
    }
    if (serie.state === 'no-cobro') {
      fuera.cesadas += 1
      continue
    }
    // `current` sale de `native_amount` cuando el origen lo trae, y ahí el
    // signo depende de cómo lo escribió el banco. Un "cargo" que no es
    // negativo contra la cuenta no es una salida de caja, y meterlo en la
    // proyección con el signo cambiado la subiría en vez de bajarla.
    if (serie.current <= 0n) {
      fuera.sinCargo += 1
      continue
    }
    if (!conCaja.has(serie.currency)) {
      fuera.sinCaja += 1
      continue
    }

    const paso = Math.max(1, serie.frequencyDays)
    let fecha = parsePlainDate(serie.nextExpectedOn)
    // Una serie viva puede traer su próxima fecha ya vencida: el cargo se
    // atrasó unos días pero se sigue cobrando. Se adelanta al primer múltiplo
    // que cae dentro de la ventana en vez de imputar al pasado una salida que
    // todavía no ocurrió.
    const atraso = differenceInDays(fecha, desde)
    if (atraso > 0) fecha = addDays(fecha, Math.ceil(atraso / paso) * paso)

    while (fecha <= hasta) {
      cargos.push({
        serie: `${serie.merchant}·${serie.accountId}·${serie.currency}`,
        merchant: serie.merchant,
        accountId: serie.accountId,
        accountName: serie.accountName,
        currency: serie.currency,
        amount: serie.current,
        on: fecha,
        semana: Math.floor(differenceInDays(desde, fecha) / 7),
        frequencyDays: serie.frequencyDays,
        state: serie.state,
      })
      fecha = addDays(fecha, paso)
    }
  }

  cargos.sort((a, b) =>
    a.on === b.on ? a.merchant.localeCompare(b.merchant) : a.on < b.on ? -1 : 1,
  )

  const carriles = liquidez.map((carril) => {
    const propios = cargos.filter((cargo) => cargo.currency === carril.currency)

    const salidaPorSemana = Array.from({ length: SEMANAS }, () => 0n)
    for (const cargo of propios) {
      salidaPorSemana[cargo.semana] = (salidaPorSemana[cargo.semana] ?? 0n) + cargo.amount
    }

    let saldo = carril.total
    const semanas: SemanaProyectada[] = salidaPorSemana.map((salida, indice) => {
      saldo -= salida
      return { inicio: addDays(desde, indice * 7), salida, saldo }
    })

    const salidaTotal = salidaPorSemana.reduce((suma, salida) => suma + salida, 0n)

    return {
      currency: carril.currency,
      saldoHoy: carril.total,
      cuentas: carril.accounts,
      accountIds: carril.accountIds,
      foreignPostings: carril.foreignPostings,
      semanas,
      salidaTotal,
      saldoFinal: carril.total - salidaTotal,
      series: new Set(propios.map((cargo) => cargo.serie)).size,
      cargos: propios,
    }
  })

  return { desde, hasta, carriles, fuera, hayCargos: cargos.length > 0 }
}
