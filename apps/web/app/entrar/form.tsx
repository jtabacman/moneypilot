'use client'

import { useActionState, useState } from 'react'
import { type AuthResult, signIn, signUp } from './actions'

const EMPTY: AuthResult = {}

export function AuthForm() {
  const [mode, setMode] = useState<'entrar' | 'crear'>('entrar')
  const action = mode === 'entrar' ? signIn : signUp
  const [state, submit, pending] = useActionState(action, EMPTY)

  return (
    <>
      <div className="tabs" role="tablist" aria-label="Entrar o crear cuenta">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'entrar'}
          onClick={() => setMode('entrar')}
        >
          Entrar
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'crear'}
          onClick={() => setMode('crear')}
        >
          Crear cuenta
        </button>
      </div>

      <form action={submit} className="auth-form">
        <label htmlFor="email">Correo</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="vos@ejemplo.com"
        />

        <label htmlFor="password">
          Contraseña
          {mode === 'crear' && <span className="hint-inline"> · mínimo 12 caracteres</span>}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === 'crear' ? 'new-password' : 'current-password'}
          required
          minLength={mode === 'crear' ? 12 : undefined}
        />

        <button type="submit" className="primary" disabled={pending}>
          {pending ? 'Un momento…' : mode === 'entrar' ? 'Entrar' : 'Crear cuenta'}
        </button>
      </form>

      {state.error !== undefined && (
        <div className="error" role="alert">
          {state.error}
        </div>
      )}
      {state.notice !== undefined && (
        <div className="notice" role="status">
          {state.notice}
        </div>
      )}
    </>
  )
}
