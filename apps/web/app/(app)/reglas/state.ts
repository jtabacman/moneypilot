/**
 * Lo que comparten la pantalla, el formulario y las acciones de /reglas.
 *
 * Vive aparte por una razón del framework: un módulo con `'use server'` sólo
 * puede exportar funciones asíncronas, así que un tipo o una constante
 * compartida con el formulario de cliente no caben ahí.
 */

export interface EstadoRegla {
  /**
   * `propuesta` no es un error: es el caso de B6 —el contador y el asistente
   * proponen, no escriben— y se pinta como aviso, no como fallo. Verlo en rojo
   * haría pensar que algo se rompió cuando lo que pasa es que falta un circuito.
   */
  readonly status: 'idle' | 'ok' | 'error' | 'propuesta'
  readonly message: string
  /** La regla que quedó guardada, para poder enlazarla desde el formulario. */
  readonly reglaId: string | null
}

export const IDLE: EstadoRegla = { status: 'idle', message: '', reglaId: null }

export function hecho(message: string, reglaId: string | null = null): EstadoRegla {
  return { status: 'ok', message, reglaId }
}

export function falla(message: string): EstadoRegla {
  return { status: 'error', message, reglaId: null }
}

export function propuesta(message: string): EstadoRegla {
  return { status: 'propuesta', message, reglaId: null }
}

/**
 * Quién puede escribir reglas.
 *
 * Sale de B6: titular y pareja editan; contador y asistente **proponen**, y la
 * propuesta genera un diff que el titular aprueba. Ese circuito todavía no
 * existe, así que acá no se escribe. Dejarles escribir directo y llamarlo
 * equivalente sería peor: una regla aplicada mueve la categoría de cientos de
 * movimientos, que es exactamente el cambio que B6 quiere que alguien apruebe.
 */
export function puedeEditarReglas(role: string): boolean {
  return role === 'titular' || role === 'pareja'
}

/** El mensaje que ve quien propone. Dice qué pasó, por qué, y qué falta. */
export function porQueNoEscribe(role: string): string {
  return (
    `Tu rol en este hogar (${role}) propone cambios, no los escribe: una regla aplicada mueve la ` +
    'categoría de cientos de movimientos de golpe y eso lo aprueba el titular. El circuito de ' +
    'propuestas está en construcción, así que por ahora esto no se guardó. Lo que sí podés hacer ' +
    'es pasarle el enlace de esta pantalla: la vista previa de arriba es exactamente lo que ' +
    'estás proponiendo, con su impacto.'
  )
}
