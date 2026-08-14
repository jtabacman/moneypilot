/**
 * De un feed de Plaid a un lote del libro.
 *
 * El recorrido —dedup, correcciones en su sitio, anulaciones, apertura contra
 * el saldo declarado, `persistImport`, informe de reconciliación— es el mismo
 * que el de finAPI y vive en `../feed/asentar.ts`. Acá está sólo lo que es de
 * Plaid, que son tres cosas y ninguna es cosmética.
 *
 * ── 1. El cursor manda sobre la forma del módulo ─────────────────────────────
 *
 * `/transactions/sync` es incremental y su cursor es **del item entero**, no de
 * una cuenta: una llamada devuelve los movimientos de las cinco cuentas
 * mezclados y avanza para todas a la vez. Eso decide la unidad de trabajo, y es
 * la única diferencia estructural con finAPI, que va cuenta por cuenta.
 *
 * Si se sincronizara una cuenta y se guardara el cursor, las otras cuatro
 * perderían todo lo que venía en esa lectura **para siempre**: el proveedor no
 * lo vuelve a mandar. Por eso acá la unidad es el item y todo va en una sola
 * transacción — o entran las cinco cuentas y el cursor, o no entra nada. Una
 * petición cortada a la mitad no deja medio lote escrito: deja cero.
 *
 * El error inverso es inofensivo y se prefiere siempre: un cursor que se queda
 * corto hace que la próxima sincronización repita lo ya traído, y eso lo
 * absorbe el dedup contándolo como duplicado.
 *
 * ── 2. Nada dice que ya estén todos los movimientos ──────────────────────────
 *
 * Ni `has_more: false`, ni el estado, ni un lote vacío. La medición está en
 * `EstadoDeActualizacion` (tipos.ts): un banco recién conectado entrega a
 * plazos, y **dos de cada cinco veces aparece un lote vacío con estado
 * HISTORICAL_UPDATE_COMPLETE y después llegan 32 movimientos más**. Quien pare
 * en el primer vacío se lleva 16 de 48, con un informe de reconciliación que
 * cuadra consigo mismo. Es el fallo que no da error.
 *
 * `leerDelItem` sondea hasta varios lotes vacíos seguidos. Cuántos depende de
 * si es la primera vez: ver `vaciosNecesarios`.
 *
 * En producción esto lo resuelve el webhook `SYNC_UPDATES_AVAILABLE`, que avisa
 * cuando hay algo nuevo. Sondear es lo que se hace mientras no lo haya.
 *
 * ── 3. Los pendientes no entran, y lo retirado se anula ──────────────────────
 *
 * El mapeador deja fuera los movimientos `pending` (ver su cabecera), así que
 * la inmensa mayoría de lo que llega en `removed` —autorizaciones que
 * caducaron o que asentaron con otro id— no corresponde a ningún asiento y no
 * hay nada que hacer. Cuando sí corresponde, se anula con un asiento espejo:
 * ver `anulacionesPendientes` en `../feed/asentar.ts`, donde está argumentado
 * por qué no se borra y por qué tampoco basta con avisar.
 */

import {
  type AccountKind,
  ensureLedgerAccount,
  type FeedConnectionRow,
  listFeedAccounts,
  markFeedAccountSynced,
  saveSyncCursor,
  type TenantClient,
} from '@moneypilot/db'
import { mapPlaidAccount, maskAccountNumber } from '@moneypilot/importers'
import { asentarExtracto, leerCuenta, type ResultadoDeCuenta } from '../feed/asentar'
import { SincronizacionError } from '../feed/errores'
import { aCuentaDelMapeador, aMovimientoDelMapeador } from './adaptar'
import { sincronizar, traerCuentas } from './client'
import { conexionConToken, LEGIBLE, PROVEEDOR } from './conexion'
import { type CuentaPlaid, hayHistoricoCompleto, loteVacio, type MovimientoPlaid } from './tipos'

export type { ResultadoDeCuenta } from '../feed/asentar'
export { SincronizacionError }

/** Una descarga inicial son varias vueltas contra su servidor. */
const TIMEOUT_MS = 60_000

