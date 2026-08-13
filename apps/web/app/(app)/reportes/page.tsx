import {
  accountBalances,
  categoryTree,
  type DimensionSummary,
  dimensionsWithValues,
  liquidityByCurrency,
  movements,
  netWorthAttribution,
  reconciliation,
  recurring,
  type SpendByDimensionRow,
  spendByDimension,
} from '@moneypilot/db'
import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  addMonths,
  firstDayOfMonth,
  lastDayOfMonth,
  monthOf,
  readHousehold,
  today,
  trailing12,
} from '@/lib/data'
import { capitalize, formatMonth } from '@/lib/format'
import { navItem } from '@/lib/nav'
import { NoData } from '../empty-state'
import { Coverage, Empty, Money, PageBar } from '../ui'
import { CINCO, type Plantilla, RESTO } from './catalogo'
import { dimension, measure } from './ir'
import styles from './page.module.css'

/**
 * El catálogo de reportes: nivel 1 del builder.
 *
 * La página no ejecuta ningún reporte —para eso están las pantallas y, cuando
 * exista, el motor genérico— pero tampoco es un menú de texto. Cada una de las
 * cinco plantillas de B3 enseña **el estado de hoy de su pregunta con datos de
 * la base**: cuántas cuentas cuadran, cuánto lleva la casa de Madrid, cuánta
 * liquidez hay por moneda. Un catálogo que sólo promete es indistinguible de
 * una lista de deseos; uno que trae la cifra de hoy ya es útil antes de que el
 * motor exista.
 */

export const dynamic = 'force-dynamic'

const BLURB = navItem('/reportes')?.blurb ?? 'Plantillas, tus reportes guardados y el constructor.'
const PLANTILLAS_TOTAL = CINCO.length + RESTO.length

interface CostoPropiedad {
  readonly id: string
  readonly label: string
  readonly amount: bigint
  /** Valores de la dimensión que se sumaron: la propiedad y sus áreas. */
  readonly ids: readonly string[]
}

/**
 * Suma cada área dentro de su propiedad.
 *
 * `spendByDimension` devuelve los valores tal como están atribuidos y deja el
 * plegado a quien pinta: acá la pregunta es "todo incluido", así que obra,
 * servicios y personal cuentan dentro de su casa. El recorrido hacia la raíz
 * está acotado a 16 saltos por el mismo motivo que en el árbol de categorías:
 * `parent_id` no impide un ciclo, y un ciclo sin tope cuelga la página.
 */
function porPropiedad(
  rows: readonly SpendByDimensionRow[],
  dimensiones: readonly DimensionSummary[],
): CostoPropiedad[] {
  const propiedad = dimensiones.find((d) => d.key === 'propiedad')
  const padres = new Map<string, string | null>()
  const etiquetas = new Map<string, string>()
  for (const value of propiedad?.values ?? []) {
    padres.set(value.id, value.parentId)
    etiquetas.set(value.id, value.label)
  }
  // La fila trae su propia etiqueta. Sirve de red por si un valor sale del
  // resumen de dimensiones y no del listado: mejor el nombre que tenga el
  // dato que pintar "Sin nombre" al lado de un importe.
  for (const row of rows) if (!etiquetas.has(row.valueId)) etiquetas.set(row.valueId, row.label)

  const raiz = (id: string): string => {
    let actual = id
    for (let salto = 0; salto < 16; salto += 1) {
      const padre = padres.get(actual)
      if (padre === undefined || padre === null) return actual
      actual = padre
    }
    return actual
  }

  const acumulado = new Map<string, { amount: bigint; ids: string[] }>()
  for (const row of rows) {
    const clave = raiz(row.valueId)
    const actual = acumulado.get(clave) ?? { amount: 0n, ids: [] }
    actual.amount += row.amount
    actual.ids.push(row.valueId)
    acumulado.set(clave, actual)
  }

  return [...acumulado.entries()]
    .map(([id, valor]) => ({
      id,
      label: etiquetas.get(id) ?? 'Valor sin nombre en el listado de dimensiones',
      amount: valor.amount,
      ids: valor.ids,
    }))
    .sort((a, b) => (a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1))
}

function EstadoChip({ estado }: { estado: Plantilla['estado'] }) {
  if (estado === 'pantalla') return <span className="status ok">tiene pantalla</span>
  if (estado === 'parcial') return <span className="status warn">parcial</span>
  return <span className="status none">sólo composición</span>
}

