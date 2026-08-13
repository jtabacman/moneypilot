'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useActionState, useCallback, useId, useState } from 'react'
import type { WireReport } from '@/lib/pipeline'
import { Report } from '../../(public)/importer'
import { conectarBanco, type EstadoConexion } from './finapi-actions'
import styles from './page.module.css'

/**
 * El estado inicial de la acción, declarado del lado del cliente.
 *
 * Tiene que vivir acá y no junto a la acción: un módulo `'use server'` sólo
 * exporta funciones al cliente, y cualquier otra cosa llega como `undefined`
 * sin que nada avise. Con el objeto declarado allá, `useActionState` arrancaba
 * con todos los campos en `undefined`; como `undefined !== null`, la pantalla
 * pintaba de entrada un "no se abrió la conexión" vacío y el bloque del sondeo
 * sin un solo botón, antes de que nadie hubiera pulsado nada.
 */
const SIN_CONEXION: EstadoConexion = {
  ok: false,
  mensaje: null,
  url: null,
  conexionId: null,
  banco: null,
  expiraEn: null,
}

/*
 * Conectar un banco y traer sus movimientos.
 *
 * Tres cosas que esta pantalla tiene que decir, y que no son adorno:
 *
 *  1. **El dinero que va a aparecer no existe.** Son bancos simulados de
 *     finAPI con datos sintéticos alemanes. Alguien que abra esto dentro de un
 *     mes tiene que entenderlo en dos segundos, porque los movimientos que
 *     entran son indistinguibles de los de verdad una vez asentados.
 *
 *  2. **Por qué hay que pulsar un botón para terminar.** El sandbox de finAPI
 *     está UNLICENSED y no admite `redirectUrl`, así que no hay vuelta
 *     automática desde su formulario. Esconder eso convertiría "se quedó
 *     colgado" en la explicación que se le ocurre a cualquiera.
 *
 *  3. **Que esto escribe en el libro.** No es una vista previa: lo que trae el
 *     banco entra como asientos, con el mismo informe y el mismo botón de
 *     deshacer que un fichero.
 *
 * Los tipos de acá son propios y no los de `@moneypilot/db`: por esta frontera
 * sólo cruza lo que se serializa, y declararlo hace evidente qué es eso.
 */

export interface BancoDePrueba {
  readonly id: number
  readonly nombre: string
  readonly interfaces: readonly string[]
  readonly pais: string | null
}

export type CatalogoVista =
  | { readonly kind: 'ok'; readonly bancos: readonly BancoDePrueba[] }
  | { readonly kind: 'sin-credenciales'; readonly faltan: readonly string[] }
  | { readonly kind: 'error'; readonly detalle: string }

export interface ConexionAbierta {
  readonly id: string
  readonly bankName: string
  readonly status: string
  readonly errorDetail: string | null
  readonly createdAt: string
}

/* ── Lo que contesta /api/finapi/sincronizar ─────────────────────────────── */

interface CuentaDelPlan {
  readonly externalAccountId: string
  readonly accountId: string
  readonly nombre: string
  readonly moneda: string
  readonly saldoDeclarado: string | null
  readonly creada: boolean
}

interface RespuestaPreparar {
  readonly estado?: 'listo' | 'esperando' | 'fallo'
  readonly status?: string | null
  readonly mensaje?: string | null
  readonly cuentas?: readonly CuentaDelPlan[]
  readonly error?: string
}

interface RespuestaCuenta {
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
  readonly error?: string
}

type Paso = 'reposo' | 'sondeando' | 'sincronizando' | 'hecho'

interface Progreso {
  readonly hechas: number
  readonly total: number
  readonly actual: string | null
}

