/**
 * Las piezas que comparten la lista de reglas y el editor.
 *
 * Todas de servidor: aquí no hay estado, sólo cómo se lee una regla y cómo se
 * lee su impacto. La que importa es `PanelImpacto` — es el «esta regla afecta a
 * 342 transacciones» del paso 4 de B7, con el diff debajo.
 */

import type { MatchKind } from '@moneypilot/db'
import { formatDate } from '@/lib/format'
import { Money } from '../ui'
import { ETIQUETA_TIPO } from './criterios'
import type { FilaImpacto } from './impacto'
import { MUESTRA, type ResultadoImpacto } from './impacto'
import styles from './page.module.css'
import { puedeEditarReglas } from './state'

/* ── Rol ─────────────────────────────────────────────────────────────────── */

/**
 * Lo que ve quien propone pero no escribe.
 *
 * Va arriba y no escondido junto al botón: B6 dice que para el contador y el
 * asistente «editar» significa proponer, y enterarse de eso recién después de
 * escribir una regla entera es la peor forma posible de enterarse. Los botones
 * siguen ahí —ocultarlos deja a alguien buscando una función que existe— y lo
 * que hacen es explicar.
 */
export function AvisoDeRol({ role }: { role: string }) {
  if (puedeEditarReglas(role)) return null
  return (
    <div className="notice">
      <b>Tu rol en este hogar ({role}) propone cambios, no los escribe.</b> Podés armar una regla y
      ver exactamente a cuántos movimientos alcanza —eso no toca nada—, pero guardarla y aplicarla
      es del titular. El circuito para mandarle la propuesta con su diff está en construcción;
      mientras tanto, la URL de la vista previa es la propuesta: lleva los criterios y el impacto.
    </div>
  )
}

/* ── Qué busca una regla ─────────────────────────────────────────────────── */

export interface Busqueda {
  readonly matchKind: MatchKind
  readonly matchValue: string
  readonly accountName: string | null
  readonly minAmount: bigint | null
  readonly maxAmount: bigint | null
  /** La de la cuenta de la regla, o la de reporte si no tiene cuenta. */
  readonly moneda: string
}

export function QueBusca({ busqueda }: { busqueda: Busqueda }) {
  return (
    <div className={styles.busqueda}>
      <div>
        <span className="small faint">{ETIQUETA_TIPO[busqueda.matchKind]}</span>{' '}
        <code className={styles.patron}>{busqueda.matchValue}</code>
      </div>
      <div className="small faint">
        {busqueda.accountName === null ? 'en cualquier cuenta' : `en ${busqueda.accountName}`}
        <RangoDeImporte busqueda={busqueda} />
      </div>
    </div>
  )
}

/**
 * El rango se guarda con signo y acá se lee en el idioma del extracto: un
 * máximo de −1.000 es «cargos desde 10,00 €», no «hasta −10».
 */
function RangoDeImporte({ busqueda }: { busqueda: Busqueda }) {
  const { minAmount: min, maxAmount: max, moneda } = busqueda
  if (min === null && max === null) return null

  const abs = (valor: bigint) => (valor < 0n ? -valor : valor)

  // Los dos casos que se pueden decir en el idioma del extracto. El «desde» es
  // siempre el de menor magnitud, que en cargos es el máximo con signo.
  if (max !== null && max <= 0n && (min === null || min < 0n)) {
    return (
      <Tramo
        clase="cargos"
        desde={max === 0n ? null : abs(max)}
        hasta={min === null ? null : abs(min)}
        moneda={moneda}
      />
    )
  }
  if (min !== null && min >= 0n && (max === null || max > 0n)) {
    return <Tramo clase="abonos" desde={min === 0n ? null : min} hasta={max} moneda={moneda} />
  }
  // Un rango que cruza el cero no se puede decir en cargos ni en abonos, así
  // que se enseña crudo antes que traducirlo mal.
  return (
    <>
      {' · importe con signo entre '}
      {min === null ? '−∞' : <Money amount={min} currency={moneda} />}
      {' y '}
      {max === null ? '+∞' : <Money amount={max} currency={moneda} />}
    </>
  )
}

/** «cargos de 10,00 € a 100,00 €», con los dos extremos opcionales. */
function Tramo({
  clase,
  desde,
  hasta,
  moneda,
}: {
  clase: 'cargos' | 'abonos'
  desde: bigint | null
  hasta: bigint | null
  moneda: string
}) {
  if (desde === null && hasta === null) return <> · sólo {clase}</>
  if (desde === null) {
    return (
      <>
        {` · ${clase} de hasta `}
        <Money amount={hasta ?? 0n} currency={moneda} />
      </>
    )
  }
  if (hasta === null) {
    return (
      <>
        {` · ${clase} de `}
        <Money amount={desde} currency={moneda} /> en adelante
      </>
    )
  }
  return (
    <>
      {` · ${clase} de `}
      <Money amount={desde} currency={moneda} /> a <Money amount={hasta} currency={moneda} />
    </>
  )
}

