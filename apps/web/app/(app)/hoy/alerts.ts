/**
 * Las tres alertas de la portada.
 *
 * Salen de datos que ya están en la pantalla —cuentas que no cuadran contra el
 * extracto, obligaciones que cambiaron y la cola de revisión— y no de una tabla
 * de avisos aparte. Una alerta que no se puede recalcular mirando el resto de
 * la página es una alerta que el usuario no puede comprobar.
 *
 * Tres es el tope y es deliberado: la lista de avisos que crece sin límite es
 * la lista que nadie lee. Lo que no entra no desaparece, está en el widget que
 * le corresponde más abajo.
 */

import type { AccountBalance, RecurringRow, ReviewRow } from '@moneypilot/db'
import { formatDate } from '@/lib/format'

export const MAX_ALERTAS = 3

/**
 * Cuánto de la comprobación contra el extracto se pudo hacer de verdad.
 *
 * Sin esto el panel miente por omisión. Una cuenta cuyo banco nunca declaró
 * saldo tiene `delta === null` y por lo tanto **no genera alerta**, igual que
 * una que cuadra al céntimo: las dos salen del bucle sin decir nada, y el
 * estado vacío las cuenta a todas como conformes. Es exactamente el error que
 * el repositorio se niega a cometer —"nunca 'cuadra': no cuadra nada que no se
 * haya comprobado"— reintroducido en la vista.
 *
 * Lo mismo con `foreignPostings`: si a una cuenta le faltan postings en el
 * saldo por estar anotados en otra moneda, su delta no es la diferencia contra
 * el banco, es la diferencia contra un saldo incompleto. Un cero ahí no
 * prueba nada.
 */
export interface Comprobacion {
  readonly total: number
  /** Cuentas con algo contra qué comparar y saldo completo. */
  readonly comprobadas: number
  /**
   * De ésas, cuántas se comprobaron **sólo** contra el saldo que leyó el
   * agregador y no contra un extracto.
   *
   * Se cuenta aparte porque no son la misma prueba. Un extracto es un documento
   * que el banco firma con fecha de cierre; una lectura de un agregador es lo
   * que había en un instante, y puede traer pendientes contados de otra manera.
   * Las dos valen; decir que son lo mismo sería el tipo de simplificación que
   * después no se puede defender delante de un contador.
   */
  readonly comprobadasPorFeed: number
  /** Nada declaró un saldo contra el que comparar: ni extracto ni agregador. */
  readonly sinDeclarar: number
  /** Su saldo deja postings fuera, así que el delta no es comparable. */
  readonly incompletas: number
}

export function comprobacion(cuentas: readonly AccountBalance[]): Comprobacion {
  let sinDeclarar = 0
  let incompletas = 0
  let comprobadasPorFeed = 0
  for (const cuenta of cuentas) {
    if (cuenta.foreignPostings > 0) incompletas += 1
    else if (cuenta.delta !== null) continue
    else if (cuenta.providerDelta !== null) comprobadasPorFeed += 1
    else sinDeclarar += 1
  }
  return {
    total: cuentas.length,
    comprobadas: cuentas.length - sinDeclarar - incompletas,
    comprobadasPorFeed,
    sinDeclarar,
    incompletas,
  }
}

export type ClaseAlerta = 'descuadre' | 'cese' | 'subida' | 'revision'

/**
 * A dónde se va a resolver. Se devuelve como dato y no como href armado para
 * que sea el componente quien construya el enlace: los filtros de /movimientos
 * viajan como objeto para que Next codifique acentos y espacios del comercio.
 */
export type Destino =
  | { readonly tipo: 'cuenta'; readonly cuentaId: string }
  | {
      readonly tipo: 'serie'
      readonly cuentaId: string
      readonly texto: string
      readonly desde: string
    }
  | { readonly tipo: 'revisar' }

export interface Alerta {
  readonly clave: string
  readonly clase: ClaseAlerta
  readonly etiqueta: string
  readonly tono: 'bad' | 'warn'
  readonly titulo: string
  readonly detalle: string
  /** Siempre en positivo: es una magnitud, no un saldo. */
  readonly importe: bigint | null
  readonly moneda: string | null
  readonly destino: Destino
  readonly accion: string
}

function absoluto(valor: bigint): bigint {
  return valor < 0n ? -valor : valor
}

export interface EntradaAlertas {
  readonly cuentas: readonly AccountBalance[]
  readonly recurrentes: readonly RecurringRow[]
  readonly pendientes: readonly ReviewRow[]
  /** 'YYYY-MM-DD'. Desde cuándo miran los enlaces a /movimientos. */
  readonly desde: string
  /** La lectura de la cola llegó a su tope: `pendientes.length` es un piso. */
  readonly colaTruncada: boolean
}

