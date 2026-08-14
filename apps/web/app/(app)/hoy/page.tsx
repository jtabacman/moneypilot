import { addDays, differenceInDays, parsePlainDate } from '@moneypilot/core'
import {
  type AccountBalance,
  accountBalances,
  type ReviewRow,
  recurring,
  reviewQueue,
} from '@moneypilot/db'
import Link from 'next/link'
import { Fragment, type ReactNode } from 'react'
import { readHousehold, today } from '@/lib/data'
import { formatDate } from '@/lib/format'
import { navItem } from '@/lib/nav'
import { NoData } from '../empty-state'
import { indiceDeCuentas } from '../revisar/accounts'
import { etiquetaTipo } from '../revisar/kinds'
import { EnRegistro } from '../revisar/links'
import { Empty, Money, PageBar, StackedBars } from '../ui'
import { type Alerta, alertas, type Comprobacion, comprobacion, type Destino } from './alerts'
import { type CarrilCaja, carrilesDeCaja } from './lanes'
import styles from './page.module.css'
import {
  type CargoProyectado,
  type CarrilProyeccion,
  type FueraDeProyeccion,
  proyectar,
  SEMANAS,
} from './projection'

export const dynamic = 'force-dynamic'

const ITEM = navItem('/hoy')

/** Cuántos cargos futuros se listan debajo del gráfico antes de mandar al listado. */
const CARGOS_VISIBLES = 12

/**
 * Tope de la cola que se lee para contar.
 *
 * Si se alcanza, el número deja de ser un número y pasa a ser "más de 200".
 * Enseñar 200 cuando hay 340 es dar por completo un recuento que no lo está, y
 * es el mismo error que el producto denuncia en los totales a los que les
 * faltan movimientos.
 */
const TOPE_COLA = 200

/** Filas de la cola que se enseñan en la portada. El resto se declara al pie. */
const MUESTRA_COLA = 3

export default async function HoyPage() {
  const hoy = today()

  const { data } = await readHousehold(async (client) => {
    // Una sola transacción y una sola ida a la base: las tres lecturas son
    // independientes entre sí y ninguna depende del resultado de otra. Aun
    // así van en serie, porque comparten cliente —una transacción, una
    // conexión— y pg las encola igual: Promise.all daba paralelismo aparente y
    // un aviso de query concurrente sobre un cliente ocupado, que en pg@9 será
    // un error.
    const cuentas = await accountBalances(client, { asOf: hoy })
    const recurrentes = await recurring(client, { asOf: hoy })
    const pendientes = await reviewQueue(client, { state: 'pendiente', limit: TOPE_COLA })
    return { cuentas, recurrentes, pendientes }
  })

  const movimientos = data.cuentas.reduce((total, cuenta) => total + cuenta.movements, 0)
  const colaTruncada = data.pendientes.length >= TOPE_COLA

  if (movimientos === 0) {
    return (
      <>
        <Cabecera pendientes={data.pendientes.length} truncada={colaTruncada} />
        <div className="page">
          <NoData what="tu liquidez, lo que viene y lo que necesita tu criterio" />
        </div>
      </>
    )
  }

  const monetarias = data.cuentas.filter(
    (cuenta) => cuenta.kind === 'asset' || cuenta.kind === 'liability',
  )
  const abiertas = monetarias.filter((cuenta) => cuenta.closedAt === null)
  const carriles = carrilesDeCaja(data.cuentas)

  const avisos = alertas({
    cuentas: monetarias,
    recurrentes: data.recurrentes,
    pendientes: data.pendientes,
    // Los enlaces de una serie abren el último año: con menos historia no se
    // ve el patrón que motivó el aviso.
    desde: addDays(parsePlainDate(hoy), -365),
    colaTruncada,
  })

  const proyeccion = proyectar(data.recurrentes, carriles, hoy)

  return (
    <>
      <Cabecera pendientes={data.pendientes.length} truncada={colaTruncada} />

      <div className="page">
        <Liquidez lanes={carriles} hoy={hoy} />

        <Alertas avisos={avisos} cobertura={comprobacion(monetarias)} />

        <Proyeccion
          carriles={proyeccion.carriles}
          desde={proyeccion.desde}
          hasta={proyeccion.hasta}
          fuera={proyeccion.fuera}
          hayCargos={proyeccion.hayCargos}
        />

        <Bandeja
          pendientes={data.pendientes}
          cuentas={indiceDeCuentas(monetarias)}
          truncada={colaTruncada}
        />

        <Conexiones cuentas={abiertas} hoy={hoy} />
      </div>
    </>
  )
}

