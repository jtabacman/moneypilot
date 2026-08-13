'use server'

import { revalidatePath } from 'next/cache'
import { readHousehold, writeHousehold } from '@/lib/data'

/**
 * Lectura y gobierno de las membresías del hogar.
 *
 * Dos cosas que se comprobaron contra la base y condicionan todo lo de abajo:
 *
 *  1. **`membership` no está aislada por hogar sino por persona.** Su única
 *     policy es `membership_own`, que filtra `user_id = app.user_id` — tiene
 *     que ser así porque es la tabla que decide el aislamiento y no puede
 *     depender de `app.tenant_id` sin resolverse en círculo. Consecuencia
 *     práctica: un `select` sin `where tenant_id` devolvería las membresías
 *     de esta persona en TODOS sus hogares. Por eso acá sí se filtra por
 *     hogar a mano, al revés que en el resto del repositorio.
 *
 *  2. **Hoy sólo se ve la membresía propia.** Sembradas cinco personas en un
 *     hogar de prueba, la consulta devuelve una. No es un bug de la consulta:
 *     falta una policy que abra la tabla a quien pertenece al hogar. Se
 *     detecta en tiempo de ejecución (`alcanceMembresia`) en vez de darlo por
 *     supuesto, para que la pantalla deje de disculparse sola el día que esa
 *     policy exista.
 */

export type EstadoAcceso = 'activa' | 'por-caducar' | 'caducada' | 'revocada' | 'sin-caducidad'

export interface Acceso {
  readonly id: string
  readonly rol: string
  readonly email: string | null
  readonly usuario: string
  readonly desde: string
  readonly caduca: string | null
  readonly revocada: string | null
  readonly estado: EstadoAcceso
  /** Días que faltan para caducar. Null si no caduca o ya caducó. */
  readonly dias: number | null
  readonly soyYo: boolean
}

export interface PolicyMembership {
  readonly nombre: string
  readonly comando: string
  readonly expresion: string
}

export interface PanelAccesos {
  readonly hogar: string
  readonly correoPropio: string | null
  readonly rolPropio: string
  readonly accesos: readonly Acceso[]
  readonly policies: readonly PolicyMembership[]
  /** ¿Alguna policy abre `membership` al hogar entero? Hoy, no. */
  readonly rosterCompleto: boolean
}

interface AccesoRow {
  readonly id: string
  readonly role: string
  readonly email: string | null
  readonly user_id: string
  readonly created_on: string
  readonly expires_on: string | null
  readonly revoked_on: string | null
  readonly estado: string
  readonly dias: number | null
  readonly soy_yo: boolean
}

interface PolicyRow {
  readonly policyname: string
  readonly cmd: string
  readonly qual: string | null
}

const ESTADOS: readonly EstadoAcceso[] = [
  'activa',
  'por-caducar',
  'caducada',
  'revocada',
  'sin-caducidad',
]

function comoEstado(valor: string): EstadoAcceso {
  return ESTADOS.find((estado) => estado === valor) ?? 'activa'
}

/**
 * El estado se calcula en SQL y no en Node a propósito: el reloj que decide
 * si un acceso caducó tiene que ser el mismo que aplica la policy de la base
 * (`expires_at > now()`), o habría accesos que la pantalla da por vivos y la
 * base rechaza.
 */
export async function listarAccesos(): Promise<PanelAccesos> {
  const { session, data } = await readHousehold(async (client) => {
    // En serie: las dos van por el mismo cliente —una transacción, una
    // conexión—, así que pg las encola igual. Promise.all daba paralelismo
    // aparente y un aviso de query concurrente sobre un cliente ocupado, que
    // en pg@9 será un error.
    const accesos = await client.query<AccesoRow>(
      `select m.id,
              m.role::text as role,
              m.email,
              m.user_id,
              to_char(m.created_at, 'YYYY-MM-DD') as created_on,
              to_char(m.expires_at, 'YYYY-MM-DD') as expires_on,
              to_char(m.revoked_at, 'YYYY-MM-DD') as revoked_on,
              case
                when m.revoked_at is not null                    then 'revocada'
                when m.expires_at is null                        then 'sin-caducidad'
                when m.expires_at <= now()                       then 'caducada'
                when m.expires_at <= now() + interval '14 days'  then 'por-caducar'
                else 'activa'
              end as estado,
              case
                when m.expires_at is null or m.expires_at <= now() then null
                else ceil(extract(epoch from (m.expires_at - now())) / 86400)::int
              end as dias,
              (m.user_id = nullif(current_setting('app.user_id', true), '')::uuid) as soy_yo
         from membership m
        where m.tenant_id = app_current_tenant()
        order by (m.revoked_at is not null), m.role, m.created_at`,
    )
    const policies = await client.query<PolicyRow>(
      `select policyname, cmd, qual
         from pg_policies
        where schemaname = 'public' and tablename = 'membership'
        order by policyname`,
    )

    return { accesos: accesos.rows, policies: policies.rows }
  })

  const policies = data.policies.map((row) => ({
    nombre: row.policyname,
    comando: row.cmd,
    expresion: row.qual ?? '(sin condición)',
  }))

  return {
    hogar: session.householdName,
    correoPropio: session.user.email,
    rolPropio: session.role,
    accesos: data.accesos.map((row) => ({
      id: row.id,
      rol: row.role,
      email: row.email,
      usuario: row.user_id,
      desde: row.created_on,
      caduca: row.expires_on,
      revocada: row.revoked_on,
      estado: comoEstado(row.estado),
      dias: row.dias,
      soyYo: row.soy_yo,
    })),
    policies,
    rosterCompleto: policies.some(
      (policy) =>
        policy.expresion.includes('app.tenant_id') ||
        policy.expresion.includes('app_current_tenant'),
    ),
  }
}