/**
 * Cuántos lotes vacíos seguidos hacen falta para dar por terminada la lectura.
 *
 * **Tres la primera vez, uno después.** El lote vacío que aparece en medio y
 * engaña —dos de cada cinco conexiones, ver `EstadoDeActualizacion`— sólo
 * ocurre mientras Plaid entrega el histórico de un item recién conectado. Con
 * un cursor ya guardado ese histórico terminó hace rato, y exigir tres vueltas
 * ahí serían cuatro segundos y medio de espera en cada sincronización para no
 * enterarse de nada nuevo.
 *
 * Equivocarse por abajo pierde movimientos hasta la próxima sincronización;
 * equivocarse por arriba sólo cuesta tiempo. Por eso el caso dudoso —la
 * primera vez— usa el número grande.
 */
const VACIOS_PRIMERA_VEZ = 3
const VACIOS_INCREMENTAL = 1

/**
 * Un lote vacío sólo cuenta cuando Plaid ya terminó de su lado.
 *
 * Esto se aprendió cayendo en la trampa. Con sólo contar vacíos, la primera
 * sincronización de un item recién conectado se llevaba **cero movimientos**:
 * las tres primeras vueltas contestan vacío con estado `NOT_READY` o
 * `INITIAL_UPDATE_COMPLETE` —Plaid todavía está hablando con el banco— y los
 * datos aparecen en la cuarta. Tres vacíos seguidos, cursor guardado, informe
 * impecable de una cuenta sin un solo movimiento.
 *
 * Mientras el estado no sea `HISTORICAL_UPDATE_COMPLETE`, un lote vacío
 * significa "todavía no", no "ya está". Y al revés no alcanza: el estado por sí
 * solo tampoco sirve —dice que Plaid terminó de su lado, no que nos lo haya
 * entregado, y en la medición aparece un vacío con ese estado justo antes de 32
 * movimientos más—. Hacen falta las dos cosas: el estado **y** los vacíos
 * seguidos.
 *
 * En la lectura incremental no se exige, porque el histórico ya se entregó y el
 * item puede estar en cualquier estado por una actualización en curso.
 */
function cuentaComoFinal(estado: string, primeraVez: boolean): boolean {
  return !primeraVez || hayHistoricoCompleto(estado)
}

/** Entre vuelta y vuelta. Sondear más rápido no hace que Plaid termine antes. */
const ESPERA_MS = 1_500

/**
 * Tope de vueltas. No es un límite de datos: es el seguro contra un item que
 * nunca se queda quieto. Si se alcanza, lo leído hasta ahí se asienta y el
 * cursor queda guardado, así que la vuelta siguiente sigue donde ésta paró.
 */
const MAX_VUELTAS = 25

/* ── Leer del proveedor ───────────────────────────────────────────────────── */

export interface LecturaDelItem {
  /** Las cuentas del item, con su saldo del momento. */
  readonly cuentas: readonly CuentaPlaid[]
  /**
   * true si esa lista la dijo `/transactions/sync`, false si salió del
   * reemplazo `/accounts/get`.
   *
   * No es un detalle de procedencia: las dos listas **no significan lo mismo**.
   * Ver `cuentasAsentables`, que es donde importa.
   */
  readonly cuentasDeSync: boolean
  /**
   * `added` y `modified` fundidos por identificador, sin distinguirlos: los dos
   * son transacciones completas y quién es novedad y quién corrección lo decide
   * el dedup, que para eso tiene el veredicto 'updated'. Gana la última
   * versión que llegó, que es la que Plaid considera vigente.
   */
  readonly movimientos: readonly MovimientoPlaid[]
  /** Identificadores que Plaid retiró durante esta lectura. */
  readonly retirados: readonly string[]
  /** El cursor final. Sólo se guarda si todo lo de arriba llegó al libro. */
  readonly cursor: string
  /** Lo que fue diciendo el estado de actualización, en orden. */
  readonly estados: readonly string[]
  readonly vueltas: number
  /** true si se paró por el tope de vueltas y puede quedar algo sin traer. */
  readonly incompleta: boolean
}

