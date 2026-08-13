/**
 * Lo que comparten la página, los botones y la acción de /revisar.
 *
 * Vive en su propio módulo por una razón del framework y no de gusto: un
 * fichero con `'use server'` sólo puede exportar funciones asíncronas, así que
 * el tipo del estado y el predicado de rol no caben ahí. Y los botones son un
 * componente de cliente, que tampoco puede importarlos de la página.
 */

export type Decision = 'aceptar' | 'rechazar'

export interface EstadoDecision {
  readonly status: 'idle' | 'ok' | 'error'
  readonly message: string
}

export const SIN_DECIDIR: EstadoDecision = { status: 'idle', message: '' }

export function hecho(message: string): EstadoDecision {
  return { status: 'ok', message }
}

export function falla(message: string): EstadoDecision {
  return { status: 'error', message }
}

export interface Rotulos {
  readonly aceptar: string
  readonly rechazar: string
  readonly tituloAceptar: string
  readonly tituloRechazar: string
}

/**
 * Cómo se llaman los dos botones en cada tipo de fila.
 *
 * «Aceptar» y «Rechazar» a secas son ambiguos justo donde más caro sale: ante
 * un duplicado probable, nadie sabe si acepta el movimiento o acepta la
 * sospecha del motor, y las dos lecturas llevan a apretar botones opuestos. El
 * rótulo dice qué pasa, y el `title` dice qué se escribe.
 *
 * `esperaFuera` es lo que decide el par de arriba: la fila cuyo movimiento
 * todavía no está en el libro se resuelve metiéndolo o tirándolo, y esa es una
 * decisión distinta —y más grave— que dar por buena una fila ya asentada.
 */
export function rotulosDeDecision(kind: string, esperaFuera: boolean): Rotulos {
  if (esperaFuera) {
    return {
      aceptar: kind === 'posible_duplicado' ? 'No es duplicado' : 'Asentarlo',
      rechazar: kind === 'posible_duplicado' ? 'Es duplicado' : 'Descartarlo',
      tituloAceptar:
        'Crea el asiento en el libro con la transacción que quedó guardada en la evidencia.',
      tituloRechazar: 'No entra al libro. La fila se queda a la vista con su evidencia, resuelta.',
    }
  }
  if (kind === 'transferencia_sugerida') {
    return {
      aceptar: 'Es el mismo traspaso',
      rechazar: 'Son dos movimientos',
      tituloAceptar:
        'Registra tu decisión. Marcar las dos patas como traspaso todavía no está construido.',
      tituloRechazar: 'Registra que no son un traspaso: siguen contando como gasto e ingreso.',
    }
  }
  if (kind === 'sin_categorizar') {
    return {
      aceptar: 'Dar por resuelto',
      rechazar: 'Descartar el aviso',
      tituloAceptar: 'Saca la fila de pendientes. No le cambia la categoría al movimiento.',
      tituloRechazar: 'Descarta el aviso. El movimiento se queda en el libro tal como está.',
    }
  }
  return {
    aceptar: 'Aceptar',
    rechazar: 'Rechazar',
    tituloAceptar: 'Da la fila por buena y la saca de pendientes, con tu nombre y la hora.',
    tituloRechazar: 'Marca la fila como rechazada, con tu nombre y la hora.',
  }
}

/**
 * Quién resuelve la cola.
 *
 * Sale de B6: el contador y el asistente **proponen, no escriben**. El circuito
 * de propuestas —una decisión suya que genera un diff que el titular aprueba—
 * todavía no existe, y mientras no exista lo correcto es no dejarles escribir,
 * no llamar equivalente a que escriban directo. El asesor ni siquiera ve
 * transacciones, así que tampoco decide sobre ellas.
 */
export function puedeResolver(role: string): boolean {
  return role === 'titular' || role === 'pareja'
}

/**
 * Por qué este rol no puede resolver, en la primera persona de quien lo lee.
 *
 * Se usa en dos sitios y tiene que decir lo mismo en los dos: junto al botón
 * apagado (para que se entienda antes de intentarlo) y como respuesta de la
 * acción de servidor (porque una server action es un endpoint público y le
 * puede llegar la petición igual).
 */
export function motivoSinPermiso(role: string): string {
  if (role === 'contador' || role === 'asistente') {
    return (
      `Como ${role} podés proponer, no escribir: una decisión tuya sobre la cola tiene que ` +
      'pasar por la aprobación del titular. Ese circuito —tu propuesta, el diff, el visto ' +
      'bueno— está en construcción, así que por ahora el cambio hay que pedírselo al titular.'
    )
  }
  return (
    `Tu rol en este hogar (${role}) no resuelve la cola de revisión: aceptar o descartar un ` +
    'movimiento cambia el libro, y eso es del titular y de su pareja.'
  )
}
