'use client'

/**
 * Cuando una pantalla se cae.
 *
 * Hasta ahora no había ninguno en toda la aplicación, así que un fallo en
 * cualquier página se comía la aplicación entera hasta el `error.tsx` raíz: se
 * perdía el menú, se perdía dónde estabas, y lo que quedaba era una pantalla en
 * blanco. Con éste, el armazón sigue en pie y sólo falla el contenido — se
 * puede reintentar sin volver a entrar.
 *
 * ── El mensaje dice qué pasó, no «algo salió mal» ───────────────────────────
 *
 * Este producto se niega en todas partes a enseñar un número sin poder decir de
 * dónde salió; un error no es distinto. Se enseña el mensaje real y el `digest`
 * —que es lo que permite encontrar la traza en el servidor— porque quien está
 * mirando una pantalla rota necesita poder contar qué vio.
 *
 * Lo que NO se enseña es la pila: puede llevar rutas del servidor y nombres de
 * columna, y eso es de la traza, no de la pantalla.
 */

import { useEffect } from 'react'

export default function ErrorDePantalla({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // A la consola del navegador además del servidor: quien está probando en
    // local no siempre tiene la terminal delante.
    console.error('[moneypilot] la pantalla falló', error)
  }, [error])

  return (
    <>
      <header className="app-bar">
        <div className="titles">
          <h1>Esta pantalla no se pudo cargar</h1>
          <p>El resto de la aplicación sigue funcionando.</p>
        </div>
      </header>

      <div className="page">
        <section className="panel">
          <div className="panel-body stack">
            <p className="lede">
              Algo falló al preparar esta pantalla. <b>No se perdió ni se cambió ningún dato</b>:
              las pantallas sólo leen, y lo que escribe va en una transacción que o entra entera o
              no entra.
            </p>
            <p className="small">{error.message}</p>
            {error.digest !== undefined && (
              <p className="small faint">
                Referencia para buscarlo en el servidor: <code>{error.digest}</code>
              </p>
            )}
            <div className="row">
              <button type="button" className="primary" onClick={reset}>
                Reintentar
              </button>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}