export interface LeerOpciones {
  readonly timeoutMs?: number
  /** Sin esto se sondea de verdad. Los tests lo ponen en 0. */
  readonly esperaMs?: number
  /** Días de histórico en la carga inicial. Plaid admite 1..730. */
  readonly diasDeHistorico?: number
}

/**
 * Trae todo lo que el item tenga que contar desde el cursor guardado.
 *
 * **No toca la base**, y es deliberado: es la parte lenta —varias vueltas con
 * espera entre medias— y hacerla dentro de la transacción retendría una
 * conexión del pool durante todo el sondeo. Lo que devuelve se asienta después,
 * en una transacción corta, con `asentarLectura`.
 */
export async function leerDelItem(
  accessToken: string,
  cursorGuardado: string | null,
  opciones: LeerOpciones = {},
): Promise<LecturaDelItem> {
  const espera = opciones.esperaMs ?? ESPERA_MS
  const primeraVez = cursorGuardado === null || cursorGuardado.trim() === ''
  const necesarios = primeraVez ? VACIOS_PRIMERA_VEZ : VACIOS_INCREMENTAL

  // Por identificador y no por lista: un movimiento puede llegar en `added` en
  // una vuelta y corregido en `modified` en la siguiente, y meter los dos
  // duplicaría la fila dentro del mismo lote. Con el mapa, gana el último.
  const porId = new Map<string, MovimientoPlaid>()
  const retirados = new Set<string>()
  const estados: string[] = []
  let cuentas: readonly CuentaPlaid[] = []
  let cursor = cursorGuardado ?? ''
  let vacios = 0
  let vueltas = 0

  while (vueltas < MAX_VUELTAS) {
    vueltas += 1
    const lote = await sincronizar(accessToken, cursor === '' ? undefined : cursor, {
      timeoutMs: opciones.timeoutMs ?? TIMEOUT_MS,
      ...(opciones.diasDeHistorico === undefined
        ? {}
        : { diasDeHistorico: opciones.diasDeHistorico }),
    })

    estados.push(lote.estado)
    for (const movimiento of [...lote.added, ...lote.modified]) {
      porId.set(movimiento.transactionId, movimiento)
    }
    for (const quitado of lote.removed) {
      retirados.add(quitado.transactionId)
      // Retirado dentro de la misma lectura en la que llegó: no se asienta y
      // después se busca en el libro por si estaba de antes. Dejarlo en la
      // lista lo metería y lo anularía en el mismo lote, que es escribir dos
      // asientos para contar que no pasó nada.
      porId.delete(quitado.transactionId)
    }
    // Las cuentas vienen en cada página con el saldo del momento; la última es
    // la más reciente y es contra la que se concilia.
    if (lote.cuentas.length > 0) cuentas = lote.cuentas
    cursor = lote.cursor

    if (loteVacio(lote)) {
      // Ver `cuentaComoFinal`: un vacío con el item todavía `NOT_READY` no es
      // el final de nada, y contarlo se lleva cero movimientos y guarda el
      // cursor como si estuviera todo.
      if (cuentaComoFinal(lote.estado, primeraVez)) vacios += 1
      if (vacios >= necesarios) return cerrar(false)
    } else {
      vacios = 0
    }

    if (espera > 0) await dormir(espera)
  }

  return cerrar(true)

  async function cerrar(incompleta: boolean): Promise<LecturaDelItem> {
    // Las cuentas viajan dentro de cada página de `/transactions/sync`, y una
    // página sin movimientos las trae vacías —medido—, así que una lectura
    // incremental que no encontró nada nuevo se queda sin ellas. Se piden
    // aparte: sin cuentas no hay saldo declarado contra el que conciliar y la
    // cuenta del libro ni siquiera se podría crear la primera vez.
    //
    // Pero las dos listas no son la misma lista, y por eso se marca de dónde
    // salió cada una. Ver `cuentasAsentables`.
    const deSync = cuentas.length > 0
    return {
      cuentas: deSync
        ? cuentas
        : await traerCuentas(accessToken, { timeoutMs: opciones.timeoutMs ?? TIMEOUT_MS }),
      cuentasDeSync: deSync,
      movimientos: [...porId.values()],
      retirados: [...retirados],
      cursor,
      estados,
      vueltas,
      incompleta,
    }
  }
}

