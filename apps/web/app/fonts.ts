/**
 * Tres tipografías, cada una con un trabajo distinto.
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
 * next/font las descarga en el build y las sirve desde nuestro dominio: sin
 * petición a Google en tiempo de ejecución, sin salto de fuente al cargar.
 */

import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from 'next/font/google'

export const display = Newsreader({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
})

export const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
})

export const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
})

export const fontClassNames = `${display.variable} ${sans.variable} ${mono.variable}`
