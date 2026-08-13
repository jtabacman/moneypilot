/**
 * El único sitio del proyecto que habla con Plaid por la red.
 *
 * Todo lo demás —el mapeador, el pipeline, la pantalla— trabaja sobre lo que
 * este módulo devuelve. Esa frontera es el motivo de que exista: si mañana
 * cambia el agregador, se reescribe este fichero y el resto no se entera. Es el
 * mismo recorrido que hacía el cliente del primer proveedor que se probó
 * debajo.
 *
 * Tres reglas gobiernan lo que hay acá dentro:
 *
 * 1. **Ningún importe pasa por coma flotante.** Ver `../json-exacto`. Los
 *    cuerpos se leen como texto y se deserializan con todos los números
 *    convertidos en cadena; los que escribimos nosotros se serializan con
 *    `serializarConDecimalesExactos`. `Number()` sólo aparece en `enteroSeguro`
 *    y sólo para totales de catálogo.
 *
 * 2. **Esto es una fuente de entrada, no el libro.** Este cliente lee y ya. No
 *    guarda nada, no deduplica, no decide el signo ni la fecha canónica. Los
 *    movimientos que devuelve acaban en `persistImport` por el mismo camino que
 *    un OFX.
 *
 * 3. **Un lote a medias no sale de acá.** `/transactions/sync` pagina, y
 *    quedarse en la primera página no da error en ningún sitio: da un informe
 *    de reconciliación que cuadra consigo mismo y miente sobre el banco. El
 *    bucle va hasta que `has_more` sea false.
 *
 * ── Autenticación ───────────────────────────────────────────────────────────
 *
 * No hay OAuth ni tokens que caduquen, a diferencia de finAPI. Cada petición es
 * un POST con `client_id` y `secret` en el cuerpo JSON. Eso simplifica el
 * módulo —no hay caché de tokens ni renovación— y traslada todo el cuidado a un
 * sitio: que las credenciales no se escriban nunca en el repositorio ni en un
 * log.
 *
 * Sobre `server-only`: este módulo **no** lo importa, a diferencia de `db.ts` y
 * `data.ts`, para que los tests puedan ejercitarlo contra el sandbox de verdad
 * fuera de Next. La protección real es otra y es más fuerte: las credenciales
 * se leen de variables sin prefijo `NEXT_PUBLIC_`, así que Next nunca las mete
 * en el bundle del navegador — desde un componente de cliente serían
 * `undefined` y `configuracion()` fallaría con un mensaje explícito. El
 * `server-only` va en las rutas que llaman acá.
 */

import {
  aplanar,
  cadena,
  cadenaObligatoria,
  decimalExacto,
  enteroSeguro,
  esObjeto,
  lista,
  type ObjetoJson,
  objeto,
  parsearSinFlotantes,
  serializarConDecimalesExactos,
  type ValorJson,
} from '../json-exacto'
import { camposDeError, detalleDeRed, errorLocal, PlaidError } from './errores'
import type {
  CategoriaPersonal,
  ContrapartePlaid,
  CuentaPlaid,
  InstitucionPlaid,
  ItemCanjeado,
  LinkToken,
  LoteDeSincronizacion,
  MovimientoAEnriquecer,
  MovimientoEnriquecido,
  MovimientoPlaid,
  MovimientoQuitado,
} from './tipos'

// ── Configuración ───────────────────────────────────────────────────────────

/** Generoso: una llamada colgada no puede colgar la petición web. */
const TIMEOUT_POR_DEFECTO_MS = 20_000

/** El máximo que admite `/transactions/sync`. Menos son más viajes para nada. */
const POR_VUELTA_POR_DEFECTO = 500

/**
 * Tope de seguridad del bucle de paginación. No es un límite de datos: es un
 * seguro contra un `has_more` que nunca se apaga. Al tope le caben 100.000
 * movimientos, y si se alcanza no se pierde nada — el cursor vuelve al llamador
 * para que siga desde ahí.
 */
const MAX_VUELTAS = 200

/**
 * Plaid corta la paginación cuando los datos cambian por debajo.
 *
 * Comprobado contra su sandbox: conectar un banco y ponerse a paginar mientras
 * llega la descarga histórica lo produce a la primera.
 */
const CODIGO_MUTACION_EN_PAGINACION = 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION'

