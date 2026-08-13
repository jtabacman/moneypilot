/**
 * /movimientos — el registro completo, y el destino de todo drill-down.
 *
 * Cada número de cada tablero del producto termina en esta pantalla con
 * filtros puestos, así que dos cosas la gobiernan:
 *
 *  1. **El estado es la URL.** Ver filters.ts. Nada de estado de cliente: un
 *     enlace tiene que reproducir lo que otro está mirando.
 *  2. **Lo que queda fuera se dice.** Las patas de traspaso excluidas, los
 *     movimientos que no existen en la moneda de reporte y la suma que no se
 *     pudo recorrer entera se declaran en la propia pantalla. Una lista que
 *     esconde filas y una suma incompleta que no se anuncia son el mismo
 *     fallo, y es el fallo que este producto existe para no cometer.
 */

import {
  type AccountBalance,
  accountBalances,
  type CategoryNode,
  categoryTree,
  type DimensionSummary,
  dimensionsWithValues,
  type MovementRow,
  movements,
} from '@moneypilot/db'
import Link from 'next/link'
import { currentMonthPeriod, readHousehold, today } from '@/lib/data'
import { formatDate } from '@/lib/format'
import { navItem } from '@/lib/nav'
import { NoData } from '../empty-state'
import { Coverage, Empty, Money, PageBar } from '../ui'
import {
  aFiltroDb,
  con,
  type Filtros,
  hayFiltros,
  mas,
  menos,
  PAGE_SIZE,
  parseEntrada,
  ruta,
  SIN_FILTROS,
} from './filters'
import styles from './page.module.css'
import { enMoneda, resumirFiltro, TOPE_SUMA } from './resumen'

export const dynamic = 'force-dynamic'

/** «cuentas, categorías y dimensiones». */
function enumerar(partes: readonly string[]): string {
  if (partes.length <= 1) return partes[0] ?? ''
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
}