export function ConectarBanco({
  catalogo,
  conexiones,
}: {
  catalogo: CatalogoVista
  conexiones: readonly ConexionAbierta[]
}) {
  const router = useRouter()
  const [estado, accion, conectando] = useActionState(conectarBanco, SIN_CONEXION)
  const bancos = catalogo.kind === 'ok' ? catalogo.bancos : []
  const [bancoId, setBancoId] = useState(() => String(bancos[0]?.id ?? ''))
  const selectId = useId()

  const [paso, setPaso] = useState<Paso>('reposo')
  const [aviso, setAviso] = useState<string | null>(null)
  const [progreso, setProgreso] = useState<Progreso | null>(null)
  const [resultados, setResultados] = useState<RespuestaCuenta[]>([])

  const ocupado = paso === 'sondeando' || paso === 'sincronizando'

  const traer = useCallback(
    async (conexionId: string | null) => {
      if (ocupado) return
      setPaso('sondeando')
      setAviso(null)
      setProgreso(null)
      setResultados([])

      const pedir = async (cuerpo: unknown): Promise<Response> =>
        fetch('/api/finapi/sincronizar', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(cuerpo),
        })

      try {
        const respuesta = await pedir({ accion: 'preparar', conexion: conexionId })
        const plan = (await respuesta.json()) as RespuestaPreparar

        if (plan.error !== undefined) {
          setAviso(plan.error)
          setPaso('reposo')
          return
        }
        if (plan.estado !== 'listo' || plan.cuentas === undefined) {
          setAviso(plan.mensaje ?? 'finAPI todavía no tiene nada que traer.')
          setPaso('reposo')
          // Puede haber creado cuentas o cambiado el estado de la conexión.
          router.refresh()
          return
        }

        setPaso('sincronizando')
        const cuentas = plan.cuentas
        const salidas: RespuestaCuenta[] = []

        // De a una y en serie, no en paralelo. Cada cuenta es una transacción
        // que escribe un lote entero; lanzarlas a la vez las haría competir por
        // las mismas filas y por el pool de conexiones, y el informe de la que
        // conteste última taparía a las demás.
        for (const [indice, cuenta] of cuentas.entries()) {
          setProgreso({ hechas: indice, total: cuentas.length, actual: cuenta.nombre })
          const porCuenta = await pedir({ accion: 'cuenta', cuenta: cuenta.externalAccountId })
          const salida = (await porCuenta.json()) as RespuestaCuenta
          if (salida.error !== undefined) {
            // Lo ya sincronizado se queda: son lotes completos y reversibles.
            // Borrarlos de la pantalla escondería trabajo que sí se hizo.
            setAviso(
              `Se cortó en "${cuenta.nombre}": ${salida.error} ` +
                'Lo que aparece abajo ya está en el libro y se deshace desde el historial.',
            )
            break
          }
          salidas.push(salida)
          setResultados([...salidas])
        }

        setProgreso({ hechas: salidas.length, total: cuentas.length, actual: null })
        setPaso('hecho')
        router.refresh()
      } catch {
        setAviso('No se pudo contactar al servidor. Probá de nuevo.')
        setPaso('reposo')
      }
    },
    [ocupado, router],
  )

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Conectar un banco</h2>
          <p className="small faint">
            La segunda fuente de entrada, además de los ficheros. Entra por el mismo camino: mismos
            asientos, mismo informe, mismo botón de deshacer.
          </p>
        </div>
      </div>

      <div className="panel-body">
        <NoEsTuDinero />

        {catalogo.kind === 'sin-credenciales' ? (
          <SinCredenciales faltan={catalogo.faltan} />
        ) : catalogo.kind === 'error' ? (
          <div className="error">
            <b>No se pudo leer el catálogo de finAPI.</b> {catalogo.detalle} El resto de esta
            pantalla —subir un extracto, el historial, deshacer— sigue funcionando igual.
          </div>
        ) : (
          <form action={accion} className={styles.conectar}>
            <label className={styles.eleccion} htmlFor={selectId}>
              <span className="small faint">Banco simulado</span>
              <select
                id={selectId}
                name="banco"
                value={bancoId}
                disabled={conectando || ocupado}
                onChange={(event) => setBancoId(event.target.value)}
              >
                {bancos.map((banco) => (
                  <option key={banco.id} value={String(banco.id)}>
                    {banco.nombre} ({banco.id}
                    {banco.pais === null ? '' : ` · ${banco.pais}`})
                  </option>
                ))}
              </select>
            </label>
            {/* El nombre viaja junto al id para poder guardarlo con la conexión:
                pedirle el catálogo otra vez al servidor sólo para poner una
                etiqueta sería una llamada de red por un dato que ya está acá. */}
            <input
              type="hidden"
              name="nombre"
              value={bancos.find((banco) => String(banco.id) === bancoId)?.nombre ?? ''}
            />
            <button type="submit" className="primary" disabled={conectando || bancoId === ''}>
              {conectando ? 'Abriendo el formulario…' : 'Conectar'}
            </button>
          </form>
        )}

        {estado.mensaje !== null && (
          <div className="error">
            <b>No se abrió la conexión.</b> {estado.mensaje}
          </div>
        )}

        {estado.ok && estado.url !== null && (
          <FormularioAbierto url={estado.url} banco={estado.banco} expiraEn={estado.expiraEn} />
        )}

        {(conexiones.length > 0 || estado.conexionId !== null) && (
          <PorQueElBoton conexiones={conexiones} ocupado={ocupado} onTraer={traer} />
        )}

        {aviso !== null && (
          <div className="banner">
            <b>Todavía no.</b> {aviso}
          </div>
        )}

        {progreso !== null && (
          <p className="small faint">
            {paso === 'sincronizando'
              ? `Sincronizando cuenta ${progreso.hechas + 1} de ${progreso.total}${
                  progreso.actual === null ? '' : `: ${progreso.actual}`
                }…`
              : `${progreso.hechas} de ${progreso.total} cuenta(s) sincronizadas.`}
          </p>
        )}
      </div>

      {resultados.map((resultado) => (
        <ResultadoDeCuenta
          key={resultado.accountId ?? resultado.nombreDeCuenta}
          salida={resultado}
        />
      ))}
    </section>
  )
}

