/**
 * La suma del período filtrado.
 *
 * El repositorio sabe sumar un período entero (`totals`), pero no sabe sumar
 * *este* período con *estos* filtros: cuenta, categoría, dimensión y texto no
 * entran en esa firma. Así que la suma se hace acá, recorriendo el mismo
 * conjunto que se está listando, con las mismas dos reglas de siempre:
 *
 *  - Un movimiento sólo suma si su importe existe en la moneda de reporte. El
 *    que no, se cuenta aparte y se declara con `Coverage`. Un total al que le
 *    faltan movimientos y no lo dice es exactamente el fallo que este producto
 *    existe para no cometer.
 *  - Las patas de traspaso se cuentan aparte para poder nombrarlas, estén
 *    dentro del filtro o fuera.
 *  - **Esta suma es por movimiento entero, no por la parte atribuida.** Filtrar
 *    por una dimensión trae los asientos que la tocan, con su importe completo;
 *    el tablero de estructura reparte ese mismo importe por peso. Los dos
 *    números son correctos y no coinciden, así que hay que contar cuántas filas
 *    están atribuidas sólo en parte para poder decirlo en pantalla.
 */

import { type MovementFilter, type MovementRow, movements, type TenantClient } from '@moneypilot/db'

/** `MAX_LIMIT` del repositorio: pedir más no trae más. */
const LOTE = 500

/**
 * Hasta acá se recorre para sumar; más allá, no hay suma.
 *
 * Son cuatro consultas en el peor caso. Sumar 20.000 movimientos serían
 * cuarenta, y una pantalla que tarda ocho segundos en dar un número que casi
 * nadie mira es peor producto que una que pide acotar el filtro. Lo que no se
 * hace es enseñar la suma de los primeros 2.000 como si fuera la del conjunto.
 */
export const TOPE_SUMA = 2000

export interface Resumen {
  /** Suma de los importes positivos, en la moneda de reporte. */
  readonly entradas: bigint
  /** Suma de los negativos. Sale negativa. */
  readonly salidas: bigint
  readonly neto: bigint
  /** Movimientos del conjunto que no existen en la moneda de reporte. */
  readonly sinConvertir: number
  /** Patas de traspaso dentro de la suma. Cero si el filtro las excluye. */
  readonly traspasos: number
  /**
   * Movimientos sin contrapartida de gasto ni de ingreso: la otra pata del
   * asiento no es una categoría. Son los saldos de apertura y los ajustes de
   * cambio, y suman como cualquier fila de la lista.
   *
   * Se cuentan porque un saldo de apertura de 85.000 € entrando en "Entradas"
   * hace que la cifra no cuadre con ninguna idea razonable de "lo que entró".
   * La fila es correcta y la suma también; lo que faltaría sin esto es poder
   * explicarla.
   */
  readonly sinContrapartida: number
  /**
   * Filas cuya atribución al valor de dimensión que se está filtrando es
   * parcial: el asiento reparte 50/50 entre dos personas, o 60/40 entre la
   * persona y la sociedad.
   *
   * Suman enteras igual —el movimiento existió por su importe completo— y por
   * eso este número tiene que verse: es la distancia exacta entre esta suma y
   * la cifra del tablero que trajo al usuario hasta acá. Sin él, la pantalla
   * del detalle contradice a la del resumen y nadie puede saber cuál mirar.
   */
  readonly repartidas: number
  readonly filas: number
}

/**
 * El importe del movimiento en la moneda de reporte, o null si no se puede.
 *
 * No se convierte nada acá: o el posting trae su importe congelado en esa
 * moneda, o ya está en ella. Aplicar un tipo de cambio de hoy a un movimiento
 * de hace ocho meses daría un número plausible y falso.
 */
export function enMoneda(row: MovementRow, moneda: string): bigint | null {
  if (row.baseAmount !== null && row.baseCurrency === moneda) return row.baseAmount
  if (row.currency === moneda) return row.amount
  return null
}

export function sumar(
  filas: readonly MovementRow[],
  moneda: string,
  /** Valores de dimensión por los que se está filtrando, para medir el reparto. */
  valoresFiltrados: readonly string[] = [],
): Resumen {
  let entradas = 0n
  let salidas = 0n
  let sinConvertir = 0
  let traspasos = 0
  let sinContrapartida = 0
  let repartidas = 0

  const filtrados = new Set(valoresFiltrados)

  for (const fila of filas) {
    if (fila.isTransfer) traspasos += 1
    else if (fila.categoryId === null) sinContrapartida += 1
    if (
      filtrados.size > 0 &&
      fila.dimensions.some((d) => filtrados.has(d.valueId) && d.weightPpm < 1_000_000)
    ) {
      repartidas += 1
    }
    const valor = enMoneda(fila, moneda)
    if (valor === null) {
      sinConvertir += 1
      continue
    }
    if (valor > 0n) entradas += valor
    else salidas += valor
  }

  return {
    entradas,
    salidas,
    neto: entradas + salidas,
    sinConvertir,
    traspasos,
    sinContrapartida,
    repartidas,
    filas: filas.length,
  }
}

/**
 * Recorre el conjunto filtrado entero y lo suma. `null` cuando es tan grande
 * que no se recorre — el que pinta decide qué decir, pero no recibe un número
 * a medias.
 *
 * `yaLeidas` evita la segunda ida a la base en el caso más común de todos: un
 * drill-down que cabe en una página.
 */
export async function resumirFiltro(
  client: TenantClient,
  filtro: MovementFilter,
  moneda: string,
  total: number,
  yaLeidas: readonly MovementRow[] | null,
): Promise<Resumen | null> {
  const valores = filtro.dimensionValueIds ?? []
  if (total > TOPE_SUMA) return null
  if (yaLeidas !== null) return sumar(yaLeidas, moneda, valores)

  const filas: MovementRow[] = []
  // En serie y no con Promise.all: las consultas comparten la conexión de la
  // transacción, así que se encolarían igual, y en serie se puede cortar en
  // cuanto un lote vuelve corto.
  for (let offset = 0; offset < total; offset += LOTE) {
    const lote = await movements(client, { ...filtro, limit: LOTE, offset })
    filas.push(...lote.rows)
    if (lote.rows.length < LOTE) break
  }

  // Dentro de una transacción el recorrido tiene que dar exactamente `total`.
  // Si no lo da, el lote se cortó antes de tiempo —hoy sólo pasaría si `LOTE`
  // dejara de coincidir con el tope del repositorio— y lo que tendríamos es la
  // suma de una parte. Antes que enseñarla como si fuera la del todo, no hay
  // suma: es la misma regla que aplica el tope de arriba.
  if (filas.length < total) return null

  return sumar(filas, moneda, valores)
}
