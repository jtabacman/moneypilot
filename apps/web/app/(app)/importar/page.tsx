/**
 * /importar — subir un extracto y que quede escrito.
 *
 * La pantalla tiene una sola idea que defender: **acá se guarda**. La versión
 * pública de /probar lee el fichero y te devuelve el informe; ésta escribe los
 * asientos en tu libro. Como la diferencia no se ve en la interfaz —el
 * importador se parece— se dice con palabras, arriba del todo y al lado del
 * botón.
 *
 * La segunda idea es el historial con su botón de deshacer. No está acá por
 * completitud: es lo que hace que alguien se anime a subir dos años de
 * histórico el primer día. Un importador sin deshacer se usa con un fichero de
 * prueba y luego nunca más.
 *
 * Nota sobre el hogar vacío: el resto de las pantallas renderiza `NoData`
 * cuando no hay movimientos, y ésta no. Sería un callejón sin salida — `NoData`
 * manda justamente acá.
 */

import {
  type AccountBalance,
  accountBalances,
  type ImportBatchRow,
  listConnections,
  listImportBatches,
} from '@moneypilot/db'
import Link from 'next/link'
import { Suspense } from 'react'
import { readHousehold } from '@/lib/data'
import { catalogoDePrueba } from '@/lib/finapi/catalogo'
import { PROVEEDOR } from '@/lib/finapi/hogar'
import { formatDate } from '@/lib/format'
import { navItem } from '@/lib/nav'
import { loadDemoData, unloadDemoData } from '../demo-actions'
import { Empty, PageBar } from '../ui'
import { type CatalogoVista, ConectarBanco, type ConexionAbierta } from './banco'
import { Deshacer } from './deshacer'
import styles from './page.module.css'
import { type CuentaElegible, Subida } from './upload'

export const dynamic = 'force-dynamic'

const ITEM = navItem('/importar')

/** Contra una cuenta de gasto no se importa un extracto: no la tiene ningún banco. */
const IMPORTABLES = new Set<AccountBalance['kind']>(['asset', 'liability'])

/** El lote del hogar de ejemplo. No es una importación y no se deshace igual. */
const FORMATO_EJEMPLO = 'seed'

/** Tope del historial. Más que esto no es un historial, es un volcado. */
const LOTES = 50

/**
 * Los roles que pueden escribir acá salen del mismo sitio que el menú.
 *
 * El menú ya no le pinta esta entrada a un rol que no importa, pero el menú no
 * es una defensa: la URL se escribe a mano y el enlace se pega en un correo.
 * Sin esto, un asesor entraría a una pantalla entera de controles que la ruta
 * de la API le va a rechazar con un 403 —después de elegir el fichero—, que es
 * exactamente la clase de botón que parece funcionar y no funciona.
 */
function puedeImportar(rol: string): boolean {
  const permitidos = ITEM?.roles
  return permitidos === undefined || permitidos.includes(rol)
}

