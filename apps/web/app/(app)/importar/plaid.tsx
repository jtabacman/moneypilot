'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useActionState, useCallback, useId, useState } from 'react'
import type { WireReport } from '@/lib/pipeline'
import { Report } from '../../(public)/importer'
import styles from './page.module.css'
import { conectarPlaid, type EstadoConexionPlaid } from './plaid-actions'

/*
 * Conectar un banco por Plaid y traer sus movimientos.
 *
 * Cuatro cosas que esta pantalla tiene que decir, y ninguna es adorno:
 *
 *  1. **El dinero no existe.** Igual que con finAPI: son cuentas simuladas del
 *     sandbox, y una vez asentadas se ven exactamente igual que las de verdad.
 *
 *  2. **Pero los bancos SÍ son reales**, y eso confunde más y no menos. En la
 *     lista hay BBVA, CaixaBank, Santander y Chase con su identificador de
 *     producción; lo simulado es lo que hay dentro. Quien vea "BBVA · Plaid
 *     Current Account" en sus cuentas dentro de un mes tiene que poder
 *     reconstruir que eso no es su banco.
 *
 *  3. **Acá no hay formulario que completar.** Con finAPI hacía falta abrir una
 *     pestaña, teclear credenciales y volver a pulsar un botón. Plaid en
 *     sandbox devuelve la conexión ya autenticada, así que se conecta de un
 *     click. El camino de verdad —Link, el widget de Plaid— está explicado
 *     abajo y preparado del lado del servidor.
 *
 *  4. **Esto escribe en el libro.** No es una vista previa: entra como asientos,
 *     con el mismo informe y el mismo botón de deshacer que un fichero.
 *
 * Los tipos de acá son propios y no los de `@moneypilot/db`: por esta frontera
 * sólo cruza lo que se serializa, y declararlo hace evidente qué es eso.
 */

/**
 * El estado inicial de la acción, declarado del lado del cliente.
 *
 * Tiene que vivir acá y no junto a la acción: un módulo `'use server'` sólo
 * exporta funciones al cliente, y cualquier otra cosa llega como `undefined`
 * sin que nada avise. Ver el comentario largo en `banco.tsx`, donde esto ya
 * costó una pantalla que pintaba un error antes de que nadie pulsara nada.
 */
const SIN_CONEXION: EstadoConexionPlaid = {
  ok: false,
  mensaje: null,
  conexionId: null,
  banco: null,
}

export interface InstitucionVista {
  readonly id: string
  readonly nombre: string
  readonly pais: string
  readonly moneda: string
  readonly real: boolean
  readonly nota: string
}

export interface ConexionPlaid {
  readonly id: string
  readonly bankName: string
  readonly status: string
  readonly errorDetail: string | null
  /** true si ya hay cursor: la próxima sincronización trae sólo lo nuevo. */
  readonly incremental: boolean
  readonly createdAt: string
}

/* ── Lo que contesta /api/plaid/sincronizar ──────────────────────────────── */

interface AnulacionVista {
  readonly externalId: string
  readonly bookedOn: string
  readonly description: string
  readonly importe: string
}

interface CuentaVista {
  readonly kind?: 'ok' | 'vacia'
  readonly nombreDeCuenta?: string
  readonly accountId?: string
  readonly batchId?: string
  readonly guardado?: boolean
  readonly imported?: number
  readonly updated?: number
  readonly duplicates?: number
  readonly needsReview?: number
  readonly report?: WireReport
  readonly review?: { lineNumber: number; bookedOn: string; description: string }[]
  readonly anulados?: readonly AnulacionVista[]
}

interface RespuestaSincronizar {
  readonly banco?: string
  readonly cuentas?: readonly CuentaVista[]
  readonly cursorGuardado?: boolean
  readonly estados?: readonly string[]
  readonly historicoCompleto?: boolean
  readonly incompleta?: boolean
  readonly error?: string
}

