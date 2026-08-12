/**
 * Aplica las migraciones antes de construir la web.
 *
 * Por qué acá y no en un paso aparte: las credenciales de la base están
 * marcadas como sensibles en Vercel, así que ni la CLI ni nadie fuera del
 * entorno de ejecución puede leerlas. El build es el único sitio donde la
 * cadena de conexión existe de verdad. La alternativa —un endpoint que migre—
 * sería una URL viva capaz de cambiar el esquema, que es bastante peor.
 *
 * El coste de esta decisión es real y conviene tenerlo escrito: el esquema
 * cambia en el mismo instante que el código, y revertir un despliegue NO
 * revierte la migración. Con cero clientes es asumible. Cuando haya datos de
 * alguien que no seamos nosotros, esto pasa a ser un paso deliberado.
 *
 * Si no hay base configurada, no falla: avisa y sigue. Los previews no tienen
 * las variables sincronizadas, y no tiene sentido que un preview no compile
 * por una base que no va a usar.
 */

import { migrate } from '@moneypilot/db/migrate'

const url =
  pick('POSTGRES_URL') ?? pick('DATABASE_URL') ?? pick('POSTGRES_URL_NON_POOLING') ?? null

function pick(name) {
  const value = process.env[name]
  return value !== undefined && value.trim() !== '' ? value.trim() : undefined
}

if (url === null) {
  console.log('[migrate] sin cadena de conexión: no hay nada que migrar. Sigo con el build.')
  process.exit(0)
}

// Nunca imprimir la cadena entera: lleva la contraseña.
let where = '(destino no interpretable)'
try {
  const parsed = new URL(url)
  where = `${parsed.hostname}:${parsed.port === '' ? '5432' : parsed.port}`
} catch {
  /* si no parsea, el fallo real va a salir al conectar */
}

console.log(`[migrate] aplicando migraciones contra ${where}`)

try {
  const { applied, skipped } = await migrate(url)
  console.log(
    `[migrate] aplicadas: ${applied.length === 0 ? '(ninguna)' : applied.join(', ')} · ` +
      `ya estaban: ${skipped.length}`,
  )
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[migrate] FALLÓ: ${message}`)
  if (message.includes('ENETUNREACH') || message.includes('ENOTFOUND')) {
    console.error(
      '[migrate] pista: la conexión directa de Supabase (db.<ref>.supabase.co:5432) es ' +
        'sólo IPv6 y Vercel no la alcanza. Hay que usar el pooler (…pooler.supabase.com:6543).',
    )
  }
  // Sí frena el build: desplegar código que espera un esquema que no existe
  // produce errores en producción en vez de un build rojo, que es peor.
  process.exit(1)
}
