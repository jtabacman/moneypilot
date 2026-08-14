/**
 * Lo que se ve mientras la pantalla siguiente se prepara.
 *
 * ── Por qué esto es lo primero que había que arreglar ───────────────────────
 *
 * Medido: entre pulsar un enlace del menú y ver el título nuevo pasan 1.167 ms,
 * con una sola petición de 249 ms en el medio. O sea, casi un segundo que no es
 * base de datos — y, hasta este fichero, **un segundo con la pantalla anterior
 * congelada**, porque no había ni un `loading.tsx` en toda la aplicación.
 *
 * La diferencia no es cosmética. Mil milisegundos con acuse de recibo se leen
 * como «está cargando». Los mismos mil con la pantalla vieja quieta se leen
 * como «no registró mi click», y la gente vuelve a pulsar. Es la mitad de la
 * queja «anda lento entre menús», y cuesta cero milisegundos de servidor.
 *
 * ── Por qué un esqueleto y no una ruedita ───────────────────────────────────
 *
 * Porque el esqueleto dice **qué** está viniendo: una barra de título, unas
 * cifras arriba, una tabla debajo. Eso deja empezar a mirar dónde va a estar lo
 * que se busca antes de que llegue. Una ruedita centrada sólo dice «esperá», y
 * encima se lleva la atención al centro de la pantalla, que es donde no va a
 * aparecer nada.
 *
 * ── Y por qué no imita cada pantalla ────────────────────────────────────────
 *
 * Este esqueleto es el mismo para las trece. Podría haber uno por pantalla, más
 * fiel, y sería peor: trece ficheros que se desincronizan de su página en
 * cuanto alguien mueve un panel, para ganar una fidelidad que dura 250 ms. La
 * forma común —barra, tira de cifras, bloque— es verdadera en todas.
 */

export default function Cargando() {
  return (
    <>
      <header className="app-bar">
        <div className="titles">
          <span className="hueso" style={{ width: '9ch', height: '20px' }} />
          <span className="hueso" style={{ width: '38ch', height: '11px', marginTop: '8px' }} />
        </div>
      </header>

      <div className="page" aria-busy="true" aria-live="polite">
        {/* Para quien no ve la pantalla: el esqueleto es decorativo y el estado
            real lo lleva este texto, que los lectores anuncian al entrar. */}
        <span className="sr-only">Cargando la pantalla…</span>

        <section className="panel">
          <div className="panel-body">
            <div className="huesos-cifras">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="stack" style={{ gap: '10px' }}>
                  <span className="hueso" style={{ width: '11ch', height: '9px' }} />
                  <span className="hueso" style={{ width: '16ch', height: '24px' }} />
                  <span className="hueso" style={{ width: '13ch', height: '9px' }} />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-body stack" style={{ gap: '14px' }}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span key={i} className="hueso" style={{ height: '13px', width: `${92 - i * 7}%` }} />
            ))}
          </div>
        </section>
      </div>
    </>
  )
}
