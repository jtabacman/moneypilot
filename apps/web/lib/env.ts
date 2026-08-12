/**
 * Configuración leída del entorno, con verificación al arrancar.
 *
 * Los nombres no son inventados: son exactamente los que inyecta la
 * integración de Supabase en Vercel. Elegir nombres propios obligaría a
 * duplicar cada variable a mano, que es el trabajo manual que la integración
 * existe para evitar.
 *
 * Cada valor tiene alternativas porque Supabase envía a la vez la
 * nomenclatura nueva (publishable/secret) y la legacy (anon/service_role).
 * Se prefiere la nueva; la vieja queda como respaldo mientras dure.
 *
 * Ninguna función de acá devuelve un secreto a nadie que no lo necesite: el
 * módulo entero es de servidor, y las claves públicas están separadas de las
 * privadas para que no puedan confundirse por accidente.
 */

import 'server-only'

function read(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]
    if (value !== undefined && value.trim() !== '') return value.trim()
  }
  return undefined
}

function require_(names: string[], hint: string): string {
  const value = read(...names)
  if (value === undefined) {
    throw new Error(
      `Falta la variable de entorno ${names[0]}.\n${hint}\n` +
        'Si el proyecto está en Vercel, la pone la integración de Supabase ' +
        '(Supabase → Project Settings → Integrations → Vercel).',
    )
  }
  return value
}

/**
 * Comprueba que la cadena apunte al pooler de transacciones y no a la
 * conexión directa.
 *
 * Por qué importa lo suficiente como para fallar el arranque: en serverless,
 * cada invocación abre su propia conexión. Contra el puerto directo (5432) eso
 * agota el límite de Postgres bajo cualquier carga real, y el fallo aparece
 * como timeouts intermitentes que son un infierno de diagnosticar.
 *
 * El pooler en modo transacción es seguro para nosotros precisamente porque
 * `withTenant` fija `app.tenant_id` con alcance de transacción: una variable
 * de sesión se filtraría entre hogares al reciclarse la conexión.
 */
export interface ConnectionCheck {
  readonly pooled: boolean
  readonly port: string | null
  readonly host: string | null
  readonly warning: string | null
}

export function inspectConnectionString(url: string): ConnectionCheck {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { pooled: false, port: null, host: null, warning: 'No es una URL válida.' }
  }

  const host = parsed.hostname
  const port = parsed.port === '' ? null : parsed.port
  const pooled = host.includes('pooler.supabase.com') && port === '6543'

  if (pooled) return { pooled, port, host, warning: null }

  if (port === '5432') {
    return {
      pooled: false,
      port,
      host,
      warning:
        'La cadena apunta al puerto 5432 (conexión directa o session pooler). ' +
        'En serverless hay que usar el transaction pooler (6543): cada invocación ' +
        'abre su propia conexión y el directo agota el límite de Postgres.',
    }
  }

  return {
    pooled: false,
    port,
    host,
    warning: `No se reconoció el modo de conexión (host ${host}, puerto ${port ?? 'por defecto'}).`,
  }
}

let cached: ServerEnv | null = null

export interface ServerEnv {
  readonly databaseUrl: string
  readonly supabaseUrl: string
  readonly supabasePublishableKey: string
  readonly supabaseSecretKey: string
  readonly connection: ConnectionCheck
}

export function serverEnv(): ServerEnv {
  if (cached !== null) return cached

  const databaseUrl = require_(
    ['POSTGRES_URL', 'DATABASE_URL'],
    'Es la cadena de conexión a Postgres, en modo transaction pooler.',
  )
  const connection = inspectConnectionString(databaseUrl)
  if (connection.warning !== null) {
    // Aviso, no error: en desarrollo local contra Docker el host es otro y
    // está bien. Lo que no puede pasar es que nadie se entere en producción.
    console.warn(`[moneypilot] conexión a Postgres: ${connection.warning}`)
  }

  cached = {
    databaseUrl,
    connection,
    supabaseUrl: require_(
      ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'],
      'Es la URL del proyecto de Supabase.',
    ),
    supabasePublishableKey: require_(
      [
        'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY',
        'SUPABASE_ANON_KEY',
      ],
      'Es la clave pública; viaja al navegador y no es secreta.',
    ),
    supabaseSecretKey: require_(
      ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
      'Es la clave privada. NUNCA debe llegar al navegador: saltea Row Level Security.',
    ),
  }
  return cached
}

/** ¿Está configurado el entorno? Para degradar en vez de romper la página. */
export function isConfigured(): boolean {
  return (
    read('POSTGRES_URL', 'DATABASE_URL') !== undefined &&
    read('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL') !== undefined
  )
}