function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/* ── Preparar: una cuenta nuestra por cada cuenta de Plaid ────────────────── */

export interface CuentaDelFeed {
  /** El id de la cuenta EN Plaid. */
  readonly externalAccountId: string
  /** La cuenta de nuestro libro que la recibe. */
  readonly accountId: string
  readonly nombre: string
  readonly moneda: string
  readonly institucion: string | null
  /** El saldo que declara Plaid, como cadena decimal exacta y con SU signo. */
  readonly saldoDeclarado: string | null
  /** true si esta preparación acaba de crear la cuenta del libro. */
  readonly creada: boolean
}

/**
 * Asegura que cada cuenta del item tenga su cuenta en el libro.
 *
 * Idempotente: llamarla dos veces no crea nada la segunda vez, porque el enlace
 * de `feed_account` manda sobre el nombre y sobre todo lo demás.
 */
export async function prepararCuentas(
  client: TenantClient,
  conexion: FeedConnectionRow,
  cuentas: readonly CuentaPlaid[],
  paisDeLaEntidad: string | null = null,
): Promise<CuentaDelFeed[]> {
  const plan: CuentaDelFeed[] = []
  for (const cuenta of cuentas) {
    const moneda = monedaDe(cuenta)
    const resultado = await ensureLedgerAccount(client, {
      provider: PROVEEDOR,
      externalAccountId: cuenta.accountId,
      connectionId: conexion.id,
      name: nombreDe(cuenta),
      kind: claseDe(cuenta.type),
      currency: moneda,
      institution: conexion.bankName,
      // Plaid ya manda sólo los últimos dígitos, pero pasa igual por el mismo
      // enmascarador que todos los parsers: si una entidad devolviera algo más
      // largo de lo que promete, no cuela un número de cuenta entero.
      accountNumber: maskAccountNumber(cuenta.mask ?? undefined) ?? null,
      // Plaid no declara el país de LA CUENTA. Lo que sí dice es en qué países
      // opera la entidad, y de ahí sale esto — pero sólo cuando opera en uno.
      //
      // La distinción no es escrupulosidad: BBVA figura en España, Estados
      // Unidos y México, y poner 'ES' en una cuenta de BBVA México sería
      // inventar un dato que después se usa para agrupar patrimonio por país.
      // Con una sola jurisdicción no hay nada que adivinar; con varias, el
      // valor honesto es vacío. Ver `paisDeLaEntidad` en la ruta, que es quien
      // aplica esa regla.
      country: paisDeLaEntidad,
    })

    plan.push({
      externalAccountId: cuenta.accountId,
      accountId: resultado.accountId,
      nombre: resultado.name,
      moneda,
      institucion: conexion.bankName,
      saldoDeclarado: cuenta.saldoActual,
      creada: resultado.created,
    })
  }
  return plan
}

/**
 * Cuáles de las cuentas de la lectura pueden llegar a ser una cuenta del libro.
 *
 * Las dos listas de cuentas que devuelve Plaid **no significan lo mismo**, y
 * confundirlas es el fallo que se encontró probando dos sincronizaciones
 * seguidas contra su sandbox:
 *
 *  · `/transactions/sync` devuelve sólo las cuentas que cubre el producto
 *    `transactions` — las cinco que tienen movimientos, en el banco de prueba.
 *  · `/accounts/get` devuelve el item **entero**: doce, con el plan de
 *    pensiones, el 401k, la hipoteca y el préstamo de estudios dentro. A esas
 *    cuatro este feed no les va a entrar un movimiento nunca, porque no son de
 *    este producto.
 *
 * Como una página sin movimientos trae `accounts: []`, la lectura incremental
 * —la que no encuentra nada nuevo, o sea la normal— cae siempre al reemplazo.
 * Sin este filtro pasaba esto: la primera sincronización creaba cinco cuentas y
 * la **segunda añadía siete más, todas en 0,00 y para siempre**. El hogar veía
 * aparecer 'Plaid Mortgage' con saldo cero mientras el banco declara 56.302,06
 * adeudados, y qué cuentas existen dependía de por qué camino se había leído.
 * Ni un error, ni un aviso.
 *
 * Cuando la lista viene de `/transactions/sync` se acepta entera: ahí Plaid ya
 * dijo cuáles cubre. Cuando viene del reemplazo se aceptan sólo las que ya
 * están enlazadas de una sincronización anterior —refrescarles el saldo es
 * exactamente para lo que hace falta el reemplazo— y las que traen movimientos
 * en esta misma lectura, que no pueden quedar fuera sin que la comprobación de
 * huérfanos corte la sincronización entera.
 */
