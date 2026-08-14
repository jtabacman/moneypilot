'use client'

/**
 * Qué hizo el motor con el lote que acaba de entrar.
 *
 * Lo comparten los dos caminos de importación —el fichero y el feed— porque el
 * usuario tiene que leer lo mismo en los dos: si el informe del feed contara
 * las capas y el del fichero no, la conclusión razonable sería que por fichero
 * no se clasifica.
 *
 * Tres decisiones sobre qué se dice:
 *
 *  1. **Se separa lo que se escribió de lo que se propone.** Son dos cosas
 *     distintas y confundirlas es lo peor que puede hacer este informe: si
 *     alguien lee «clasificados 284» y en realidad son sugerencias sin
 *     confirmar, va a dar por bueno un mes que nadie miró.
 *  2. **Cero también se cuenta.** Un hogar nuevo, sin reglas ni historia, sale
 *     de aquí con cero aplicados, y eso hay que decirlo con su motivo — no
 *     esconderlo detrás de un panel que no aparece. Es además la frase que
 *     explica por qué vale la pena escribir la primera regla.
 *  3. **Las rutas sin cuenta son la parte accionable.** «Reconocí 180 y no
 *     tenés esa categoría» es trabajo de un minuto que clasifica 180
 *     movimientos; enterrarlo sería desperdiciar lo único que el motor sabe
 *     hacer sin que nadie le enseñe.
 */

import Link from 'next/link'
import { etiquetaDeCapa, ORDEN_DE_CAPAS } from '@/lib/capas'
import type { ClasificacionDelLote } from '@/lib/clasificar'

export function ResumenDeClasificacion({
  clasificacion,
  cuentaId,
}: {
  clasificacion: ClasificacionDelLote | undefined
  cuentaId?: string | undefined
}) {
  if (clasificacion === undefined) return null

  if (clasificacion.error !== null) {
    return (
      <div className="notice">
        <b>Los movimientos entraron; la clasificación automática no pudo correr.</b> Nada de lo que
        se importó se perdió — la pasada va aparte justamente para esto. Podés lanzarla a mano desde{' '}
        <Link href="/reglas">Reglas</Link>. Motivo: {clasificacion.error}
      </div>
    )
  }

  const { aplicadas, sugeridas, sinPropuesta } = clasificacion
  const mirados = aplicadas + sugeridas + sinPropuesta
  if (mirados === 0) return null

  const capas = ORDEN_DE_CAPAS.map((procedencia) => ({
    procedencia,
    dato: clasificacion.porCapa.find((capa) => capa.procedencia === procedencia),
  })).filter((fila) => fila.dato !== undefined)

  return (
    <div className="notice">
      <b>
        {aplicadas === 0
          ? 'Ninguno se clasificó solo.'
          : `${aplicadas} de ${mirados} se clasificaron solos.`}
      </b>{' '}
      {sugeridas > 0 && (
        <>
          Hay {sugeridas} con una categoría propuesta que <b>no se escribió</b>: la confirmás vos en{' '}
          <Link href={cuentaId === undefined ? '/movimientos' : `/movimientos?cuenta=${cuentaId}`}>
            Movimientos
          </Link>
          .{' '}
        </>
      )}
      {sinPropuesta > 0 && `${sinPropuesta} quedaron sin ninguna propuesta. `}
      {aplicadas === 0 && sugeridas === 0 && (
        <>
          Todavía no hay reglas ni historia de la que aprender.{' '}
          <Link href="/reglas">Escribí la primera regla</Link>: alcanza a lo que acaba de entrar y a
          todo lo que venga.
        </>
      )}
      {capas.length > 0 && (
        <ul className="small">
          {capas.map(({ procedencia, dato }) => (
            <li key={procedencia}>
              <b>{etiquetaDeCapa(procedencia)}</b>: {dato?.propuestas} movimiento(s)
              {dato?.aplicadas === 0
                ? ' — sólo propuestos, los confirmás vos'
                : ` — ${dato?.aplicadas} aplicados`}
            </li>
          ))}
        </ul>
      )}
      {clasificacion.rutasSinCuenta.length > 0 && (
        <div className="small">
          El motor reconoció el comercio de otros movimientos y no encontró dónde ponerlos: te
          faltan estas categorías. <Link href="/estructura">Creálas</Link> y se clasifican solos en
          la próxima pasada.
          <ul>
            {clasificacion.rutasSinCuenta.map((perdida) => (
              <li key={perdida.ruta}>
                <b>{perdida.ruta}</b> — {perdida.movimientos} movimiento(s)
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
