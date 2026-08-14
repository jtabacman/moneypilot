'use client'

/**
 * Una explicación que se enseña las primeras veces y después se pliega.
 *
 * ── El problema que resuelve ────────────────────────────────────────────────
 *
 * Este producto explica lo que hace, y esa negativa a enseñar un número sin
 * poder decir de dónde salió es su tesis. Pero la explicación estaba escrita
 * como si cada visita fuera la primera: en /revisar, un ensayo de tres párrafos
 * sobre las dos pasadas de deduplicación ocupaba 255 px **encima** de la cola de
 * trabajo, todos los días. Medido: la primera fila accionable arrancaba en
 * y=757 de un viewport de 900.
 *
 * Plegarlo siempre habría resuelto la densidad y roto la tesis — quien entra por
 * primera vez no abriría nunca el desplegable y no entendería por qué el motor
 * no decide solo. Así que se enseña **las tres primeras veces** y a partir de
 * ahí se pliega, con el resumen siempre visible para reabrirlo.
 *
 * ── Por qué el resumen es una pregunta ──────────────────────────────────────
 *
 * «Por qué está esto acá» plegado no invita a abrirlo; «¿por qué el motor no
 * decide solo?» sí. Un desplegable cuyo título no dice qué hay dentro es texto
 * escondido, y eso sí sería romper la regla.
 *
 * ── Dónde vive la cuenta ────────────────────────────────────────────────────
 *
 * En `localStorage`, por dispositivo y por clave. No en la base: guardarlo en el
 * hogar costaría una columna, una migración y una escritura por render, para un
 * dato cuyo peor fallo posible es que una explicación se vuelva a enseñar tres
 * veces en un portátil nuevo. Si algún día molesta, se sube sin rehacer nada.
 *
 * El primer render es **siempre abierto**, en el servidor y en el cliente, y se
 * pliega después de montar. Es deliberado: leer `localStorage` durante el render
 * daría HTML distinto en servidor y cliente, que es un error de hidratación de
 * los que rompen la página entera. Y si el guion no llega a correr —o está
 * apagado—, lo que queda es la explicación visible, que es el fallo correcto.
 */

import { type ReactNode, useEffect, useState } from 'react'

/** Cuántas veces se enseña abierto antes de plegarse. */
const VECES = 3

const PREFIJO = 'moneypilot.explicacion.'

export function Plegable({
  clave,
  pregunta,
  children,
}: {
  /** Identifica la explicación. Estable: si cambia, la cuenta empieza de cero. */
  clave: string
  /** El resumen visible. Escribilo como la pregunta que el texto contesta. */
  pregunta: string
  children: ReactNode
}) {
  const [abierto, setAbierto] = useState(true)

  useEffect(() => {
    const id = `${PREFIJO}${clave}`
    let vistas = 0
    try {
      vistas = Number.parseInt(window.localStorage.getItem(id) ?? '0', 10)
      if (!Number.isFinite(vistas) || vistas < 0) vistas = 0
      // Se cuenta la visita aunque después se pliegue: lo que se cuenta es
      // haber tenido la explicación delante, no haberla leído.
      window.localStorage.setItem(id, String(vistas + 1))
    } catch {
      // Modo privado, almacenamiento lleno o bloqueado por política: la
      // explicación se queda visible. Es el fallo correcto.
      return
    }
    if (vistas >= VECES) setAbierto(false)
  }, [clave])

  return (
    <details className="plegable" open={abierto}>
      <summary>{pregunta}</summary>
      <div className="plegable-cuerpo">{children}</div>
    </details>
  )
}
