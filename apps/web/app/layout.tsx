import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: 'moneypilot — importar y conciliar',
  description:
    'Subí un extracto bancario y mirá exactamente qué entró, qué se descartó y si los saldos cuadran, antes de importar nada.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}
