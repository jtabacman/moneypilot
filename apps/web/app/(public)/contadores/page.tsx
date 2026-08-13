import Link from 'next/link'
import styles from '../landing.module.css'

export const metadata = {
  title: 'Para contadores',
  description:
    'El rol contador es gratis y no consume asiento. Recibís el cierre el día 5, con la reconciliación hecha y las excepciones declaradas.',
}

export default function Contadores() {
  return (
    <main>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className="label">Para contadores y asesores fiscales</span>
          <h2>Tu cliente deja de mandarte extractos por correo</h2>
          <p className="lede">
            No competimos con vos. Producimos el material de entrada que hoy tenés que reconstruir a
            mano, y te lo damos ya reconciliado, con las excepciones señaladas y en formatos que se
            abren en tu herramienta.
          </p>
        </div>

        <div className={styles.figures}>
          <div>
            <b className="money">USD 0</b>
            <span className="label">cuesta tu acceso</span>
            <p className="small">
              El rol contador es gratis y no consume asiento del plan de tu cliente. Cobrarte por
              entrar te convertiría en un obstáculo, y no tendría sentido.
            </p>
          </div>
          <div>
            <b className="money">Día 5</b>
            <span className="label">llega el cierre</span>
            <p className="small">
              Programado. PDF, XLSX con fórmulas y tablas reales, CSV crudo y un ZIP con los
              adjuntos vinculados.
            </p>
          </div>
          <div>
            <b className="money">90 días</b>
            <span className="label">dura el acceso</span>
            <p className="small">
              Renovable. La caducidad es del producto, no una desconfianza hacia vos: es lo que hace
              que tu cliente se anime a darte acceso en serio.
            </p>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>Qué recibís exactamente</h3>
          </div>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Bloque</th>
                  <th>Qué resuelve</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <b>Cabecera de estado</b>
                  </td>
                  <td>
                    Entidad, período, moneda de reporte, política de tipo de cambio aplicada y
                    semáforo de completitud: cuántas cuentas están conciliadas, cuántas con delta y
                    cuántas sin sincronizar.
                  </td>
                </tr>
                <tr>
                  <td>
                    <b>Reconciliación por cuenta</b>
                  </td>
                  <td>
                    Saldo inicial, movimientos, saldo final calculado, saldo real del banco y delta.
                    Si el delta no es cero, se ve en rojo y con su motivo. Es el bloque por el que
                    vale la pena todo lo demás.
                  </td>
                </tr>
                <tr>
                  <td>
                    <b>Estado de resultados por categoría</b>
                  </td>
                  <td>Con comparación contra el mes anterior y acumulado del ejercicio.</td>
                </tr>
                <tr>
                  <td>
                    <b>Excepciones</b>
                  </td>
                  <td>
                    Sin categorizar, splits pendientes, transferencias sin par, duplicados
                    descartados y —esto importa— las transacciones ocultas por política de
                    privacidad, con su cantidad y su importe total.
                  </td>
                </tr>
                <tr>
                  <td>
                    <b>Anexo</b>
                  </td>
                  <td>Adjuntos vinculados y registro de cambios posteriores al cierre anterior.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid2">
          <div className="panel">
            <div className="panel-head">
              <h3>Lo que no ves, y por qué se te dice</h3>
            </div>
            <div className="panel-body stack">
              <p className="small">
                Tu cliente puede marcar categorías como sensibles —salud, donaciones, legal— y ésas
                quedan fuera de tu vista por defecto.
              </p>
              <p className="small">
                <b>Pero el reporte declara el hueco:</b> &laquo;47 transacciones ocultas por
                política, EUR 12.340&raquo;. Ocultarlas en silencio rompería la reconciliación y te
                haría perder una hora buscando un descuadre que no existe.
              </p>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>Podés proponer, no escribir</h3>
            </div>
            <div className="panel-body stack">
              <p className="small">
                Cuando reclasificás algo, el sistema genera una propuesta con su diff y su impacto
                —&laquo;esta regla afecta a 342 transacciones&raquo;— y tu cliente la aprueba.
              </p>
              <p className="small">
                Nunca escritura directa sobre su registro. Es lo que hace que el registro siga
                siendo suyo, y lo que te protege a vos de una discusión sobre quién cambió qué.
              </p>
            </div>
          </div>
        </div>

        <div className={styles.fifth}>
          <div>
            <h3>¿Tenés varios clientes que podrían usarlo?</h3>
            <p className="small">
              Un mismo acceso puede pertenecer a varios hogares, cada uno con su alcance y su
              caducidad. Escribinos y lo montamos con vos: nos interesa mucho más que funcione en tu
              flujo de trabajo que sumar un logo.
            </p>
          </div>
          <Link href="/entrar" className="btn primary">
            Crear una cuenta
          </Link>
        </div>
      </section>
    </main>
  )
}
