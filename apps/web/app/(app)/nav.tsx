'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { NavGroup } from '@/lib/nav'

/**
 * Cliente sólo por `usePathname`: marcar la página actual es lo único que
 * necesita saber dónde está el navegador. El resto del shell es servidor.
 */
export function Nav({
  groups,
  counts,
}: {
  groups: readonly NavGroup[]
  /** Contadores por href: pendientes de revisión, alertas abiertas, etc. */
  counts?: Readonly<Record<string, { readonly value: number; readonly alert?: boolean }>>
}) {
  const pathname = usePathname()

  return (
    <nav className="nav" aria-label="Secciones">
      {groups.map((group) => (
        <div key={group.title}>
          <div className="nav-group">{group.title}</div>
          {group.items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
            const count = counts?.[item.href]
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                title={item.blurb}
              >
                <span>{item.label}</span>
                {count !== undefined && count.value > 0 && (
                  <span className={count.alert === true ? 'count alert' : 'count'}>
                    {count.value}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
