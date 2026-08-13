/**
 * El único sitio del proyecto que habla con finAPI por la red.
 *
 * Todo lo demás —el mapeador, el pipeline, la pantalla— trabaja sobre lo que
 * este módulo devuelve. Esa frontera es el motivo de que exista: si mañana
 * cambia el agregador, se reescribe este fichero y el resto no se entera.
 *
 * Dos reglas gobiernan lo que hay acá dentro:
 *
 * 1. **Ningún importe pasa por coma flotante.** Ver `json-exacto.ts`. Los
 *    cuerpos se leen como texto y se deserializan con todos los números
 *    convertidos en cadena. `Number()` sólo aparece en `enteroSeguro`, y sólo
 *    para páginas e identificadores.
 *
 * 2. **Esto es una fuente de entrada, no el libro.** Este cliente lee y ya.
 *    No guarda nada, no deduplica, no decide. Los movimientos que devuelve
 *    acaban en `persistImport` por el mismo camino que un OFX.
 *
 * Sobre `server-only`: este módulo **no** lo importa, a diferencia de `db.ts` y
 * `data.ts`, para que los tests puedan ejercitarlo contra el sandbox de verdad
 * fuera de Next. La protección real es otra y es más fuerte: las credenciales
 * se leen de variables sin prefijo `NEXT_PUBLIC_`, así que Next nunca las
 * mete en el bundle del navegador — desde un componente de cliente serían
 * `undefined` y `configuracion()` fallaría con un mensaje explícito. El
 * `server-only` va en las rutas que llaman acá.
 */

import { detalleDeError, detalleDeRed, FinapiError } from './errores'
import {
  aplanar,
  cadena,
  cadenaObligatoria,
  enteroSeguro,
  esObjeto,
  lista,
  type ObjetoJson,
  objeto,
  parsearSinFlotantes,
  type ValorJson,
} from './json-exacto'
import type {
  FinapiBanco,
  FinapiRawAccount,
  FinapiRawTransaction,
  FinapiUsuario,
  FinapiWebForm,
  FinapiWebFormEstado,
} from './tipos'

// ── Configuración ───────────────────────────────────────────────────────────

/** Por defecto generoso: una llamada colgada no puede colgar la petición web. */
const TIMEOUT_POR_DEFECTO_MS = 20_000

/** finAPI admite hasta 500 por página y son 1.612 movimientos: cuatro viajes. */
const POR_PAGINA_POR_DEFECTO = 500

/**
 * Tope de seguridad del bucle de paginación. No es un límite de datos: es un
 * seguro contra un `pageCount` absurdo o un servidor que no avanza. Al tope
 * por defecto le caben 250.000 movimientos.
 */
const MAX_PAGINAS = 500

export interface OpcionesRed {
  readonly timeoutMs?: number
}

interface ConfiguracionCore {
  readonly base: string
  readonly clientId: string
  readonly clientSecret: string
}

function leerVariable(nombre: string): string | null {
  const valor = process.env[nombre]
  if (valor === undefined || valor.trim() === '') return null
  const limpio = valor.trim()
  // La barra final se le quita a las URLs, que es donde sobra porque después se
  // concatena la ruta. A un secreto NO: el de finAPI es opaco y puede acabar en
  // cualquier carácter, así que recortarlo produciría un 401 imposible de
  // explicar mirando la variable, que se ve bien escrita.
  return nombre.endsWith('_BASE') ? limpio.replace(/\/+$/, '') : limpio
}

function exigir(nombre: string, pista: string): string {
  const valor = leerVariable(nombre)
  if (valor === null) {
    throw new Error(
      `Falta la variable de entorno ${nombre}. ${pista}\n` +
        'Las credenciales del sandbox de finAPI no van en el repositorio: se ponen en el ' +
        'entorno (`.env` local, variables del proyecto en Vercel).',
    )
  }
  return valor
}

function configuracion(): ConfiguracionCore {
  return {
    base: exigir(
      'FINAPI_BASE',
      'Es la raíz del Access API, por ejemplo https://sandbox.finapi.io.',
    ),
    clientId: exigir('FINAPI_CLIENT_ID', 'Es el identificador del cliente OAuth.'),
    clientSecret: exigir('FINAPI_CLIENT_SECRET', 'Es el secreto del cliente OAuth. Nunca al repo.'),
  }
}

