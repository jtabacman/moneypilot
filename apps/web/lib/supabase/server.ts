/**
 * Cliente de Supabase para el servidor.
 *
 * Usa la clave **pública**, no la secreta, incluso acá. Es deliberado: con la
 * clave pública, el cliente actúa en nombre del usuario que trae la cookie y
 * Supabase valida su sesión. Con la secreta actuaría como administrador, y un
 * error de programación se convertiría en que cualquiera hace cualquier cosa.
 *
 * La clave secreta sólo aparece donde hace falta operar por encima del
 * usuario, que en este producto es un caso muy acotado.
 */

import 'server-only'

import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { supabaseEnv } from '../env'

export async function supabaseServer(): Promise<SupabaseClient> {
  const env = supabaseEnv()
  const store = await cookies()

  return createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return store.getAll()
      },
      setAll(items) {
        try {
          for (const { name, value, options } of items) {
            store.set(name, value, options)
          }
        } catch {
          // Los Server Components no pueden escribir cookies. No es un error:
          // el middleware ya refrescó la sesión en esta misma petición.
        }
      },
    },
  })
}

export interface AuthUser {
  readonly id: string
  readonly email: string | null
}

/**
 * Usuario autenticado, o null.
 *
 * Usa `getUser()` y no `getSession()` a propósito. `getSession()` devuelve lo
 * que dice la cookie **sin verificarlo contra el servidor de autenticación**:
 * en el servidor eso equivale a confiar en un dato que llegó del navegador.
 * `getUser()` valida el token. Es una llamada de red más y vale la pena.
 */
export async function currentUser(): Promise<AuthUser | null> {
  const supabase = await supabaseServer()
  const { data, error } = await supabase.auth.getUser()
  if (error !== null || data.user === null) return null
  return { id: data.user.id, email: data.user.email ?? null }
}
