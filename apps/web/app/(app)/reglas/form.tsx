'use client'

/**
 * El formulario de una regla.
 *
 * Es de cliente por una sola cosa: enseñar al lado del botón lo que contestó el
 * servidor —«cambió 342 movimientos», «tu rol propone, no escribe»— en vez de
 * perder el sitio en una pantalla de error o en una redirección muda.
 *
 * Lo demás sigue siendo servidor, incluida la vista previa, que llega como
 * `children` ya renderizada. Va **dentro** del formulario a propósito: los
 * botones de aplicar tienen que quedar debajo del impacto, no encima, porque el
 * orden de lectura es el orden en que queremos que se decida.
 *
 * Tres botones y tres verbos distintos:
 *  · «Ver el impacto» recalcula y no escribe. Es también lo que hace la tecla
 *    Enter, que es el accidente más probable de este formulario.
 *  · «Guardar» deja la regla puesta para lo que venga. No toca el pasado.
 *  · «Guardar y aplicar» es el único que mueve movimientos ya registrados.
 */

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { borrarRegla, guardarSinAplicar, guardarYAplicar, verImpacto } from './actions'
import { aQuery, type Criterios, type Direccion, ETIQUETA_TIPO, firmaDe } from './criterios'
import styles from './page.module.css'
import { type EstadoRegla, IDLE } from './state'

export interface OpcionCuenta {
  readonly id: string
  readonly nombre: string
  readonly moneda: string
}

export interface OpcionCategoria {
  readonly id: string
  readonly path: string
  readonly kind: 'expense' | 'income'
}

export interface OpcionDimension {
  readonly id: string
  readonly label: string
  readonly valores: readonly { id: string; label: string; archivado: boolean }[]
}

export interface Opciones {
  readonly cuentas: readonly OpcionCuenta[]
  readonly categorias: readonly OpcionCategoria[]
  readonly dimensiones: readonly OpcionDimension[]
  readonly monedaBase: string
}

const DIRECCIONES: readonly { valor: Direccion; etiqueta: string }[] = [
  { valor: 'cualquiera', etiqueta: 'Cualquier importe' },
  { valor: 'cargos', etiqueta: 'Sólo cargos (lo que sale)' },
  { valor: 'abonos', etiqueta: 'Sólo abonos (lo que entra)' },
]

