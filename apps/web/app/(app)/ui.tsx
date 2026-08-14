/**
 * Primitivas compartidas por las páginas de la aplicación.
 *
 * Existen para que doce pantallas se vean como un producto y no como doce
 * pantallas. Si una página necesita algo que no está acá, la pregunta correcta
 * es si debería estarlo — no si copiar el marcado.
 */

import type { ReactNode } from 'react'
import { formatMoney, pct } from '@/lib/format'

/* ── Cabecera de página ──────────────────────────────────────────────── */

export function PageBar({
  title,
  blurb,
  tools,
}: {
  title: string
  blurb?: string
  tools?: ReactNode
}) {
  return (
    <header className="app-bar">
      <div className="titles">
        <h1>{title}</h1>
        {blurb !== undefined && <p>{blurb}</p>}
      </div>
      {tools !== undefined && <div className="tools">{tools}</div>}
    </header>
  )
}

/* ── Dinero ──────────────────────────────────────────────────────────── */

/**
 * Un importe. Siempre monoespaciado, siempre con el signo del dato.
 *
 * `tone="flow"` marca los negativos con `--debit`, que desde que se separó de
 * `--bad` es tinta normal: un cargo no es un error. El signo y la alineación a
 * la derecha en monoespaciada ya dicen que sale dinero.
 *
 * Para un saldo tampoco se colorea: un saldo negativo en una tarjeta de crédito
 * es lo normal, y pintarlo de rojo entrena al ojo a ignorar el color justo
 * donde después lo vamos a necesitar.
 */
export function Money({
  amount,
  currency,
  tone = 'plain',
  symbol = true,
}: {
  amount: bigint
  currency: string
  tone?: 'plain' | 'flow' | 'delta'
  symbol?: boolean
}) {
  const formatted = formatMoney(amount, currency)
  const className =
    tone === 'plain'
      ? 'money'
      : tone === 'flow'
        ? formatted.negative
          ? 'money neg'
          : 'money'
        : amount === 0n
          ? 'money'
          : formatted.negative
            ? 'money neg'
            : 'money pos'

  return <span className={className}>{symbol ? formatted.withSymbol : formatted.plain}</span>
}

/** Variación porcentual. Devuelve un guion cuando la base es cero, nunca "∞%". */
/**
 * Una variación contra una referencia. **Sin color.**
 *
 * Antes se pintaba de verde o de rojo según si la dirección nos parecía buena,
 * y eso produjo dos reglas opuestas conviviendo en el mismo producto: en el
 * registro un menos era rojo porque salía dinero, y aquí el mismo menos era
 * verde porque gastar menos parecía bueno. El mismo signo, dos colores
 * contrarios, a dos clicks de distancia.
 *
 * Decidido: **el libro informa, quien juzga es quien lo lee.** Un delta lleva
 * su signo y, cuando hay sitio, la frase que lo interpreta —«menos que julio»—,
 * que dice lo mismo sin obligar al producto a opinar sobre si una deuda que
 * sube por comprar una casa es buena o mala.
 *
 * El rojo y el verde quedan libres para lo único que un sistema de registro
 * necesita señalar con color: si el dato **cuadra** con el banco o no.
 *
 * `invert` se queda en la firma porque decide la palabra, no el color: en gasto
 * un aumento es «más», en ingreso es «más» también, pero contra un presupuesto
 * la lectura cambia. Hoy sólo afecta a `sentido`.
 */
export function Delta({
  value,
  base,
  invert = false,
  sentido = false,
}: {
  value: bigint
  base: bigint
  /** En gasto, subir es «más». Cambia la palabra, no el color. */
  invert?: boolean
  /** Añade la palabra debajo: «más que la referencia» / «menos». */
  sentido?: boolean
}) {
  const text = pct(value, base)
  if (text === null) return <span className="faint">—</span>
  if (!sentido) return <span className="money">{text}</span>
  const palabra = value === 0n ? 'igual' : value > 0n ? 'más' : 'menos'
  return (
    <span className="stack" style={{ gap: '2px' }}>
      <span className="money">{text}</span>
      <span className="small faint">{palabra}</span>
    </span>
  )
}

/* ── Estado vacío ────────────────────────────────────────────────────── */

export function Empty({
  title,
  children,
  action,
}: {
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  )
}

/* ── Aviso de dato ilustrativo ───────────────────────────────────────── */

/**
 * Marca un bloque cuyo contenido todavía no sale de la base.
 *
 * No es una nota para nosotros: es para quien mira la pantalla. La regla del
 * producto es que un número que no se puede explicar no se muestra, y una
 * pantalla de producto en construcción no es excusa para saltársela.
 */
export function Illustrative({ children }: { children: ReactNode }) {
  return (
    <div className="demo-note">
      <b>Pantalla ilustrativa.</b> {children}
    </div>
  )
}

/* ── Cobertura del dato ──────────────────────────────────────────────── */

/**
 * La cabecera de metadatos obligatoria: si una cifra agregada dejó postings
 * fuera por no poder convertirlos, hay que decirlo junto a la cifra y no en
 * una nota al pie que nadie lee.
 */