async function cuentasAsentables(
  client: TenantClient,
  lectura: LecturaDelItem,
): Promise<readonly CuentaPlaid[]> {
  if (lectura.cuentasDeSync) return lectura.cuentas

  const enlazadas = new Set(
    (await listFeedAccounts(client, PROVEEDOR)).map((fila) => fila.externalAccountId),
  )
  const conMovimiento = new Set(lectura.movimientos.map((movimiento) => movimiento.accountId))
  return lectura.cuentas.filter(
    (cuenta) => enlazadas.has(cuenta.accountId) || conMovimiento.has(cuenta.accountId),
  )
}

/**
 * La clase contable, desde el tipo que declara Plaid.
 *
 * Sólo se distingue lo que cambia el signo del patrimonio: una tarjeta y un
 * préstamo son deuda, todo lo demás es activo. Es también la misma frontera que
 * usa el mapeador para decidir si el saldo viene expresado como importe
 * adeudado en positivo, y por eso las dos listas tienen que decir lo mismo.
 */
function claseDe(tipo: string | null): AccountKind {
  const limpio = (tipo ?? '').trim().toLowerCase()
  return limpio === 'credit' || limpio === 'loan' ? 'liability' : 'asset'
}

/**
 * La moneda de la cuenta, resuelta igual que la resuelve el mapeador.
 *
 * Tienen que coincidir: si acá saliera EUR y allá USD, `asentarExtracto`
 * cortaría la sincronización por divisa distinta en cada vuelta y la cuenta
 * quedaría inservible sin que nadie entienda por qué.
 */
function monedaDe(cuenta: CuentaPlaid): string {
  const declarada = cuenta.isoCurrencyCode ?? cuenta.unofficialCurrencyCode
  return (declarada ?? 'EUR').trim().toUpperCase()
}

/**
 * El nombre de la cuenta, **sin el banco delante**.
 *
 * El banco va en `account.institution`, que es una columna, y es de ahí de
 * donde lo saca quien lo necesite: /cuentas agrupa por ella y el selector de
 * importación la antepone. Meterlo también dentro del nombre producía la
 * etiqueta que se vio en pantalla —«BBVA · Banca Personal · BBVA · Banca
 * Personal · Cuenta Corriente 4444»—, y no por un fallo del selector: dos
 * sitios guardaban el mismo dato y el que lo componía no tenía forma de saber
 * que ya venía dentro.
 *
 * Los últimos dígitos sí se quedan pegados, y no es lo mismo: distinguen dos
 * cuentas corrientes del mismo banco, que si no se llamarían igual y acabarían
 * desambiguadas por `freeAccountName` con el id de Plaid a cuestas.
 *
 * Ojo con lo que esto **no** hace: las cuentas creadas antes conservan su
 * nombre largo, porque el enlace con el proveedor es por
 * `external_account_id` y `ensureLedgerAccount` ni mira el nombre cuando ya
 * existe. Es deliberado —renombrarle al cliente una cuenta que ya usa es peor
 * que la redundancia— y el sitio donde se arregla es la pantalla de cuentas el
 * día que se pueda renombrar a mano.
 */
function nombreDe(cuenta: CuentaPlaid): string {
  const propio = (cuenta.name ?? cuenta.officialName ?? '').trim()
  const base = propio === '' ? `Cuenta ${cuenta.accountId}` : propio
  const mask = (cuenta.mask ?? '').trim()
  return `${base}${mask === '' ? '' : ` ${mask}`}`
}

/* ── Asentar lo leído ─────────────────────────────────────────────────────── */

