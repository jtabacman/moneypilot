/**
 * Especímenes: los reportes del producto, dibujados de verdad.
 *
 * La alternativa habitual —tarjetas con un icono y tres líneas de texto— no
 * sirve acá. Lo que vende este producto es el documento que produce, y a este
 * comprador no se le convence describiéndoselo: se le convence enseñándoselo.
 * Cada espécimen es el reporte real a escala reducida, con la misma tipografía
 * y las mismas reglas de formato que va a ver dentro.
 *
 * Los datos son ilustrativos y cada bloque lo dice. Es la misma norma que el
 * producto se aplica a sí mismo: el hueco se declara, nunca se esconde.
 */

import { money, pct } from '@/lib/format'
import styles from './landing.module.css'

const EUR = 'EUR'
const USD = 'USD'

export function DemoTag({ children = 'Ejemplo' }: { children?: string }) {
  return <span className="demo-tag">{children}</span>
}

/* ── R1 · Reconciliación ─────────────────────────────────────────────── */

interface ReconRow {
  readonly account: string
  readonly currency: string
  readonly opening: bigint
  readonly movements: bigint
  readonly declared: bigint
  readonly note?: string
}

const RECON: readonly ReconRow[] = [
  {
    account: 'BBVA · Corriente',
    currency: EUR,
    opening: 1842033n,
    movements: -412887n,
    declared: 1429146n,
  },
  {
    account: 'Santander · Nómina',
    currency: EUR,
    opening: 734512n,
    movements: 189044n,
    declared: 923556n,
  },
  {
    account: 'CaixaBank · Sociedad',
    currency: EUR,
    opening: 8891200n,
    movements: -1204350n,
    declared: 7686850n,
  },
  {
    account: 'Amex · Platinum',
    currency: EUR,
    opening: -318744n,
    movements: -211903n,
    declared: -530647n,
  },
  {
    account: 'Chase · Checking',
    currency: USD,
    opening: 2210488n,
    movements: -338215n,
    declared: 1872273n,
  },
  {
    account: 'Millennium · Lisboa',
    currency: EUR,
    opening: 456700n,
    movements: -98420n,
    declared: 356780n,
    note: 'el extracto de junio llegó cortado a mitad de página',
  },
]

