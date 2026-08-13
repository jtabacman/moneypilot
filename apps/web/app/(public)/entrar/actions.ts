'use server'

import { redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase/server'

export interface AuthResult {
  readonly error?: string
  readonly notice?: string
}

/**
 * Los mensajes de error son deliberadamente iguales para "no existe ese
 * correo" y "la contraseña es incorrecta".
 *
 * Distinguirlos convierte el formulario en un oráculo: cualquiera puede
 * averiguar quién tiene cuenta acá probando direcciones. En un producto donde
 * tener cuenta implica tener patrimonio que administrar, esa lista es
 * exactamente lo que no queremos regalar.
 */
const CREDENTIALS_ERROR = 'El correo o la contraseña no son correctos.'

function readCredentials(form: FormData): { email: string; password: string } | null {
  const email = form.get('email')
  const password = form.get('password')
  if (typeof email !== 'string' || typeof password !== 'string') return null
  const trimmed = email.trim().toLowerCase()
  if (trimmed === '' || password === '') return null
  return { email: trimmed, password }
}

export async function signIn(_prev: AuthResult, form: FormData): Promise<AuthResult> {
  const credentials = readCredentials(form)
  if (credentials === null) return { error: 'Completá el correo y la contraseña.' }

  const supabase = await supabaseServer()
  const { error } = await supabase.auth.signInWithPassword(credentials)

  if (error !== null) {
    if (error.message.toLowerCase().includes('not confirmed')) {
      return {
        error:
          'Todavía no confirmaste el correo. Buscá el mensaje de Supabase en tu bandeja ' +
          '(y en spam) y hacé click en el enlace.',
      }
    }
    return { error: CREDENTIALS_ERROR }
  }

  redirect('/')
}

export async function signUp(_prev: AuthResult, form: FormData): Promise<AuthResult> {
  const credentials = readCredentials(form)
  if (credentials === null) return { error: 'Completá el correo y la contraseña.' }
  if (credentials.password.length < 12) {
    // Doce y no ocho: acá adentro va el detalle financiero de una familia.
    return { error: 'La contraseña necesita al menos 12 caracteres.' }
  }

  const supabase = await supabaseServer()
  const { data, error } = await supabase.auth.signUp(credentials)

  if (error !== null) {
    return { error: error.message }
  }

  // Con confirmación por correo activada, signUp devuelve usuario sin sesión.
  if (data.session === null) {
    return {
      notice:
        'Te mandamos un correo para confirmar la dirección. Hacé click en el enlace y ' +
        'volvé acá para entrar.',
    }
  }

  redirect('/')
}

export async function signOut(): Promise<void> {
  const supabase = await supabaseServer()
  await supabase.auth.signOut()
  redirect('/entrar')
}