export interface ResultadoDelItem {
  readonly conexionId: string
  readonly banco: string
  readonly cuentas: readonly ResultadoDeCuenta[]
  /** El cursor quedó guardado: la próxima sincronización trae sólo lo nuevo. */
  readonly cursorGuardado: boolean
  /** Lo que fue diciendo Plaid del estado de la descarga inicial. */
  readonly estados: readonly string[]
  /** true si Plaid todavía no había terminado de entregar el histórico. */
  readonly historicoCompleto: boolean
  readonly incompleta: boolean
}

export interface AsentarLecturaInput {
  readonly connectionId: string
  readonly lectura: LecturaDelItem
  /**
   * El día al que corresponde el saldo. Lo pone quien llama porque es el único
   * que sabe cuándo preguntó, y porque el mapeador no mira el reloj: si lo
   * mirara, dos ejecuciones sobre el mismo lote darían informes distintos.
   */
  readonly balanceAsOf: string
  /**
   * El país de la entidad, si opera en uno solo. Lo resuelve quien llama, en
   * la fase de red: pedirle la ficha a Plaid desde acá sería una llamada HTTP
   * con la transacción abierta, que es justo lo que este módulo evita.
   */
  readonly paisDeLaEntidad?: string | null
  /**
   * El instante en que se preguntó, en ISO 8601 con hora.
   *
   * Es el respaldo del saldo del proveedor cuando la entidad no declara el
   * suyo. Lo pone quien llama por el mismo motivo que `balanceAsOf`: este
   * módulo no mira el reloj, y si lo mirara dos ejecuciones sobre el mismo lote
   * darían resultados distintos.
   */
  readonly observadoEn?: string | undefined
}

/**
 * Escribe en el libro lo que trajo `leerDelItem`, y recién entonces guarda el
 * cursor.
 *
 * Todo esto corre dentro de UNA transacción —la que abre quien llama— y ahí
 * está la garantía entera: el cursor avanza en el mismo `commit` que asienta
 * los movimientos que deja atrás. No hay ninguna ventana en la que el cursor
 * esté adelantado y los movimientos no estén escritos.
 */
