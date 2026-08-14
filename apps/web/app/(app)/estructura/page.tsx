import {
  type AccountBalance,
  accountBalances,
  dimensionsWithValues,
  type LiquidityLane,
  liquidityByCurrency,
  type NetWorthAttribution,
  type NetWorthPoint,
  netWorthAttribution,
  netWorthSeries,
  type RecurringRow,
  recurring,
  type SpendByDimensionRow,
  spendByDimension,
} from '@moneypilot/db'
import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'
import { addMonths, lastDayOfMonth, monthOf, readHousehold, today, trailing12 } from '@/lib/data'
import { formatDate, formatMonth } from '@/lib/format'
import { navItem } from '@/lib/nav'
import { NoData } from '../empty-state'
import { Coverage, Delta, Money, PageBar } from '../ui'
import styles from './page.module.css'

export const dynamic = 'force-dynamic'

const NAV = navItem('/estructura')

/**
 * Los enlaces que salen de un SALDO llevan las patas de traspaso puestas.
 *
 * /movimientos las esconde por defecto, y para un flujo está bien: las dos
 * patas de un traspaso interno no son gasto ni ingreso. Pero un patrimonio sí
 * las incluye —mover plata entre dos cuentas propias cambia las dos a la vez—
 * así que sin ellas la lista que se abre no suma el número sobre el que se
 * hizo click, y no habría forma de saber por qué.
 */
const CON_TRASPASOS = 'transferencias=1'

export default async function EstructuraPage() {
  const asOf = today()
  const periodo = trailing12(asOf)
  // El día anterior al período. Es la fecha exacta del saldo de apertura del
  // waterfall, y por eso es el filtro del enlace de la barra "Inicio".
  const vispera = lastDayOfMonth(addMonths(monthOf(periodo.from), -1))

  const { session, data } = await readHousehold(async (client, sesion) => {
    const rango = { from: periodo.from, to: periodo.to, currency: sesion.baseCurrency }
    // En serie: las ocho van por el mismo cliente —una transacción, una
    // conexión—, así que pg las encola igual. Promise.all daba paralelismo
    // aparente y un aviso de query concurrente sobre un cliente ocupado, que
    // en pg@9 será un error.
    const serie = await netWorthSeries(client, rango)
    const atribucion = await netWorthAttribution(client, rango)
    const entidades = await spendByDimension(client, { ...rango, dimensionKey: 'entidad' })
    const personas = await spendByDimension(client, { ...rango, dimensionKey: 'persona' })
    const liquidez = await liquidityByCurrency(client)
    const cuentas = await accountBalances(client)
    const obligaciones = await recurring(client, { asOf, lookbackMonths: 12 })
    // Sólo para saber si la dimensión EXISTE. Una tabla vacía porque nadie
    // etiquetó nada y una tabla vacía porque el hogar no tiene esa dimensión
    // son dos estados distintos, y sin esto se ven igual.
    const dimensiones = await dimensionsWithValues(client)
    return { serie, atribucion, entidades, personas, liquidez, cuentas, obligaciones, dimensiones }
  })

  const base = session.baseCurrency
  const { serie, atribucion, cuentas } = data

  const bar = (
    <PageBar
      title={NAV?.label ?? 'Estructura'}
      blurb={NAV?.blurb ?? 'Patrimonio, de dónde vino la variación y cuánto fue tipo de cambio.'}
      tools={
        <span className="small faint">
          {periodo.label} · {formatMonth(monthOf(periodo.from))} a{' '}
          {formatMonth(monthOf(periodo.to))}
        </span>
      }
    />
  )

  if (cuentas.every((cuenta) => cuenta.movements === 0)) {
    return (
      <>
        {bar}
        <div className="page">
          <NoData what="tu patrimonio y de dónde vino su variación" />
        </div>
      </>
    )
  }

  const ultimo = serie.at(-1)
  const variacion = atribucion.closing - atribucion.opening
  const rangoQs = `desde=${periodo.from}&hasta=${periodo.to}`
  const abiertas = cuentas.filter((c) => c.kind === 'asset' && c.closedAt === null).length
  const pasivos = cuentas.filter((c) => c.kind === 'liability').length
  const claves = new Set(data.dimensiones.map((dimension) => dimension.key))
  // Las cuatro cifras salen de dos lecturas distintas —la atribución y la
  // serie— y cada una cuenta su propio hueco de conversión. Se declara el
  // mayor: anunciar el menor sería prometer una cobertura que no hay.
  const sinConvertir = Math.max(atribucion.unconverted, ultimo?.unconverted ?? 0)

  return (
    <>
      {bar}
      <div className="page">
        <section className="panel">
          <div className="tiles">
            {/*
              Las cuatro cifras se abren, cada una por donde de verdad se
              explica: el patrimonio y la variación tienen un filtro de fecha
              exacto en Movimientos; activos y deuda no tienen uno —son la suma
              de un montón de cuentas— así que bajan a la tabla por moneda, que
              es donde cada cuenta sí se puede abrir.
            */}
            {/* El protagonista: la pantalla se llama Estructura y su pregunta es
                cuánto hay. La variación y sus causas son el contexto. */}
            <div className="tile hero">
              <div className="k">Patrimonio neto</div>
              <div className="v">
                <Link
                  className={styles.tileLink}
                  href={`/movimientos?hasta=${periodo.to}&${CON_TRASPASOS}`}
                >
                  <Money amount={atribucion.closing} currency={base} />
                </Link>
              </div>
              {/*
                La fecha es el corte del período, no el día de hoy. El período
                llega al último día del mes en curso, así que si el libro tiene
                asientos con fecha posterior a hoy —una domiciliación ya
                anotada— están dentro de esta cifra. Fecharla "al día de hoy"
                sería fechar un número que incluye mañana.
              */}
              <div className="sub">al {formatDate(periodo.to, 'long')}</div>
            </div>
            <div className="tile">
              <div className="k">Activos</div>
              <div className="v">
                <a className={styles.tileLink} href="#monedas">
                  <Money amount={ultimo?.assets ?? 0n} currency={base} />
                </a>
              </div>
              <div className="sub">
                {abiertas} cuenta{abiertas === 1 ? '' : 's'} de activo abierta
                {abiertas === 1 ? '' : 's'}
              </div>
            </div>
            <div className="tile">
              <div className="k">Deuda</div>
              <div className="v">
                <a className={styles.tileLink} href="#monedas">
                  <Money amount={ultimo?.liabilities ?? 0n} currency={base} />
                </a>
              </div>
              <div className="sub">
                {pasivos} cuenta{pasivos === 1 ? '' : 's'} de pasivo
              </div>
            </div>
            <div className="tile">
              <div className="k">Variación del período</div>
              <div className="v">
                <Link className={styles.tileLink} href={`/movimientos?${rangoQs}&${CON_TRASPASOS}`}>
                  <Money amount={variacion} currency={base} tone="delta" />
                </Link>
              </div>
              <div className="sub">
                <Delta value={variacion} base={atribucion.opening} /> desde{' '}
                {formatMonth(monthOf(periodo.from))}
              </div>
            </div>
          </div>
          <div className="panel-foot">
            <Coverage
              unconverted={sinConvertir}
              currency={base}
              alcance="en los últimos 12 meses"
            />
          </div>
        </section>

        <SeriePanel serie={serie} base={base} />

        <WaterfallPanel
          atribucion={atribucion}
          base={base}
          rangoQs={rangoQs}
          vispera={vispera}
          hasta={periodo.to}
        />

        <div className="grid2">
          <ComposicionPanel
            titulo="Composición por entidad"
            explica="Qué parte del gasto corre por cada sociedad y qué parte es personal."
            filas={data.entidades}
            gastoTotal={atribucion.spending}
            base={base}
            rangoQs={rangoQs}
            clave="entidad"
            existe={claves.has('entidad')}
          />
          <ComposicionPanel
            titulo="Composición por propietario"
            explica="La dimensión «persona»: quién genera el gasto, no quién lo paga."
            filas={data.personas}
            gastoTotal={atribucion.spending}
            base={base}
            rangoQs={rangoQs}
            clave="persona"
            existe={claves.has('persona')}
          />
        </div>

        <MonedasPanel liquidez={data.liquidez} cuentas={cuentas} base={base} />

        <ObligacionesPanel obligaciones={data.obligaciones} rangoQs={rangoQs} />
      </div>
    </>
  )
}