/** Medida y dimensiones de la plantilla, con los nombres del catálogo de B4. */
function Receta({ plantilla }: { plantilla: Plantilla }) {
  const m = measure(plantilla.preset.measure)?.label ?? plantilla.preset.measure
  const dims = plantilla.preset.dimensions
    .map((d) => dimension(d.field)?.label ?? d.field)
    .join(' · ')
  return (
    <div className="chips">
      <span className="chip">{m}</span>
      {dims !== '' && <span className="chip">por {dims.toLowerCase()}</span>}
    </div>
  )
}

export default async function Reportes() {
  const hoy = today()
  const doce = trailing12(hoy)
  const mesCerrado = addMonths(monthOf(hoy), -1)

  const { session, data } = await readHousehold(async (client, sesion) => {
    const moneda = sesion.baseCurrency
    // En serie: las nueve van por el mismo cliente —una transacción, una
    // conexión—, así que pg las encola igual. Promise.all daba paralelismo
    // aparente y un aviso de query concurrente sobre un cliente ocupado, que
    // en pg@9 será un error.
    const muestra = await movements(client, { limit: 1 })
    const dimensiones = await dimensionsWithValues(client)
    const cuentas = await accountBalances(client)
    const categorias = await categoryTree(client)
    const propiedades = await spendByDimension(client, {
      dimensionKey: 'propiedad',
      from: doce.from,
      to: doce.to,
      currency: moneda,
    })
    const recon = await reconciliation(client, {
      from: firstDayOfMonth(mesCerrado),
      to: lastDayOfMonth(mesCerrado),
    })
    const liquidez = await liquidityByCurrency(client)
    const patrimonio = await netWorthAttribution(client, {
      from: `${hoy.slice(0, 4)}-01-01`,
      to: hoy,
      currency: moneda,
    })
    const obligaciones = await recurring(client, { asOf: hoy })
    return {
      muestra,
      dimensiones,
      cuentas,
      categorias,
      propiedades,
      recon,
      liquidez,
      patrimonio,
      obligaciones,
    }
  })

  const moneda = session.baseCurrency

  if (data.muestra.total === 0) {
    return (
      <>
        <PageBar title="Reportes" blurb={BLURB} />
        <div className="page">
          <NoData what="qué reportes puede responder tu hogar" />
        </div>
      </>
    )
  }

  /* ── El estado de hoy de cada una de las cinco preguntas ───────────────── */

  const cuadran = data.recon.filter((r) => r.status === 'cuadra').length
  const conDelta = data.recon.filter((r) => r.status === 'delta').length
  const sinDeclarar = data.recon.filter((r) => r.status === 'sin-declarar').length
  const incompletas = data.recon.filter((r) => r.status === 'incompleto').length

  const propiedades = porPropiedad(data.propiedades, data.dimensiones)
  const propiedadesSinConvertir = data.propiedades.reduce((suma, row) => suma + row.unconverted, 0)
  const propiedadesRepartidas = data.propiedades.reduce((suma, row) => suma + row.overAttributed, 0)

  const variacion = data.patrimonio.closing - data.patrimonio.opening

  const activas = data.obligaciones.filter((o) => o.state === 'activo').length
  const subieron = data.obligaciones.filter((o) => o.state === 'subio').length
  const noCobraron = data.obligaciones.filter((o) => o.state === 'no-cobro').length
  // El cuarto estado del repositorio. Sin esta línea las tres etiquetas no
  // suman el total de series y el usuario no tiene forma de saber qué falta.
  const huerfanas = data.obligaciones.filter((o) => o.state === 'huerfano').length

  const cuentasBancarias = data.cuentas.filter((c) => c.kind === 'asset' || c.kind === 'liability')
  const valoresDimension = data.dimensiones.reduce((suma, d) => suma + d.values.length, 0)
  const hayDimensionPropiedad = data.dimensiones.some((d) => d.key === 'propiedad')
  // Una categoría que no resolvió su camino cuelga como raíz suelta: el gasto
  // que tiene dentro sale en los totales pero no en el árbol por el que se
  // agrupa. Es un agujero del catálogo y se declara donde se promete el dato.
  const sueltas = data.categorias.filter((c) => c.detached).length
  const liquidezFuera = data.liquidez.reduce((suma, carril) => suma + carril.foreignPostings, 0)

  /**
   * Las cuentas que forman cada carril de liquidez, para poder abrirlo.
   *
   * Repite la condición de `liquidityByCurrency` —activo y sin cerrar— porque
   * el repositorio devuelve el carril agregado sin los ids. Si la condición se
   * separase, el enlace llevaría a un detalle que no suma la cifra de al lado.
   */
  const cuentasDelCarril = (divisa: string): string[] =>
    data.cuentas
      .filter((c) => c.kind === 'asset' && c.closedAt === null && c.currency === divisa)
      .map((c) => c.id)

  const previews: Readonly<Record<string, ReactNode>> = {
    'cierre-mensual':
      data.recon.length === 0 ? (
        // `reconciliation` devuelve una fila por cuenta de activo o pasivo,
        // tenga o no movimiento. Cero filas significa que el hogar todavía no
        // tiene cuentas, no que el mes estuviera quieto: decir lo segundo sería
        // explicar un vacío con un motivo que nadie comprobó.
        <p className={styles.falta}>
          El hogar todavía no tiene cuentas de banco, tarjeta ni efectivo, así que no hay nada que
          conciliar en {formatMonth(mesCerrado)}.
        </p>
      ) : (
        <>
          <div className={styles.previewRow}>
            <span>{capitalize(formatMonth(mesCerrado))}</span>
            <Link href="/cierre" className="num">
              {cuadran} de {data.recon.length} cuentas cuadran
            </Link>
          </div>
          <div className="chips">
            {conDelta > 0 && <span className="status bad">{conDelta} con delta</span>}
            {incompletas > 0 && <span className="status warn">{incompletas} sin poder sumar</span>}
            {sinDeclarar > 0 && (
              <span className="status none">{sinDeclarar} sin extracto declarado</span>
            )}
            {/* Lo comprobado es la reconciliación, no que el paquete exista.
                "Listo para mandarse" prometía un envío que todavía no hay. */}
            {cuadran === data.recon.length && (
              <span className="status ok">todas las cuentas cuadran contra su extracto</span>
            )}
          </div>
        </>
      ),
    'costo-propiedad':
      propiedades.length === 0 ? (
        // Dos vacíos distintos que llevan a acciones opuestas: crear la
        // dimensión, o imputar movimientos a la que ya existe.
        <p className={styles.falta}>
          {hayDimensionPropiedad ? (
            `Tus propiedades están cargadas, pero ningún movimiento de ${doce.label.toLowerCase()} está imputado a una todavía.`
          ) : (
            <>
              Tu hogar todavía no tiene la dimensión Propiedad, y sin ella esta pregunta no se puede
              responder. Se crea en <Link href="/dimensiones">Dimensiones</Link>.
            </>
          )}
        </p>
      ) : (
        <>
          {propiedades.slice(0, 3).map((p) => (
            <div className={styles.previewRow} key={p.id}>
              <span>
                {p.label}
                {p.ids.length > 1 && <span className="faint"> · {p.ids.length} áreas</span>}
              </span>
              <Link
                href={`/movimientos?dimension=${p.ids.join(',')}&desde=${doce.from}&hasta=${doce.to}`}
              >
                <Money amount={p.amount} currency={moneda} />
              </Link>
            </div>
          ))}
          {propiedades.length > 3 && (
            <div className={styles.previewRow}>
              <span className="faint">
                y {propiedades.length - 3}{' '}
                {propiedades.length - 3 === 1 ? 'propiedad más' : 'propiedades más'}
              </span>
              <Link href="/mes" className="small">
                verlas
              </Link>
            </div>
          )}
          <div className="small">
            <Coverage
              unconverted={propiedadesSinConvertir}
              currency={moneda}
              extra={doce.label.toLowerCase()}
            />
          </div>
          {/* `overAttributed` viene por valor de dimensión, así que un mismo
              movimiento repartido entre dos propiedades cuenta en las dos:
              sumarlo daría un número de movimientos que no existe. Se declara
              la condición, que es lo que importa, y no un recuento inventado. */}
          {propiedadesRepartidas > 0 && (
            <span className="status warn">
              Hay atribuciones cuyos pesos sumaban más del 100% y hubo que reescalarlas: el importe
              repartido de esas líneas es una interpretación, no un dato del extracto
            </span>
          )}
        </>
      ),
    'liquidez-13-semanas':
      data.liquidez.length === 0 ? (
        <p className={styles.falta}>
          No hay ninguna cuenta de activo abierta. La liquidez se mide sobre bancos y efectivo: una
          cuenta cerrada o de pasivo no aporta caja.
        </p>
      ) : (
        <>
          {data.liquidez.map((carril) => {
            const ids = cuentasDelCarril(carril.currency)
            const cifra = <Money amount={carril.total} currency={carril.currency} />
            return (
              <div className={styles.previewRow} key={carril.currency}>
                <span>
                  {carril.currency} <span className="faint">· {carril.accounts} cuentas</span>
                </span>
                {/* Un saldo es un stock: se abre con todas sus cuentas y sin
                    recortar por fecha, o el detalle no daría la cifra. */}
                {ids.length === 0 ? (
                  cifra
                ) : (
                  <Link href={`/movimientos?cuenta=${ids.join(',')}`}>{cifra}</Link>
                )}
              </div>
            )
          })}
          {liquidezFuera > 0 && (
            <span className="status warn">
              {liquidezFuera} {liquidezFuera === 1 ? 'movimiento queda' : 'movimientos quedan'}{' '}
              fuera de estos saldos: están en una moneda distinta a la de su cuenta
            </span>
          )}
          <p className={styles.falta}>
            Sin consolidar y a propósito: el problema de liquidez es por moneda. Lo que falta es la
            proyección, no el saldo.
          </p>
        </>
      ),
    'patrimonio-atribucion': (
      <>
        <div className={styles.previewRow}>
          <span>Variación en lo que va de {hoy.slice(0, 4)}</span>
          <Link href="/estructura">
            <Money amount={variacion} currency={moneda} tone="delta" />
          </Link>
        </div>
        <div className="chips">
          {data.patrimonio.fxModelled ? (
            <span className="status ok">efecto FX modelado</span>
          ) : (
            <span className="status warn">
              el efecto FX todavía no se calcula: no hay cuentas de revaluación
            </span>
          )}
        </div>
        <div className="small">
          <Coverage unconverted={data.patrimonio.unconverted} currency={moneda} />
        </div>
      </>
    ),
    'recurrentes-fugas':
      data.obligaciones.length === 0 ? (
        <p className={styles.falta}>
          El motor no encontró ninguna serie: hacen falta al menos dos cargos del mismo comercio en
          la misma cuenta para que haya frecuencia que estimar.
        </p>
      ) : (
        <>
          <div className={styles.previewRow}>
            <span>Series detectadas</span>
            <Link href="/estructura" className="num">
              {data.obligaciones.length}
            </Link>
          </div>
          <div className="chips">
            {activas > 0 && <span className="status ok">{activas} activas</span>}
            {subieron > 0 && <span className="status warn">{subieron} subieron</span>}
            {noCobraron > 0 && <span className="status bad">{noCobraron} no se cobraron</span>}
            {huerfanas > 0 && <span className="status none">{huerfanas} sin imputar a nadie</span>}
          </div>
          <p className={styles.falta}>
            Importes en la moneda de facturación de cada serie, nunca convertidos: comparar la
            versión convertida fabrica subidas de precio que no ocurrieron.
          </p>
        </>
      ),
  }

  return (
    <>
      <PageBar
        title="Reportes"
        blurb={BLURB}
        tools={
          <Link href="/reportes/nuevo" className="btn primary">
            Construir una pregunta
          </Link>
        }
      />

      <div className="page">
        <div className="panel">
          <div className="panel-head">
            <h2>Con qué se responden</h2>
            <small>Todo reporte de esta pantalla sale de estas filas, no de otra base</small>
          </div>
          <div className="tiles">
            <div className="tile">
              <div className="k">Movimientos</div>
              <div className="v">
                <Link href="/movimientos">{data.muestra.total}</Link>
              </div>
            </div>
            <div className="tile">
              <div className="k">Cuentas</div>
              <div className="v">
                <Link href="/cuentas">{cuentasBancarias.length}</Link>
              </div>
              <div className="sub">bancos, tarjetas y efectivo</div>
            </div>
            <div className="tile">
              <div className="k">Dimensiones</div>
              <div className="v">
                <Link href="/dimensiones">{data.dimensiones.length}</Link>
              </div>
              <div className="sub">{valoresDimension} valores</div>
            </div>
            <div className="tile">
              <div className="k">Categorías</div>
              <div className="v">{data.categorias.length}</div>
              <div className="sub">
                cuentas de gasto e ingreso
                {sueltas > 0 && (
                  <>
                    {' · '}
                    <span className="status warn">{sueltas} fuera del árbol</span>
                  </>
                )}
              </div>
            </div>
            <div className="tile">
              <div className="k">Moneda de reporte</div>
              <div className="v">{moneda}</div>
              <div className="sub">flujos a la fecha, stocks al cierre</div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Los cinco reportes</h2>
            <small>Con el estado de hoy, calculado sobre tus movimientos</small>
          </div>
          <div className="panel-body">
            <div className={styles.cards}>
              {CINCO.map((p) => (
                <article className={styles.card} key={p.id}>
                  <div className={styles.cardHead}>
                    <span className="label">
                      {p.code} · {p.consumer}
                    </span>
                    <EstadoChip estado={p.estado} />
                  </div>
                  <h3 className={styles.question}>{p.question}</h3>
                  <p className={styles.why}>{p.why}</p>
                  <Receta plantilla={p} />
                  {p.falta !== undefined && <p className={styles.falta}>Falta: {p.falta}</p>}
                  <div className={styles.preview}>{previews[p.id]}</div>
                  <div className={styles.actions}>
                    {p.href !== undefined && (
                      <Link href={p.href} className="btn">
                        {p.hrefLabel ?? 'Abrir'}
                      </Link>
                    )}
                    <Link href={`/reportes/nuevo?plantilla=${p.id}`} className="btn quiet">
                      Abrir en el constructor
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          </div>
          <div className="panel-foot">
            Cada cifra de estas tarjetas se abre: las de propiedad y las de liquidez van directas al
            detalle de movimientos con sus filtros puestos, y los recuentos a la pantalla que los
            calcula, que abre desde ahí hasta la transacción. Un número que no se puede explicar no
            se muestra, y eso vale también para el catálogo.
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>El resto del catálogo</h2>
            <small>
              {RESTO.length} plantillas más · {PLANTILLAS_TOTAL} en total
            </small>
          </div>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Pregunta</th>
                  <th>Medida y dimensiones</th>
                  <th>Estado</th>
                  <th className="r">Dónde</th>
                </tr>
              </thead>
              <tbody>
                {RESTO.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <b>{p.question}</b>
                      <div className="small faint">{p.why}</div>
                      {p.falta !== undefined && (
                        <div className={styles.falta}>Falta: {p.falta}</div>
                      )}
                    </td>
                    <td>
                      <Receta plantilla={p} />
                    </td>
                    <td>
                      <EstadoChip estado={p.estado} />
                    </td>
                    <td className="r">
                      <div className={styles.actions} style={{ justifyContent: 'flex-end' }}>
                        {p.href !== undefined && (
                          <Link href={p.href} className="btn">
                            {p.hrefLabel ?? 'Abrir'}
                          </Link>
                        )}
                        <Link href={`/reportes/nuevo?plantilla=${p.id}`} className="btn quiet">
                          Construir
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Tus reportes guardados</h2>
            <small>Ninguno todavía, y no por falta de uso</small>
          </div>
          <div className="panel-body">
            <Empty
              title="Todavía no se pueden guardar"
              action={
                <Link href="/reportes/nuevo" className="btn">
                  Componer una pregunta igual
                </Link>
              }
            >
              No hay tabla de reportes en la base, así que no hay nada que listar acá y no vamos a
              enseñar una lista de ejemplo. Lo que sí existe es el objeto que se va a guardar: el
              constructor lo escribe entero y lo enseña en JSON. Ese objeto es también la URL que se
              comparte, el parámetro del PDF programado y la herramienta que va a invocar el
              asistente, así que guardarlo es persistir una fila, no rehacer nada.
            </Empty>
          </div>
          <div className="notes">
            <h3>Lo que falta para que esta sección tenga contenido</h3>
            <ul>
              <li>
                La tabla <code>report</code> con el IR versionado y su historial.
              </li>
              <li>
                Compartir: JWT firmado con caducidad, alcance limitado a ese IR exacto, revocable y
                con registro de accesos visible para el dueño. Nada de enlaces públicos con los
                filtros en la URL.
              </li>
              <li>
                Programar: cron, destinatarios que pueden no ser usuarios y formatos. Se guarda el
                IR y se renderiza a la hora, nunca el resultado congelado.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </>
  )
}