export function ReconciliationSpecimen() {
  const rows = RECON.map((row) => {
    const calculated = row.opening + row.movements
    return { ...row, calculated, delta: calculated - row.declared }
  })
  const cuadran = rows.filter((row) => row.delta === 0n).length

  return (
    <figure className={styles.specimen}>
      <figcaption className={styles.specimenHead}>
        <div>
          <span className="label">Cierre de julio · reconciliación por cuenta</span>
          <h3>Todas las cuentas, o el motivo exacto de la que no</h3>
        </div>
        <DemoTag />
      </figcaption>

      {/*
        Cuatro columnas y no seis. La versión completa del reporte trae también
        saldo inicial y movimientos, pero acá el argumento es "lo que calculamos
        contra lo que dice el banco", y dos columnas intermedias sólo consiguen
        que la del delta —la única que importa— se salga de la caja.
      */}
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Cuenta</th>
              <th className="r">Calculado</th>
              <th className="r">Real del banco</th>
              <th className="r">Delta</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.account}>
                <td className={styles.accountCell}>
                  {row.account}
                  {row.note !== undefined && <div className={styles.rowNote}>{row.note}</div>}
                </td>
                <td className="r money">{money(row.calculated, row.currency)}</td>
                <td className="r money">{money(row.declared, row.currency)}</td>
                <td className="r money">
                  {row.delta === 0n ? (
                    <span className="status ok">0,00</span>
                  ) : (
                    <span className="status bad">{money(row.delta, row.currency)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={`verdict ${cuadran === rows.length ? 'ok' : 'warn'}`}>
        <b>
          {cuadran} de {rows.length} cuentas cuadran al céntimo.
        </b>{' '}
        La que falta no se esconde: se dice cuál, cuánto y por qué. Un informe que dijera
        &laquo;todo correcto&raquo; sin poder demostrarlo no vale nada.
      </div>
    </figure>
  )
}

/* ── R2 · Costo por propiedad ────────────────────────────────────────── */

const AREAS = [
  { label: 'Obra', amount: 4185000n, previous: 1220000n },
  { label: 'Servicios', amount: 872400n, previous: 803100n },
  { label: 'Personal', amount: 1944000n, previous: 1890000n },
  { label: 'Impuestos', amount: 1136500n, previous: 1102000n },
  { label: 'Seguros', amount: 418800n, previous: 343200n },
] as const

export function PropertyCostSpecimen() {
  const total = AREAS.reduce((sum, area) => sum + area.amount, 0n)
  const max = AREAS.reduce((m, area) => (area.amount > m ? area.amount : m), 1n)

  return (
    <figure className={styles.specimen}>
      <figcaption className={styles.specimenHead}>
        <div>
          <span className="label">Casa Madrid · últimos 12 meses</span>
          <h3>Cuánto cuesta realmente, todo incluido</h3>
        </div>
        <DemoTag />
      </figcaption>

      <div className={styles.kpiStrip}>
        <div>
          <span className="label">Costo total</span>
          <b className="money">{money(total, EUR)}</b>
        </div>
        <div>
          <span className="label">Promedio mensual</span>
          <b className="money">{money(total / 12n, EUR)}</b>
        </div>
        <div>
          <span className="label">vs. año anterior</span>
          <b className="money neg">+38,4%</b>
        </div>
        <div>
          <span className="label">del gasto del hogar</span>
          <b className="money">31,2%</b>
        </div>
      </div>

      <div className={styles.specimenBody}>
        <table>
          <thead>
            <tr>
              <th>Área</th>
              <th className="r">Importe</th>
              <th className="r">Δ vs. 2025</th>
              <th className={styles.barCol} />
            </tr>
          </thead>
          <tbody>
            {AREAS.map((area) => (
              <tr key={area.label}>
                <td>{area.label}</td>
                <td className="r money">{money(area.amount, EUR)}</td>
                <td className="r money">
                  {pct(area.amount - area.previous, area.previous) ?? '—'}
                </td>
                <td className={styles.barCol}>
                  <span
                    className={styles.barTrack}
                    style={
                      { '--w': `${Number((area.amount * 100n) / max)}%` } as React.CSSProperties
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="r money">{money(total, EUR)}</td>
              <td className="r" />
              <td className={styles.barCol} />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="notes">
        Cada fila abre hasta la transacción. La obra explica casi toda la subida — y eso se ve en
        tres segundos, no en un email al contador.
      </div>
    </figure>
  )
}

/* ── R4 · Waterfall de variación patrimonial ─────────────────────────── */

const WATERFALL = [
  { label: 'Inicio', amount: 412_0000_00n, kind: 'total' as const },
  { label: 'Aportes', amount: 18_5000_00n, kind: 'up' as const },
  { label: 'Gastos', amount: -9_8400_00n, kind: 'down' as const },
  { label: 'Revalorización', amount: 11_2000_00n, kind: 'up' as const },
  { label: 'Efecto FX', amount: -6_4100_00n, kind: 'fx' as const },
  { label: 'Cierre', amount: 425_4500_00n, kind: 'total' as const },
]

export function WaterfallSpecimen() {
  // La escala se calcula sobre el mayor acumulado para que las barras de
  // variación se lean; si se escalara sobre el patrimonio total, todas las
  // variaciones quedarían aplastadas contra el eje.
  let running = 0n
  const steps = WATERFALL.map((step) => {
    if (step.kind === 'total') {
      running = step.amount
      return { ...step, from: 0n, to: step.amount }
    }
    const from = running
    running += step.amount
    return { ...step, from, to: running }
  })
  const top = steps.reduce((m, s) => (s.to > m ? s.to : m), 1n)

  return (
    <figure className={styles.specimen}>
      <figcaption className={styles.specimenHead}>
        <div>
          <span className="label">Patrimonio · 2026 hasta hoy</span>
          <h3>Tu patrimonio subió 3,2%. ¿Cuánto de eso fue tipo de cambio?</h3>
        </div>
        <DemoTag />
      </figcaption>

      <div className={styles.waterfall}>
        {steps.map((step) => {
          const bottom = step.kind === 'total' ? 0n : step.from < step.to ? step.from : step.to
          const height =
            step.kind === 'total'
              ? step.to
              : step.to - step.from < 0n
                ? step.from - step.to
                : step.to - step.from
          return (
            <div key={step.label} className={styles.waterCol}>
              <span className={`${styles.waterValue} money`}>
                {step.kind === 'total' ? '' : step.amount > 0n ? '+' : '−'}
                {money(step.amount < 0n ? -step.amount : step.amount, EUR).replace('€', '')}
              </span>
              <div className={styles.waterTrack}>
                <span
                  className={`${styles.waterBar} ${styles[step.kind]}`}
                  style={
                    {
                      '--bottom': `${Number((bottom * 100n) / top)}%`,
                      '--height': `${Math.max(1, Number((height * 100n) / top))}%`,
                    } as React.CSSProperties
                  }
                />
              </div>
              <span className={styles.waterLabel}>{step.label}</span>
            </div>
          )
        })}
      </div>

      <div className="notes">
        <b>
          Flujos a la tasa del día, saldos a la tasa de cierre, y la diferencia es el efecto FX.
        </b>{' '}
        Es la barra que el producto más caro del mercado consolida pero no desglosa. Y es
        clickeable: detrás hay asientos, no una resta al vuelo.
      </div>
    </figure>
  )
}

/* ── R5 · Recurrentes y fugas ────────────────────────────────────────── */

interface Recurring {
  readonly merchant: string
  readonly current: bigint
  readonly median: bigint
  readonly currency: string
  readonly history: readonly number[]
  readonly state: 'activo' | 'subio' | 'no-cobro'
}

const RECURRING: readonly Recurring[] = [
  {
    merchant: 'Mapfre · Seguro hogar Madrid',
    current: 34900n,
    median: 28600n,
    currency: EUR,
    history: [286, 286, 286, 286, 286, 349],
    state: 'subio',
  },
  {
    merchant: 'Iberdrola · Casa Madrid',
    current: 21847n,
    median: 19230n,
    currency: EUR,
    history: [192, 176, 203, 188, 199, 218],
    state: 'activo',
  },
  {
    merchant: 'Colegio Estudio · Cuota',
    current: 89000n,
    median: 89000n,
    currency: EUR,
    history: [890, 890, 890, 890, 890, 890],
    state: 'activo',
  },
  {
    merchant: 'Alarma Securitas · Lisboa',
    current: 4990n,
    median: 4990n,
    currency: EUR,
    history: [49, 49, 49, 49, 0, 0],
    state: 'no-cobro',
  },
]

function Spark({ points }: { points: readonly number[] }) {
  const max = Math.max(...points, 1)
  const step = points.length > 1 ? 100 / (points.length - 1) : 100
  const d = points
    .map((value, index) => `${index === 0 ? 'M' : 'L'}${index * step},${28 - (value / max) * 26}`)
    .join(' ')
  return (
    <svg className="spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const STATE_LABEL: Record<Recurring['state'], { text: string; cls: string }> = {
  activo: { text: 'activo', cls: 'status ok' },
  subio: { text: 'subió', cls: 'status warn' },
  'no-cobro': { text: 'no cobró', cls: 'status bad' },
}

export function RecurringSpecimen() {
  return (
    <figure className={styles.specimen}>
      <figcaption className={styles.specimenHead}>
        <div>
          <span className="label">Obligaciones recurrentes</span>
          <h3>Qué te cobran todos los meses, qué subió y qué dejó de cobrarse</h3>
        </div>
        <DemoTag />
      </figcaption>

      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Proveedor</th>
              <th className="r">Actual</th>
              <th className="r">Mediana</th>
              <th className="r">Δ</th>
              <th>Serie</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {RECURRING.map((item) => {
              const badge = STATE_LABEL[item.state]
              const delta = pct(item.current - item.median, item.median)
              return (
                <tr key={item.merchant}>
                  <td>{item.merchant}</td>
                  <td className="r money">{money(item.current, item.currency)}</td>
                  <td className="r money faint">{money(item.median, item.currency)}</td>
                  <td className={item.state === 'subio' ? 'r money neg' : 'r money faint'}>
                    {delta ?? '—'}
                  </td>
                  <td>
                    <Spark points={item.history} />
                  </td>
                  <td>
                    <span className={badge.cls}>{badge.text}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="notes">
        La alerta de subida sólo corre sobre series de importe fijo, compara en la moneda de
        facturación original y exige a la vez un salto del 5% y un piso absoluto.{' '}
        <b>Una alerta que se equivoca dos veces se apaga para siempre</b>, así que el motor está
        calibrado para no molestar antes que para no perderse nada.
      </div>
    </figure>
  )
}

/* ── R3 · Liquidez por moneda ────────────────────────────────────────── */

const LANES = [
  {
    currency: EUR,
    now: 1_042_900n * 100n,
    weeks: [104, 98, 91, 87, 112, 104, 96, 88, 79, 71, 96, 88, 81],
    floor: 4,
  },
  {
    currency: USD,
    now: 187_200n * 100n,
    weeks: [187, 181, 174, 168, 162, 155, 149, 142, 136, 129, 123, 116, 110],
    floor: null,
  },
] as const

export function LiquiditySpecimen() {
  return (
    <figure className={styles.specimen}>
      <figcaption className={styles.specimenHead}>
        <div>
          <span className="label">Proyección · 13 semanas</span>
          <h3>¿Me alcanza? ¿En qué moneda va a faltar, y cuándo?</h3>
        </div>
        <DemoTag />
      </figcaption>

      <div className={styles.specimenBody}>
        {LANES.map((lane) => {
          const max = Math.max(...lane.weeks)
          // La semana es la identidad de cada barra, así que se materializa en
          // vez de usar el índice: la posición y el número de semana coinciden
          // hoy por casualidad, y el día que la serie empiece en otra semana
          // dejarían de coincidir sin que nada avise.
          const semanas = lane.weeks.map((valor, posicion) => ({ semana: posicion + 1, valor }))
          return (
            <div key={lane.currency} className={styles.lane}>
              <div className={styles.laneHead}>
                <span className="label">{lane.currency}</span>
                <b className="money">{money(lane.now, lane.currency)}</b>
                <span className="small faint">hoy</span>
              </div>
              <div className="bars" style={{ height: 74 }}>
                {semanas.map(({ semana, valor }) => (
                  <div className="col" key={`${lane.currency}-s${semana}`}>
                    <span
                      className="seg"
                      style={{
                        height: `${(valor / max) * 100}%`,
                        background:
                          lane.floor !== null &&
                          semana - 1 >= lane.floor &&
                          semana - 1 <= lane.floor + 1
                            ? 'var(--warn)'
                            : undefined,
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <div className="notes">
        <b>Un carril por moneda, sin consolidar.</b> Tener patrimonio de sobra en euros no paga una
        obligación en dólares el jueves: el problema de liquidez es por moneda, y consolidarlo lo
        esconde.
      </div>
    </figure>
  )
}
