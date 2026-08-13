import { accountBalances, categoryTree, dimensionsWithValues, movements } from '@moneypilot/db'
import Link from 'next/link'
import { readHousehold, today } from '@/lib/data'
import { NoData } from '../../empty-state'
import { PageBar } from '../../ui'
import { type Plantilla, plantilla } from '../catalogo'
import {
  ADJUNTO_VALUES,
  type BuilderContext,
  type BuilderState,
  DIMENSIONS,
  type FilterRow,
  type Option,
  ORIGEN_VALUES,
} from '../ir'
import { buildRanges } from '../rangos'
import { Constructor } from './builder'

/**
 * El constructor guiado.
 *
 * El servidor hace tres cosas y ninguna es calcular el reporte: resuelve los
 * rangos relativos a fechas concretas, junta los valores reales del hogar con
 * los que se pueden filtrar, y declara qué campos del catálogo este hogar
 * **no** puede resolver. Lo tercero es lo que impide que alguien componga
 * durante diez minutos una pregunta por "viaje" en un hogar que no tiene esa
 * dimensión y se entere al final.
 */

export const dynamic = 'force-dynamic'

/** Política FX por defecto. Cuando /ajustes la exponga, saldrá de ahí. */
const FLOW_POLICY = 'txn_date'
const STOCK_POLICY = 'period_close'

function estadoInicial(elegida: Plantilla | undefined): BuilderState {
  const preset = elegida?.preset
  const filtros: FilterRow[] = (preset?.filters ?? []).map((f, index) => ({
    id: `f${index + 1}`,
    field: f.field,
    operator: f.operator,
    values: f.values ?? [],
    text: '',
    join: 'and',
  }))

  return {
    name: elegida?.question ?? '',
    measure: preset?.measure ?? 'gasto_neto',
    dimensions: preset?.dimensions ?? [
      { field: 'categoria', level: 'root' },
      { field: 'fecha', grain: 'month' },
    ],
    range: { kind: 'relative', id: preset?.range ?? 'last_12_months' },
    filters: filtros,
    compare: preset?.compare ?? 'previous_period',
    averageN: 12,
    viz: preset?.viz ?? 'stacked_bar',
    topN: 10,
    others: true,
    excludeTransfers: true,
  }
}

export default async function Nuevo({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const pedida = params['plantilla']
  const idPedido = Array.isArray(pedida) ? (pedida[0] ?? '') : (pedida ?? '')
  const elegida = plantilla(idPedido)
  // Un enlace viejo a una plantilla que ya no está abriría el constructor en
  // blanco como si nada hubiera pasado, y el usuario compondría creyendo que
  // partió de la plantilla que pidió.
  const noEncontrada = idPedido !== '' && elegida === undefined

  const { session, data } = await readHousehold(async (client) => {
    const [muestra, dimensiones, cuentas, categorias] = await Promise.all([
      movements(client, { limit: 1 }),
      dimensionsWithValues(client),
      accountBalances(client),
      categoryTree(client),
    ])
    return { muestra, dimensiones, cuentas, categorias }
  })

  const titulo = 'Constructor de reportes'

  if (data.muestra.total === 0) {
    return (
      <>
        <PageBar title={titulo} />
        <div className="page">
          <NoData what="qué se puede preguntar" />
        </div>
      </>
    )
  }

  /* ── Los valores reales del hogar, campo por campo ─────────────────────── */

  const bancarias = data.cuentas.filter((c) => c.kind === 'asset' || c.kind === 'liability')
  const unicos = (lista: readonly (string | null)[]): Option[] =>
    [...new Set(lista.filter((x): x is string => x !== null && x !== ''))]
      .sort((a, b) => a.localeCompare(b, 'es'))
      .map((valor) => ({ id: valor, label: valor }))

  const values: Record<string, readonly Option[]> = {
    cuenta: bancarias.map((c) => ({ id: c.id, label: `${c.name} · ${c.currency}` })),
    categoria: data.categorias.map((c) => ({ id: c.id, label: c.path })),
    institucion: unicos(bancarias.map((c) => c.institution)),
    moneda: unicos(bancarias.map((c) => c.currency)),
    pais: unicos(bancarias.map((c) => c.country)),
    adjunto: ADJUNTO_VALUES,
    origen: ORIGEN_VALUES,
  }

  for (const resumen of data.dimensiones) {
    // Los archivados se ofrecen igual: un valor con trescientos postings
    // detrás sigue existiendo en la historia aunque ya no se etiquete con él,
    // y un reporte del año pasado sin él sería un reporte incompleto.
    values[resumen.key] = resumen.values.map((v) => ({
      id: v.id,
      label: v.archivedAt === null ? v.label : `${v.label} (archivado)`,
    }))
  }

  const unavailable: Record<string, string> = {}
  for (const def of DIMENSIONS) {
    if (def.missing !== undefined) {
      unavailable[def.id] = def.missing
      continue
    }
    if (
      def.source === 'hogar' &&
      def.key !== undefined &&
      !data.dimensiones.some((d) => d.key === def.key)
    ) {
      unavailable[def.id] = 'tu hogar todavía no tiene esta dimensión: se crea en Dimensiones'
      continue
    }
    if (def.source !== 'fecha' && def.source !== 'texto' && (values[def.id]?.length ?? 0) === 0) {
      unavailable[def.id] = 'no hay ni un valor de este campo en tus movimientos'
    }
  }

  const ctx: BuilderContext = {
    tenantId: session.tenantId,
    userId: session.user.id,
    reportCurrency: session.baseCurrency,
    flowPolicy: FLOW_POLICY,
    stockPolicy: STOCK_POLICY,
    ranges: buildRanges(today()),
    values,
    unavailable,
  }

  return (
    <>
      <PageBar
        title={titulo}
        blurb={
          elegida === undefined
            ? 'Medida, dimensiones, filtros, comparación y visualización. Cinco filas, y la pregunta se escribe sola.'
            : `Plantilla: ${elegida.question}`
        }
        tools={
          <Link href="/reportes" className="btn">
            Volver al catálogo
          </Link>
        }
      />

      <div className="page">
        {noEncontrada && (
          <div className="notice">
            No existe ninguna plantilla llamada <code>{idPedido}</code>, así que el constructor abre
            en blanco. Lo que estás componiendo no es la plantilla que pediste: el catálogo entero
            está en <Link href="/reportes">Reportes</Link>.
          </div>
        )}
        <Constructor ctx={ctx} initial={estadoInicial(elegida)} />
      </div>
    </>
  )
}