export function ConectarPlaid({
  instituciones,
  conexiones,
  hayCredenciales,
  faltan,
  esSandbox,
}: {
  instituciones: readonly InstitucionVista[]
  conexiones: readonly ConexionPlaid[]
  hayCredenciales: boolean
  faltan: readonly string[]
  esSandbox: boolean
}) {
  const router = useRouter()
  const [estado, accion, conectando] = useActionState(conectarPlaid, SIN_CONEXION)
  const [bancoId, setBancoId] = useState(() => instituciones[0]?.id ?? '')
  const selectId = useId()

  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [salida, setSalida] = useState<RespuestaSincronizar | null>(null)

  const elegido = instituciones.find((banco) => banco.id === bancoId) ?? null

  const traer = useCallback(
    async (conexionId: string) => {
      if (ocupado) return
      setOcupado(true)
      setAviso(null)
      setSalida(null)
      try {
        const respuesta = await fetch('/api/plaid/sincronizar', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ conexion: conexionId }),
        })
        const cuerpo = (await respuesta.json()) as RespuestaSincronizar
        if (cuerpo.error !== undefined) {
          setAviso(cuerpo.error)
        } else {
          setSalida(cuerpo)
        }
      } catch {
        setAviso('No se pudo contactar al servidor. Probá de nuevo.')
      } finally {
        setOcupado(false)
        // Los saldos, el historial y la cola de revisión cambiaron.
        router.refresh()
      }
    },
    [ocupado, router],
  )

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Conectar un banco por Plaid</h2>
          <p className="small faint">
            El mismo camino que finAPI, con el proveedor que sí cubre España y Estados Unidos. Entra
            por el mismo sitio: mismos asientos, mismo informe, mismo botón de deshacer.
          </p>
        </div>
      </div>

      <div className="panel-body">
        <NoEsTuDineroPeroSonTusBancos />

        {!hayCredenciales ? (
          <SinCredenciales faltan={faltan} />
        ) : !esSandbox ? (
          <div className="banner">
            <b>Este entorno no apunta al sandbox de Plaid.</b> Conectar sin navegador sólo existe
            ahí: <code>/sandbox/public_token/create</code> devuelve una conexión ya autenticada y no
            tiene equivalente en producción. Contra un Plaid real hace falta Link, que es lo que se
            explica abajo.
          </div>
        ) : (
          <>
            <form action={accion} className={styles.conectar}>
              <label className={styles.eleccion} htmlFor={selectId}>
                <span className="small faint">Institución</span>
                <select
                  id={selectId}
                  name="banco"
                  value={bancoId}
                  disabled={conectando || ocupado}
                  onChange={(event) => setBancoId(event.target.value)}
                >
                  {instituciones.map((banco) => (
                    <option key={banco.id} value={banco.id}>
                      {banco.nombre} · {banco.pais} · {banco.moneda}
                      {banco.real ? '' : ' (banco de prueba)'}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="primary" disabled={conectando || bancoId === ''}>
                {conectando ? 'Conectando…' : 'Conectar sin navegador'}
              </button>
            </form>

            {elegido !== null && <p className={styles.moneda}>{elegido.nota}</p>}
          </>
        )}

        {estado.mensaje !== null && (
          <div className="error">
            <b>No se conectó el banco.</b> {estado.mensaje}
          </div>
        )}

        {estado.ok && (
          <div className="verdict ok">
            <b>{estado.banco} conectado.</b> No hizo falta ningún formulario: en sandbox Plaid
            devuelve el token ya autenticado. Ahora traé los movimientos con el botón de abajo.
          </div>
        )}

        {conexiones.length > 0 && (
          <div className={styles.sondeo}>
            <p className="small">
              <b>Cada conexión lleva su propio cursor.</b> La primera vez se trae el histórico
              entero; a partir de ahí, sólo lo que cambió. El cursor se guarda en la misma
              transacción que asienta los movimientos que deja atrás — nunca antes, porque un cursor
              adelantado pierde movimientos que Plaid no vuelve a mandar.
            </p>

            <div className="row">
              {conexiones.map((conexion) => (
                <button
                  key={conexion.id}
                  type="button"
                  className="primary"
                  disabled={ocupado}
                  onClick={() => traer(conexion.id)}
                >
                  {ocupado
                    ? 'Trayendo…'
                    : `${conexion.incremental ? 'Traer lo nuevo' : 'Traer los movimientos'} · ${conexion.bankName}`}
                </button>
              ))}
            </div>

            {conexiones.some((conexion) => conexion.errorDetail !== null) && (
              <ul className="small faint">
                {conexiones
                  .filter((conexion) => conexion.errorDetail !== null)
                  .map((conexion) => (
                    <li key={conexion.id}>
                      {conexion.bankName}: {conexion.status} — {conexion.errorDetail}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}

        {aviso !== null && (
          <div className="error">
            <b>No se pudo sincronizar.</b> {aviso}
          </div>
        )}

        {ocupado && (
          <p className="small faint">
            Preguntándole a Plaid hasta que deje de traer cosas. Un banco recién conectado entrega
            sus movimientos a plazos y nada en la respuesta dice cuándo terminó, así que se sondea
            hasta tres lotes vacíos seguidos: parar en el primero se lleva 16 de 48 sin dar un solo
            error.
          </p>
        )}

        {salida !== null && <Resumen salida={salida} />}

        <ComoSeriaConLinkDeVerdad />
      </div>

      {(salida?.cuentas ?? []).map((cuenta) => (
        <ResultadoDeCuenta key={cuenta.accountId ?? cuenta.nombreDeCuenta} salida={cuenta} />
      ))}
    </section>
  )
}

/* ── El aviso que no se puede esconder ───────────────────────────────────── */

/**
 * Deliberadamente lo primero y deliberadamente largo, igual que el de finAPI —
 * pero con un párrafo más, que es el que allá no hacía falta: los bancos de
 * esta lista existen.
 */
function NoEsTuDineroPeroSonTusBancos() {
  return (
    <div className="banner">
      <b>Ojo: este dinero no es tuyo y no existe.</b> Lo que se conecta desde acá son{' '}
      <b>cuentas simuladas del sandbox de Plaid</b>, con movimientos que generan ellos. No son tus
      cuentas, no hay ningún banco tuyo conectado y nadie va a pedirte tus credenciales reales.
      <br />
      <br />
      <b>
        Y una diferencia importante con el bloque de finAPI: acá los bancos sí son los de verdad.
      </b>{' '}
      BBVA, CaixaBank, Santander y Chase de la lista son las entidades reales, con el mismo
      identificador que en producción — lo simulado son las cuentas y los movimientos que hay
      dentro. Eso puede confundir más y no menos: dentro de un mes vas a ver "BBVA · Plaid Current
      Account" en tu lista de cuentas, y no hay nada en esa fila que diga que es de mentira. Si
      dudás, el lote está en el historial de abajo y se deshace entero.
      <br />
      <br />
      Está acá por el mismo motivo que el otro: es un corpus que no escribimos nosotros. Y es el
      proveedor que sí cubre el corredor del producto — 10.097 instituciones en Estados Unidos y 78
      en España, con BBVA, Santander, CaixaBank, Sabadell, Bankinter, ING, Openbank, Revolut,
      Unicaja y Kutxabank ofreciendo movimientos.
    </div>
  )
}

function SinCredenciales({ faltan }: { faltan: readonly string[] }) {
  return (
    <div className="notice">
      <b>Plaid no está configurado en este entorno.</b> Faltan {faltan.join(', ')}. Se piden en el
      panel de Plaid y se ponen en el entorno —nunca en el repositorio—; están documentadas en{' '}
      <code>.env.example</code>. Sin ellas, importar por fichero funciona igual.
    </div>
  )
}

/* ── El camino de verdad, dicho y no escondido ───────────────────────────── */

function ComoSeriaConLinkDeVerdad() {
  return (
    <details className={styles.sondeo}>
      <summary className="small">
        <b>Cómo sería esto con un banco de verdad</b>
      </summary>
      <p className="small">
        Con credenciales de producción no hay botón que conecte sin navegador: se abre <b>Link</b>,
        el widget de Plaid, y las credenciales del banco se teclean ahí dentro — nunca pasan por
        nosotros, que es la razón por la que el widget existe. El servidor ya sabe hacer su mitad:
        pide un <code>link_token</code> con los países del hogar, con la dirección de retorno que
        los bancos OAuth exigen (en España lo son casi todos) y con la dirección del webhook. Lo que
        falta es cargar su script en el navegador y recibir la vuelta desde el banco.
      </p>
      <p className="small">
        El webhook no es un detalle de comodidad: <code>SYNC_UPDATES_AVAILABLE</code> es la única
        señal fiable de que hay movimientos nuevos. Nada en la respuesta de{' '}
        <code>/transactions/sync</code> dice que ya estén todos —ni <code>has_more: false</code>, ni
        el estado, ni un lote vacío—, así que mientras no haya webhook lo que hay es sondeo, y el
        sondeo es lo que estás usando cuando pulsás el botón de arriba.
      </p>
    </details>
  )
}

/* ── El resumen del item ─────────────────────────────────────────────────── */

function Resumen({ salida }: { salida: RespuestaSincronizar }) {
  const cuentas = salida.cuentas ?? []
  const conLote = cuentas.filter((cuenta) => cuenta.kind === 'ok')
  const anulados = cuentas.flatMap((cuenta) => cuenta.anulados ?? [])

  return (
    <>
      <div className="notice">
        <b>
          {salida.banco}: {conLote.length} de {cuentas.length} cuenta(s) trajeron movimientos.
        </b>{' '}
        {salida.cursorGuardado === true &&
          'El cursor quedó guardado, así que la próxima sincronización trae sólo lo que cambie. '}
        {salida.incompleta === true &&
          'Plaid seguía mandando cuando se llegó al tope de vueltas: volvé a pulsar para traer el resto. '}
        {salida.historicoCompleto === false &&
          'Plaid todavía no había terminado de descargar el histórico de su lado; puede faltar algo y se trae en la próxima. '}
      </div>

      {anulados.length > 0 && (
        <div className="banner">
          <b>{anulados.length} movimiento(s) que ya estaban asentados los retiró el banco.</b> No se
          borran: se anulan con un asiento espejo, con la misma fecha y contra las mismas cuentas,
          así que el saldo llega al del banco por suma y no por omisión. El asiento original se
          queda en el registro, enlazado con su anulación.
          <ul className="small">
            {anulados.map((fila) => (
              <li key={fila.externalId}>
                {fila.bookedOn} · {fila.description} · {fila.importe}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

/* ── El informe de cada cuenta ───────────────────────────────────────────── */

function ResultadoDeCuenta({ salida }: { salida: CuentaVista }) {
  if (salida.kind === 'vacia') {
    return (
      <div className="panel-body">
        <p className="small faint">
          <b>{salida.nombreDeCuenta}</b>: Plaid no devolvió ningún movimiento nuevo para esta
          cuenta, así que no se guardó ningún lote. Un lote vacío ocuparía su huella de contenido y
          el día que la cuenta tenga movimientos, sincronizarla no haría nada.
        </p>
      </div>
    )
  }

  if (salida.report === undefined) return null

  return (
    <>
      <div className="panel-body">
        {salida.guardado === true ? (
          <div className="verdict ok">
            <b>
              {salida.nombreDeCuenta}: {salida.imported ?? 0} movimiento(s) entraron al libro.
            </b>{' '}
            {(salida.updated ?? 0) > 0 &&
              `${salida.updated} ya estaban y el banco los corrigió: se reescribieron en su sitio, sin duplicarlos. `}
            {(salida.duplicates ?? 0) > 0 &&
              `${salida.duplicates} ya estaban tal cual y no se duplicaron. `}
            {(salida.needsReview ?? 0) > 0 && (
              <>
                {salida.needsReview} necesitan tu criterio y no se asentaron:{' '}
                <Link href="/revisar">están en Revisar</Link>.{' '}
              </>
            )}
            {salida.accountId !== undefined && (
              <Link href={`/movimientos?cuenta=${salida.accountId}`}>Ver los movimientos</Link>
            )}
            . Lote <code>{(salida.batchId ?? '').slice(0, 8)}</code>: se deshace entero desde el
            historial de abajo.
          </div>
        ) : (
          <div className="notice">
            <b>{salida.nombreDeCuenta}: nada nuevo desde la última sincronización.</b> El contenido
            que devuelve Plaid para esta cuenta es idéntico al del lote{' '}
            <code>{(salida.batchId ?? '').slice(0, 8)}</code>, así que no se escribió nada. Si
            querés volver a cargarlo, deshacé aquel lote primero.
          </div>
        )}
      </div>
      <Report report={salida.report} review={salida.review ?? []} transfers={[]} />
    </>
  )
}
