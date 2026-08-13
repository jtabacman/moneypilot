import Link from 'next/link'
import styles from '../landing.module.css'

export const metadata = {
  title: 'Seguridad y datos',
  description:
    'Dónde viven tus datos, cómo se aíslan entre hogares, qué credenciales no te pedimos y qué pasa el día que te querés ir.',
}

export default function Seguridad() {
  return (
    <main>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className="label">Confianza</span>
          <h2>Dónde viven tus datos y quién puede tocarlos</h2>
          <p className="lede">
            Esta página existe porque en este segmento la pregunta se hace en la primera llamada, y
            la respuesta &laquo;usamos cifrado de grado bancario&raquo; no es una respuesta.
          </p>
        </div>

        <div className="grid2">
          <div className="panel">
            <div className="panel-head">
              <h3>Lo que no te pedimos</h3>
            </div>
            <div className="panel-body stack">
              <p className="small">
                <b>Las credenciales de tu banco, nunca.</b> Ni usuario, ni contraseña, ni el código
                del SMS. En el plan Archivo trabajamos con los ficheros que vos exportás. En los
                planes con conexión, la autenticación ocurre en el sitio del banco y nosotros
                recibimos un token de sólo lectura que podés revocar desde tu propia banca.
              </p>
              <p className="small">
                <b>Los números completos de cuenta.</b> El parser los enmascara antes de que entren
                al sistema: guardamos los últimos cuatro dígitos porque hacen falta para
                identificarla, y el resto se descarta en memoria.
              </p>
              <p className="small">
                <b>Capacidad de mover dinero.</b> No la tenemos ni la vamos a pedir.{' '}
                <Link href="/limites">Está en la lista cerrada</Link>.
              </p>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>Dónde está y cómo se aísla</h3>
            </div>
            <div className="panel-body stack">
              <p className="small">
                <b>Frankfurt.</b> La base de datos y las copias viven en la Unión Europea. No hay
                réplica fuera.
              </p>
              <p className="small">
                <b>El aislamiento entre hogares está en la base, no en el código.</b> Cada tabla
                lleva el identificador del hogar y Postgres aplica una política de fila que se
                evalúa en cada consulta. Si mañana un programador se olvida el filtro en una
                consulta, no se filtran datos de otro hogar: la base simplemente no los devuelve.
              </p>
              <p className="small">
                <b>La aplicación se conecta con un rol sin privilegios</b>, degradado dentro de cada
                transacción. La cuenta que sí podría saltarse esas políticas no la usa nunca el
                código que sirve páginas.
              </p>
              <p className="small">
                <b>El identificador de hogar se fija con alcance de transacción</b>, no de sesión.
                Es el detalle que hace que reutilizar una conexión no pueda mezclar dos hogares.
              </p>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>Gobernanza: quién vio qué</h3>
            <span className="label">Es una feature, no un control interno</span>
          </div>
          <div className="panel-body stack">
            <p className="small" style={{ maxWidth: '72ch' }}>
              El titular ve un registro filtrable de quién entró, a qué reporte, cuándo y qué
              exportó. No está pensado para auditores: está pensado para vos. En este segmento el
              miedo real no es el atacante anónimo, es el asistente que se va, el contador que
              cambia de estudio y el ex-cónyuge que todavía tiene acceso.
            </p>
            <ul className="small" style={{ maxWidth: '72ch' }}>
              <li>
                Toda invitación caduca. Contador 90 días renovables, asesor 30, enlace de reporte 7
                con máximo de 30.
              </li>
              <li>
                Revocar a alguien invalida su sesión, anula los enlaces que emitió, cancela los
                envíos programados y te muestra qué exportó en los últimos 90 días.
              </li>
              <li>
                Un co-titular no se revoca unilateralmente. Se ejecuta una separación con corte a
                fecha y exportación completa para las dos partes.
              </li>
            </ul>
          </div>
        </div>

        <div className="grid2">
          <div className="panel">
            <div className="panel-head">
              <h3>El día que te querés ir</h3>
            </div>
            <div className="panel-body stack">
              <p className="small">
                Exportación completa en CSV y XLSX, con el detalle a nivel transacción y los
                adjuntos. No hay formato propietario y no hay que pedirlo por soporte: es un botón.
              </p>
              <p className="small">
                El esquema es Postgres estándar, sin extensiones propietarias. Si algún día querés
                llevarte la base entera a otro proveedor, se puede.
              </p>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>Lo que todavía no está</h3>
              <span className="demo-tag">Pendiente</span>
            </div>
            <div className="panel-body stack">
              <p className="small">
                <b>Segundo factor por aplicación (TOTP).</b> Está en construcción y va a ser
                obligatorio antes del primer cliente real. Decirlo acá es preferible a que lo
                descubras vos.
              </p>
              <p className="small">
                <b>Cifrado a nivel de campo para los adjuntos.</b> Hoy el cifrado es en reposo a
                nivel de volumen.
              </p>
              <p className="small">
                <b>Entrega a beneficiarios por inactividad.</b> Diseñado, no construido.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