/* ── Gobierno de un acceso ───────────────────────────────────────────────── */

export interface ResultadoAcceso {
  readonly error?: string
  readonly aviso?: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Ventana de renovación por rol, en días. B6: contador 90, asesor 30. */
const VENTANA: Readonly<Record<string, number>> = {
  contador: 90,
  asistente: 90,
  asesor: 30,
}

interface FilaObjetivo {
  readonly role: string
  readonly email: string | null
  readonly revocada: boolean
}

/**
 * Revocar y renovar, en una sola acción con dos botones.
 *
 * Las dos empiezan leyendo la fila antes de tocarla. La alternativa —un
 * `update ... where id = $1` a secas— devuelve `rowCount` cero tanto si la
 * membresía no existe como si RLS no la deja ver, y la pantalla mostraría
 * "listo" sin que haya pasado nada. Es exactamente el fallo que este producto
 * no puede permitirse en la pantalla de quién tiene acceso al dinero.
 */
export async function gestionarAcceso(
  _prev: ResultadoAcceso,
  form: FormData,
): Promise<ResultadoAcceso> {
  const id = form.get('id')
  const accion = form.get('accion')
  // Se valida la forma del uuid acá: un id con otra forma no es "no
  // encontrado", es un error de sintaxis de Postgres y una pantalla rota.
  if (typeof id !== 'string' || !UUID.test(id)) {
    return { error: 'Falta la membresía sobre la que actuar.' }
  }
  if (accion !== 'revocar' && accion !== 'renovar') return { error: 'Acción desconocida.' }

  const resultado = await writeHousehold(async (client) => {
    const { rows } = await client.query<FilaObjetivo>(
      `select role::text as role, email, (revoked_at is not null) as revocada
         from membership
        where id = $1 and tenant_id = app_current_tenant()`,
      [id],
    )
    const fila = rows[0]

    if (fila === undefined) {
      return {
        error:
          'La base no devuelve esa membresía. La policy membership_own sólo deja ver la tuya, ' +
          'así que hasta que exista una policy por hogar no se puede revocar ni renovar la de ' +
          'otra persona desde acá.',
      }
    }

    const quien = fila.email ?? `la persona ${id.slice(0, 8)}`

    if (accion === 'revocar') {
      if (fila.role === 'titular' || fila.role === 'pareja') {
        return {
          error:
            'Un co-titular no se revoca de un click. B6 lo resuelve con una separación de ' +
            'hogar: corte a fecha, exportación completa para las dos partes y el histórico ' +
            'compartido congelado en solo lectura. Todavía no está construida.',
        }
      }
      if (fila.revocada) return { aviso: `El acceso de ${quien} ya estaba revocado.` }

      const hecho = await client.query(
        `update membership
            set revoked_at = now()
          where id = $1 and tenant_id = app_current_tenant() and revoked_at is null`,
        [id],
      )
      if (hecho.rowCount === 0) {
        return { error: 'La base no aplicó la revocación. No se cambió nada.' }
      }

      return {
        aviso:
          `Revocado el acceso de ${quien}: su próxima petición ya no resuelve a este hogar. ` +
          'Lo que B6 pide además —invalidar la sesión que tenga abierta, revocar los enlaces de ' +
          'reporte que emitió, cancelar sus envíos programados y listarte qué se llevó en 90 ' +
          'días— todavía no existe, porque no hay tabla de sesiones ni registro de exportaciones.',
      }
    }

    const dias = VENTANA[fila.role]
    if (dias === undefined) {
      return {
        error:
          `Un acceso de rol ${fila.role} no caduca: es del hogar, no un invitado. La renovación ` +
          'sólo aplica a contador, asistente y asesor.',
      }
    }
    if (fila.revocada) {
      return { error: `El acceso de ${quien} está revocado. Renovarlo sería volver a darlo.` }
    }

    // `now() + intervalo`, no `expires_at + intervalo`: renovar desde una
    // fecha ya vencida daría una caducidad que nace caducada.
    const hecho = await client.query<{ expires_on: string }>(
      `update membership
          set expires_at = now() + make_interval(days => $2::int)
        where id = $1 and tenant_id = app_current_tenant() and revoked_at is null
      returning to_char(expires_at, 'YYYY-MM-DD') as expires_on`,
      [id, dias],
    )
    const nueva = hecho.rows[0]
    if (nueva === undefined) return { error: 'La base no aplicó la renovación. No se cambió nada.' }

    return {
      aviso: `El acceso de ${quien} vuelve a caducar el ${nueva.expires_on} (${dias} días).`,
    }
  })

  // Fuera de la transacción: revalidar antes del commit invalidaría la caché
  // aunque el commit acabe fallando.
  if (resultado.aviso !== undefined) revalidatePath('/accesos')
  return resultado
}

/* ── Invitación ──────────────────────────────────────────────────────────── */
//
// No hay acción de invitar, y su ausencia es deliberada. Hacen falta dos
// piezas que no existen: crear el usuario en Supabase Auth —exige la clave
// secreta que el runtime de páginas no carga— e insertar su fila en
// `membership`, que la policy `membership_own` rechaza porque la fila sería de
// otra persona. Una acción que sólo devolviera ese texto haría que el botón
// pareciera vivo; el botón está apagado y el motivo se lee al lado.