export default async function ImportarPage() {
  const { session, data } = await readHousehold(async (client) => {
    // En serie y no con `Promise.all`: las tres consultas van por la MISMA
    // conexión, y `pg` las encola de todas formas — el paralelismo era
    // aparente. Lo que sí producía era el aviso de deprecación de llamar a
    // `query()` con otra en vuelo, que en Next aparece como un error en
    // pantalla y manda a buscar un problema que no existe.
    const cuentas = await accountBalances(client)
    const lotes = await listImportBatches(client, LOTES)
    const conexiones = await listConnections(client, PROVEEDOR)
    return { cuentas, lotes, conexiones }
  })

  const puede = puedeImportar(session.role)

  const conexiones: ConexionAbierta[] = data.conexiones.map((conexion) => ({
    id: conexion.id,
    bankName: conexion.bankName,
    status: conexion.status,
    errorDetail: conexion.errorDetail,
    createdAt: conexion.createdAt,
  }))

  const elegibles: CuentaElegible[] = data.cuentas
    .filter((cuenta) => IMPORTABLES.has(cuenta.kind) && cuenta.closedAt === null)
    .map((cuenta) => ({
      id: cuenta.id,
      name: cuenta.name,
      currency: cuenta.currency,
      institution: cuenta.institution,
    }))

  // También las cerradas: un lote viejo puede apuntar a una cuenta que ya no
  // se usa, y enseñar su uuid en vez de su nombre no ayuda a nadie.
  const nombres = new Map(data.cuentas.map((cuenta) => [cuenta.id, cuenta.name]))

  return (
    <>
      <PageBar
        title={ITEM?.label ?? 'Importar'}
        blurb={
          ITEM?.blurb ?? 'Subí extractos y mirá el informe de reconciliación antes de guardar.'
        }
        tools={
          <Link href="/movimientos" className="btn">
            Ver movimientos
          </Link>
        }
      />

      <div className="page">
        <div className="notice">
          <b>Lo que subas acá se guarda.</b> Entra a tu libro como asientos con su contrapartida,
          con los saldos que declare el extracto y con las filas dudosas en la cola de revisión. Vas
          a ver el mismo informe que en{' '}
          <Link href="/probar">la versión pública, que sólo lee y no guarda</Link>, y además el lote
          queda listado abajo para deshacerlo entero cuando quieras.
        </div>

        {!puede ? (
          <div className="banner">
            Tu rol en este hogar ({session.role}) puede mirar el registro pero no escribir en él.
            {/* La lista sale de lib/nav.ts y no de una frase escrita a mano: si
                mañana cambia quién importa, este párrafo no se queda mintiendo. */}
            {ITEM?.roles !== undefined &&
              ` Subir extractos y deshacer importaciones es de: ${ITEM.roles.join(', ')}.`}{' '}
            Abajo está lo que ya entró, por si necesitás comprobar de dónde salió un movimiento.
          </div>
        ) : elegibles.length === 0 ? (
          <SinCuentas />
        ) : (
          <Subida cuentas={elegibles} />
        )}

        {/* El feed va después de la subida y no antes: la fuente principal de
            este producto sigue siendo el fichero, y esto es una segunda vía
            —hoy con datos simulados— que no puede robarle el sitio.

            Y va dentro de un Suspense porque leer el catálogo es una llamada a
            un servidor de terceros que tarda más de un segundo en frío. Sin
            esta frontera, subir un extracto —que no tiene nada que ver con
            esto— esperaría a que conteste un agregador alemán. */}
        {puede && (
          <Suspense fallback={<BuscandoBancos />}>
            <SeccionDelFeed conexiones={conexiones} />
          </Suspense>
        )}

        <Historial lotes={data.lotes} nombres={nombres} puede={puede} />
      </div>
    </>
  )
}

/* ── El feed del agregador ───────────────────────────────────────────────── */

/**
 * La sección de conectar un banco, con el catálogo ya resuelto.
 *
 * Es un componente aparte para poder suspenderla sola. `catalogoDePrueba` no
 * lanza nunca —devuelve el fallo como dato— así que un finAPI caído deja esta
 * sección explicando por qué y el resto de la pantalla intacto.
 *
 * Del banco sólo cruza a cliente lo que la pantalla enseña: `listarBancosDePrueba`
 * devuelve además BIC y BLZ, y mandarle al navegador cien objetos completos
 * para usar tres campos no lo pide nadie.
 */
async function SeccionDelFeed({ conexiones }: { conexiones: readonly ConexionAbierta[] }) {
  const catalogo = await catalogoDePrueba()
  const vista: CatalogoVista =
    catalogo.kind !== 'ok'
      ? catalogo
      : {
          kind: 'ok',
          bancos: catalogo.bancos.map((banco) => ({
            id: banco.id,
            nombre: banco.nombre,
            interfaces: banco.interfaces,
            pais: banco.pais,
          })),
        }
  return <ConectarBanco catalogo={vista} conexiones={conexiones} />
}

function BuscandoBancos() {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Conectar un banco</h2>
          <p className="small faint">Buscando los bancos de prueba de finAPI…</p>
        </div>
      </div>
    </section>
  )
}

/* ── Sin cuentas donde guardar ───────────────────────────────────────────── */

/**
 * Un extracto se importa contra una cuenta concreta. Crear una al vuelo con el
 * nombre que traiga el fichero sería cómodo y estaría mal: la cuenta lleva
 * moneda, país y titularidad, y adivinarlas produce un plan de cuentas que
 * nadie eligió y que después hay que desenredar.
 */
function SinCuentas() {
  return (
    <div className="panel">
      <Empty
        title="Todavía no hay ninguna cuenta donde guardar esto"
        action={
          <div className="row" style={{ justifyContent: 'center' }}>
            <form action={loadDemoData}>
              <button type="submit" className="primary">
                Cargar el hogar de ejemplo
              </button>
            </form>
            <Link href="/cuentas" className="btn">
              Ver cuentas
            </Link>
          </div>
        }
      >
        Un extracto entra contra una cuenta concreta —con su moneda, su banco y su país— y no vamos
        a inventarte una a partir del nombre del fichero. El alta de cuentas a mano todavía no está
        en esta versión: hoy la forma de tener cuentas es el hogar de ejemplo, que escribe 18
        cuentas reales en tu base y se quita de un click.
      </Empty>
    </div>
  )
}

