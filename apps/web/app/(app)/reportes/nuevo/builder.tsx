'use client'

import Link from 'next/link'
import { type ReactNode, useMemo, useState } from 'react'
import { Illustrative } from '../../ui'
import {
  ADJUNTO_VALUES,
  type BuilderContext,
  type BuilderState,
  buildIr,
  COMPARISONS,
  DIMENSIONS,
  describe,
  dimension,
  EXTRA_FILTER_FIELDS,
  type FilterRow,
  MEASURES,
  measure,
  movimientosHref,
  type Option,
  ORIGEN_VALUES,
  operatorsFor,
  VIZ,
} from '../ir'
import styles from './page.module.css'

/**
 * El constructor guiado: el nivel 2 del builder, el 25% del uso.
 *
 * Cinco filas, siempre visibles y siempre en el mismo orden — medida,
 * dimensiones, filtros, comparación, visualización — porque así el usuario lee
 * su propia pregunta como una oración de arriba abajo. Un asistente por etapas
 * o un panel de pestañas obligaría a recordar lo que eligió en el paso 1
 * mientras decide el 4, que es exactamente donde un mini-BI pierde a la gente.
 *
 * Lo que este componente **no** hace es ejecutar. Compone: la pregunta en
 * castellano y el IR, que son el mismo objeto dicho de dos maneras. El panel de
 * resultado lo dice con todas las letras en vez de enseñar un gráfico de
 * mentira, que es lo que este producto le reprocha a los demás.
 */

/* ── Piezas de formulario ────────────────────────────────────────────────── */

function Paso({
  numero,
  titulo,
  hint,
  children,
}: {
  numero: number
  titulo: string
  hint: string
  children: ReactNode
}) {
  return (
    <div className={styles.paso}>
      <div className={styles.pasoLabel}>
        <span className={styles.pasoNum}>paso {numero}</span>
        <span className="label">{titulo}</span>
        <span className={styles.hint}>{hint}</span>
      </div>
      <div className={styles.control}>{children}</div>
    </div>
  )
}

