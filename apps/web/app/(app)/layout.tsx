import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { navFor } from '@/lib/nav'
import { resolveSession } from '@/lib/session'
import { signOut } from '../(public)/entrar/actions'
import { Nav } from './nav'

/**
 * Todo lo que cuelga de este layout exige sesión.
 *
 * La comprobación vive acá y no en el middleware a propósito. Un middleware
 * que autoriza concentra el permiso de la aplicación entera en una expresión
 * regular, y el día que alguien añade una ruta que el `matcher` no cubre, esa
 * ruta queda abierta sin que falle nada. Un layout no se puede saltear: si la
 * página está debajo, el layout corrió.
 */
export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: ReactNode }) {
  const state = await resolveSession()

  if (state.kind === 'anonymous') redirect('/entrar')
  if (state.kind === 'expired') redirect('/?acceso=caducado')

  const { session } = state
  const groups = navFor(session.role)

  return (
    <div className="app">
      <aside className="side">
        <Link href="/hoy" className="brand">
          <b>moneypilot</b>
        </Link>

        <Nav groups={groups} />

        <div className="side-foot">
          <div>
            <b style={{ color: 'var(--ink-soft)' }}>{session.householdName}</b>
          </div>
          <div>{session.user.email ?? 'sin correo'}</div>
          <div className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s1)' }}>
            <span className="role">{session.role}</span>
            <form action={signOut}>
              <button type="submit" className="quiet" style={{ padding: '2px 8px' }}>
                Salir
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="main">{children}</div>
    </div>
  )
}