/* ── Serie de patrimonio neto ────────────────────────────────────────── */

function SeriePanel({ serie, base }: { serie: readonly NetWorthPoint[]; base: string }) {
  if (serie.length === 0) return null

  // Escala común: el suelo es el cero salvo que algún patrimonio sea negativo,
  // y el techo es el activo más alto, porque la deuda se apila encima del neto
  // y el alto total de una columna es el activo de ese mes.
  const lo = serie.reduce((min, p) => (p.net < min ? p.net : min), 0n)
  const hi = serie.reduce((max, p) => (p.assets > max ? p.assets : max), 0n)
  const span = hi - lo === 0n ? 1n : hi - lo

  const primero = serie[0]
  const ultimo = serie.at(-1)

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Patrimonio neto</h2>
          <small>
            Un punto por mes. El alto de la columna es el activo; la franja roja de arriba, la
            deuda.
          </small>
        </div>
        <Coverage unconverted={ultimo?.unconverted ?? 0} currency={base} alcance="del último mes" />
      </div>

      <div className="panel-body">
        <div className={styles.series}>
          {serie.map((punto) => (
            <Link
              key={punto.month}
              className={styles.month}
              href={`/movimientos?desde=${punto.month}-01&hasta=${lastDayOfMonth(punto.month)}&${CON_TRASPASOS}`}
              title={formatMonth(punto.month)}
            >
              <span className={styles.track}>
                {lo < 0n && <span className={styles.zero} style={{ bottom: alto(-lo, span) }} />}
                {/*
                  La deuda va PRIMERA y el neto encima, y el orden no es
                  estético. Con patrimonio negativo la deuda arranca en el neto
                  y sube hasta el activo, así que su tramo tapa entero el del
                  neto: pintada después, la columna de un hogar que debe más de
                  lo que tiene se vería sin barra de patrimonio. Las dos ocupan
                  el mismo carril; la que hay que poder ver siempre es el neto.
                */}
                <span
                  className={`${styles.bar} ${styles.debt}`}
                  style={carril(punto.net, punto.liabilities, lo, span)}
                />
                <span
                  className={`${styles.bar} ${styles.net}`}
                  style={carril(punto.net < 0n ? punto.net : 0n, abs(punto.net), lo, span)}
                />
              </span>
              <span className={styles.label}>{mesCorto(punto.month)}</span>
            </Link>
          ))}
        </div>
      </div>

      <div className="panel-foot">
        {primero !== undefined && ultimo !== undefined && (
          <>
            De <Money amount={primero.net} currency={base} /> en {formatMonth(primero.month)} a{' '}
            <Money amount={ultimo.net} currency={base} /> en {formatMonth(ultimo.month)}.{' '}
          </>
        )}
        Cada columna abre ese mes en Movimientos. El patrimonio es un stock: el punto de un mes es
        el saldo de toda la historia hasta su último día, no el movimiento del mes.
      </div>
    </section>
  )
}

