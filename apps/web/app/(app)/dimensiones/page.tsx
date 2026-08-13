import {
  type DimensionSummary,
  type DimensionValueSummary,
  dimensionsWithValues,
  movements,
} from '@moneypilot/db'
import Link from 'next/link'
import { readHousehold } from '@/lib/data'
import { navItem } from '@/lib/nav'
import { NoData } from '../empty-state'
import { PageBar } from '../ui'
import { AccionesValor, NuevaDimension, NuevoValor, type OpcionPadre } from './forms'
import styles from './page.module.css'
import { puedeEditarEstructura } from './state'

export const dynamic = 'force-dynamic'

const ITEM = navItem('/dimensiones')

/** Ejemplos por dimensión conocida, para que el campo vacío no dé miedo. */
const EJEMPLO: Readonly<Record<string, string>> = {
  propiedad: 'Casa Madrid',
  entidad: 'Iriarte Patrimonial SL',
  persona: 'Marta Ruiz (pareja)',
  proyecto: 'Reforma cocina Madrid',
}

export default async function DimensionesPage() {
  const { session, data } = await readHousehold(async (client) => {
    // En serie: las dos van por el mismo cliente —una transacción, una
    // conexión—, así que pg las encola igual. Promise.all daba paralelismo
    // aparente y un aviso de query concurrente sobre un cliente ocupado, que
    // en pg@9 será un error.
    const dimensiones = await dimensionsWithValues(client)
    // Sólo para saber si el hogar tiene historia cargada. El listado no se
    // usa: pedir una fila es más barato que pedir los saldos de todo.
    const muestra = await movements(client, { limit: 1 })
    return { dimensiones, movimientos: muestra.total }
  })

  const { dimensiones, movimientos } = data
  const puedeEditar = puedeEditarEstructura(session.role)
  const recienLlegado = movimientos === 0 && dimensiones.length === 0

  return (
    <>
      <PageBar
        title={ITEM?.label ?? 'Dimensiones'}
        blurb={
          ITEM?.blurb ?? 'Propiedades, sociedades, personas y proyectos, como los nombrás vos.'
        }
        tools={
          <Link href="/movimientos" className="btn">
            Ver movimientos
          </Link>
        }
      />

      <div className="page">
        <p className="lede">
          Una dimensión es cómo llamás vos a las cosas que tenés: tus propiedades, tus sociedades,
          las personas de la casa, los proyectos abiertos. Sin esto,{' '}
          <b>«¿cuánto me cuesta la casa de Madrid?» no se puede contestar</b> — las categorías dicen
          en qué se gastó el dinero, no a qué cosa tuya pertenece ese gasto.
        </p>

        {recienLlegado && (
          <>
            <NoData what="cuánto te cuesta cada propiedad, sociedad o proyecto" />
            {puedeEditar && (
              <div className="notice">
                O empezá por acá. Nombrar tu estructura es el primer paso del alta y no necesita que
                haya entrado un solo movimiento: cuando importes, los movimientos se cuelgan de
                estos nombres.
              </div>
            )}
          </>
        )}

        {dimensiones.map((dimension) => (
          <Dimension key={dimension.id} dimension={dimension} puedeEditar={puedeEditar} />
        ))}

        {puedeEditar ? (
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Nueva dimensión</h2>
                <p className="small faint">
                  Un eje entero por el que vas a querer cortar el gasto: propiedad, entidad,
                  persona, proyecto. Los valores concretos se añaden después, dentro de cada una.
                </p>
              </div>
            </div>
            <div className="panel-body">
              <NuevaDimension />
            </div>
            <div className="panel-foot">
              La clave es el nombre corto con el que la dimensión viaja en los filtros y en los
              reportes. Si la dejás en blanco se deriva del nombre, y no se puede cambiar después
              sin romper los reportes guardados que la usen.
            </div>
          </section>
        ) : (
          <div className="banner">
            Tu rol ({session.role}) ve la estructura pero no la edita. Nombrar propiedades,
            sociedades y proyectos es del titular y de la pareja.
          </div>
        )}
      </div>
    </>
  )
}

/* ── Una dimensión con sus valores ───────────────────────────────────────── */

