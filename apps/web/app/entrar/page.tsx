import { redirect } from 'next/navigation'
import { currentUser } from '../../lib/supabase/server'
import { AuthForm } from './form'

export const metadata = { title: 'Entrar — moneypilot' }

/**
 * Nunca prerenderizar: esta pantalla depende de la cookie de sesión, así que
 * un HTML generado en el build sería el de un visitante anónimo servido a
 * todos. Declararlo evita además que el build intente ejecutarla sin entorno.
 */
export const dynamic = 'force-dynamic'

export default async function Page() {
  if ((await currentUser()) !== null) redirect('/')

  return (
    <main className="shell" style={{ maxWidth: 460 }}>
      <div className="brand">
        <b>moneypilot</b>
        <span>entrar</span>
      </div>

      <h1>Tu hogar financiero</h1>
      <p className="lede">
        Una cuenta por hogar. Después vas a poder invitar a tu pareja, a tu contador o a tu
        asistente, cada uno con acceso a lo que le corresponda y con fecha de caducidad.
      </p>

      <AuthForm />

      <p className="foot">
        <b>Qué guardamos:</b> los movimientos que importes y cómo los clasificás. Nada más — no
        pedimos credenciales de tu banco ni nos conectamos a él. Los datos viven en Frankfurt.
        <br />
        <br />
        Cada hogar está aislado en la base de datos, no sólo en el código: aunque una consulta se
        olvide el filtro, Postgres no devuelve los datos de otro.
      </p>
    </main>
  )
}
