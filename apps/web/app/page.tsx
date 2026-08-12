import Link from 'next/link'
import { hasDatabase, hasSupabaseAuth } from '../lib/env'
import { currentSession, type Session } from '../lib/session'
import { signOut } from './entrar/actions'
import { Importer } from './importer'

/**
 * Depende de la cookie de sesión: la misma URL muestra cosas distintas según
 * quién entre. Prerenderizarla serviría a todos el HTML del visitante anónimo.
 */
export const dynamic = 'force-dynamic'

/**
 * La sesión no puede tumbar la página.
 *
 * Si falta la base, si la migración no corrió, si Supabase no responde: la
 * portada se degrada al importador anónimo, que funciona sin nada de eso
 * porque no guarda nada. Es la diferencia entre "no podés entrar" y "la web
 * está caída", y para un producto que todavía se está enseñando, importa.
 */
async function safeSession(): Promise<{ session: Session | null; failure: string | null }> {
  if (!hasSupabaseAuth() || !hasDatabase()) return { session: null, failure: null }
  try {
    return { session: await currentSession(), failure: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[moneypilot] no se pudo resolver la sesión:', message)
    return { session: null, failure: message }
  }
}

export default async function Page() {
  const { session, failure } = await safeSession()

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <b>moneypilot</b>
          <span>{session === null ? 'importar y conciliar' : session.householdName}</span>
        </div>

        {session === null ? (
          hasSupabaseAuth() && (
            <Link href="/entrar" className="ghost">
              Entrar
            </Link>
          )
        ) : (
          <div className="who">
            <span className="email">{session.user.email ?? 'sin correo'}</span>
            <span className="role">{session.role}</span>
            <form action={signOut}>
              <button type="submit" className="ghost">
                Salir
              </button>
            </form>
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

      {failure !== null && (
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
