import { type AccountBalance, accountBalances } from '@moneypilot/db'
import Link from 'next/link'
import { readHousehold } from '@/lib/data'
import { formatDate } from '@/lib/format'
import { navItem } from '@/lib/nav'
import { NoData } from '../empty-state'
import { Money, PageBar, ReconStatus } from '../ui'
import styles from './page.module.css'

export const dynamic = 'force-dynamic'

const ITEM = navItem('/cuentas')

const KIND_LABEL: Readonly<Record<AccountBalance['kind'], string>> = {
  asset: 'activo',
  liability: 'pasivo',
  income: 'ingreso',
  expense: 'gasto',
  equity: 'patrimonio',
  trading: 'cambio',
}

export default async function CuentasPage() {
  const { data: cuentas } = await readHousehold(async (client) => accountBalances(client))

  const activos = cuentas.filter((cuenta) => cuenta.kind === 'asset')
  const pasivos = cuentas.filter((cuenta) => cuenta.kind === 'liability')
  const sistema = cuentas.filter((cuenta) => cuenta.kind === 'equity' || cuenta.kind === 'trading')
  // Gasto e ingreso son cuentas en el libro, pero para el usuario son el árbol
  // de categorías: listarlas acá junto a su banco confundiría dos cosas que no
  // se parecen. Se dice en el pie, no se esconde.
  const categorias = cuentas.filter(
    (cuenta) => cuenta.kind === 'income' || cuenta.kind === 'expense',
  )

  const movimientos = cuentas.reduce((total, cuenta) => total + cuenta.movements, 0)
  const corruptas = cuentas.filter((cuenta) => cuenta.foreignPostings > 0)

  return (
    <>
      <PageBar
        title={ITEM?.label ?? 'Cuentas'}
        blurb={ITEM?.blurb ?? 'Bancos, tarjetas y efectivo, con su moneda y su país.'}
        tools={
          <Link href="/movimientos" className="btn">
            Ver movimientos
          </Link>
        }
      />

      <div className="page">
        {movimientos === 0 ? (
          <NoData what="tus cuentas con su saldo y su reconciliación" />
        ) : (
          <>
            {corruptas.length > 0 && <PostingsExtranjeros cuentas={corruptas} />}

            <Seccion
              titulo="Activos"
              descripcion="Lo que tenés: cuentas corrientes, ahorro y efectivo."
              cuentas={activos}
            />

            <Seccion
              titulo="Pasivos"
              descripcion="Lo que debés: tarjetas y préstamos. El saldo va en negativo porque es deuda."
              cuentas={pasivos}
            />

            <Sistema cuentas={sistema} categorias={categorias.length} />
          </>
        )}
      </div>
    </>
  )
}

/* ── Aviso de datos corruptos ────────────────────────────────────────────── */

/**
 * `foreignPostings` mayor que cero no es una diferencia de cambio: el esquema
 * da por sentado que una cuenta tiene UNA moneda, así que un posting en otra
 * es un dato que no debería existir. Y como esos postings no entran en la
 * suma, el saldo que se muestra abajo es menor que el real. Un saldo
 * incompleto que no lo dice es exactamente el fallo que este producto existe
 * para no cometer.
 */
