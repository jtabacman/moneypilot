'use server'

import { revertImport } from '@moneypilot/db'
import { revalidatePath } from 'next/cache'
import { writeHousehold } from '@/lib/data'
import { navItem } from '@/lib/nav'

export interface EstadoDeshacer {
  readonly ok: boolean
  readonly mensaje: string | null
}

/*
 * El estado inicial vive en `deshacer.tsx` y no acá, que sería el sitio
 * natural. Un módulo `'use server'` sólo exporta funciones al cliente:
 * cualquier otra cosa llega como `undefined` y nada avisa. Exportado desde
 * acá, `useActionState` arrancaba con `mensaje: undefined`, y como
 * `undefined !== null` cada fila del historial pintaba un "no se pudo" vacío
 * antes de que nadie pulsara nada.
 */

/**
 * Deshacer un lote entero.
 *
 * Es la característica que hace que alguien se anime a subir dos años de
 * histórico, así que tiene que fallar diciendo por qué. `revertImport` se niega
 * en casos concretos —el lote ya se revirtió, alguno de sus asientos está
 * enlazado con una anulación posterior— y esos mensajes explican qué pasó y qué
 * hacer: se devuelven al usuario tal cual en vez de convertirse en una pantalla
 * de error que le pierde el sitio en la página.
 */
export async function deshacerLote(
  _previo: EstadoDeshacer,
  form: FormData,
): Promise<EstadoDeshacer> {
  const lote = form.get('lote')
  if (typeof lote !== 'string' || lote === '') {
    return { ok: false, mensaje: 'No llegó qué lote deshacer.' }
  }

  try {
    const resultado = await writeHousehold(async (client, session) => {
      // Una server action es un endpoint público como cualquier otro: que el
      // botón no se le pinte a un rol no impide que le llegue la petición.
      const permitidos = navItem('/importar')?.roles
      if (permitidos !== undefined && !permitidos.includes(session.role)) {
        throw new Error(`Tu rol en este hogar (${session.role}) no puede deshacer importaciones.`)
      }
      return revertImport(client, lote)
    })

    // El lote deshecho cambia saldos, gráficos y cola de revisión en todas las
    // pantallas, no sólo en ésta.
    revalidatePath('/', 'layout')

    const sueltas =
      resultado.detachedReviewItems === 0
        ? ''
        : ` ${resultado.detachedReviewItems} fila(s) de la cola de revisión de otros lotes` +
          ' apuntaban a un asiento de éste y se quedaron sin ese enlace, pero siguen enteras.'

    return {
      ok: true,
      mensaje: `Se quitaron ${resultado.removedEntries} asiento(s) del libro.${sueltas}`,
    }
  } catch (error) {
    return {
      ok: false,
      mensaje: error instanceof Error ? error.message : 'No se pudo deshacer el lote.',
    }
  }
}
