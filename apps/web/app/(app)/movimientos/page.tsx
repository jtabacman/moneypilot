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
import { clasificar } from './actions'
import {
  aCadena,
  esSinCategorizar,
  leerResultado,
  MENSAJE_AVISO,
  puedeClasificar,
  type Resultado,
  valorOpcion,
} from './clasificacion'
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
  const entrada = await searchParams
  const { filtros: f, recortados } = parseEntrada(entrada)
  const filtro = aFiltroDb(f)
  const offset = (f.pagina - 1) * PAGE_SIZE
  const parte = leerResultado(entrada)

  const { session, data } = await readHousehold(async (client, sesion) => {
    // En serie: todas van por el mismo cliente —una transacción, una
    // conexión—, así que pg las encola igual. Promise.all daba paralelismo
    // aparente y un aviso de query concurrente sobre un cliente ocupado, que
    // en pg@9 será un error. Es además lo que ya hacen las lecturas de abajo.
    const pagina = await movements(client, { ...filtro, limit: PAGE_SIZE, offset })
    const cuentas = await accountBalances(client)
    const categorias = await categoryTree(client)
    const dimensiones = await dimensionsWithValues(client)
    // Cuántas patas de traspaso deja fuera el filtro. Sin este número la
    // lista escondería filas sin decirlo, que es justo lo que no hacemos.
    const conTraspasos = f.traspasos
      ? null
      : await movements(client, { ...filtro, includeTransfers: true, limit: 1 })

    // Las bolsas del importador, y cuánto queda dentro de ellas CON los filtros
    // puestos. Se cuenta con el mismo filtro que lleva el enlace del aviso
    // porque si no, el número y la lista a la que se llega serían dos cosas
    // distintas — y el aviso estaría mintiendo sobre su propio enlace.
    const bolsas = categorias.filter((c) => esSinCategorizar(c.name)).map((c) => c.id)
    const sinCategorizar =
      bolsas.length === 0
        ? 0
        : (await movements(client, { ...filtro, categoryIds: bolsas, limit: 1 })).total

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

    return {
      pagina,
      cuentas,
      categorias,
      dimensiones,
      conTraspasos,
      resumen,
      bolsas,
      sinCategorizar,
    }
  })

  const { pagina, cuentas, categorias, dimensiones, conTraspasos, resumen } = data
  const { bolsas, sinCategorizar } = data
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

  const enBolsa = new Set(bolsas)
  // Un asiento sin pata de gasto ni de ingreso no tiene categoría que cambiar,
  // así que no se ofrece marcarlo. Las dos patas de un traspaso salen dos veces
  // en la lista con el mismo asiento detrás, y por eso el `Set`: mandarlo dos
  // veces contaría el mismo movimiento dos veces en el parte.
  const clasificables = [
    ...new Set(pagina.rows.filter((row) => row.categoryId !== null).map((row) => row.entryId)),
  ]
  const volver = aCadena(f)

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
        {parte !== null && <Parte r={parte} categorias={categorias} dimensiones={dimensiones} />}

        <SinCategorizar cuantos={sinCategorizar} bolsas={bolsas} f={f} />

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
            /*
             * Un `form` de toda la vida con casillas y un botón al pie: no hace
             * falta ni una línea de JavaScript para marcar cuarenta movimientos
             * y mandarlos a una categoría, igual que el resto de la pantalla.
             * Lo que se envía es la lista de asientos marcados; el importe, la
             * fecha y la cuenta no viajan porque no se tocan nunca.
             */
            <form action={clasificar}>
              {/* De dónde vino, para volver al mismo sitio después de escribir.
                  La acción no confía en esto: lo vuelve a pasar por el parseador
                  de filtros, así que de acá no sale un destino inventado. */}
              <input type="hidden" name="volver" value={volver} />

              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col" className={styles.marcar}>
                        <span className={styles.oculto}>Marcar</span>
                      </th>
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
                      <Fila
                        key={row.postingId}
                        row={row}
                        f={f}
                        moneda={moneda}
                        sinCategorizar={row.categoryId !== null && enBolsa.has(row.categoryId)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <BarraClasificar
                categorias={categorias}
                dimensiones={dimensiones}
                clasificables={clasificables}
                rol={session.role}
              />
            </form>
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
              <li>
                Para clasificar, marcá las casillas de la izquierda y elegí abajo a dónde van. Las
                filas sin casilla no tienen categoría que cambiar —una pata de traspaso, un saldo de
                apertura— y las que reparten entre varias categorías se dejan como están: al aplicar
                se cuentan aparte, con el motivo.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </>
  )
}

