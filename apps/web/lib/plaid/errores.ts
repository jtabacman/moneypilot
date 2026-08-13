/**
 * Un error de Plaid, traducido a algo que se pueda enseñar.
 *
 * Plaid es más ordenado que finAPI: contesta siempre con la misma forma, sea
 * cual sea el endpoint, y con HTTP 400 para casi todo.
 *
 *     {"error_type":"ITEM_ERROR","error_code":"ITEM_LOGIN_REQUIRED",
 *      "error_message":"the login details of this item have changed...",
 *      "display_message":"The credentials were updated...",
 *      "documentation_url":"https://plaid.com/docs/errors/item/...",
 *      "suggested_action":null,"request_id":"..."}
 *
 * Que la forma sea fija no quiere decir que se pueda soltar tal cual en una
 * pantalla. Los tres campos de texto dicen cosas distintas y a públicos
 * distintos:
 *
 *   - `display_message` está escrito para la persona, pero viene `null` en la
 *     mayoría de los errores —comprobado contra el sandbox: los de entrada lo
 *     traen vacío—, así que no se puede depender de él.
 *   - `error_message` es para quien programa, siempre viene, y en inglés.
 *   - `suggested_action` dice qué hacer y también suele ser `null`.
 *
 * De ahí el orden: la persona primero, el detalle técnico si no hay otra cosa,
 * y siempre el par `error_type/error_code` detrás, porque es lo único que se
 * puede buscar en su documentación y lo único sobre lo que se puede programar.
 *
 * Y como en finAPI: lo que hace falta saber siempre es **qué se estaba
 * intentando** cuando falló. Un `INVALID_ACCESS_TOKEN` a secas no le dice nada
 * a nadie; "no se pudo traer las cuentas" sí.
 */

export class PlaidError extends Error {
  constructor(
    /** En infinitivo: "traer las cuentas", "crear el link token". */
    readonly operacion: string,
    readonly detalle: string,
    readonly status: number | null,
    /** `ITEM_LOGIN_REQUIRED`, `PRODUCT_NOT_READY`… `null` si no fue de Plaid. */
    readonly errorCode: string | null,
    /** `ITEM_ERROR`, `INVALID_INPUT`, `RATE_LIMIT_EXCEEDED`… */
    readonly errorType: string | null,
    /** El identificador de la petición. Es lo que pide su soporte. */
    readonly requestId: string | null,
    /** El cuerpo crudo, recortado. Para el log, no para la pantalla. */
    readonly cuerpo: string | null,
  ) {
    const codigo = status === null ? '' : ` (HTTP ${status})`
    super(`Plaid: no se pudo ${operacion}${codigo}. ${detalle}`)
    this.name = 'PlaidError'
  }
}

/**
 * Un fallo que detectamos nosotros antes de salir a la red, o al leer una
 * respuesta que no tiene sentido.
 *
 * Existe para no escribir cinco `null` seguidos en cada sitio: no hay código
 * HTTP ni `error_code` porque Plaid no llegó a opinar.
 */
export function errorLocal(operacion: string, detalle: string): PlaidError {
  return new PlaidError(operacion, detalle, null, null, null, null, null)
}

const RECORTE = 400

/**
 * El código de error que significa "la conexión con el banco se cayó y hay que
 * volver a pasar por Link".
 *
 * Se distingue del resto porque no es un fallo nuestro ni algo que se arregle
 * reintentando: hasta que la persona no vuelva a autenticarse no va a haber un
 * solo movimiento nuevo, y una sincronización que falle en silencio produce
 * justo lo peor — un informe que cuadra consigo mismo mientras el banco sigue
 * teniendo movimientos que nosotros no. `forzarReautenticacion` existe para
 * poder probar este camino en el sandbox.
 */
export const CODIGO_REAUTENTICACION = 'ITEM_LOGIN_REQUIRED'

export function necesitaReautenticacion(error: unknown): boolean {
  return error instanceof PlaidError && error.errorCode === CODIGO_REAUTENTICACION
}

interface CamposDeError {
  readonly detalle: string
  readonly errorCode: string | null
  readonly errorType: string | null
  readonly requestId: string | null
}

function texto(valor: unknown): string | null {
  if (typeof valor === 'string' && valor.trim() !== '') return valor.trim()
  if (typeof valor === 'number') return String(valor)
  return null
}

/**
 * Saca de un cuerpo de error de Plaid lo que hay que enseñar y lo que hay que
 * poder programar.
 *
 * Se usa `JSON.parse` normal a propósito: acá no hay dinero, y si el cuerpo no
 * es JSON —una página de error de un balanceador, por ejemplo— se devuelve
 * recortado tal cual, que sigue siendo más útil que "error desconocido".
 */
export function camposDeError(cuerpo: string): CamposDeError {
  const limpio = cuerpo.trim()
  const vacio = { errorCode: null, errorType: null, requestId: null }
  if (limpio === '') return { detalle: 'El servidor no dijo por qué.', ...vacio }

  let json: unknown
  try {
    json = JSON.parse(limpio)
  } catch {
    return { detalle: limpio.slice(0, RECORTE), ...vacio }
  }
  if (typeof json !== 'object' || json === null) {
    return { detalle: limpio.slice(0, RECORTE), ...vacio }
  }

  const raiz = json as Record<string, unknown>
  const errorCode = texto(raiz['error_code'])
  const errorType = texto(raiz['error_type'])
  const requestId = texto(raiz['request_id'])

  // Para la persona primero; el mensaje técnico sólo si no hay otro.
  const mensaje = texto(raiz['display_message']) ?? texto(raiz['error_message'])
  const sugerencia = texto(raiz['suggested_action'])

  const partes: string[] = []
  if (mensaje !== null) partes.push(mensaje)
  if (sugerencia !== null) partes.push(sugerencia)
  if (errorCode !== null || errorType !== null) {
    partes.push(`[${errorType ?? '?'}/${errorCode ?? '?'}]`)
  }
  if (partes.length === 0) partes.push(limpio.slice(0, RECORTE))

  return { detalle: partes.join(' ').slice(0, RECORTE), errorCode, errorType, requestId }
}

/**
 * Traduce un fallo de `fetch` a algo accionable.
 *
 * Importa distinguirlos: un timeout se reintenta, un DNS que no resuelve es una
 * variable de entorno mal puesta y no se arregla esperando.
 */
export function detalleDeRed(error: unknown, timeoutMs: number): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return `Plaid no contestó en ${Math.round(timeoutMs / 1000)} s y se cortó la llamada.`
  }
  const causa = error instanceof Error && error.cause instanceof Error ? error.cause.message : null
  const mensaje = error instanceof Error ? error.message : String(error)
  return `No se pudo llegar al servidor: ${causa ?? mensaje}`
}