function Cabecera({ pendientes, truncada }: { pendientes: number; truncada: boolean }) {
  return (
    <PageBar
      title={ITEM?.label ?? 'Hoy'}
      blurb={ITEM?.blurb ?? 'Liquidez por moneda, lo que viene y lo que necesita tu criterio.'}
      tools={
        <>
          <Link href="/cuentas" className="btn">
            Cuentas
          </Link>
          <Link href="/revisar" className="btn">
            Revisar{pendientes > 0 ? ` (${truncada ? `${pendientes}+` : pendientes})` : ''}
          </Link>
        </>
      }
    />
  )
}

/* ── Enlace al registro ──────────────────────────────────────────────────── */

/**
 * Todo número de esta pantalla se abre acá. El destino va como objeto y no
 * como cadena armada a mano para que sea Next quien codifique los acentos y
 * los espacios del nombre del comercio.
 *
 * `transferencias=1` siempre: el filtro por defecto de /movimientos esconde las
 * patas de traspaso, y un enlace que lleva a una lista donde el movimiento que
 * lo motivó no aparece es peor que no tener enlace.
 */
function VerMovimientos({
  children,
  className,
  cuenta,
  texto,
  desde,
  hasta,
}: {
  children: ReactNode
  // `string | undefined` explícito: las clases de un CSS module se tipan así y
  // con exactOptionalPropertyTypes un `className?: string` a secas no las toma.
  className?: string | undefined
  cuenta?: string
  texto?: string
  desde?: string
  hasta?: string
}) {
  const query: Record<string, string> = { transferencias: '1' }
  if (cuenta !== undefined) query['cuenta'] = cuenta
  if (texto !== undefined) query['q'] = texto
  if (desde !== undefined) query['desde'] = desde
  if (hasta !== undefined) query['hasta'] = hasta

  return (
    <Link href={{ pathname: '/movimientos', query }} className={className}>
      {children}
    </Link>
  )
}

function EnlaceDestino({ destino, children }: { destino: Destino; children: ReactNode }) {
  if (destino.tipo === 'revisar') {
    return (
      <Link href="/revisar" className="ghost">
        {children}
      </Link>
    )
  }
  if (destino.tipo === 'cuenta') {
    return (
      <VerMovimientos className="ghost" cuenta={destino.cuentaId}>
        {children}
      </VerMovimientos>
    )
  }
  return (
    <VerMovimientos
      className="ghost"
      cuenta={destino.cuentaId}
      texto={destino.texto}
      desde={destino.desde}
    >
      {children}
    </VerMovimientos>
  )
}

/* ── Liquidez por moneda ─────────────────────────────────────────────────── */

