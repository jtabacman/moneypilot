import {
  accountBalances,
  categoryTree,
  clasificarAutomatico,
  type PropuestaAutomatica,
  type ReviewRow,
  reviewQueue,
} from '@moneypilot/db'
import { CAPA } from '@/lib/capas'
import { readHousehold } from '@/lib/data'
import { formatDate } from '@/lib/format'
import { navItem } from '@/lib/nav'
import { NoData } from '../empty-state'
import { Plegable } from '../plegable'
import { Empty, Money, PageBar } from '../ui'
import { indiceDeCuentas } from './accounts'
import { motivoSinPermiso, puedeResolver, rotulosDeDecision } from './decision'
import { Decidir } from './forms'
import {
  type Evidencia as DatosEvidencia,
  etiquetaTipo,
  explicacionTipo,
  leerEvidencia,
  leerTransaccionEnEspera,
} from './kinds'
import { EnRegistro } from './links'
import { DecidirPropuesta } from './propuestas'

export const dynamic = 'force-dynamic'

const ITEM = navItem('/revisar')

/**
 * Tope de la lectura. Si la cola llega a esto, lo que sobra se declara en el
 * pie en vez de desaparecer: una cola recortada en silencio hace que el
 * contador de la portada y esta pantalla dejen de coincidir.
 */
const TOPE = 200

/**
 * Cuántas propuestas se calculan por carga.
 *
 * Las propuestas **no se guardan**: se recalculan al abrir, porque una guardada
 * caduca sola en cuanto cambia el diccionario, la memoria o una regla. El coste
 * medido es de 75-140 ms sobre 566 movimientos sin categorizar, pero sube de
 * forma superlineal —4.500 tardan tres segundos—, y un hogar que carga dos años
 * por fichero llega a ese número el primer día. Con el tope, la pantalla abre
 * siempre igual de rápido y lo que queda fuera se declara en el pie.
 */
const TOPE_DE_PROPUESTAS = 40

