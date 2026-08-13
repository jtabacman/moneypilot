/**
 * El catálogo de bancos de prueba, con caché en memoria del proceso.
 *
 * La lista es la misma para todos los hogares y no cambia en meses. Sin caché,
 * cada visita a /importar —que es `force-dynamic`— sería un token más una
 * llamada al catálogo antes de pintar la pantalla de subir ficheros, que no
 * tiene nada que ver con el feed. Una pantalla que ya funciona no puede
 * volverse lenta por una función que casi nadie usa.
 *
 * Y por el mismo motivo `catalogoDePrueba` **no lanza**: devuelve el fallo
 * como dato. Si finAPI está caído o faltan las credenciales, /importar tiene
 * que seguir dejando subir un extracto.
 */

import { faltanCredenciales, listarBancosDePrueba, tokenDeCliente } from './client'
import { FinapiError } from './errores'
import type { FinapiBanco } from './tipos'

/** Diez minutos. El catálogo de bancos de prueba no se mueve más rápido. */
const VIDA_MS = 10 * 60 * 1000

/** Corto: esto corre mientras alguien espera a que se pinte una página. */
const TIMEOUT_MS = 8000

interface EnCache {
  readonly bancos: readonly FinapiBanco[]
  readonly expiraEn: number
}

let cache: EnCache | null = null

export type Catalogo =
  | { readonly kind: 'ok'; readonly bancos: readonly FinapiBanco[] }
  /** Faltan variables de entorno. No es un fallo: es que no está configurado. */
  | { readonly kind: 'sin-credenciales'; readonly faltan: readonly string[] }
  | { readonly kind: 'error'; readonly detalle: string }

/** Para los tests, y para forzar una relectura tras cambiar el entorno. */
export function olvidarCatalogo(): void {
  cache = null
}

export async function catalogoDePrueba(): Promise<Catalogo> {
  const faltan = faltanCredenciales()
  if (faltan.length > 0) return { kind: 'sin-credenciales', faltan }

  const ahora = Date.now()
  if (cache !== null && cache.expiraEn > ahora) return { kind: 'ok', bancos: cache.bancos }

  try {
    const token = await tokenDeCliente({ timeoutMs: TIMEOUT_MS })
    const bancos = ordenar(await listarBancosDePrueba(token, { timeoutMs: TIMEOUT_MS }))
    cache = { bancos, expiraEn: ahora + VIDA_MS }
    return { kind: 'ok', bancos }
  } catch (error) {
    return { kind: 'error', detalle: detalle(error) }
  }
}

/**
 * Los que sabemos que tienen datos, primero.
 *
 * No es cosmética: el catálogo de prueba trae decenas de bancos y sólo unos
 * pocos devuelven movimientos. Que el primero de la lista sea uno que funciona
 * es la diferencia entre probar esto en dos minutos y abandonarlo.
 */
const CONOCIDOS: readonly number[] = [280001, 280002, 280165]

function ordenar(bancos: readonly FinapiBanco[]): FinapiBanco[] {
  return [...bancos].sort((a, b) => {
    const pa = CONOCIDOS.indexOf(a.id)
    const pb = CONOCIDOS.indexOf(b.id)
    if (pa !== pb) return (pa === -1 ? CONOCIDOS.length : pa) - (pb === -1 ? CONOCIDOS.length : pb)
    return a.nombre.localeCompare(b.nombre, 'es')
  })
}

function detalle(error: unknown): string {
  if (error instanceof FinapiError) return error.message
  return error instanceof Error ? error.message : 'No se pudo leer el catálogo de finAPI.'
}
