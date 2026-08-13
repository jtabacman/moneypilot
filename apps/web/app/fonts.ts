/**
 * Tres tipografías, cada una con un trabajo distinto, y las tres alojadas por
 * nosotros.
 *
 * **Newsreader** para títulos. Es una serif de periódico: el producto que
 * vendemos es literalmente un informe que alguien imprime y le manda a su
 * contador, y una display geométrica de startup contaría otra historia.
 *
 * **IBM Plex Sans** para la interfaz. Tiene un dibujo algo técnico, de plano
 * más que de folleto, que es el registro correcto para una herramienta de
 * trabajo. Y no es Inter, que hoy es el ruido de fondo de todo el software.
 *
 * **IBM Plex Mono para TODO importe.** No es decoración: en una tabla de
 * dinero las columnas tienen que alinearse dígito con dígito, y una
 * monoespaciada lo garantiza sin depender de que la fuente traiga cifras
 * tabulares. Es la decisión tipográfica que más se nota en uso real.
 *
 * ── Por qué `next/font/local` y no `next/font/google` ──────────────────────
 *
 * Porque `next/font/google` descarga los ficheros **durante el build**, y el
 * día que Google no contesta el despliegue falla entero. No es hipotético: nos
 * pasó, y el build de producción se cayó con un error de webpack en mitad de
 * la noche por una petición a fonts.gstatic.com.
 *
 * Los cinco ficheros están en app/fonts/ y son sólo el subconjunto latino:
 * 340 kB en total. Se regeneran con el script scratchpad/fetch-fonts.mjs, a
 * mano y sólo cuando cambie la tipografía. Un build que no necesita red es un
 * build que no se puede caer por la red de otro.
 */

import localFont from 'next/font/local'

export const display = localFont({
  src: [
    // Variable de verdad: un solo fichero cubre de 400 a 600.
    { path: './fonts/newsreader-normal.woff2', weight: '400 600', style: 'normal' },
    { path: './fonts/newsreader-italic.woff2', weight: '400 600', style: 'italic' },
  ],
  variable: '--font-display',
  display: 'swap',
  // La métrica de reserva evita el salto de maquetación mientras carga.
  fallback: ['Iowan Old Style', 'Charter', 'Georgia', 'serif'],
})

export const sans = localFont({
  src: [{ path: './fonts/plex-sans-normal.woff2', weight: '400 600', style: 'normal' }],
  variable: '--font-sans',
  display: 'swap',
  fallback: ['Segoe UI', 'system-ui', 'sans-serif'],
})

export const mono = localFont({
  src: [
    { path: './fonts/plex-mono-normal-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/plex-mono-normal-500.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-mono',
  display: 'swap',
  fallback: ['ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
})

export const fontClassNames = `${display.variable} ${sans.variable} ${mono.variable}`
