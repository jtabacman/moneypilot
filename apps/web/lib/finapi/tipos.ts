/**
 * La forma cruda de lo que devuelve finAPI, ya leída pero todavía sin
 * interpretar.
 *
 * Es deliberadamente tonta: campos de texto y nada más. El cliente HTTP no
 * decide qué fecha es la canónica, ni qué signo tiene un cargo, ni cómo se
 * describe un movimiento — eso es trabajo del mapeador, igual que en los
 * parsers de fichero. Acá sólo se garantiza que lo que llegó por la red llega
 * al mapeador **sin haber pasado por coma flotante**.
 *
 * Por eso `amount` y `balance` son `string`. No es descuido: es el contrato.
 * Son la cadena decimal exacta que mandó el servidor, lista para
 * `fromDecimalString` del núcleo.
 *
 * Los campos que pueden faltar son `T | null` y no opcionales. Un DTO de
 * frontera cuyo trabajo es "todo lo que vino" se lee mejor si todas las claves
 * están siempre, y ahorra veinte propagaciones condicionales que
 * `exactOptionalPropertyTypes` obligaría a escribir para no ganar nada.
 */

/** Todos los campos del objeto original, aplanados. Va al `raw` de la línea. */
export type Crudo = Readonly<Record<string, string>>

export interface FinapiRawTransaction {
  /**
   * Identificador estable del movimiento. Es un `number` para encajar con
   * `FinapiRawTransaction` de `@moneypilot/importers` sin traducción por el
   * medio; se obtiene con `enteroSeguro`, que falla si algún día finAPI manda
   * un id que no cabe en un entero exacto en vez de redondearlo en silencio.
   */
  readonly id: number
  readonly accountId: number
  /**
   * Cadena decimal exacta, tal cual vino en el cuerpo HTTP: "-135.89".
   * Negativo = sale de la cuenta, que es el mismo criterio que usa el núcleo.
   */
  readonly amount: string
  /** Vacío si finAPI no la declara. No se rellena con EUR acá: ver más abajo. */
  readonly currency: string
  /** Fecha valor, 'YYYY-MM-DD'. */
  readonly valueDate: string | null
  /** Fecha contable del banco. La que el mapeador debería preferir. */
  readonly bankBookingDate: string | null
  /** Fecha contable según el reloj de finAPI, que no es el del banco. */
  readonly finapiBookingDate: string | null
  /** Concepto crudo. */
  readonly purpose: string | null
  /** Concepto ya normalizado por finAPI. */
  readonly cleanedPurpose: string | null
  readonly counterpartName: string | null
  readonly counterpartIban: string | null
  readonly counterpartBic: string | null
  readonly counterpartAccountNumber: string | null
  readonly counterpartBankName: string | null
  /** Tipo en alemán: "Überweisungsauftrag", "Lastschrift"… */
  readonly type: string | null
  /** Código ZKA de la operación: "20", "05"… */
  readonly typeCodeZka: string | null
  /** Taxonomía de finAPI, en alemán. No es nuestra categoría contable. */
  readonly category: { readonly id: number; readonly name: string } | null
  /** finAPI cree que ya lo mandó antes. No sustituye a nuestro dedup. */
  readonly isPotentialDuplicate: boolean
  readonly crudo: Crudo
}

export interface FinapiRawAccount {
  readonly id: number
  readonly bankConnectionId: string | null
  readonly accountName: string | null
  readonly iban: string | null
  readonly accountNumber: string | null
  readonly accountHolderName: string | null
  /**
   * `null` cuando finAPI no la declara, y **no** 'EUR'.
   *
   * Rellenarla acá con un valor por defecto parece amable y es lo contrario:
   * el mapeador tiene un aviso ('moneda_no_declarada') para exactamente este
   * caso, y un dato inventado en la frontera se lo come antes de que nadie lo
   * vea. Una cuenta sin moneda es un dato que falta, no un detalle.
   */
  readonly accountCurrency: string | null
  /** "Checking", "Savings", "Security"… */
  readonly accountType: string | null
  /** Saldo como cadena decimal exacta. Sirve para reconciliar el cierre. */
  readonly balance: string | null
  /**
   * Instante de la última lectura correcta del banco. Es **la fecha a la que
   * corresponde `balance`**, así que sin esto el saldo de cierre no se puede
   * fechar. finAPI no lo pone en la raíz de la cuenta sino dentro de
   * `interfaces[]`, uno por interfaz; se toma el más reciente.
   */
  readonly lastSuccessfulUpdate: string | null
  readonly crudo: Crudo
}

export interface FinapiBanco {
  readonly id: number
  readonly nombre: string
  /** Interfaces disponibles: XS2A, FINTS_SERVER, WEB_SCRAPER. */
  readonly interfaces: readonly string[]
  readonly esDePrueba: boolean
  readonly blz: string | null
  readonly bic: string | null
  readonly pais: string | null
}

export interface FinapiWebForm {
  readonly id: string
  /** La URL que tiene que abrir la persona. No se puede automatizar. */
  readonly url: string
  /** Instante de caducidad, tal cual lo manda finAPI (ISO con zona). */
  readonly expiresAt: string
}

/**
 * Estados del formulario. Los cuatro últimos son finales: si el sondeo ve uno
 * de ellos, deja de sondear.
 */
export type FinapiWebFormStatus =
  | 'NOT_YET_OPENED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'COMPLETED_WITH_ERROR'
  | 'EXPIRED'
  | 'ABORTED'
  | 'CANCELLED'

export const ESTADOS_FINALES: readonly FinapiWebFormStatus[] = [
  'COMPLETED',
  'COMPLETED_WITH_ERROR',
  'EXPIRED',
  'ABORTED',
  'CANCELLED',
]

export function esEstadoFinal(status: string): boolean {
  return (ESTADOS_FINALES as readonly string[]).includes(status)
}

export interface FinapiWebFormPayload {
  /** Se rellena cuando el formulario termina y la conexión existe. */
  readonly bankConnectionId: string | null
  readonly errorCode: string | null
  readonly errorMessage: string | null
  readonly crudo: Crudo
}

export interface FinapiWebFormEstado {
  /** Se deja como `string` y no como unión cerrada: finAPI puede añadir. */
  readonly status: string
  readonly payload: FinapiWebFormPayload
}

export interface FinapiUsuario {
  readonly id: string
  readonly password: string
}
