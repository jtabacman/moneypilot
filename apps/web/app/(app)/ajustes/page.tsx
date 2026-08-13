import Link from 'next/link'
import { formatDate } from '@/lib/format'
import { navItem } from '@/lib/nav'
import { loadDemoData, unloadDemoData } from '../demo-actions'
import { Coverage, PageBar } from '../ui'
import { leerAjustes } from './actions'
import { FormularioHogar } from './forms'

/**
 * Los ajustes del hogar.
 *
 * Como /accesos, esta pantalla **no** enseña el estado vacío. Es la pantalla
 * donde se elige la moneda de reporte —que sólo se puede elegir mientras no
 * haya historia convertida— y donde está el botón que carga el hogar de
 * ejemplo. Mandar a un hogar recién creado a "cargá datos primero" cerraría
 * con llave la única puerta que le sirve.
 */
export const dynamic = 'force-dynamic'

const NAV = navItem('/ajustes')

export default async function Ajustes() {
  const panel = await leerAjustes()
  const { consolidacion: fx, hogar } = panel
  const hayHistoria = fx.postings > 0
  const monedaBloqueada = fx.porMoneda.some((linea) => linea.postings > 0)

  // Lo que la capa de lectura deja fuera de cada total no es sólo lo que no
  // tiene importe consolidado: también lo que lo tiene congelado en OTRA
  // moneda, porque la comparación es literal (`base_currency = la del hogar`).
  // Las dos cosas se suman antes de declarar la cobertura, o el aviso diría
  // que falta menos de lo que falta.
  const enOtraMoneda = fx.porMoneda
    .filter((linea) => linea.moneda !== hogar.monedaBase)
    .reduce((suma, linea) => suma + linea.postings, 0)
  const fueraDelConsolidado = fx.sinBase + enOtraMoneda

  return (
    <>
      <PageBar
        title={NAV?.label ?? 'Ajustes'}
        blurb={NAV?.blurb ?? 'Hogar, moneda de reporte y política de tipo de cambio.'}
        tools={<span className="role">{panel.rol}</span>}
      />

      <div className="page">
        <div className="tiles">
          <div className="tile">
            <div className="k">Hogar</div>
            <div className="v">{hogar.nombre}</div>
            <div className="sub">
              {hogar.creado === ''
                ? 'sin fecha de alta'
                : `desde ${formatDate(hogar.creado, 'long')}`}
            </div>
          </div>
          <div className="tile">
            <div className="k">Moneda de reporte</div>
            <div className="v">{hogar.monedaBase}</div>
            <div className="sub">en la que se consolida todo total</div>
          </div>
          {/* Apuntes, no movimientos. Un asiento tiene dos patas como mínimo y
              en /movimientos sólo se lista la de activo o pasivo, así que
              rotular este número "movimientos" daría el doble de lo que el
              usuario cuenta en el listado. Acá interesa el apunte porque es la
              unidad que se convierte y la que puede quedarse fuera de un total. */}
          <div className="tile">
            <div className="k">Apuntes del libro</div>
            <div className="v num">{fx.postings}</div>
            <div className="sub">en {fx.asientos} asientos</div>
          </div>
          <div className="tile">
            <div className="k">Con tipo de cambio</div>
            <div className="v num">{fx.conTasa}</div>
            <div className="sub">
              {fx.postings === 0
                ? 'todavía no hay nada convertido'
                : `de ${fx.postings} apuntes; el resto ya estaba en ${hogar.monedaBase}`}
            </div>
          </div>
        </div>

        <section className="panel">
          <div className="panel-head">
            <h2>El hogar</h2>
            <small>Nombre y moneda de reporte</small>
          </div>
          <div className="panel-body">
            <FormularioHogar
              nombre={hogar.nombre}
              moneda={hogar.monedaBase}
              bloqueada={monedaBloqueada}
            />
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Política de tipo de cambio</h2>
            <small>Decidida por el motor, no configurable</small>
          </div>

          <div className="panel-body stack">
            <p className="small">
              <b>
                Los flujos se convierten a la tasa del día de la transacción y los saldos a la tasa
                de cierre del período.
              </b>{' '}
              Un gasto de 1.200 USD del 14 de marzo entra al consolidado con la tasa del 14 de
              marzo, y ahí se queda.
            </p>
            <p className="small">
              <b>La conversión se congela con el movimiento y no se recalcula nunca.</b> Cada
              movimiento guarda su importe convertido, la tasa que se usó, la fecha de esa tasa y de
              dónde salió. Es lo que hace que un reporte emitido en marzo dé exactamente lo mismo si
              se vuelve a abrir en diciembre — y es también lo que hace que cambiar la moneda de
              reporte con historia cargada no sea un ajuste, sino una migración.
            </p>
            <p className="small">
              <b>
                El efecto de cambio se enseña como línea aparte, nunca mezclado con el movimiento
                real.
              </b>{' '}
              Que el patrimonio suba porque el dólar subió no es lo mismo que porque entró dinero, y
              un producto que los suma en la misma cifra está contando una historia falsa.
            </p>
            <p className="small faint">
              Nada de esto es configurable todavía y no hay una pantalla escondida donde lo sea: es
              una decisión del motor. Se cuenta acá porque quien firma un reporte tiene derecho a
              saber con qué regla se armó.
            </p>
          </div>

          {hayHistoria ? (
            <>
              {/* Puede haber apuntes y ninguna fila acá: si nada tiene
                  base_amount, no hay grupo que agrupar. Una tabla con cabecera
                  y sin filas se lee como "no hay nada"; lo que hay es un hogar
                  entero fuera del consolidado, y eso lo dice la cobertura. */}
              {fx.porMoneda.length > 0 && (
                <div className="scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Consolidado en</th>
                        <th className="r">Apuntes</th>
                        <th className="r">Con tasa</th>
                        <th>Tasas aplicadas entre</th>
                        <th className="r">Abrir</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fx.porMoneda.map((linea) => (
                        <tr key={linea.moneda}>
                          <td>
                            <b>{linea.moneda}</b>
                            {linea.moneda !== hogar.monedaBase && (
                              <span className="status bad" style={{ marginLeft: '8px' }}>
                                no es la del hogar
                              </span>
                            )}
                          </td>
                          <td className="r num">{linea.postings}</td>
                          <td className="r num">{linea.conTasa}</td>
                          <td className="small faint">
                            {linea.desde === null || linea.hasta === null
                              ? 'sin conversión: ya estaban en esa moneda'
                              : `${formatDate(linea.desde, 'long')} y ${formatDate(linea.hasta, 'long')}`}
                          </td>
                          <td className="r">
                            {/* El drill-down lleva el rango de fechas de las tasas de
                              esta fila. /movimientos no filtra por moneda de
                              consolidación —no existe ese filtro— así que el
                              enlace acota lo que sí puede acotar y el rótulo dice
                              hasta dónde llega, en vez de prometer un filtro que
                              no se aplica. */}
                            <Link
                              href={
                                linea.desde === null || linea.hasta === null
                                  ? { pathname: '/movimientos', query: {} }
                                  : {
                                      pathname: '/movimientos',
                                      query: { desde: linea.desde, hasta: linea.hasta },
                                    }
                              }
                              className="linklike"
                            >
                              {linea.desde === null || linea.hasta === null
                                ? 'Todos'
                                : 'Ese período'}
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="panel-foot spread">
                <Coverage
                  unconverted={fueraDelConsolidado}
                  currency={hogar.monedaBase}
                  extra={`${fx.conTasa} de ${fx.postings} apuntes llevaron tasa`}
                />
                <span className="small faint">
                  {fx.tasasGuardadas === 0
                    ? 'La tabla compartida de tasas está vacía: hoy cada tasa llega con su importación.'
                    : `${fx.tasasGuardadas} tasas guardadas en la tabla compartida.`}
                </span>
              </div>

              {fx.fuentes.length > 0 && (
                <div className="notes">
                  <h3>De dónde salieron las tasas</h3>
                  <ul>
                    {fx.fuentes.map((fuente) => (
                      <li key={fuente.fuente}>
                        <code>{fuente.fuente}</code> · {fuente.postings} apuntes
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <div className="notes">
              <h3>Todavía no hay nada convertido</h3>
              <ul>
                <li>
                  Sin movimientos cargados no hay conversiones congeladas, así que la moneda de
                  reporte se puede cambiar sin consecuencias. Es el único momento en que se puede.
                </li>
              </ul>
            </div>
          )}
        </section>

        <section className={panel.ejemploCargado ? 'panel is-demo' : 'panel'}>
          <div className="panel-head">
            <h2>Datos de ejemplo</h2>
            {panel.ejemploCargado && <span className="demo-tag">cargado</span>}
          </div>

          <div className="panel-body stack">
            <p className="small">
              El hogar de ejemplo es una familia inventada con 18 cuentas, tres países, dos monedas,
              una sociedad patrimonial, tres propiedades y algo más de un año de historia.{' '}
              <b>No es una maqueta:</b> se escriben asientos de verdad en tu base, con su partida
              doble, su reconciliación contra saldos declarados y su cola de revisión. Las pantallas
              lo enseñan porque está, no porque esté pintado.
            </p>
            <p className="small">
              Cuelga de un único lote de importación, así que quitarlo es revertir ese lote. Lo que
              ya tuvieras cargado con esos mismos nombres se respeta y no se borra.
            </p>

            {panel.lote !== null && (
              <p className="small faint">
                Lote sembrado el {formatDate(panel.lote.creado, 'long')} · {panel.lote.asientos}{' '}
                asientos · estado {panel.lote.estado}.
              </p>
            )}

            <div className="row">
              {panel.ejemploCargado ? (
                <form action={unloadDemoData}>
                  <button type="submit">Quitar el hogar de ejemplo</button>
                </form>
              ) : (
                <form action={loadDemoData}>
                  <button type="submit" className="primary">
                    Cargar el hogar de ejemplo
                  </button>
                </form>
              )}
              <Link href="/movimientos" className="btn quiet">
                Ver los movimientos
              </Link>
            </div>
          </div>
        </section>

        <div className="grid2">
          <section className="panel">
            <div className="panel-head">
              <h3>Llevarte tus datos</h3>
            </div>
            <div className="panel-body stack">
              <p className="small">
                La exportación completa —movimientos, cuentas, dimensiones, saldos declarados y los
                informes de importación, en CSV y en el formato de intercambio del libro— va a
                existir y va a estar acá. Es parte de la promesa: los datos son tuyos y el día que
                te quieras ir te los llevás enteros, sin pedírnoslos por correo.
              </p>
              <p className="small faint">
                Hoy no hay botón porque no bajaría nada, y un botón que no hace lo que dice es peor
                que su ausencia. Mientras tanto tenés{' '}
                {panel.consolidacion.asientos > 0 ? (
                  <Link href="/movimientos">{panel.consolidacion.asientos} asientos</Link>
                ) : (
                  'el hogar vacío'
                )}{' '}
                dentro, y se pueden extraer a mano desde la base si hiciera falta.
              </p>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h3>Sesión y seguridad</h3>
            </div>
            <div className="panel-body stack">
              <p className="small">
                Entraste como <b>{panel.correo ?? 'sin correo'}</b> con rol{' '}
                <span className="role">{panel.rol}</span>.
              </p>
              <p className="small">
                <b>El segundo factor todavía no está.</b> Va a ser por aplicación de autenticación,
                y va a ser obligatorio para el titular. Hasta entonces, lo único que separa esta
                cuenta de quien tenga tu contraseña es tu contraseña.
              </p>
              <p className="small faint">
                Dónde viven los datos, cómo se aíslan entre hogares y qué credenciales no te pedimos
                nunca está contado entero en <Link href="/seguridad">Seguridad</Link>. Los accesos
                de otras personas se gobiernan en <Link href="/accesos">Accesos</Link>.
              </p>
            </div>
          </section>
        </div>
      </div>
    </>
  )
}
