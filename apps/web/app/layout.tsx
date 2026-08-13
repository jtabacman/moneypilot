import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { fontClassNames } from './fonts'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'moneypilot — el sistema de registro de tu vida financiera',
    template: '%s — moneypilot',
  },
  description:
    'Todas tus cuentas, países y monedas en un solo lugar, con los reportes que hoy le pedís a tu contador y esperás tres semanas. No elegimos tus inversiones.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={fontClassNames}>
      <body>{children}</body>
    </html>
  )
}
