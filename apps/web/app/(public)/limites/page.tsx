import Link from 'next/link'
import styles from '../landing.module.css'

export const metadata = {
  title: 'Lo que no hacemos',
  description:
    'La lista cerrada de lo que moneypilot no hace, con la norma concreta detrás de cada límite. No recomendamos inversiones, no movemos dinero y no vendemos tus datos.',
}

interface Limit {
  readonly what: string
  readonly why: string
  readonly rule: string
}

const LIMITS: readonly Limit[] = [
  {
    what: 'Recomendar activos, rebalancear carteras o proyectar retornos',
    why: 'Aconsejar sobre valores a cambio de una remuneración es, literalmente, la definición legal de asesor de inversiones. No es una zona gris: es el tercer elemento del test.',
    rule: 'Investment Advisers Act, §202(a)(11)',
  },
  {
    what: 'Asesoramiento financiero o planificación financiera',
    why: 'En España es actividad reservada. En varios estados de EE. UU. hay que registrarse aunque sólo se haga planificación, sin tocar carteras.',
    rule: 'CNMV · registro estatal de financial planners',
  },
  {
    what: 'Mover dinero: transferencias, pagos, domiciliaciones',
    why: 'En el momento en que el dinero pasa por nosotros dejamos de ser un producto de datos y pasamos a ser una entidad de pago, con el régimen que eso arrastra. Y no hace falta para responder ninguna de las preguntas del producto.',
    rule: 'PSD2 · servicios de pago',
  },
  {
    what: 'Preparar o firmar declaraciones fiscales',
    why: 'Producimos el paquete que tu contador usa para hacerlo. No lo sustituimos.',
    rule: 'PTIN y Circular 230 en EE. UU. · §5 StBerG en Alemania',
  },
  {
    what: 'Custodiar activos',
    why: 'Leemos saldos y movimientos. Nunca tenemos la llave de nada.',
    rule: '—',
  },
  {
    what: 'Vender leads de crédito, seguros o gestión patrimonial',
    why: 'Es el modelo de los agregadores gratuitos, y es exactamente lo que este cliente ya desconfía. Si el producto gana dinero cuando te vende algo, el dashboard deja de ser neutral.',
    rule: 'Decisión de negocio, no legal',
  },
]

export default function Limites() {
  return (
    <main>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className="label">El límite</span>
          <h2>Lo que no hacemos</h2>
          <p className="lede">
            Esta lista es cerrada. No es una etapa del roadmap ni una limitación temporal: es el
            perímetro del producto, y está publicado para que puedas exigírnoslo.
          </p>
        </div>

        <div className="panel">
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '30%' }}>No hacemos</th>
                  <th>Por qué</th>
                  <th style={{ width: '22%' }}>La norma</th>
                </tr>
              </thead>
              <tbody>
                {LIMITS.map((limit) => (
                  <tr key={limit.what}>
                    <td>
                      <b>{limit.what}</b>
                    </td>
                    <td>{limit.why}</td>
                    <td className="faint">{limit.rule}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="prose">
          <h3>Por qué el límite es una ventaja y no una carencia</h3>

          <p>
            <b>No monetizamos tu plata.</b> Cobramos una suscripción y nada más: sin comisión sobre
            patrimonio, sin producto propio, sin acuerdos de distribución. Es la única estructura en
            la que nuestro incentivo y el tuyo apuntan al mismo lado. Los paneles gratuitos de
            patrimonio existen porque son la puerta de entrada a un servicio de gestión que sí
            cobra; el nuestro no tiene puerta detrás.
          </p>

          <p>
            <b>El hueco está donde nadie mira.</b> Hay más de cien productos de family office
            repartidos en trece categorías, y ninguna de ellas es gastos. Las plataformas de
            reporting patrimonial se definen a sí mismas como reporting y no como libro mayor. Es
            una invitación a sentarse al lado, no enfrente.
          </p>

          <p>
            <b>Foco.</b> El día que el roadmap admita &laquo;análisis de cartera&raquo;, el motor de
            reportes deja de ser lo que nos distingue y el producto se convierte en una versión peor
            de algo que ya existe.
          </p>

          <h3>Dónde está exactamente la línea</h3>

          <p>
            Podemos mostrarte el saldo de tu cuenta de valores y las transferencias que salen hacia
            ella, porque eso es flujo de caja y hace falta para entender tu dinero. Podemos decirte
            cuánto varió tu patrimonio y cuánto de esa variación fue tipo de cambio, porque es
            aritmética sobre hechos pasados.
          </p>

          <p>
            No podemos decirte si conviene vender, ni comparar tu cartera con un índice, ni sugerir
            una asignación. Si nos lo preguntás, la respuesta va a ser que hables con tu asesor — y
            si querés, le damos acceso de sólo lectura al patrimonio agregado para que la
            conversación empiece con los dos mirando el mismo número.
          </p>
        </div>

        <div className={styles.fifth}>
          <div>
            <h3>¿Y si necesitás justo lo que no hacemos?</h3>
            <p className="small">
              Decilo en la llamada de calificación y te lo decimos de frente. Vender un producto a
              alguien que necesita otra cosa termina en una cancelación a los tres meses y en una
              reseña merecida.
            </p>
          </div>
          <Link href="/precios" className="btn">
            Ver precios
          </Link>
        </div>
      </section>
    </main>
  )
}
