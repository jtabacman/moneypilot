'use server'

/**
 * Escritura de la estructura del hogar.
 *
 * Tres decisiones gobiernan el módulo:
 *
 *  1. **Nada se borra.** Un valor de dimensión tiene postings apuntándolo, y
 *     borrarlo dejaría esos movimientos sin explicación de a qué pertenecían.
 *     Archivar deja de ofrecerlo para etiquetar y conserva la historia.
 *  2. **El unique de la base es la última palabra.** Comprobar antes con un
 *     select y confiar en eso es una condición de carrera; acá se comprueba
 *     igual para dar un mensaje mejor, pero el que decide es Postgres, y su
 *     error se traduce en vez de convertirse en una excepción en pantalla.
 *  3. **El SQL va parametrizado y sin `where tenant_id`.** El aislamiento lo
 *     pone RLS con la variable que fija `writeHousehold`. Un filtro nuestro
 *     encima sería una segunda barrera que puede discrepar de la primera.
 */

import type { TenantClient } from '@moneypilot/db'
import { revalidatePath } from 'next/cache'
import { writeHousehold } from '@/lib/data'
import { type ActionState, falla, hecho, puedeEditarEstructura } from './state'

const LABEL_MAX = 120
const KEY_MAX = 40
const KEY_FORMA = /^[a-z][a-z0-9-]*$/
const UUID_FORMA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/* ── Acciones ────────────────────────────────────────────────────────────── */

export async function crearDimension(_previo: ActionState, form: FormData): Promise<ActionState> {
  const label = campo(form, 'label')
  const pedida = campo(form, 'key')
  // Sin clave escrita se deriva del nombre: pedirle a alguien que invente un
  // identificador antes de nombrar su casa es pedirle vocabulario nuestro.
  const key = aClave(pedida === '' ? label : pedida)

  const problema = revisarLabel(label, 'la dimensión')
  if (problema !== null) return falla(problema)
  if (key === '' || key.length > KEY_MAX || !KEY_FORMA.test(key)) {
    return falla(
      'La clave tiene que empezar por letra y llevar sólo minúsculas, números y guiones.',
    )
  }

  return await ejecutar(
    async (client, tenantId) => {
      const repetida = await client.query(
        'select 1 from dimension where lower(label) = lower($1) limit 1',
        [label],
      )
      if ((repetida.rowCount ?? 0) > 0) {
        return falla(`Ya tenés una dimensión que se llama «${label}».`)
      }

      await client.query(
        `insert into dimension (tenant_id, key, label, position)
         values ($1, $2, $3, coalesce((select max(position) + 1 from dimension), 1))`,
        [tenantId, key, label],
      )
      return hecho(`Dimensión «${label}» creada.`)
    },
    () => falla(`Ya usás la clave «${key}» en otra dimensión.`),
  )
}

export async function crearValor(_previo: ActionState, form: FormData): Promise<ActionState> {
  const dimensionId = campo(form, 'dimensionId')
  const label = campo(form, 'label')
  const parentId = campo(form, 'parentId') === '' ? null : campo(form, 'parentId')

  if (!UUID_FORMA.test(dimensionId)) return falla('Falta decir en qué dimensión va este valor.')
  if (parentId !== null && !UUID_FORMA.test(parentId)) {
    return falla('El valor del que cuelga no es válido.')
  }
  const problema = revisarLabel(label, 'el valor')
  if (problema !== null) return falla(problema)

  return await ejecutar(
    async (client, tenantId) => {
      // El padre se resuelve dentro del propio insert y contra la MISMA
      // dimensión. Comprobarlo aparte dejaría una ventana para colgar "Obra"
      // de una persona, y la jerarquía perdería el sentido en silencio.
      const { rows } = await client.query<{ id: string }>(
        `insert into dimension_value (tenant_id, dimension_id, label, parent_id)
         select $1::uuid, d.id, $3, p.id
           from dimension d
           left join dimension_value p on p.id = $4::uuid and p.dimension_id = d.id
          where d.id = $2::uuid
            and ($4::uuid is null or p.id is not null)
         returning id`,
        [tenantId, dimensionId, label, parentId],
      )
      if (rows.length === 0) {
        return falla(
          'No se pudo crear: esa dimensión ya no existe, o el valor del que querés colgarlo es de otra dimensión.',
        )
      }
      return hecho(`«${label}» añadido.`)
    },
    () => falla(`Ya hay un valor llamado «${label}» en esta dimensión.`),
  )
}