function Liquidez({ lanes, hoy }: { lanes: readonly CarrilCaja[]; hoy: string }) {
  const corruptas = lanes.filter((lane) => lane.foreignPostings > 0)

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Liquidez por moneda</h2>
        <small>Cuentas de activo abiertas · al {formatDate(hoy, 'long')}</small>
      </div>

      {lanes.length === 0 ? (
        <Empty title="No hay caja que contar">
          Ninguna cuenta de activo abierta. Las tarjetas y los préstamos son deuda, no liquidez, y
          por eso no suman acá.
        </Empty>
      ) : (
        <div className="tiles">
          {lanes.map((lane) => (
            <div className="tile" key={lane.currency}>
              <div className="k">{lane.currency}</div>
              <div className="v">
                {/* El número más grande de la pantalla también se abre: el
                    carril es la suma de sus cuentas y el enlace lleva a
                    exactamente esas, hasta la transacción. */}
                <VerMovimientos className={styles.cifra} cuenta={lane.accountIds.join(',')}>
                  <Money amount={lane.total} currency={lane.currency} />
                </VerMovimientos>
              </div>
              <div className="sub">
                {lane.accounts} {lane.accounts === 1 ? 'cuenta' : 'cuentas'}
              </div>
            </div>
          ))}
        </div>
      )}

      {corruptas.length > 0 && (
        <div className="panel-body">
          <div className="error">
            <b>Hay caja que no está contada.</b>{' '}
            {corruptas
              .map((lane) => `${lane.foreignPostings} en el carril ${lane.currency}`)
              .join(', ')}
            : son movimientos anotados en una moneda distinta a la de su cuenta y por eso quedan
            fuera del total. Una cuenta tiene una sola moneda; esto no es un cambio de divisa, es un
            dato que hay que corregir en el origen.
          </div>
        </div>
      )}

      <div className="panel-foot">
        Sin consolidar, a propósito: tener 50.000 € y −50.000 US$ no es tener cero, es tener un
        problema de liquidez en dólares. <Link href="/cuentas">Ver el detalle por cuenta</Link>.
      </div>
    </section>
  )
}

/* ── Alertas abiertas ────────────────────────────────────────────────────── */