/* ── Waterfall de variación ──────────────────────────────────────────── */

interface Paso {
  readonly clave: string
  readonly etiqueta: string
  /** Nivel del acumulado antes y después del paso: la barra ocupa el tramo. */
  readonly desde: bigint
  readonly hasta: bigint
  /** El importe que se escribe encima. Con signo, salvo en las barras total. */
  readonly importe: bigint
  readonly tipo: 'total' | 'flujo' | 'fx'
  readonly qs: string
  readonly ayuda: string
}

function WaterfallPanel({
  atribucion,
  base,
  rangoQs,
  vispera,
  hasta,
}: {
  atribucion: NetWorthAttribution
  base: string
  rangoQs: string
  vispera: string
  hasta: string
}) {
  const n1 = atribucion.opening
  const n2 = n1 + atribucion.contributions
  const n3 = n2 - atribucion.spending
  const n4 = n3 + atribucion.assetRevaluation

  const pasos: readonly Paso[] = [
    {
      clave: 'inicio',
      etiqueta: 'Inicio',
      desde: 0n,
      hasta: n1,
      importe: n1,
      tipo: 'total',
      qs: `hasta=${vispera}&${CON_TRASPASOS}`,
      ayuda: `Patrimonio al ${formatDate(vispera, 'long')}`,
    },
    {
      clave: 'aportes',
      etiqueta: 'Aportes',
      desde: n1,
      hasta: n2,
      importe: atribucion.contributions,
      tipo: 'flujo',
      qs: rangoQs,
      ayuda: 'Ingresos cobrados dentro del período',
    },
    {
      clave: 'gastos',
      etiqueta: 'Gastos',
      desde: n2,
      hasta: n3,
      importe: -atribucion.spending,
      tipo: 'flujo',
      qs: rangoQs,
      ayuda: 'Gasto del período. Las transferencias internas no cuentan',
    },
    {
      clave: 'revalorizacion',
      etiqueta: 'Revalorización',
      desde: n3,
      hasta: n4,
      importe: atribucion.assetRevaluation,
      tipo: 'flujo',
      qs: rangoQs,
      ayuda: 'Residuo: lo que movió el patrimonio y no fue ingreso, gasto ni cambio',
    },
    {
      clave: 'fx',
      etiqueta: 'Efecto FX',
      desde: n4,
      hasta: n4 + atribucion.fxEffect,
      importe: atribucion.fxEffect,
      tipo: 'fx',
      qs: rangoQs,
      ayuda: 'Revaluación cambiaria asentada contra Equity:FX-Revaluation',
    },
    {
      clave: 'cierre',
      etiqueta: 'Cierre',
      desde: 0n,
      hasta: atribucion.closing,
      importe: atribucion.closing,
      tipo: 'total',
      qs: `hasta=${hasta}&${CON_TRASPASOS}`,
      ayuda: `Patrimonio al ${formatDate(hasta, 'long')}`,
    },
  ]

  const niveles = [0n, n1, n2, n3, n4, atribucion.closing]
  const lo = niveles.reduce((min, nivel) => (nivel < min ? nivel : min), 0n)
  const hi = niveles.reduce((max, nivel) => (nivel > max ? nivel : max), 0n)
  const span = hi - lo === 0n ? 1n : hi - lo

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>De dónde vino la variación</h2>
          <small>
            Inicio + aportes − gastos + revalorización + FX = cierre. Cierra al céntimo.
          </small>
        </div>
        <Coverage unconverted={atribucion.unconverted} currency={base} alcance="del período" />
      </div>

      <div className="panel-body">
        <div className={styles.waterfall}>
          {pasos.map((paso) => {
            const sinModelar = paso.tipo === 'fx' && !atribucion.fxModelled
            const clase =
              paso.tipo === 'total'
                ? styles.total
                : paso.tipo === 'fx'
                  ? styles.fx
                  : paso.importe < 0n
                    ? styles.down
                    : styles.up

            const cuerpo: ReactNode = (
              <>
                <span className={styles.value}>
                  {sinModelar ? (
                    <span className="faint">sin modelar</span>
                  ) : (
                    <Money
                      amount={paso.importe}
                      currency={base}
                      tone={paso.tipo === 'total' ? 'plain' : 'delta'}
                      symbol={false}
                    />
                  )}
                </span>
                <span className={styles.track}>
                  {lo < 0n && <span className={styles.zero} style={{ bottom: alto(-lo, span) }} />}
                  {sinModelar ? (
                    <span className={styles.unmodelled} />
                  ) : (
                    <span
                      className={`${styles.bar} ${clase}`}
                      style={carril(
                        paso.desde < paso.hasta ? paso.desde : paso.hasta,
                        abs(paso.hasta - paso.desde),
                        lo,
                        span,
                      )}
                    />
                  )}
                </span>
                <span className={styles.label}>{paso.etiqueta}</span>
              </>
            )

            // La barra sin modelar no se enlaza: detrás no hay asientos que
            // abrir, y un enlace que lleva a una lista vacía sugiere que el
            // dato existe y que la búsqueda falló.
            return sinModelar ? (
              <div key={paso.clave} className={styles.col} title={paso.ayuda}>
                {cuerpo}
              </div>
            ) : (
              <Link
                key={paso.clave}
                className={styles.col}
                href={`/movimientos?${paso.qs}`}
                title={paso.ayuda}
              >
                {cuerpo}
              </Link>
            )
          })}
        </div>
      </div>

      {!atribucion.fxModelled && (
        <div className={styles.fxWarning}>
          <b>El efecto cambiario todavía no se está modelando.</b> No es que haya dado cero: este
          hogar no tiene asientos contra <code>Equity:FX-Revaluation</code>, así que la revaluación
          por tipo de cambio no está separada y su efecto queda dentro de la barra de
          revalorización, que es un residuo. Una barra dibujada en cero diría «no hubo efecto FX», y
          lo que pasa es que nadie lo calculó.
        </div>
      )}

      <div className="notes">
        <h3>Cómo se calcula</h3>
        <p>
          <b>
            Los flujos van a la tasa de la fecha, los stocks a la tasa de cierre, y la diferencia es
            el efecto FX.
          </b>{' '}
          La revalorización es un residuo declarado: es todo lo que movió el patrimonio y no fue
          ingreso, gasto ni cambio de moneda —revaluación de activos, sí, pero también asientos de
          apertura—. Se calcula así a propósito, porque si cada barra se computara por su lado la
          suma no daría el saldo final y el waterfall no cerraría, que es la peor forma posible de
          mostrar una cuenta.
        </p>
        <p className={styles.second}>
          Inicio y cierre abren el libro entero hasta su fecha; las barras de flujo abren el período
          completo. Mientras la revaluación no esté asentada posting a posting, el corte por
          concepto vive en la tabla de composición y no en el enlace.
        </p>
      </div>
    </section>
  )
}