/* ── El aviso que no se puede esconder ───────────────────────────────────── */

/**
 * Deliberadamente lo primero y deliberadamente largo.
 *
 * Una vez asentados, estos movimientos se ven exactamente igual que los de un
 * extracto real: mismas cuentas, mismos saldos, mismos reportes. La única
 * defensa contra confundirlos es que esté escrito acá antes de pulsar nada.
 */
function NoEsTuDinero() {
  return (
    <div className="banner">
      <b>Ojo: este dinero no es tuyo y no existe.</b> Lo que se conecta desde acá son{' '}
      <b>bancos simulados de finAPI</b>, un agregador alemán, con{' '}
      <b>movimientos sintéticos en euros</b> generados por ellos. No son tus cuentas, no hay ningún
      banco tuyo en esta lista y nadie va a pedirte tus credenciales reales.
      <br />
      <br />
      Está acá por un motivo concreto: es un corpus que no escribimos nosotros. El hogar de ejemplo
      genera datos que nuestro propio código ya sabe manejar —un examen que se aprueba solo—,
      mientras que estos traen conceptos, contrapartes y códigos de operación alemanes que nadie
      anticipó. Sirve para ver cómo se comporta el sistema con datos ajenos.
      <br />
      <br />
      <b>Lo que traiga se guarda en tu libro de verdad</b>, con sus asientos y sus saldos, así que
      va a aparecer en Hoy, en Este mes y en el patrimonio. Cada sincronización queda como un lote
      en el historial de abajo y se deshace entera de un click.
    </div>
  )
}

function SinCredenciales({ faltan }: { faltan: readonly string[] }) {
  return (
    <div className="notice">
      <b>El feed no está configurado en este entorno.</b> Faltan {faltan.join(', ')}. Se piden en el
      portal de finAPI y se ponen en el entorno —nunca en el repositorio—; están documentadas en{' '}
      <code>.env.example</code>. Sin ellas, importar por fichero funciona igual.
    </div>
  )
}

/* ── Después de pulsar Conectar ──────────────────────────────────────────── */

