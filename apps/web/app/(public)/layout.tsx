import Link from 'next/link'
import type { ReactNode } from 'react'
import { hasSupabaseAuth } from '@/lib/env'
import { currentUser } from '@/lib/supabase/server'
import styles from './public.module.css'

export const dynamic = 'force-dynamic'

const SECTIONS = [
  { href: '/#reportes', label: 'Reportes' },
  { href: '/precios', label: 'Precios' },
  { href: '/limites', label: 'Lo que no hacemos' },
  { href: '/seguridad', label: 'Seguridad' },
  { href: '/contadores', label: 'Contadores' },
] as const

export default async function PublicLayout({ children }: { children: ReactNode }) {
  // Si ya hay sesión, el botón dice "Entrar a tu hogar" y no "Entrar". Es un
  // detalle, pero volver a la portada y que te trate de desconocido después de
  // haber entrado es de las cosas que más rápido restan credibilidad.
  const user = hasSupabaseAuth() ? await currentUser() : null

  return (
    <>
      <header className={styles.masthead}>
        <div className={styles.mastheadInner}>
          <Link href="/" className="brand">
            <b>moneypilot</b>
          </Link>

          <nav className={styles.mastheadNav} aria-label="Secciones del sitio">
            {SECTIONS.map((section) => (
              <Link key={section.href} href={section.href}>
                {section.label}
              </Link>
            ))}
          </nav>

          <div className={styles.mastheadCta}>
            {user === null ? (
              <>
                <Link href="/probar" className="ghost">
                  Probar con un extracto
                </Link>
                <Link href="/entrar" className="btn primary">
                  Entrar
                </Link>
              </>
            ) : (
              <Link href="/hoy" className="btn primary">
                Entrar a tu hogar
              </Link>
            )}
          </div>
        </div>
      </header>

      {children}

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerBrand}>
            <div className="brand">
              <b>moneypilot</b>
            </div>
            <p className="small">
              El sistema de registro de tu vida financiera. No elegimos tus inversiones, no movemos
              tu dinero y no vendemos tus datos.
            </p>
          </div>

          <nav aria-label="Producto">
            <h3 className="label">Producto</h3>
            <Link href="/#reportes">Los cinco reportes</Link>
            <Link href="/#delegar">Accesos delegados</Link>
            <Link href="/#onboarding">Cómo es el alta</Link>
            <Link href="/probar">Probar con un extracto</Link>
          </nav>

          <nav aria-label="Confianza">
            <h3 className="label">Confianza</h3>
            <Link href="/limites">Lo que no hacemos</Link>
            <Link href="/seguridad">Seguridad y datos</Link>
            <Link href="/precios">Precios</Link>
            <Link href="/contadores">Para contadores</Link>
          </nav>
        </div>

        <div className={styles.footerFine}>
          <span>Datos alojados en Frankfurt.</span>
          <span>
            moneypilot no presta asesoramiento financiero ni de inversión, no es entidad de pago y
            no prepara declaraciones fiscales.
          </span>
        </div>
      </footer>
    </>
  )
}
