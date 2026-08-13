'use client'

import { useActionState } from 'react'
import { guardarHogar, type ResultadoAjustes } from './actions'
import { MONEDAS } from './monedas'

const VACIO: ResultadoAjustes = {}

/**
 * Nombre del hogar y moneda de reporte.
 *
 * La moneda va en el mismo formulario que el nombre y no en un control suelto
 * a propósito: cambiarla es una decisión con consecuencias sobre toda la
 * historia cargada, y un desplegable que se aplica al soltarlo invita a
 * probar. Acá hay que pulsar Guardar, y el servidor contesta con el número
 * exacto de movimientos que se caerían del consolidado si el cambio siguiera
 * adelante.
 */
export function FormularioHogar({
  nombre,
  moneda,
  bloqueada,
}: {
  nombre: string
  moneda: string
  /** Hay historia consolidada: la moneda no se puede cambiar y hay que decirlo. */
  bloqueada: boolean
}) {
  const [estado, guardar, pendiente] = useActionState(guardarHogar, VACIO)
  const opciones = MONEDAS.some((item) => item.codigo === moneda)
    ? MONEDAS
    : [{ codigo: moneda, nombre: 'la moneda actual del hogar' }, ...MONEDAS]

  return (
    <form action={guardar} className="stack">
      <div className="grid2">
        <div className="stack" style={{ gap: '6px' }}>
          <label className="label" htmlFor="nombre">
            Nombre del hogar
          </label>
          <input id="nombre" name="nombre" defaultValue={nombre} maxLength={80} required />
          <span className="small faint">
            Sale en el menú lateral y en la cabecera de cada reporte.
          </span>
        </div>

        <div className="stack" style={{ gap: '6px' }}>
          <label className="label" htmlFor="moneda">
            Moneda de reporte
          </label>
          <select id="moneda" name="moneda" defaultValue={moneda}>
            {opciones.map((item) => (
              <option key={item.codigo} value={item.codigo}>
                {item.codigo} · {item.nombre}
              </option>
            ))}
          </select>
          <span className="small faint">
            {bloqueada
              ? 'Con historia ya consolidada, cambiarla se rechaza: la conversión está congelada y no se recalcula.'
              : 'Todavía no hay nada convertido, así que este es el momento de elegirla.'}
          </span>
        </div>
      </div>

      <div className="row">
        <button type="submit" className="primary" disabled={pendiente}>
          {pendiente ? 'Guardando…' : 'Guardar'}
        </button>
      </div>

      {estado.error !== undefined && (
        <div className="error" role="alert">
          {estado.error}
        </div>
      )}
      {estado.aviso !== undefined && (
        <div className="notice" role="status">
          {estado.aviso}
        </div>
      )}
    </form>
  )
}
