import Link from 'next/link'
import { hasDatabase, hasSupabaseAuth } from '../lib/env'
import { resolveSession, type SessionState } from '../lib/session'
import { signOut } from './entrar/actions'
import { Importer } from './importer'

/**
 * Depende de la cookie de sesión: la misma URL muestra cosas distintas según
 * quién entre. Prerenderizarla serviría a todos el HTML del visitante anónimo.
 */
export const dynamic = 'force-dynamic'

const ANONYMOUS: SessionState = { kind: 'anonymous' }

/**
 * La sesión no puede tumbar la página.
 *
 * Si falta la base, si la migración no corrió, si Supabase no responde: la
 * portada se degrada al importador anónimo, que funciona sin nada de eso
 * porque no guarda nada. Es la diferencia entre "no podés entrar" y "la web
 * está caída", y para un producto que todavía se está enseñando, importa.
 */
async function safeSession(): Promise<{ state: SessionState; failure: boolean }> {
  if (!hasSupabaseAuth() || !hasDatabase()) return { state: ANONYMOUS, failure: false }
  try {
    return { state: await resolveSession(), failure: false }
  } catch (error) {
    console.error(
      '[moneypilot] no se pudo resolver la sesión:',
      error instanceof Error ? error.message : String(error),
    )
    return { state: ANONYMOUS, failure: true }
  }
}

export default async function Page() {
  const { state, failure } = await safeSession()
  const session = state.kind === 'active' ? state.session : null

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <b>moneypilot</b>
          <span>{session === null ? 'importar y conciliar' : session.householdName}</span>
        </div>

        {session === null ? (
          state.kind === 'expired' ? (
            <SignOutButton label="Salir" />
          ) : (
            hasSupabaseAuth() && (
              <Link href="/entrar" className="ghost">
                Entrar
              </Link>
            )
          )
        ) : (
          <div className="who">
            <span className="email">{session.user.email ?? 'sin correo'}</span>
            <span className="role">{session.role}</span>
            <SignOutButton label="Salir" />
          </div>
        )}
      </header>

      <h1>Mirá qué entró antes de importar nada</h1>
      <p className="lede">
        Subí un extracto y el motor te dice exactamente qué leyó, qué descartó por duplicado, qué
        necesita criterio humano y si los saldos cuadran al céntimo.{' '}
        {session === null
          ? 'Nada se guarda: esto sólo lee el fichero y te devuelve el informe.'
          : 'Todavía nada se guarda: por ahora el informe se calcula y se descarta.'}
      </p>

      {state.kind === 'expired' && (
        <div className="banner" role="status">
          <b>Tu acceso a este hogar caducó.</b> Entraste bien, pero la invitación tenía fecha de
          fin. Pedile al titular que la renueve. Mientras tanto podés usar el importador, que no
          guarda nada.
        </div>
      )}

      {failure && (
        <div className="banner" role="status">
          <b>Estás viendo la versión sin cuenta.</b> No se pudo resolver la sesión contra la base de
          datos. El importador funciona igual porque no necesita guardar nada.
        </div>
      )}

      <Importer />

      <p className="foot">
        Formatos que entiende: <b>OFX 1.x y 2.x</b>, <b>QFX</b>, <b>QIF</b> (Quicken y Microsoft
        Money), <b>CSV</b> con detección de esquema y <b>Norma 43</b> española. El formato se
        detecta por contenido, no por extensión.
        <br />
        <br />
        Sobre los saldos: Norma 43 trae apertura y cierre, así que la aritmética se verifica con el
        fichero solo. <b>OFX y QIF no traen saldo de apertura y no lo inventamos</b> — derivarlo
        restando los movimientos daría delta cero siempre y convertiría la comprobación en una
        tautología. Cuando no se puede verificar, se dice.
      </p>
    </main>
  )
}

function SignOutButton({ label }: { label: string }) {
  return (
    <form action={signOut}>
      <button type="submit" className="ghost">
        {label}
      </button>
    </form>
  )
}