/* ── A dónde manda ───────────────────────────────────────────────────────── */

export interface Atribucion {
  readonly label: string
  readonly value: string
  readonly weightPpm: number
}

export function Destino({
  categoria,
  dimensiones,
}: {
  categoria: string | null
  dimensiones: readonly Atribucion[]
}) {
  return (
    <div className={styles.busqueda}>
      {categoria === null ? <span className="faint">sin categoría</span> : <span>{categoria}</span>}
      {dimensiones.length > 0 && (
        <span className="chips">
          {dimensiones.map((dim) => (
            <span className="chip" key={`${dim.label}:${dim.value}`} title={dim.label}>
              {dim.value}
              {dim.weightPpm < 1_000_000 && (
                <span className="faint"> {Math.round(dim.weightPpm / 10_000)}%</span>
              )}
            </span>
          ))}
        </span>
      )}
    </div>
  )
}

/* ── El impacto ──────────────────────────────────────────────────────────── */

/**
 * Lo que haría la regla, antes de hacerlo.
 *
 * El orden de lectura no es casual: primero a cuántos alcanza, después cuántos
 * de esos ya tienen categoría —que es el aviso que evita borrar trabajo— y
 * recién al final la muestra. Quien mire sólo el número de arriba tiene que
 * haber leído ya lo que puede perder.
 */