function Dimension({
  dimension,
  puedeEditar,
}: {
  dimension: DimensionSummary
  puedeEditar: boolean
}) {
  const nodos = enOrden(dimension.values)
  const activos = dimension.values.filter((valor) => valor.archivedAt === null).length
  const archivados = dimension.values.length - activos
  const usos = dimension.values.reduce((total, valor) => total + valor.usage, 0)
  const sinUsar = dimension.values.filter(
    (valor) => valor.archivedAt === null && valor.usage === 0,
  ).length

  const padres: OpcionPadre[] = nodos
    .filter((nodo) => nodo.value.archivedAt === null)
    .map((nodo) => ({ id: nodo.value.id, label: nodo.value.label, depth: nodo.depth }))

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{dimension.label}</h2>
          <p className="small faint">
            <code className="num">{dimension.key}</code> · {activos}{' '}
            {activos === 1 ? 'valor activo' : 'valores activos'}
            {archivados > 0 && ` · ${archivados} archivado${archivados === 1 ? '' : 's'}`}
          </p>
        </div>
        <small>
          {usos} {usos === 1 ? 'movimiento atribuido' : 'movimientos atribuidos'}
        </small>
      </div>

      {nodos.length === 0 ? (
        <div className="panel-body">
          <p className="small faint">
            Esta dimensión todavía no tiene valores, así que no filtra nada. Añadí el primero acá
            abajo.
          </p>
        </div>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Valor</th>
                <th className="r">Movimientos</th>
                <th>Estado</th>
                {puedeEditar && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {nodos.map(({ value, depth, suelto }) => (
                <tr key={value.id}>
                  <td>
                    <span
                      className={depth > 0 ? styles.child : undefined}
                      style={depth > 1 ? { marginLeft: (depth - 1) * 18 } : undefined}
                    >
                      <Link href={`/movimientos?dimension=${value.id}`}>{value.label}</Link>
                    </span>
                    {suelto && (
                      <span
                        className="status warn"
                        title="Su valor padre ya no está en esta dimensión."
                      >
                        colgado de la nada
                      </span>
                    )}
                  </td>
                  <td className="r num">{value.usage}</td>
                  <td>
                    {value.archivedAt !== null ? (
                      <span className="status none">archivado</span>
                    ) : value.usage === 0 ? (
                      <span className="status warn">sin uso</span>
                    ) : (
                      <span className="status ok">en uso</span>
                    )}
                  </td>
                  {puedeEditar && (
                    <td>
                      <AccionesValor
                        valueId={value.id}
                        label={value.label}
                        archivado={value.archivedAt !== null}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {puedeEditar && (
        <div className={styles.formBody}>
          <NuevoValor
            dimensionId={dimension.id}
            dimensionLabel={dimension.label}
            ejemplo={EJEMPLO[dimension.key] ?? 'Nombre como lo decís vos'}
            padres={padres}
          />
        </div>
      )}

      <div className="panel-foot">
        {sinUsar > 0
          ? `${sinUsar} ${sinUsar === 1 ? 'valor no etiqueta' : 'valores no etiquetan'} todavía ningún movimiento. `
          : ''}
        Archivar no borra: los movimientos ya atribuidos siguen contando en los reportes, y el valor
        deja de ofrecerse para etiquetar de acá en adelante.
      </div>
    </section>
  )
}

/* ── Orden jerárquico ────────────────────────────────────────────────────── */

interface Nodo {
  readonly value: DimensionValueSummary
  readonly depth: number
  /** Su padre no está en la dimensión. Se muestra igual, como raíz y marcado. */
  readonly suelto: boolean
}

const RAIZ = ''
const PROFUNDIDAD_MAX = 8

/**
 * Aplana el árbol de valores en el orden en que se lee.
 *
 * Dos cuidados que no son teóricos: `parent_id` no impide un ciclo (A hijo de
 * B, B hijo de A) y tampoco impide apuntar a un valor que ya no está. En los
 * dos casos el valor desaparecería del recorrido, y con él los movimientos que
 * tiene atribuidos. Preferimos un árbol raro a un árbol incompleto que se ve
 * bien, así que lo que el recorrido no alcanzó se devuelve igual, a nivel raíz.
 */
function enOrden(values: readonly DimensionValueSummary[]): Nodo[] {
  const ids = new Set(values.map((valor) => valor.id))
  const porPadre = new Map<string, DimensionValueSummary[]>()
  const huerfanos = new Set<string>()

  for (const valor of values) {
    const tienePadre = valor.parentId !== null && ids.has(valor.parentId)
    if (valor.parentId !== null && !tienePadre) huerfanos.add(valor.id)
    const clave = tienePadre && valor.parentId !== null ? valor.parentId : RAIZ
    const lista = porPadre.get(clave)
    if (lista === undefined) porPadre.set(clave, [valor])
    else lista.push(valor)
  }

  for (const lista of porPadre.values()) {
    lista.sort((a, b) => a.label.localeCompare(b.label, 'es'))
  }

  const salida: Nodo[] = []
  const vistos = new Set<string>()

  const recorrer = (clave: string, depth: number): void => {
    if (depth > PROFUNDIDAD_MAX) return
    for (const valor of porPadre.get(clave) ?? []) {
      if (vistos.has(valor.id)) continue
      vistos.add(valor.id)
      salida.push({ value: valor, depth, suelto: huerfanos.has(valor.id) })
      recorrer(valor.id, depth + 1)
    }
  }
  recorrer(RAIZ, 0)

  for (const valor of values) {
    if (!vistos.has(valor.id)) salida.push({ value: valor, depth: 0, suelto: true })
  }
  return salida
}
