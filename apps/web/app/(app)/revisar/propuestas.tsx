'use client'

import { useActionState } from 'react'
import { decidirPropuesta, type EstadoDePropuesta } from './propuestas-actions'

/** Ver la cabecera de `propuestas-actions.ts`: un módulo de servidor no puede exportarlo. */
const SIN_DECIDIR: EstadoDePropuesta = { ok: false, mensaje: null }

/**
 * Los dos botones de una propuesta de categoría.
 *
 * Se parecen a los de la cola del dedup y no son los mismos, y la diferencia
 * está en los rótulos: acá «Sí, es Supermercado» y «No». Un «Aceptar» a secas
 * obligaría a leer la fila entera para saber qué se está aceptando, y esta
 * pantalla se recorre en diagonal.
 *
 * La categoría propuesta viaja en un campo oculto y no se recalcula al aceptar:
 * lo que se confirma es lo que se vio. Si el motor cambiara de opinión entre el
 * render y el clic —porque otra pestaña acaba de enseñarle algo—, recalcular
 * guardaría una categoría que nadie miró.
 */
export function DecidirPropuesta({
  entryId,
  categoryId,
  categoria,
  procedencia,
  motivo,
  dimensiones,
  bloqueado,
}: {
  entryId: string
  categoryId: string
  categoria: string
  procedencia: string
  motivo: string
  /** Las que traía la propuesta, ya serializadas. Vacío si no traía. */
  dimensiones: string
  /** Por qué este rol no puede decidir, o null si sí puede. */
  bloqueado: string | null
}) {
  const [estado, ejecutar, pendiente] = useActionState(decidirPropuesta, SIN_DECIDIR)
  const apagado = bloqueado !== null
  const motivoId = `sin-permiso-propuesta-${entryId}`

  return (
    <form action={ejecutar} className="stack" style={{ gap: '6px', alignItems: 'flex-end' }}>
      <input type="hidden" name="entryId" value={entryId} />
      <input type="hidden" name="categoryId" value={categoryId} />
      <input type="hidden" name="categoria" value={categoria} />
      <input type="hidden" name="procedencia" value={procedencia} />
      <input type="hidden" name="motivo" value={motivo} />
      <input type="hidden" name="dimensiones" value={dimensiones} />

      <div className="row" style={{ gap: '6px', justifyContent: 'flex-end' }}>
        <button
          type="submit"
          name="decision"
          value="aceptar"
          disabled={apagado || pendiente}
          title={apagado ? undefined : `Mover este movimiento a «${categoria}»`}
          {...(apagado ? { 'aria-describedby': motivoId } : {})}
        >
          Sí, es {categoria}
        </button>
        <button
          type="submit"
          name="decision"
          value="descartar"
          className="quiet"
          disabled={apagado || pendiente}
          title={
            apagado
              ? undefined
              : 'El movimiento se queda sin categorizar y no se te vuelve a ofrecer esta categoría'
          }
          {...(apagado ? { 'aria-describedby': motivoId } : {})}
        >
          No
        </button>
      </div>

      {bloqueado !== null && (
        <span className="small faint" id={motivoId} style={{ maxWidth: '34ch' }}>
          {bloqueado}
        </span>
      )}

      {estado.mensaje !== null && (
        <span
          className={estado.ok ? 'small' : 'small neg'}
          role={estado.ok ? 'status' : 'alert'}
          style={{ maxWidth: '34ch', textAlign: 'left' }}
        >
          {estado.mensaje}
        </span>
      )}
    </form>
  )
}