export async function renombrarValor(_previo: ActionState, form: FormData): Promise<ActionState> {
  const valueId = campo(form, 'valueId')
  const label = campo(form, 'label')

  if (!UUID_FORMA.test(valueId)) return falla('No se sabe qué valor renombrar.')
  const problema = revisarLabel(label, 'el valor')
  if (problema !== null) return falla(problema)

  return await ejecutar(
    async (client) => {
      const { rows } = await client.query<{ label: string }>(
        'update dimension_value set label = $2 where id = $1::uuid returning label',
        [valueId, label],
      )
      if (rows.length === 0) return falla('Ese valor ya no existe.')
      return hecho(`Ahora se llama «${label}».`)
    },
    () => falla(`Ya hay un valor llamado «${label}» en esta dimensión.`),
  )
}

/**
 * Archivar, que no es borrar.
 *
 * Los postings que apuntan a este valor siguen apuntándolo y sus reportes
 * siguen cuadrando; lo único que cambia es que deja de ofrecerse para etiquetar
 * de acá en adelante.
 */
export async function archivarValor(_previo: ActionState, form: FormData): Promise<ActionState> {
  const valueId = campo(form, 'valueId')
  if (!UUID_FORMA.test(valueId)) return falla('No se sabe qué valor archivar.')

  return await ejecutar(async (client) => {
    const { rows } = await client.query<{ label: string }>(
      `update dimension_value set archived_at = now()
        where id = $1::uuid and archived_at is null
        returning label`,
      [valueId],
    )
    if (rows.length === 0) return falla('Ese valor ya no existe o ya estaba archivado.')
    return hecho(`«${rows[0]?.label ?? ''}» archivado. Sus movimientos siguen atribuidos.`)
  })
}

export async function restaurarValor(_previo: ActionState, form: FormData): Promise<ActionState> {
  const valueId = campo(form, 'valueId')
  if (!UUID_FORMA.test(valueId)) return falla('No se sabe qué valor restaurar.')

  return await ejecutar(async (client) => {
    const { rows } = await client.query<{ label: string }>(
      `update dimension_value set archived_at = null
        where id = $1::uuid and archived_at is not null
        returning label`,
      [valueId],
    )
    if (rows.length === 0) return falla('Ese valor ya no existe o ya estaba activo.')
    return hecho(`«${rows[0]?.label ?? ''}» vuelve a estar disponible.`)
  })
}

/* ── Andamiaje ───────────────────────────────────────────────────────────── */

type Trabajo = (client: TenantClient, tenantId: string) => Promise<ActionState>

/**
 * Corre `trabajo` con el hogar fijado, traduce el choque contra un unique y
 * revalida sólo si algo cambió de verdad.
 *
 * `revalidatePath` va fuera de la transacción a propósito: dentro estaría
 * invalidando la caché de un cambio que todavía podría revertirse.
 */
async function ejecutar(trabajo: Trabajo, siDuplicado?: () => ActionState): Promise<ActionState> {
  let resultado: ActionState
  try {
    resultado = await writeHousehold(async (client, session) => {
      if (!puedeEditarEstructura(session.role)) {
        return falla(
          `Tu rol (${session.role}) no edita la estructura del hogar: eso es del titular y de la pareja.`,
        )
      }
      return trabajo(client, session.tenantId)
    })
  } catch (error) {
    if (siDuplicado !== undefined && esDuplicado(error)) return siDuplicado()
    throw error
  }

  if (resultado.status === 'ok') revalidatePath('/dimensiones')
  return resultado
}

function campo(form: FormData, nombre: string): string {
  const valor = form.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

function revisarLabel(label: string, que: string): string | null {
  if (label === '') return `Ponele un nombre a ${que}.`
  if (label.length > LABEL_MAX) {
    return `El nombre no puede pasar de ${LABEL_MAX} caracteres.`
  }
  return null
}

/** 'Casa de Madrid' → 'casa-de-madrid'. Sin tildes, que no caben en la clave. */
function aClave(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, KEY_MAX)
}

/** 23505 es unique_violation. Es lo único que traducimos: el resto tiene que romper. */
function esDuplicado(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === '23505'
  )
}
