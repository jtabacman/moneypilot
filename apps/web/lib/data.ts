/**
 * Puente entre una página y la base, con el hogar ya fijado.
 *
 * Toda página de la aplicación lee así y no de otra forma. La alternativa
 * —que cada página abra su propia transacción— multiplica los sitios donde
 * alguien puede olvidarse de declarar de quién son los datos que pide, y ese
 * olvido no da error: da los datos de otro.
 */

import 'server-only'

import type { TenantClient } from '@moneypilot/db'
import { withHousehold } from './db'
import { type Session, resolveSession } from './session'

export interface PageData<T> {
  readonly session: Session
  readonly data: T
}

/**
 * Ejecuta `fn` con el hogar de la sesión activa.
 *
 * Lanza si no hay sesión. No es un caso a manejar en cada página: el layout de
 * `(app)` ya redirige antes de llegar acá, así que si esto salta es un error
 * de programación y tiene que ser ruidoso.
 */
export async function readHousehold<T>(
  fn: (client: TenantClient, session: Session) => Promise<T>,
): Promise<PageData<T>> {
  const state = await resolveSession()
  if (state.kind !== 'active') {
    throw new Error('readHousehold sin sesión activa: el layout debería haber redirigido antes.')
  }
  const { session } = state
  const data = await withHousehold(session.tenantId, session.user.id, (client) =>
    fn(client, session),
  )
  return { session, data }
}

/** Igual, para acciones de escritura. El nombre distinto es para que se lea en la revisión. */
export async function writeHousehold<T>(
  fn: (client: TenantClient, session: Session) => Promise<T>,
): Promise<T> {
  const state = await resolveSession()
  if (state.kind !== 'active') {
    throw new Error('writeHousehold sin sesión activa.')
  }
  const { session } = state
  return withHousehold(session.tenantId, session.user.id, (client) => fn(client, session))
}

/**
 * Rangos de fecha calculados sobre strings, sin objetos Date.
 *
 * `new Date()` en el servidor devuelve la hora del servidor, que en Vercel es
 * UTC. Para un usuario en Madrid a las 00:30 eso es todavía "ayer", y el
 * dashboard le enseñaría el mes anterior durante una hora cada noche.
 * Trabajamos sobre el string ISO y aceptamos el desfase de UTC, que es
 * explícito y el mismo para todos, hasta que exista preferencia de huso.
 */
export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export interface Period {
  readonly from: string
  readonly to: string
  readonly label: string
  readonly key: string
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7)
}

export function firstDayOfMonth(month: string): string {
  return `${month}-01`
}

export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map((part) => Number.parseInt(part, 10))
  if (y === undefined || m === undefined) return `${month}-28`
  const lengths = [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return `${month}-${String(lengths[m - 1] ?? 30).padStart(2, '0')}`
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map((part) => Number.parseInt(part, 10))
  if (y === undefined || m === undefined) return month
  const total = y * 12 + (m - 1) + delta
  const year = Math.floor(total / 12)
  const monthIndex = total - year * 12
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`
}

/** Los últimos `count` meses terminando en el de `iso`, del más viejo al más nuevo. */
export function lastMonths(iso: string, count: number): string[] {
  const end = monthOf(iso)
  return Array.from({ length: count }, (_, index) => addMonths(end, index - (count - 1)))
}

export function currentMonthPeriod(iso: string): Period {
  const month = monthOf(iso)
  return {
    from: firstDayOfMonth(month),
    to: lastDayOfMonth(month),
    label: 'Este mes',
    key: month,
  }
}

export function trailing12(iso: string): Period {
  const month = monthOf(iso)
  const start = addMonths(month, -11)
  return {
    from: firstDayOfMonth(start),
    to: lastDayOfMonth(month),
    label: 'Últimos 12 meses',
    key: `${start}..${month}`,
  }
}
