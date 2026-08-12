/**
 * Refresco de sesión en cada petición.
 *
 * Los tokens de Supabase caducan a la hora. Sin este middleware, un Server
 * Component se encuentra con un token vencido y trata al usuario como
 * anónimo — que se ve como "me deslogueó solo" y es de los bugs más
 * frustrantes de reproducir, porque depende de cuánto tiempo pasó.
 *
 * El middleware sólo refresca. Quién puede ver qué lo decide cada página con
 * `currentUser()`, que valida el token contra el servidor de autenticación.
 * Un middleware que además autoriza es un único punto donde un `matcher` mal
 * escrito abre la aplicación entera.
 */

import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.next({ request })

  const url = process.env['NEXT_PUBLIC_SUPABASE_URL']
  const key =
    process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] ??
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']

  // Sin configurar, la aplicación sigue sirviendo la parte que no necesita
  // sesión (el importador en modo vista previa) en vez de romperse entera.
  if (url === undefined || key === undefined) return response

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(items) {
        for (const { name, value } of items) request.cookies.set(name, value)
        for (const { name, value, options } of items) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  await supabase.auth.getUser()
  return response
}

export const config = {
  matcher: [
    // Todo menos estáticos y ficheros de ejemplo: refrescar la sesión en la
    // descarga de un .n43 es gasto sin ninguna contrapartida.
    '/((?!_next/static|_next/image|favicon.ico|samples/).*)',
  ],
}
