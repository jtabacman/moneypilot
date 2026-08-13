'use client'

import { useActionState } from 'react'
import { resolverItem } from './actions'
import { type Rotulos, SIN_DECIDIR } from './decision'

/**
 * Los dos botones de una fila de la cola.
 *
 * Comparten `name="decision"` y se distinguen por su `value`: el navegador
 * manda el del botón pulsado, así que una sola acción de servidor cubre las dos
 * y la respuesta aparece **pegada a la fila** que la provocó. En una lista de
 * veinte ítems, un mensaje arriba del todo no dice a cuál se refiere.
 *
 * Cuando el rol no puede resolver, los botones se apagan y el motivo va al lado
 * y enlazado con `aria-describedby`. Ni se esconden —esconder la acción haría
 * creer que la cola es informativa— ni se dejan encendidos para que la acción
 * conteste siempre que no: un control que acepta el gesto y no puede cumplirlo
 * nunca hace que la explicación llegue después del esfuerzo.
 */
export function Decidir({
  id,
  rotulos,
  motivo,
}: {
  id: string
  rotulos: Rotulos
  /** Por qué este rol no puede resolver, o null si sí puede. */
  motivo: string | null
}) {
  const [estado, ejecutar, pendiente] = useActionState(resolverItem, SIN_DECIDIR)
  const apagado = motivo !== null
  const motivoId = `sin-permiso-${id}`

  return (
    <form action={ejecutar} className="stack" style={{ gap: '6px', alignItems: 'flex-end' }}>
      <input type="hidden" name="id" value={id} />

      <div className="row" style={{ gap: '6px', justifyContent: 'flex-end' }}>
        <button
          type="submit"
          name="decision"
          value="aceptar"
          disabled={apagado || pendiente}
          title={apagado ? undefined : rotulos.tituloAceptar}
          {...(apagado ? { 'aria-describedby': motivoId } : {})}
        >
          {rotulos.aceptar}
        </button>
        <button
          type="submit"
          name="decision"
          value="rechazar"
          className="quiet"
          disabled={apagado || pendiente}
          title={apagado ? undefined : rotulos.tituloRechazar}
          {...(apagado ? { 'aria-describedby': motivoId } : {})}
        >
          {rotulos.rechazar}
        </button>
      </div>

      {motivo !== null && (
        <span className="small faint" id={motivoId} style={{ maxWidth: '34ch' }}>
          {motivo}
        </span>
      )}

      {estado.status !== 'idle' && (
        <span
          className={estado.status === 'error' ? 'small neg' : 'small'}
          role={estado.status === 'error' ? 'alert' : 'status'}
          style={{ maxWidth: '34ch', textAlign: 'left' }}
        >
          {estado.message}
        </span>
      )}
    </form>
  )
}