/* ── Historial de lotes ──────────────────────────────────────────────────── */

function Historial({
  lotes,
  nombres,
  puede,
}: {
  lotes: readonly ImportBatchRow[]
  nombres: ReadonlyMap<string, string>
  puede: boolean
}) {
  const enElLibro = lotes.filter((lote) => lote.status === 'completed')
  const movimientos = enElLibro.reduce((total, lote) => total + lote.imported, 0)

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Lo que ya importaste</h2>
          <p className="small faint">
            Cada fichero que entró, con lo que trajo y con el botón para quitarlo entero.
          </p>
        </div>
        {/* El enlace va aparte y no envolviendo la cifra: /movimientos enseña el
            registro entero —también lo escrito a mano y lo de lotes deshechos—,
            así que un número que se abre a otro número distinto mentiría. */}
        <small>
          {enElLibro.length} {enElLibro.length === 1 ? 'lote' : 'lotes'} en el libro · {movimientos}{' '}
          {movimientos === 1 ? 'movimiento asentado' : 'movimientos asentados'} ·{' '}
          <Link href="/movimientos">verlos en el registro</Link>
        </small>
      </div>

      {lotes.length === 0 ? (
        <div className="panel-body">
          <p className="small faint">
            Todavía no importaste ningún fichero. El primero que subas aparece acá, y desde acá se
            deshace.
          </p>
        </div>
      ) : (
        <>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  {/* "Origen" y no "Fichero": un lote del feed no vino de
                      ninguno, y llamarlo así haría que alguien lo buscara en
                      su disco dentro de seis meses. */}
                  <th scope="col">Origen</th>
                  <th scope="col">Formato</th>
                  <th scope="col">Cuenta</th>
                  <th scope="col">Cuándo (UTC)</th>
                  <th scope="col" className="r">
                    Leídas
                  </th>
                  <th scope="col" className="r">
                    Importadas
                  </th>
                  <th scope="col" className="r">
                    Duplicadas
                  </th>
                  <th scope="col" className="r">
                    Corregidas
                  </th>
                  <th scope="col" className="r">
                    A revisión
                  </th>
                  <th scope="col" className="r">
                    Rechazadas
                  </th>
                  <th scope="col">Estado</th>
                  {/* Una columna sin encabezado no tiene nombre que anunciar. */}
                  <th scope="col">Deshacer</th>
                </tr>
              </thead>
              <tbody>
                {lotes.map((lote) => (
                  <Fila key={lote.id} lote={lote} nombres={nombres} puede={puede} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel-foot">
            <b>Leídas</b> son las líneas que trajo el origen; <b>importadas</b>, las que se
            asentaron. <b>Duplicadas</b> ya estaban en el libro y se descartaron por huella —nunca
            en silencio: por eso están contadas acá—. <b>Corregidas</b> ya estaban y el banco las
            cambió al pasarlas de pendiente a asentadas: se reescribió el asiento en su sitio, sin
            duplicarlo, y sólo puede pasar con un feed. <b>A revisión</b> no entraron al libro y
            esperan tu criterio en <Link href="/revisar">Revisar</Link>. <b>Rechazadas</b> son filas
            que el parser no pudo leer. Deshacer un lote borra sus asientos, deja el registro de que
            ocurrió y libera el origen para volver a importarlo — salvo las <b>corregidas</b>, que
            pertenecen al lote que las trajo la primera vez y se van con aquél.
          </div>
        </>
      )}
    </section>
  )
}

function Fila({
  lote,
  nombres,
  puede,
}: {
  lote: ImportBatchRow
  nombres: ReadonlyMap<string, string>
  puede: boolean
}) {
  const esEjemplo = lote.format === FORMATO_EJEMPLO
  const cuenta = lote.accountId === null ? null : nombres.get(lote.accountId)

  return (
    <tr>
      <td>
        <span className={styles.fichero} title={`${lote.fileName} · lote ${lote.id}`}>
          {/* El ejemplo no vino de ningún fichero: su marca interna en una
              columna que dice "Fichero" se lee como un extracto que no existe. */}
          {esEjemplo ? 'Hogar de ejemplo' : lote.fileName}
        </span>
      </td>
      <td className="num faint">{lote.format.toUpperCase()}</td>
      <td>
        {lote.accountId === null ? (
          <span className="faint">{esEjemplo ? 'varias' : '—'}</span>
        ) : (
          // Regla transversal: todo agregado se abre hasta la transacción.
          <Link href={`/movimientos?cuenta=${lote.accountId}`}>{cuenta ?? 'cuenta borrada'}</Link>
        )}
      </td>
      {/* `createdAt` es un instante, no una fecha de calendario: se corta en UTC
          y se dice que es UTC. Rotularlo como hora local sería inventar un huso
          que el servidor no conoce, y al oeste de Greenwich cambia hasta el día. */}
      <td className={styles.cuando} title={lote.createdAt}>
        {formatDate(lote.createdAt.slice(0, 10))}{' '}
        <span className="faint">{lote.createdAt.slice(11, 16)}</span>
      </td>
      <td className="r num">{lote.linesRead}</td>
      <td className="r num">{lote.imported}</td>
      <td className="r num">
        {lote.duplicates === 0 ? <span className="faint">0</span> : lote.duplicates}
      </td>
      <td className="r num">
        {lote.updated === 0 ? <span className="faint">0</span> : lote.updated}
      </td>
      <td className="r num">
        {/* La cola de revisión sí tiene destino exacto: las filas que este lote
            dejó fuera del libro están ahí y en ningún otro sitio. */}
        {lote.needsReview === 0 ? (
          <span className="faint">0</span>
        ) : (
          <Link href="/revisar">{lote.needsReview}</Link>
        )}
      </td>
      <td className="r num">
        {lote.rejected === 0 ? <span className="faint">0</span> : lote.rejected}
      </td>
      <td>
        <Estado lote={lote} esEjemplo={esEjemplo} />
      </td>
      <td>
        <Accion lote={lote} esEjemplo={esEjemplo} puede={puede} />
      </td>
    </tr>
  )
}

function Estado({ lote, esEjemplo }: { lote: ImportBatchRow; esEjemplo: boolean }) {
  if (esEjemplo && lote.status === 'completed') {
    return <span className="status demo">ejemplo</span>
  }
  if (lote.status === 'completed') {
    // Un lote que corrió entero pero no asentó nada —todo duplicado, todo a
    // revisión o todo rechazado— no está "en el libro". Pintarlo en verde es
    // declarar un éxito que no ocurrió, y es el caso en el que alguien cierra
    // la pantalla creyendo que sus movimientos ya entraron.
    if (lote.imported === 0) {
      return (
        <span className="status none" title="El lote corrió, pero no se asentó ningún movimiento.">
          sin asientos
        </span>
      )
    }
    return <span className="status ok">en el libro</span>
  }
  if (lote.status === 'reverted') {
    return (
      <span className="status none">
        deshecho{lote.revertedAt === null ? '' : ` el ${formatDate(lote.revertedAt.slice(0, 10))}`}
      </span>
    )
  }
  if (lote.status === 'running') return <span className="status warn">a medias</span>
  return <span className="status bad">falló</span>
}

/**
 * El ejemplo no se deshace con `revertImport`: ese lote también trajo cuentas y
 * dimensiones, y quitarle sólo los asientos dejaría dieciocho cuentas vacías
 * que el usuario no creó. `unloadDemoData` sabe deshacer las tres cosas.
 */
function Accion({
  lote,
  esEjemplo,
  puede,
}: {
  lote: ImportBatchRow
  esEjemplo: boolean
  puede: boolean
}) {
  if (!puede) return null

  if (esEjemplo) {
    if (lote.status !== 'completed') return null
    return (
      <form action={unloadDemoData}>
        <button type="submit" className="quiet">
          Quitar el ejemplo
        </button>
      </form>
    )
  }

  // Un lote ya deshecho sigue montando el mismo componente a propósito: es lo
  // que permite que el resultado de deshacerlo —cuántos asientos se quitaron y
  // qué filas de revisión perdieron su enlace— sobreviva al refresco que la
  // propia acción provoca. Si acá devolviéramos null, React desmontaría el
  // componente y ese informe se perdería sin que nadie lo llegue a leer.
  if (lote.status !== 'completed' && lote.status !== 'reverted') return null

  return <Deshacer lote={lote.id} fichero={lote.fileName} deshecho={lote.status === 'reverted'} />
}