/* ── Fila ────────────────────────────────────────────────────────────────── */

function Fila({
  row,
  f,
  moneda,
  sinCategorizar,
}: {
  row: MovementRow
  f: Filtros
  moneda: string
  /** Su contrapartida es una de las bolsas del importador. */
  sinCategorizar: boolean
}) {
  const enBase = enMoneda(row, moneda)

  return (
    <tr className={row.isTransfer ? styles.traspaso : undefined}>
      <td className={styles.marcar}>
        {row.categoryId === null ? (
          // No se ofrece marcar lo que no se puede clasificar, pero se dice por
          // qué: una casilla que se puede marcar y nunca hace nada es peor que
          // no tenerla.
          <span
            className="faint"
            title={
              row.isTransfer
                ? 'Las dos patas de un traspaso van contra cuentas tuyas: no hay categoría que cambiar'
                : 'Este asiento no tiene pata de gasto ni de ingreso: es un saldo de apertura o un ajuste de cambio'
            }
          >
            —
          </span>
        ) : (
          <input
            type="checkbox"
            name="mov"
            value={row.entryId}
            aria-label={`Marcar ${row.description} del ${formatDate(row.bookedOn, 'long')}`}
          />
        )}
      </td>

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
        {sinCategorizar && (
          /*
           * El atajo que hace que esto escale. Clasificar de a uno no termina
           * nunca: veinte reglas suelen cubrir el ochenta por ciento de un alta.
           *
           * Viaja el descriptor **crudo** y no una versión normalizada, aunque
           * traiga la referencia del banco. La regla se compara con ILIKE contra
           * el texto tal como lo escribió el banco, así que un descriptor sin
           * tildes ni puntuación puede no encontrar ni el movimiento del que
           * salió. Se manda lo que sí coincide y la pantalla de la regla enseña
           * a cuántos afecta mientras se recorta.
           */
          <Link
            className={`small ${styles.regla}`}
            href={{
              pathname: '/reglas/nueva',
              query: { texto: row.description.slice(0, 200) },
            }}
            title="Abre la regla nueva con este texto puesto, para clasificar de una vez todo lo que se le parezca"
          >
            crear regla con este texto
          </Link>
        )}
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

/* ── Clasificar ──────────────────────────────────────────────────────────── */

/** «12 movimientos», «1 movimiento». */
function cuenta(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`
}

function etiquetaValor(dimensiones: readonly DimensionSummary[], valueId: string): string | null {
  for (const dimension of dimensiones) {
    const valor = dimension.values.find((v) => v.id === valueId)
    if (valor !== undefined) return `${dimension.label}: ${valor.label}`
  }
  return null
}

/**
 * El aviso de lo que falta por clasificar.
 *
 * Es la pregunta que vende el producto vista del revés: mientras un movimiento
 * esté en la bolsa del importador no cuenta en el gasto por categoría ni en lo
 * que cuesta cada propiedad, así que este número es exactamente el tamaño del
 * agujero que tienen los tableros.
 */
function SinCategorizar({
  cuantos,
  bolsas,
  f,
}: {
  cuantos: number
  bolsas: readonly string[]
  f: Filtros
}) {
  if (cuantos === 0 || bolsas.length === 0) return null

  const yaFiltrado =
    f.categorias.length === bolsas.length && bolsas.every((id) => f.categorias.includes(id))

  return (
    <div className="banner">
      <b>
        {cuenta(cuantos, 'movimiento sigue', 'movimientos siguen')} sin categorizar
        {hayFiltros(f) && !yaFiltrado ? ' dentro de este filtro' : ''}.
      </b>{' '}
      Lo que el importador no supo clasificar cae en una bolsa, y desde ahí no suma ni en el gasto
      por categoría ni en lo que cuesta cada propiedad.{' '}
      {yaFiltrado ? (
        'Son los de esta lista: marcalos abajo y mandalos a una categoría, o creá una regla con el enlace que lleva cada uno.'
      ) : (
        <>
          <Link href={ruta(con(f, { categorias: [...bolsas] }))}>Ver sólo esos</Link>.
        </>
      )}
    </div>
  )
}

/**
 * El parte de la última pasada, leído de la URL.
 *
 * Dice los tres números que hacen falta para saber qué pasó: cuántos cambiaron,
 * cuántos ya estaban donde los mandabas y cuántos quedaron fuera **con el
 * motivo**. Un "hecho" a secas después de marcar cuarenta movimientos obliga a
 * ir a contarlos a mano, y el que no se enteró de que dos eran traspasos cree
 * que la pantalla se comió su cambio.
 */
function Parte({
  r,
  categorias,
  dimensiones,
}: {
  r: Resultado
  categorias: readonly CategoryNode[]
  dimensiones: readonly DimensionSummary[]
}) {
  if (r.aviso !== null) {
    return (
      <div className="error">
        <b>No se cambió nada.</b> {MENSAJE_AVISO[r.aviso]}
        {r.aviso === 'rol' && (
          <>
            {' '}
            El contador y el asistente proponen y el titular aprueba; ese circuito de propuestas
            todavía está en construcción, así que por ahora el cambio lo tiene que hacer quien sea
            titular o pareja
            {r.detalle === null ? '' : `, y tu rol acá es «${r.detalle}»`}.
          </>
        )}
        {r.aviso === 'base' && r.detalle !== null && <> La base dijo: «{r.detalle}».</>}
      </div>
    )
  }

  const destino = r.categoryId === null ? null : categorias.find((c) => c.id === r.categoryId)
  const donde = destino === undefined || destino === null ? 'esa categoría' : `«${destino.path}»`
  const puestos = r.valores
    .map((id) => etiquetaValor(dimensiones, id))
    .filter((etiqueta): etiqueta is string => etiqueta !== null)
  const quitadas = r.quitadas
    .map((id) => dimensiones.find((d) => d.id === id)?.label)
    .filter((etiqueta): etiqueta is string => etiqueta !== undefined)

  const titular =
    r.categoryId !== null
      ? `De ${cuenta(r.pedidos, 'movimiento marcado', 'movimientos marcados')}, ${
          r.cambiados === 0
            ? 'ninguno cambió de categoría'
            : `${cuenta(r.cambiados, 'cambió', 'cambiaron')} a ${donde}`
        }.`
      : `De ${cuenta(r.pedidos, 'movimiento marcado', 'movimientos marcados')}, ${
          r.conDimensiones === 0
            ? 'ninguno cambió de atribución'
            : `${cuenta(r.conDimensiones, 'cambió', 'cambiaron')} de atribución`
        }.`

  const frases: string[] = []
  if (r.yaEstaban > 0) {
    frases.push(
      `${cuenta(r.yaEstaban, 'ya estaba', 'ya estaban')} en ${donde} y no se ` +
        `${r.yaEstaban === 1 ? 'tocó' : 'tocaron'}: por eso ${r.yaEstaban === 1 ? 'no figura' : 'no figuran'} ` +
        'en el registro de cambios.',
    )
  }
  // La atribución se cuenta aunque el valor no se pueda nombrar —lo pudieron
  // archivar o borrar entre aplicar y volver—: perder el nombre no puede hacer
  // desaparecer el número de movimientos que cambiaron.
  if (r.conDimensiones > 0 && r.categoryId !== null) {
    frases.push(
      `La atribución se reescribió en ${cuenta(r.conDimensiones, 'movimiento', 'movimientos')}` +
        `${puestos.length === 0 ? '' : `: ${puestos.join(', ')}, al 100%`}.`,
    )
  } else if (r.conDimensiones > 0 && puestos.length > 0) {
    frases.push(`${puestos.length === 1 ? 'Quedó' : 'Quedaron'} en ${puestos.join(', ')}, al 100%.`)
  }
  if (quitadas.length > 0 && r.conDimensiones > 0) {
    frases.push(`Se les quitó la atribución de ${quitadas.join(', ')}.`)
  }
  if (r.repartos > 0) {
    frases.push(
      `${cuenta(r.repartos, 'reparte', 'reparten')} entre varias categorías y ${
        r.repartos === 1 ? 'quedó' : 'quedaron'
      } como ${r.repartos === 1 ? 'estaba' : 'estaban'}: aplastar un ticket repartido a una sola ` +
        'categoría destruiría el reparto sin avisar.',
    )
  }
  if (r.sinContrapartida > 0) {
    frases.push(
      `${cuenta(r.sinContrapartida, 'no tiene', 'no tienen')} pata de gasto ni de ingreso —una ` +
        'pata de traspaso interno, un saldo de apertura, un ajuste de cambio—, así que no hay ' +
        'categoría que cambiar.',
    )
  }
  if (r.inexistentes > 0) {
    frases.push(`${cuenta(r.inexistentes, 'ya no existe', 'ya no existen')} en este hogar.`)
  }

  return (
    <div className="notice">
      <b>{titular}</b>
      {frases.length > 0 && ` ${frases.join(' ')}`}
    </div>
  )
}

/**
 * La barra que aplica lo marcado.
 *
 * Va siempre visible y no aparece con la selección: sin JavaScript no hay forma
 * de saber cuántas casillas están marcadas mientras el usuario las marca, y una
 * barra que se revelara con CSS quedaría invisible para siempre en un navegador
 * sin `:has()`. Lo que sí hace `:has()` es destacarla cuando hay algo marcado —
 * mejora si está, y si no está no rompe nada.
 */
function BarraClasificar({
  categorias,
  dimensiones,
  clasificables,
  rol,
}: {
  categorias: readonly CategoryNode[]
  dimensiones: readonly DimensionSummary[]
  clasificables: readonly string[]
  rol: string
}) {
  const gastos = categorias.filter((c) => c.kind === 'expense')
  const ingresos = categorias.filter((c) => c.kind === 'income')
  // Un valor archivado no se ofrece para etiquetar —esa es toda la diferencia
  // entre archivar y borrar— pero sí se puede quitar de lo que ya lo tenía.
  const conValores = dimensiones.filter((d) => d.values.some((v) => v.archivedAt === null))
  const puede = puedeClasificar(rol)

  return (
    <div className={`panel-foot ${styles.barra}`}>
      <div className={styles.campos}>
        <label className={styles.campo}>
          <span className="label">Mandar a la categoría</span>
          <select name="categoria" defaultValue="">
            <option value="">— dejar la categoría como está —</option>
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

        {conValores.length > 0 && (
          <label className={styles.campo}>
            <span className="label">Atribuir a</span>
            <select name="valor" multiple size={6}>
              {conValores.map((d) => (
                <optgroup key={d.id} label={d.label}>
                  <option value={valorOpcion(d.id, null)}>— quitar {d.label} —</option>
                  {d.values
                    .filter((v) => v.archivedAt === null)
                    .map((v) => (
                      <option key={v.id} value={valorOpcion(d.id, v.id)}>
                        {v.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className={styles.aplicar}>
        {clasificables.length === 0 ? (
          <span className="small faint">
            En esta página no hay nada que clasificar: son patas de traspaso o asientos sin
            contrapartida de gasto ni de ingreso.
          </span>
        ) : (
          <label className="row">
            <input type="checkbox" name="todos" value="1" />
            <span className="small">
              {clasificables.length === 1
                ? 'Aplicar al único de esta página que se puede clasificar, sin marcarlo'
                : `Aplicar a los ${clasificables.length} de esta página que se pueden clasificar, sin marcarlos uno a uno`}
            </span>
          </label>
        )}
        {/* Los ids van en el formulario y no se vuelven a consultar al aplicar:
            lo que se clasifica tiene que ser exactamente lo que el usuario vio,
            no lo que la consulta devuelva medio minuto después. */}
        {clasificables.map((id) => (
          <input key={id} type="hidden" name="mov_pagina" value={id} />
        ))}
        <button type="submit" className="primary">
          Aplicar
        </button>
      </div>

      <p className="small faint">
        Sólo cambia la contrapartida del asiento: el importe, la fecha y la cuenta no se tocan
        nunca, y cada cambio queda con tu nombre en el registro de clasificación. Elegir un valor
        reemplaza la atribución de esa dimensión y deja las demás como estaban; entra al 100%,
        porque un reparto 60/40 exige decir los pesos y eso todavía no se pide desde acá.
      </p>

      {!puede && (
        <div className="notice">
          <b>Tu rol («{rol}») propone cambios, no los escribe.</b> El titular y la pareja
          clasifican; el contador y el asistente proponen y el titular aprueba. El circuito de
          propuestas todavía está en construcción, así que este botón te va a contestar que no se
          escribió nada. No lo escondemos: cuando exista, es el mismo botón el que va a crear la
          propuesta.
        </div>
      )}
    </div>
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