/**
 * Cuántas veces se vuelve a empezar por eso antes de rendirse. Con un banco
 * recién conectado puede pasar dos o tres veces seguidas; si pasa cinco, algo
 * más raro ocurre y es mejor que alguien lo mire.
 */
const MAX_REINICIOS = 5

export interface OpcionesRed {
  readonly timeoutMs?: number
}

interface ConfiguracionCore {
  readonly base: string
  readonly clientId: string
  readonly secret: string
}

function leerVariable(nombre: string): string | null {
  const valor = process.env[nombre]
  if (valor === undefined || valor.trim() === '') return null
  const limpio = valor.trim()
  // La barra final se le quita a la URL, que es donde sobra porque después se
  // concatena la ruta. Al secreto NO: es opaco y puede acabar en cualquier
  // carácter, así que recortarlo produciría un 400 imposible de explicar
  // mirando la variable, que se ve bien escrita.
  return nombre === 'PLAID_BASE' ? limpio.replace(/\/+$/, '') : limpio
}

function exigir(nombre: string, pista: string): string {
  const valor = leerVariable(nombre)
  if (valor === null) {
    throw new Error(
      `Falta la variable de entorno ${nombre}. ${pista}\n` +
        'Las credenciales de Plaid no van en el repositorio: se ponen en el entorno ' +
        '(`.env` local, variables del proyecto en Vercel).',
    )
  }
  return valor
}

function configuracion(): ConfiguracionCore {
  return {
    base: exigir(
      'PLAID_BASE',
      'Es la raíz de la API: https://sandbox.plaid.com o https://production.plaid.com.',
    ),
    clientId: exigir('PLAID_CLIENT_ID', 'Es el identificador del cliente.'),
    secret: exigir('PLAID_SECRET', 'Es el secreto del entorno. Nunca al repo.'),
  }
}

const VARIABLES = ['PLAID_BASE', 'PLAID_CLIENT_ID', 'PLAID_SECRET'] as const

/** Para diagnósticos en pantalla: decir qué falta sin llegar a fallar. */
export function faltanCredenciales(): string[] {
  return VARIABLES.filter((nombre) => leerVariable(nombre) === null)
}

export function hayCredenciales(): boolean {
  return faltanCredenciales().length === 0
}

/**
 * Si estamos apuntando al sandbox.
 *
 * Se mira el host y no una variable aparte porque el host es el que decide de
 * verdad: una variable `PLAID_ENV=sandbox` con `PLAID_BASE` de producción sería
 * una mentira que este módulo se creería.
 */
export function esSandbox(): boolean {
  const base = leerVariable('PLAID_BASE')
  if (base === null) return false
  try {
    return new URL(base).hostname.split('.')[0] === 'sandbox'
  } catch {
    return false
  }
}

function exigirSandbox(operacion: string): void {
  if (esSandbox()) return
  throw errorLocal(
    operacion,
    'Es una operación que sólo existe en el sandbox y PLAID_BASE no apunta al sandbox. ' +
      'Contra producción rompería una conexión real de una familia.',
  )
}

// ── Transporte ──────────────────────────────────────────────────────────────

interface Respuesta {
  readonly status: number
  readonly ok: boolean
  readonly texto: string
}

/**
 * Un POST a Plaid con las credenciales en el cuerpo.
 *
 * Las credenciales se añaden acá y en ningún otro sitio: quien llama pasa sólo
 * los campos de su endpoint, así que no hay forma de olvidarse ni de mandarlas
 * dos veces.
 */