function PostingsExtranjeros({ cuentas }: { cuentas: readonly AccountBalance[] }) {
  const total = cuentas.reduce((suma, cuenta) => suma + cuenta.foreignPostings, 0)

  return (
    <div className="error">
      <b>
        Saldo incompleto en {cuentas.length} {cuentas.length === 1 ? 'cuenta' : 'cuentas'}.
      </b>{' '}
      Hay {total} {total === 1 ? 'movimiento anotado' : 'movimientos anotados'} en una moneda
      distinta a la de su cuenta, y por eso <b>no están sumados en el saldo</b>. Una cuenta tiene
      una sola moneda: esto no es un cambio de divisa, es un dato corrupto que hay que corregir en
      el origen.
      <ul style={{ marginTop: 'var(--s2)' }}>
        {cuentas.map((cuenta) => (
          <li key={cuenta.id}>
            <Link href={`/movimientos?cuenta=${cuenta.id}`}>{cuenta.name}</Link> ({cuenta.currency})
            — {cuenta.foreignPostings} fuera de la suma
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ── Sección de cuentas, agrupada por institución ────────────────────────── */

interface Grupo {
  readonly institution: string
  readonly cuentas: readonly AccountBalance[]
}

/** El efectivo no tiene banco, y meterlo en un grupo "sin institución" lo trata como un dato que falta. */
const SIN_INSTITUCION = 'Efectivo y otras'

function agruparPorInstitucion(cuentas: readonly AccountBalance[]): Grupo[] {
  const grupos = new Map<string, AccountBalance[]>()
  for (const cuenta of cuentas) {
    const clave = cuenta.institution ?? SIN_INSTITUCION
    const actual = grupos.get(clave)
    if (actual === undefined) grupos.set(clave, [cuenta])
    else actual.push(cuenta)
  }
  return [...grupos.entries()]
    .map(([institution, lista]) => ({ institution, cuentas: lista }))
    .sort((a, b) => {
      if (a.institution === SIN_INSTITUCION) return 1
      if (b.institution === SIN_INSTITUCION) return -1
      return a.institution.localeCompare(b.institution, 'es')
    })
}

interface Subtotal {
  readonly currency: string
  readonly total: bigint
  readonly cuentas: number
}

function sumarPorMoneda(cuentas: readonly AccountBalance[]): Subtotal[] {
  const carriles = new Map<string, { total: bigint; cuentas: number }>()
  for (const cuenta of cuentas) {
    const actual = carriles.get(cuenta.currency) ?? { total: 0n, cuentas: 0 }
    carriles.set(cuenta.currency, {
      total: actual.total + cuenta.balance,
      cuentas: actual.cuentas + 1,
    })
  }
  return [...carriles.entries()]
    .map(([currency, carril]) => ({ currency, ...carril }))
    .sort((a, b) => a.currency.localeCompare(b.currency))
}

function Seccion({
  titulo,
  descripcion,
  cuentas,
}: {
  titulo: string
  descripcion: string
  cuentas: readonly AccountBalance[]
}) {
  const grupos = agruparPorInstitucion(cuentas)
  const subtotales = sumarPorMoneda(cuentas)

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{titulo}</h2>
          <p className="small faint">{descripcion}</p>
        </div>
        <small>
          {cuentas.length} {cuentas.length === 1 ? 'cuenta' : 'cuentas'} · {grupos.length}{' '}
          {grupos.length === 1 ? 'institución' : 'instituciones'}
        </small>
      </div>

      {cuentas.length === 0 ? (
        <div className="panel-body">
          <p className="small faint">Ninguna cuenta de este tipo en el hogar.</p>
        </div>
      ) : (
        <>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Cuenta</th>
                  <th>Tipo</th>
                  <th>Moneda</th>
                  <th>País</th>
                  <th className="r">Saldo</th>
                  <th className="r">Declarado por el banco</th>
                  <th className="r">Delta</th>
                  <th>Reconciliación</th>
                  <th className="r">Mov.</th>
                  <th className="r">Último</th>
                </tr>
              </thead>
              {grupos.map((grupo) => (
                <tbody key={grupo.institution}>
                  <tr className={styles.group}>
                    <th colSpan={10}>
                      {grupo.institution}
                      <span className={styles.groupCount}>
                        {grupo.cuentas.length} {grupo.cuentas.length === 1 ? 'cuenta' : 'cuentas'}
                      </span>
                    </th>
                  </tr>
                  {grupo.cuentas.map((cuenta) => (
                    <Fila key={cuenta.id} cuenta={cuenta} />
                  ))}
                </tbody>
              ))}
            </table>
          </div>

          <div className="panel-foot">
            <div className={styles.totals}>
              {subtotales.map((subtotal) => (
                <span key={subtotal.currency}>
                  <b>{subtotal.currency}</b>
                  <Money amount={subtotal.total} currency={subtotal.currency} symbol={false} />
                </span>
              ))}
            </div>
            Un carril por moneda y sin consolidar: sumar euros y dólares da un número que no es
            dinero de nada. El saldo es la suma de todos los movimientos cargados de la cuenta, en
            su propia moneda.
          </div>
        </>
      )}
    </section>
  )
}

function Fila({ cuenta }: { cuenta: AccountBalance }) {
  const incompleta = cuenta.foreignPostings > 0

  return (
    <tr>
      <td>
        <Link href={`/movimientos?cuenta=${cuenta.id}`}>{cuenta.name}</Link>
        {cuenta.closedAt !== null && (
          <span className={styles.closed}>
            <span className="status none">cerrada el {formatDate(cuenta.closedAt)}</span>
          </span>
        )}
      </td>
      <td className="small faint">{KIND_LABEL[cuenta.kind]}</td>
      <td className="num">{cuenta.currency}</td>
      <td className="num faint">{cuenta.country ?? '—'}</td>
      <td className="r">
        <Money amount={cuenta.balance} currency={cuenta.currency} symbol={false} />
      </td>
      <td className="r">
        {cuenta.declared === null ? (
          <span className="faint">—</span>
        ) : (
          <>
            <Money amount={cuenta.declared} currency={cuenta.currency} symbol={false} />
            {cuenta.declaredOn !== null && (
              // El año va en el title y no en la celda: en una historia de dos
              // años "13 ago" es ambiguo, pero la columna no aguanta la fecha
              // larga sin empujar al resto fuera de la pantalla.
              <div className="small faint" title={formatDate(cuenta.declaredOn, 'long')}>
                {formatDate(cuenta.declaredOn)}
              </div>
            )}
          </>
        )}
      </td>
      <td className="r">
        {cuenta.delta === null ? (
          <span className="faint">—</span>
        ) : (
          <Money amount={cuenta.delta} currency={cuenta.currency} symbol={false} />
        )}
      </td>
      <td>
        {incompleta ? (
          <span className="status bad" title="Hay movimientos en otra moneda fuera de la suma.">
            incompleto
          </span>
        ) : (
          <ReconStatus
            status={
              cuenta.delta === null ? 'sin-declarar' : cuenta.delta === 0n ? 'cuadra' : 'delta'
            }
          />
        )}
      </td>
      <td className="r num">{cuenta.movements}</td>
      <td className="r">
        {cuenta.lastMovementOn === null ? (
          <span className="faint">—</span>
        ) : (
          <span title={formatDate(cuenta.lastMovementOn, 'long')}>
            {formatDate(cuenta.lastMovementOn)}
          </span>
        )}
      </td>
    </tr>
  )
}

/* ── Cuentas de sistema ──────────────────────────────────────────────────── */

/**
 * Plegadas y con explicación, no escondidas.
 *
 * Alguien que abre esta página y lee "Cambio de moneda USD" con saldo negativo
 * piensa que hay un error en su dinero. No lo hay: son las cuentas que hacen
 * que la partida doble cierre. Pero eso hay que decirlo en la propia pantalla,
 * porque el usuario no tiene por qué saber contabilidad.
 */
function Sistema({
  cuentas,
  categorias,
}: {
  cuentas: readonly AccountBalance[]
  categorias: number
}) {
  return (
    <section className="panel">
      <details className={styles.system}>
        <summary>
          <b>Cuentas de sistema</b>{' '}
          <span className="small faint">
            — {cuentas.length}. No existen en ningún banco y no son plata tuya.
          </span>
        </summary>

        <p className={styles.why}>
          Están para que cada asiento cierre. <b>Saldo de apertura</b> guarda de dónde partía cada
          cuenta el día que entró al sistema, y <b>Cambio de moneda</b> recoge las dos patas de una
          operación entre monedas para que la diferencia quede anotada en vez de desaparecer en un
          redondeo. Su saldo no se suma al tuyo.
        </p>

        {cuentas.length > 0 && (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Cuenta</th>
                  <th>Tipo</th>
                  <th>Moneda</th>
                  <th className="r">Saldo</th>
                  <th className="r">Mov.</th>
                  <th className="r">Último</th>
                </tr>
              </thead>
              <tbody>
                {cuentas.map((cuenta) => (
                  <tr key={cuenta.id}>
                    <td>
                      <Link href={`/movimientos?cuenta=${cuenta.id}`}>{cuenta.name}</Link>
                    </td>
                    <td className="small faint">{KIND_LABEL[cuenta.kind]}</td>
                    <td className="num">{cuenta.currency}</td>
                    <td className="r">
                      <Money amount={cuenta.balance} currency={cuenta.currency} symbol={false} />
                    </td>
                    <td className="r num">{cuenta.movements}</td>
                    <td className="r">
                      {cuenta.lastMovementOn === null ? (
                        <span className="faint">—</span>
                      ) : (
                        <span title={formatDate(cuenta.lastMovementOn, 'long')}>
                          {formatDate(cuenta.lastMovementOn)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>

      <div className="panel-foot">
        Las cuentas de <b>gasto</b> e <b>ingreso</b> —{categorias} en este hogar— tampoco están en
        esta página: son el árbol de categorías, y se ven junto al gasto que explican.
      </div>
    </section>
  )
}
