/**
 * /reglas — clasificar una vez y que valga para lo que venga.
 *
 * La pantalla tiene dos entradas y el orden importa. Arriba, **lo que falta por
 * categorizar agrupado por comercio**: es por donde empieza cualquiera que
 * acaba de importar dos años, porque veinte líneas de esa lista suelen cubrir
 * el ochenta por ciento de los movimientos. Debajo, las reglas que ya existen,
 * cada una con a cuántos movimientos alcanza **hoy** — sin ese número, una
 * lista de reglas es una lista de intenciones.
 */

import {
  accountBalances,
  type ClasificacionAutomatica,
  type ClasificadoPorCapa,
  clasificadoPorCapa,
  clasificarAutomatico,
  listRules,
  uncategorized,
} from '@moneypilot/db'
import Link from 'next/link'
import { etiquetaDeCapa, nombreDeCapa, ORDEN_DE_CAPAS } from '@/lib/capas'
import { readHousehold } from '@/lib/data'
import { navItem } from '@/lib/nav'
import { NoData } from '../empty-state'
import { Empty, Money, PageBar } from '../ui'
import { aQuery, DEFECTO, enlaceAMovimientos, semillaDeDescriptor } from './criterios'
import { contarAfectados } from './impacto'
import { Afectados, AvisoDeRol, Destino, QueBusca } from './piezas'
import { puedeEditarReglas } from './state'

export const dynamic = 'force-dynamic'

const ITEM = navItem('/reglas')

/** Comercios de la lista de impacto. Más que esto ya no es una lista, es la tabla entera. */
const COMERCIOS = 15