export async function asentarLectura(
  client: TenantClient,
  input: AsentarLecturaInput,
): Promise<ResultadoDelItem> {
  const { conexion } = await conexionConToken(client, input.connectionId)
  const { lectura } = input

  const plan = await prepararCuentas(
    client,
    conexion,
    await cuentasAsentables(client, lectura),
    input.paisDeLaEntidad ?? null,
  )
  const conocidas = new Set(plan.map((cuenta) => cuenta.externalAccountId))

  // Un movimiento de una cuenta que no vino en la lectura no se puede asentar
  // contra nada, y tirarlo callado sería perder plata sin dejar rastro. Es un
  // fallo nuestro —se leyeron movimientos sin leer sus cuentas—, no un dato
  // dudoso: se corta antes de escribir nada. Es la misma decisión que toma
  // `mapPlaidStatements` con los huérfanos.
  const huerfanos = lectura.movimientos.filter((movimiento) => !conocidas.has(movimiento.accountId))
  if (huerfanos.length > 0) {
    throw new SincronizacionError(
      `${huerfanos.length} movimiento(s) de Plaid pertenecen a cuentas que no vinieron en la ` +
        `lectura (por ejemplo el ${huerfanos[0]?.transactionId}). No se asienta nada: la ` +
        'sincronización tiene que leer las cuentas y los movimientos de la misma vez.',
    )
  }

  const resultados: ResultadoDeCuenta[] = []
  for (const cuenta of plan) {
    const cruda = lectura.cuentas.find((fila) => fila.accountId === cuenta.externalAccountId)
    if (cruda === undefined) continue

    const nuestra = await leerCuenta(client, cuenta.accountId)
    const statement = mapPlaidAccount(
      aCuentaDelMapeador(cruda, { institucion: conexion.bankName }),
      lectura.movimientos
        .filter((movimiento) => movimiento.accountId === cuenta.externalAccountId)
        .map(aMovimientoDelMapeador),
      { fallbackCurrency: nuestra.currency, balanceAsOf: input.balanceAsOf },
    )

    // El instante del saldo. Se prefiere el que declara la entidad —«el banco
    // dijo esto a las 14:03»— y se cae al nuestro —«lo leímos a las 14:03»—,
    // que es más flojo y por eso viaja etiquetado como tal.
    const declarado = instanteDeclarado(cruda)
    const observadoEn = declarado ?? input.observadoEn
    const saldoDelProveedor =
      observadoEn === undefined
        ? undefined
        : {
            observadoEn,
            origen: (declarado === undefined ? 'lectura' : 'proveedor') as 'proveedor' | 'lectura',
          }

    const resultado = await asentarExtracto(client, {
      provider: PROVEEDOR,
      proveedorLegible: LEGIBLE,
      externalAccountId: cuenta.externalAccountId,
      accountId: cuenta.accountId,
      statement,
      format: 'plaid',
      // Plaid manda `personal_finance_category` en cada movimiento y el
      // mapeador la guarda en el `raw`. Declararlo acá es lo que permite que la
      // capa del proveedor la traduzca: sin esto, la etiqueta viaja hasta el
      // libro y no la lee nadie.
      enriquecidoPor: PROVEEDOR,
      fileName: nombreDelLote(nuestra.name, cuenta.externalAccountId, cuenta.institucion),
      // La lista entera a cada cuenta: `removed` no dice de qué cuenta era cada
      // identificador —Plaid lo documenta como opcional y suele venir vacío— y
      // la búsqueda es por cuenta, así que cada una encuentra sólo lo suyo.
      retirados: lectura.retirados,
      ...(saldoDelProveedor === undefined ? {} : { saldoDelProveedor }),
    })

    resultados.push(resultado)
    await markFeedAccountSynced(client, PROVEEDOR, cuenta.externalAccountId)
  }

  // El cursor, al final y sólo acá. Ver la cabecera del módulo.
  await saveSyncCursor(client, { id: conexion.id, cursor: lectura.cursor })

  return {
    conexionId: conexion.id,
    banco: conexion.bankName,
    cuentas: resultados,
    cursorGuardado: true,
    estados: lectura.estados,
    historicoCompleto: lectura.estados.some(hayHistoricoCompleto),
    incompleta: lectura.incompleta,
  }
}

/**
 * El nombre con el que el lote aparece en el historial.
 *
 * La columna dice "Origen" y no "Fichero" justamente por esto: acá no hubo
 * ningún fichero, y escribir uno inventado haría que alguien lo buscara en su
 * disco dentro de seis meses.
 */
/**
 * El instante que declara la entidad, si lo declara.
 *
 * Vive en el `crudo` porque `CuentaPlaid` no lo expone: el mapeador lo trunca a
 * día para `StatementBalance.on`, que es un `PlainDate`, y ese truncado es
 * justamente lo que no sirve para distinguir dos lecturas del mismo día.
 */
function instanteDeclarado(cuenta: CuentaPlaid): string | undefined {
  const valor = cuenta.crudo['balances.last_updated_datetime']
  if (typeof valor !== 'string' || valor.trim() === '') return undefined
  // Que sea una fecha de verdad se comprueba acá y no en la base: un
  // `timestamptz` inválido abortaría la transacción entera de la
  // sincronización por un dato descriptivo.
  return Number.isNaN(Date.parse(valor)) ? undefined : valor
}

function nombreDelLote(
  nombreDeCuenta: string,
  externalAccountId: string,
  banco: string | null,
): string {
  // Acá el banco SÍ va delante, y no se contradice con `nombreDe`: esto es la
  // etiqueta de un lote en el historial de importaciones, que se lee sola y
  // fuera de cualquier agrupación por institución. «Plaid · Cuenta Corriente
  // 4444» no dice de qué banco, y el historial es justo donde importa.
  //
  // Los ocho primeros caracteres del id de Plaid alcanzan para distinguir dos
  // cuentas y no llenan la columna con cuarenta caracteres de ruido.
  const entidad = banco === null || banco.trim() === '' ? '' : `${banco} · `
  return `Plaid · ${entidad}${nombreDeCuenta} (cuenta ${externalAccountId.slice(0, 8)})`
}
