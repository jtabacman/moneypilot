'use client'

/**
 * Los formularios de /dimensiones.
 *
 * Son de cliente sólo por dos cosas: el estado que devuelve cada acción —para
 * poder enseñar «ya hay un valor con ese nombre» al lado del campo y no como
 * una excepción— y el modo edición de una fila. Todo lo demás de la pantalla
 * es servidor.
 */

import { useActionState, useEffect, useId, useState } from 'react'
import {
  archivarValor,
  crearDimension,
  crearValor,
  renombrarValor,
  restaurarValor,
} from './actions'
import styles from './page.module.css'
import { type ActionState, IDLE } from './state'

function Mensaje({ state }: { state: ActionState }) {
  if (state.status === 'idle') return null
  return (
    <span className={state.status === 'ok' ? 'status ok' : 'status bad'} role="status">
      {state.message}
    </span>
  )
}

/* ── Nueva dimensión ─────────────────────────────────────────────────────── */

export function NuevaDimension() {
  const [state, action, pendiente] = useActionState(crearDimension, IDLE)
  const id = useId()

  return (
    <form action={action} className={styles.form}>
      <div className={styles.field}>
        <label className="label" htmlFor={`${id}-label`}>
          Cómo la llamás
        </label>
        <input id={`${id}-label`} name="label" maxLength={120} placeholder="Propiedad" required />
      </div>
      <div className={styles.field}>
        <label className="label" htmlFor={`${id}-key`}>
          Clave <span className="faint">opcional</span>
        </label>
        <input id={`${id}-key`} name="key" maxLength={40} placeholder="propiedad" />
      </div>
      <button type="submit" className="primary" disabled={pendiente}>
        {pendiente ? 'Creando…' : 'Crear dimensión'}
      </button>
      <Mensaje state={state} />
    </form>
  )
}

/* ── Nuevo valor dentro de una dimensión ─────────────────────────────────── */

export interface OpcionPadre {
  readonly id: string
  readonly label: string
  readonly depth: number
}

export function NuevoValor({
  dimensionId,
  dimensionLabel,
  ejemplo,
  padres,
}: {
  dimensionId: string
  dimensionLabel: string
  ejemplo: string
  padres: readonly OpcionPadre[]
}) {
  const [state, action, pendiente] = useActionState(crearValor, IDLE)
  const id = useId()

  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="dimensionId" value={dimensionId} />
      <div className={styles.field}>
        <label className="label" htmlFor={`${id}-label`}>
          Nuevo valor en {dimensionLabel}
        </label>
        <input id={`${id}-label`} name="label" maxLength={120} placeholder={ejemplo} required />
      </div>
      <div className={styles.field}>
        <label className="label" htmlFor={`${id}-parent`}>
          Cuelga de
        </label>
        <select id={`${id}-parent`} name="parentId" defaultValue="">
          <option value="">— de primer nivel —</option>
          {padres.map((padre) => (
            <option key={padre.id} value={padre.id}>
              {'· '.repeat(padre.depth)}
              {padre.label}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" disabled={pendiente}>
        {pendiente ? 'Añadiendo…' : 'Añadir valor'}
      </button>
      <Mensaje state={state} />
    </form>
  )
}

/* ── Acciones de una fila ────────────────────────────────────────────────── */

export function AccionesValor({
  valueId,
  label,
  archivado,
}: {
  valueId: string
  label: string
  archivado: boolean
}) {
  const [editando, setEditando] = useState(false)
  const [renombrado, renombrar, renombrando] = useActionState(renombrarValor, IDLE)
  const [archivo, archivar, archivandose] = useActionState(archivarValor, IDLE)
  const [restauro, restaurar, restaurandose] = useActionState(restaurarValor, IDLE)
  const id = useId()

  // El nombre nuevo ya llegó del servidor con la revalidación: dejar el campo
  // abierto encima de la fila ya corregida enseña dos verdades a la vez.
  useEffect(() => {
    if (renombrado.status === 'ok') setEditando(false)
  }, [renombrado])

  if (editando) {
    return (
      <form action={renombrar} className={styles.rowForm}>
        <input type="hidden" name="valueId" value={valueId} />
        <label className="label" htmlFor={`${id}-nombre`}>
          Nombre
        </label>
        <input
          id={`${id}-nombre`}
          name="label"
          defaultValue={label}
          maxLength={120}
          required
          // biome-ignore lint/a11y/noAutofocus: el campo aparece porque el usuario acaba de pedirlo.
          autoFocus
        />
        <button type="submit" className="primary" disabled={renombrando}>
          {renombrando ? 'Guardando…' : 'Guardar'}
        </button>
        <button type="button" className="quiet" onClick={() => setEditando(false)}>
          Cancelar
        </button>
        <Mensaje state={renombrado} />
      </form>
    )
  }

  return (
    <div className={styles.rowForm}>
      <button type="button" className="quiet" onClick={() => setEditando(true)}>
        Renombrar
      </button>
      {archivado ? (
        <form action={restaurar}>
          <input type="hidden" name="valueId" value={valueId} />
          <button type="submit" className="quiet" disabled={restaurandose}>
            {restaurandose ? 'Restaurando…' : 'Restaurar'}
          </button>
        </form>
      ) : (
        <form action={archivar}>
          <input type="hidden" name="valueId" value={valueId} />
          <button type="submit" className="quiet" disabled={archivandose}>
            {archivandose ? 'Archivando…' : 'Archivar'}
          </button>
        </form>
      )}
      <Mensaje state={archivado ? restauro : archivo} />
    </div>
  )
}
