import { accountBalances, type ReviewRow, reviewQueue } from '@moneypilot/db'
import { readHousehold } from '@/lib/data'
import { formatDate } from '@/lib/format'
import { navItem } from '@/lib/nav'
import { NoData } from '../empty-state'
import { Empty, Money, PageBar } from '../ui'
import { indiceDeCuentas } from './accounts'
import {
  type Evidencia as DatosEvidencia,
  etiquetaTipo,
  explicacionTipo,
  leerEvidencia,
} from './kinds'
import { EnRegistro } from './links'

export const dynamic = 'force-dynamic'

const ITEM = navItem('/revisar')

/**
 * Tope de la lectura. Si la cola llega a esto, lo que sobra se declara en el
 * pie en vez de desaparecer: una cola recortada en silencio hace que el
 * contador de la portada y esta pantalla dejen de coincidir.
 */
const TOPE = 200

export default async function RevisarPage() {
  const { data } = await readHousehold(async (client) => {
    const [cola, cuentas] = await Promise.all([
      reviewQueue(client, { limit: TOPE }),
      accountBalances(client),
    ])
    return { cola, cuentas }
  })

  const movimientos = data.cuentas.reduce((total, cuenta) => total + cuenta.movements, 0)
  const indice = indiceDeCuentas(
    data.cuentas.filter((cuenta) => cuenta.kind === 'asset' || cuenta.kind === 'liability'),
  )

  const pendientes = data.cola.filter((fila) => fila.state === 'pendiente')
  const resueltas = data.cola.filter((fila) => fila.state !== 'pendiente')

  return (
    <>
      <PageBar
        title={ITEM?.label ?? 'Revisar'}
        blurb={ITEM?.blurb ?? 'Lo que el motor no se anima a decidir solo.'}
        tools={
          pendientes.length > 0 ? (
            <span className="status warn">
              {pendientes.length} {pendientes.length === 1 ? 'pendiente' : 'pendientes'}
            </span>
          ) : undefined
        }
      />

      <div className="page">
        {movimientos === 0 ? (
          <NoData what="la cola de lo que necesita tu criterio" />
        ) : (
          <>
            <PorQue />

            <Cola
              titulo="Pendientes"
              descripcion="Cada fila espera una decisión tuya. Mientras tanto, el movimiento cuenta tal como entró."
              filas={pendientes}
              cuentas={indice}
              accionable
              vacio="Todo lo que entró se pudo clasificar sin dudar. Cuando el motor no esté seguro, lo va a dejar acá."
            />

            {resueltas.length > 0 && (
              <Cola
                titulo="Ya resueltas"
                descripcion="Quedan a la vista con su evidencia: una decisión que no se puede releer no se puede discutir."
                filas={resueltas}
                cuentas={indice}
                accionable={false}
                vacio=""
              />
            )}

            {data.cola.length >= TOPE && (
              <div className="banner">
                La cola trae más de {TOPE} ítems y esta pantalla muestra los {TOPE} más recientes.
                Los que faltan siguen contando en el total.
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

/* ── Por qué existe esta pantalla ────────────────────────────────────────── */

function PorQue() {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Por qué está esto acá</h2>
      </div>
      <div className="panel-body stack">
        <p className="lede">
          La deduplicación corre en dos pasadas. La primera compara identidad exacta —misma cuenta,
          misma fecha, mismo importe, mismo descriptor normalizado— y ahí sí descarta sola: dos
          filas idénticas del mismo extracto son la misma fila.
        </p>
        <p className="small">
          La segunda es difusa: mira una ventana de días alrededor y la similitud del texto.{' '}
          <b>Esa pasada nunca descarta sola.</b> Dos cargos de 84,20 € en la misma tarjeta el mismo
          día pueden ser un error del banco o pueden ser dos compras reales, y la diferencia no está
          en los datos: está en tu memoria. Un sistema que elige por su cuenta acierta casi siempre,
          y el «casi» es plata que desaparece del libro sin que nadie lo note.
        </p>
        <p className="small">
          Lo mismo con las transferencias sin par y con lo que no se puede categorizar: se marca y
          se muestra, no se adivina. Por eso esta cola es corta y por eso vale la pena mirarla.
        </p>
      </div>
    </section>
  )
}

/* ── La cola ─────────────────────────────────────────────────────────────── */

function Cola({
  titulo,
  descripcion,
  filas,
  cuentas,
  accionable,
  vacio,
}: {
  titulo: string
  descripcion: string
  filas: readonly ReviewRow[]
  cuentas: ReadonlyMap<string, string>
  accionable: boolean
  vacio: string
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{titulo}</h2>
        <small>
          {filas.length} {filas.length === 1 ? 'ítem' : 'ítems'}
        </small>
      </div>

      {filas.length === 0 ? (
        <Empty title="Nada pendiente">{vacio}</Empty>
      ) : (
        <>
          <div className="panel-body">
            <p className="small">{descripcion}</p>
          </div>

          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Qué es</th>
                  <th>Movimiento</th>
                  <th>Cuenta</th>
                  <th className="r">Importe</th>
                  <th>Por qué duda el motor</th>
                  <th className="r">Decisión</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((fila) => (
                  <Fila key={fila.id} fila={fila} cuentas={cuentas} accionable={accionable} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {accionable && filas.length > 0 && (
        <div className="panel-foot">
          Aceptar y rechazar todavía no están conectados: falta el endpoint que escribe la decisión.
          Los botones se dejan a la vista y deshabilitados en vez de esconderlos, porque esconder la
          acción haría creer que la cola es sólo informativa.
        </div>
      )}
    </section>
  )
}

function Fila({
  fila,
  cuentas,
  accionable,
}: {
  fila: ReviewRow
  cuentas: ReadonlyMap<string, string>
  accionable: boolean
}) {
  const evidencia = leerEvidencia(fila.evidence)
  const explicacion = explicacionTipo(fila.kind)

  return (
    <tr>
      <td>
        <span className="status warn">{etiquetaTipo(fila.kind)}</span>
        {explicacion !== null && (
          <div className="small faint" style={{ maxWidth: '30ch' }}>
            {explicacion}
          </div>
        )}
      </td>

      <td>
        <b>{fila.description ?? 'Sin descripción'}</b>
        <div className="small faint">
          {fila.bookedOn === null ? 'sin fecha' : formatDate(fila.bookedOn, 'long')}
        </div>
      </td>

      <td>{fila.accountName ?? <span className="faint">—</span>}</td>

      <td className="r">
        {fila.amount === null || fila.currency === null ? (
          <span className="faint">—</span>
        ) : (
          <Money amount={fila.amount} currency={fila.currency} tone="flow" />
        )}
      </td>

      <td>
        <Evidencia evidencia={evidencia} />
      </td>

      <td className="r">
        <div className="stack" style={{ gap: 'var(--s1)', alignItems: 'flex-end' }}>
          <EnRegistro cuentas={cuentas} accountName={fila.accountName} bookedOn={fila.bookedOn} />
          {accionable ? (
            <div className="row" style={{ gap: 'var(--s1)', justifyContent: 'flex-end' }}>
              <button
                type="button"
                disabled
                title="Todavía no hay endpoint para escribir la decisión."
              >
                Aceptar
              </button>
              <button
                type="button"
                disabled
                title="Todavía no hay endpoint para escribir la decisión."
              >
                Rechazar
              </button>
            </div>
          ) : (
            <span className={fila.state === 'aceptado' ? 'status ok' : 'status none'}>
              {fila.state}
            </span>
          )}
        </div>
      </td>
    </tr>
  )
}

/* ── La evidencia ────────────────────────────────────────────────────────── */

function Evidencia({ evidencia }: { evidencia: DatosEvidencia }) {
  const { dias, similitud, motivo, resto } = evidencia

  return (
    <div className="stack" style={{ gap: 'var(--s1)', maxWidth: '42ch' }}>
      {(dias !== null || similitud !== null) && (
        <div className="row" style={{ gap: 'var(--s2)' }}>
          {dias !== null && (
            <span className="status none">
              {dias === 0
                ? 'el mismo día'
                : `${Math.abs(dias)} ${Math.abs(dias) === 1 ? 'día' : 'días'} de diferencia`}
            </span>
          )}
          {similitud !== null && (
            <span className="status none">texto {Math.round(similitud * 100)}% parecido</span>
          )}
        </div>
      )}

      {motivo !== null && <div className="small">{motivo}</div>}

      {resto.length > 0 && (
        <div className="small faint">
          Evidencia en crudo — {resto.map(([clave, valor]) => `${clave}: ${valor}`).join(' · ')}
        </div>
      )}

      {dias === null && similitud === null && motivo === null && resto.length === 0 && (
        <span className="faint">Sin evidencia registrada.</span>
      )}
    </div>
  )
}