export default async function RevisarPage() {
  const { session, data } = await readHousehold(async (client) => {
    // En serie: las dos van por el mismo cliente —una transacción, una
    // conexión—, así que pg las encola igual. Promise.all daba paralelismo
    // aparente y un aviso de query concurrente sobre un cliente ocupado, que
    // en pg@9 será un error.
    const cola = await reviewQueue(client, { limit: TOPE })
    const cuentas = await accountBalances(client)
    // En seco y sin las que ya se descartaron. `aplicar: false` es lo que
    // separa esta pantalla de la importación: acá el motor no escribe nada,
    // sólo dice qué haría.
    const clasificacion = await clasificarAutomatico(client, {
      aplicar: false,
      excluirRechazadas: true,
      limite: TOPE_DE_PROPUESTAS,
    })
    const categorias = await categoryTree(client)
    return { cola, cuentas, clasificacion, categorias }
  })

  const movimientos = data.cuentas.reduce((total, cuenta) => total + cuenta.movements, 0)
  const indice = indiceDeCuentas(
    data.cuentas.filter((cuenta) => cuenta.kind === 'asset' || cuenta.kind === 'liability'),
  )

  const pendientes = data.cola.filter((fila) => fila.state === 'pendiente')
  const resueltas = data.cola.filter((fila) => fila.state !== 'pendiente')

  // Las automáticas no se enseñan: ésas el motor las escribe solo y no hay nada
  // que preguntar. Lo que llega acá es lo que espera criterio.
  const propuestas = data.clasificacion.propuestas.filter((p) => !p.automatica)
  const nombreDeCategoria = new Map(data.categorias.map((c) => [c.id, c.path]))
  // El chip de la cabecera suma las dos colas, así que tiene que nombrarlas a
  // las dos. Antes decía «16 pendientes» y el panel llamado «Pendientes» decía
  // «0 ítems · Nada pendiente» justo debajo: el mismo sustantivo para dos cosas
  // distintas, y un contador que no cuadra con la tabla que tiene al lado
  // destruye la confianza en todos los demás contadores del producto.
  const porDecidir = pendientes.length + propuestas.length

  // Por qué se comprueba acá y no se esconde el botón: B6. El motivo viaja
  // hasta el botón para que se lea antes de intentarlo, y la acción de servidor
  // lo vuelve a comprobar por su cuenta — es un endpoint público.
  const motivo = puedeResolver(session.role) ? null : motivoSinPermiso(session.role)

  return (
    <>
      <PageBar
        title={ITEM?.label ?? 'Revisar'}
        blurb={ITEM?.blurb ?? 'Lo que el motor no se anima a decidir solo.'}
        tools={
          porDecidir > 0 ? (
            <span className="status warn">
              {porDecidir} {porDecidir === 1 ? 'decisión' : 'decisiones'}
            </span>
          ) : undefined
        }
      />

      <div className="page">
        {movimientos === 0 && data.cola.length === 0 && propuestas.length === 0 ? (
          <NoData what="la cola de lo que necesita tu criterio" />
        ) : (
          <>
            <PorQue />

            {/* Cuando la cola del dedup está vacía y hay propuestas debajo, el
                panel no se dibuja: ocupaba 214 px para decir que no hay nada,
                justo encima de las 16 decisiones que sí hay. Si no hay ninguna
                de las dos cosas, sí se dibuja — «no queda nada por decidir» es
                una respuesta y hay que darla. */}
            {(pendientes.length > 0 || propuestas.length === 0) && (
              <Cola
                titulo="Dudas al deduplicar"
                descripcion="Cada fila espera una decisión tuya. Mientras tanto, el movimiento cuenta tal como entró."
                filas={pendientes}
                cuentas={indice}
                accionable
                motivo={motivo}
                vacio="Ninguna fila quedó dudosa al deduplicar. Cuando el motor no se anime a descartar algo, lo va a dejar acá."
              />
            )}

            <Propuestas
              filas={propuestas}
              nombreDeCategoria={nombreDeCategoria}
              motivo={motivo}
              sinCategorizar={data.clasificacion.sinPropuesta}
              tope={TOPE_DE_PROPUESTAS}
            />

            {resueltas.length > 0 && (
              <Cola
                titulo="Ya resueltas"
                descripcion="Quedan a la vista con su evidencia: una decisión que no se puede releer no se puede discutir."
                filas={resueltas}
                cuentas={indice}
                accionable={false}
                motivo={motivo}
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

/* ── Las categorías que el motor propone ─────────────────────────────────── */

/**
 * Sección aparte de la cola del dedup, y a propósito.
 *
 * Son dos preguntas distintas. Arriba se decide **si un movimiento entra al
 * libro**; acá el movimiento ya está dentro y lo que se decide es **en qué
 * categoría va**. Mezclarlas en una tabla obligaría a que «aceptar» significara
 * cosas distintas según la fila, que es justo lo que los rótulos de decisión
 * existen para evitar.
 */
function Propuestas({
  filas,
  nombreDeCategoria,
  motivo,
  sinCategorizar,
  tope,
}: {
  filas: readonly PropuestaAutomatica[]
  nombreDeCategoria: ReadonlyMap<string, string>
  motivo: string | null
  /** Movimientos mirados sobre los que ninguna capa tuvo nada que decir. */
  sinCategorizar: number
  tope: number
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Categorías que el motor propone</h2>
          <p className="small faint">
            El motor no las aplica solo: propone y vos confirmás.{' '}
            <b>A la tercera vez que confirmes el mismo comercio, deja de preguntar</b> y lo
            clasifica solo de ahí en adelante.
          </p>
        </div>
        {filas.length > 0 && (
          <span className="status warn">
            {filas.length} {filas.length === 1 ? 'propuesta' : 'propuestas'}
          </span>
        )}
      </div>

      {filas.length === 0 ? (
        <div className="panel-body">
          <Empty title={sinCategorizar > 0 ? 'Nada que proponer' : 'Todo clasificado'}>
            {sinCategorizar > 0
              ? `Quedan ${sinCategorizar} movimientos sin categorizar y ninguna de las cinco capas se anima a decir de qué son. Una regla tuya los resuelve de golpe.`
              : 'Ningún movimiento espera categoría.'}
          </Empty>
        </div>
      ) : (
        <>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Movimiento</th>
                  <th>Propone</th>
                  <th className="num">Importe</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filas.map((fila) => (
                  <FilaDePropuesta
                    key={`${fila.entryId}-${fila.categoryId}`}
                    fila={fila}
                    categoria={nombreDeCategoria.get(fila.categoryId) ?? 'una categoría tuya'}
                    motivo={motivo}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {filas.length >= tope && (
            <div className="panel-body">
              <div className="banner">
                Se calculan {tope} propuestas por vez. En cuanto decidas éstas aparecen las
                siguientes — no se pierde ninguna, sólo no se calculan todas de golpe.
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function FilaDePropuesta({
  fila,
  categoria,
  motivo,
}: {
  fila: PropuestaAutomatica
  categoria: string
  motivo: string | null
}) {
  // La hoja y no la ruta entera en el botón: «Sí, es Vivienda > Suministros >
  // Luz y gas» no se lee. La ruta completa sí va en la fila, que es donde hay
  // sitio y donde importa saber de qué rama cuelga.
  const hoja = categoria.slice(categoria.lastIndexOf('>') + 1).trim()

  return (
    <tr>
      <td className="num faint">{formatDate(fila.movimiento.bookedOn)}</td>
      <td>
        <div>{fila.movimiento.description}</div>
        <div className="small faint">{fila.movimiento.accountName}</div>
      </td>
      <td>
        <div>
          <b>{categoria}</b>
        </div>
        <div className="small faint">
          Lo sugiere {CAPA[fila.procedencia]}. {fila.motivo}
        </div>
      </td>
      <td className="num">
        <Money amount={fila.movimiento.amount} currency={fila.movimiento.currency} />
      </td>
      <td>
        <DecidirPropuesta
          entryId={fila.entryId}
          categoryId={fila.categoryId}
          categoria={hoja}
          procedencia={fila.procedencia}
          motivo={fila.motivo}
          dimensiones={
            fila.dimensiones.length === 0
              ? ''
              : JSON.stringify(
                  fila.dimensiones.map((d) => ({
                    dimensionId: d.dimensionId,
                    dimensionValueId: d.valueId,
                    weightPpm: d.weightPpm,
                  })),
                )
          }
          bloqueado={motivo}
        />
      </td>
    </tr>
  )
}

/* ── Por qué existe esta pantalla ────────────────────────────────────────── */

function PorQue() {
  return (
    <Plegable clave="revisar/dedup" pregunta="¿Por qué el motor no descarta estos solo?">
      <p className="lede">
        La deduplicación corre en dos pasadas. La primera compara identidad exacta —misma cuenta,
        misma fecha, mismo importe, mismo descriptor normalizado— y ahí sí descarta sola: dos filas
        idénticas del mismo extracto son la misma fila.
      </p>
      <p className="small">
        La segunda es difusa: mira una ventana de días alrededor y la similitud del texto.{' '}
        <b>Esa pasada nunca descarta sola.</b> Dos cargos de 84,20 € en la misma tarjeta el mismo
        día pueden ser un error del banco o pueden ser dos compras reales, y la diferencia no está
        en los datos: está en tu memoria. Un sistema que elige por su cuenta acierta casi siempre, y
        el «casi» es plata que desaparece del libro sin que nadie lo note.
      </p>
      <p className="small">
        Lo mismo con las transferencias sin par y con lo que no se puede categorizar: se marca y se
        muestra, no se adivina. Por eso esta cola es corta y por eso vale la pena mirarla.
      </p>
    </Plegable>
  )
}

/* ── La cola ─────────────────────────────────────────────────────────────── */

function Cola({
  titulo,
  descripcion,
  filas,
  cuentas,
  accionable,
  motivo,
  vacio,
}: {
  titulo: string
  descripcion: string
  filas: readonly ReviewRow[]
  cuentas: ReadonlyMap<string, string>
  accionable: boolean
  /** Por qué este rol no puede resolver, o null si sí puede. */
  motivo: string | null
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
                  <Fila
                    key={fila.id}
                    fila={fila}
                    cuentas={cuentas}
                    accionable={accionable}
                    motivo={motivo}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {accionable && filas.length > 0 && (
        <div className="panel-foot">
          Las dos decisiones se escriben con tu nombre y la hora. En las filas cuyo movimiento
          todavía <b>no está en el libro</b> —los duplicados probables, que la importación dejó
          fuera a propósito— aceptar además lo asienta: crea el asiento con sus dos patas a partir
          de la transacción guardada en la evidencia. Rechazar no borra nada de lo que ya está
          dentro; la fila se queda a la vista, resuelta y con su evidencia.
        </div>
      )}
    </section>
  )
}

function Fila({
  fila,
  cuentas,
  accionable,
  motivo,
}: {
  fila: ReviewRow
  cuentas: ReadonlyMap<string, string>
  accionable: boolean
  motivo: string | null
}) {
  const evidencia = leerEvidencia(fila.evidence)
  const explicacion = explicacionTipo(fila.kind)

  // La fila que espera fuera del libro no tiene asiento, así que `reviewQueue`
  // no le puede dar ni fecha, ni importe, ni descripción: los tres están dentro
  // de la evidencia. Sin leerlos de ahí, esta pantalla le estaría pidiendo a
  // alguien que decida sobre una fila en blanco.
  const espera = leerTransaccionEnEspera(fila.evidence, fila.entryId)
  const enEspera = espera.tipo === 'lista' ? espera.transaccion : null
  const fueraDelLibro = espera.tipo === 'lista' || espera.tipo === 'rota'

  const descripcion = fila.description ?? enEspera?.description ?? 'Sin descripción'
  const fecha = fila.bookedOn ?? enEspera?.bookedOn ?? null
  const importe = fila.amount ?? enEspera?.amount ?? null
  const moneda = fila.currency ?? enEspera?.currency ?? null

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
        <b>{descripcion}</b>
        <div className="small faint">
          {fecha === null ? 'sin fecha' : formatDate(fecha, 'long')}
        </div>
        {fueraDelLibro && (
          <div className="small faint" style={{ maxWidth: '30ch' }}>
            Todavía fuera del libro: no cuenta en ningún saldo hasta que decidas.
          </div>
        )}
        {espera.tipo === 'rota' && (
          <div className="small neg" style={{ maxWidth: '30ch' }}>
            La transacción guardada no se puede leer ({espera.motivo}), así que no se va a poder
            asentar.
          </div>
        )}
      </td>

      <td>{fila.accountName ?? <span className="faint">—</span>}</td>

      <td className="r">
        {importe === null || moneda === null ? (
          <span className="faint">—</span>
        ) : (
          <Money amount={importe} currency={moneda} tone="flow" />
        )}
      </td>

      <td>
        <Evidencia evidencia={evidencia} />
      </td>

      <td className="r">
        <div className="stack" style={{ gap: 'var(--s1)', alignItems: 'flex-end' }}>
          <EnRegistro cuentas={cuentas} accountName={fila.accountName} bookedOn={fila.bookedOn} />
          {accionable ? (
            <Decidir
              id={fila.id}
              rotulos={rotulosDeDecision(fila.kind, fueraDelLibro)}
              motivo={motivo}
            />
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
