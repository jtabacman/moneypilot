import Link from 'next/link'
import styles from './landing.module.css'
import {
  LiquiditySpecimen,
  PropertyCostSpecimen,
  ReconciliationSpecimen,
  RecurringSpecimen,
  WaterfallSpecimen,
} from './specimens'

export const metadata = {
  title: 'moneypilot — el sistema de registro de tu vida financiera',
  description:
    'Todas tus cuentas, países y monedas en un solo lugar, con los reportes que hoy le pedís a tu contador y esperás tres semanas. No recomendamos inversiones.',
}

export default function Landing() {
  return (
    <main>
      {/* ── Portada ──────────────────────────────────────────────────── */}
      <section className={styles.hero}>
        <div className={styles.heroText}>
          <p className={styles.kicker}>Personal CFO · España · EE. UU. · multimoneda</p>
          <h1 className={styles.heroTitle}>
            Todas tus cuentas, países y monedas. Y el cierre que hoy esperás tres semanas.
          </h1>
          <p className={styles.heroLede}>
            Un CFO no elige tus inversiones: ordena el dinero, dice cuánto cuesta cada cosa y arma
            el cierre. Eso es lo que hacemos — <Link href="/limites">y esto es lo que no</Link>, en
            una lista cerrada.
          </p>
          <div className={styles.heroCta}>
            <Link href="/probar" className="btn primary big">
              Probá con un extracto tuyo
            </Link>
            <Link href="/precios" className="btn big">
              Ver precios
            </Link>
          </div>
          <p className={styles.heroFine}>
            El importador funciona ahora mismo, sin cuenta y sin guardar nada. Subís un OFX, QFX,
            QIF, CSV o Norma 43 y te devuelve el informe.
          </p>
        </div>

        <div className={styles.heroProof}>
          <ReconciliationSpecimen />
        </div>
      </section>

      {/* ── El problema ──────────────────────────────────────────────── */}
      <section className={styles.band}>
        <div className={styles.bandInner}>
          <div className={styles.sectionHead}>
            <span className="label">El punto de partida</span>
            <h2>Esto ya lo estás pagando. Lo que no tenés es el dato.</h2>
          </div>

          <div className={styles.figures}>
            <div>
              <b className="money">USD 300–5.000</b>
              <span className="label">al mes, un CPA con paquete personal</span>
              <p className="small">
                Por un cierre que llega en PDF, entre dos y seis semanas después de que el mes
                terminó.
              </p>
            </div>
            <div>
              <b className="money">USD 12.000–48.000</b>
              <span className="label">al año, un servicio de family office</span>
              <p className="small">
                Es el precio real del trabajo que hoy hace una persona con tus extractos y una hoja
                de cálculo.
              </p>
            </div>
            <div>
              <b className="money">2–6 semanas</b>
              <span className="label">de rezago sobre tu propia información</span>
              <p className="small">
                Preguntar &laquo;cuánto me costó la casa este año&raquo; cuesta un correo y días de
                espera.
              </p>
            </div>
          </div>

          <p className={styles.bandNote}>
            No competimos con quien te lleva la contabilidad. Nos sentamos al lado: el contador
            entra gratis, con su propia vista y sin consumir asiento.{' '}
            <Link href="/contadores">Cómo funciona para ellos</Link>.
          </p>
        </div>
      </section>

      {/* ── Las tres funciones ───────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className="label">Cómo funciona</span>
          <h2>Tres cosas, y en este orden</h2>
          <p className="lede">
            El orden importa: no se puede responder bien sobre datos que entraron mal, y no se puede
            delegar lo que no está ordenado.
          </p>
        </div>

        <ol className={styles.steps}>
          <li>
            <span className={styles.stepNum}>1</span>
            <div>
              <h3>Registrar bien</h3>
              <p>
                Extractos de cualquier banco por archivo, PDF o carga manual, normalizados a partida
                doble y multimoneda con el tipo de cambio congelado a la fecha. Cada importación
                termina en un informe que dice qué entró, qué se descartó por duplicado, qué
                necesita criterio humano y si los saldos cuadran.
              </p>
              <p className={styles.stepProof}>
                <b>La prueba:</b> si una cuenta no se puede verificar, el informe lo dice. Nunca
                deriva el saldo de apertura restando movimientos, porque eso daría delta cero
                siempre y convertiría la comprobación en una tautología.
              </p>
            </div>
          </li>
          <li>
            <span className={styles.stepNum}>2</span>
            <div>
              <h3>Responder</h3>
              <p>
                Dimensiones que ningún software del sector modela: propiedad, sociedad, persona,
                proyecto, viaje. Con eso, &laquo;cuánto me cuesta la casa de Madrid, todo
                incluido&raquo; es una pregunta que se contesta sola, con filtros combinables,
                comparación de períodos y detalle hasta la transacción.
              </p>
              <p className={styles.stepProof}>
                <b>La regla:</b> cualquier número que no se pueda abrir hasta la transacción no
                entra al producto.
              </p>
            </div>
          </li>
          <li>
            <span className={styles.stepNum}>3</span>
            <div>
              <h3>Delegar sin exponer</h3>
              <p>
                Tu pareja, tu contador, tu asistente y tu asesor entran cada uno a lo que le
                corresponde, con caducidad obligatoria y registro visible de quién vio qué.
              </p>
              <p className={styles.stepProof}>
                <b>El cambio real:</b> hoy le mandás el extracto entero por correo. Esto es menos
                exposición, no más.
              </p>
            </div>
          </li>
        </ol>
      </section>

      {/* ── Los cinco reportes ───────────────────────────────────────── */}
      <section className={styles.section} id="reportes">
        <div className={styles.sectionHead}>
          <span className="label">Los reportes</span>
          <h2>Cinco preguntas concretas, contestadas en tres segundos</h2>
          <p className="lede">
            No son plantillas de catálogo: son las cinco preguntas por las que este cliente ya está
            pagando a alguien. Cada una es un documento que se exporta en PDF, XLSX con fórmulas
            reales y CSV crudo.
          </p>
        </div>

        <div className={styles.reportGrid}>
          <PropertyCostSpecimen />
          <LiquiditySpecimen />
        </div>
        <div className={styles.reportGrid}>
          <WaterfallSpecimen />
          <RecurringSpecimen />
        </div>

        <div className={styles.fifth}>
          <div>
            <span className="label">Y el quinto</span>
            <h3>Cierre mensual para el contador</h3>
            <p className="small">
              El paquete completo el día 5: semáforo de completitud por cuenta, reconciliación,
              estado de resultados por categoría con comparación, y un bloque de excepciones que
              declara lo que falta —incluidas las transacciones ocultas por política de privacidad,
              con su importe total. Ocultar en silencio rompe la reconciliación y destruye la
              confianza el día que se descubre.
            </p>
          </div>
          <Link href="/probar" className="btn">
            Ver el informe con un extracto tuyo
          </Link>
        </div>
      </section>

      {/* ── Lo que no hacemos ────────────────────────────────────────── */}
      <section className={styles.bandDark} id="limites">
        <div className={styles.bandInner}>
          <div className={styles.sectionHead}>
            <span className="label">El límite</span>
            <h2>Lo que no hacemos, y no vamos a hacer</h2>
            <p className="lede">
              Esta lista es cerrada y está publicada a propósito. Un producto que cobra suscripción
              y además gana con tus decisiones de inversión tiene un conflicto de interés; nosotros
              cobramos una sola cosa.
            </p>
          </div>

          <ul className={styles.nolist}>
            <li>Recomendar activos, rebalancear o proyectar retornos</li>
            <li>Asesoramiento financiero o planificación financiera</li>
            <li>Mover dinero: transferencias, pagos o domiciliaciones</li>
            <li>Preparar o firmar declaraciones fiscales</li>
            <li>Custodiar activos</li>
            <li>Vender tus datos, ni leads de crédito, seguros o gestión patrimonial</li>
          </ul>

          <p className={styles.bandNote}>
            <Link href="/limites">Por qué cada límite está donde está</Link> — con la norma concreta
            detrás de cada uno.
          </p>
        </div>
      </section>

      {/* ── Delegación ───────────────────────────────────────────────── */}
      <section className={styles.section} id="delegar">
        <div className={styles.sectionHead}>
          <span className="label">Accesos</span>
          <h2>Cada persona ve lo suyo, hasta una fecha, y queda registrado</h2>
        </div>

        <div className="panel">
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Rol</th>
                  <th>Alcance por defecto</th>
                  <th>Puede editar</th>
                  <th>Caduca</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <b>Titular</b>
                  </td>
                  <td>Todo</td>
                  <td>Sí</td>
                  <td className="faint">No caduca</td>
                </tr>
                <tr>
                  <td>
                    <b>Pareja</b>
                  </td>
                  <td>Todo menos lo marcado privado</td>
                  <td>Sí</td>
                  <td className="faint">No caduca</td>
                </tr>
                <tr>
                  <td>
                    <b>Contador</b>
                  </td>
                  <td>Entidades asignadas · sin categorías sensibles · con adjuntos fiscales</td>
                  <td>Propone, no escribe</td>
                  <td>90 días renovables</td>
                </tr>
                <tr>
                  <td>
                    <b>Asistente</b>
                  </td>
                  <td>Dimensiones asignadas · ve importes, no saldos</td>
                  <td>Propone, no escribe</td>
                  <td>90 días renovables</td>
                </tr>
                <tr>
                  <td>
                    <b>Asesor</b>
                  </td>
                  <td>Sólo patrimonio agregado · sin transacciones</td>
                  <td>No</td>
                  <td>30 días</td>
                </tr>
                <tr>
                  <td>
                    <b>Invitado por enlace</b>
                  </td>
                  <td>Un reporte exacto, congelado</td>
                  <td>No</td>
                  <td>7 días, máximo 30</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="notes">
            <b>Editar, para el contador y el asistente, significa proponer.</b> La propuesta genera
            un diff que vos aprobás. Nunca escritura directa sobre tu registro.
          </div>
        </div>

        <div className={styles.edgeCases}>
          <div>
            <h4>Cuando alguien se va</h4>
            <p className="small">
              Revocar a un contador invalida su sesión, anula los enlaces de reporte que emitió,
              cancela los envíos programados y te dice qué se llevó en los últimos 90 días.
            </p>
          </div>
          <div>
            <h4>Cuando la pareja se separa</h4>
            <p className="small">
              Un co-titular no se revoca de un click. Se ejecuta una separación con corte a fecha,
              exportación completa para los dos y el histórico compartido congelado en sólo lectura.
            </p>
          </div>
          <div>
            <h4>Cuando no estés</h4>
            <p className="small">
              Entrega a los beneficiarios que designes tras un período de inactividad, con doble
              confirmación. Es la primera pregunta que aparece en este segmento.
            </p>
          </div>
        </div>
      </section>

      {/* ── Onboarding ───────────────────────────────────────────────── */}
      <section className={styles.band} id="onboarding">
        <div className={styles.bandInner}>
          <div className={styles.sectionHead}>
            <span className="label">El alta</span>
            <h2>Tres semanas nuestras, tres horas tuyas</h2>
            <p className="lede">
              El alta la hacemos nosotros. No te dejamos delante de una pantalla vacía a conectar
              cuarenta bancos: eso es exactamente el trabajo que estás comprando.
            </p>
          </div>

          <ol className={styles.timeline}>
            <li>
              <b>Diseño de tu estructura</b>
              <span>
                90 minutos. Nombrás tus propiedades, sociedades, personas y proyectos como los
                nombrás en la vida real. Sale un mapa de dimensiones, no un plan de cuentas.
              </span>
            </li>
            <li>
              <b>Recolección</b>
              <span>Te damos un checklist banco por banco. Una o dos horas tuyas, repartidas.</span>
            </li>
            <li>
              <b>Ingesta de 12 a 24 meses</b>
              <span>
                Lo hacemos nosotros y te devolvemos el informe de reconciliación por cuenta. Este es
                el momento en que se ve si el resto vale algo.
              </span>
            </li>
            <li>
              <b>Categorización asistida</b>
              <span>
                Te preguntamos 15 o 30 decisiones de criterio. &laquo;Esta compra, ¿es casa, oficina
                o hijos?&raquo; Cada regla viene con su impacto: afecta a 342 transacciones.
              </span>
            </li>
            <li>
              <b>Tus tres tableros y tus accesos</b>
              <span>
                Cash flow multimoneda con el efecto FX aparte, costo por propiedad con detalle, y
                recurrentes. Más las invitaciones con alcance y caducidad.
              </span>
            </li>
            <li>
              <b>Primer cierre mensual</b>
              <span>
                Paquete listo para tu contador, y tres hallazgos concretos. Siempre aparecen tres.
              </span>
            </li>
          </ol>
        </div>
      </section>

      {/* ── Precios ──────────────────────────────────────────────────── */}
      <section className={styles.section} id="precios">
        <div className={styles.sectionHead}>
          <span className="label">Precios</span>
          <h2>Suscripción y nada más</h2>
          <p className="lede">
            Sin comisión sobre tu patrimonio, sin producto propio, sin venta de datos. Es la única
            estructura sin conflicto de interés, y por eso el precio es el que es.
          </p>
        </div>

        <div className={styles.plans}>
          <div className={styles.plan}>
            <span className="label">Archivo</span>
            <b className="money">USD 49</b>
            <span className={styles.planPer}>al mes, facturado anual</span>
            <ul>
              <li>1 entidad · 2 colaboradores</li>
              <li>Importación por archivo, PDF y manual</li>
              <li>Motor de reportes completo y multimoneda</li>
              <li className="faint">Sin conexiones bancarias automáticas</li>
            </ul>
            <p className="small faint">Alta autoservicio, sin coste.</p>
          </div>

          <div className={`${styles.plan} ${styles.planFeatured}`}>
            <span className="label">Core</span>
            <b className="money">USD 149</b>
            <span className={styles.planPer}>al mes, facturado anual</span>
            <ul>
              <li>3 entidades · 5 colaboradores con permisos por dimensión</li>
              <li>20 instituciones conectadas y mantenidas</li>
              <li>Cierre mensual autoservicio</li>
              <li>Plan familiar incluido, sin cargo por asiento</li>
            </ul>
            <p className="small">
              <b>Alta USD 1.500</b>, obligatoria. Son 28 horas de trabajo real.
            </p>
          </div>

          <div className={styles.plan}>
            <span className="label">Complex</span>
            <b className="money">USD 349</b>
            <span className={styles.planPer}>al mes, facturado anual</span>
            <ul>
              <li>10 entidades · 10 colaboradores</li>
              <li>60 instituciones</li>
              <li>Enlaces de reporte con caducidad y registro de accesos</li>
              <li>Soporte prioritario</li>
            </ul>
            <p className="small">
              <b>Alta USD 2.500</b>, obligatoria.
            </p>
          </div>
        </div>

        <p className={styles.bandNote}>
          ¿Preferís que lo opere alguien? El servicio de cierre mensual son <b>USD 450 al mes</b>{' '}
          adicionales: una persona revisa las clasificaciones, produce el cierre, reconecta lo que
          se rompe y contesta con 24 horas de SLA. <Link href="/precios">Precios en detalle</Link>.
        </p>
      </section>

      {/* ── Cierre ───────────────────────────────────────────────────── */}
      <section className={styles.closer}>
        <div className={styles.closerInner}>
          <h2>Empezá por la parte que se puede comprobar</h2>
          <p className="lede">
            Subí un extracto tuyo. Sin cuenta, sin guardar nada, sin pedirte las credenciales de tu
            banco. En diez segundos vas a ver exactamente qué leyó, qué descartó y si los saldos
            cuadran al céntimo. Si eso no te convence, el resto tampoco debería.
          </p>
          <div className={styles.heroCta}>
            <Link href="/probar" className="btn primary big">
              Probar ahora
            </Link>
            <Link href="/entrar" className="btn big">
              Crear una cuenta
            </Link>
          </div>
        </div>
      </section>
    </main>
  )
}