function Alertas({ avisos, cobertura }: { avisos: readonly Alerta[]; cobertura: Comprobacion }) {
  const sinComprobar = cobertura.sinDeclarar + cobertura.incompletas

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Alertas abiertas</h2>
        <small>Como mucho tres</small>
      </div>

      {avisos.length === 0 ? (
        <Empty title="Nada que reclame tu atención">
          {cobertura.comprobadas === 0
            ? 'Ninguna obligación recurrente cambió y no hay nada esperando tu criterio. Del banco no se puede decir nada: ninguna cuenta se pudo comprobar.'
            : `Ninguna de las ${cobertura.comprobadas} ${cobertura.comprobadas === 1 ? 'cuenta que se pudo comprobar se aparta' : 'cuentas que se pudieron comprobar se apartan'} del saldo del banco, ninguna obligación recurrente cambió y no hay nada esperando tu criterio.`}
        </Empty>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Qué pasa</th>
                <th scope="col" className="r">
                  Importe
                </th>
                <th scope="col">
                  <span className={styles.oculto}>Dónde se resuelve</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {avisos.map((aviso) => (
                <tr key={aviso.clave}>
                  <td>
                    <div className="row" style={{ gap: 'var(--s2)' }}>
                      <span className={`status ${aviso.tono}`}>{aviso.etiqueta}</span>
                      <b>{aviso.titulo}</b>
                    </div>
                    <div className="small faint">{aviso.detalle}</div>
                  </td>
                  <td className="r">
                    {aviso.importe === null || aviso.moneda === null ? (
                      <span className="faint">—</span>
                    ) : (
                      <Money amount={aviso.importe} currency={aviso.moneda} />
                    )}
                  </td>
                  <td className="r">
                    <EnlaceDestino destino={aviso.destino}>{aviso.accion}</EnlaceDestino>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* La cobertura va con el panel, no escondida en una nota: sin ella, "no
          hay descuadres" se lee como "todo cuadra", y una cuenta cuyo banco
          nunca declaró un saldo no cuadra ni deja de cuadrar — no se comprobó.
          Es el mismo fallo que el producto denuncia en un total al que le
          faltan movimientos. */}
      {/* Las comprobadas sólo contra el agregador se dicen SIEMPRE, aunque no
          falte ninguna: «cuadra con lo que el banco dijo hace tres minutos» es
          la afirmación más fuerte que hace este producto, y hasta ahora estaba
          calculada y escondida detrás de un «no se pudo comprobar». */}
      {cobertura.comprobadasPorFeed > 0 && (
        <div className="panel-body">
          <div className="banner">
            <b>
              {cobertura.comprobadasPorFeed} de {cobertura.total}{' '}
              {cobertura.comprobadasPorFeed === 1 ? 'cuenta cuadra' : 'cuentas cuadran'} con el
              saldo que el agregador leyó del banco.
            </b>{' '}
            No tienen extracto declarado —nadie subió uno— pero sí una lectura del banco con su
            hora, y el libro suma exactamente eso. Es una comprobación distinta de la de un
            extracto, no más floja: lo que no prueba es el cierre de un día, porque una lectura es
            de un instante.
          </div>
        </div>
      )}

      {sinComprobar > 0 && (
        <div className="panel-body">
          <div className="notice">
            <b>
              {sinComprobar} de {cobertura.total}{' '}
              {cobertura.total === 1 ? 'cuenta no se pudo' : 'cuentas no se pudieron'} comprobar
              contra ningún saldo del banco.
            </b>{' '}
            {cobertura.sinDeclarar > 0 && (
              <>
                {cobertura.sinDeclarar}{' '}
                {cobertura.sinDeclarar === 1
                  ? 'no tiene ni extracto declarado ni lectura de un agregador'
                  : 'no tienen ni extracto declarado ni lectura de un agregador'}
                .{' '}
              </>
            )}
            {cobertura.incompletas > 0 && (
              <>
                {cobertura.incompletas}{' '}
                {cobertura.incompletas === 1
                  ? 'tiene movimientos anotados en otra moneda, así que su saldo está incompleto'
                  : 'tienen movimientos anotados en otra moneda, así que su saldo está incompleto'}
                .{' '}
              </>
            )}
            No aparecen acá porque no hay nada que comparar, no porque estén bien.{' '}
            <Link href="/cuentas">Ver saldos y reconciliación</Link>.
          </div>
        </div>
      )}

      <div className="panel-foot">
        Un descuadre va siempre primero aunque sea de cuatro euros: no dice que gastaste de más,
        dice que el libro y el banco no coinciden, y de eso depende cualquier otro número de esta
        pantalla. El resto se ordena por importe.
      </div>
    </section>
  )
}

/* ── Proyección a 13 semanas ─────────────────────────────────────────────── */

function Proyeccion({
  carriles,
  desde,
  hasta,
  fuera,
  hayCargos,
}: {
  carriles: readonly CarrilProyeccion[]
  desde: string
  hasta: string
  fuera: FueraDeProyeccion
  hayCargos: boolean
}) {
  const proximos = carriles
    .flatMap((carril) => carril.cargos)
    .sort((a, b) => (a.on === b.on ? a.merchant.localeCompare(b.merchant) : a.on < b.on ? -1 : 1))

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Proyección a {SEMANAS} semanas</h2>
        <small>
          {formatDate(desde, 'long')} — {formatDate(hasta, 'long')}
        </small>
      </div>

      <div className="panel-body">
        <div className="banner">
          <b>Esto no es una predicción.</b> Es el saldo de hoy menos las obligaciones recurrentes
          que ya se detectaron, repetidas por su frecuencia. Y sólo cuenta cargos: el motor de
          recurrentes mira el lado del pago, así que <b>los ingresos no entran</b> y el carril sólo
          puede bajar. Sirve para preguntarse si la caja aguanta lo que ya se sabe que viene, no
          para saber cuánto vas a tener.
        </div>
      </div>

      {!hayCargos && (
        <Empty title="Todavía no hay obligaciones que proyectar">
          Hacen falta al menos tres cargos del mismo comercio en la misma cuenta para que una serie
          se dé por confirmada. Con menos, la próxima fecha sería el eco de una casualidad.
        </Empty>
      )}

      {hayCargos &&
        carriles.map((carril) => (
          <Fragment key={carril.currency}>
            <div className="tiles">
              <div className="tile">
                <div className="k">Caja hoy · {carril.currency}</div>
                <div className="v">
                  <VerMovimientos
                    className={styles.cifra}
                    cuenta={carril.accountIds.join(',')}
                    hasta={desde}
                  >
                    <Money amount={carril.saldoHoy} currency={carril.currency} />
                  </VerMovimientos>
                </div>
                <div className="sub">
                  {carril.cuentas} {carril.cuentas === 1 ? 'cuenta' : 'cuentas'}
                </div>
              </div>
              <div className="tile">
                <div className="k">Salidas ya conocidas</div>
                <div className="v">
                  <Money amount={carril.salidaTotal} currency={carril.currency} />
                </div>
                <div className="sub">
                  {carril.series} {carril.series === 1 ? 'serie' : 'series'} ·{' '}
                  {carril.cargos.length} {carril.cargos.length === 1 ? 'cargo' : 'cargos'}
                </div>
              </div>
              <div className="tile">
                <div className="k">Caja a {SEMANAS} semanas</div>
                <div className="v">
                  <Money amount={carril.saldoFinal} currency={carril.currency} tone="flow" />
                </div>
                <div className="sub">si no entra nada</div>
              </div>
            </div>

            {/* El punto de partida es el saldo de hoy: si a ese saldo le faltan
                postings, todo el carril arranca torcido y las trece semanas
                heredan el error. */}
            {carril.foreignPostings > 0 && (
              <div className="panel-body">
                <div className="error">
                  <b>El punto de partida del carril {carril.currency} está incompleto.</b>{' '}
                  {carril.foreignPostings}{' '}
                  {carril.foreignPostings === 1
                    ? 'movimiento de esas cuentas está anotado en otra moneda y no entra'
                    : 'movimientos de esas cuentas están anotados en otra moneda y no entran'}{' '}
                  en «Caja hoy», así que tampoco cuentan en la proyección.
                </div>
              </div>
            )}

            {carril.cargos.length > 0 && (
              <div className="panel-body">
                <StackedBars
                  columns={carril.semanas.map((semana) => formatDate(semana.inicio))}
                  series={[
                    {
                      label: `Salida proyectada · ${carril.currency}`,
                      values: carril.semanas.map((semana) => semana.salida),
                    },
                  ]}
                  height={110}
                />
              </div>
            )}
          </Fragment>
        ))}

      {proximos.length > 0 && <LoQueViene cargos={proximos} />}

      <div className="notes">
        <h3>Qué quedó fuera</h3>
        <ul>
          <li>
            Cada serie se proyecta por el importe de su <b>último cargo</b>, en su moneda de
            facturación y sin convertir: comparar una suscripción en dólares contra su equivalente
            en euros fabrica subidas de precio que no ocurrieron.
          </li>
          <li>
            Series recurrentes que no entraron: <b>{fuera.probables}</b> apenas probables (menos de
            tres cargos), <b>{fuera.cesadas}</b> que dejaron de cobrarse, <b>{fuera.sinCaja}</b>{' '}
            cuya moneda de facturación no tiene caja propia contra la que restar y{' '}
            <b>{fuera.sinCargo}</b> cuyo último importe de facturación no es una salida.
          </li>
          <li>
            Los cargos a tarjeta se proyectan el día del cargo y no el día en que se paga el
            resumen: la caja se mueve después, pero se mueve.
          </li>
        </ul>
      </div>
    </section>
  )
}

function LoQueViene({ cargos }: { cargos: readonly CargoProyectado[] }) {
  const visibles = cargos.slice(0, CARGOS_VISIBLES)

  return (
    <>
      <div className="panel-body">
        <span className="label">Lo que viene</span>
        <p className="small" style={{ marginTop: 'var(--s1)' }}>
          Cada cargo suelto que hay detrás del gráfico, en orden de fecha. Se abre en el registro
          filtrado por su cuenta y su comercio, que es donde se comprueba si la serie es lo que
          parece.
        </p>
      </div>

      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Cuándo</th>
              <th scope="col">Qué</th>
              <th scope="col">Cuenta</th>
              <th scope="col" className="r">
                Importe
              </th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((cargo) => (
              <tr key={`${cargo.serie}:${cargo.on}`}>
                <td className="num">{formatDate(cargo.on)}</td>
                <td>
                  <VerMovimientos cuenta={cargo.accountId} texto={cargo.merchant}>
                    {cargo.merchant}
                  </VerMovimientos>
                  <div className="small faint">cada {cargo.frequencyDays} días</div>
                </td>
                <td>{cargo.accountName}</td>
                <td className="r">
                  <Money amount={cargo.amount} currency={cargo.currency} />
                </td>
              </tr>
            ))}
          </tbody>
          {cargos.length > visibles.length && (
            <tfoot>
              <tr>
                <td colSpan={4} className="small">
                  Y {cargos.length - visibles.length} cargos más dentro de la ventana, sumados en el
                  gráfico y en los totales de arriba.
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  )
}

/* ── Bandeja de revisión ─────────────────────────────────────────────────── */

function Bandeja({
  pendientes,
  cuentas,
  truncada,
}: {
  pendientes: readonly ReviewRow[]
  cuentas: ReadonlyMap<string, string>
  truncada: boolean
}) {
  const porTipo = new Map<string, number>()
  for (const fila of pendientes) {
    porTipo.set(fila.kind, (porTipo.get(fila.kind) ?? 0) + 1)
  }
  const visibles = pendientes.slice(0, MUESTRA_COLA)

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Bandeja de revisión</h2>
        <Link href="/revisar" className="ghost">
          Abrir la cola
        </Link>
      </div>

      {pendientes.length === 0 ? (
        <Empty title="Nada esperando tu criterio">
          Todo lo que entró se pudo clasificar solo. Cuando el motor dude, lo va a dejar acá en vez
          de decidir por su cuenta.
        </Empty>
      ) : (
        <>
          <div className="panel-body stack">
            <p className="lede">
              {truncada ? `Más de ${pendientes.length}` : pendientes.length}{' '}
              {pendientes.length === 1 ? 'movimiento necesita' : 'movimientos necesitan'} tu
              criterio.
            </p>
            <div className="row">
              {[...porTipo.entries()].map(([kind, cuantos]) => (
                <span className="status none" key={kind}>
                  {etiquetaTipo(kind)}: {cuantos}
                </span>
              ))}
            </div>
          </div>

          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Movimiento</th>
                  <th scope="col">Cuenta</th>
                  <th scope="col" className="r">
                    Importe
                  </th>
                  <th scope="col">
                    <span className={styles.oculto}>Dónde se resuelve</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((fila) => (
                  <tr key={fila.id}>
                    <td className="num">
                      {fila.bookedOn === null ? (
                        <span className="faint">—</span>
                      ) : (
                        formatDate(fila.bookedOn)
                      )}
                    </td>
                    <td>
                      <Link href="/revisar">{fila.description ?? 'Sin descripción'}</Link>
                      <div className="small faint">{etiquetaTipo(fila.kind)}</div>
                    </td>
                    <td>{fila.accountName ?? <span className="faint">—</span>}</td>
                    <td className="r">
                      {fila.amount === null || fila.currency === null ? (
                        <span className="faint">—</span>
                      ) : (
                        <Money amount={fila.amount} currency={fila.currency} tone="flow" />
                      )}
                    </td>
                    <td className="r">
                      <EnRegistro
                        cuentas={cuentas}
                        accountName={fila.accountName}
                        bookedOn={fila.bookedOn}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* Tres filas debajo de "necesitan tu criterio: 40" se leen como
                  las tres que hay. Decir cuántas quedan cuesta una fila. */}
              {pendientes.length > visibles.length && (
                <tfoot>
                  <tr>
                    <td colSpan={5} className="small">
                      Se enseñan {visibles.length} de{' '}
                      {truncada ? `más de ${pendientes.length}` : pendientes.length}.{' '}
                      <Link href="/revisar">Ver la cola entera</Link>.
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </section>
  )
}

/* ── Estado de las conexiones ────────────────────────────────────────────── */

/** Umbrales de antigüedad, en días. No son ciencia: son lo que se puede defender. */
const AL_DIA = 10
const TIBIA = 45

function Conexiones({ cuentas, hoy }: { cuentas: readonly AccountBalance[]; hoy: string }) {
  const filas = cuentas
    .map((cuenta) => ({ cuenta, dias: antiguedad(cuenta.lastMovementOn, hoy) }))
    .sort((a, b) => (b.dias ?? Number.MAX_SAFE_INTEGER) - (a.dias ?? Number.MAX_SAFE_INTEGER))

  const desactualizadas = filas.filter((fila) => fila.dias === null || fila.dias > TIBIA).length

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Estado de las cuentas</h2>
        <small>
          {filas.length === 0
            ? 'ninguna cuenta abierta'
            : desactualizadas > 0
              ? `${desactualizadas} sin datos recientes`
              : 'todas con datos recientes'}
        </small>
      </div>

      <div className="panel-body">
        <div className="notice">
          <b>Todavía no hay conexiones bancarias automáticas.</b> Todo entra por archivo importado,
          así que no hay un estado de conexión que consultar. Lo que sí se puede medir —y es la
          misma pregunta— es hace cuánto que no entra un movimiento en cada cuenta.
        </div>
      </div>

      {filas.length === 0 ? (
        <Empty title="No queda ninguna cuenta abierta">
          Hay movimientos en el libro, pero todas las cuentas de dinero están cerradas. Mientras sea
          así, no hay nada cuya antigüedad medir.
        </Empty>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Cuenta</th>
                <th scope="col">Moneda</th>
                <th scope="col">Último movimiento</th>
                <th scope="col" className="r">
                  Hace
                </th>
                <th scope="col" className="r">
                  Movimientos
                </th>
                <th scope="col">
                  <span className={styles.oculto}>Frescura</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filas.map(({ cuenta, dias }) => (
                <tr key={cuenta.id}>
                  <td>
                    <VerMovimientos cuenta={cuenta.id}>{cuenta.name}</VerMovimientos>
                    {cuenta.institution !== null && (
                      <div className="small faint">{cuenta.institution}</div>
                    )}
                  </td>
                  <td>{cuenta.currency}</td>
                  <td className="num">
                    {cuenta.lastMovementOn === null ? (
                      <span className="faint">nunca</span>
                    ) : (
                      formatDate(cuenta.lastMovementOn, 'long')
                    )}
                  </td>
                  <td className="r">
                    {dias === null ? <span className="faint">—</span> : `${dias} d`}
                  </td>
                  <td className="r num">
                    {cuenta.movements}
                    {/* El recuento es de todos los movimientos; el saldo, sólo
                        de los que están en la moneda de la cuenta. Cuando esos
                        dos números no hablan del mismo conjunto hay que
                        decirlo donde se ve el conteo. */}
                    {cuenta.foreignPostings > 0 && (
                      <div className="small">
                        <span className="status bad">
                          {cuenta.foreignPostings} en otra moneda, fuera del saldo
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="r">
                    <Frescura dias={dias} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel-foot">
        Una cuenta vieja no está rota: el efectivo de Miami se mueve cuando alguien viaja. Lo que
        dice esta tabla es cuánta de tu foto está construida con datos de hace meses.{' '}
        <Link href="/cuentas">Ver saldos y reconciliación</Link>.
      </div>
    </section>
  )
}

function Frescura({ dias }: { dias: number | null }) {
  if (dias === null) return <span className="status none">sin movimientos</span>
  if (dias <= AL_DIA) return <span className="status ok">al día</span>
  if (dias <= TIBIA) return <span className="status warn">sin novedades</span>
  return <span className="status bad">desactualizada</span>
}

/**
 * Días entre el último movimiento y hoy, sobre strings.
 *
 * Ni un `new Date(iso)` en toda la página: en un huso al oeste de Greenwich eso
 * devuelve el día anterior, y una tabla de antigüedad que se corre un día es
 * exactamente el error que nadie va a notar hasta que importe.
 */
function antiguedad(iso: string | null, hoy: string): number | null {
  if (iso === null) return null
  return differenceInDays(parsePlainDate(iso), parsePlainDate(hoy))
}