function Valores({
  options,
  selected,
  motivo,
  onToggle,
}: {
  options: readonly Option[]
  selected: readonly string[]
  /** Por qué el campo no tiene valores, cuando el servidor lo sabe. */
  motivo?: string | undefined
  onToggle: (id: string) => void
}) {
  if (options.length === 0) {
    // "No hay valores" y "el libro no guarda este campo" llevan a acciones
    // opuestas: cargar datos, o dejar de esperar que este filtro exista.
    return (
      <span className="status none">
        {motivo ?? 'este campo todavía no tiene valores en tu hogar'}
      </span>
    )
  }
  return (
    <div className={styles.valores}>
      <div className="chips">
        {options.map((option) => (
          <button
            type="button"
            key={option.id}
            className="chip"
            aria-pressed={selected.includes(option.id)}
            onClick={() => onToggle(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ── El constructor ──────────────────────────────────────────────────────── */

export function Constructor({ ctx, initial }: { ctx: BuilderContext; initial: BuilderState }) {
  const [state, setState] = useState<BuilderState>(initial)
  const [siguienteId, setSiguienteId] = useState(initial.filters.length + 1)
  const [copia, setCopia] = useState<'listo' | 'hecho' | 'fallo' | 'sin-soporte'>('listo')

  const ir = useMemo(() => buildIr(state, ctx), [state, ctx])
  const frase = useMemo(() => describe(state, ctx), [state, ctx])
  const drill = useMemo(() => movimientosHref(state, ctx), [state, ctx])
  const json = useMemo(() => JSON.stringify(ir, null, 2), [ir])

  const medida = measure(state.measure)

  /** Campos filtrables: todas las dimensiones menos la fecha, más los tres extra. */
  const camposFiltrables = useMemo(
    () => [
      ...DIMENSIONS.filter((d) => d.id !== 'fecha').map((d) => ({ id: d.id, label: d.label })),
      ...EXTRA_FILTER_FIELDS,
    ],
    [],
  )

  const valoresDe = (field: string): readonly Option[] => {
    if (field === 'adjunto') return ADJUNTO_VALUES
    if (field === 'origen') return ORIGEN_VALUES
    return ctx.values[field] ?? []
  }

  const alternarDimension = (field: string) => {
    setState((s) => {
      const ya = s.dimensions.some((d) => d.field === field)
      if (ya) return { ...s, dimensions: s.dimensions.filter((d) => d.field !== field) }
      const def = dimension(field)
      const grain = def?.grains?.[0]?.id
      const level = def?.levels?.[0]?.id
      return {
        ...s,
        dimensions: [
          ...s.dimensions,
          {
            field,
            ...(grain === undefined ? {} : { grain }),
            ...(level === undefined ? {} : { level }),
          },
        ],
      }
    })
  }

  const cambiarDimension = (field: string, key: 'grain' | 'level', value: string) => {
    setState((s) => ({
      ...s,
      dimensions: s.dimensions.map((d) => (d.field === field ? { ...d, [key]: value } : d)),
    }))
  }

  const cambiarFiltro = (id: string, patch: Partial<FilterRow>) => {
    setState((s) => ({
      ...s,
      filters: s.filters.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }))
  }

  const anadirFiltro = () => {
    const primero = camposFiltrables[0]
    if (primero === undefined) return
    const operador = operatorsFor(primero.id)[0]
    setState((s) => ({
      ...s,
      filters: [
        ...s.filters,
        {
          id: `f${siguienteId}`,
          field: primero.id,
          operator: operador?.id ?? 'one_of',
          values: [],
          text: '',
          join: 'and',
        },
      ],
    }))
    setSiguienteId((n) => n + 1)
  }

  /**
   * Copiar al portapapeles, y decirlo cuando no se puede.
   *
   * `navigator.clipboard` no existe fuera de contexto seguro y el permiso se
   * puede denegar. Sin este resguardo el botón lanza en el manejador o falla
   * en silencio: el usuario cree que tiene el objeto copiado, pega, y no hay
   * nada. Un botón que miente sobre lo que hizo es peor que uno apagado.
   */
  const copiar = () => {
    const portapapeles = navigator.clipboard
    if (portapapeles === undefined) {
      setCopia('sin-soporte')
      return
    }
    portapapeles.writeText(json).then(
      () => {
        setCopia('hecho')
        window.setTimeout(() => setCopia('listo'), 2000)
      },
      () => setCopia('fallo'),
    )
  }

  const noDisponibles = DIMENSIONS.filter((d) => ctx.unavailable[d.id] !== undefined)
  /** Dimensiones que la pregunta corta y este hogar no puede resolver. */
  const imposibles = state.dimensions.filter((d) => ctx.unavailable[d.field] !== undefined)

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <h2>La pregunta</h2>
          <div className="actions">
            <input
              type="text"
              value={state.name}
              onChange={(event) => setState((s) => ({ ...s, name: event.target.value }))}
              placeholder="Ponle nombre"
              aria-label="Nombre del reporte"
              style={{ minWidth: '260px' }}
            />
          </div>
        </div>
        <div className="panel-body">
          <p className={styles.frase}>{frase}</p>
        </div>
        <div className="panel-foot">
          Si la frase no se entiende leída en voz alta, la pregunta tampoco. Es la única validación
          que tiene este formulario, y es deliberada.
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Composición</h2>
          <small>Resultado en vivo en cada cambio: no hay botón de ejecutar</small>
        </div>

        <div className={styles.pasos}>
          <Paso
            numero={1}
            titulo="Medida"
            hint="Qué se mide. Una sola, para que el eje signifique algo."
          >
            <div className={styles.fila}>
              <select
                value={state.measure}
                onChange={(event) => setState((s) => ({ ...s, measure: event.target.value }))}
                aria-label="Medida"
              >
                {MEASURES.map((m) => (
                  <option value={m.id} key={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            {medida !== undefined && <p className={styles.hint}>{medida.hint}</p>}
          </Paso>

          <Paso
            numero={2}
            titulo="Dimensiones"
            hint="Cómo se corta. El orden en que las elegís es el orden en que se leen."
          >
            <div className="chips">
              {DIMENSIONS.map((d) => {
                const motivo = ctx.unavailable[d.id]
                const elegida = state.dimensions.some((s) => s.field === d.id)
                // Una plantilla puede dejar elegida una dimensión que este
                // hogar no resuelve —"gasto por viaje" en un hogar sin viajes—.
                // Si en ese caso el chip se deshabilita, la dimensión queda
                // clavada en la pregunta y no hay forma de quitarla: se apaga,
                // pero se deja quitar.
                const bloqueada = motivo !== undefined && !elegida
                return (
                  <button
                    type="button"
                    key={d.id}
                    className={motivo === undefined ? 'chip' : `chip ${styles.chipOff}`}
                    aria-pressed={elegida}
                    disabled={bloqueada}
                    title={motivo ?? d.label}
                    onClick={() => alternarDimension(d.id)}
                  >
                    {d.label}
                  </button>
                )
              })}
            </div>

            {imposibles.length > 0 && (
              <span className="status warn">
                La pregunta se corta por{' '}
                {imposibles.map((d) => dimension(d.field)?.label ?? d.field).join(' y ')}, que este
                hogar no puede resolver:{' '}
                {imposibles.map((d) => ctx.unavailable[d.field]).join(' · ')}. Quitala del corte o
                el reporte no se va a poder ejecutar.
              </span>
            )}

            {state.dimensions.map((sel) => {
              const def = dimension(sel.field)
              if (def === undefined) return null
              if (def.grains === undefined && def.levels === undefined) return null
              return (
                <div className={styles.fila} key={sel.field}>
                  <span className="small">{def.label}</span>
                  {def.grains !== undefined && (
                    <select
                      value={sel.grain ?? def.grains[0]?.id}
                      onChange={(event) => cambiarDimension(sel.field, 'grain', event.target.value)}
                      aria-label={`Grano de ${def.label}`}
                    >
                      {def.grains.map((g) => (
                        <option value={g.id} key={g.id}>
                          por {g.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {def.levels !== undefined && (
                    <select
                      value={sel.level ?? def.levels[0]?.id}
                      onChange={(event) => cambiarDimension(sel.field, 'level', event.target.value)}
                      aria-label={`Nivel de ${def.label}`}
                    >
                      {def.levels.map((l) => (
                        <option value={l.id} key={l.id}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )
            })}

            {noDisponibles.length > 0 && (
              <p className={styles.hint}>
                Sin usar todavía:{' '}
                {noDisponibles
                  .map((d) => `${d.label} (${ctx.unavailable[d.id] ?? ''})`)
                  .join(' · ')}
              </p>
            )}
          </Paso>

          <Paso
            numero={3}
            titulo="Filtros"
            hint="Y entre campos, O dentro de cada uno. Elegir tres categorías es un O y no hace falta escribirlo."
          >
            <div className={styles.fila}>
              <span className="small">Período</span>
              <select
                value={state.range.kind === 'relative' ? state.range.id : 'absoluto'}
                onChange={(event) => {
                  const value = event.target.value
                  setState((s) => {
                    if (value !== 'absoluto')
                      return { ...s, range: { kind: 'relative', id: value } }
                    const actual = ctx.ranges.find(
                      (r) => s.range.kind === 'relative' && r.id === s.range.id,
                    )
                    return {
                      ...s,
                      range: {
                        kind: 'absolute',
                        from: actual?.from ?? '',
                        to: actual?.to ?? '',
                      },
                    }
                  })
                }}
                aria-label="Período"
              >
                {ctx.ranges.map((r) => (
                  <option value={r.id} key={r.id}>
                    {r.label}
                  </option>
                ))}
                <option value="absoluto">Entre dos fechas</option>
              </select>

              {state.range.kind === 'absolute' ? (
                <>
                  <input
                    type="date"
                    value={state.range.from}
                    onChange={(event) =>
                      setState((s) => ({
                        ...s,
                        range: {
                          kind: 'absolute',
                          from: event.target.value,
                          to: s.range.kind === 'absolute' ? s.range.to : event.target.value,
                        },
                      }))
                    }
                    aria-label="Desde"
                  />
                  <input
                    type="date"
                    value={state.range.to}
                    onChange={(event) =>
                      setState((s) => ({
                        ...s,
                        range: {
                          kind: 'absolute',
                          from: s.range.kind === 'absolute' ? s.range.from : event.target.value,
                          to: event.target.value,
                        },
                      }))
                    }
                    aria-label="Hasta"
                  />
                </>
              ) : (
                <span className="small faint">
                  {
                    ctx.ranges.find(
                      (r) => state.range.kind === 'relative' && r.id === state.range.id,
                    )?.from
                  }{' '}
                  →{' '}
                  {
                    ctx.ranges.find(
                      (r) => state.range.kind === 'relative' && r.id === state.range.id,
                    )?.to
                  }
                </span>
              )}
            </div>

            {state.filters.map((row, index) => {
              const operadores = operatorsFor(row.field)
              const operador = operadores.find((o) => o.id === row.operator) ?? operadores[0]
              return (
                <div className={styles.filtro} key={row.id}>
                  <div className={styles.fila} style={{ width: '100%' }}>
                    {index > 0 && (
                      <select
                        value={row.join}
                        onChange={(event) =>
                          cambiarFiltro(row.id, {
                            join: event.target.value === 'or' ? 'or' : 'and',
                          })
                        }
                        aria-label="Unión con el filtro anterior"
                      >
                        <option value="and">y</option>
                        <option value="or">o</option>
                      </select>
                    )}
                    <select
                      value={row.field}
                      onChange={(event) => {
                        const field = event.target.value
                        const primero = operatorsFor(field)[0]
                        cambiarFiltro(row.id, {
                          field,
                          operator: primero?.id ?? 'one_of',
                          values: [],
                          text: '',
                        })
                      }}
                      aria-label="Campo"
                    >
                      {camposFiltrables.map((f) => (
                        <option value={f.id} key={f.id}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={row.operator}
                      onChange={(event) => cambiarFiltro(row.id, { operator: event.target.value })}
                      aria-label="Operador"
                    >
                      {operadores.map((o) => (
                        <option value={o.id} key={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {operador?.input === 'texto' && (
                      <input
                        type="text"
                        value={row.text}
                        onChange={(event) => cambiarFiltro(row.id, { text: event.target.value })}
                        placeholder="texto"
                        aria-label="Texto"
                      />
                    )}
                    {operador?.input === 'importe' && (
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row.text}
                        onChange={(event) => cambiarFiltro(row.id, { text: event.target.value })}
                        placeholder={`importe en ${ctx.reportCurrency}`}
                        aria-label="Importe"
                      />
                    )}
                    <button
                      type="button"
                      className={`quiet ${styles.quitar}`}
                      onClick={() =>
                        setState((s) => ({
                          ...s,
                          filters: s.filters.filter((f) => f.id !== row.id),
                        }))
                      }
                    >
                      Quitar
                    </button>
                  </div>
                  {operador?.input === 'valores' && (
                    <Valores
                      options={valoresDe(row.field)}
                      selected={row.values}
                      motivo={ctx.unavailable[row.field]}
                      onToggle={(id) =>
                        cambiarFiltro(row.id, {
                          values: row.values.includes(id)
                            ? row.values.filter((v) => v !== id)
                            : [...row.values, id],
                        })
                      }
                    />
                  )}
                </div>
              )
            })}

            <div className={styles.fila}>
              <button type="button" onClick={anadirFiltro}>
                Añadir filtro
              </button>
              <label className="small">
                <input
                  type="checkbox"
                  checked={state.excludeTransfers}
                  onChange={(event) =>
                    setState((s) => ({ ...s, excludeTransfers: event.target.checked }))
                  }
                />{' '}
                Excluir transferencias internas
              </label>
            </div>
            <p className={styles.hint}>
              Mover plata de la cuenta corriente al ahorro no empobrece a nadie: contarlo como gasto
              duplica el gasto del mes. La regla vive en la capa semántica y por eso este
              interruptor vale para todas las medidas a la vez.
            </p>
          </Paso>

          <Paso
            numero={4}
            titulo="Comparación"
            hint="Contra qué se mide. Un número solo casi nunca dice si algo va bien."
          >
            <div className="chips">
              {COMPARISONS.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  className="chip"
                  aria-pressed={state.compare === c.id}
                  onClick={() => setState((s) => ({ ...s, compare: c.id }))}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {state.compare === 'average_n_periods' && (
              <div className={styles.fila}>
                <span className="small">Períodos</span>
                <input
                  type="number"
                  min={2}
                  max={36}
                  value={state.averageN}
                  onChange={(event) =>
                    setState((s) => ({ ...s, averageN: Number(event.target.value) || 2 }))
                  }
                  aria-label="Cantidad de períodos"
                  style={{ width: '90px' }}
                />
              </div>
            )}
            {state.compare === 'budget' && (
              <span className="status warn">
                Todavía no hay presupuestos en el modelo: la comparación queda escrita en el
                reporte, pero no tiene contra qué medirse
              </span>
            )}
          </Paso>

          <Paso
            numero={5}
            titulo="Visualización"
            hint="Cómo se enseña. Todas llevan su tabla debajo, sincronizada."
          >
            <div className="chips">
              {VIZ.map((v) => (
                <button
                  type="button"
                  key={v.id}
                  className="chip"
                  aria-pressed={state.viz === v.id}
                  onClick={() => setState((s) => ({ ...s, viz: v.id }))}
                  title={v.hint}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <div className={styles.fila}>
              <span className="small">Top</span>
              <input
                type="number"
                min={3}
                max={100}
                value={state.topN}
                onChange={(event) =>
                  setState((s) => ({ ...s, topN: Number(event.target.value) || 10 }))
                }
                aria-label="Top N"
                style={{ width: '90px' }}
              />
              <label className="small">
                <input
                  type="checkbox"
                  checked={state.others}
                  onChange={(event) => setState((s) => ({ ...s, others: event.target.checked }))}
                />{' '}
                Agrupar el resto en &laquo;Otros&raquo;
              </label>
            </div>
            <p className={styles.hint}>
              &laquo;Otros&raquo; siempre es clickeable: una fila que agrupa la mitad del gasto y no
              se puede abrir es justo donde se esconden los errores de categorización.
            </p>
          </Paso>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Resultado</h2>
          <small>Lo que hoy se puede abrir de verdad</small>
        </div>
        <div className="panel-body stack">
          <Illustrative>
            El motor de ejecución genérico —el que toma cualquier combinación de medida, dimensiones
            y filtros y devuelve el agregado— es el siguiente paso, y hasta que exista este panel no
            enseña ninguna cifra. Pintar aquí un gráfico de muestra sería el error exacto que el
            producto le reprocha al resto: un número que no se puede explicar.
          </Illustrative>

          <div>
            <p className="small">
              Lo que sí existe es el detalle. Con el período y los filtros que se pueden traducir al
              listado, tu pregunta se abre así:
            </p>
            <div className={styles.fila} style={{ marginTop: 'var(--s2)' }}>
              <Link href={drill.href} className="btn">
                Ver los movimientos que entran
              </Link>
              {drill.untranslated.length > 0 && (
                <span className="status warn">
                  el listado todavía no aplica: {drill.untranslated.join(' · ')}
                </span>
              )}
            </div>
          </div>

          <div className="notes" style={{ borderTop: 0, padding: 0 }}>
            <h3>Qué falta para que este panel enseñe la cifra</h3>
            <ul>
              <li>
                El motor de agregación que lee el IR: <code>measures</code> ×{' '}
                <code>dimensions</code> con el árbol de <code>filter</code> aplicado por posting y
                sumado después.
              </li>
              <li>
                La capa semántica con las reglas transversales definidas una sola vez:
                transferencias internas fuera del gasto, conversión por posting antes de sumar,
                splits con peso que agregan importe × peso y detallan la porción.
              </li>
              <li>
                El test de reconciliación en integración continua:{' '}
                <code>SUM(detalle) == agregado</code> al céntimo, en las tres lentes de moneda.
              </li>
              <li>
                La cabecera de cobertura obligatoria: % sin categorizar, cuentas desactualizadas y
                si hubo conversión de moneda.
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>El objeto</h2>
          <div className="actions">
            <small>Este JSON es el reporte guardado, la URL y la herramienta del asistente</small>
            <button type="button" onClick={copiar} aria-live="polite">
              {copia === 'hecho' ? 'Copiado' : 'Copiar'}
            </button>
            {copia === 'fallo' && (
              <span className="status bad">
                el navegador denegó el portapapeles: copialo a mano
              </span>
            )}
            {copia === 'sin-soporte' && (
              <span className="status warn">
                este navegador no expone el portapapeles acá: copialo a mano
              </span>
            )}
          </div>
        </div>
        <pre className={styles.json}>{json}</pre>
        <div className="panel-foot">
          <code>id</code> y <code>updated_at</code> van en null porque todavía no hay tabla donde
          guardarlo: sellar una fecha de actualización en un objeto que nadie persistió sería
          inventar un dato. <code>sensitivity_policy: declare_hidden</code> es lo que hace que un
          reporte con categorías sensibles ocultas diga cuántas ocultó y por cuánto importe, en vez
          de devolver un total más chico sin avisar.
        </div>
      </div>
    </>
  )
}