function FormularioAbierto({
  url,
  banco,
  expiraEn,
}: {
  url: string
  banco: string | null
  expiraEn: string | null
}) {
  return (
    <div className="verdict ok">
      <b>Formulario abierto{banco === null ? '' : ` para ${banco}`}.</b> Las credenciales las
      tecleás en el sitio de finAPI y no pasan por nosotros — es la razón por la que existe ese
      formulario.{' '}
      {/* target="_blank" en un enlace de verdad y no `window.open` desde el
          manejador: después de un await, el navegador lo trata como ventana
          emergente y lo bloquea sin decir nada. */}
      <a href={url} target="_blank" rel="noopener noreferrer" className="btn primary">
        Abrir el formulario de finAPI ↗
      </a>
      <br />
      <br />
      En el <b>finAPI Test Bank</b> el usuario y la contraseña son <code>demo</code> /{' '}
      <code>demo</code> y el TAN es <code>123456</code>.
      {expiraEn === null
        ? ''
        : ` El formulario caduca el ${expiraEn.slice(0, 16).replace('T', ' ')}.`}
    </div>
  )
}

/**
 * El botón que en producción no haría falta, con la explicación al lado.
 *
 * No se esconde ni se disfraza de "actualizar": es una consecuencia real de
 * cómo está licenciado este cliente del sandbox, y quien mantenga esto dentro
 * de seis meses tiene que saber por qué está acá antes de intentar quitarlo.
 */
function PorQueElBoton({
  conexiones,
  ocupado,
  onTraer,
}: {
  conexiones: readonly ConexionAbierta[]
  ocupado: boolean
  onTraer: (conexionId: string | null) => void
}) {
  return (
    <div className={styles.sondeo}>
      <p className="small">
        <b>Cuando termines en finAPI, volvé acá y pulsá el botón.</b> No hay vuelta automática, y no
        es un descuido: el sandbox tiene el cliente <code>UNLICENSED</code>, así que finAPI rechaza
        cualquier dirección de retorno con <code>INVALID_REDIRECT_URL</code>. Sin dirección de
        retorno nadie nos avisa de que acabaste, y la única forma de enterarnos es preguntar. Con
        una licencia de producción esto sería automático y este botón no existiría.
      </p>

      <div className="row">
        {conexiones.map((conexion) => (
          <button
            key={conexion.id}
            type="button"
            className="primary"
            disabled={ocupado}
            onClick={() => onTraer(conexion.id)}
          >
            {ocupado ? 'Trayendo…' : `Ya terminé, traer los movimientos · ${conexion.bankName}`}
          </button>
        ))}
        {conexiones.length > 0 && (
          // Sin sondear ningún formulario: sirve cuando el formulario ya
          // caducó —finAPI los caduca aunque la conexión siga viva— y también
          // para volver a traer lo nuevo de un banco ya conectado.
          <button type="button" className="quiet" disabled={ocupado} onClick={() => onTraer(null)}>
            Volver a traer los movimientos
          </button>
        )}
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
  )
}

/* ── El informe de cada cuenta ───────────────────────────────────────────── */

function ResultadoDeCuenta({ salida }: { salida: RespuestaCuenta }) {
  if (salida.kind === 'vacia') {
    return (
      <div className="panel-body">
        <p className="small faint">
          <b>{salida.nombreDeCuenta}</b>: finAPI no devolvió ningún movimiento para esta cuenta, así
          que no se guardó ningún lote. Un lote vacío ocuparía su huella de contenido y el día que
          la cuenta tenga movimientos, sincronizarla no haría nada.
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
            que devuelve finAPI para esta cuenta es idéntico al del lote{' '}
            <code>{(salida.batchId ?? '').slice(0, 8)}</code>, así que no se escribió nada. Si
            querés volver a cargarlo, deshacé aquel lote primero.
          </div>
        )}
      </div>
      <Report report={salida.report} review={salida.review ?? []} transfers={[]} />
    </>
  )
}
