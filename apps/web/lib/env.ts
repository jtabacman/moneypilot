/**
 * Configuración leída del entorno, con verificación al arrancar.
 *
 * Los nombres no son inventados: son exactamente los que inyecta la
 * integración de Supabase en Vercel. Elegir nombres propios obligaría a
 * duplicar cada variable a mano, que es el trabajo manual que la integración
 * existe para evitar.
 *
 * Cada valor acepta alternativas porque Supabase envía a la vez la
 * nomenclatura nueva (publishable/secret) y la legacy (anon/service_role).
 *
 * Los accesores están **separados por lo que hace falta cada vez**, no
 * agrupados en uno solo: la pantalla de inicio de sesión necesita Supabase
 * pero no la base de datos. Con un accesor único que lo exigiera todo, el
 * login se cae por una variable que ni siquiera usa — que es exactamente lo
 * que pasó la primera vez que se construyó esto.
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

// ── Autenticación ───────────────────────────────────────────────────────────

export interface SupabaseEnv {
  readonly url: string
  readonly publishableKey: string
}

export function supabaseEnv(): SupabaseEnv {
  return {
    url: require_(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'], 'Es la URL del proyecto.'),
    publishableKey: require_(
      [
        'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY',
        'SUPABASE_ANON_KEY',
      ],
      'Es la clave pública; viaja al navegador y no es secreta.',
    ),
  }
}

export function hasSupabaseAuth(): boolean {
  return (
    read('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL') !== undefined &&
    read(
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_ANON_KEY',
    ) !== undefined
  )
}

/**
 * La clave privada. Saltea Row Level Security, así que sólo se pide donde de
 * verdad haga falta operar por encima del usuario — hoy, en ningún sitio.
 */
export function supabaseSecretKey(): string {
  return require_(
    ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
    'Es la clave privada. NUNCA debe llegar al navegador.',
  )
}

// ── Base de datos ───────────────────────────────────────────────────────────

export interface ConnectionCheck {
  readonly pooled: boolean
  readonly port: string | null
  readonly host: string | null
  readonly warning: string | null
}

/**
 * Comprueba que la cadena apunte al pooler de transacciones y no a la
 * conexión directa.
 *
 * En serverless cada invocación abre su propia conexión. Contra el puerto
 * directo (5432) eso agota el límite de Postgres bajo cualquier carga real, y
 * el fallo aparece como timeouts intermitentes, de los peores de diagnosticar.
 *
 * El pooler en modo transacción es seguro para nosotros precisamente porque
 * `withTenant` fija el rol y el hogar con alcance de transacción: una variable
 * de sesión se filtraría entre hogares al reciclarse la conexión.
 */
export function inspectConnectionString(url: string): ConnectionCheck {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { pooled: false, port: null, host: null, warning: 'No es una URL válida.' }
  }

  const host = parsed.hostname
  const port = parsed.port === '' ? null : parsed.port
  if (host.includes('pooler.supabase.com') && port === '6543') {
    return { pooled: true, port, host, warning: null }
  }
  if (port === '5432') {
    return {
      pooled: false,
      port,
      host,
      warning:
        'La cadena apunta al puerto 5432 (conexión directa o session pooler). ' +
        'En serverless hay que usar el transaction pooler (6543): cada invocación abre ' +
        'su propia conexión y el directo agota el límite de Postgres.',
    }
  }
  return {
    pooled: false,
    port,
    host,
    warning: `No se reconoció el modo de conexión (host ${host}, puerto ${port ?? 'por defecto'}).`,
  }
}

let warned = false

export function databaseUrl(): string {
  const url = require_(
    ['POSTGRES_URL', 'DATABASE_URL'],
    'Es la cadena de conexión a Postgres, en modo transaction pooler.',
  )
  if (!warned) {
    warned = true
    const check = inspectConnectionString(url)
    if (check.warning !== null) {
      // Aviso y no error: en desarrollo local contra Docker el host es otro y
      // está bien. Lo que no puede pasar es que nadie se entere en producción.
      console.warn(`[moneypilot] conexión a Postgres: ${check.warning}`)
    }
  }
  return url
}

export function hasDatabase(): boolean {
  return read('POSTGRES_URL', 'DATABASE_URL') !== undefined
}
