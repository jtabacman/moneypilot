'use client'

import { useActionState, useState } from 'react'
import { deshacerLote, type EstadoDeshacer } from './actions'
import styles from './page.module.css'

/**
 * El estado inicial, declarado del lado del cliente a propósito.
 *
 * Un módulo `'use server'` sólo exporta funciones al cliente; un objeto llega
 * como `undefined` sin que nada avise. Declarado allá, este componente
 * arrancaba con `estado.mensaje === undefined` y, como `undefined !== null`,
 * cada fila del historial enseñaba un "no se pudo" vacío desde el primer
 * render — un fallo anunciado que no había ocurrido.
 */
const SIN_DESHACER: EstadoDeshacer = { ok: false, mensaje: null }

/**
 * El botón de deshacer, en dos pasos y sin `confirm()` del navegador.
 *
 * Dos pasos porque revertir borra asientos del libro: no es destructivo de
 * verdad —el fichero se puede volver a importar, y para eso el lote revertido
 * libera su hash— pero mueve saldos, y un click accidental en una tabla de
 * veinte filas no puede hacer eso. Inline y no en un diálogo modal porque la
 * pregunta se entiende sola al lado de la fila que la provoca.
 *
 * `deshecho` llega desde el servidor después del refresco que dispara la propia
 * acción. Se sigue montando el componente en ese estado para poder enseñar lo
 * que devolvió `revertImport`: cuántos asientos se quitaron y —lo que de verdad
 * importa— si alguna fila de la cola de revisión de otro lote se quedó sin su
 * enlace. Eso último es un hueco en los datos de alguien y no puede
 * desaparecer con el botón que lo provocó.
 */
export function Deshacer({
  lote,
  fichero,
  deshecho,
}: {
  lote: string
  fichero: string
  deshecho: boolean
}) {
  const [estado, accion, pendiente] = useActionState(deshacerLote, SIN_DESHACER)
  const [confirmando, setConfirmando] = useState(false)

  const fallo = estado.ok ? null : estado.mensaje
  const hecho = estado.ok ? estado.mensaje : null

  if (deshecho) {
    // Un lote que ya venía deshecho de otra sesión no tiene nada que contar
    // acá: su estado lo dice la columna de al lado.
    if (hecho === null) return null
    return (
      <div className={styles.deshacer}>
        <span className="status ok">deshecho</span>
        <p className="small">{hecho}</p>
      </div>
    )
  }

  return (
    <div className={styles.deshacer}>
      {/* El error se enseña sin quitar el control: `revertImport` se niega por
          motivos que a veces se pueden resolver, y dejar la fila sin botón
          obligaría a recargar la página para volver a intentarlo. */}
      {fallo !== null && (
        <>
          <span className="status bad">no se pudo</span>
          <p className="small">{fallo}</p>
        </>
      )}

      {confirmando ? (
        <form action={accion} className={styles.confirmar}>
          <input type="hidden" name="lote" value={lote} />
          <span className="small">¿Quitar del libro lo que trajo este fichero?</span>
          <span className="row">
            <button type="submit" className="primary" disabled={pendiente}>
              {pendiente ? 'Deshaciendo…' : 'Sí, deshacer'}
            </button>
            <button
              type="button"
              className="quiet"
              disabled={pendiente}
              onClick={() => setConfirmando(false)}
            >
              No
            </button>
          </span>
        </form>
      ) : (
        <button
          type="button"
          className="quiet"
          onClick={() => setConfirmando(true)}
          aria-label={`Deshacer la importación de ${fichero}`}
        >
          Deshacer
        </button>
      )}
    </div>
  )
}
