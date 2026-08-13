/**
 * Lo que comparten la página, los formularios y las acciones de /dimensiones.
 *
 * Vive en su propio módulo por una razón del framework y no de gusto: un
 * fichero con `'use server'` sólo puede exportar funciones asíncronas, así que
 * un tipo o una constante compartida no caben ahí. Y un componente de cliente
 * tampoco puede importarlos de la página, que es de servidor.
 */

export interface ActionState {
  readonly status: 'idle' | 'ok' | 'error'
  readonly message: string
}

export const IDLE: ActionState = { status: 'idle', message: '' }

export function hecho(message: string): ActionState {
  return { status: 'ok', message }
}

export function falla(message: string): ActionState {
  return { status: 'error', message }
}

/**
 * Quién puede tocar la estructura del hogar.
 *
 * Sale de B6: titular y pareja editan; contador y asistente **proponen**, y la
 * propuesta genera un diff que el titular aprueba. Mientras ese circuito no
 * exista, lo correcto es no escribir — no dejar escribir directo y llamarlo
 * equivalente.
 */
export function puedeEditarEstructura(role: string): boolean {
  return role === 'titular' || role === 'pareja'
}