export function FormularioRegla({
  criterios,
  opciones,
  reglaId,
  ejemplo,
  children,
}: {
  criterios: Criterios
  opciones: Opciones
  /** `null` en una regla nueva. */
  reglaId: string | null
  /** El otro texto con el que se puede buscar el mismo comercio, si lo hay. */
  ejemplo: string | null
  children: React.ReactNode
}) {
  // A dónde vuelve la vista previa. Se calcula del id y no llega escrito: la
  // acción hace exactamente lo mismo, por lo que no hay ruta que falsificar.
  const destino = reglaId === null ? '/reglas/nueva' : `/reglas/${reglaId}`
  // Un estado por acción, y `pulsado` para saber cuál contestó: los dos botones
  // escriben cosas distintas y sus respuestas no se pueden mezclar.
  const [guardado, guardar, guardando] = useActionState<EstadoRegla, FormData>(
    guardarSinAplicar,
    IDLE,
  )
  const [aplicado, aplicar, aplicando] = useActionState<EstadoRegla, FormData>(
    guardarYAplicar,
    IDLE,
  )
  const [pulsado, setPulsado] = useState<'guardar' | 'aplicar' | null>(null)

  const estado = pulsado === 'aplicar' ? aplicado : pulsado === 'guardar' ? guardado : IDLE
  const trabajando = guardando || aplicando
  const esNueva = reglaId === null
  const yaCreada = esNueva && estado.status === 'ok' && estado.reglaId !== null

  const gastos = opciones.categorias.filter((categoria) => categoria.kind === 'expense')
  const ingresos = opciones.categorias.filter((categoria) => categoria.kind === 'income')
  const elegida = new Map(criterios.dimensiones.map((dim) => [dim.dimensionId, dim]))

  return (
    <form action={verImpacto} className="panel">
      <input type="hidden" name="reglaId" value={reglaId ?? ''} />
      <input type="hidden" name="ejemplo" value={ejemplo ?? ''} />
      {/* La firma de lo que se está enseñando. Si el usuario cambia un campo y
          pulsa aplicar sin volver a mirar, la acción la recalcula, no coincide
          y se niega a escribir. */}
      <input type="hidden" name="firma" value={firmaDe(criterios)} />

      <div className="panel-head">
        <h2>{esNueva ? 'Nueva regla' : 'La regla'}</h2>
        <small>Qué busca, a dónde lo manda y con qué prioridad</small>
      </div>

      <div className={`panel-body ${styles.campos}`}>
        <label className={styles.campo}>
          <span className="label">Nombre</span>
          <input
            name="nombre"
            defaultValue={criterios.nombre}
            maxLength={120}
            placeholder="Luz de la casa de Madrid"
            required
          />
          <span className="small faint">Para reconocerla en la lista.</span>
        </label>

        <label className={styles.campo}>
          <span className="label">La descripción…</span>
          <select name="tipo" defaultValue={criterios.tipo}>
            {(Object.keys(ETIQUETA_TIPO) as (keyof typeof ETIQUETA_TIPO)[]).map((tipo) => (
              <option key={tipo} value={tipo}>
                {ETIQUETA_TIPO[tipo]}
              </option>
            ))}
          </select>
        </label>

        <label className={`${styles.campo} ${styles.ancho}`}>
          <span className="label">…este texto</span>
          <input
            name="texto"
            defaultValue={criterios.texto}
            maxLength={200}
            placeholder="IBERDROLA"
            required
          />
          <span className="small faint">
            No distingue mayúsculas ni exige la palabra entera.
            {ejemplo !== null && (
              <>
                {' '}
                El mismo comercio también se puede buscar como «{ejemplo}»:{' '}
                <Link
                  href={{
                    pathname: destino,
                    query: {
                      ...aQuery({ ...criterios, texto: ejemplo }),
                      ejemplo: criterios.texto,
                    },
                  }}
                >
                  probar con ese texto
                </Link>
                .
              </>
            )}
          </span>
        </label>

        <label className={styles.campo}>
          <span className="label">Sólo en la cuenta</span>
          <select name="cuenta" defaultValue={criterios.cuentaId ?? ''}>
            <option value="">— cualquiera —</option>
            {opciones.cuentas.map((cuenta) => (
              <option key={cuenta.id} value={cuenta.id}>
                {cuenta.nombre} · {cuenta.moneda}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.campo}>
          <span className="label">Importe</span>
          <select name="direccion" defaultValue={criterios.direccion}>
            {DIRECCIONES.map((opcion) => (
              <option key={opcion.valor} value={opcion.valor}>
                {opcion.etiqueta}
              </option>
            ))}
          </select>
        </label>

        <div className={styles.campo}>
          <span className="label">Entre (opcional)</span>
          <div className="row">
            <input
              name="min"
              defaultValue={criterios.min}
              inputMode="decimal"
              size={8}
              placeholder="10"
              aria-label="Importe desde"
            />
            <span className="small faint">y</span>
            <input
              name="max"
              defaultValue={criterios.max}
              inputMode="decimal"
              size={8}
              placeholder="100"
              aria-label="Importe hasta"
            />
          </div>
          {/* El rango se guarda con signo y contra la moneda de la cuenta. Las
              dos cosas son trampas silenciosas si no se dicen acá. */}
          <span className="small faint">
            En positivo: el signo lo pone la línea de arriba. Se escribe en la moneda de la cuenta
            elegida y, si no elegiste ninguna, en {opciones.monedaBase} — y entonces se compara
            contra cuentas de otras monedas tal cual, sin convertir.
          </span>
        </div>

        <label className={`${styles.campo} ${styles.ancho}`}>
          <span className="label">Mandar a la categoría</span>
          <select name="categoria" defaultValue={criterios.categoriaId ?? ''}>
            <option value="">— ninguna: sólo poner dimensiones —</option>
            <optgroup label="Gasto">
              {gastos.map((categoria) => (
                <option key={categoria.id} value={categoria.id}>
                  {categoria.path}
                </option>
              ))}
            </optgroup>
            <optgroup label="Ingreso">
              {ingresos.map((categoria) => (
                <option key={categoria.id} value={categoria.id}>
                  {categoria.path}
                </option>
              ))}
            </optgroup>
          </select>
        </label>

        {opciones.dimensiones.map((dimension) => {
          const puesta = elegida.get(dimension.id)
          return (
            <div className={styles.campo} key={dimension.id}>
              <span className="label">{dimension.label}</span>
              {/* El rótulo nombra al par entero —valor y porcentaje—, así que
                  no es un `label`: cada control lleva el suyo en aria-label. */}
              <div className="row">
                <select
                  name={`dim.${dimension.id}`}
                  defaultValue={puesta?.valueId ?? ''}
                  aria-label={dimension.label}
                >
                  <option value="">— ninguna —</option>
                  {dimension.valores
                    .filter((valor) => !valor.archivado || valor.id === puesta?.valueId)
                    .map((valor) => (
                      <option key={valor.id} value={valor.id}>
                        {valor.label}
                        {valor.archivado ? ' (archivado)' : ''}
                      </option>
                    ))}
                </select>
                <input
                  name={`peso.${dimension.id}`}
                  defaultValue={puesta?.peso ?? ''}
                  inputMode="decimal"
                  size={3}
                  placeholder="100"
                  aria-label={`Porcentaje atribuido a ${dimension.label}`}
                />
                <span className="small faint">%</span>
              </div>
            </div>
          )
        })}

        <label className={styles.campo}>
          <span className="label">Prioridad</span>
          <input
            type="number"
            name="prioridad"
            defaultValue={String(criterios.prioridad)}
            step={1}
            size={5}
          />
          <span className="small faint">
            Un movimiento lo clasifica una sola regla: la de mayor prioridad que lo alcance.
          </span>
        </label>

        <label className={`${styles.campo} ${styles.casilla}`}>
          <span className="row">
            <input type="checkbox" name="activa" value="1" defaultChecked={criterios.activa} />
            <span>Activa</span>
          </span>
          <span className="small faint">
            Desactivada quedará fuera de la pasada automática sobre cada importación cuando ésa
            exista —todavía no está construida—, pero se puede aplicar a mano desde acá.
          </span>
        </label>
      </div>

      <div className={styles.acciones}>
        <button type="submit">Ver el impacto</button>
        <span className="small faint">No escribe nada: sólo cuenta a cuántos alcanza.</span>
      </div>

      {children}

      <div className={`panel-foot ${styles.aplicar}`}>
        <label className="row">
          <input
            type="checkbox"
            name="solo"
            value="1"
            defaultChecked={criterios.soloSinCategorizar}
          />
          <span className="small">
            <b>Sólo los que están sin categorizar.</b> Desmarcala y la regla pisa también lo que ya
            tiene categoría, que puede ser trabajo hecho a mano.
          </span>
        </label>

        {yaCreada ? (
          <div className="row">
            <Link className="btn" href={`/reglas/${estado.reglaId ?? ''}`}>
              Abrir la regla
            </Link>
            <Link className="btn" href="/reglas">
              Volver a la lista
            </Link>
          </div>
        ) : (
          <div className="row">
            {/* Sin `name` ni `value`: React usa esos dos atributos para
                codificar qué acción invocar cuando `formAction` es una
                función, y lo que se ponga ahí se pierde. Lo que distingue a un
                botón del otro es la acción que lleva cada uno. */}
            <button
              type="submit"
              formAction={guardar}
              disabled={trabajando}
              onClick={() => setPulsado('guardar')}
            >
              {guardando ? 'Guardando…' : esNueva ? 'Guardar sin aplicar' : 'Guardar cambios'}
            </button>
            <button
              type="submit"
              className="primary"
              formAction={aplicar}
              disabled={trabajando}
              onClick={() => setPulsado('aplicar')}
            >
              {aplicando ? 'Aplicando…' : 'Guardar y aplicar ahora'}
            </button>
          </div>
        )}

        <Mensaje estado={estado} />
      </div>
    </form>
  )
}

/**
 * La respuesta del servidor.
 *
 * «Propuesta» va en `notice` y no en `error`: que el contador no pueda escribir
 * todavía no es un fallo del contador ni de la pantalla, y pintarlo de rojo lo
 * haría parecer una avería.
 */
export function Mensaje({ estado }: { estado: EstadoRegla }) {
  if (estado.status === 'idle') return null
  const clase =
    estado.status === 'error' ? 'error' : estado.status === 'ok' ? 'verdict ok' : 'notice'
  return (
    <p className={clase} role="status">
      {estado.message}
    </p>
  )
}

/* ── Borrar ──────────────────────────────────────────────────────────────── */

/**
 * Borrar la regla, y nada más.
 *
 * Acá hubo un botón de «desactivar» y se quitó a propósito: si estar activa se
 * puede cambiar desde el formulario **y** desde un botón aparte, la pantalla
 * tiene dos verdades sobre el mismo dato. El botón desactivaba la regla, la
 * casilla del formulario seguía marcada porque nadie la volvió a pintar, y el
 * siguiente «Guardar cambios» la volvía a activar sin que nadie lo pidiera. La
 * casilla del formulario es la única forma de pararla.
 */
export function BorrarRegla({ reglaId }: { reglaId: string }) {
  const [borrado, borrar, borrando] = useActionState<EstadoRegla, FormData>(borrarRegla, IDLE)

  return (
    <div className={`panel-foot ${styles.aplicar}`}>
      <div className="row">
        <form action={borrar}>
          <input type="hidden" name="reglaId" value={reglaId} />
          <button type="submit" className="quiet" disabled={borrando}>
            {borrando ? 'Borrando…' : 'Borrar la regla'}
          </button>
        </form>
        <span className="small faint">
          Borrarla no descategoriza nada: lo que esta regla ya clasificó se queda como está, y el
          registro de quién lo cambió también. Si sólo querés que deje de aplicarse sobre lo que
          venga, desmarcá «Activa» arriba y guardá.
        </span>
      </div>
      <Mensaje estado={borrado} />
    </div>
  )
}
