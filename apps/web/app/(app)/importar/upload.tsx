'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useId, useRef, useState } from 'react'
import type { ClasificacionDelLote } from '@/lib/clasificar'
import type { WireReport } from '@/lib/pipeline'
import { Report } from '../../(public)/importer'
import { ResumenDeClasificacion } from './clasificacion'
import styles from './page.module.css'

export interface CuentaElegible {
  readonly id: string
  readonly name: string
  readonly currency: string
  readonly institution: string | null
}

interface Respuesta {
  readonly report?: WireReport
  readonly batchId?: string
  readonly guardado?: boolean
  readonly imported?: number
  readonly duplicates?: number
  readonly needsReview?: number
  readonly cuenta?: CuentaElegible
  readonly review?: {
    lineNumber: number
    bookedOn: string
    description: string
  }[]
  readonly transfers?: {
    from: string
    to: string
    on: string
    confidence: string
  }[]
  readonly clasificacion?: ClasificacionDelLote
  readonly error?: string
}

/**
 * La subida con sesión.
 *
 * No comparte el componente entero con el importador anónimo y sí el informe,
 * que es la parte que tiene que verse idéntica. Lo de arriba es distinto a
 * propósito: acá no se elige moneda (la pone la cuenta) ni hay ficheros de
 * ejemplo (escribirían movimientos inventados en el libro de alguien), y en
 * cambio hay algo que allá no puede haber — la cuenta contra la que se asienta.
 */
