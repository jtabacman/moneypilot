/**
 * Puente entre la cola de revisión y el registro de movimientos.
 *
 * `reviewQueue` devuelve el NOMBRE de la cuenta del cargo, no su id — le
 * alcanza para escribir la fila, pero /movimientos filtra por id. Sin este
 * índice, la fila de la cola sería el único sitio del producto donde un dato
 * no se puede abrir hasta la transacción.
 *
 * Los nombres repetidos se dejan fuera a propósito. Dos cuentas llamadas igual
 * hacen que el enlace lleve a una de las dos al azar, y un drill-down que
 * acierta la mitad de las veces es peor que uno que se degrada a filtrar sólo
 * por fecha: el usuario no tiene forma de saber cuál de los dos casos le tocó.
 */

import type { AccountBalance } from '@moneypilot/db'

export function indiceDeCuentas(cuentas: readonly AccountBalance[]): ReadonlyMap<string, string> {
  const vistas = new Map<string, string | null>()
  for (const cuenta of cuentas) {
    vistas.set(cuenta.name, vistas.has(cuenta.name) ? null : cuenta.id)
  }

  const indice = new Map<string, string>()
  for (const [nombre, id] of vistas) {
    if (id !== null) indice.set(nombre, id)
  }
  return indice
}
