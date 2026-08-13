import {
  accountBalances,
  type CategoryNode,
  categoryTree,
  type ImportBatchRow,
  listImportBatches,
  movements,
  type ReconciliationRow,
  type ReconciliationStatus,
  type ReviewRow,
  reconciliation,
  reviewQueue,
  spendByCategoryMonth,
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
import { capitalize, formatDate, formatMonth } from '@/lib/format'
import { navItem } from '@/lib/nav'
import { NoData } from '../empty-state'
import { Coverage, Delta, Empty, Illustrative, Money, PageBar, ReconStatus } from '../ui'
import styles from './page.module.css'

export const dynamic = 'force-dynamic'

/* ── Mes del cierre ──────────────────────────────────────────────────── */

const MES_VALIDO = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * Por defecto se abre el **mes anterior**, no el corriente.
 *
 * Un cierre es de un mes cerrado: el reporte del mes en curso está incompleto
 * por definición y el contador no lo puede usar. Abrir agosto el 13 de agosto
 * enseñaría medio mes con cara de cierre, que es exactamente el documento que
 * este producto no quiere emitir.
 */
function mesElegido(param: string | string[] | undefined, hoy: string): string {
  const valor = Array.isArray(param) ? param[0] : param
  if (valor !== undefined && MES_VALIDO.test(valor)) return valor
  return addMonths(monthOf(hoy), -1)
}

/* ── Enlaces de drill-down ───────────────────────────────────────────── */

/**
 * Todo número de esta pantalla se abre en /movimientos con sus filtros. El
 * tipo es una plantilla y no `string` porque las rutas de Next están tipadas:
 * devolver `string` haría que cualquier destino inventado compilara igual.
 */
type HrefMovimientos = `/movimientos?${string}`

/** Un filtro puede llevar varios ids (`?categoria=a&categoria=b`) o uno solo. */
type FiltrosMovimientos = Readonly<Record<string, string | readonly string[]>>

function aMovimientos(filtros: FiltrosMovimientos): HrefMovimientos {
  const params = new URLSearchParams()
  for (const [clave, valor] of Object.entries(filtros)) {
    if (typeof valor === 'string') params.set(clave, valor)
    else for (const uno of valor) params.append(clave, uno)
  }
  return `/movimientos?${params.toString()}`
}

/**
 * Para cada categoría, su rama entera: ella y todo lo que cuelga debajo.
 *
 * La tabla agrupa por el primer nivel ('Casa'), pero los movimientos cuelgan de
 * las hojas ('Casa > Hipoteca') y el filtro de /movimientos compara el id
 * EXACTO de la contrapartida: no expande descendientes. Enlazar sólo la raíz
 * abre el registro vacío — una fila de 12.720 € que al abrirla dice «ningún
 * movimiento» es justo el fallo que este producto existe para no cometer.
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

/* ── Estado de una cuenta en la reconciliación ───────────────────────── */

/**
 * `ReconStatus` de ui.tsx cubre tres estados y el repositorio devuelve cuatro:
 * falta 'incompleto', que es el de una cuenta con movimientos en otra moneda.
 * Se pinta acá como aviso —ni cuadra ni descuadra: no se pudo comprobar— en
 * vez de plegarlo dentro de otro estado, que sería decir algo que no sabemos.
 */
function Estado({ row }: { row: ReconciliationRow }) {
  if (row.status === 'incompleto') return <span className="status warn">incompleto</span>
  return <ReconStatus status={row.status} />
}

/** Los problemas arriba. Un cierre se lee para encontrar lo que falla. */
const ORDEN_ESTADO: Readonly<Record<ReconciliationStatus, number>> = {
  delta: 0,
  incompleto: 1,
  'sin-declarar': 2,
  cuadra: 3,
}

/* ── Excepciones ─────────────────────────────────────────────────────── */

const TIPO_REVISION: Readonly<Record<string, string>> = {
  posible_duplicado: 'posible duplicado',
  transferencia_sugerida: 'transferencia sugerida',
  sin_categorizar: 'sin categorizar',
}

function etiquetaRevision(kind: string): string {
  return TIPO_REVISION[kind] ?? kind.replace(/_/g, ' ')
}

function enPeriodo(row: ReviewRow, from: string, to: string): boolean {
  return row.bookedOn !== null && row.bookedOn >= from && row.bookedOn <= to
}

/**
 * Topes de lectura. Existen porque la consulta los necesita, no porque el
 * cierre quiera enseñar sólo una parte: cuando se tocan, la pantalla lo dice.
 * Un «4 pendientes» que en realidad son 400 es un cierre firmado en falso.
 */
const TOPE_COLA = 200
const TOPE_LOTES = 12

/**
 * Las cuentas donde cae lo que el importador no supo clasificar. Los nombres
 * son los del importador (`SUSPENSE_OUTFLOW_NAME` / `SUSPENSE_INFLOW_NAME`),
 * con el sufijo de moneda que les pone al crearlas: 'Sin categorizar (USD)'.
 */
function esBolsa(nodo: CategoryNode): boolean {
  return nodo.name.startsWith('Sin categorizar') || nodo.name.startsWith('Ingresos sin categorizar')
}

/* ── Anexo ───────────────────────────────────────────────────────────── */

function fechaDeLote(batch: ImportBatchRow): string {
  const dia = batch.createdAt.slice(0, 10)
  return `${formatDate(dia)} ${dia.slice(0, 4)}`
}

/* ── Página ──────────────────────────────────────────────────────────── */

export default async function Cierre({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // El título y el blurb salen del menú para que no haya dos versiones del
  // mismo texto. `navItem` puede no encontrar la ruta —sería un error de
  // programación— y con exactOptionalPropertyTypes el blurb ausente hay que
  // omitirlo, no pasarlo como undefined.
  const item = navItem('/cierre')
  const titulo = item?.label ?? 'Cierre'
  const subtitulo = item === undefined ? {} : { blurb: item.blurb }
  const hoy = today()
  const mes = mesElegido((await searchParams).mes, hoy)
  const anterior = addMonths(mes, -1)
  const from = firstDayOfMonth(mes)
  const to = lastDayOfMonth(mes)
  const anio = mes.slice(0, 4)
  const inicioAnio = `${anio}-01-01`
  // El desglose por categoría necesita el mes anterior y todo el año a la vez.
  // En enero el mes anterior cae en el año pasado, así que el rango arranca en
  // el más viejo de los dos y el acumulado se filtra después por año.
  const desdeGasto = firstDayOfMonth(anterior) < inicioAnio ? firstDayOfMonth(anterior) : inicioAnio

  const { session, data } = await readHousehold(async (client, sesion) => {
    const moneda = sesion.baseCurrency
    const [hay, recon, cuentas, mesActual, mesAnterior, acumulado, gasto, categorias, lotes, cola] =
      await Promise.all([
        movements(client, { limit: 1 }),
        reconciliation(client, { from, to }),
        accountBalances(client),
        totals(client, { from, to, currency: moneda }),
        totals(client, {
          from: firstDayOfMonth(anterior),
          to: lastDayOfMonth(anterior),
          currency: moneda,
        }),
        totals(client, { from: inicioAnio, to, currency: moneda }),
        spendByCategoryMonth(client, { from: desdeGasto, to, currency: moneda, depth: 1 }),
        categoryTree(client),
        listImportBatches(client, TOPE_LOTES),
        reviewQueue(client, { state: 'pendiente', limit: TOPE_COLA }),
      ])

    // Las bolsas de sin categorizar son cuentas como cualquier otra: hay que
    // resolverlas antes de poder pedir sus movimientos. Son dos y no una — el
    // importador manda los cobros que no supo clasificar a una cuenta de
    // ingreso — y contar sólo la de gasto diría que no hay nada pendiente
    // justo cuando lo que falta por clasificar es un cobro.
    const bolsas = categorias.filter((c) => esBolsa(c)).map((c) => c.id)
    const bolsasGasto = categorias
      .filter((c) => c.kind === 'expense' && esBolsa(c))
      .map((c) => c.id)
    const sinCategorizar =
      bolsas.length === 0
        ? { rows: [], total: 0 }
        : await movements(client, { from, to, categoryIds: bolsas, limit: 1 })

    return {
      moneda,
      vacio: hay.total === 0,
      recon,
      cuentas,
      mesActual,
      mesAnterior,
      acumulado,
      gasto,
      categorias,
      bolsas,
      bolsasGasto,
      sinCategorizar,
      lotes,
      cola,
    }
  })

  const meses = [...lastMonths(hoy, 18)].reverse()
  const opciones = meses.includes(mes) ? meses : [mes, ...meses]
  const posibleAnterior = addMonths(mes, -1)
  const posibleSiguiente = addMonths(mes, 1)
  const haySiguiente = posibleSiguiente <= monthOf(hoy)

  const herramientas = (
    <>
      {/* El nombre accesible no puede ser «←»: va en aria-label, no en title. */}
      <Link
        className="ghost"
        href={`/cierre?mes=${posibleAnterior}`}
        title="Mes anterior"
        aria-label={`Ver el cierre de ${formatMonth(posibleAnterior)}`}
      >
        ←
      </Link>
      <form method="get" className="row" style={{ gap: 'var(--s2)' }}>
        <label className="label" htmlFor="mes">
          Mes
        </label>
        <select id="mes" name="mes" defaultValue={mes}>
          {opciones.map((valor) => (
            <option key={valor} value={valor}>
              {capitalize(formatMonth(valor))}
            </option>
          ))}
        </select>
        <button type="submit" className="quiet">
          Ver
        </button>
      </form>
      {haySiguiente && (
        <Link
          className="ghost"
          href={`/cierre?mes=${posibleSiguiente}`}
          title="Mes siguiente"
          aria-label={`Ver el cierre de ${formatMonth(posibleSiguiente)}`}
        >
          →
        </Link>
      )}
      {/*
        El `title` va en el envoltorio además de en el botón: un botón
        deshabilitado tiene `pointer-events: none` en el sistema de diseño, así
        que su propio tooltip no llega a aparecer nunca.
      */}
      <span title="Va a producir el paquete del contador: PDF con estos cinco bloques, XLSX con fórmulas y tablas reales, CSV crudo y ZIP de adjuntos. Todavía no está construido.">
        <button
          type="button"
          className="primary"
          disabled
          title="Va a producir el paquete del contador: PDF con estos cinco bloques, XLSX con fórmulas y tablas reales, CSV crudo y ZIP de adjuntos. Todavía no está construido."
        >
          Generar cierre
        </button>
      </span>
    </>
  )

  if (data.vacio) {
    return (
      <>
        <PageBar title={titulo} {...subtitulo} tools={herramientas} />
        <div className="page">
          <NoData what="el cierre del mes" />
        </div>
      </>
    )
  }

  /* ── Semáforo de completitud ───────────────────────────────────────── */

  const filas = [...data.recon].sort(
    (a, b) =>
      ORDEN_ESTADO[a.status] - ORDEN_ESTADO[b.status] || a.accountName.localeCompare(b.accountName),
  )
  const cuadran = filas.filter((r) => r.status === 'cuadra').length
  const conDelta = filas.filter((r) => r.status === 'delta').length
  const incompletas = filas.filter((r) => r.status === 'incompleto').length
  const sinDeclarar = filas.filter((r) => r.status === 'sin-declarar').length
  const ultimoExtracto = new Map(data.cuentas.map((c) => [c.id, c.declaredOn]))

  const cerrado = conDelta === 0 && incompletas === 0 && sinDeclarar === 0 && filas.length > 0

  /* ── Estado de resultados ──────────────────────────────────────────── */

  interface FilaCategoria {
    readonly id: string
    readonly nombre: string
    mes: bigint
    anterior: bigint
    anio: bigint
    sinConvertirMes: number
    /** Lo que queda fuera de las OTRAS dos columnas: comparativo y acumulado. */
    sinConvertirComparativo: number
  }

  const porCategoria = new Map<string, FilaCategoria>()
  for (const row of data.gasto) {
    const fila = porCategoria.get(row.categoryId) ?? {
      id: row.categoryId,
      nombre: row.category,
      mes: 0n,
      anterior: 0n,
      anio: 0n,
      sinConvertirMes: 0,
      sinConvertirComparativo: 0,
    }
    const enElMes = row.month === mes
    if (enElMes) {
      fila.mes += row.amount
      fila.sinConvertirMes += row.unconverted
    }
    if (row.month === anterior) fila.anterior += row.amount
    if (row.month.slice(0, 4) === anio) fila.anio += row.amount
    // El acumulado y el comparativo son columnas propias: si les faltan
    // apuntes hay que decirlo aunque el mes esté completo.
    if (!enElMes && (row.month === anterior || row.month.slice(0, 4) === anio)) {
      fila.sinConvertirComparativo += row.unconverted
    }
    porCategoria.set(row.categoryId, fila)
  }
  const ramas = ramasDeCategoria(data.categorias)
  /** La rama de una raíz, o la raíz sola si el árbol no la conoce. */
  const rama = (id: string): string[] => ramas.get(id) ?? [id]
  const categoriasOrdenadas = [...porCategoria.values()].sort((a, b) =>
    a.mes === b.mes ? (a.anio > b.anio ? -1 : 1) : a.mes > b.mes ? -1 : 1,
  )
  const totalGasto = categoriasOrdenadas.reduce(
    (acc, fila) => ({
      mes: acc.mes + fila.mes,
      anterior: acc.anterior + fila.anterior,
      anio: acc.anio + fila.anio,
    }),
    { mes: 0n, anterior: 0n, anio: 0n },
  )
  /**
   * La comparación contra el mes anterior es tan buena como el mes anterior.
   * Si a ese mes le faltaron apuntes por convertir, el porcentaje está medido
   * contra una base incompleta y hay que decirlo donde está el porcentaje.
   */
  const baseIncompleta =
    data.mesAnterior.unconverted === 0 ? null : (
      <p className="sub">
        <Coverage unconverted={data.mesAnterior.unconverted} currency={data.moneda} />
      </p>
    )
  /**
   * Los ids que hacen falta para abrir el total: todas las ramas, no las
   * raíces. Ver `ramasDeCategoria` — el filtro de /movimientos no expande
   * descendientes y una raíz sola abriría el registro vacío.
   */
  const ramasDelTotal = [...new Set(categoriasOrdenadas.flatMap((fila) => rama(fila.id)))]

  /* ── Excepciones ───────────────────────────────────────────────────── */

  const colaPeriodo = data.cola.filter((r) => enPeriodo(r, from, to))
  // Sin fecha no es «fuera del período»: es que no sabemos de qué mes es, y
  // por eso no entra ni se descarta de este cierre. Se cuenta aparte.
  const colaSinFecha = data.cola.filter((r) => r.bookedOn === null).length
  const colaFuera = data.cola.length - colaPeriodo.length - colaSinFecha
  const colaRecortada = data.cola.length >= TOPE_COLA
  const duplicados = colaPeriodo.filter((r) => r.kind === 'posible_duplicado').length
  const transferencias = colaPeriodo.filter((r) => r.kind === 'transferencia_sugerida').length
  const ultimoLote = data.lotes[0]
  const gastoSinCategorizar = categoriasOrdenadas
    .filter((fila) => data.bolsasGasto.includes(fila.id))
    .reduce((sum, fila) => sum + fila.mes, 0n)
  // El recuento incluye los cobros sin clasificar; el importe, no: sumar un
  // ingreso dentro de una cifra de gasto lo restaría del gasto real del mes.
  const bolsasDeIngreso = data.bolsas.length - data.bolsasGasto.length

  interface Excepcion {
    readonly clave: string
    readonly concepto: string
    readonly nota?: string
    readonly cuantos: number
    readonly importe: bigint | null
    readonly moneda: string
    readonly donde: HrefMovimientos | '/revisar' | '/importar'
    readonly dondeTexto: string
  }

  const excepciones: Excepcion[] = [
    {
      clave: 'sin-categorizar',
      concepto: 'Movimientos sin categorizar',
      ...(bolsasDeIngreso > 0 ? { nota: 'el importe es sólo la parte de gasto' } : {}),
      cuantos: data.sinCategorizar.total,
      importe: gastoSinCategorizar,
      moneda: data.moneda,
      donde:
        data.bolsas.length === 0
          ? aMovimientos({ desde: from, hasta: to })
          : aMovimientos({ categoria: data.bolsas, desde: from, hasta: to }),
      dondeTexto: 'Ver movimientos',
    },
    {
      clave: 'revision',
      concepto: 'Pendientes de tu criterio',
      cuantos: colaPeriodo.length,
      importe: null,
      moneda: data.moneda,
      donde: '/revisar',
      dondeTexto: 'Ir a revisar',
    },
    {
      clave: 'transferencias',
      concepto: 'Transferencias detectadas sin confirmar',
      cuantos: transferencias,
      importe: null,
      moneda: data.moneda,
      donde: '/revisar',
      dondeTexto: 'Ir a revisar',
    },
    {
      clave: 'duplicados-cola',
      concepto: 'Posibles duplicados sin decidir',
      cuantos: duplicados,
      importe: null,
      moneda: data.moneda,
      donde: '/revisar',
      dondeTexto: 'Ir a revisar',
    },
  ]

  // Las dos últimas son del último lote importado, que puede ser de otro mes:
  // sin decir cuál y de cuándo, se leen como excepciones de este cierre. Y sin
  // ningún lote no hay nada que declarar — un «0 rechazadas» sin lote detrás
  // es un cero que nadie comprobó.
  if (ultimoLote !== undefined) {
    const cuando = `«${ultimoLote.fileName}», ${fechaDeLote(ultimoLote)}`
    excepciones.push(
      {
        clave: 'duplicados-lote',
        concepto: 'Duplicados descartados al importar',
        nota: cuando,
        cuantos: ultimoLote.duplicates,
        importe: null,
        moneda: data.moneda,
        donde: '/importar',
        dondeTexto: 'Ver el lote',
      },
      {
        clave: 'rechazadas-lote',
        concepto: 'Filas rechazadas al importar',
        nota: cuando,
        cuantos: ultimoLote.rejected,
        importe: null,
        moneda: data.moneda,
        donde: '/importar',
        dondeTexto: 'Ver el lote',
      },
    )
  }
  const hayExcepciones = excepciones.some((e) => e.cuantos > 0)

  return (
    <>
      <PageBar title={titulo} {...subtitulo} tools={herramientas} />

      <div className="page">
        {/* ── 1 · Cabecera de estado ─────────────────────────────────── */}
        <section className="panel">
          <div className="panel-head">
            <div>
              <span className="label">Cierre mensual · R1</span>
              <h2>{capitalize(formatMonth(mes))}</h2>
            </div>
            <div className="actions">
              <Coverage unconverted={data.mesActual.unconverted} currency={data.moneda} />
            </div>
          </div>

          <dl className="tiles">
            <div className="tile">
              <dt>Entidad</dt>
              <dd className={styles.text}>{session.householdName}</dd>
              <p className="sub">
                Todas las entidades del hogar: el filtro por sociedad todavía no está.
              </p>
            </div>
            <div className="tile">
              <dt>Período</dt>
              <dd className={styles.text}>
                {formatDate(from)} – {formatDate(to)}
              </dd>
              <p className="sub">Mes cerrado. Nada posterior al {formatDate(to, 'long')}.</p>
            </div>
            <div className="tile">
              <dt>Moneda de reporte</dt>
              <dd>{data.moneda}</dd>
              <p className="sub">
                Se cambia en <Link href="/ajustes">Ajustes</Link>.
              </p>
            </div>
            <div className="tile">
              <dt>Política de cambio</dt>
              <dd className={styles.text}>Tasa del día del asiento</dd>
              <p className="sub">
                Congelada al importar. Lo que no se pudo convertir se declara, no se suma.
              </p>
            </div>
          </dl>

          <dl className="tiles">
            <div className="tile">
              <dt>Cuentas conciliadas</dt>
              {/* Verde sólo cuando están TODAS. Pintar «1 de 18» de verde
                  porque el uno es mayor que cero es dar por buena la parte y
                  entrenar al ojo a leer color en vez de número. */}
              <dd className={cuadran === filas.length ? 'pos' : undefined}>{cuadran}</dd>
              <p className="sub">de {filas.length} cuentas de activo y pasivo</p>
            </div>
            <div className="tile">
              <dt>Con delta</dt>
              <dd className={conDelta > 0 ? 'neg' : undefined}>{conDelta}</dd>
              <p className="sub">el banco y el libro no dicen lo mismo</p>
            </div>
            <div className="tile">
              <dt>Sin declarar</dt>
              <dd>{sinDeclarar}</dd>
              <p className="sub">sin extracto en el período: no hay nada que comprobar</p>
            </div>
            {incompletas > 0 && (
              <div className="tile">
                <dt>Incompletas</dt>
                <dd className="neg">{incompletas}</dd>
                <p className="sub">movimientos en otra moneda dentro de la cuenta</p>
              </div>
            )}
          </dl>

          {/*
            Conciliar no es cerrar. Que las cuentas cuadren dice que el libro
            coincide con el banco; el paquete no se puede mandar mientras haya
            movimientos sin clasificar o pendientes de criterio, y un verdicto
            en verde que lo diera por hecho es exactamente la firma en falso
            que este bloque existe para evitar.
          */}
          <div className={`verdict ${cerrado && !hayExcepciones ? 'ok' : 'warn'}`}>
            {cerrado ? (
              hayExcepciones ? (
                <>
                  <b>Las {filas.length} cuentas cuadran, pero quedan excepciones sin resolver.</b>{' '}
                  El libro coincide con el banco. Lo que falta antes de mandar el paquete está en
                  Excepciones, más abajo.
                </>
              ) : (
                <>
                  <b>Las {filas.length} cuentas cuadran al céntimo.</b> Sin excepciones abiertas: el
                  mes está cerrado y el paquete se puede mandar.
                </>
              )
            ) : (
              <>
                <b>
                  {conDelta > 0
                    ? `${conDelta} ${conDelta === 1 ? 'cuenta descuadra' : 'cuentas descuadran'}.`
                    : `${sinDeclarar + incompletas} de ${filas.length} cuentas sin comprobar.`}
                </b>{' '}
                El mes todavía no está cerrado. Lo que falta está abajo, cuenta por cuenta y con el
                motivo.
              </>
            )}
          </div>
        </section>

        {/* ── 2 · Reconciliación por cuenta ──────────────────────────── */}
        <section className={`panel ${styles.recon}`}>
          <div className="panel-head">
            <div>
              <h2>Reconciliación por cuenta</h2>
              <small>
                Saldo declarado de apertura + movimientos, contra el extracto de cierre. Primero lo
                que falla.
              </small>
            </div>
          </div>

          {filas.length === 0 ? (
            <Empty title="No hay cuentas de activo ni de pasivo">
              La reconciliación compara cuentas de banco, tarjeta y efectivo. Cuando cargues la
              primera, este bloque se llena solo.
            </Empty>
          ) : (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Cuenta</th>
                    <th className="r">Saldo inicial</th>
                    <th className="r">Movimientos</th>
                    <th className="r">Final calculado</th>
                    <th className="r">Saldo real</th>
                    <th className="r">Delta</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((row) => {
                    const extracto = ultimoExtracto.get(row.accountId) ?? null
                    return (
                      <tr key={row.accountId}>
                        <td>
                          <Link
                            className={styles.name}
                            href={aMovimientos({
                              cuenta: row.accountId,
                              desde: from,
                              hasta: to,
                            })}
                          >
                            {row.accountName}
                          </Link>
                          <span className={styles.note}>
                            {row.currency}
                            {row.foreignPostings > 0 &&
                              ` · ${row.foreignPostings} ${
                                row.foreignPostings === 1 ? 'movimiento' : 'movimientos'
                              } en otra moneda, fuera de la suma`}
                          </span>
                        </td>

                        <td className="r money">
                          {row.opening === null ? (
                            <span className="faint">—</span>
                          ) : (
                            <>
                              <Money amount={row.opening} currency={row.currency} />
                              {row.openingOn !== null && (
                                <span className={styles.note}>{formatDate(row.openingOn)}</span>
                              )}
                            </>
                          )}
                        </td>

                        <td className="r money">
                          <Money amount={row.movements} currency={row.currency} tone="flow" />
                        </td>

                        <td className="r money">
                          {row.closingCalculated === null ? (
                            <span className="faint">—</span>
                          ) : (
                            <Money amount={row.closingCalculated} currency={row.currency} />
                          )}
                        </td>

                        <td className="r money">
                          {row.declared === null ? (
                            <>
                              <span className="faint">—</span>
                              <span className={styles.note}>
                                {extracto === null
                                  ? 'sin extracto declarado'
                                  : `último extracto: ${formatDate(extracto)}`}
                              </span>
                            </>
                          ) : (
                            <>
                              <Money amount={row.declared} currency={row.currency} />
                              {row.declaredOn !== null && (
                                <span className={styles.note}>{formatDate(row.declaredOn)}</span>
                              )}
                            </>
                          )}
                        </td>

                        <td className={`r money ${styles.delta}`}>
                          {row.delta === null ? (
                            <span className="faint">—</span>
                          ) : (
                            <span className={`status ${row.delta === 0n ? 'ok' : 'bad'}`}>
                              <Money amount={row.delta} currency={row.currency} symbol={false} />
                            </span>
                          )}
                        </td>

                        <td>
                          <Estado row={row} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="notes">
            <h3>Cómo leer este bloque</h3>
            <ul>
              <li>
                El saldo inicial es un <b>saldo declarado por el banco</b>, nunca uno derivado
                restando movimientos: derivarlo daría delta cero siempre y la comprobación no
                querría decir nada.
              </li>
              <li>
                Sin extracto de apertura o de cierre dentro del período el estado es{' '}
                <b>sin declarar</b>, y no «cuadra». No cuadra nada que no se haya comprobado.
              </li>
              <li>
                Los movimientos se suman desde el día siguiente al extracto de apertura hasta el de
                cierre, no de punta a punta del mes: comparar contra movimientos que el banco
                todavía no vio inventa deltas que no existen.
              </li>
            </ul>
          </div>
        </section>

        {/* ── 3 · Estado de resultados ───────────────────────────────── */}
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Estado de resultados por categoría</h2>
              <small>
                {capitalize(formatMonth(mes))} contra {formatMonth(anterior)} y acumulado {anio}
              </small>
            </div>
            <div className="actions">
              <Coverage
                unconverted={data.mesActual.unconverted}
                currency={data.moneda}
                extra={`${data.mesActual.transactions} operaciones`}
              />
              <Link className="btn quiet" href={aMovimientos({ desde: from, hasta: to })}>
                Ver los movimientos
              </Link>
            </div>
          </div>

          <dl className="tiles">
            <div className="tile">
              <dt>Ingresos</dt>
              <dd>
                <Money amount={data.mesActual.income} currency={data.moneda} />
              </dd>
              <p className="sub">
                <Delta
                  value={data.mesActual.income - data.mesAnterior.income}
                  base={data.mesAnterior.income}
                />{' '}
                vs. {formatMonth(anterior)}
              </p>
              {baseIncompleta}
            </div>
            <div className="tile">
              <dt>Gastos</dt>
              <dd>
                <Money amount={data.mesActual.expense} currency={data.moneda} />
              </dd>
              <p className="sub">
                <Delta
                  value={data.mesActual.expense - data.mesAnterior.expense}
                  base={data.mesAnterior.expense}
                  invert
                />{' '}
                vs. {formatMonth(anterior)}
              </p>
              {baseIncompleta}
            </div>
            <div className="tile">
              <dt>Neto</dt>
              <dd>
                <Money amount={data.mesActual.net} currency={data.moneda} tone="delta" />
              </dd>
              <p className="sub">ingresos menos gastos del mes</p>
            </div>
            <div className="tile">
              <dt>Acumulado {anio}</dt>
              <dd>
                <Money amount={data.acumulado.net} currency={data.moneda} tone="delta" />
              </dd>
              <p className="sub">
                {data.acumulado.transactions} operaciones desde el {formatDate(inicioAnio)}
              </p>
              {/* El acumulado es una cifra propia con su propia cobertura: la
                  del mes de arriba no dice nada de los once meses anteriores. */}
              {data.acumulado.unconverted > 0 && (
                <p className="sub">
                  <Coverage unconverted={data.acumulado.unconverted} currency={data.moneda} />
                </p>
              )}
            </div>
          </dl>

          {categoriasOrdenadas.length === 0 ? (
            <Empty title="Sin gasto en el período">
              No hay ni un movimiento de gasto entre el {formatDate(from)} y el {formatDate(to)}.
              Puede ser correcto, o puede que falte importar el extracto del mes.
            </Empty>
          ) : (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Categoría</th>
                    <th className="r">{capitalize(formatMonth(mes, 'short'))}</th>
                    <th className="r">{capitalize(formatMonth(anterior, 'short'))}</th>
                    <th className="r">Δ</th>
                    <th className="r">Acumulado {anio}</th>
                  </tr>
                </thead>
                <tbody>
                  {categoriasOrdenadas.map((fila) => (
                    <tr key={fila.id}>
                      <td>
                        <Link
                          href={aMovimientos({
                            categoria: rama(fila.id),
                            desde: from,
                            hasta: to,
                          })}
                        >
                          {fila.nombre}
                        </Link>
                        {fila.sinConvertirMes > 0 && (
                          <span className={styles.note}>
                            {fila.sinConvertirMes} sin convertir a {data.moneda} en{' '}
                            {formatMonth(mes, 'short')}
                          </span>
                        )}
                        {fila.sinConvertirComparativo > 0 && (
                          <span className={styles.note}>
                            {fila.sinConvertirComparativo} sin convertir en el comparativo y el
                            acumulado
                          </span>
                        )}
                      </td>
                      <td className="r money">
                        <Money amount={fila.mes} currency={data.moneda} />
                      </td>
                      <td className="r money">
                        <Money amount={fila.anterior} currency={data.moneda} />
                      </td>
                      <td className="r">
                        <Delta value={fila.mes - fila.anterior} base={fila.anterior} invert />
                      </td>
                      <td className="r money">
                        <Money amount={fila.anio} currency={data.moneda} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>
                      {/* El total suma gasto; enlazarlo al período a secas
                          abriría también los ingresos y el registro diría más
                          filas de las que la cifra suma. */}
                      <Link
                        href={aMovimientos({ categoria: ramasDelTotal, desde: from, hasta: to })}
                      >
                        Total gasto
                      </Link>
                    </td>
                    <td className="r money">
                      <Money amount={totalGasto.mes} currency={data.moneda} />
                    </td>
                    <td className="r money">
                      <Money amount={totalGasto.anterior} currency={data.moneda} />
                    </td>
                    <td className="r">
                      <Delta
                        value={totalGasto.mes - totalGasto.anterior}
                        base={totalGasto.anterior}
                        invert
                      />
                    </td>
                    <td className="r money">
                      <Money amount={totalGasto.anio} currency={data.moneda} />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <div className="notes">
            <h3>Alcance</h3>
            <ul>
              <li>
                El desglose es de <b>gasto</b>: el motor todavía no agrupa los ingresos por
                categoría. El ingreso del mes está arriba, en el total, y sale del mismo libro.
              </li>
              <li>
                Las transferencias entre cuentas propias no son gasto ni ingreso y quedan fuera de
                estas cifras, aunque sí aparecen en el listado de movimientos.
              </li>
              <li>Categorías plegadas a la raíz. Cada fila se abre hasta la transacción.</li>
            </ul>
          </div>
        </section>

        {/* ── 4 · Excepciones ────────────────────────────────────────── */}
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Excepciones</h2>
              <small>Lo que hay que resolver antes de mandar el paquete</small>
            </div>
          </div>

          {hayExcepciones ? (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Concepto</th>
                    <th className="r">Cuántos</th>
                    <th className="r">Importe</th>
                    <th>Dónde se resuelve</th>
                  </tr>
                </thead>
                <tbody>
                  {excepciones.map((fila) => (
                    <tr key={fila.clave}>
                      <td>
                        {fila.concepto}
                        {fila.nota !== undefined && (
                          <span className={styles.note}>{fila.nota}</span>
                        )}
                      </td>
                      <td className="r num">
                        {fila.cuantos === 0 ? <span className="faint">0</span> : fila.cuantos}
                      </td>
                      <td className="r money">
                        {fila.importe === null ? (
                          <span className="faint">—</span>
                        ) : (
                          <Money amount={fila.importe} currency={fila.moneda} />
                        )}
                      </td>
                      <td>
                        <Link href={fila.donde}>{fila.dondeTexto}</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="panel-body">
              <p className="small">
                Ninguna excepción en el período: nada sin categorizar, nada esperando criterio y
                ningún duplicado sin decidir.
              </p>
            </div>
          )}

          {/*
            Estas filas enlazan a /revisar y no a /movimientos, que es lo que
            hace el resto de la pantalla. No es una excepción a la regla del
            drill-down: lo que espera criterio **no está asentado en el libro**
            —el importador lo deja en la cola con su evidencia y no crea el
            asiento—, así que en el listado de movimientos no habría nada que
            enseñar.
          */}
          {colaPeriodo.length > 0 && (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Concepto</th>
                    <th>Cuenta</th>
                    <th className="r">Importe</th>
                    <th>Por qué</th>
                  </tr>
                </thead>
                <tbody>
                  {colaPeriodo.map((row) => (
                    <tr key={row.id}>
                      <td className="num">
                        {row.bookedOn === null ? (
                          <span className="faint">—</span>
                        ) : (
                          formatDate(row.bookedOn)
                        )}
                      </td>
                      <td>
                        <Link href="/revisar">{row.description ?? 'Sin concepto'}</Link>
                      </td>
                      <td>{row.accountName ?? <span className="faint">—</span>}</td>
                      <td className="r money">
                        {row.amount === null || row.currency === null ? (
                          <span className="faint">—</span>
                        ) : (
                          <Money amount={row.amount} currency={row.currency} tone="flow" />
                        )}
                      </td>
                      <td>
                        <span className="status warn">{etiquetaRevision(row.kind)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="panel-body">
            <Illustrative>
              Falta una línea que R1 exige: «N transacciones ocultas por política de privacidad,
              importe total X». Todavía no se puede calcular porque el esquema no tiene el flag de
              categoría sensible, y sin flag <b>este cierre no oculta nada</b>: lo que ves es el
              libro entero. Cuando exista, el recuento y su importe salen acá.
            </Illustrative>
          </div>

          {/*
            La cola se lee con tope. Pasado el tope, «N pendientes» sería el
            recuento de lo que cupo, no el de lo que hay — y este cierre se
            firma mirando ese número.
          */}
          {colaRecortada && (
            <div className="banner">
              <b>La cola de revisión llegó al tope de {TOPE_COLA} filas que lee esta pantalla.</b>{' '}
              Los recuentos de excepciones son de esas {TOPE_COLA} y puede haber más detrás: el
              listado completo está en <Link href="/revisar">Revisar</Link>.
            </div>
          )}

          <div className="panel-foot">
            Las transferencias sin par se muestran como las detecta el motor —una salida y una
            entrada que parecen la misma operación y que nadie confirmó todavía—, no como un cruce
            verificado contra el libro entero.
            {colaFuera > 0 && (
              <>
                {' '}
                Hay además {colaFuera} {colaFuera === 1 ? 'pendiente' : 'pendientes'} con fecha
                fuera de {formatMonth(mes)}: no entran en este cierre, pero siguen esperando en{' '}
                <Link href="/revisar">Revisar</Link>.
              </>
            )}
            {colaSinFecha > 0 && (
              <>
                {' '}
                Y {colaSinFecha} {colaSinFecha === 1 ? 'pendiente' : 'pendientes'} sin fecha, que
                por eso no se pueden asignar a ningún mes ni descartar de éste.
              </>
            )}
          </div>
        </section>

        {/* ── 5 · Anexo ──────────────────────────────────────────────── */}
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Anexo · lotes importados</h2>
              <small>
                {data.lotes.length < TOPE_LOTES
                  ? 'De dónde salió cada movimiento del libro, y qué se descartó al entrar'
                  : `Los ${TOPE_LOTES} lotes más recientes. De dónde salió cada movimiento, y qué se descartó al entrar`}
              </small>
            </div>
          </div>

          {data.lotes.length === 0 ? (
            <Empty title="Todavía no hay lotes">
              Cuando importes un extracto, su informe queda acá con lo leído, lo importado, lo
              descartado por duplicado y lo rechazado con motivo.
            </Empty>
          ) : (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Fichero</th>
                    <th>Formato</th>
                    <th>Cuándo</th>
                    <th className="r">Leídas</th>
                    <th className="r">Importadas</th>
                    <th className="r">Duplicadas</th>
                    <th className="r">A revisión</th>
                    <th className="r">Rechazadas</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lotes.map((lote) => (
                    <tr key={lote.id}>
                      <td>
                        <Link href={`/importar?lote=${lote.id}`}>{lote.fileName}</Link>
                      </td>
                      <td className="num">{lote.format}</td>
                      <td className="num">{fechaDeLote(lote)}</td>
                      <td className="r num">{lote.linesRead}</td>
                      <td className="r num">{lote.imported}</td>
                      <td className="r num">{lote.duplicates}</td>
                      <td className="r num">{lote.needsReview}</td>
                      <td className="r num">{lote.rejected}</td>
                      <td>
                        {lote.status === 'completed' && <span className="status ok">completo</span>}
                        {lote.status === 'reverted' && (
                          <>
                            <span className="status none">deshecho</span>
                            {lote.revertedAt !== null && (
                              <span className={styles.note}>
                                {formatDate(lote.revertedAt.slice(0, 10))}
                              </span>
                            )}
                          </>
                        )}
                        {lote.status === 'failed' && <span className="status bad">falló</span>}
                        {lote.status === 'running' && <span className="status warn">en curso</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="panel-body">
            <Illustrative>
              El anexo de R1 lleva además <b>los adjuntos vinculados</b> y el{' '}
              <b>log de cambios posteriores al cierre anterior</b>. Ninguna de las dos cosas existe
              todavía en el modelo de datos, así que no hay nada que enseñar y tampoco se simula:
              por ahora el anexo es el origen de los movimientos, lote por lote.
            </Illustrative>
          </div>

          <div className="panel-foot">
            El paquete para el contador —PDF, XLSX con fórmulas, CSV crudo y ZIP de adjuntos— es lo
            que va a producir el botón «Generar cierre». Todavía no existe, así que no hay descarga
            que ofrecer: preferimos el botón apagado a un fichero que no cuadre con esta pantalla.
          </div>
        </section>
      </div>
    </>
  )
}