export default async function ReglasPage() {
  const { session, data } = await readHousehold(async (client) => {
    // En serie: las tres van por el mismo cliente —una transacción, una
    // conexión—, así que pg las encola igual. Promise.all daba paralelismo
    // aparente y un aviso de query concurrente sobre un cliente ocupado, que
    // en pg@9 será un error.
    const reglas = await listRules(client)
    const cuentas = await accountBalances(client)
    const pendiente = await uncategorized(client, { limit: COMERCIOS })

    // Una consulta por regla, en serie. Son decenas —no miles— y el número que
    // devuelven es justamente el que convierte la lista en algo accionable; si
    // algún día son cientos, lo que hay que cambiar es esto y no quitarlo.
    const afectados = new Map<string, number | null>()
    for (const regla of reglas) afectados.set(regla.id, await contarAfectados(client, regla))

    // Las dos mitades del resumen por capa, y son preguntas distintas: qué hay
    // hoy clasificado por cada una (mirando el libro) y qué haría el motor
    // ahora mismo con lo que queda (una pasada en seco, que no escribe nada).
    const yaHecho = await clasificadoPorCapa(client)
    const enSeco = await clasificarAutomatico(client, { aplicar: false })

    return { reglas, cuentas, pendiente, afectados, yaHecho, enSeco }
  })

  const { reglas, cuentas, pendiente, afectados, yaHecho, enSeco } = data
  const cabecera =
    ITEM === undefined ? { title: 'Reglas' } : { title: ITEM.label, blurb: ITEM.blurb }
  const monedaDeCuenta = new Map(cuentas.map((cuenta) => [cuenta.id, cuenta.currency]))
  const movimientos = cuentas.reduce((total, cuenta) => total + cuenta.movements, 0)
  const puedeEscribir = puedeEditarReglas(session.role)

  if (movimientos === 0 && reglas.length === 0) {
    return (
      <>
        <PageBar {...cabecera} />
        <div className="page">
          <NoData what="las reglas que clasifican tus movimientos" />
        </div>
      </>
    )
  }

  return (
    <>
      <PageBar
        {...cabecera}
        tools={
          <Link className="btn primary" href="/reglas/nueva">
            Nueva regla
          </Link>
        }
      />

      <div className="page">
        <AvisoDeRol role={session.role} />

        {/* Las dos líneas que evitan la pregunta de siempre. */}
        <p className="lede">
          Cambiar la categoría de un movimiento arregla ese movimiento;{' '}
          <b>una regla arregla de una vez todos los que se le parecen</b>, los de hoy y los de hace
          dos años. Por eso una regla se mira antes de aplicarla: alcanza a lo que ya está
          registrado, y eso puede ser trabajo que alguien hizo a mano.{' '}
          <b>Sobre cada importación nueva corren solas</b>, con las capas de abajo detrás — y por
          eso una regla se puede parar.
        </p>

        <PorCapa yaHecho={yaHecho} enSeco={enSeco} sinCategorizar={pendiente.total} />

        <div className="panel">
          <div className="panel-head">
            <h2>Por dónde empezar</h2>
            <small>
              {pendiente.total === 0
                ? 'nada sin categorizar'
                : `${pendiente.total} ${pendiente.total === 1 ? 'movimiento' : 'movimientos'} sin categorizar, sin contar traspasos`}
            </small>
          </div>

          {pendiente.porComercio.length === 0 ? (
            <Empty title="No queda nada sin categorizar">
              Todos los movimientos del hogar tienen una categoría. Las reglas de abajo siguen
              trabajando sobre lo que entre de acá en adelante.
            </Empty>
          ) : (
            <>
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Descriptor</th>
                      <th scope="col" className="r">
                        Veces
                      </th>
                      <th scope="col" className="r">
                        Suma
                      </th>
                      <th scope="col">Tal como lo escribe el banco</th>
                      <th scope="col" />
                    </tr>
                  </thead>
                  <tbody>
                    {pendiente.porComercio.map((grupo) => {
                      const semilla = semillaDeDescriptor(grupo.descripcion, grupo.ejemplo)
                      return (
                        <tr key={`${grupo.currency}:${grupo.descripcion}`}>
                          <td>
                            <b>{grupo.descripcion}</b>
                          </td>
                          <td className="r num">{grupo.veces}</td>
                          <td className="r">
                            <Money amount={grupo.importe} currency={grupo.currency} tone="flow" />
                          </td>
                          <td className="small faint">{grupo.ejemplo}</td>
                          <td className="r">
                            <Link
                              className="btn"
                              href={{
                                pathname: '/reglas/nueva',
                                query: {
                                  ...aQuery({ ...DEFECTO, texto: semilla }),
                                  // El otro texto viaja igual, para poder
                                  // cambiar de uno a otro de un click.
                                  ejemplo:
                                    semilla === grupo.ejemplo ? grupo.descripcion : grupo.ejemplo,
                                },
                              }}
                            >
                              Crear regla
                            </Link>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="panel-foot">
                Está agrupado por comercio, no por descriptor: «NETFLIX REF 8812» y «NETFLIX REF
                9903» son el mismo sitio, y la referencia cambia en cada cargo. La primera columna
                es ese comercio ya limpio —sin tildes, sin signos y sin las referencias—, así que
                sirve mejor como regla; cuando esa limpieza deja un texto que el banco no escribe
                así, el botón arranca con el de la cuarta columna. En el formulario se cambia de uno
                a otro de un click, y la vista previa dice cuántos agarra cada uno.
                {pendiente.truncados > 0 && (
                  <>
                    {' '}
                    Hay {pendiente.truncados} comercios más por debajo de estos {COMERCIOS}: son los
                    de menos impacto.
                  </>
                )}
              </div>
            </>
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Tus reglas</h2>
            <small>
              {reglas.length === 0
                ? 'ninguna todavía'
                : `${reglas.length}, de mayor a menor prioridad`}
            </small>
          </div>

          {reglas.length === 0 ? (
            <Empty
              title="Todavía no hay ninguna regla"
              action={
                <Link className="btn primary" href="/reglas/nueva">
                  Crear la primera
                </Link>
              }
            >
              Una regla mira la descripción de cada movimiento y lo manda a una categoría, con sus
              dimensiones. Se aplica sobre lo que ya está registrado, y siempre después de enseñarte
              a cuántos alcanza.
            </Empty>
          ) : (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Regla</th>
                    <th scope="col">Qué busca</th>
                    <th scope="col">A dónde lo manda</th>
                    <th scope="col" className="r">
                      Prioridad
                    </th>
                    <th scope="col">Estado</th>
                    <th scope="col" className="r">
                      Afecta hoy
                    </th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {reglas.map((regla) => {
                    const enlace = enlaceAMovimientos(regla)
                    return (
                      <tr key={regla.id}>
                        <td>
                          <Link href={`/reglas/${regla.id}`}>{regla.name}</Link>
                        </td>
                        <td>
                          <QueBusca
                            busqueda={{
                              matchKind: regla.matchKind,
                              matchValue: regla.matchValue,
                              accountName: regla.accountName,
                              minAmount: regla.minAmount,
                              maxAmount: regla.maxAmount,
                              moneda:
                                (regla.accountId === null
                                  ? null
                                  : (monedaDeCuenta.get(regla.accountId) ?? null)) ??
                                session.baseCurrency,
                            }}
                          />
                        </td>
                        <td>
                          <Destino
                            categoria={regla.category}
                            dimensiones={regla.dimensions.map((dim) => ({
                              label: dim.label,
                              value: dim.value,
                              weightPpm: dim.weightPpm,
                            }))}
                          />
                        </td>
                        <td className="r num">{regla.priority}</td>
                        <td>
                          {regla.enabled ? (
                            <span className="status ok">activa</span>
                          ) : (
                            <span className="status none">parada</span>
                          )}
                        </td>
                        <td className="r">
                          <Afectados total={afectados.get(regla.id) ?? null} />
                        </td>
                        <td className="r">
                          <Link
                            className="btn quiet"
                            href={enlace.destino}
                            title={
                              enlace.motivo ??
                              'Los mismos movimientos, en el registro, con el filtro puesto'
                            }
                          >
                            Ver en movimientos
                            {enlace.motivo !== null && <span className="faint"> ≈</span>}
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="notes">
            <h3>Cómo se leen</h3>
            <ul>
              <li>
                <b>Afecta hoy</b> es a cuántos movimientos ya registrados alcanza la regla ahora
                mismo, tengan la categoría que tengan. No es cuántos cambiaría: eso depende de si
                aplicás sólo sobre lo que está sin categorizar, y se ve entrando en la regla.
              </li>
              <li>
                Un movimiento lo clasifica <b>una sola regla</b>: la de mayor prioridad que lo
                alcance. Por eso el orden de esta tabla es el orden en que se aplican.
              </li>
              <li>
                Una regla <b>parada</b> queda fuera de la pasada que corre en cada importación;
                aplicarla a mano desde su pantalla se puede igual, porque es un acto explícito de
                alguien que la está mirando. Lo que ya clasificó se queda como está.
              </li>
              <li>
                El enlace al registro marcado con <span className="faint">≈</span> lleva a un
                conjunto más ancho: el buscador de movimientos no sabe de anclajes, de expresiones
                regulares ni de rangos de importe.
              </li>
              {!puedeEscribir && (
                <li>
                  Podés mirarlo todo y preparar propuestas; guardar y aplicar es del titular. Ver el
                  impacto de una regla no escribe nada.
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </>
  )
}

/* ── El reparto por capa ─────────────────────────────────────────────────── */

/**
 * Qué clasifica el motor solo, por capa, y qué haría ahora mismo.
 *
 * Son dos columnas y son dos preguntas distintas, y mezclarlas sería el error
 * que este panel existe para no cometer: **«ya puesto»** mira el libro y cuenta
 * lo que cada capa decidió y sigue en pie; **«propondría ahora»** es una pasada
 * en seco sobre lo que queda sin categorizar, que no escribe nada.
 *
 * Que casi todo caiga en «propondría» y casi nada en «aplicadas» no es un
 * defecto de la pantalla: sólo las reglas, la memoria confirmada y las señales
 * del banco se escriben solas. El diccionario y el agregador proponen y espera
 * una persona, y decirlo acá con el número delante es más honesto que un
 * porcentaje de acierto que nadie puede comprobar.
 */
function PorCapa({
  yaHecho,
  enSeco,
  sinCategorizar,
}: {
  yaHecho: readonly ClasificadoPorCapa[]
  enSeco: ClasificacionAutomatica
  /** El total de la pantalla, para que las dos cifras se relacionen. */
  sinCategorizar: number
}) {
  const puesto = new Map(yaHecho.map((fila) => [fila.procedencia, fila.movimientos]))
  const propone = new Map(enSeco.porCapa.map((capa) => [capa.procedencia, capa]))
  const filas = ORDEN_DE_CAPAS.filter((capa) => (puesto.get(capa) ?? 0) > 0 || propone.has(capa))
  const aMano = puesto.get(null) ?? 0

  if (filas.length === 0 && aMano === 0 && enSeco.sinPropuesta === 0) return null

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Qué clasifica el motor solo</h2>
        <small>en orden de precedencia</small>
      </div>

      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Capa</th>
              <th scope="col">Qué sabe</th>
              <th scope="col" className="r">
                Ya puesto
              </th>
              <th scope="col" className="r">
                Propondría ahora
              </th>
              <th scope="col" className="r">
                De ésos, sin preguntar
              </th>
            </tr>
          </thead>
          <tbody>
            {filas.map((capa) => {
              const ahora = propone.get(capa)
              return (
                <tr key={capa}>
                  <td>
                    <b>{etiquetaDeCapa(capa)}</b>
                  </td>
                  <td className="small faint">{nombreDeCapa(capa)}</td>
                  <td className="r num">{puesto.get(capa) ?? 0}</td>
                  <td className="r num">{ahora?.propuestas ?? 0}</td>
                  <td className="r num">{ahora?.automaticas ?? 0}</td>
                </tr>
              )
            })}
            {aMano > 0 && (
              <tr>
                <td>
                  <b>A mano</b>
                </td>
                <td className="small faint">lo que decidió una persona</td>
                <td className="r num">{aMano}</td>
                <td className="r faint">—</td>
                <td className="r faint">—</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {enSeco.rutasSinCuenta.length > 0 && (
        <div className="panel-foot">
          <b>Categorías que te faltan.</b> El motor reconoció el comercio de estos movimientos y no
          encontró en tu plan de cuentas dónde ponerlos. Crear la cuenta los clasifica de una vez:
          <ul>
            {enSeco.rutasSinCuenta.slice(0, 8).map((perdida) => (
              <li key={`${perdida.procedencia}${perdida.ruta}`}>
                <b>{perdida.ruta}</b> — {perdida.movimientos} movimiento(s), según{' '}
                {nombreDeCapa(perdida.procedencia)}
              </li>
            ))}
          </ul>
          <Link href="/estructura">Ver el plan de cuentas</Link>
        </div>
      )}

      <div className="notes">
        <h3>Cómo se leen</h3>
        <ul>
          <li>
            <b>Ya puesto</b> cuenta la última decisión de cada movimiento y sólo si sigue en pie: si
            el motor clasificó y después lo corregiste, cuenta como tuyo. Contar el intento sería el
            número que más se parece a una mentira útil.
          </li>
          <li>
            Una capa sólo se consulta cuando las de arriba no tuvieron nada que decir. Por eso la
            tabla va en este orden y no por cantidad: <b>cuanto más cerca de vos, más manda</b>.
          </li>
          <li>
            Las tres primeras se aplican solas; el agregador y el diccionario <b>proponen</b> y
            esperan a una persona. Cuando confirmás tres veces el mismo comercio, pasa a la memoria
            y a partir de ahí se clasifica solo.
          </li>
          {enSeco.sinPropuesta > 0 && (
            <li>
              {/* Los dos números son distintos y uno es parte del otro: se dice
                  así. Antes esta pantalla enseñaba «72 sin categorizar» arriba
                  y «39 sin categorizar» veinte líneas después, sin decir que los
                  39 son un subconjunto de los 72 — y dos cifras que no cuadran
                  en la misma pantalla se leen como un error, no como dos
                  preguntas distintas. */}
              De esos {sinCategorizar}, sobre <b>{enSeco.sinPropuesta}</b> no tiene nada que decir
              ninguna de las cinco capas. Ésos se arreglan con una regla, o clasificándolos a mano
              tres veces para que la memoria los aprenda. Los {sinCategorizar - enSeco.sinPropuesta}{' '}
              restantes ya tienen una propuesta esperando en <Link href="/revisar">Revisar</Link>.
            </li>
          )}
        </ul>
      </div>
    </div>
  )
}