/**
 * El Web Form vive en otro host que el Access API y se pide aparte, no dentro
 * de `configuracion()`: traer movimientos no debería fallar por una variable
 * que sólo hace falta para conectar un banco.
 */
function baseWebForm(): string {
  return exigir(
    'FINAPI_WEBFORM_BASE',
    'Es la raíz del Web Form 2.0, por ejemplo https://webform-sandbox.finapi.io.',
  )
}

/** Para diagnósticos en pantalla: decir qué falta sin llegar a fallar. */
export function faltanCredenciales(): string[] {
  return ['FINAPI_BASE', 'FINAPI_CLIENT_ID', 'FINAPI_CLIENT_SECRET', 'FINAPI_WEBFORM_BASE'].filter(
    (nombre) => leerVariable(nombre) === null,
  )
}

export function hayCredenciales(): boolean {
  return faltanCredenciales().length === 0
}

// ── Transporte ──────────────────────────────────────────────────────────────

interface Respuesta {
  readonly status: number
  readonly ok: boolean
  readonly texto: string
}

async function pedir(
  url: string,
  init: RequestInit,
  operacion: string,
  opciones: OpcionesRed,
): Promise<Respuesta> {
  const timeoutMs = opciones.timeoutMs ?? TIMEOUT_POR_DEFECTO_MS
  try {
    const respuesta = await fetch(url, {
      ...init,
      // El corte cubre también la lectura del cuerpo, que con 500 movimientos
      // por página no es instantánea.
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
    const texto = await respuesta.text()
    return { status: respuesta.status, ok: respuesta.ok, texto }
  } catch (error) {
    throw new FinapiError(operacion, detalleDeRed(error, timeoutMs), null, null)
  }
}

/** Pide, comprueba el código y deserializa sin que ningún número sea `number`. */
async function pedirJson(
  url: string,
  init: RequestInit,
  operacion: string,
  opciones: OpcionesRed,
): Promise<ObjetoJson> {
  const respuesta = await pedir(url, init, operacion, opciones)
  if (!respuesta.ok) {
    throw new FinapiError(
      operacion,
      detalleDeError(respuesta.texto),
      respuesta.status,
      respuesta.texto.slice(0, 1000),
    )
  }
  let valor: ValorJson
  try {
    valor = parsearSinFlotantes(respuesta.texto)
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error)
    throw new FinapiError(operacion, motivo, respuesta.status, respuesta.texto.slice(0, 1000))
  }
  if (!esObjeto(valor)) {
    throw new FinapiError(
      operacion,
      'La respuesta no es un objeto JSON.',
      respuesta.status,
      respuesta.texto.slice(0, 1000),
    )
  }
  return valor
}

function conToken(token: string, extra: HeadersInit = {}): HeadersInit {
  return { authorization: `Bearer ${token}`, accept: 'application/json', ...extra }
}

// ── Tokens ──────────────────────────────────────────────────────────────────

interface TokenEnCache {
  readonly token: string
  /** Milisegundos epoch. Reloj de pared, que es lo que mide una caducidad. */
  readonly expiraEn: number
}

/**
 * El token de cliente vale una hora y se pide en casi todas las llamadas.
 * Vive en memoria del proceso y nada más: en disco sería una credencial
 * escrita en algún sitio, que es exactamente lo que no queremos.
 */
let cacheDeCliente: TokenEnCache | null = null

/** Se renueva un minuto antes para no cruzarse con el vencimiento en vuelo. */
const MARGEN_S = 60

/** Para los tests, y para forzar una renovación tras un 401. */
export function olvidarTokenDeCliente(): void {
  cacheDeCliente = null
}

async function pedirToken(
  cuerpo: URLSearchParams,
  operacion: string,
  opciones: OpcionesRed,
): Promise<{ token: string; vidaSegundos: number }> {
  const { base } = configuracion()
  const json = await pedirJson(
    `${base}/api/v2/oauth/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: cuerpo,
    },
    operacion,
    opciones,
  )
  const token = cadenaObligatoria(json, 'access_token', 'la respuesta del token')
  const vida = cadena(json, 'expires_in')
  return {
    token,
    vidaSegundos: vida === null ? 3600 : enteroSeguro(vida, 'expires_in'),
  }
}

export async function tokenDeCliente(opciones: OpcionesRed = {}): Promise<string> {
  const ahora = Date.now()
  if (cacheDeCliente !== null && cacheDeCliente.expiraEn > ahora) return cacheDeCliente.token

  const { clientId, clientSecret } = configuracion()
  const { token, vidaSegundos } = await pedirToken(
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
    'obtener el token de cliente',
    opciones,
  )
  cacheDeCliente = { token, expiraEn: ahora + Math.max(vidaSegundos - MARGEN_S, MARGEN_S) * 1000 }
  return token
}

/**
 * El token del usuario **no** se cachea acá. Un proceso web sirve a muchos
 * hogares y una caché de tokens de usuario en memoria de módulo es una
 * credencial compartida esperando a que alguien se equivoque de clave. Quien
 * lo necesite lo pide y lo lleva por el alcance de su petición.
 */
export async function tokenDeUsuario(
  id: string,
  password: string,
  opciones: OpcionesRed = {},
): Promise<string> {
  const { clientId, clientSecret } = configuracion()
  const { token } = await pedirToken(
    new URLSearchParams({
      grant_type: 'password',
      client_id: clientId,
      client_secret: clientSecret,
      username: id,
      password,
    }),
    `obtener el token del usuario ${id}`,
    opciones,
  )
  return token
}

// ── Usuarios ────────────────────────────────────────────────────────────────

/**
 * Da de alta un usuario en finAPI y devuelve sus credenciales.
 *
 * El id y la contraseña los genera finAPI: se manda el cuerpo vacío a
 * propósito. Elegirlos nosotros significaría derivarlos de algo del hogar, y
 * ese algo acabaría siendo adivinable — el identificador de un usuario de
 * finAPI es la llave de todos sus datos bancarios.
 *
 * La contraseña se devuelve **una sola vez**: finAPI no la vuelve a enseñar.
 * Quien llama es responsable de guardarla donde corresponda.
 */
export async function crearUsuario(opciones: OpcionesRed = {}): Promise<FinapiUsuario> {
  const { base } = configuracion()
  const token = await tokenDeCliente(opciones)
  const json = await pedirJson(
    `${base}/api/v2/users`,
    {
      method: 'POST',
      headers: conToken(token, { 'content-type': 'application/json' }),
      body: '{}',
    },
    'crear el usuario en finAPI',
    opciones,
  )
  return {
    id: cadenaObligatoria(json, 'id', 'el usuario creado'),
    password: cadenaObligatoria(json, 'password', 'el usuario creado'),
  }
}

/**
 * Borra el usuario y con él todos sus datos bancarios en finAPI.
 *
 * No estaba en el encargo pero es la otra mitad de `crearUsuario`: si un hogar
 * desconecta el feed y su usuario sigue vivo en el agregador, sus movimientos
 * siguen ahí. Con datos reales eso sería un problema serio; que hoy el
 * sandbox sea sintético no cambia dónde tiene que estar la función. También es
 * lo que deja que los tests limpien lo que crean.
 */
export async function borrarUsuario(
  tokenUsuario: string,
  opciones: OpcionesRed = {},
): Promise<void> {
  const { base } = configuracion()
  const respuesta = await pedir(
    `${base}/api/v2/users`,
    { method: 'DELETE', headers: conToken(tokenUsuario) },
    'borrar el usuario en finAPI',
    opciones,
  )
  if (!respuesta.ok) {
    throw new FinapiError(
      'borrar el usuario en finAPI',
      detalleDeError(respuesta.texto),
      respuesta.status,
      respuesta.texto.slice(0, 1000),
    )
  }
}

// ── Web Form 2.0 ────────────────────────────────────────────────────────────

export interface OpcionesWebForm extends OpcionesRed {
  /** 0 = todo el histórico que dé el banco. En el sandbox son 24 meses. */
  readonly maxDaysForDownload?: number
  readonly nombreDeConexion?: string
}

/**
 * Abre un formulario de conexión bancaria y devuelve la URL que hay que abrir.
 *
 * Es el único camino posible: este cliente tiene prohibidas las llamadas
 * directas de importación —`POST /api/v2/bankConnections/import` contesta
 * "Für diesen Client sind direkte API-Aufrufe nicht zulässig"— así que las
 * credenciales del banco las teclea la persona en el formulario de finAPI y
 * nunca pasan por nosotros. Que es como tiene que ser.
 *
 * **No se manda `redirectUrl`.** El cliente del sandbox está UNLICENSED y
 * cualquier valor da INVALID_REDIRECT_URL. La consecuencia es de producto, no
 * técnica: no hay vuelta automática a la aplicación cuando la persona termina.
 * Hay que sondear `estadoWebForm` y decirlo en la pantalla, porque si no la
 * persona completa el formulario, se queda mirando la pestaña de finAPI y cree
 * que se colgó.
 */
export async function crearWebForm(
  tokenUsuario: string,
  bankId: number,
  opciones: OpcionesWebForm = {},
): Promise<FinapiWebForm> {
  const cuerpo: Record<string, unknown> = {
    bank: { id: bankId },
    // Sin esto el sandbox rechaza los bancos de prueba, que son los únicos que
    // tienen datos.
    allowTestBank: true,
    maxDaysForDownload: opciones.maxDaysForDownload ?? 0,
    loadOwnerData: true,
  }
  if (opciones.nombreDeConexion !== undefined) {
    cuerpo['bankConnectionName'] = opciones.nombreDeConexion
  }

  const json = await pedirJson(
    `${baseWebForm()}/api/webForms/bankConnectionImport`,
    {
      method: 'POST',
      headers: conToken(tokenUsuario, { 'content-type': 'application/json' }),
      body: JSON.stringify(cuerpo),
    },
    `crear el formulario web para el banco ${bankId}`,
    opciones,
  )

  return {
    id: cadenaObligatoria(json, 'id', 'el formulario web'),
    url: cadenaObligatoria(json, 'url', 'el formulario web'),
    expiresAt: cadenaObligatoria(json, 'expiresAt', 'el formulario web'),
  }
}

/**
 * Consulta en qué punto va el formulario.
 *
 * Es lo que hace de sustituto del `redirectUrl` que no podemos usar: se sondea
 * hasta que el estado sea final (ver `esEstadoFinal`). Un `COMPLETED` significa
 * que el formulario terminó, **no** que las cuentas estén listas: finAPI lo
 * dice explícitamente y la descarga sigue en segundo plano. Por eso `payload`
 * viaja entero — `bankConnectionId` es lo que sirve para preguntar después.
 */
export async function estadoWebForm(
  tokenUsuario: string,
  formId: string,
  opciones: OpcionesRed = {},
): Promise<FinapiWebFormEstado> {
  const json = await pedirJson(
    `${baseWebForm()}/api/webForms/${encodeURIComponent(formId)}`,
    { method: 'GET', headers: conToken(tokenUsuario) },
    `consultar el formulario web ${formId}`,
    opciones,
  )

  const bruto = json['payload']
  const payload = esObjeto(bruto) ? bruto : {}
  return {
    status: cadenaObligatoria(json, 'status', 'el formulario web'),
    payload: {
      bankConnectionId: cadena(payload, 'bankConnectionId'),
      errorCode: cadena(payload, 'errorCode'),
      errorMessage: cadena(payload, 'errorMessage'),
      crudo: aplanar(payload),
    },
  }
}

// ── Bancos ──────────────────────────────────────────────────────────────────

/**
 * Los bancos de prueba del sandbox, que son los únicos con datos.
 *
 * Se buscan por texto en vez de llevar la lista escrita porque los
 * identificadores del sandbox cambian sin aviso. Los conocidos hoy: 280001
 * finAPI Test Bank, 280002 Test Redirect Bank, 280165 Test Bank Czech Republic.
 */
export async function listarBancosDePrueba(
  token: string,
  opciones: OpcionesRed & { busqueda?: string } = {},
): Promise<FinapiBanco[]> {
  const { base } = configuracion()
  const parametros = new URLSearchParams({
    search: opciones.busqueda ?? 'test',
    isTestBank: 'true',
    perPage: '100',
  })
  const json = await pedirJson(
    `${base}/api/v2/banks?${parametros.toString()}`,
    { method: 'GET', headers: conToken(token) },
    'listar los bancos de prueba',
    opciones,
  )

  return lista(json['banks'], 'la lista de bancos').map((entrada) => {
    const banco = objeto(entrada, 'un banco')
    const interfaces = Array.isArray(banco['interfaces']) ? banco['interfaces'] : []
    return {
      id: enteroSeguro(cadenaObligatoria(banco, 'id', 'un banco'), 'el id del banco'),
      nombre: cadena(banco, 'name') ?? '(sin nombre)',
      interfaces: interfaces
        .map((item) => (esObjeto(item) ? cadena(item, 'bankingInterface') : null))
        .filter((item): item is string => item !== null),
      esDePrueba: cadena(banco, 'isTestBank') === 'true',
      blz: cadena(banco, 'blz'),
      bic: cadena(banco, 'bic'),
      pais: cadena(banco, 'location'),
    }
  })
}

// ── Cuentas ─────────────────────────────────────────────────────────────────

export async function traerCuentas(
  tokenUsuario: string,
  opciones: OpcionesRed = {},
): Promise<FinapiRawAccount[]> {
  const { base } = configuracion()
  const cuentas = await recorrerPaginas({
    base,
    ruta: '/api/v2/accounts',
    parametros: new URLSearchParams({ perPage: '100' }),
    coleccion: 'accounts',
    token: tokenUsuario,
    operacion: 'traer las cuentas',
    opciones,
    // Comprobado contra el sandbox: la respuesta de /accounts trae sólo la
    // clave `accounts`, sin bloque de paginación. Devuelve todas las cuentas
    // del usuario de una vez.
    exigirPaginacion: false,
  })

  return cuentas.map((entrada) => {
    const cuenta = objeto(entrada, 'una cuenta')
    return {
      id: enteroSeguro(cadenaObligatoria(cuenta, 'id', 'una cuenta'), 'el id de la cuenta'),
      bankConnectionId: cadena(cuenta, 'bankConnectionId'),
      accountName: cadena(cuenta, 'accountName'),
      iban: cadena(cuenta, 'iban'),
      accountNumber: cadena(cuenta, 'accountNumber'),
      accountHolderName: cadena(cuenta, 'accountHolderName'),
      // Sin valor por defecto a propósito: ver el comentario en tipos.ts.
      accountCurrency: cadena(cuenta, 'accountCurrency'),
      accountType: cadena(cuenta, 'accountType'),
      // Cadena decimal exacta. Ver la cabecera de json-exacto.ts.
      balance: cadena(cuenta, 'balance'),
      lastSuccessfulUpdate: ultimaLecturaCorrecta(cuenta),
      crudo: aplanar(cuenta),
    }
  })
}

/**
 * La fecha del saldo, sacada de `interfaces[]`.
 *
 * Una cuenta puede estar conectada por XS2A y por FinTS a la vez, cada una con
 * su propia última sincronización. El saldo que devuelve finAPI es el más
 * fresco, así que la fecha que le corresponde es la mayor de las dos. Se
 * comparan como texto porque el formato ISO ya ordena bien y `new Date` de una
 * cadena es justo lo que este proyecto no hace.
 */
function ultimaLecturaCorrecta(cuenta: ObjetoJson): string | null {
  const interfaces = cuenta['interfaces']
  if (!Array.isArray(interfaces)) return null
  let mayor: string | null = null
  for (const item of interfaces) {
    if (!esObjeto(item)) continue
    const fecha = cadena(item, 'lastSuccessfulUpdate')
    if (fecha !== null && (mayor === null || fecha > mayor)) mayor = fecha
  }
  return mayor
}

// ── Movimientos ─────────────────────────────────────────────────────────────

export interface OpcionesMovimientos extends OpcionesRed {
  /** Filtra por cuenta. Vacío o ausente = todas las del usuario. */
  readonly accountIds?: readonly string[]
  /** Sólo desde esta fecha contable, 'YYYY-MM-DD'. */
  readonly desde?: string
  /** Hasta esta fecha contable, inclusive, 'YYYY-MM-DD'. */
  readonly hasta?: string
  readonly porPagina?: number
}

/**
 * Trae **todos** los movimientos, no la primera página.
 *
 * El sandbox devuelve 1.612 en 24 meses. Quedarse con los 500 de la primera
 * página no da un error en ningún sitio: da un informe de reconciliación que
 * cuadra consigo mismo y miente sobre el saldo. Por eso el bucle va hasta
 * `paging.pageCount` y el resultado se comprueba contra `paging.totalCount`.
 *
 * `view=userView` es obligatorio: sin ese parámetro finAPI contesta 400.
 */
export async function traerMovimientos(
  tokenUsuario: string,
  opciones: OpcionesMovimientos = {},
): Promise<FinapiRawTransaction[]> {
  const { base } = configuracion()
  const parametros = new URLSearchParams({
    view: 'userView',
    perPage: String(opciones.porPagina ?? POR_PAGINA_POR_DEFECTO),
    // Orden estable: sin él, dos páginas consecutivas pueden solaparse o
    // saltarse filas si el servidor reordena entre llamadas.
    order: 'id,asc',
  })
  if (opciones.accountIds !== undefined && opciones.accountIds.length > 0) {
    parametros.set('accountIds', opciones.accountIds.join(','))
  }
  if (opciones.desde !== undefined) parametros.set('minBankBookingDate', opciones.desde)
  if (opciones.hasta !== undefined) parametros.set('maxBankBookingDate', opciones.hasta)

  const filas = await recorrerPaginas({
    base,
    ruta: '/api/v2/transactions',
    parametros,
    coleccion: 'transactions',
    token: tokenUsuario,
    operacion: 'traer los movimientos',
    opciones,
    // Acá sí: son cuatro páginas de 500 en el sandbox, y quedarse en la primera
    // es exactamente el fallo que produce un informe que cuadra y miente.
    exigirPaginacion: true,
  })

  return filas.map((entrada) => {
    const movimiento = objeto(entrada, 'un movimiento')
    const categoria = movimiento['category']
    return {
      id: enteroSeguro(
        cadenaObligatoria(movimiento, 'id', 'un movimiento'),
        'el id del movimiento',
      ),
      accountId: enteroSeguro(
        cadenaObligatoria(movimiento, 'accountId', 'un movimiento'),
        'el accountId del movimiento',
      ),
      // El campo que justifica todo este módulo: llega como la cadena exacta
      // del cuerpo HTTP, sin haber sido nunca un `number`.
      amount: cadenaObligatoria(movimiento, 'amount', 'un movimiento'),
      // Vacía y no 'EUR' si no viene: el mapeador compara esta moneda con la
      // de la cuenta y avisa cuando difieren. Inventarla anula el aviso.
      currency: cadena(movimiento, 'currency') ?? '',
      valueDate: cadena(movimiento, 'valueDate'),
      bankBookingDate: cadena(movimiento, 'bankBookingDate'),
      finapiBookingDate: cadena(movimiento, 'finapiBookingDate'),
      purpose: cadena(movimiento, 'purpose'),
      cleanedPurpose: cadena(movimiento, 'cleanedPurpose'),
      counterpartName: cadena(movimiento, 'counterpartName'),
      counterpartIban: cadena(movimiento, 'counterpartIban'),
      counterpartBic: cadena(movimiento, 'counterpartBic'),
      counterpartAccountNumber: cadena(movimiento, 'counterpartAccountNumber'),
      counterpartBankName: cadena(movimiento, 'counterpartBankName'),
      type: cadena(movimiento, 'type'),
      typeCodeZka: cadena(movimiento, 'typeCodeZka'),
      category: leerCategoria(categoria),
      isPotentialDuplicate: cadena(movimiento, 'isPotentialDuplicate') === 'true',
      crudo: aplanar(movimiento),
    }
  })
}

/**
 * La categoría de finAPI, si trae las dos mitades.
 *
 * Media categoría —id sin nombre, o al revés— no sirve para nada y ensucia el
 * informe, así que se descarta. El objeto completo sigue en `crudo` de todas
 * formas, que es donde hay que mirar si alguna vez hace falta.
 */
function leerCategoria(valor: ValorJson | undefined): { id: number; name: string } | null {
  if (!esObjeto(valor)) return null
  const id = cadena(valor, 'id')
  const nombre = cadena(valor, 'name')
  if (id === null || nombre === null) return null
  return { id: enteroSeguro(id, 'el id de la categoría'), name: nombre }
}

// ── Paginación ──────────────────────────────────────────────────────────────

interface PeticionPaginada {
  readonly base: string
  readonly ruta: string
  readonly parametros: URLSearchParams
  readonly coleccion: string
  readonly token: string
  readonly operacion: string
  readonly opciones: OpcionesRed
  /**
   * Si el endpoint pagina de verdad. Con `true`, una respuesta sin `paging` es
   * un error en vez de un final de datos: es la diferencia entre traer 1.612
   * movimientos y traer 500 creyendo que son todos.
   */
  readonly exigirPaginacion: boolean
}

/**
 * Recorre todas las páginas de un listado de finAPI.
 *
 * El número de páginas sale de `paging.pageCount` y no de "hasta que venga una
 * vacía": con la segunda regla, un fallo intermitente en la página 3 de 4
 * pasaría por final de los datos y el lote entraría incompleto.
 */
async function recorrerPaginas(peticion: PeticionPaginada): Promise<ValorJson[]> {
  const acumulado: ValorJson[] = []
  let pagina = 1
  let totalPaginas = 1
  let totalDeclarado: number | null = null

  while (pagina <= totalPaginas && pagina <= MAX_PAGINAS) {
    const parametros = new URLSearchParams(peticion.parametros)
    parametros.set('page', String(pagina))

    const json = await pedirJson(
      `${peticion.base}${peticion.ruta}?${parametros.toString()}`,
      { method: 'GET', headers: conToken(peticion.token) },
      `${peticion.operacion} (página ${pagina})`,
      peticion.opciones,
    )

    acumulado.push(
      ...lista(json[peticion.coleccion], `${peticion.coleccion} en la página ${pagina}`),
    )

    const paging = json['paging']
    if (!esObjeto(paging)) {
      // Sin `paging` no hay `pageCount` ni `totalCount`, así que la
      // comprobación de abajo tampoco corre: la primera página se toma por el
      // total y nadie se entera. Dónde eso importa depende del endpoint, y por
      // eso el llamador lo declara en vez de que se adivine acá.
      //
      // `GET /accounts` **no pagina**: comprobado contra el sandbox, la
      // respuesta trae sólo la clave `accounts`. `GET /transactions` sí, y ahí
      // quedarse en la primera página son 500 movimientos de 1.612 con un
      // informe que cuadra consigo mismo y miente sobre el banco.
      if (peticion.exigirPaginacion) {
        throw new FinapiError(
          peticion.operacion,
          `La página ${pagina} llegó sin bloque "paging", así que no hay forma de saber si es la ` +
            'única. No se importa un lote que no se puede verificar.',
          null,
          null,
        )
      }
      break
    }
    const cuenta = cadena(paging, 'pageCount')
    if (cuenta !== null) totalPaginas = enteroSeguro(cuenta, 'paging.pageCount')
    const total = cadena(paging, 'totalCount')
    if (total !== null) totalDeclarado = enteroSeguro(total, 'paging.totalCount')
    pagina += 1
  }

  if (pagina > MAX_PAGINAS && pagina <= totalPaginas) {
    throw new FinapiError(
      peticion.operacion,
      `finAPI declara ${totalPaginas} páginas y el tope de seguridad es ${MAX_PAGINAS}. ` +
        'Acotá el rango de fechas en vez de traer todo de una vez.',
      null,
      null,
    )
  }

  // Un lote incompleto que nadie detecta se convierte en un informe que cuadra
  // consigo mismo y no con el banco. Mejor fallar acá.
  if (totalDeclarado !== null && acumulado.length !== totalDeclarado) {
    throw new FinapiError(
      peticion.operacion,
      `finAPI declaró ${totalDeclarado} elementos y llegaron ${acumulado.length}. ` +
        'No se importa un lote incompleto.',
      null,
      null,
    )
  }

  return acumulado
}