export function alertas(entrada: EntradaAlertas): Alerta[] {
  const candidatas: Alerta[] = []

  for (const cuenta of entrada.cuentas) {
    // El descuadre puede venir de cualquiera de las dos comprobaciones. Mirar
    // sólo `delta` dejaba a las cuentas de agregador **sin alerta nunca**, que
    // es peor que no comprobarlas: la pantalla las daba por buenas.
    const descuadre = cuenta.delta ?? cuenta.providerDelta
    if (descuadre === null || descuadre === 0n) continue
    candidatas.push({
      clave: `descuadre:${cuenta.id}`,
      clase: 'descuadre',
      etiqueta: 'no cuadra',
      tono: 'bad',
      titulo:
        cuenta.delta === null
          ? `${cuenta.name} no cuadra con el saldo del banco`
          : `${cuenta.name} no cuadra con el extracto`,
      detalle:
        (cuenta.delta === null
          ? `El saldo calculado se aparta del que ${cuenta.providerName ?? 'el agregador'} leyó del banco${cuenta.providerBalanceAt === null ? '' : ` el ${formatDate(cuenta.providerBalanceAt.slice(0, 10), 'long')}`}. O falta un movimiento en el libro, o sobra uno.`
          : cuenta.declaredOn === null
            ? 'El saldo calculado se aparta del último saldo que declaró el banco.'
            : `El saldo calculado se aparta del que declaró el banco el ${formatDate(cuenta.declaredOn, 'long')}. O falta un movimiento en el libro, o sobra uno.`) +
        // Un delta calculado sobre un saldo al que le faltan postings no es la
        // diferencia contra el banco: es un número más chico o más grande por
        // una razón que no tiene nada que ver con el extracto.
        (cuenta.foreignPostings > 0
          ? ` Ojo: ${cuenta.foreignPostings} ${cuenta.foreignPostings === 1 ? 'movimiento está anotado' : 'movimientos están anotados'} en otra moneda y no entran en el saldo calculado, así que esta diferencia no es comparable con el extracto hasta que se corrija en el origen.`
          : ''),
      importe: absoluto(descuadre),
      moneda: cuenta.currency,
      destino: { tipo: 'cuenta', cuentaId: cuenta.id },
      accion: 'Abrir la cuenta',
    })
  }

  for (const serie of entrada.recurrentes) {
    // Con dos ocurrencias no hay serie: avisar de que "dejó de cobrarse" algo
    // que se cobró dos veces es el falso positivo que entrena a ignorar el
    // panel entero.
    if (serie.confidence !== 'confirmado') continue

    if (serie.state === 'no-cobro') {
      candidatas.push({
        clave: `cese:${serie.merchant}:${serie.accountId}:${serie.currency}`,
        clase: 'cese',
        etiqueta: 'dejó de cobrarse',
        tono: 'warn',
        titulo: `${serie.merchant} dejó de cobrarse`,
        detalle: `Se cobraba cada ${serie.frequencyDays} días en ${serie.accountName}. El último cargo fue el ${formatDate(serie.lastOn, 'long')} y el siguiente se esperaba el ${formatDate(serie.nextExpectedOn, 'long')}.`,
        importe: absoluto(serie.median),
        moneda: serie.currency,
        destino: {
          tipo: 'serie',
          cuentaId: serie.accountId,
          texto: serie.merchant,
          desde: entrada.desde,
        },
        accion: 'Ver la serie',
      })
      continue
    }

    if (serie.state === 'subio') {
      candidatas.push({
        clave: `subida:${serie.merchant}:${serie.accountId}:${serie.currency}`,
        clase: 'subida',
        etiqueta: 'subió de precio',
        tono: 'warn',
        titulo: `${serie.merchant} subió de precio`,
        detalle: `Venía siendo un importe fijo y el cargo del ${formatDate(serie.lastOn, 'long')} en ${serie.accountName} se apartó de la mediana de las veces anteriores.`,
        importe: absoluto(serie.current - serie.median),
        moneda: serie.currency,
        destino: {
          tipo: 'serie',
          cuentaId: serie.accountId,
          texto: serie.merchant,
          desde: entrada.desde,
        },
        accion: 'Ver la serie',
      })
    }
  }

  if (entrada.pendientes.length > 0) {
    // El importe que se muestra es el del pendiente más grande, no una suma:
    // sumar movimientos en monedas distintas daría un número que no es dinero
    // de nada.
    const mayor = entrada.pendientes.reduce<ReviewRow | null>((peor, fila) => {
      const suyo = fila.amount
      if (suyo === null) return peor
      const actual = peor === null ? null : peor.amount
      if (actual === null) return fila
      return absoluto(suyo) > absoluto(actual) ? fila : peor
    }, null)

    candidatas.push({
      clave: 'revision',
      clase: 'revision',
      etiqueta: 'tu criterio',
      tono: 'warn',
      titulo: `${entrada.colaTruncada ? `Más de ${entrada.pendientes.length}` : entrada.pendientes.length} ${entrada.pendientes.length === 1 ? 'movimiento necesita' : 'movimientos necesitan'} tu criterio`,
      detalle:
        'El motor los encontró dudosos y no quiso decidir solo. Hasta que los resuelvas, siguen contando tal como entraron.',
      importe: mayor === null || mayor.amount === null ? null : absoluto(mayor.amount),
      moneda: mayor === null ? null : mayor.currency,
      destino: { tipo: 'revisar' },
      accion: 'Abrir la cola',
    })
  }

  return candidatas.sort(comparar).slice(0, MAX_ALERTAS)
}

/**
 * Orden: primero los descuadres, después por importe.
 *
 * El descuadre va antes aunque sea de cuatro euros porque no dice "gastaste
 * de más": dice que el libro y el banco no coinciden, y de eso depende
 * cualquier otro número de la pantalla. Compararlo por importe contra una
 * hipoteca lo enterraría siempre.
 *
 * El resto se ordena por magnitud en unidades mínimas, mezclando monedas. Es
 * un orden, no una suma: nunca se muestra el resultado como un total, y para
 * decidir cuál de tres avisos va arriba es suficiente.
 */
function comparar(a: Alerta, b: Alerta): number {
  const rango = (alerta: Alerta) => (alerta.clase === 'descuadre' ? 0 : 1)
  if (rango(a) !== rango(b)) return rango(a) - rango(b)
  const magnitud = (alerta: Alerta) => alerta.importe ?? 0n
  if (magnitud(a) === magnitud(b)) return a.clave.localeCompare(b.clave)
  return magnitud(a) > magnitud(b) ? -1 : 1
}
