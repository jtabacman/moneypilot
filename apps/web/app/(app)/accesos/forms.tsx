'use client'

import { useActionState, useState } from 'react'
import { gestionarAcceso, type ResultadoAcceso } from './actions'

const VACIO: ResultadoAcceso = {}

/**
 * Revocar y renovar, en el mismo formulario.
 *
 * Los dos botones comparten `name="accion"` y se distinguen por su `value`:
 * el navegador manda el del botón pulsado, así que una sola acción de
 * servidor cubre las dos operaciones y el mensaje de vuelta aparece pegado a
 * la fila que lo provocó, no en una franja arriba del todo donde no se sabe
 * a quién se refiere.
 */
export function AccionesAcceso({
  id,
  rol,
  revocada,
  soyYo,
}: {
  id: string
  rol: string
  revocada: boolean
  soyYo: boolean
}) {
  const [estado, ejecutar, pendiente] = useActionState(gestionarAcceso, VACIO)
  const externo = rol === 'contador' || rol === 'asistente' || rol === 'asesor'

  // Nadie se gobierna a sí mismo. Un botón de revocar junto al propio nombre
  // se lee como "dejar el hogar" y no es lo que hace: dejaría el hogar sin
  // titular y a esta persona sin puerta de vuelta.
  if (soyYo) return <span className="small faint">tu propio acceso</span>

  return (
    <form action={ejecutar} className="stack" style={{ gap: '6px' }}>
      <input type="hidden" name="id" value={id} />
      <div className="row" style={{ gap: '6px', justifyContent: 'flex-end' }}>
        {externo && !revocada && (
          <button
            type="submit"
            name="accion"
            value="renovar"
            className="quiet"
            disabled={pendiente}
          >
            Renovar
          </button>
        )}
        {!revocada && (
          <button
            type="submit"
            name="accion"
            value="revocar"
            className="quiet"
            disabled={pendiente}
          >
            Revocar
          </button>
        )}
      </div>
      {estado.error !== undefined && (
        <span className="small neg" role="alert">
          {estado.error}
        </span>
      )}
      {estado.aviso !== undefined && (
        <span className="small" role="status">
          {estado.aviso}
        </span>
      )}
    </form>
  )
}

/* ── Invitar ─────────────────────────────────────────────────────────────── */

interface Preset {
  readonly rol: 'contador' | 'asistente' | 'asesor'
  readonly titulo: string
  readonly dias: number
  readonly alcance: string
}

/**
 * Los tres presets de un click de B6.
 *
 * El riesgo declarado del permiso por dimensión es acabar en una pantalla de
 * configuración que nadie completa. Por eso lo que se elige acá es una
 * persona y un perfil, y el alcance fino queda escondido detrás — todavía sin
 * construir, que es distinto de "no existe".
 *
 * Los días repiten la ventana de `VENTANA` en actions.ts y tienen que seguir
 * cuadrando: aquel fichero es 'use server' y sólo puede exportar funciones
 * async, así que la constante no se puede compartir. Si cambia una, cambian
 * las dos.
 */
const PRESETS: readonly Preset[] = [
  {
    rol: 'contador',
    titulo: 'Contador',
    dias: 90,
    alcance:
      'Entidades asignadas, sin categorías sensibles, con adjuntos fiscales. Puede proponer, no escribir.',
  },
  {
    rol: 'asistente',
    titulo: 'Asistente',
    dias: 90,
    alcance:
      'Dimensiones asignadas (viajes, suscripciones, proveedores). Ve importes, no ve saldos. Sin exportar.',
  },
  {
    rol: 'asesor',
    titulo: 'Asesor',
    dias: 30,
    alcance: 'Sólo patrimonio agregado y el reporte de estructura. Sin acceso a transacciones.',
  },
]

/**
 * Los tres perfiles, y por qué el botón está apagado.
 *
 * Antes esto era un formulario que se podía enviar y contestaba siempre con
 * el mismo error. Un control que acepta el gesto y no puede cumplirlo nunca
 * es peor que uno apagado: el usuario ya escribió la dirección, ya pulsó, y
 * la explicación llega después del esfuerzo. El motivo va **junto** al botón
 * y enlazado con `aria-describedby`, para que quien lo lea con un lector de
 * pantalla se entere de por qué está deshabilitado antes de intentarlo.
 */
export function FormularioInvitacion() {
  const [rol, setRol] = useState<Preset['rol']>('contador')
  const elegido = PRESETS.find((preset) => preset.rol === rol) ?? PRESETS[0]

  return (
    <div className="stack">
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label">Perfil de acceso</legend>
        <div className="chips" style={{ marginTop: '6px' }}>
          {PRESETS.map((preset) => (
            <button
              key={preset.rol}
              type="button"
              className="chip"
              aria-pressed={preset.rol === rol}
              onClick={() => setRol(preset.rol)}
            >
              {preset.titulo} · {preset.dias} días
            </button>
          ))}
        </div>
      </fieldset>

      {elegido !== undefined && <p className="small faint">{elegido.alcance}</p>}

      <div className="row">
        <label className="label" htmlFor="email">
          Correo
        </label>
        <input
          id="email"
          type="email"
          disabled
          placeholder="contador@estudio.com"
          aria-describedby="invitar-motivo"
          style={{ flex: '1 1 240px' }}
        />
        <button type="button" disabled aria-describedby="invitar-motivo">
          Invitar
        </button>
      </div>

      <p className="small" id="invitar-motivo">
        <b>Apagado a propósito, y no por poco.</b> Dar de alta a alguien como {rol} con caducidad a{' '}
        {elegido?.dias ?? 30} días exige dos cosas que esta pantalla no puede hacer: crear el
        usuario en Supabase Auth, que necesita la clave secreta que el código que sirve páginas
        deliberadamente no carga, e insertar su fila en <code>membership</code>, que la policy{' '}
        <code>membership_own</code> rechaza porque la fila sería de otra persona.
      </p>
    </div>
  )
}
