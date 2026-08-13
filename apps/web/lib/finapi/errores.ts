/**
 * Un error de finAPI, traducido a algo que se pueda enseñar.
 *
 * finAPI contesta en cuatro formas distintas y en dos idiomas. El Access API
 * manda `{"errors":[{"message":"Für diesen Client sind direkte API-Aufrufe
 * nicht zulässig",...}]}`, el Web Form manda `{"code":"INVALID_REDIRECT_URL",
 * "description":...}`, el servidor de OAuth manda `{"error":"unauthorized",
 * "error_description":...}` y cuando algo se rompe de verdad contesta el
 * Spring de debajo con `{"status":404,"error":"Not Found","path":...}`.
 *
 * Dejar cualquiera de esas cuatro cosas subir tal cual hasta una pantalla es
 * inútil para quien la lee. Lo que hace falta saber siempre es **qué se estaba
 * intentando** cuando falló; el texto del servidor, aunque venga en alemán, va
 * detrás y sin tocar, porque es la única pista para buscarlo en su
 * documentación.
 */

export class FinapiError extends Error {
  constructor(
    /** En infinitivo: "traer los movimientos", "crear el formulario web". */
    readonly operacion: string,
    readonly detalle: string,
    readonly status: number | null,
    /** El cuerpo crudo, recortado. Para el log, no para la pantalla. */
    readonly cuerpo: string | null,
  ) {
    const codigo = status === null ? '' : ` (HTTP ${status})`
    super(`finAPI: no se pudo ${operacion}${codigo}. ${detalle}`)
    this.name = 'FinapiError'
  }
}

const RECORTE = 400

function texto(valor: unknown): string | null {
  if (typeof valor === 'string' && valor.trim() !== '') return valor.trim()
  if (typeof valor === 'number') return String(valor)
  return null
}

/**
 * Saca el mensaje humano del cuerpo de error.
 *
 * Se usa `JSON.parse` normal a propósito: acá no hay dinero, y si el cuerpo no
 * es JSON —una página de error de un proxy, por ejemplo— se devuelve recortado
 * tal cual, que sigue siendo más útil que "error desconocido".
 */
export function detalleDeError(cuerpo: string): string {
  const limpio = cuerpo.trim()
  if (limpio === '') return 'El servidor no dijo por qué.'

  let json: unknown
  try {
    json = JSON.parse(limpio)
  } catch {
    return limpio.slice(0, RECORTE)
  }
  if (typeof json !== 'object' || json === null) return limpio.slice(0, RECORTE)

  const raiz = json as Record<string, unknown>

  // Access API, y también el Web Form cuando rechaza un campo del cuerpo.
  const errores = raiz['errors']
  if (Array.isArray(errores) && errores.length > 0) {
    const partes = errores.map((entrada) => {
      if (typeof entrada !== 'object' || entrada === null) return String(entrada)
      const item = entrada as Record<string, unknown>
      const mensaje = texto(item['message']) ?? texto(item['description']) ?? 'error sin mensaje'
      const campo = texto(item['field'])
      const codigo = texto(item['code'])
      const prefijo = campo === null ? '' : `${campo}: `
      const sufijo = codigo === null ? '' : ` [${codigo}]`
      return `${prefijo}${mensaje}${sufijo}`
    })
    return partes.join(' | ').slice(0, RECORTE)
  }

  // Web Form 2.0.
  const descripcion = texto(raiz['description'])
  const codigo = texto(raiz['code'])
  if (descripcion !== null) {
    return `${descripcion}${codigo === null ? '' : ` [${codigo}]`}`.slice(0, RECORTE)
  }

  // OAuth.
  const oauth = texto(raiz['error_description'])
  const claseOauth = texto(raiz['error'])
  if (oauth !== null) {
    return `${oauth}${claseOauth === null ? '' : ` [${claseOauth}]`}`.slice(0, RECORTE)
  }

  // Spring por debajo: {"status":404,"error":"Not Found","path":"/..."}.
  if (claseOauth !== null) {
    const ruta = texto(raiz['path'])
    return `${claseOauth}${ruta === null ? '' : ` en ${ruta}`}`.slice(0, RECORTE)
  }

  if (codigo !== null) return codigo.slice(0, RECORTE)
  return limpio.slice(0, RECORTE)
}

/**
 * Traduce un fallo de `fetch` a algo accionable.
 *
 * Importa distinguirlos: un timeout se reintenta, un DNS que no resuelve es
 * una variable de entorno mal puesta y no se arregla esperando.
 */
export function detalleDeRed(error: unknown, timeoutMs: number): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return `finAPI no contestó en ${Math.round(timeoutMs / 1000)} s y se cortó la llamada.`
  }
  const causa = error instanceof Error && error.cause instanceof Error ? error.cause.message : null
  const mensaje = error instanceof Error ? error.message : String(error)
  return `No se pudo llegar al servidor: ${causa ?? mensaje}`
}
