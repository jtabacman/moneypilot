import Link from 'next/link'
import styles from '../landing.module.css'

export const metadata = {
  title: 'Precios',
  description:
    'Archivo USD 49/mes, Core USD 149/mes y Complex USD 349/mes, facturación anual. Alta obligatoria en los planes con conexiones. Sin comisión sobre patrimonio.',
}

export default function Precios() {
  return (
    <main>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className="label">Precios</span>
          <h2>Lo que cuesta, y por qué cuesta eso</h2>
          <p className="lede">
            Facturación anual, sin opción mensual, con 21 días de prueba. No es una preferencia
            comercial: la retención a doce meses de un plan anual y la de uno mensual no se parecen,
            y un producto que se abandona a los tres meses no le sirve a nadie.
          </p>
        </div>

        <div className={styles.plans}>
          <div className={styles.plan}>
            <span className="label">Archivo</span>
            <b className="money">USD 49</b>
            <span className={styles.planPer}>al mes · USD 588 al año</span>
            <ul>
              <li>1 entidad</li>
              <li>2 colaboradores</li>
              <li>Importación por archivo, PDF y manual</li>
              <li>Motor de reportes completo</li>
              <li>Multimoneda con FX congelado a la fecha</li>
              <li>Informe de reconciliación en cada importación</li>
              <li className="faint">Sin conexiones bancarias automáticas</li>
            </ul>
            <p className="small">
              Alta autoservicio guiada, <b>sin coste</b>.
            </p>
          </div>

          <div className={`${styles.plan} ${styles.planFeatured}`}>
            <span className="label">Core · el habitual</span>
            <b className="money">USD 149</b>
            <span className={styles.planPer}>al mes · USD 1.788 al año</span>
            <ul>
              <li>3 entidades</li>
              <li>5 colaboradores con permisos por dimensión</li>
              <li>20 instituciones conectadas y mantenidas</li>
              <li>Cierre mensual autoservicio</li>
              <li>Accesos delegados con caducidad y registro</li>
              <li>Plan familiar incluido, sin cargo por asiento</li>
              <li>El rol contador es gratis y no consume asiento</li>
            </ul>
            <p className="small">
              <b>Alta USD 1.500</b>, obligatoria.
            </p>
          </div>

          <div className={styles.plan}>
            <span className="label">Complex</span>
            <b className="money">USD 349</b>
            <span className={styles.planPer}>al mes · USD 4.188 al año</span>
            <ul>
              <li>10 entidades</li>
              <li>10 colaboradores</li>
              <li>60 instituciones</li>
              <li>Enlaces de reporte con caducidad y revocables</li>
              <li>Registro de accesos por enlace</li>
              <li>Soporte prioritario</li>
            </ul>
            <p className="small">
              <b>Alta USD 2.500</b>, obligatoria.
            </p>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>Cierre mensual operado</h3>
            <span className="label">Add-on sobre Core o Complex</span>
          </div>
          <div className="panel-body spread">
            <p className="small" style={{ maxWidth: '58ch' }}>
              Una persona del equipo revisa las clasificaciones del mes, produce el cierre,
              reconecta lo que se rompió y contesta preguntas ad-hoc con 24 horas de SLA. Es el
              mismo trabajo que hoy hace tu bookkeeper, con el dato ya ordenado debajo.
            </p>
            <div style={{ textAlign: 'right' }}>
              <b className="money" style={{ fontSize: 'var(--t-h2)' }}>
                +USD 450
              </b>
              <div className="small faint">al mes</div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>Extras</h3>
          </div>
          <div className="scroll">
            <table>
              <tbody>
                <tr>
                  <td>Institución adicional sobre el cupo del plan</td>
                  <td className="r money">+USD 5 / mes</td>
                </tr>
                <tr>
                  <td>Entidad legal adicional</td>
                  <td className="r money">+USD 25 / mes</td>
                </tr>
                <tr>
                  <td>Rol contador</td>
                  <td className="r money">USD 0</td>
                </tr>
                <tr>
                  <td>Miembros del hogar con login propio</td>
                  <td className="r money">USD 0</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="prose">
          <h3>Tres decisiones de precio que conviene explicar</h3>

          <p>
            <b>El contador no paga y no consume asiento.</b> Es la decisión más importante de toda
            la tabla. Cobrarle un asiento a la persona que puede recomendar el producto a otros diez
            clientes lo convierte en un bloqueador; dejarlo entrar gratis lo convierte en canal.
          </p>

          <p>
            <b>Se cobra por entidades y colaboradores, no por instituciones.</b> Las instituciones
            son lo que nos cuesta —cada conexión bancaria es una suscripción mensual que pagamos
            nosotros—, pero lo que te da valor son las entidades que administrás y las personas a
            las que les delegás. Aun así las instituciones tienen cupo: ilimitado significaría que
            el peor cliente subvenciona al resto.
          </p>

          <p>
            <b>El alta no es un cargo de gestión: son 28 horas de trabajo.</b> Mapear tu estructura,
            recolectar los extractos de veinte instituciones, importar dos años de histórico,
            reconciliarlo cuenta por cuenta y proponerte las reglas de clasificación no se
            automatiza todavía. Cobrar USD 250 por eso sería vender un alta liviana, que es
            exactamente lo contrario de lo que estás comprando.
          </p>

          <h3>Qué justifica cada escalón</h3>
          <ul>
            <li>
              <b>USD 49.</b> Importación impecable con informe de reconciliación y motor de reportes
              completo. El punto de comparación es tu propio tiempo en Excel.
            </li>
            <li>
              <b>USD 149.</b> Lo anterior más veinte conexiones mantenidas y accesos delegados. El
              punto de comparación son los USD 300 a 2.000 al mes de un bookkeeper.
            </li>
            <li>
              <b>USD 349.</b> Multi-entidad y enlaces compartidos con caducidad. El punto de
              comparación son las plataformas de family office, que empiezan en cinco cifras al año.
            </li>
            <li>
              <b>+USD 450.</b> Un humano en el circuito. El punto de comparación son los USD 12.000
              a 48.000 al año de un servicio de bill pay y bookkeeping familiar.
            </li>
          </ul>
        </div>

        <div className={styles.fifth}>
          <div>
            <h3>Antes de cobrarte hay una llamada de calificación</h3>
            <p className="small">
              Media hora. Si tenés menos de doce cuentas, un solo país y ninguna estructura, este
              producto es caro para vos y te lo vamos a decir. La lista de a quién no le vendemos
              está tan pensada como la de precios.
            </p>
          </div>
          <Link href="/probar" className="btn primary">
            Probar con un extracto
          </Link>
        </div>
      </section>
    </main>
  )
}