/* ── Composición por dimensión ───────────────────────────────────────── */

function ComposicionPanel({
  titulo,
  explica,
  filas,
  gastoTotal,
  base,
  rangoQs,
  clave,
  existe,
}: {
  titulo: string
  explica: string
  filas: readonly SpendByDimensionRow[]
  gastoTotal: bigint
  base: string
  rangoQs: string
  /** La clave de la dimensión, tal como la pide el repositorio. */
  clave: string
  /** ¿El hogar tiene esa dimensión? Ver el vacío de abajo. */
  existe: boolean
}) {
  const atribuido = filas.reduce((suma, fila) => suma + fila.amount, 0n)
  // Lo que la barra de gastos tiene y ninguna etiqueta reclama. Va como una
  // fila más: si se omite, los porcentajes no llegan a 100 y nadie sabe por
  // qué. El signo contrario significa que los pesos atribuyeron de más.
  const resto = gastoTotal - atribuido
  const sinConvertir = filas.reduce((suma, fila) => suma + fila.unconverted, 0)
  const reescalados = filas.reduce((suma, fila) => suma + fila.overAttributed, 0)

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{titulo}</h2>
          <small>{explica}</small>
        </div>
        <Coverage unconverted={sinConvertir} currency={base} alcance="en los últimos 12 meses" />
      </div>

      {filas.length === 0 ? (
        <div className="panel-body">
          {/*
            Dos vacíos que no son el mismo. «Nadie etiquetó gasto» es un hogar
            que tiene la dimensión y no la usó; «la dimensión no existe» es una
            pregunta que este hogar todavía no puede hacerse. Enseñar la misma
            frase para los dos manda al usuario a buscar gasto perdido cuando
            lo que le falta es crear la dimensión.
          */}
          {existe ? (
            <p className="small faint">
              La dimensión «{clave}» existe, pero ningún movimiento del período está atribuido a
              ninguno de sus valores.
            </p>
          ) : (
            <p className="small faint">
              Este hogar no tiene una dimensión «{clave}», así que no hay nada que repartir. No es
              que el gasto no esté: es que todavía nadie creó esta forma de mirarlo.{' '}
              <Link href="/dimensiones">Crear la dimensión</Link>.
            </p>
          )}
        </div>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Valor</th>
                <th scope="col" className="r">
                  Gasto
                </th>
                <th scope="col" className="r">
                  % de la barra
                </th>
                <th scope="col" className="r">
                  Movs.
                </th>
              </tr>
            </thead>
            <tbody>
              {filas.map((fila) => (
                <tr key={fila.valueId}>
                  <td>
                    <Link href={`/movimientos?dimension=${fila.valueId}&${rangoQs}`}>
                      {fila.label}
                    </Link>
                    {fila.overAttributed > 0 && (
                      <span className={styles.under}>
                        <span
                          className="status warn"
                          title="Sus pesos sumaban más del 100% y hubo que reescalarlos: el importe es una interpretación, no un dato."
                        >
                          {fila.overAttributed} reescalado{fila.overAttributed === 1 ? '' : 's'}
                        </span>
                      </span>
                    )}
                  </td>
                  <td className="r money">
                    <Money amount={fila.amount} currency={base} />
                  </td>
                  <td className="r num">{porcentaje(fila.amount, gastoTotal)}</td>
                  <td className="r num">{fila.transactions}</td>
                </tr>
              ))}
              {resto > 0n && (
                <tr>
                  <td>
                    <Link href={`/movimientos?${rangoQs}`}>Sin atribuir</Link>
                    <span className={styles.under}>Gasto que ninguna etiqueta reclama</span>
                  </td>
                  <td className="r money">
                    <Money amount={resto} currency={base} />
                  </td>
                  <td className="r num">{porcentaje(resto, gastoTotal)}</td>
                  <td className="r num faint">—</td>
                </tr>
              )}
              {resto < 0n && (
                <tr>
                  <td>
                    <span className="status warn">Atribuido de más</span>
                    <span className={styles.under}>
                      Las etiquetas reclaman más gasto del que tiene la barra
                    </span>
                  </td>
                  <td className="r money">
                    <Money amount={resto} currency={base} tone="delta" />
                  </td>
                  <td className="r num">{porcentaje(resto, gastoTotal)}</td>
                  <td className="r num faint">—</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td>Barra de gastos</td>
                <td className="r money">
                  <Money amount={gastoTotal} currency={base} />
                </td>
                {/*
                  El 100% se calcula en vez de escribirse. Parece lo mismo hasta
                  que la barra de gastos es cero: escrito a mano, el pie diría
                  «100,0%» de nada, que es un total afirmando una cobertura que
                  no tiene. Calculado, dice «—», igual que las filas de arriba.
                */}
                <td className="r num">{porcentaje(gastoTotal, gastoTotal)}</td>
                <td className="r num" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="panel-foot">
        Sólo la barra de gastos se reparte por dimensión: los aportes y la revalorización no están
        atribuidos, así que esta tabla explica la parte de la variación que se fue en gasto y no la
        variación entera.
        {reescalados > 0 && ' Las filas marcadas llevan importes reescalados.'}
      </div>
    </section>
  )
}

/* ── Distribución por moneda ─────────────────────────────────────────── */

function MonedasPanel({
  liquidez,
  cuentas,
  base,
}: {
  liquidez: readonly LiquidityLane[]
  cuentas: readonly AccountBalance[]
  base: string
}) {
  // Sólo el dinero: activo y pasivo. Las cuentas de gasto, ingreso y las de
  // sistema tienen saldo, pero no son patrimonio. Una cuenta cerrada con saldo
  // distinto de cero sí se muestra: es exactamente lo que hay que poder ver.
  const patrimoniales = cuentas.filter(
    (cuenta) =>
      (cuenta.kind === 'asset' || cuenta.kind === 'liability') &&
      (cuenta.closedAt === null || cuenta.balance !== 0n),
  )

  const monedas = [...new Set(patrimoniales.map((cuenta) => cuenta.currency))].sort((a, b) =>
    a === base ? -1 : b === base ? 1 : a.localeCompare(b),
  )

  return (
    <section className="panel" id="monedas">
      <div className="panel-head">
        <div>
          <h2>Distribución por moneda</h2>
          <small>
            Sin consolidar: el problema de liquidez es por moneda, así que el reporte también.
          </small>
        </div>
      </div>

      <div className="tiles">
        {liquidez.map((lane) => (
          <div className="tile" key={lane.currency}>
            <div className="k">Liquidez {lane.currency}</div>
            <div className="v">
              <Money amount={lane.total} currency={lane.currency} />
            </div>
            <div className="sub">
              {lane.accounts} cuenta{lane.accounts === 1 ? '' : 's'} de activo abierta
              {lane.accounts === 1 ? '' : 's'}
              {lane.foreignPostings > 0 && (
                <>
                  {' · '}
                  <span className="status warn">
                    {lane.foreignPostings} movimientos en otra moneda quedan fuera
                  </span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/*
        Sin cuentas de dinero no se pinta la tabla. Una cabecera sola sobre un
        cuerpo vacío no se lee como «no hay cuentas»: se lee como una tabla que
        no cargó, y son dos cosas distintas.
      */}
      {monedas.length === 0 ? (
        <div className="panel-body">
          <p className="small faint">
            El hogar tiene movimientos, pero ninguna cuenta de activo ni de pasivo con saldo. Es lo
            que se ve cuando el libro entró contra cuentas de gasto e ingreso y todavía no hay
            banco, tarjeta ni efectivo dados de alta.{' '}
            <Link href="/cuentas">Dar de alta una cuenta</Link>.
          </p>
        </div>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Cuenta</th>
                <th scope="col">Institución</th>
                <th scope="col" className="r">
                  Movs.
                </th>
                <th scope="col" className="r">
                  Saldo
                </th>
              </tr>
            </thead>
            {monedas.map((moneda) => {
              const delGrupo = patrimoniales
                .filter((cuenta) => cuenta.currency === moneda)
                .sort((a, b) => (b.balance > a.balance ? 1 : b.balance < a.balance ? -1 : 0))
              const activos = delGrupo
                .filter((cuenta) => cuenta.kind === 'asset')
                .reduce((suma, cuenta) => suma + cuenta.balance, 0n)
              // El saldo de una cuenta de pasivo es negativo cuando se debe, así
              // que la deuda es su opuesto. Si alguna está pagada de más, el
              // signo lo dice en vez de esconderlo con un valor absoluto.
              const deuda = delGrupo
                .filter((cuenta) => cuenta.kind === 'liability')
                .reduce((suma, cuenta) => suma - cuenta.balance, 0n)

              return (
                <tbody key={moneda}>
                  <tr className={styles.group}>
                    <td colSpan={2}>
                      {moneda} · {delGrupo.length} cuenta{delGrupo.length === 1 ? '' : 's'}
                    </td>
                    <td className="r">activos</td>
                    <td className="r money">
                      <Money amount={activos} currency={moneda} />
                    </td>
                  </tr>
                  {delGrupo.map((cuenta) => (
                    <tr key={cuenta.id}>
                      <td>
                        {/*
                        Con traspasos: la columna de al lado es el SALDO de la
                        cuenta, y el saldo los incluye. Sin ellos, la lista que
                        se abre no suma el número que se acaba de tocar.
                      */}
                        <Link href={`/movimientos?cuenta=${cuenta.id}&${CON_TRASPASOS}`}>
                          {cuenta.name}
                        </Link>
                        {cuenta.closedAt !== null && (
                          <span className={styles.under}>
                            <span className="status none">
                              cerrada el {formatDate(cuenta.closedAt)}, con saldo
                            </span>
                          </span>
                        )}
                        {cuenta.foreignPostings > 0 && (
                          <span className={styles.under}>
                            <span className="status warn">
                              {cuenta.foreignPostings} movimientos en otra moneda, fuera del saldo
                            </span>
                          </span>
                        )}
                      </td>
                      <td>
                        {cuenta.institution ?? <span className="faint">—</span>}
                        {cuenta.country !== null && (
                          <span className={styles.under}>{cuenta.country}</span>
                        )}
                      </td>
                      <td className="r num">{cuenta.movements}</td>
                      <td className="r money">
                        <Money amount={cuenta.balance} currency={cuenta.currency} />
                      </td>
                    </tr>
                  ))}
                  <tr className={styles.subtotal}>
                    <td colSpan={3} className="r">
                      Deuda en {moneda}
                    </td>
                    <td className="r money">
                      <Money amount={deuda} currency={moneda} />
                    </td>
                  </tr>
                </tbody>
              )
            })}
          </table>
        </div>
      )}

      <div className="panel-foot">
        No hay total general a propósito: tener 50.000 EUR y −50.000 USD no es tener cero, es tener
        un problema de liquidez en dólares. El saldo de cada cuenta suma sólo los movimientos en su
        propia moneda.
      </div>
    </section>
  )
}

/* ── Obligaciones recurrentes mensualizadas ──────────────────────────── */

/** Series que se listan por moneda. El resto sigue contando en el subtotal. */
const POR_MONEDA = 8

function ObligacionesPanel({
  obligaciones,
  rangoQs,
}: {
  obligaciones: readonly RecurringRow[]
  rangoQs: string
}) {
  if (obligaciones.length === 0) {
    return (
      <section className="panel">
        <div className="panel-head">
          <h2>Obligaciones recurrentes mensualizadas</h2>
        </div>
        <div className="panel-body">
          <p className="small faint">
            Todavía no hay ninguna serie con ocurrencias suficientes para llamarla recurrente. Hacen
            falta al menos dos cargos del mismo proveedor en la misma cuenta.
          </p>
        </div>
      </section>
    )
  }

  const monedas = [...new Set(obligaciones.map((fila) => fila.currency))].sort()
  const grupos = monedas.map((moneda) => {
    /*
      El orden es por peso ABSOLUTO, y esa palabra sostiene el subtotal.
      El detector devuelve también series de importe negativo —una devolución
      periódica, un abono recurrente de la tarjeta— y esas restan del
      compromiso mensual. Ordenando por el importe con signo se van al fondo
      de la lista, así que el recorte a las `POR_MONEDA` primeras las esconde
      justo mientras siguen bajando el total: el usuario ve ocho filas que
      suman más que el número escrito debajo y no hay nada en la pantalla que
      lo explique. Por el valor absoluto, lo que más mueve el subtotal es
      siempre lo que está a la vista, suba o baje.
    */
    const todas = obligaciones
      .filter((fila) => fila.currency === moneda)
      .sort((a, b) => {
        const ma = abs(mensualizar(a.current, a.frequencyDays))
        const mb = abs(mensualizar(b.current, b.frequencyDays))
        return mb > ma ? 1 : mb < ma ? -1 : 0
      })
    const mostradas = todas.slice(0, POR_MONEDA)
    // 'no-cobro' es una serie que dejó de cobrarse: sigue en la tabla porque
    // su desaparición es información, pero no es un compromiso de este mes.
    const vivasGrupo = todas.filter((fila) => fila.state !== 'no-cobro')
    /*
      Las series vivas que el recorte dejó fuera, con lo que aportan.
      El orden por peso hace que casi siempre sean las de menos monta, pero
      «casi siempre» no es una garantía: basta con que varias series apagadas
      —que ocupan sitio y no suman— copen las primeras filas para que una viva
      quede escondida bajando el total. En vez de confiar en el orden, el
      hueco se declara al lado del número, que es la regla de la casa.
    */
    const fuera = vivasGrupo.filter((fila) => !mostradas.includes(fila))
    return {
      moneda,
      todas,
      mostradas,
      fuera: fuera.length,
      mensualFuera: fuera.reduce(
        (suma, fila) => suma + mensualizar(fila.current, fila.frequencyDays),
        0n,
      ),
      mensual: vivasGrupo.reduce(
        (suma, fila) => suma + mensualizar(fila.current, fila.frequencyDays),
        0n,
      ),
    }
  })
  const ocultas = grupos.reduce((suma, g) => suma + (g.todas.length - g.mostradas.length), 0)
  const vivas = obligaciones.filter((fila) => fila.state !== 'no-cobro').length

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Obligaciones recurrentes mensualizadas</h2>
          <small>
            En moneda de facturación y sin convertir: comparar la versión convertida fabrica subidas
            de precio que no ocurrieron.
          </small>
        </div>
        <span className="small faint">
          {vivas} viva{vivas === 1 ? '' : 's'} de {obligaciones.length} serie
          {obligaciones.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Proveedor</th>
              <th scope="col" className="r">
                Cargo
              </th>
              <th scope="col">Frecuencia</th>
              <th scope="col" className="r">
                Equivalente mensual
              </th>
              <th scope="col">Próxima</th>
              <th scope="col">Estado</th>
            </tr>
          </thead>
          {grupos.map((grupo) => (
            <tbody key={grupo.moneda}>
              <tr className={styles.group}>
                <td colSpan={6}>
                  {grupo.moneda} · {grupo.todas.length} serie{grupo.todas.length === 1 ? '' : 's'}
                </td>
              </tr>
              {grupo.mostradas.map((fila) => (
                <tr key={`${fila.currency}:${fila.accountId}:${fila.merchant}`}>
                  <td>
                    {/*
                      El enlace abre la CUENTA y el período, no la serie, y el
                      título lo dice porque la diferencia importa. El proveedor
                      que se ve acá es una etiqueta derivada —los tokens del
                      descriptor, normalizados y en mayúsculas— y no existe como
                      texto en ningún asiento: buscar «CREDITO HABITACAO
                      MILLENNIUM» contra «Crédito habitação Millennium» no
                      devuelve nada. Un filtro por comercio que trae cero filas
                      se lee como «no hay cargos», que es peor que traer de más.
                    */}
                    <Link
                      href={`/movimientos?cuenta=${fila.accountId}&${rangoQs}`}
                      title={`Abre ${fila.accountName} en el período. El corte por proveedor todavía no es un filtro: la serie se detecta al agrupar, no está guardada.`}
                    >
                      {fila.merchant}
                    </Link>
                    <span className={styles.under}>{fila.accountName}</span>
                  </td>
                  <td className="r money">
                    <Money amount={fila.current} currency={fila.currency} />
                    {fila.state === 'subio' && (
                      <span className={styles.under}>
                        <Delta value={fila.current - fila.median} base={fila.median} invert /> vs.
                        mediana
                      </span>
                    )}
                  </td>
                  <td>
                    {frecuencia(fila.frequencyDays)}
                    <span className={styles.under}>
                      cada {fila.frequencyDays} d · {fila.occurrences} cargos
                    </span>
                  </td>
                  {/*
                    La serie que dejó de cobrarse no entra en el subtotal, así
                    que su equivalente mensual va apagado y con el motivo. Es la
                    fila más pesada de la tabla en más de un hogar —una obra que
                    terminó, un colegio que se pagó entero— y escrita igual que
                    las demás hace que la columna no dé el compromiso de abajo
                    sin que nada diga por qué.
                  */}
                  <td className="r money">
                    {fila.state === 'no-cobro' ? (
                      <span
                        className="faint"
                        title="Fuera del compromiso mensual: la serie dejó de cobrarse."
                      >
                        <Money
                          amount={mensualizar(fila.current, fila.frequencyDays)}
                          currency={fila.currency}
                        />
                      </span>
                    ) : (
                      <Money
                        amount={mensualizar(fila.current, fila.frequencyDays)}
                        currency={fila.currency}
                      />
                    )}
                  </td>
                  {/*
                    En una serie que dejó de cobrarse la "próxima" ya pasó: es
                    la fecha en la que se esperaba el cargo que no llegó, y
                    escrita a secas la columna promete un cobro que no va a
                    ocurrir. Se marca como lo que es.
                  */}
                  <td>
                    {fila.state === 'no-cobro' ? (
                      <>
                        <span className="faint">{formatDate(fila.nextExpectedOn)}</span>
                        <span className={styles.under}>
                          se esperaba y no llegó · último cargo {formatDate(fila.lastOn)}
                        </span>
                      </>
                    ) : (
                      <>
                        {formatDate(fila.nextExpectedOn)}
                        {fila.confidence === 'probable' && (
                          <span className={styles.under}>
                            <span
                              className="status none"
                              title="Sólo dos ocurrencias: la serie es apenas probable."
                            >
                              probable
                            </span>
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td>
                    <EstadoSerie estado={fila.state} />
                  </td>
                </tr>
              ))}
              <tr className={styles.subtotal}>
                <td colSpan={3} className="r">
                  Compromiso mensual en {grupo.moneda}
                </td>
                <td className="r money">
                  <Money amount={grupo.mensual} currency={grupo.moneda} />
                </td>
                {/*
                  El subtotal declara la parte que no está en la tabla. «Todas
                  las series vivas» era cierto y aun así no se podía comprobar:
                  quien sumaba a mano las filas visibles no llegaba al número y
                  no tenía forma de saber cuánto faltaba ni de qué signo era.
                */}
                <td colSpan={2} className="small faint">
                  {grupo.fuera === 0 ? (
                    'todas las series vivas están en la tabla'
                  ) : (
                    <>
                      incluye {grupo.fuera} serie{grupo.fuera === 1 ? '' : 's'} viva
                      {grupo.fuera === 1 ? '' : 's'} fuera de la tabla:{' '}
                      <Money amount={grupo.mensualFuera} currency={grupo.moneda} tone="delta" />
                    </>
                  )}
                </td>
              </tr>
            </tbody>
          ))}
        </table>
      </div>

      <div className="panel-foot">
        El equivalente mensual reparte cada cargo sobre 365/12 días, así que un seguro trimestral
        pesa un tercio de lo que se paga. El compromiso suma las series vivas: las que dejaron de
        cobrarse quedan en la tabla porque su desaparición es información, pero apagadas y fuera del
        total. Los subtotales no se suman entre monedas.
        {ocultas > 0 &&
          ` La tabla lista las ${POR_MONEDA} series que más mueven el total de cada moneda —un abono periódico pesa tanto como un cargo, y por eso el orden es por importe absoluto— y deja ${ocultas} fuera. Las que de esas estaban vivas siguen contando, y cada subtotal dice cuántas son y cuánto ponen.`}
      </div>
    </section>
  )
}

function EstadoSerie({ estado }: { estado: RecurringRow['state'] }) {
  if (estado === 'activo') return <span className="status ok">activo</span>
  if (estado === 'subio') return <span className="status warn">subió</span>
  if (estado === 'no-cobro') return <span className="status bad">no cobró</span>
  return (
    <span className="status none" title="Se cobra, pero no está atribuido a ninguna dimensión.">
      huérfano
    </span>
  )
}

/* ── Aritmética de los carriles ──────────────────────────────────────── */

function abs(value: bigint): bigint {
  return value < 0n ? -value : value
}

/** Porcentaje del carril. En enteros por milésimas, sin pasar por float. */
function alto(value: bigint, span: bigint): string {
  return `${Number((value * 1000n) / span) / 10}%`
}

/**
 * Posición y alto de una barra dentro del carril.
 *
 * `piso` es el nivel donde empieza y `largo` cuánto mide, los dos en unidades
 * mínimas y sobre el mismo `lo`/`span` que comparten todas las barras del
 * gráfico. El mínimo de 0,4% hace que un importe chico se vea como una raya en
 * vez de desaparecer — pero sólo si no es cero: un cero exacto se dibuja en
 * cero, porque es un dato y no un redondeo.
 */
function carril(piso: bigint, largo: bigint, lo: bigint, span: bigint): CSSProperties {
  const alturaPct = Number((largo * 1000n) / span) / 10
  return {
    '--bottom': alto(piso - lo, span),
    '--height': largo === 0n ? '0%' : `${Math.max(0.4, alturaPct)}%`,
  } as CSSProperties
}

/** Porcentaje para las tablas, con coma decimal. */
function porcentaje(parte: bigint, total: bigint): string {
  if (total === 0n) return '—'
  return `${(Number((parte * 1000n) / total) / 10).toFixed(1).replace('.', ',')}%`
}

/** Un cargo cada `frequencyDays` días, llevado a su equivalente de un mes. */
function mensualizar(importe: bigint, frequencyDays: number): bigint {
  return (importe * 365n) / (12n * BigInt(Math.max(1, frequencyDays)))
}

function frecuencia(dias: number): string {
  if (dias <= 8) return 'semanal'
  if (dias <= 17) return 'quincenal'
  if (dias <= 45) return 'mensual'
  if (dias <= 100) return 'trimestral'
  if (dias <= 200) return 'semestral'
  return 'anual'
}

/** `2026-08` → `ago`. Doce columnas no dan para escribir el año en cada una. */
function mesCorto(month: string): string {
  return formatMonth(month, 'short').split(' ')[0] ?? month
}