export function PanelImpacto({
  resultado,
  soloSinCategorizar,
  destino,
}: {
  /** `null` cuando todavía no hay nada que previsualizar. */
  resultado: ResultadoImpacto | null
  soloSinCategorizar: boolean
  destino: { categoria: string | null; dimensiones: readonly Atribucion[] }
}) {
  if (resultado === null) {
    return (
      <div className="panel-body">
        <div className="notice">
          <b>Todavía no hay impacto que enseñar.</b> Escribí qué texto tiene que buscar la regla y
          pulsá «Ver el impacto»: antes de guardar nada vas a ver a cuántos movimientos alcanza y
          cuáles son.
        </div>
      </div>
    )
  }

  if (resultado.estado === 'error') {
    return (
      <div className="panel-body">
        <div className="error">
          <b>No se pudo calcular el impacto.</b> {resultado.motivo}
        </div>
      </div>
    )
  }

  const impacto = resultado.impacto
  if (impacto.total === 0) {
    return (
      <div className="panel-body">
        <div className="banner">
          <b>Esta regla no coincide con ningún movimiento de los que ya tenés.</b> Puede estar bien
          —una regla se aplica también a lo que venga después— pero si esperabas encontrar algo,
          revisá el texto: los descriptores del banco llevan referencias y números que cambian en
          cada cargo, así que suele funcionar mejor una palabra suelta que la línea entera.
        </div>
      </div>
    )
  }

  const enRiesgo = soloSinCategorizar ? 0 : impacto.yaClasificados

  return (
    <>
      <div className="panel-body">
        <div className="tiles">
          <div className="tile">
            <div className="k">Coincide con</div>
            <div className="v">{impacto.total}</div>
            <div className="sub">
              {impacto.total === 1 ? 'movimiento del registro' : 'movimientos del registro'}
            </div>
          </div>
          <div className="tile">
            <div className="k">Ya tienen categoría</div>
            <div className="v">{impacto.yaClasificados}</div>
            <div className="sub">puestos a mano o por una regla</div>
          </div>
          <div className="tile">
            <div className="k">Se tocarían ahora</div>
            <div className="v">{impacto.aTocar}</div>
            <div className="sub">
              {soloSinCategorizar
                ? 'sólo los que están sin categorizar'
                : 'todos los que coinciden'}
            </div>
          </div>
          <div className="tile">
            <div className="k">Fuera de alcance</div>
            <div className="v">{impacto.omitidos}</div>
            <div className="sub">traspasos y tickets repartidos</div>
          </div>
        </div>
      </div>

      {enRiesgo > 0 && (
        <div className="panel-foot">
          <div className="banner">
            <b>
              {enRiesgo} de estos {impacto.total} ya tienen una categoría puesta y la casilla de
              abajo está desmarcada, así que se les pisaría.
            </b>{' '}
            Puede ser trabajo tuyo de una tarde o el resultado de otra regla: desde acá no se
            distingue, y por eso lo preguntamos en vez de decidirlo. Si no era eso lo que querías,
            marcá «sólo los que están sin categorizar».
          </div>
        </div>
      )}

      {impacto.omitidos > 0 && (
        <div className="panel-foot">
          <b>
            {impacto.omitidos}{' '}
            {impacto.omitidos === 1 ? 'coincidencia queda' : 'coincidencias quedan'} fuera y la
            regla no las va a tocar.
          </b>{' '}
          Son traspasos entre cuentas tuyas —sus dos patas van contra cuentas propias, así que no
          hay categoría que cambiar— y tickets repartidos entre varias categorías, que aplastar a
          una sola destruiría el reparto sin avisar.
        </div>
      )}

      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Fecha</th>
              <th scope="col">Descripción</th>
              <th scope="col">Cuenta</th>
              <th scope="col">Categoría de hoy</th>
              <th scope="col" className="r">
                Importe
              </th>
            </tr>
          </thead>
          <tbody>
            {impacto.muestra.map((fila) => (
              <tr key={fila.movimiento.postingId}>
                <td>
                  <time dateTime={fila.movimiento.bookedOn}>
                    {formatDate(fila.movimiento.bookedOn)}
                  </time>
                </td>
                <td>{fila.movimiento.description}</td>
                <td>{fila.movimiento.accountName}</td>
                <td>
                  <EstadoDeLaFila fila={fila} soloSinCategorizar={soloSinCategorizar} />
                </td>
                <td className="r">
                  <Money
                    amount={fila.movimiento.amount}
                    currency={fila.movimiento.currency}
                    tone="flow"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel-foot spread">
        <span>
          {impacto.total <= MUESTRA
            ? `Están las ${impacto.total} coincidencias.`
            : `Las ${impacto.muestra.length} más recientes, de ${impacto.total}.`}
        </span>
        <ADondeVan destino={destino} />
      </div>
    </>
  )
}

/**
 * Qué le pasa a esta fila.
 *
 * Tres estados y no dos: el que está sin categorizar, el que ya tiene
 * categoría —y entonces importa si la casilla lo protege o no— y el que la
 * regla no puede tocar por mucho que coincida. Sin el tercero, un traspaso
 * aparecería con un «se reemplaza» que no va a pasar nunca, y esta pantalla
 * existe justamente para que lo que dice sea lo que ocurre.
 *
 * El ticket repartido entre varias categorías tampoco se toca y acá no se
 * distingue del normal: desde una fila no se ve cuántas patas de gasto tiene su
 * asiento. Va contado arriba, en «fuera de alcance», y explicado en el pie.
 */
function EstadoDeLaFila({
  fila,
  soloSinCategorizar,
}: {
  fila: FilaImpacto
  soloSinCategorizar: boolean
}) {
  if (fila.movimiento.categoryId === null) {
    return (
      <span className={styles.pisa}>
        <span className="faint">
          {fila.movimiento.isTransfer ? 'traspaso interno' : 'sin contrapartida'}
        </span>
        <span className="status none" title="No hay pata de gasto ni de ingreso que reclasificar">
          fuera de alcance
        </span>
      </span>
    )
  }

  if (fila.sinCategorizar) return <span className="faint">sin categorizar</span>

  return (
    <span className={styles.pisa}>
      {fila.movimiento.category}
      {soloSinCategorizar ? (
        <span className="status none">no se toca</span>
      ) : (
        <span className="status warn">se reemplaza</span>
      )}
    </span>
  )
}

/** A dónde van los que sí se tocan. Sin destino, la regla no hace nada. */
function ADondeVan({
  destino,
}: {
  destino: { categoria: string | null; dimensiones: readonly Atribucion[] }
}) {
  const atribucion = destino.dimensiones.map((dim) => `${dim.label}: ${dim.value}`).join(', ')

  if (destino.categoria === null && destino.dimensiones.length === 0) {
    return (
      <span className="small faint">
        Falta decir a dónde van: elegí una categoría o una dimensión, o la regla no hará nada.
      </span>
    )
  }

  if (destino.categoria === null) {
    return (
      <span className="small faint">
        Siguen en su categoría de hoy y quedan atribuidos a <b>{atribucion}</b>.
      </span>
    )
  }

  return (
    <span className="small faint">
      Los que se toquen pasan a <b>{destino.categoria}</b>
      {atribucion !== '' && <> y quedan atribuidos a {atribucion}</>}.
    </span>
  )
}

/** El recuento de la lista: «afecta a N». `null` es una regla que no evalúa. */
export function Afectados({ total }: { total: number | null }) {
  if (total === null) {
    return (
      <span className="status bad" title="Su patrón no se pudo evaluar">
        no evalúa
      </span>
    )
  }
  if (total === 0) return <span className="faint">0</span>
  return <span className="num">{total}</span>
}
