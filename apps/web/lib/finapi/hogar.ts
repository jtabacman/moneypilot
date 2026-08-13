/**
 * El hogar visto desde el agregador.
 *
 * finAPI no conoce hogares: conoce usuarios suyos. Este módulo es la costura
 * entre las dos ideas — de un lado `app.tenant_id`, del otro un identificador
 * y una contraseña que genera finAPI y que hay que guardar porque no los
 * vuelve a enseñar.
 *
 * Nada de acá decide qué se importa ni cómo. Sólo responde "¿quién sos vos
 * ante finAPI?" y devuelve el token con el que preguntar lo demás.
 */

import { type FeedUserRow, readFeedUser, saveFeedUser, type TenantClient } from '@moneypilot/db'
import { borrarUsuario, crearUsuario, type OpcionesRed, tokenDeUsuario } from './client'

/** El único proveedor que existe hoy. Ver la migración 008. */
export const PROVEEDOR = 'finapi' as const

/**
 * El usuario del hogar en finAPI, creándolo la primera vez.
 *
 * La llamada de red ocurre **dentro** de la transacción del hogar. Es
 * deliberado y tiene un coste conocido —una conexión del pool retenida
 * mientras finAPI contesta— a cambio de que no exista un estado intermedio en
 * el que el usuario está creado allá y no guardado acá: ese usuario quedaría
 * huérfano, con la contraseña perdida para siempre y sin forma de borrarlo.
 *
 * El caso inverso sí puede pasar (dos pestañas conectando a la vez), y por eso
 * `saveFeedUser` no pisa: devuelve el que quedó guardado. Si no es el que
 * acabamos de crear, el huérfano es nuestro y lo borramos acá mismo.
 */
export async function usuarioDelHogar(
  client: TenantClient,
  opciones: OpcionesRed = {},
): Promise<FeedUserRow> {
  const previo = await readFeedUser(client, PROVEEDOR)
  if (previo !== null) return previo

  const creado = await crearUsuario(opciones)
  const guardado = await saveFeedUser(client, {
    provider: PROVEEDOR,
    externalId: creado.id,
    accessSecret: creado.password,
  })

  if (guardado.externalId !== creado.id) {
    // Otra petición ganó la carrera. El usuario que acabamos de crear no le
    // sirve a nadie y sus datos bancarios vivirían en finAPI sin dueño: se
    // borra. Que falle el borrado no puede tumbar la conexión que sí funcionó.
    try {
      const token = await tokenDeUsuario(creado.id, creado.password, opciones)
      await borrarUsuario(token, opciones)
    } catch {
      // Queda un usuario vacío en el sandbox. Es lo menos malo de las opciones.
    }
  }

  return guardado
}

/**
 * El token del usuario del hogar, o `null` si todavía no conectó nada.
 *
 * Se pide en cada petición y no se cachea: un proceso web sirve a muchos
 * hogares, y una caché de tokens de usuario en memoria de módulo es una
 * credencial compartida esperando a que alguien se equivoque de clave.
 */
export async function tokenDelHogar(
  client: TenantClient,
  opciones: OpcionesRed = {},
): Promise<string | null> {
  const usuario = await readFeedUser(client, PROVEEDOR)
  if (usuario === null) return null
  return tokenDeUsuario(usuario.externalId, usuario.accessSecret, opciones)
}