async function pedir(
  ruta: string,
  cuerpo: Record<string, unknown>,
  operacion: string,
  opciones: OpcionesRed,
): Promise<Respuesta> {
  const { base, clientId, secret } = configuracion()
  const timeoutMs = opciones.timeoutMs ?? TIMEOUT_POR_DEFECTO_MS
  // `serializarConDecimalesExactos` en vez de `JSON.stringify` porque en
  // `/transactions/enrich` el cuerpo lleva importes nuestros. Para los demás
  // endpoints se comporta igual que `JSON.stringify`.
  const texto = serializarConDecimalesExactos({ client_id: clientId, secret, ...cuerpo })
  try {
    const respuesta = await fetch(`${base}${ruta}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: texto,
      // El corte cubre también la lectura del cuerpo, que con 500 movimientos
      // por vuelta no es instantánea.
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
    return { status: respuesta.status, ok: respuesta.ok, texto: await respuesta.text() }
  } catch (error) {
    throw new PlaidError(operacion, detalleDeRed(error, timeoutMs), null, null, null, null, null)
  }
}

/** Pide, comprueba el código y deserializa sin que ningún número sea `number`. */
async function pedirJson(
  ruta: string,
  cuerpo: Record<string, unknown>,
  operacion: string,
  opciones: OpcionesRed,
): Promise<ObjetoJson> {
  const respuesta = await pedir(ruta, cuerpo, operacion, opciones)
  if (!respuesta.ok) {
    const campos = camposDeError(respuesta.texto)
    throw new PlaidError(
      operacion,
      campos.detalle,
      respuesta.status,
      campos.errorCode,
      campos.errorType,
      campos.requestId,
      respuesta.texto.slice(0, 1000),
    )
  }
  let valor: ValorJson
  try {
    valor = parsearSinFlotantes(respuesta.texto)
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error)
    throw new PlaidError(
      operacion,
      motivo,
      respuesta.status,
      null,
      null,
      null,
      respuesta.texto.slice(0, 1000),
    )
  }
  if (!esObjeto(valor)) {
    throw new PlaidError(
      operacion,
      'La respuesta no es un objeto JSON.',
      respuesta.status,
      null,
      null,
      null,
      respuesta.texto.slice(0, 1000),
    )
  }
  return valor
}

// ── Link ────────────────────────────────────────────────────────────────────

export interface OpcionesLinkToken extends OpcionesRed {
  /** Lo que se le enseña a la persona en el formulario. */
  readonly nombreDeAplicacion?: string
  /** 'es', 'en'. Plaid sólo admite idiomas que soporte para esos países. */
  readonly idioma?: string
  /** Por defecto ['transactions'], que es lo único que usamos. */
  readonly productos?: readonly string[]
  /** A dónde manda Plaid los avisos de que hay movimientos nuevos. */
  readonly webhook?: string
  /** Obligatorio para los bancos OAuth — que en España son casi todos. */
  readonly redirectUri?: string
  /**
   * Modo actualización: reconectar un item que pide reautenticación en vez de
   * crear uno nuevo. Sin esto, un `ITEM_LOGIN_REQUIRED` obligaría a la familia
   * a conectar el banco desde cero y a duplicar la conexión.
   */
  readonly accessToken?: string
}

/**
 * Abre una sesión de Link y devuelve el token que consume el formulario.
 *
 * Es el único camino: las credenciales del banco las teclea la persona dentro
 * de Link y nunca pasan por nosotros. El token dura cuatro horas y es de un
 * solo uso.
 *
 * `usuario` es **nuestro** identificador de la persona ante Plaid
 * (`client_user_id`). No debe ser un dato personal: Plaid lo guarda y lo
 * devuelve en sus webhooks, así que va el identificador opaco del hogar, no un
 * correo ni un nombre.
 */
export async function crearLinkToken(
  usuario: string,
  paises: readonly string[],
  opciones: OpcionesLinkToken = {},
): Promise<LinkToken> {
  if (usuario.trim() === '') {
    throw errorLocal(
      'crear el link token',
      'Hace falta un identificador de usuario para Plaid (client_user_id).',
    )
  }
  if (paises.length === 0) {
    throw errorLocal(
      'crear el link token',
      'Hace falta al menos un país. El corredor del producto es ES y US.',
    )
  }

  const cuerpo: Record<string, unknown> = {
    user: { client_user_id: usuario },
    client_name: opciones.nombreDeAplicacion ?? 'moneypilot',
    country_codes: [...paises],
    language: opciones.idioma ?? 'es',
  }
  // En modo actualización Plaid prohíbe mandar `products`: el item ya los
  // tiene. Mandarlos igual da INVALID_FIELD.
  if (opciones.accessToken === undefined) {
    cuerpo['products'] = [...(opciones.productos ?? ['transactions'])]
  } else {
    cuerpo['access_token'] = opciones.accessToken
  }
  if (opciones.webhook !== undefined) cuerpo['webhook'] = opciones.webhook
  if (opciones.redirectUri !== undefined) cuerpo['redirect_uri'] = opciones.redirectUri

  const json = await pedirJson('/link/token/create', cuerpo, 'crear el link token', opciones)
  return {
    linkToken: cadenaObligatoria(json, 'link_token', 'la respuesta del link token'),
    expiration: cadenaObligatoria(json, 'expiration', 'la respuesta del link token'),
  }
}

/**
 * Canjea el token público que devuelve Link por el `access_token` duradero.
 *
 * El `public_token` vive treinta minutos y sirve una sola vez; el
 * `access_token` no caduca y es la llave de todos los datos bancarios de esa
 * conexión. Quien llama es responsable de guardarlo donde corresponda — y de
 * que no acabe en un log.
 */
export async function canjearPublicToken(
  publicToken: string,
  opciones: OpcionesRed = {},
): Promise<ItemCanjeado> {
  const json = await pedirJson(
    '/item/public_token/exchange',
    { public_token: publicToken },
    'canjear el public token',
    opciones,
  )
  return {
    accessToken: cadenaObligatoria(json, 'access_token', 'el canje del public token'),
    itemId: cadenaObligatoria(json, 'item_id', 'el canje del public token'),
  }
}

// ── Cuentas ─────────────────────────────────────────────────────────────────

export async function traerCuentas(
  accessToken: string,
  opciones: OpcionesRed = {},
): Promise<CuentaPlaid[]> {
  const json = await pedirJson(
    '/accounts/get',
    { access_token: accessToken },
    'traer las cuentas',
    opciones,
  )
  return leerCuentas(json)
}

function leerCuentas(json: ObjetoJson): CuentaPlaid[] {
  const bruto = json['accounts']
  if (bruto === undefined) return []
  return lista(bruto, 'la lista de cuentas').map((entrada) => {
    const cuenta = objeto(entrada, 'una cuenta')
    const saldos = esObjeto(cuenta['balances']) ? cuenta['balances'] : {}
    return {
      accountId: cadenaObligatoria(cuenta, 'account_id', 'una cuenta'),
      name: cadena(cuenta, 'name'),
      officialName: cadena(cuenta, 'official_name'),
      mask: cadena(cuenta, 'mask'),
      type: cadena(cuenta, 'type'),
      subtype: cadena(cuenta, 'subtype'),
      holderCategory: cadena(cuenta, 'holder_category'),
      // Cadenas decimales exactas. Ver la cabecera de ../json-exacto.
      saldoActual: cadena(saldos, 'current'),
      saldoDisponible: cadena(saldos, 'available'),
      limite: cadena(saldos, 'limit'),
      // Sin valor por defecto a propósito: ver el comentario en tipos.ts.
      isoCurrencyCode: cadena(saldos, 'iso_currency_code'),
      unofficialCurrencyCode: cadena(saldos, 'unofficial_currency_code'),
      crudo: aplanar(cuenta),
    }
  })
}

// ── Movimientos ─────────────────────────────────────────────────────────────

export interface OpcionesSincronizar extends OpcionesRed {
  /** Movimientos por vuelta. Plaid admite hasta 500, que es el defecto. */
  readonly porVuelta?: number
  /** Filtra a una sola cuenta del item. */
  readonly accountId?: string
  /** Días de histórico que se piden en la carga inicial. Plaid admite 1..730. */
  readonly diasDeHistorico?: number
  /** Pide también el concepto crudo del banco, sin limpiar. */
  readonly incluirDescripcionOriginal?: boolean
}

/**
 * Trae **todo** lo que cambió desde el cursor, no la primera vuelta.
 *
 * `/transactions/sync` devuelve added / modified / removed con un cursor.
 * `modified` es un movimiento que el banco corrigió —es el veredicto 'updated'
 * que el dedup ya sabe tratar— y `removed` es uno que Plaid retiró.
 *
 * El bucle va hasta que `has_more` sea false y **el cursor que se devuelve es
 * el de la última vuelta**. Quedarse a medias no daría un error en ningún
 * sitio: daría un informe de reconciliación que cuadra consigo mismo y no
 * cuadra con el banco.
 *
 * Sin `cursor` Plaid manda el histórico entero desde el principio. Eso es lo
 * correcto en la primera sincronización y es también lo que pasa si el cursor
 * guardado se perdió: no se duplica nada, porque el dedup de origen 'api'
 * está para eso.
 *
 * ── Dos cosas que no se ven leyendo la documentación ────────────────────────
 *
 * **Nada en la respuesta dice que ya estén todos los movimientos.** Ni
 * `has_more: false`, ni el estado, ni un lote vacío. Un banco recién conectado
 * los entrega a plazos y en medio aparecen lotes vacíos: quien pare en el
 * primero se lleva 16 de 48 sin un solo error. La medición está en
 * `EstadoDeActualizacion` (tipos.ts) y no es una curiosidad — es la decisión de
 * diseño de `sincronizar.ts`, que tiene que dispararse con el webhook
 * `SYNC_UPDATES_AVAILABLE` y no con el reloj. Por eso `crearLinkToken` acepta
 * `webhook`.
 *
 * **La paginación se puede caer sola.** Si los datos cambian por debajo
 * mientras se recorren las páginas —y en un banco recién conectado cambian
 * todo el rato, porque la descarga histórica sigue llegando— Plaid corta con
 * `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` y pide empezar de nuevo desde
 * el último cursor guardado. No es un error raro: salta a la primera contra su
 * sandbox. Se reintenta acá dentro, tirando lo acumulado y volviendo al cursor
 * de entrada, porque es el único sitio que sabe que hay medio lote en la mano;
 * dejarlo subir convertiría algo rutinario y que se arregla solo en una
 * importación fallida.
 */
export async function sincronizar(
  accessToken: string,
  cursor?: string,
  opciones: OpcionesSincronizar = {},
): Promise<LoteDeSincronizacion> {
  const opcionesPlaid: Record<string, unknown> = {}
  if (opciones.accountId !== undefined) opcionesPlaid['account_id'] = opciones.accountId
  if (opciones.diasDeHistorico !== undefined) {
    opcionesPlaid['days_requested'] = opciones.diasDeHistorico
  }
  if (opciones.incluirDescripcionOriginal === true) {
    opcionesPlaid['include_original_description'] = true
  }

  // La cadena vacía es "sin cursor". Plaid devuelve exactamente eso mientras el
  // item está NOT_READY, y mandársela de vuelta sería mandar un campo vacío.
  const cursorInicial = cursor ?? ''

  let added: MovimientoPlaid[] = []
  let modified: MovimientoPlaid[] = []
  let removed: MovimientoQuitado[] = []
  let cuentas: CuentaPlaid[] = []
  let actual = cursorInicial
  let estado = 'TRANSACTIONS_UPDATE_STATUS_UNKNOWN'
  let hasMore = false
  let vueltas = 0
  let reinicios = 0

  do {
    const cuerpo: Record<string, unknown> = {
      access_token: accessToken,
      count: opciones.porVuelta ?? POR_VUELTA_POR_DEFECTO,
    }
    if (actual !== '') cuerpo['cursor'] = actual
    if (Object.keys(opcionesPlaid).length > 0) cuerpo['options'] = opcionesPlaid

    vueltas += 1
    let json: ObjetoJson
    try {
      json = await pedirJson(
        '/transactions/sync',
        cuerpo,
        `sincronizar los movimientos (vuelta ${vueltas})`,
        opciones,
      )
    } catch (error) {
      if (!esMutacionDurantePaginacion(error) || reinicios >= MAX_REINICIOS) throw error
      // Los datos cambiaron por debajo a media paginación. Lo acumulado hasta
      // acá es medio lote y no sirve: se tira entero y se vuelve al cursor de
      // entrada, que es lo que Plaid pide. Tirarlo es justamente el punto —
      // quedárselo sería importar la mitad de un extracto.
      reinicios += 1
      added = []
      modified = []
      removed = []
      cuentas = []
      actual = cursorInicial
      hasMore = true
      continue
    }

    added.push(...leerMovimientos(json['added'], 'added'))
    modified.push(...leerMovimientos(json['modified'], 'modified'))
    removed.push(...leerQuitados(json['removed']))
    // Se conserva la última lista NO vacía y no se pisa con la de cada página.
    // Medido contra su sandbox: una página sin movimientos trae `accounts: []`,
    // y la última página de una paginación puede venir vacía (cuando la
    // anterior llenó justo el `count`). Con asignación directa, un lote que sí
    // trajo movimientos podía terminar sin sus cuentas, y quien lo recibe no
    // tiene forma de distinguir eso de "este item no tiene cuentas".
    const cuentasDeLaPagina = leerCuentas(json)
    if (cuentasDeLaPagina.length > 0) cuentas = cuentasDeLaPagina
    estado = cadena(json, 'transactions_update_status') ?? estado

    const siguiente = cadena(json, 'next_cursor') ?? ''
    hasMore = cadena(json, 'has_more') === 'true'

    // Un `has_more: true` con el mismo cursor es un bucle infinito disfrazado
    // de paginación. Se corta acá, con el cursor bueno en la mano.
    if (hasMore && siguiente === actual) {
      throw errorLocal(
        'sincronizar los movimientos',
        `Plaid dice que hay más páginas y devuelve el mismo cursor en la vuelta ${vueltas}. ` +
          'No se sigue: sería un bucle infinito.',
      )
    }
    actual = siguiente
  } while (hasMore && vueltas < MAX_VUELTAS)

  return { added, modified, removed, cursor: actual, hasMore, estado, cuentas }
}

function esMutacionDurantePaginacion(error: unknown): boolean {
  return error instanceof PlaidError && error.errorCode === CODIGO_MUTACION_EN_PAGINACION
}

function leerMovimientos(valor: ValorJson | undefined, donde: string): MovimientoPlaid[] {
  if (valor === undefined) return []
  return lista(valor, `la lista "${donde}"`).map((entrada) => {
    const m = objeto(entrada, `un movimiento de "${donde}"`)
    return {
      transactionId: cadenaObligatoria(m, 'transaction_id', 'un movimiento'),
      accountId: cadenaObligatoria(m, 'account_id', 'un movimiento'),
      // El campo que justifica todo el módulo de JSON exacto: llega como la
      // cadena exacta del cuerpo HTTP, sin haber sido nunca un `number`.
      // Y POSITIVO = SALE DE LA CUENTA. Ver el comentario largo de tipos.ts.
      importeSalidaPositiva: cadenaObligatoria(m, 'amount', 'un movimiento'),
      isoCurrencyCode: cadena(m, 'iso_currency_code'),
      unofficialCurrencyCode: cadena(m, 'unofficial_currency_code'),
      date: cadena(m, 'date'),
      authorizedDate: cadena(m, 'authorized_date'),
      datetime: cadena(m, 'datetime'),
      authorizedDatetime: cadena(m, 'authorized_datetime'),
      name: cadena(m, 'name'),
      originalDescription: cadena(m, 'original_description'),
      merchantName: cadena(m, 'merchant_name'),
      pending: cadena(m, 'pending') === 'true',
      pendingTransactionId: cadena(m, 'pending_transaction_id'),
      paymentChannel: cadena(m, 'payment_channel'),
      transactionCode: cadena(m, 'transaction_code'),
      checkNumber: cadena(m, 'check_number'),
      categoriaPersonal: leerCategoria(m['personal_finance_category']),
      merchantCategoryCode: cadena(m, 'merchant_category_code'),
      website: cadena(m, 'website'),
      logoUrl: cadena(m, 'logo_url'),
      contrapartes: leerContrapartes(m['counterparties']),
      crudo: aplanar(m),
    }
  })
}

function leerQuitados(valor: ValorJson | undefined): MovimientoQuitado[] {
  if (valor === undefined) return []
  return lista(valor, 'la lista "removed"').map((entrada) => {
    const m = objeto(entrada, 'un movimiento retirado')
    return {
      transactionId: cadenaObligatoria(m, 'transaction_id', 'un movimiento retirado'),
      accountId: cadena(m, 'account_id'),
    }
  })
}

/**
 * La categoría de Plaid, si trae las dos mitades.
 *
 * Media categoría no sirve para nada y ensucia el informe, así que se descarta.
 * El objeto completo sigue en `crudo` de todas formas, que es donde hay que
 * mirar si alguna vez hace falta.
 */
function leerCategoria(valor: ValorJson | undefined): CategoriaPersonal | null {
  if (!esObjeto(valor)) return null
  const primary = cadena(valor, 'primary')
  const detailed = cadena(valor, 'detailed')
  if (primary === null || detailed === null) return null
  return { primary, detailed, confidenceLevel: cadena(valor, 'confidence_level') }
}

function leerContrapartes(valor: ValorJson | undefined): ContrapartePlaid[] {
  if (!Array.isArray(valor)) return []
  const salida: ContrapartePlaid[] = []
  for (const entrada of valor) {
    if (!esObjeto(entrada)) continue
    const name = cadena(entrada, 'name')
    // Una contraparte sin nombre no identifica a nadie. Se descarta acá en vez
    // de propagar un `null` que después habría que filtrar en cada consumidor.
    if (name === null) continue
    salida.push({
      name,
      type: cadena(entrada, 'type'),
      website: cadena(entrada, 'website'),
      logoUrl: cadena(entrada, 'logo_url'),
      confidenceLevel: cadena(entrada, 'confidence_level'),
      entityId: cadena(entrada, 'entity_id'),
    })
  }
  return salida
}

// ── Enriquecimiento ─────────────────────────────────────────────────────────

/**
 * Le pide a Plaid que ponga comercio y categoría a movimientos **nuestros**.
 *
 * Sirve para lo que `/transactions/sync` no cubre: las líneas que entran por
 * fichero (OFX, N43, CSV) y que no vienen de Plaid. Es el único endpoint donde
 * mandamos importes en vez de leerlos, y por eso el cuerpo se serializa con
 * `serializarConDecimalesExactos` — si no, el importe pasaría por coma flotante
 * en el último metro.
 *
 * Ojo con la convención, que **no** es la de `/transactions/sync`: acá el
 * importe va siempre positivo y el sentido lo lleva `direction`.
 *
 * En el sandbox sólo funciona con la lista de movimientos de muestra de Plaid;
 * con cualquier otro contesta `INVALID_SANDBOX_TRANSACTION`. No es un fallo
 * nuestro y conviene saberlo antes de perder una tarde.
 */
export async function enriquecer(
  transacciones: readonly MovimientoAEnriquecer[],
  tipoCuenta: string,
  opciones: OpcionesRed = {},
): Promise<MovimientoEnriquecido[]> {
  if (transacciones.length === 0) return []

  const cuerpo = {
    account_type: tipoCuenta,
    transactions: transacciones.map((t) => {
      const fila: Record<string, unknown> = {
        id: t.id,
        description: t.description,
        // El importe como literal exacto, sin pasar por `number`.
        amount: decimalExacto(t.importe),
        direction: t.direction,
        iso_currency_code: t.isoCurrencyCode,
      }
      if (t.mcc !== undefined) fila['mcc'] = t.mcc
      const location: Record<string, unknown> = {}
      if (t.ciudad !== undefined) location['city'] = t.ciudad
      if (t.region !== undefined) location['region'] = t.region
      if (t.pais !== undefined) location['country'] = t.pais
      if (Object.keys(location).length > 0) fila['location'] = location
      return fila
    }),
  }

  const json = await pedirJson(
    '/transactions/enrich',
    cuerpo,
    'enriquecer los movimientos',
    opciones,
  )

  return lista(json['enriched_transactions'], 'los movimientos enriquecidos').map((entrada) => {
    const fila = objeto(entrada, 'un movimiento enriquecido')
    const e = esObjeto(fila['enrichments']) ? fila['enrichments'] : {}
    return {
      id: cadenaObligatoria(fila, 'id', 'un movimiento enriquecido'),
      merchantName: cadena(e, 'merchant_name'),
      website: cadena(e, 'website'),
      logoUrl: cadena(e, 'logo_url'),
      categoriaPersonal: leerCategoria(e['personal_finance_category']),
      paymentChannel: cadena(e, 'payment_channel'),
      contrapartes: leerContrapartes(e['counterparties']),
      crudo: aplanar(e),
    }
  })
}

// ── Catálogo ────────────────────────────────────────────────────────────────

export interface OpcionesInstituciones extends OpcionesRed {
  /** Por defecto ['transactions']: un banco sin eso no nos sirve para nada. */
  readonly productos?: readonly string[]
}

/**
 * Busca bancos por nombre en los países que se le pasen.
 *
 * Se filtra por producto porque un banco puede exponer la cuenta y no los
 * movimientos, y eso no se ve hasta que ya conectaste. Los diez españoles que
 * importan —BBVA, Santander, CaixaBank, Sabadell, Bankinter, ING, Openbank,
 * Revolut, Unicaja, Kutxabank— aparecen con `transactions`.
 */
export async function buscarInstituciones(
  query: string,
  paises: readonly string[],
  opciones: OpcionesInstituciones = {},
): Promise<InstitucionPlaid[]> {
  const json = await pedirJson(
    '/institutions/search',
    {
      query,
      country_codes: [...paises],
      products: [...(opciones.productos ?? ['transactions'])],
    },
    `buscar instituciones que coincidan con "${query}"`,
    opciones,
  )

  return lista(json['institutions'], 'la lista de instituciones').map((entrada) => {
    const banco = objeto(entrada, 'una institución')
    return {
      institutionId: cadenaObligatoria(banco, 'institution_id', 'una institución'),
      nombre: cadena(banco, 'name') ?? '(sin nombre)',
      paises: textos(banco['country_codes']),
      productos: textos(banco['products']),
      oauth: cadena(banco, 'oauth') === 'true',
    }
  })
}

/**
 * Cuántas instituciones hay en esos países.
 *
 * Es la comprobación de cobertura que decidió el proveedor: finAPI daba 0
 * bancos en España. Vale la pena poder repetirla sin abrir un navegador.
 */
export async function contarInstituciones(
  paises: readonly string[],
  opciones: OpcionesRed = {},
): Promise<number> {
  const json = await pedirJson(
    '/institutions/get',
    { count: 1, offset: 0, country_codes: [...paises] },
    `contar las instituciones de ${paises.join(', ')}`,
    opciones,
  )
  return enteroSeguro(cadenaObligatoria(json, 'total', 'el conteo de instituciones'), 'total')
}

function textos(valor: ValorJson | undefined): string[] {
  if (!Array.isArray(valor)) return []
  return valor.filter((item): item is string => typeof item === 'string')
}

// ── Sólo sandbox ────────────────────────────────────────────────────────────
//
// Lo de acá abajo no existe en producción. Las dos funciones comprueban el host
// antes de salir a la red: `/sandbox/item/reset_login` contra una conexión de
// verdad la tumbaría y obligaría a la familia a reconectar el banco.

export interface OpcionesSandbox extends OpcionesRed {
  /**
   * Un usuario de sandbox a medida, como objeto.
   *
   * Es lo que permite probar de verdad: cuentas en EUR, importes elegidos por
   * nosotros y movimientos con las fechas que hagan falta. Comprobado contra el
   * sandbox — con `override_accounts` se puede fijar `currency: 'EUR'` y los
   * importes vuelven exactamente como se pusieron.
   */
  readonly usuarioAMedida?: unknown
  readonly webhook?: string
}

/**
 * Crea un `public_token` ya autenticado, sin navegador.
 *
 * Es lo que hace probable todo el recorrido: sin esto, cada prueba necesitaría
 * que una persona teclease las credenciales del banco en Link. Se canjea con
 * `canjearPublicToken` igual que el que devuelve Link de verdad.
 */
export async function crearPublicTokenDeSandbox(
  institutionId: string,
  productos: readonly string[],
  opciones: OpcionesSandbox = {},
): Promise<string> {
  const operacion = 'crear el public token de sandbox'
  exigirSandbox(operacion)

  const cuerpo: Record<string, unknown> = {
    institution_id: institutionId,
    initial_products: [...productos],
  }
  const opcionesPlaid: Record<string, unknown> = {}
  if (opciones.usuarioAMedida !== undefined) {
    opcionesPlaid['override_username'] = 'user_custom'
    // Plaid espera el usuario a medida como JSON dentro de un campo de texto.
    // Se serializa con el mismo serializador de siempre por si lleva importes.
    opcionesPlaid['override_password'] = serializarConDecimalesExactos(opciones.usuarioAMedida)
  }
  if (opciones.webhook !== undefined) opcionesPlaid['webhook'] = opciones.webhook
  if (Object.keys(opcionesPlaid).length > 0) cuerpo['options'] = opcionesPlaid

  const json = await pedirJson('/sandbox/public_token/create', cuerpo, operacion, opciones)
  return cadenaObligatoria(json, 'public_token', 'el public token de sandbox')
}

/**
 * Fuerza que el item pida reautenticación, como cuando el banco caduca el
 * acceso.
 *
 * Después de esto, cualquier llamada con ese `access_token` contesta
 * `ITEM_LOGIN_REQUIRED`. Es la única forma de probar sin esperar meses el
 * camino que más va a doler en producción: la conexión se cae, deja de entrar
 * un solo movimiento, y si nadie lo detecta el informe sigue cuadrando consigo
 * mismo mientras se aleja del banco.
 */
export async function forzarReautenticacion(
  accessToken: string,
  opciones: OpcionesRed = {},
): Promise<void> {
  const operacion = 'forzar la reautenticación del item en el sandbox'
  exigirSandbox(operacion)
  await pedirJson('/sandbox/item/reset_login', { access_token: accessToken }, operacion, opciones)
}
