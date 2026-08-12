'use client'

/**
 * Cliente de Supabase para el navegador.
 *
 * Sólo se usa para autenticación —registro, inicio y cierre de sesión—, nunca
 * para leer datos. Los datos van todos por la API del servidor, que compila la
 * consulta tipada y aplica el aislamiento por hogar.
 *
 * Es la regla que separa este producto de un BaaS: si el navegador pudiera
 * consultar la base directo, habría dos caminos de cálculo y por lo tanto dos
 * definiciones de "gasto". La primera vez que un total no cuadre con el que le
 * mandaste a tu contador, la cuenta está perdida.
 */

import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null = null

export function supabaseBrowser(): SupabaseClient {
  if (cached !== null) return cached
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL']
  const key =
    process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] ??
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']

  if (url === undefined || key === undefined) {
    throw new Error(
      'Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. ' +
        'Las pone la integración de Supabase en Vercel; en local van en .env.local.',
    )
  }

  cached = createBrowserClient(url, key)
  return cached
}
