/**
 * El hogar visto desde Plaid.
 *
 * finAPI conoce usuarios y por eso tiene `feed_user`; Plaid conoce **items**.
 * Un item es una conexión con una entidad —un login— y trae consigo un
 * `access_token` que no caduca y que es la llave de todos sus datos bancarios.
 * Un hogar puede tener varios: BBVA y Chase son dos items, con dos tokens.
 *
 * Por eso acá no hay nada equivalente a `usuarioDelHogar`: en Plaid no hay un
 * secreto por hogar que crear y guardar. Todo cuelga de la conexión, y este
 * módulo es la costura entre `app.tenant_id` y esa fila.
 */

import {
  type FeedConnectionRow,
  readConnection,
  readConnectionSecret,
  recordConnection,
  type TenantClient,
} from '@moneypilot/db'
import { SincronizacionError } from '../feed/errores'
import { canjearPublicToken } from './client'

/** El segundo proveedor. Ver la migración 009. */
export const PROVEEDOR = 'plaid' as const

/** Cómo se nombra a Plaid en un mensaje que lee una persona. */
export const LEGIBLE = 'Plaid'

export interface RegistrarConexionInput {
  /** El que devuelve Link, o el del sandbox: se canjean igual. */
  readonly publicToken: string
  /** `ins_109508`. Va a `bank_id`. */
  readonly institutionId: string
  readonly institutionName: string
}

/**
 * Canjea el token público y deja la conexión registrada.
 *
 * El canje ocurre **dentro** de la transacción del hogar, igual que la creación
 * del usuario de finAPI y por el mismo motivo: si el token se canjeara fuera y
 * la fila no llegara a escribirse, el item quedaría vivo en Plaid con su
 * `access_token` perdido para siempre — nadie podría volver a leerlo ni
 * borrarlo, y en producción un item vivo se factura todos los meses.
 *
 * El caso inverso —fila escrita y canje fallido— no puede pasar porque el canje
 * va primero y su fallo aborta todo.
 *
 * Queda una grieta declarada: si la transacción se cae **después** del canje
 * (por ejemplo, porque el índice de item repetido salta), el item ya existe
 * allá y la fila no. Cerrarla del todo pide `/item/remove`, que el cliente
 * todavía no expone; mientras tanto lo que queda es un item de sandbox sin
 * usar, que no cobra nada y no lee ninguna cuenta real.
 */
export async function registrarConexion(
  client: TenantClient,
  input: RegistrarConexionInput,
): Promise<FeedConnectionRow> {
  const item = await canjearPublicToken(input.publicToken)

  return recordConnection(client, {
    provider: PROVEEDOR,
    bankId: input.institutionId,
    bankName: input.institutionName,
    // Plaid no tiene formulario web que sondear: la autenticación termina
    // dentro de su widget y no deja nada que se pueda volver a mirar. Ver la
    // migración 009, que aflojó la columna con un check por proveedor.
    webFormId: null,
    itemId: item.itemId,
    accessSecret: item.accessToken,
    // No es un estado que diga Plaid: es nuestro, y significa "el item existe y
    // todavía no se sincronizó". Los estados que sí dice Plaid —los códigos de
    // error del item, `ITEM_LOGIN_REQUIRED` el primero— pisan éste en cuanto
    // aparecen, igual que con finAPI.
    status: 'CONECTADO',
  })
}

export interface ConexionConToken {
  readonly conexion: FeedConnectionRow
  /** El `access_token` del item. No se escribe en ningún log. */
  readonly accessToken: string
}

/**
 * La conexión y su credencial, comprobando que sea de Plaid.
 *
 * La comprobación de proveedor no es defensiva de más: los identificadores de
 * conexión son uuid y vienen de la pantalla, así que nada impide que llegue el
 * de una conexión de finAPI. Sin esto, se leería su `access_secret` —que es
 * null— y el error saldría más adelante, disfrazado de "esta conexión no tiene
 * credencial".
 */
export async function conexionConToken(
  client: TenantClient,
  connectionId: string,
): Promise<ConexionConToken> {
  const conexion = await readConnection(client, connectionId)
  if (conexion === null) {
    // Con RLS, la conexión de otro hogar es indistinguible de una inexistente.
    throw new SincronizacionError(`La conexión ${connectionId} no existe en este hogar.`)
  }
  if (conexion.provider !== PROVEEDOR) {
    throw new SincronizacionError(
      `La conexión ${connectionId} es de ${conexion.provider} y esto sincroniza ${PROVEEDOR}.`,
    )
  }

  const accessToken = await readConnectionSecret(client, connectionId)
  if (accessToken === null) {
    throw new SincronizacionError(
      `La conexión con ${conexion.bankName} no tiene credencial guardada, así que no se le puede ` +
        'preguntar nada a Plaid. Hay que volver a conectar el banco: el token del item se guarda ' +
        'una sola vez, al canjear el token público.',
    )
  }

  return { conexion, accessToken }
}