export function Subida({ cuentas }: { cuentas: readonly CuentaElegible[] }) {
  const router = useRouter()
  const [cuentaId, setCuentaId] = useState(cuentas[0]?.id ?? '')
  const [ocupado, setOcupado] = useState(false)
  const [encima, setEncima] = useState(false)
  const [respuesta, setRespuesta] = useState<Respuesta | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const selectId = useId()

  const cuenta = cuentas.find((candidata) => candidata.id === cuentaId)

  const enviar = useCallback(
    async (file: File) => {
      // Soltar un segundo fichero mientras el primero está subiendo lanzaría
      // dos importaciones a la vez y sólo se vería el informe de la que
      // conteste última: la otra se habría escrito sin que nadie la mire.
      if (ocupado) return
      if (cuentaId === '') {
        setRespuesta({ error: 'Elegí contra qué cuenta se importa antes de soltar el fichero.' })
        return
      }
      setOcupado(true)
      setRespuesta(null)
      const form = new FormData()
      form.set('file', file)
      form.set('cuenta', cuentaId)
      try {
        const response = await fetch('/api/importar', { method: 'POST', body: form })
        const cuerpo = (await response.json()) as Respuesta
        setRespuesta(cuerpo)
        // El historial de abajo y los saldos de las demás pantallas acaban de
        // cambiar: sin esto habría que recargar a mano para ver el lote nuevo.
        if (cuerpo.batchId !== undefined) router.refresh()
      } catch {
        setRespuesta({ error: 'No se pudo contactar al servidor. Probá de nuevo.' })
      } finally {
        setOcupado(false)
        // Sin esto, volver a elegir el mismo fichero no dispara `change`.
        if (inputRef.current !== null) inputRef.current.value = ''
      }
    },
    [cuentaId, ocupado, router],
  )

  return (
    <>
      <section
        aria-label="Subir un extracto bancario al libro"
        className={`drop${encima ? ' hot' : ''}${ocupado ? ' busy' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          setEncima(true)
        }}
        onDragLeave={() => setEncima(false)}
        onDrop={(event) => {
          event.preventDefault()
          setEncima(false)
          const file = event.dataTransfer.files[0]
          if (file) void enviar(file)
        }}
      >
        <h2>{ocupado ? 'Leyendo y guardando…' : 'Arrastrá un extracto acá'}</h2>
        <p>
          OFX · QFX · QIF · CSV · Norma 43 — hasta 4 MB. El formato se detecta por contenido, no por
          extensión.
        </p>

        <div className={styles.controles}>
          <label className={styles.eleccion} htmlFor={selectId}>
            <span className="small faint">Se guarda en</span>
            <select
              id={selectId}
              value={cuentaId}
              disabled={ocupado}
              onChange={(event) => setCuentaId(event.target.value)}
            >
              {cuentas.map((candidata) => (
                <option key={candidata.id} value={candidata.id}>
                  {candidata.institution === null
                    ? candidata.name
                    : `${candidata.institution} · ${candidata.name}`}{' '}
                  ({candidata.currency})
                </option>
              ))}
            </select>
          </label>

          {/* Sin cuenta elegida la ruta contesta 400 y no se guarda nada: mejor
              que el control no se pueda pulsar que un rechazo después de abrir
              el explorador de ficheros. */}
          <button
            type="button"
            className="primary"
            disabled={ocupado || cuenta === undefined}
            onClick={() => inputRef.current?.click()}
          >
            Elegir fichero
          </button>
        </div>

        <p className={styles.moneda}>
          {cuenta === undefined ? (
            'Elegí una cuenta antes de subir el fichero.'
          ) : (
            <>
              El extracto tiene que venir en <b>{cuenta.currency}</b>, que es la moneda de esa
              cuenta. Un movimiento en otra divisa necesita su propia cuenta: convertirlo acá sería
              inventar un tipo de cambio.
            </>
          )}
        </p>

        <input
          ref={inputRef}
          type="file"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void enviar(file)
          }}
        />
      </section>

      {respuesta?.error !== undefined && (
        <div className="error">
          <b>No se importó nada.</b>
          <br />
          {respuesta.error}
        </div>
      )}

      {respuesta?.batchId !== undefined && respuesta.cuenta !== undefined && (
        <Guardado respuesta={respuesta} batchId={respuesta.batchId} cuenta={respuesta.cuenta} />
      )}

      {respuesta?.report !== undefined && (
        <Report
          report={respuesta.report}
          review={respuesta.review ?? []}
          transfers={respuesta.transfers ?? []}
        />
      )}
    </>
  )
}

/** Qué quedó escrito, con el camino para ir a verlo y para deshacerlo. */
function Guardado({
  respuesta,
  batchId,
  cuenta,
}: {
  respuesta: Respuesta
  batchId: string
  cuenta: CuentaElegible
}) {
  const revisar = respuesta.needsReview ?? 0

  if (respuesta.guardado !== true) {
    return (
      <div className="notice">
        <b>Este fichero ya estaba importado.</b> No se duplicó nada: el lote{' '}
        <code>{corto(batchId)}</code> lo trajo antes, con {respuesta.imported ?? 0} movimiento(s).
        Si querés volver a cargarlo, deshacé aquel lote primero — un lote deshecho libera el fichero
        para que se pueda reimportar.
      </div>
    )
  }

  return (
    <div className="verdict ok">
      <b>
        Guardado: {respuesta.imported ?? 0} movimiento(s) entraron al libro de {cuenta.name}.
      </b>{' '}
      {(respuesta.duplicates ?? 0) > 0 && `${respuesta.duplicates} ya estaban y no se duplicaron. `}
      {revisar > 0 && (
        <>
          {revisar} necesitan tu criterio y no se asentaron:{' '}
          <Link href="/revisar">están en Revisar</Link>.{' '}
        </>
      )}
      <Link href={`/movimientos?cuenta=${cuenta.id}`}>Ver los movimientos de la cuenta</Link>. Lote{' '}
      <code>{corto(batchId)}</code>: se deshace entero desde el historial de abajo.
      <ResumenDeClasificacion clasificacion={respuesta.clasificacion} cuentaId={cuenta.id} />
    </div>
  )
}

/** Un uuid entero en una frase no lo lee nadie; los ocho primeros sí. */
function corto(id: string): string {
  return id.slice(0, 8)
}