/**
 * El hueco declarado: cuánto se queda fuera del consolidado por falta de tasa.
 *
 * ── Por qué ahora dice de qué habla ─────────────────────────────────────────
 *
 * En /cierre este chip salía **cinco veces con tres cifras distintas** —7, 7, 5,
 * 5 y 15— y en /estructura tres veces con otras tres. Ninguna estaba mal: cada
 * panel mide su propio trozo, el mes anterior mide el mes anterior y el
 * acumulado mide el acumulado. Pero cinco chips idénticos con números que no
 * cuadran entre sí se leen como un error del producto, no como cinco
 * afirmaciones verdaderas sobre cinco cosas distintas.
 *
 * El chip no sobra —es la regla del hueco declarado, y sin él la pantalla
 * enseñaría un consolidado incompleto sin decirlo—. Lo que faltaba es el
 * `alcance`: de qué trozo habla cada uno.
 */
export function Coverage({
  unconverted,
  currency,
  extra,
  alcance,
}: {
  unconverted: number
  currency: string
  extra?: string
  /** De qué habla este chip: «en este mes», «en el acumulado», «en el período». */
  alcance?: string
}) {
  const donde = alcance === undefined ? '' : ` ${alcance}`
  if (unconverted === 0) {
    return (
      <span className="small faint">
        Consolidado en {currency}
        {extra === undefined ? '' : ` · ${extra}`}
      </span>
    )
  }
  return (
    <span className="status warn">
      {unconverted} {unconverted === 1 ? 'movimiento' : 'movimientos'}
      {donde} {unconverted === 1 ? 'queda' : 'quedan'} fuera del consolidado en {currency}: falta su
      tipo de cambio
    </span>
  )
}

/* ── Barras apiladas ─────────────────────────────────────────────────── */

export interface StackSeries {
  readonly label: string
  /** Un valor por columna. Todas las series tienen que traer la misma longitud. */
  readonly values: readonly bigint[]
}

/**
 * Barras apiladas por columna. Sin librería: es una rejilla con alturas en
 * porcentaje, y a cambio pesa cero y hereda los colores del tema.
 */
export function StackedBars({
  columns,
  series,
  height = 150,
}: {
  columns: readonly string[]
  series: readonly StackSeries[]
  height?: number
}) {
  const totals = columns.map((_, index) =>
    series.reduce((sum, s) => sum + (s.values[index] ?? 0n), 0n),
  )
  const max = totals.reduce((m, total) => (total > m ? total : m), 1n)

  return (
    <div>
      <div className="bars" style={{ height }}>
        {columns.map((column, index) => (
          <div className="col" key={column}>
            {series.map((s, sIndex) => {
              const value = s.values[index] ?? 0n
              if (value <= 0n) return null
              return (
                <span
                  key={s.label}
                  className={sIndex === 0 ? 'seg' : `seg s${Math.min(sIndex + 1, 5)}`}
                  style={{ height: `${Number((value * 1000n) / max) / 10}%` }}
                  title={`${column} · ${s.label}`}
                />
              )
            })}
          </div>
        ))}
      </div>
      <div className="bars-axis">
        {columns.map((column) => (
          <span key={column}>{column}</span>
        ))}
      </div>
      {series.length > 1 && (
        <div className="legend">
          {series.map((s, index) => (
            <span key={s.label}>
              <i
                style={{
                  background:
                    index === 0
                      ? 'var(--accent)'
                      : `color-mix(in oklab, var(--accent) ${Math.max(13, 66 - index * 20)}%, var(--paper))`,
                }}
              />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Sparkline ───────────────────────────────────────────────────────── */

export function Sparkline({ points }: { points: readonly bigint[] }) {
  if (points.length < 2) return <span className="faint">—</span>
  const max = points.reduce((m, p) => (p > m ? p : m), 1n)
  const step = 100 / (points.length - 1)
  const d = points
    .map((value, index) => {
      const y = 26 - Number((value * 240n) / max) / 10
      return `${index === 0 ? 'M' : 'L'}${(index * step).toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg className="spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

/* ── Semáforo de reconciliación ──────────────────────────────────────── */

/**
 * `cuadra-feed` es su propio estado y no un `cuadra` con otro texto.
 *
 * Cuadrar contra un extracto y cuadrar contra la lectura de un agregador son
 * dos afirmaciones distintas, y la segunda hay que poder distinguirla de un
 * vistazo: un extracto es un documento con fecha de cierre que el banco firma;
 * una lectura es lo que había en un instante y puede contar los pendientes de
 * otra manera. Enseñarlas iguales sería cómodo hoy y no se podría defender
 * delante de un contador.
 */
export function ReconStatus({
  status,
}: {
  status: 'cuadra' | 'cuadra-feed' | 'delta' | 'sin-declarar'
}) {
  if (status === 'cuadra') return <span className="status ok">cuadra</span>
  if (status === 'cuadra-feed')
    return (
      <span
        className="status ok"
        title="Contra el saldo que el agregador leyó del banco, no contra un extracto declarado."
      >
        cuadra · feed
      </span>
    )
  if (status === 'delta') return <span className="status bad">delta</span>
  return <span className="status none">sin declarar</span>
}
