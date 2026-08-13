import { descriptionTokens, normalizeDescription } from '@moneypilot/core'
import {
  type CategoryNode,
  categoryTree,
  dimensionsWithValues,
  movements,
  type SpendByCategoryMonthRow,
  type SpendByDimensionRow,
  spendByCategoryMonth,
  spendByDimension,
  topMerchants,
  totals,
} from '@moneypilot/db'
import Link from 'next/link'
import {
  addMonths,
  firstDayOfMonth,
  lastDayOfMonth,
  lastMonths,
  monthOf,
  readHousehold,
  today,
} from '@/lib/data'
import { capitalize, formatMonth, money } from '@/lib/format'
import { navItem } from '@/lib/nav'
import { NoData } from '../empty-state'
import { Coverage, Delta, Empty, Money, PageBar, StackedBars, type StackSeries } from '../ui'

export const dynamic = 'force-dynamic'

/** Categorías que se pintan con color propio en las barras. La quinta es 'Resto'. */
const SERIES_VISIBLES = 4
const MESES_BARRAS = 12

/**
 * Movimientos del mes que se traen para reconstruir el descriptor original de
 * cada comercio. Es el tope del repositorio; ver `terminoDeBusqueda`.
 */
const VENTANA_DESCRIPTORES = 500

export default async function MesPage({
  searchParams,
}: {
  searchParams: Promise<{ readonly [clave: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const hoy = today()
  const mesActual = monthOf(hoy)
  const pedido = params['mes']
  const mes =
    typeof pedido === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(pedido) ? pedido : mesActual

  const desde = firstDayOfMonth(mes)
  const hasta = lastDayOfMonth(mes)
  const mesPrevio = addMonths(mes, -1)
  const columnas = lastMonths(`${mes}-01`, MESES_BARRAS)
  const previos = lastMonths(`${mesPrevio}-01`, 12)

  // Una sola transacción: la ventana de 13 meses cubre las barras (12 columnas)
  // y el promedio (los 12 meses ANTERIORES al elegido, que no incluyen a este).
  const { data } = await readHousehold(async (client, session) => {
    const moneda = session.baseCurrency
    // En serie: las nueve van por el mismo cliente —una transacción, una
    // conexión—, así que pg las encola igual. Promise.all daba paralelismo
    // aparente y un aviso de query concurrente sobre un cliente ocupado, que
    // en pg@9 será un error.
    const hay = await movements(client, { limit: 1 })
    const mesTotales = await totals(client, { from: desde, to: hasta, currency: moneda })
    const previoTotales = await totals(client, {
      from: firstDayOfMonth(mesPrevio),
      to: lastDayOfMonth(mesPrevio),
      currency: moneda,
    })
    const categorias = await spendByCategoryMonth(client, {
      from: firstDayOfMonth(addMonths(mes, -12)),
      to: hasta,
      currency: moneda,
      depth: 1,
    })
    const arbol = await categoryTree(client)
    const comercios = await topMerchants(client, {
      from: desde,
      to: hasta,
      currency: moneda,
      limit: 10,
    })
    const descriptores = await movements(client, {
      from: desde,
      to: hasta,
      includeTransfers: false,
      limit: VENTANA_DESCRIPTORES,
    })
    const propiedades = await spendByDimension(client, {
      dimensionKey: 'propiedad',
      from: desde,
      to: hasta,
      currency: moneda,
    })
    const dimensiones = await dimensionsWithValues(client)
    return {
      moneda,
      vacio: hay.total === 0,
      mesTotales,
      previoTotales,
      categorias,
      arbol,
      comercios,
      descriptores,
      propiedades,
      dimensiones,
    }
  })

  const { moneda, mesTotales, previoTotales, comercios, propiedades } = data
  const item = navItem('/mes')
  const titulo = item?.label ?? 'Este mes'
  const nombreMes = capitalize(formatMonth(mes))

  const herramientas = <SelectorDeMes mes={mes} mesActual={mesActual} />

  if (data.vacio) {
    return (
      <>
        <PageBar title={titulo} {...(item === undefined ? {} : { blurb: item.blurb })} />
        <div className="page">
          <NoData what="en qué se fue el mes" />
        </div>
      </>
    )
  }

  /* ── Derivados del mes ─────────────────────────────────────────────────── */

  const gasto = mesTotales.expense
  const gastoPrevio = previoTotales.expense

  const gastoPorMes = new Map<string, bigint>()
  const noConvertidosPorMes = new Map<string, number>()
  for (const fila of data.categorias) {
    gastoPorMes.set(fila.month, (gastoPorMes.get(fila.month) ?? 0n) + fila.amount)
    noConvertidosPorMes.set(
      fila.month,
      (noConvertidosPorMes.get(fila.month) ?? 0) + fila.unconverted,
    )
  }

  // El promedio se divide por los meses que TIENEN gasto, no por doce. Un hogar
  // con tres meses de historia dividido entre doce da un promedio cuatro veces
  // menor que el real, y la comparación diría que este mes se disparó.
  const mesesConDato = previos.filter((m) => (gastoPorMes.get(m) ?? 0n) > 0n)
  const sumaPrevios = mesesConDato.reduce((suma, m) => suma + (gastoPorMes.get(m) ?? 0n), 0n)
  const promedio = mesesConDato.length === 0 ? null : sumaPrevios / BigInt(mesesConDato.length)
  const mayorDelBullet = promedio === null ? 0n : gasto > promedio ? gasto : promedio
  const noConvertidosPrevios = previos.reduce(
    (suma, m) => suma + (noConvertidosPorMes.get(m) ?? 0),
    0,
  )

  const delMes = data.categorias.filter((fila) => fila.month === mes)
  const delPrevio = new Map(
    data.categorias
      .filter((fila) => fila.month === mesPrevio)
      .map((fila) => [fila.categoryId, fila]),
  )
  const categoriasOrdenadas = [...delMes].sort((a, b) => (b.amount > a.amount ? 1 : -1))
  const sinCategorizar = delMes.find((fila) => fila.category.toLowerCase() === 'sin categorizar')

  const series = construirSeries(data.categorias, columnas)
  const totalVentana = columnas.reduce((suma, m) => suma + (gastoPorMes.get(m) ?? 0n), 0n)
  const noConvertidosVentana = columnas.reduce(
    (suma, m) => suma + (noConvertidosPorMes.get(m) ?? 0),
    0,
  )

  const grupos = agruparPropiedades(propiedades, data.dimensiones)
  const totalPropiedades = grupos.reduce((suma, grupo) => suma + grupo.total, 0n)
  const noConvertidosPropiedades = propiedades.reduce((suma, fila) => suma + fila.unconverted, 0)
  const hayDimensionPropiedad = data.dimensiones.some((dim) => dim.key === 'propiedad')

  const ramas = ramasDeCategoria(data.arbol)

  const descriptores = descriptoresPorComercio(data.descriptores.rows)
  const terminos = new Map(
    comercios.rows.map((fila) => [
      fila.merchant,
      terminoDeBusqueda(descriptores.get(claveDeComercio(fila.merchant)) ?? []),
    ]),
  )
  const comerciosSinEnlace = [...terminos.values()].filter((t) => t === null).length

  const comerciosTotales = comercios.rows.length + comercios.truncated
  const corteVeinte = Math.max(1, Math.ceil(comerciosTotales / 5))
  const filaPareto =
    corteVeinte <= comercios.rows.length ? comercios.rows[corteVeinte - 1] : undefined
  const ultimoComercio = comercios.rows[comercios.rows.length - 1]

  const enCurso = mes === mesActual
  const diasDelMes = Number.parseInt(hasta.slice(8), 10)
  const diasCorridos = Number.parseInt(hoy.slice(8), 10)
  const futuro = mes > mesActual
  const sinMovimientos = gasto === 0n && mesTotales.income === 0n && mesTotales.transactions === 0

  /* ── Pantalla ──────────────────────────────────────────────────────────── */

  return (
    <>
      <PageBar
        title={titulo}
        {...(item === undefined ? {} : { blurb: item.blurb })}
        tools={herramientas}
      />

      <div className="page">
        {futuro && <div className="notice">{nombreMes} todavía no empezó.</div>}

        {enCurso && !sinMovimientos && (
          <div className="notice">
            {nombreMes} está en curso: van {diasCorridos} de {diasDelMes} días. Contra un mes
            cerrado todavía no es una comparación —{' '}
            {diasDelMes - diasCorridos === 1
              ? 'queda un día'
              : `quedan ${diasDelMes - diasCorridos} días`}{' '}
            de gasto por entrar.
          </div>
        )}

        {sinMovimientos ? (
          <div className="panel">
            <Empty title={`Ni un gasto ni un ingreso en ${formatMonth(mes)}`}>
              El hogar tiene movimientos, pero ninguno cae en este mes. Probá con otro período desde
              el selector de arriba, o mirá el registro completo en{' '}
              <Link href="/movimientos">Movimientos</Link>.
            </Empty>
          </div>
        ) : (
          <>
            <div className="panel">
              <div className="panel-head">
                <h2>{nombreMes}</h2>
                <div className="actions">
                  <small>Consolidado en {moneda}</small>
                  <Link
                    className="btn quiet"
                    href={`/movimientos?${enlaceMovimientos({ desde, hasta })}`}
                  >
                    Ver los movimientos
                  </Link>
                </div>
              </div>

              <div className="tiles">
                <div className="tile">
                  <div className="k">Gasto del mes</div>
                  <div className="v">
                    <Money amount={gasto} currency={moneda} />
                  </div>
                  {/* `transactions` cuenta los asientos con gasto O ingreso, no
                      sólo los de gasto: decir "N operaciones" a secas debajo del
                      gasto invita a dividir una cosa por la otra. */}
                  <div className="sub">
                    {mesTotales.transactions}{' '}
                    {mesTotales.transactions === 1 ? 'operación' : 'operaciones'} de gasto e ingreso
                  </div>
                </div>

                <div className="tile">
                  <div className="k">Contra {formatMonth(mesPrevio, 'short')}</div>
                  <div className="v">
                    <Delta value={gasto - gastoPrevio} base={gastoPrevio} invert />
                  </div>
                  <div className="sub">
                    <Money amount={gastoPrevio} currency={moneda} /> el mes pasado
                  </div>
                </div>

                <div className="tile">
                  <div className="k">Contra tu promedio</div>
                  <div className="v">
                    {promedio === null ? (
                      <span className="faint">—</span>
                    ) : (
                      <Delta value={gasto - promedio} base={promedio} invert />
                    )}
                  </div>
                  <div className="sub">
                    {promedio === null ? (
                      'sin meses previos con gasto'
                    ) : (
                      <>
                        <Money amount={promedio} currency={moneda} /> de media en{' '}
                        {mesesConDato.length} {mesesConDato.length === 1 ? 'mes' : 'meses'}
                      </>
                    )}
                  </div>
                </div>

                <div className="tile">
                  <div className="k">Ingresos</div>
                  <div className="v">
                    <Money amount={mesTotales.income} currency={moneda} />
                  </div>
                </div>

                <div className="tile">
                  <div className="k">Neto</div>
                  <div className="v">
                    <Money amount={mesTotales.net} currency={moneda} tone="delta" />
                  </div>
                  <div className="sub">ingresos menos gastos</div>
                </div>
              </div>

              {promedio !== null && (
                <div className="panel-body stack">
                  <div className="label">Gasto del mes contra tu promedio</div>
                  <div className="bullet" style={{ maxWidth: 620 }}>
                    <span
                      className={gasto > promedio ? 'fill over' : 'fill'}
                      style={{ width: `${anchoEnBarra(gasto, mayorDelBullet)}%` }}
                    />
                    <span
                      className="target"
                      style={{ left: `${anchoEnBarra(promedio, mayorDelBullet)}%` }}
                    />
                  </div>
                  <div className="spread small" style={{ maxWidth: 620 }}>
                    <span className="faint">
                      Real: <Money amount={gasto} currency={moneda} />
                    </span>
                    <span className="faint">
                      Referencia: <Money amount={promedio} currency={moneda} />
                    </span>
                  </div>
                </div>
              )}

              <div className="panel-foot">
                <Coverage
                  unconverted={mesTotales.unconverted}
                  currency={moneda}
                  {...(noConvertidosPrevios > 0
                    ? {
                        extra: `la referencia deja fuera ${noConvertidosPrevios} movimientos de los meses previos`,
                      }
                    : {})}
                />
                {promedio !== null && (
                  <div style={{ marginTop: 'var(--s2)' }}>
                    La marca vertical <b>no es un presupuesto</b>: el hogar todavía no tiene ese
                    objeto, así que la referencia es tu propio gasto medio de los últimos{' '}
                    {mesesConDato.length} {mesesConDato.length === 1 ? 'mes' : 'meses'} con
                    movimiento. Cuando el presupuesto exista es esta misma barra con otra marca; y
                    hasta entonces preferimos una referencia real a un objetivo inventado.
                  </div>
                )}
              </div>
            </div>

            <div className="panel">
              <div className="panel-head">
                <h2>En qué se fue el mes</h2>
                <small>
                  {formatMonth(columnas[0] ?? mes, 'short')} → {formatMonth(mes, 'short')} · primer
                  nivel de categoría
                </small>
              </div>

              {totalVentana > 0n && (
                <div className="panel-body">
                  <StackedBars columns={columnas.map(etiquetaEje)} series={series} height={170} />
                </div>
              )}

              {categoriasOrdenadas.length === 0 ? (
                <Empty title="Sin gasto que desglosar">
                  Hubo movimiento en {formatMonth(mes)}, pero nada que sea un gasto.
                </Empty>
              ) : (
                <div className="scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Categoría</th>
                        <th className="r">Importe</th>
                        <th className="r">% del mes</th>
                        <th className="r">Contra {formatMonth(mesPrevio, 'short')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categoriasOrdenadas.map((fila) => {
                        const anterior = delPrevio.get(fila.categoryId)?.amount ?? 0n
                        return (
                          <tr key={fila.categoryId}>
                            <td>
                              <Link
                                href={`/movimientos?${enlaceMovimientos({
                                  categoria: ramas.get(fila.categoryId) ?? [fila.categoryId],
                                  desde,
                                  hasta,
                                })}`}
                              >
                                {fila.category}
                              </Link>
                              {fila.unconverted > 0 && (
                                <>
                                  {' '}
                                  <span className="status warn">
                                    {fila.unconverted} sin convertir
                                  </span>
                                </>
                              )}
                            </td>
                            <td className="r">
                              <Money amount={fila.amount} currency={moneda} />
                            </td>
                            <td className="r faint">{porcentaje(fila.amount, gasto)}</td>
                            <td className="r">
                              <Delta value={fila.amount - anterior} base={anterior} invert />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td>
                          <Link href={`/movimientos?${enlaceMovimientos({ desde, hasta })}`}>
                            Total
                          </Link>
                        </td>
                        <td className="r">
                          <Money amount={gasto} currency={moneda} />
                        </td>
                        <td className="r faint">{porcentaje(gasto, gasto)}</td>
                        <td className="r">
                          <Delta value={gasto - gastoPrevio} base={gastoPrevio} invert />
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              <div className="panel-foot">
                <Coverage
                  unconverted={noConvertidosVentana}
                  currency={moneda}
                  extra={`${columnas.length} meses de historia en las barras`}
                />
                {sinCategorizar !== undefined && (
                  <div style={{ marginTop: 'var(--s2)' }}>
                    {porcentaje(sinCategorizar.amount, gasto)} del mes está sin categorizar. Hasta
                    que tenga categoría, ese importe pesa en el total pero no explica nada.
                  </div>
                )}
              </div>
            </div>

            <div className="grid2">
              <div className="panel">
                <div className="panel-head">
                  <h2>Top comercios</h2>
                  <small>
                    {comercios.rows.length} de {comerciosTotales} del mes
                  </small>
                </div>

                {comercios.rows.length === 0 ? (
                  <Empty title="Sin comercios que ordenar">
                    Los movimientos del mes no traen descripción reconocible como comercio.
                  </Empty>
                ) : (
                  <div className="scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Comercio</th>
                          <th className="r">Mov.</th>
                          <th className="r">Importe</th>
                          <th className="r">% mes</th>
                          <th>Acumulado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comercios.rows.map((fila) => {
                          const termino = terminos.get(fila.merchant) ?? null
                          return (
                            <tr key={fila.merchant}>
                              <td>
                                {termino === null ? (
                                  <span title="No se pudo reconstruir el descriptor original">
                                    {fila.merchant}
                                  </span>
                                ) : (
                                  <Link
                                    href={`/movimientos?${enlaceMovimientos({
                                      buscar: termino,
                                      desde,
                                      hasta,
                                    })}`}
                                  >
                                    {fila.merchant}
                                  </Link>
                                )}
                              </td>
                              <td className="r faint">{fila.transactions}</td>
                              <td className="r">
                                <Money amount={fila.amount} currency={moneda} />
                              </td>
                              <td className="r faint">
                                {porcentaje(fila.amount, comercios.totalSpend)}
                              </td>
                              <td>
                                <div
                                  className="row"
                                  style={{ gap: 'var(--s2)', flexWrap: 'nowrap' }}
                                >
                                  <div className="bullet" style={{ width: 68, flex: 'none' }}>
                                    <span
                                      className="fill"
                                      style={{ width: `${Math.round(fila.share * 100)}%` }}
                                    />
                                  </div>
                                  <span className="num faint">
                                    {(fila.share * 100).toFixed(0)}%
                                  </span>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="panel-foot">
                  {filaPareto !== undefined ? (
                    <div>
                      El 20% de tus comercios —{corteVeinte} de {comerciosTotales}— explica el{' '}
                      <b>{unDecimal(filaPareto.share * 100)}%</b> del gasto del mes.
                    </div>
                  ) : (
                    ultimoComercio !== undefined && (
                      <div>
                        Los {comercios.rows.length} comercios más grandes explican el{' '}
                        <b>{unDecimal(ultimoComercio.share * 100)}%</b> del gasto del mes; hay{' '}
                        {comerciosTotales} en total.
                      </div>
                    )
                  )}
                  <div style={{ marginTop: 'var(--s2)' }}>
                    <Coverage
                      unconverted={comercios.unconverted}
                      currency={moneda}
                      extra={`acumulado sobre ${money(comercios.totalSpend, moneda)} de gasto convertido`}
                    />
                  </div>
                  {comerciosSinEnlace > 0 && (
                    <div style={{ marginTop: 'var(--s2)' }}>
                      <span className="status warn">
                        {comerciosSinEnlace}{' '}
                        {comerciosSinEnlace === 1 ? 'comercio no se abre' : 'comercios no se abren'}
                      </span>{' '}
                      No se pudo recuperar el descriptor original con el que buscarlos en el
                      registro —esta pantalla mira los primeros {VENTANA_DESCRIPTORES} movimientos
                      del mes—. El importe es correcto; lo que falta es el enlace.
                    </div>
                  )}
                </div>
              </div>

              <div className="panel">
                <div className="panel-head">
                  <h2>Gasto por propiedad</h2>
                  <small>reparto con peso, en {moneda}</small>
                </div>

                {grupos.length === 0 ? (
                  <Empty title="Nada imputado a una propiedad">
                    {hayDimensionPropiedad
                      ? 'Los movimientos del mes no tienen atribución a ninguna propiedad. La atribución se pone en el movimiento, y sin ella la pregunta «cuánto me cuesta la casa de Madrid» no tiene respuesta.'
                      : 'Este hogar todavía no tiene la dimensión «propiedad». Creala en Dimensiones y empezá a imputar: es lo que convierte una lista de gastos en el coste de cada casa.'}
                  </Empty>
                ) : (
                  <div className="scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Propiedad</th>
                          <th className="r">Mov.</th>
                          <th className="r">Importe</th>
                          <th className="r">% mes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {grupos.flatMap((grupo) => [
                          <tr key={grupo.id}>
                            <td>
                              <Link
                                href={`/movimientos?${enlaceMovimientos({
                                  dimension: grupo.ids,
                                  desde,
                                  hasta,
                                })}`}
                              >
                                <b>{grupo.label}</b>
                              </Link>
                              {grupo.overAttributed > 0 && (
                                <>
                                  {' '}
                                  <span className="status warn">
                                    {grupo.overAttributed} reescalados
                                  </span>
                                </>
                              )}
                            </td>
                            <td className="r faint">{grupo.transacciones}</td>
                            <td className="r">
                              <Money amount={grupo.total} currency={moneda} />
                            </td>
                            <td className="r faint">{porcentaje(grupo.total, gasto)}</td>
                          </tr>,
                          ...grupo.hijos.map((hijo) => (
                            <tr key={`${grupo.id}:${hijo.id}`}>
                              <td style={{ paddingLeft: 'var(--s5)' }}>
                                <Link
                                  href={`/movimientos?${enlaceMovimientos({
                                    dimension: [hijo.id],
                                    desde,
                                    hasta,
                                  })}`}
                                >
                                  {hijo.label}
                                </Link>
                              </td>
                              <td className="r faint">{hijo.transacciones}</td>
                              <td className="r">
                                <Money amount={hijo.amount} currency={moneda} />
                              </td>
                              <td className="r faint">{porcentaje(hijo.amount, gasto)}</td>
                            </tr>
                          )),
                        ])}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td>
                            <Link
                              href={`/movimientos?${enlaceMovimientos({
                                dimension: grupos.flatMap((grupo) => grupo.ids),
                                desde,
                                hasta,
                              })}`}
                            >
                              Imputado a propiedades
                            </Link>
                          </td>
                          <td />
                          <td className="r">
                            <Money amount={totalPropiedades} currency={moneda} />
                          </td>
                          <td className="r faint">{porcentaje(totalPropiedades, gasto)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}

                {grupos.length > 0 && (
                  <div className="panel-foot">
                    <Coverage unconverted={noConvertidosPropiedades} currency={moneda} />
                    <div style={{ marginTop: 'var(--s2)' }}>
                      El resto del gasto del mes —{porcentaje(gasto - totalPropiedades, gasto)}— no
                      está imputado a ninguna propiedad. No es un error: la nómina de la casa sí es
                      de una casa, el impuesto de sociedades no es de ninguna.
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}

/* ── Selector de período ─────────────────────────────────────────────────── */

/**
 * Seis meses terminando en el elegido, más un paso adelante.
 *
 * Son enlaces y no un `<select>` con JavaScript: el período es parte de la
 * dirección, así que un mes concreto se puede compartir, marcar y volver a él
 * con el botón de atrás. Un desplegable que navega en `onChange` pierde las
 * tres cosas.
 */
function SelectorDeMes({ mes, mesActual }: { mes: string; mesActual: string }) {
  return (
    <div className="chips">
      {lastMonths(`${mes}-01`, 6).map((opcion) => (
        <Link
          key={opcion}
          href={`/mes?mes=${opcion}`}
          className={opcion === mes ? 'chip on' : 'chip'}
          aria-current={opcion === mes ? 'page' : undefined}
        >
          {etiquetaChip(opcion)}
        </Link>
      ))}
      {mes < mesActual && (
        <Link href={`/mes?mes=${addMonths(mes, 1)}`} className="chip" aria-label="Mes siguiente">
          ›
        </Link>
      )}
      {mes !== mesActual && (
        <Link href="/mes" className="chip">
          Este mes
        </Link>
      )}
    </div>
  )
}

/* ── Cálculos ────────────────────────────────────────────────────────────── */

/**
 * Las series de las barras: las cuatro categorías más grandes de la ventana y
 * todo lo demás junto.
 *
 * Cinco series es el límite del sistema de diseño (hay cinco tonos de segmento)
 * y también el límite de lo que un ojo distingue en una barra apilada. La
 * quinta serie se llama 'Resto' y no 'Otros': no es una categoría del hogar,
 * es lo que esta pantalla decidió no desglosar.
 */
function construirSeries(
  filas: readonly SpendByCategoryMonthRow[],
  columnas: readonly string[],
): StackSeries[] {
  const enVentana = new Set(columnas)
  const totalPorCategoria = new Map<string, { label: string; total: bigint }>()
  for (const fila of filas) {
    if (!enVentana.has(fila.month)) continue
    const previo = totalPorCategoria.get(fila.categoryId)
    totalPorCategoria.set(fila.categoryId, {
      label: fila.category,
      total: (previo?.total ?? 0n) + fila.amount,
    })
  }

  const ordenadas = [...totalPorCategoria.entries()].sort((a, b) =>
    b[1].total > a[1].total ? 1 : -1,
  )
  const visibles = ordenadas.slice(0, SERIES_VISIBLES)
  const resto = new Set(ordenadas.slice(SERIES_VISIBLES).map(([id]) => id))

  const series: StackSeries[] = visibles.map(([id, { label }]) => ({
    label,
    values: columnas.map((columna) =>
      filas
        .filter((fila) => fila.month === columna && fila.categoryId === id)
        .reduce((suma, fila) => suma + fila.amount, 0n),
    ),
  }))

  if (resto.size > 0) {
    series.push({
      label: `Resto (${resto.size})`,
      values: columnas.map((columna) =>
        filas
          .filter((fila) => fila.month === columna && resto.has(fila.categoryId))
          .reduce((suma, fila) => suma + fila.amount, 0n),
      ),
    })
  }

  return series
}

interface HijoPropiedad {
  readonly id: string
  readonly label: string
  readonly amount: bigint
  readonly transacciones: number
}

interface GrupoPropiedad {
  readonly id: string
  /** El valor padre y todos sus hijos: es lo que hay que filtrar para abrir el total. */
  readonly ids: readonly string[]
  readonly label: string
  readonly total: bigint
  readonly transacciones: number
  readonly overAttributed: number
  readonly hijos: readonly HijoPropiedad[]
}

/**
 * Pliega los valores de la dimensión en propiedad → áreas.
 *
 * El repositorio devuelve los valores tal como están atribuidos, con su
 * `parentId`, y deja la decisión acá. Se pliega porque la pregunta del usuario
 * es "cuánto me cuesta la casa de Madrid", no "cuánto me costaron sus seguros".
 *
 * El gasto imputado al padre directamente (la hipoteca, que no es de ningún
 * área) se muestra como una fila 'Sin área' en vez de quedar sólo dentro del
 * total: si no, la suma de las filas visibles no da el total de arriba y el
 * usuario no tiene forma de saber de dónde sale la diferencia.
 */
function agruparPropiedades(
  filas: readonly SpendByDimensionRow[],
  dimensiones: readonly { key: string; values: readonly { id: string; label: string }[] }[],
): GrupoPropiedad[] {
  const etiquetas = new Map<string, string>()
  for (const dim of dimensiones) {
    if (dim.key !== 'propiedad') continue
    for (const valor of dim.values) etiquetas.set(valor.id, valor.label)
  }

  interface Acumulado {
    id: string
    label: string
    propio: bigint
    propioTransacciones: number
    total: bigint
    transacciones: number
    overAttributed: number
    hijos: HijoPropiedad[]
  }

  const grupos = new Map<string, Acumulado>()
  for (const fila of filas) {
    const grupoId = fila.parentId ?? fila.valueId
    const existente = grupos.get(grupoId)
    const grupo: Acumulado = existente ?? {
      id: grupoId,
      label: etiquetas.get(grupoId) ?? grupoId,
      propio: 0n,
      propioTransacciones: 0,
      total: 0n,
      transacciones: 0,
      overAttributed: 0,
      hijos: [],
    }
    grupo.total += fila.amount
    grupo.transacciones += fila.transactions
    grupo.overAttributed += fila.overAttributed
    if (fila.parentId === null) {
      grupo.propio += fila.amount
      grupo.propioTransacciones += fila.transactions
      grupo.label = fila.label
    } else {
      grupo.hijos.push({
        id: fila.valueId,
        label: sinPrefijo(fila.label, etiquetas.get(grupoId) ?? ''),
        amount: fila.amount,
        transacciones: fila.transactions,
      })
    }
    grupos.set(grupoId, grupo)
  }

  return [...grupos.values()]
    .map((grupo) => {
      const hijos = [...grupo.hijos].sort((a, b) => (b.amount > a.amount ? 1 : -1))
      if (grupo.propio > 0n && hijos.length > 0) {
        hijos.push({
          id: grupo.id,
          label: 'Sin área',
          amount: grupo.propio,
          transacciones: grupo.propioTransacciones,
        })
      }
      return {
        id: grupo.id,
        ids: [grupo.id, ...grupo.hijos.map((hijo) => hijo.id)],
        label: grupo.label,
        total: grupo.total,
        transacciones: grupo.transacciones,
        overAttributed: grupo.overAttributed,
        hijos,
      }
    })
    .sort((a, b) => (b.total > a.total ? 1 : -1))
}

/* ── Drill-down: de un agregado a sus movimientos ────────────────────────── */

/**
 * Para cada categoría, su rama entera: ella y todo lo que cuelga debajo.
 *
 * La tabla agrupa por el primer nivel ('Casa'), pero los movimientos cuelgan de
 * las hojas ('Casa > Hipoteca'), y el filtro de /movimientos compara el id
 * EXACTO de la contrapartida: no expande descendientes. Enlazar sólo la raíz
 * abría el registro vacío — un total de 3.612 € que al abrirlo dice "ningún
 * movimiento" es justo el fallo que este producto existe para no cometer.
 *
 * (El listado corta en 50 ids por parámetro. Ninguna rama de categorías reales
 * se acerca, pero si alguna los pasara el filtro mostraría de menos.)
 */
function ramasDeCategoria(arbol: readonly CategoryNode[]): Map<string, string[]> {
  const hijos = new Map<string, string[]>()
  for (const nodo of arbol) {
    if (nodo.parentId === null) continue
    hijos.set(nodo.parentId, [...(hijos.get(nodo.parentId) ?? []), nodo.id])
  }

  const ramas = new Map<string, string[]>()
  for (const nodo of arbol) {
    // `visto` no es paranoia: categoryTree devuelve los nodos de un ciclo
    // marcados como sueltos pero CON su parent_id, así que bajar por hijos sin
    // memoria giraría para siempre y colgaría el render.
    const visto = new Set<string>([nodo.id])
    const rama = [nodo.id]
    for (let i = 0; i < rama.length; i += 1) {
      const actual = rama[i]
      if (actual === undefined) continue
      for (const hijo of hijos.get(actual) ?? []) {
        if (visto.has(hijo)) continue
        visto.add(hijo)
        rama.push(hijo)
      }
    }
    ramas.set(nodo.id, rama)
  }
  return ramas
}

/**
 * La clave con la que el repositorio agrupa descriptores en un comercio.
 *
 * Es la misma normalización del núcleo que usa `topMerchants`, con el mismo
 * respaldo para un descriptor hecho sólo de ruido. Tiene que serlo: si las dos
 * discrepan, un comercio del informe no encuentra sus descriptores y se queda
 * sin enlace.
 */
function claveDeComercio(texto: string): string {
  const tokens = [...descriptionTokens(texto)]
  if (tokens.length > 0) return tokens.sort().join(' ')
  const normalizado = normalizeDescription(texto)
  return normalizado === '' ? 'SIN DESCRIPCION' : normalizado
}

function descriptoresPorComercio(
  filas: readonly { readonly description: string }[],
): Map<string, string[]> {
  const porClave = new Map<string, Set<string>>()
  for (const fila of filas) {
    const clave = claveDeComercio(fila.description)
    const set = porClave.get(clave) ?? new Set<string>()
    set.add(fila.description)
    porClave.set(clave, set)
  }
  return new Map([...porClave].map(([clave, set]) => [clave, [...set]]))
}

/**
 * Con qué texto se abre un comercio en /movimientos.
 *
 * `topMerchants` devuelve el comercio ya normalizado —mayúsculas, sin acentos,
 * sin puntuación y sin palabras vacías— y el buscador del listado hace `ilike`
 * sobre la descripción TAL CUAL está en el asiento. Buscar
 * 'GESTORIA FERRER IGUALA MENSUAL' contra 'Gestoría Ferrer — iguala mensual' no
 * devuelve nada: el enlace existía y no llevaba a ningún sitio.
 *
 * Así que el texto sale de los movimientos del propio mes. Cuando el comercio
 * agrupa varios descriptores (el mismo con distintos números de referencia) se
 * usa la palabra más larga que aparece en todos: es el filtro más estrecho que
 * sigue trayéndolos enteros. Si no hay ninguna, se devuelve null y la fila se
 * queda sin enlace en vez de con uno que no encuentra nada.
 */
function terminoDeBusqueda(descripciones: readonly string[]): string | null {
  const primera = descripciones[0]
  if (primera === undefined) return null
  if (descripciones.length === 1) return primera
  const palabras = [...new Set(primera.split(/\s+/))]
    .filter((palabra) => palabra.length > 1)
    .sort((a, b) => b.length - a.length)
  return (
    palabras.find((palabra) =>
      descripciones.every((otra) => otra.toLowerCase().includes(palabra.toLowerCase())),
    ) ?? null
  )
}

/** 'Casa Madrid · Seguros' bajo 'Casa Madrid' se lee mejor como 'Seguros'. */
function sinPrefijo(label: string, padre: string): string {
  const prefijo = `${padre} · `
  return padre !== '' && label.startsWith(prefijo) ? label.slice(prefijo.length) : label
}

/* ── Formato local ───────────────────────────────────────────────────────── */

/**
 * Porcentaje de una parte sobre un total. Se calcula en enteros y se pasa a
 * decimal recién al final, por lo mismo que los importes: dividir bigints en
 * coma flotante para "sólo mostrarlo" es reintroducir el error donde se ve.
 */
function porcentaje(parte: bigint, total: bigint): string {
  if (total === 0n) return '—'
  return `${unDecimal(Number((parte * 1000n) / total) / 10)}%`
}

function unDecimal(valor: number): string {
  return valor.toFixed(1).replace('.', ',')
}

/**
 * Ancho en porcentaje dentro de una barra cuyo techo deja un 25% de aire.
 *
 * El aire no es estético: sin él, el mayor de los dos valores toca el borde y
 * deja de leerse como una cantidad — se lee como "lleno".
 */
function anchoEnBarra(valor: bigint, mayor: bigint): number {
  const techo = (mayor * 5n) / 4n
  if (techo <= 0n) return 0
  const bruto = Number((valor * 1000n) / techo) / 10
  return bruto < 0 ? 0 : bruto > 100 ? 100 : bruto
}

function etiquetaChip(mes: string): string {
  const [nombre = mes, anio = ''] = formatMonth(mes, 'short').split(' ')
  return anio === '' ? nombre : `${nombre} ${anio.slice(2)}`
}

function etiquetaEje(mes: string): string {
  return formatMonth(mes, 'short').split(' ')[0] ?? mes
}

/**
 * Los filtros con los que se abre /movimientos.
 *
 * Todo número de esta pantalla tiene que poder abrirse hasta la transacción, y
 * el destino es siempre el mismo: el registro con el filtro puesto. `categoria`
 * y `dimension` viajan repetidos cuando el total agrupa una rama entera — un
 * total que se abre y muestra menos filas de las que suma sería peor que no
 * enlazarlo.
 */
function enlaceMovimientos(filtros: {
  categoria?: readonly string[]
  dimension?: readonly string[]
  buscar?: string
  desde: string
  hasta: string
}): string {
  const params = new URLSearchParams()
  for (const valor of filtros.categoria ?? []) params.append('categoria', valor)
  for (const valor of filtros.dimension ?? []) params.append('dimension', valor)
  if (filtros.buscar !== undefined) params.set('buscar', filtros.buscar)
  params.set('desde', filtros.desde)
  params.set('hasta', filtros.hasta)
  return params.toString()
}