export default async function MovimientosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { filtros: f, recortados } = parseEntrada(await searchParams)
  const filtro = aFiltroDb(f)
  const offset = (f.pagina - 1) * PAGE_SIZE

  const { session, data } = await readHousehold(async (client, sesion) => {
    const [pagina, cuentas, categorias, dimensiones, conTraspasos] = await Promise.all([
      movements(client, { ...filtro, limit: PAGE_SIZE, offset }),
      accountBalances(client),
      categoryTree(client),
      dimensionsWithValues(client),
      // Cuántas patas de traspaso deja fuera el filtro. Sin este número la
      // lista escondería filas sin decirlo, que es justo lo que no hacemos.
      f.traspasos ? null : movements(client, { ...filtro, includeTransfers: true, limit: 1 }),
    ])

    // Si el filtro entero cupo en la primera página, ya está leído: sumar no
    // tiene por qué costar una segunda ida a la base.
    const completa = f.pagina === 1 && pagina.total <= PAGE_SIZE
    const resumen = await resumirFiltro(
      client,
      filtro,
      sesion.baseCurrency,
      pagina.total,
      completa ? pagina.rows : null,
    )

    return { pagina, cuentas, categorias, dimensiones, conTraspasos, resumen }
  })

  const { pagina, cuentas, categorias, dimensiones, conTraspasos, resumen } = data
  const moneda = session.baseCurrency
  const nav = navItem('/movimientos')
  const cabecera =
    nav === undefined ? { title: 'Movimientos' } : { title: nav.label, blurb: nav.blurb }

  // Un hogar recién creado ve esto y nada más. "Sin resultados" y "sin datos"
  // llevan a acciones opuestas, así que no pueden verse igual.
  const conMovimientos = cuentas.some(
    (c) => (c.kind === 'asset' || c.kind === 'liability') && c.movements > 0,
  )
  if (!conMovimientos) {
    return (
      <>
        <PageBar {...cabecera} />
        <div className="page">
          <NoData what="tus movimientos" />
        </div>
      </>
    )
  }

  const ocultos = conTraspasos === null ? 0 : Math.max(0, conTraspasos.total - pagina.total)
  const ultima = Math.max(1, Math.ceil(pagina.total / PAGE_SIZE))
  const mesActual = currentMonthPeriod(today())

  return (
    <>
      <PageBar
        {...cabecera}
        tools={
          hayFiltros(f) ? (
            <Link className="btn quiet" href={ruta(SIN_FILTROS)}>
              Quitar todos los filtros
            </Link>
          ) : undefined
        }
      />

      <div className="page">
        {/* Un enlace que traía más ids de los que caben en una URL razonable se
            recorta, pero no en silencio: quien llegó desde un total vería el
            detalle de una parte con cara de estar entero. */}
        {recortados.length > 0 && (
          <div className="notice">
            <b>Este enlace traía más {enumerar(recortados)} de las que caben en un filtro.</b> Se
            aplicaron las primeras y el resto quedó fuera, así que la lista y la suma de abajo son
            de una parte de lo que pediste. Acotá desde el formulario para que el total signifique
            algo.
          </div>
        )}

        <ChipsActivos f={f} cuentas={cuentas} categorias={categorias} dimensiones={dimensiones} />

        <Formulario f={f} cuentas={cuentas} categorias={categorias} dimensiones={dimensiones} />

        <div className="panel">
          <div className="panel-head">
            <h2>{hayFiltros(f) ? 'Resumen del filtro' : 'Todo el registro'}</h2>
            {resumen !== null && <Coverage unconverted={resumen.sinConvertir} currency={moneda} />}
          </div>

          {resumen === null ? (
            <div className="notice">
              {pagina.total > TOPE_SUMA ? (
                <>
                  <b>{pagina.total} movimientos es demasiado para sumar.</b> La suma exige recorrer
                  el conjunto entero, y por encima de {TOPE_SUMA} eso convierte esta pantalla en una
                  espera. Antes que enseñarte la suma de una parte como si fuera la del todo, no la
                  enseñamos: acotá el período o la cuenta.{' '}
                  <Link href={ruta(con(f, { desde: mesActual.from, hasta: mesActual.to }))}>
                    Acotar a {mesActual.label.toLowerCase()}
                  </Link>
                  .
                </>
              ) : (
                <>
                  <b>No se pudo recorrer el filtro entero, así que no hay suma.</b> El listado de
                  abajo es correcto; lo que falta es el total, y un total al que le faltan
                  movimientos sin decirlo es peor que ninguno. Volvé a cargar la pantalla o acotá el
                  filtro.
                </>
              )}
            </div>
          ) : (
            <div className="tiles">
              <div className="tile">
                <div className="k">Movimientos</div>
                <div className="v">{pagina.total}</div>
                <div className="sub">
                  {f.traspasos ? 'traspasos incluidos' : 'sin patas de traspaso'}
                </div>
              </div>
              <div className="tile">
                <div className="k">Entradas</div>
                <div className="v">
                  <Money amount={resumen.entradas} currency={moneda} />
                </div>
                <div className="sub">lo que entró en el filtro</div>
              </div>
              <div className="tile">
                <div className="k">Salidas</div>
                <div className="v">
                  <Money amount={resumen.salidas} currency={moneda} tone="flow" />
                </div>
                <div className="sub">lo que salió</div>
              </div>
              <div className="tile">
                <div className="k">Neto</div>
                <div className="v">
                  <Money amount={resumen.neto} currency={moneda} tone="delta" />
                </div>
                <div className="sub">entradas menos salidas</div>
              </div>
            </div>
          )}

          {/* El drill-down más peligroso del producto. "Inés Iriarte · 5.900 €"
              en Estructura abre acá y la suma dice 11.800 €: el tablero reparte
              cada gasto por su peso de atribución y cuenta sólo gasto, y esta
              pantalla trae el asiento entero, entradas incluidas. Los dos
              números son correctos. Que uno contradiga al otro sin explicación
              es lo que no puede pasar. */}
          {resumen !== null && f.dimensiones.length > 0 && (
            <div className="panel-foot">
              <b>Esta suma es por movimiento entero, no por la parte atribuida.</b> El tablero de
              estructura reparte cada gasto según su peso y suma sólo gasto; acá está el importe
              completo de cada asiento que toca la dimensión, con sus entradas. Por eso estas cifras
              no tienen por qué coincidir con las de aquel tablero
              {resumen.repartidas > 0 && (
                <>
                  , y en {resumen.repartidas}{' '}
                  {resumen.repartidas === 1 ? 'movimiento' : 'de estos movimientos'} la atribución
                  es parcial —el porcentaje va en su etiqueta, en la tabla—
                </>
              )}
              . No es un descuadre: son dos preguntas distintas sobre los mismos asientos.
            </div>
          )}

          {resumen !== null && resumen.sinContrapartida > 0 && (
            <div className="panel-foot">
              <b>
                {resumen.sinContrapartida}{' '}
                {resumen.sinContrapartida === 1 ? 'movimiento no tiene' : 'movimientos no tienen'}{' '}
                contrapartida de gasto ni de ingreso
              </b>{' '}
              —saldos de apertura y ajustes de cambio— y suman igual, porque son filas de esta
              lista. Es la diferencia entre esta suma y el gasto del mes: acá está todo lo que se
              movió en tus cuentas, no sólo lo que fue gasto o ingreso.
            </div>
          )}

          {!f.traspasos && ocultos > 0 && (
            <div className="panel-foot">
              <b>
                {ocultos} {ocultos === 1 ? 'pata de traspaso queda' : 'patas de traspaso quedan'}{' '}
                fuera
              </b>{' '}
              de esta lista y de esta suma. Las dos patas de un traspaso interno no son gasto ni
              ingreso —pasar plata de la corriente al ahorro no empobrece a nadie— y contarlas
              duplicaría el total.{' '}
              <Link href={ruta(con(f, { traspasos: true }))}>Mostrarlas igual</Link>, marcadas y
              sumadas aparte.
            </div>
          )}
          {f.traspasos && resumen !== null && resumen.traspasos > 0 && (
            <div className="panel-foot">
              La suma incluye <b>{resumen.traspasos} patas de traspaso</b>, que no son gasto ni
              ingreso: si las dos patas de un mismo traspaso están dentro del filtro se anulan, y si
              sólo entró una, el neto se mueve por algo que no empobreció ni enriqueció a nadie.{' '}
              <Link href={ruta(con(f, { traspasos: false }))}>Sacarlas de la cuenta</Link>.
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Movimientos</h2>
            <small>
              Página {f.pagina} de {ultima}
            </small>
          </div>

          {pagina.rows.length === 0 ? (
            <Empty
              title={
                pagina.total === 0
                  ? 'Ningún movimiento con estos filtros'
                  : 'Esta página está vacía'
              }
              action={
                <Link className="btn" href={ruta(pagina.total === 0 ? SIN_FILTROS : con(f, {}))}>
                  {pagina.total === 0 ? 'Quitar los filtros' : 'Volver a la primera página'}
                </Link>
              }
            >
              {pagina.total === 0
                ? 'El hogar tiene movimientos, pero ninguno cumple lo que pediste. Probá quitando un filtro: los tenés todos arriba, con su aspa.'
                : `El filtro tiene ${pagina.total} movimientos y estás pidiendo una página que ya no existe.`}
            </Empty>
          ) : (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Fecha</th>
                    <th scope="col">Descripción</th>
                    <th scope="col">Cuenta</th>
                    <th scope="col">Categoría</th>
                    <th scope="col">Dimensiones</th>
                    <th scope="col" className="r">
                      Importe
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pagina.rows.map((row) => (
                    <Fila key={row.postingId} row={row} f={f} moneda={moneda} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Sin resultados no hay nada que paginar: dos botones apagados sólo
              ocupan sitio y hacen dudar de si el filtro falló. */}
          {pagina.total > 0 && (
            <div className="panel-foot spread">
              <span>
                {pagina.rows.length === 0
                  ? `Ninguno en esta página, de ${pagina.total}`
                  : `Mostrando ${offset + 1}–${offset + pagina.rows.length} de ${pagina.total}`}
              </span>
              <span className="row">
                {f.pagina > 1 ? (
                  <Link className="btn" href={ruta(con(f, { pagina: f.pagina - 1 }))} rel="prev">
                    ← Anterior
                  </Link>
                ) : (
                  // Apagado y con el motivo escrito: un botón que se ve igual
                  // que el que funciona y no hace nada se lee como una avería.
                  <span className="btn" aria-disabled="true" title="Ya estás en la primera página">
                    ← Anterior
                  </span>
                )}
                {f.pagina < ultima ? (
                  <Link className="btn" href={ruta(con(f, { pagina: f.pagina + 1 }))} rel="next">
                    Siguiente →
                  </Link>
                ) : (
                  <span
                    className="btn"
                    aria-disabled="true"
                    title="No hay más páginas con este filtro"
                  >
                    Siguiente →
                  </span>
                )}
              </span>
            </div>
          )}

          <div className="notes">
            <h3>Cómo leer esta tabla</h3>
            <ul>
              <li>
                Cada fila es la pata del asiento contra tu cuenta —lo que reconocés de tu extracto—
                y la categoría es su contrapartida. Cuando un mismo ticket reparte contra varias
                categorías se muestra la de mayor importe; el desglose completo vive en el asiento.
                El importe de la fila es el del movimiento entero, así que filtrar por una de esas
                categorías trae el ticket completo y no sólo su parte.
              </li>
              <li>
                Los traspasos entre tus propias cuentas van marcados y quedan fuera del gasto: son
                dos patas del mismo movimiento de plata, y contarlas duplicaría el total.
              </li>
              <li>
                La suma está en {moneda} y usa el importe que cada movimiento congeló ese día, no el
                cambio de hoy. El que no tiene importe en {moneda} no se suma y se cuenta arriba.
              </li>
              <li>
                Cualquier cuenta, categoría o dimensión de la tabla es un enlace: al tocarla se
                añade al filtro y la URL queda lista para pegarla en un correo.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </>
  )
}

/* ── Fila ────────────────────────────────────────────────────────────────── */

function Fila({ row, f, moneda }: { row: MovementRow; f: Filtros; moneda: string }) {
  const enBase = enMoneda(row, moneda)

  return (
    <tr className={row.isTransfer ? styles.traspaso : undefined}>
      <td>
        <time dateTime={row.bookedOn} title={formatDate(row.bookedOn, 'long')}>
          {formatDate(row.bookedOn)}
        </time>
      </td>

      <td>
        <div className={styles.descripcion}>
          <span>{row.description}</span>
          {row.isTransfer && <span className="status none">traspaso</span>}
          {row.needsReview && <span className="status warn">a revisar</span>}
        </div>
        {row.memo !== null && <div className="small faint">{row.memo}</div>}
      </td>

      <td>
        <Link className={styles.pivote} href={ruta(mas(f, 'cuentas', row.accountId))}>
          {row.accountName}
        </Link>
      </td>

      <td>
        {row.categoryId === null || row.category === null ? (
          // Sin categoría no es lo mismo que sin contrapartida: lo que el
          // importador no supo clasificar cae en la cuenta 'Sin categorizar',
          // que sí es una categoría. Un hueco acá es una pata que no da contra
          // gasto ni ingreso — una apertura, un ajuste de cambio.
          <span
            className="faint"
            title={
              row.isTransfer
                ? 'La otra pata está en otra cuenta tuya'
                : 'La otra pata del asiento no es de gasto ni de ingreso: saldo de apertura o ajuste de cambio'
            }
          >
            {row.isTransfer ? 'traspaso interno' : 'sin contrapartida'}
          </span>
        ) : (
          <Link className={styles.pivote} href={ruta(mas(f, 'categorias', row.categoryId))}>
            {row.category}
          </Link>
        )}
      </td>

      <td>
        {row.dimensions.length === 0 ? (
          <span className="faint">—</span>
        ) : (
          <span className="chips">
            {row.dimensions.map((d) => (
              <Link
                key={`${d.dimensionId}:${d.valueId}`}
                className="chip"
                href={ruta(mas(f, 'dimensiones', d.valueId))}
                title={`${d.label}: ${d.value}`}
              >
                {d.value}
                {/* El peso sólo se enseña cuando reparte: un 100% en cada chip
                    es ruido, y un 60% sin decirlo es un número mal leído. */}
                {d.weightPpm < 1_000_000 && (
                  <span className="faint"> {Math.round(d.weightPpm / 10_000)}%</span>
                )}
              </Link>
            ))}
          </span>
        )}
      </td>

      <td className="r">
        <Money amount={row.amount} currency={row.currency} tone="flow" />
        {row.currency !== moneda &&
          (enBase === null ? (
            <div>
              <span className="status warn">sin convertir</span>
            </div>
          ) : (
            // El importe en la moneda de reporte es el que congeló el asiento
            // ese día, no una conversión de ahora: por eso se muestra al lado
            // del original en vez de reemplazarlo.
            <div
              className="small faint"
              title={`Importe congelado en ${moneda} el día del asiento`}
            >
              <Money amount={enBase} currency={moneda} />
            </div>
          ))}
      </td>
    </tr>
  )
}

/* ── Filtros activos ─────────────────────────────────────────────────────── */

function ChipQuitar({ etiqueta, destino }: { etiqueta: string; destino: Filtros }) {
  return (
    <Link
      className={`chip ${styles.quitar}`}
      href={ruta(destino)}
      title={`Quitar filtro: ${etiqueta}`}
    >
      {etiqueta}
      <span aria-hidden="true">×</span>
      <span className={styles.oculto}>Quitar este filtro</span>
    </Link>
  )
}

function ChipsActivos({
  f,
  cuentas,
  categorias,
  dimensiones,
}: {
  f: Filtros
  cuentas: readonly AccountBalance[]
  categorias: readonly CategoryNode[]
  dimensiones: readonly DimensionSummary[]
}) {
  if (!hayFiltros(f)) return null

  const nombreCuenta = new Map(cuentas.map((c) => [c.id, c.name]))
  const nombreCategoria = new Map(categorias.map((c) => [c.id, c.path]))
  const nombreValor = new Map(
    dimensiones.flatMap((d) => d.values.map((v) => [v.id, `${d.label}: ${v.label}`] as const)),
  )

  // Un id que ya no existe se etiqueta con su prefijo en vez de con un hueco:
  // el chip tiene que poder quitarse aunque el valor se haya borrado.
  const rotulo = (id: string, nombre: string | undefined, prefijo: string) =>
    nombre ?? `${prefijo} ${id.slice(0, 8)}…`

  return (
    // `nav` y no `div`: cada chip es un enlace a otra vista de la misma
    // pantalla, y con su rótulo un lector de pantalla puede saltar al bloque
    // de filtros puestos en vez de recorrer la tabla entera para entenderlos.
    <nav className="chips" aria-label="Filtros activos">
      {f.desde !== null && (
        <ChipQuitar
          etiqueta={`Desde ${formatDate(f.desde, 'long')}`}
          destino={con(f, { desde: null })}
        />
      )}
      {f.hasta !== null && (
        <ChipQuitar
          etiqueta={`Hasta ${formatDate(f.hasta, 'long')}`}
          destino={con(f, { hasta: null })}
        />
      )}
      {f.cuentas.map((id) => (
        <ChipQuitar
          key={id}
          etiqueta={rotulo(id, nombreCuenta.get(id), 'Cuenta')}
          destino={menos(f, 'cuentas', id)}
        />
      ))}
      {f.categorias.map((id) => (
        <ChipQuitar
          key={id}
          etiqueta={rotulo(id, nombreCategoria.get(id), 'Categoría')}
          destino={menos(f, 'categorias', id)}
        />
      ))}
      {f.dimensiones.map((id) => (
        <ChipQuitar
          key={id}
          etiqueta={rotulo(id, nombreValor.get(id), 'Dimensión')}
          destino={menos(f, 'dimensiones', id)}
        />
      ))}
      {f.texto !== null && (
        <ChipQuitar etiqueta={`«${f.texto}»`} destino={con(f, { texto: null })} />
      )}
      {f.traspasos && (
        <ChipQuitar etiqueta="Con traspasos" destino={con(f, { traspasos: false })} />
      )}
    </nav>
  )
}

/* ── Formulario ──────────────────────────────────────────────────────────── */

/**
 * Un `form` con `method="get"` y controles nativos: los filtros terminan en la
 * query string porque el navegador los pone ahí, sin una línea de JavaScript.
 * Va plegado porque la tabla es lo que se viene a ver, y los filtros puestos
 * ya se leen arriba en los chips.
 */
function Formulario({
  f,
  cuentas,
  categorias,
  dimensiones,
}: {
  f: Filtros
  cuentas: readonly AccountBalance[]
  categorias: readonly CategoryNode[]
  dimensiones: readonly DimensionSummary[]
}) {
  const operativas = cuentas
    .filter((c) => c.kind === 'asset' || c.kind === 'liability')
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
  const gastos = categorias.filter((c) => c.kind === 'expense')
  const ingresos = categorias.filter((c) => c.kind === 'income')

  return (
    <details className="panel" open={hayFiltros(f)}>
      <summary className={`panel-head ${styles.sumario}`}>
        <h2>Filtrar</h2>
        <small>Período, cuenta, categoría, dimensión y texto</small>
      </summary>

      <form method="get" action="/movimientos" className={`panel-body ${styles.formulario}`}>
        <label className={styles.campo}>
          <span className="label">Desde</span>
          <input type="date" name="desde" defaultValue={f.desde ?? ''} />
        </label>

        <label className={styles.campo}>
          <span className="label">Hasta</span>
          <input type="date" name="hasta" defaultValue={f.hasta ?? ''} />
        </label>

        <label className={styles.campo}>
          <span className="label">Texto en la descripción</span>
          <input
            type="search"
            name="q"
            defaultValue={f.texto ?? ''}
            placeholder="iberdrola, alquiler, notaría…"
          />
        </label>

        <label className={styles.campo}>
          <span className="label">Cuentas</span>
          <select name="cuenta" multiple size={7} defaultValue={[...f.cuentas]}>
            {operativas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.currency}
                {c.closedAt !== null ? ' (cerrada)' : ''}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.campo}>
          <span className="label">Categorías</span>
          <select name="categoria" multiple size={7} defaultValue={[...f.categorias]}>
            <optgroup label="Gasto">
              {gastos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.path}
                  {c.detached ? ' (fuera del árbol)' : ''}
                </option>
              ))}
            </optgroup>
            <optgroup label="Ingreso">
              {ingresos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.path}
                  {c.detached ? ' (fuera del árbol)' : ''}
                </option>
              ))}
            </optgroup>
          </select>
        </label>

        <label className={styles.campo}>
          <span className="label">Dimensiones</span>
          <select name="dimension" multiple size={7} defaultValue={[...f.dimensiones]}>
            {dimensiones.map((d) => (
              <optgroup key={d.id} label={d.label}>
                {d.values.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                    {v.archivedAt !== null ? ' (archivado)' : ''}
                    {v.usage === 0 ? ' · sin uso' : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <div className={styles.acciones}>
          <label className="row">
            <input type="checkbox" name="transferencias" value="1" defaultChecked={f.traspasos} />
            <span className="small">Incluir las patas de traspaso</span>
          </label>
          <div className="row">
            <Link className="btn" href={ruta(SIN_FILTROS)}>
              Limpiar
            </Link>
            <button type="submit" className="primary">
              Aplicar filtros
            </button>
          </div>
        </div>
      </form>
    </details>
  )
}
