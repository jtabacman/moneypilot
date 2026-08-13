/**
 * La forma cruda de lo que devuelve Plaid, ya leída pero todavía sin
 * interpretar.
 *
 * Es deliberadamente tonta, igual que la de finAPI: campos de texto y nada
 * más. El cliente HTTP no decide qué fecha es la canónica, ni qué signo tiene
 * un cargo, ni cómo se describe un movimiento — eso es trabajo del mapeador,
 * igual que en los parsers de fichero. Acá sólo se garantiza que lo que llegó
 * por la red llega al mapeador **sin haber pasado por coma flotante**.
 *
 * Por eso los importes son `string`. No es descuido: es el contrato. Son la
 * cadena decimal exacta que mandó el servidor, lista para `fromDecimalString`
 * del núcleo.
 *
 * Los campos que pueden faltar son `T | null` y no opcionales, por el mismo
 * motivo que en finAPI: un DTO de frontera cuyo trabajo es "todo lo que vino"
 * se lee mejor si todas las claves están siempre.
 */

/** Todos los campos del objeto original, aplanados. Va al `raw` de la línea. */
export type Crudo = Readonly<Record<string, string>>

/**
 * Un movimiento tal como lo devuelve `/transactions/sync`.
 *
 * ── EL SIGNO ESTÁ AL REVÉS ──────────────────────────────────────────────────
 *
 * En Plaid **un importe positivo es dinero que SALE** de la cuenta, y uno
 * negativo dinero que entra. Es al revés que en un extracto, al revés que en
 * finAPI y al revés que en el núcleo. Comprobado contra su sandbox: la compra
 * en Uber viene `5.4`, el reembolso de United Airlines viene `-500` y el
 * ingreso de intereses `INTRST PYMNT` viene `-4.22`.
 *
 * Equivocarse acá no rompe nada, y eso es exactamente lo que lo hace
 * peligroso: el asiento sigue balanceando a cero, la importación no da ni un
 * aviso, y lo único que pasa es que todos los gastos son ingresos, todos los
 * ingresos son gastos y el patrimonio va al revés.
 *
 * Por eso el campo **no se llama `amount`**. Se llama `importeSalidaPositiva`,
 * que es incómodo a propósito: quien escriba
 * `fromDecimalString(m.importeSalidaPositiva, ...)` y lo meta tal cual en un
 * asiento tiene el error delante de los ojos en el momento de escribirlo, y no
 * seis meses después en un informe que no cuadra con nada.
 *
 * Para darle la vuelta está `invertirSigno`, que trabaja sobre el texto. No se
 * hace con `-Number(texto)`: eso volvería a meter el importe en coma flotante
 * justo después de todo el trabajo que hace `json-exacto.ts` para evitarlo.
 */
export interface MovimientoPlaid {
  /** Identificador estable del movimiento. Cambia cuando una pendiente asienta. */
  readonly transactionId: string
  readonly accountId: string
  /**
   * Decimal como TEXTO, tal cual vino en el cuerpo HTTP: "5.4", "-500".
   *
   * **Positivo = sale de la cuenta.** Ver el comentario largo de arriba.
   */
  readonly importeSalidaPositiva: string
  /** ISO 4217. `null` si Plaid usa `unofficialCurrencyCode` en su lugar. */
  readonly isoCurrencyCode: string | null
  /** Para cuentas en divisa no oficial (cripto). Excluyente con el anterior. */
  readonly unofficialCurrencyCode: string | null
  /** Fecha contable, 'YYYY-MM-DD'. Es la canónica para el mapeador. */
  readonly date: string | null
  /** Fecha en que se autorizó la operación, 'YYYY-MM-DD'. Suele ser anterior. */
  readonly authorizedDate: string | null
  /** Instante ISO de la fecha contable, cuando el banco lo da. */
  readonly datetime: string | null
  readonly authorizedDatetime: string | null
  /** El concepto tal como lo enseña Plaid, ya algo limpiado por ellos. */
  readonly name: string | null
  /** El concepto crudo del banco. Sólo si se pide `include_original_description`. */
  readonly originalDescription: string | null
  /** Comercio normalizado por Plaid. Derivado, no original. */
  readonly merchantName: string | null
  /**
   * El movimiento todavía no está asentado.
   *
   * Un pendiente que después asienta **llega con otro `transactionId`** y con
   * `pendingTransactionId` apuntando al de antes. Es el caso que el dedup de
   * origen 'api' resuelve, y el motivo de que los dos campos viajen hasta el
   * mapeador en vez de quedarse en `crudo`.
   */
  readonly pending: boolean
  /** El id del pendiente al que sustituye este movimiento ya asentado. */
  readonly pendingTransactionId: string | null
  /** "online", "in store", "other". */
  readonly paymentChannel: string | null
  /** Código del banco para la operación: "ATM", "TRANSFER", "DIRECT DEBIT"… */
  readonly transactionCode: string | null
  readonly checkNumber: string | null
  /** Taxonomía de Plaid. NO es nuestra categoría contable. */
  readonly categoriaPersonal: CategoriaPersonal | null
  readonly merchantCategoryCode: string | null
  readonly website: string | null
  readonly logoUrl: string | null
  /** Contrapartes que Plaid reconoce: el comercio, la pasarela, la plataforma. */
  readonly contrapartes: readonly ContrapartePlaid[]
  readonly crudo: Crudo
}

export interface CategoriaPersonal {
  /** "TRANSPORTATION", "FOOD_AND_DRINK"… */
  readonly primary: string
  /** "TRANSPORTATION_TAXIS_AND_RIDE_SHARES"… */
  readonly detailed: string
  /** "VERY_HIGH", "HIGH", "MEDIUM", "LOW", "UNKNOWN". */
  readonly confidenceLevel: string | null
}

export interface ContrapartePlaid {
  readonly name: string
  /** "merchant", "financial_institution", "marketplace", "payment_app"… */
  readonly type: string | null
  readonly website: string | null
  readonly logoUrl: string | null
  readonly confidenceLevel: string | null
  readonly entityId: string | null
}

/**
 * Un movimiento que Plaid retiró.
 *
 * No es un movimiento anulado por el banco con un contra-asiento: es un
 * movimiento que Plaid nos dio y ahora dice que nunca existió. El caso típico
 * es una autorización pendiente que caducó sin asentarse. Qué hacer con esto
 * en el libro —revertir el asiento, marcarlo, avisar— es una decisión de
 * producto que este módulo no toma; acá sólo se transporta.
 */
export interface MovimientoQuitado {
  readonly transactionId: string
  /** Plaid lo documenta, pero puede no venir. */
  readonly accountId: string | null
}

export interface CuentaPlaid {
  readonly accountId: string
  readonly name: string | null
  readonly officialName: string | null
  /** Los últimos dígitos, ya enmascarados por Plaid. */
  readonly mask: string | null
  /** "depository", "credit", "loan", "investment", "brokerage", "other". */
  readonly type: string | null
  /** "checking", "savings", "credit card", "mortgage"… */
  readonly subtype: string | null
  /** "personal" o "business". */
  readonly holderCategory: string | null
  /**
   * Saldo contable como cadena decimal exacta. Sirve para reconciliar el
   * cierre.
   *
   * Ojo con el signo también acá, aunque de otra manera: en una cuenta de
   * crédito o de préstamo un `saldoActual` **positivo es deuda**. Otra decisión
   * del mapeador, no de este módulo.
   */
  readonly saldoActual: string | null
  /** Saldo disponible: descuenta lo pendiente. `null` en muchas cuentas. */
  readonly saldoDisponible: string | null
  /** Límite de crédito, en las cuentas que lo tienen. */
  readonly limite: string | null
  /**
   * `null` cuando Plaid no la declara, y **no** 'EUR' ni 'USD'.
   *
   * Rellenarla acá con un valor por defecto parece amable y es lo contrario:
   * el mapeador tiene un aviso para exactamente este caso, y un dato inventado
   * en la frontera se lo come antes de que nadie lo vea.
   */
  readonly isoCurrencyCode: string | null
  readonly unofficialCurrencyCode: string | null
  readonly crudo: Crudo
}

/**
 * En qué punto va la carga inicial del item.
 *
 * **Un banco recién conectado entrega sus movimientos a plazos, y NADA en la
 * respuesta dice cuándo terminó.** Esto es lo que se midió: cinco conexiones
 * seguidas al banco de prueba, sincronizando cada dos segundos hasta el final.
 * Cada símbolo es una vuelta — `·` es un lote vacío, `+añadidos/corregidos` uno
 * con datos, y la letra es el estado (N=NOT_READY, I=INITIAL,
 * H=HISTORICAL_UPDATE_COMPLETE). Las 48 son siempre el total real:
 *
 *     1: ·N ·I +16/0H +32/16H ·H ·H …
 *     2: ·N ·N +16/0I  ·H  +32/16H ·H …   ← ojo a la cuarta vuelta
 *     3: ·N +16/0I +32/16H ·H ·H …
 *     4: ·N +16/0I  ·H  +32/16H ·H …      ← y a la tercera
 *     5: ·N ·I +16/0H +32/16H ·H ·H …
 *
 * Todas las vueltas, sin excepción, vienen con `has_more: false`. Y en las
 * corridas 2 y 4 hay **un lote vacío, con estado `HISTORICAL_UPDATE_COMPLETE`,
 * y después llegan 32 movimientos más**.
 *
 * O sea que ninguna de estas cuatro señales sirve para saber que estamos al
 * día, y cada una produce un lote incompleto sin un solo error:
 *
 *   - `has_more: false` — nunca es true en este banco.
 *   - `added` no vacío — la vuelta de 16 parece completa y le faltan 32.
 *   - `HISTORICAL_UPDATE_COMPLETE` — dice que Plaid terminó de su lado, no que
 *     nos lo haya entregado.
 *   - un lote vacío — pasa en medio, dos de cada cinco veces.
 *
 * Quien pare en el primer lote vacío se lleva 16 movimientos de 48, con un
 * informe de reconciliación que cuadra consigo mismo. Es exactamente el fallo
 * que no da error.
 *
 * **Lo que sí sirve es el webhook `SYNC_UPDATES_AVAILABLE`**: Plaid avisa
 * cuando hay algo nuevo, y ahí se sincroniza. Es el motivo de que
 * `crearLinkToken` acepte `webhook`. Sondeando —que es lo que hay que hacer
 * mientras no haya webhook— la única regla que aguantó las cinco corridas es
 * esperar **varios lotes vacíos seguidos** antes de darlo por terminado.
 *
 * La buena noticia, también comprobada: no se pierde nada por preguntar de
 * más. El cursor que devuelve un lote `NOT_READY` es válido, y la siguiente
 * llamada con ese cursor trae todo lo que faltaba.
 *
 * (De regalo, la vuelta del histórico trae 16 `modified` de verdad: el banco
 * de prueba corrige los movimientos del tirón inicial. Es el veredicto
 * 'updated' del dedup, ejercitado sin tener que fabricarlo.)
 */
export type EstadoDeActualizacion =
  | 'TRANSACTIONS_UPDATE_STATUS_UNKNOWN'
  | 'NOT_READY'
  | 'INITIAL_UPDATE_COMPLETE'
  | 'HISTORICAL_UPDATE_COMPLETE'

/**
 * Plaid terminó de descargar el histórico de su lado.
 *
 * **No** quiere decir que nos lo haya entregado entero: ver arriba. Sirve para
 * informar, no para decidir cuándo dejar de preguntar.
 */
export function hayHistoricoCompleto(estado: string): boolean {
  return estado === 'HISTORICAL_UPDATE_COMPLETE'
}

export interface LoteDeSincronizacion {
  readonly added: readonly MovimientoPlaid[]
  readonly modified: readonly MovimientoPlaid[]
  readonly removed: readonly MovimientoQuitado[]
  /**
   * El cursor **final**, el que hay que guardar por conexión.
   *
   * Cadena vacía = todavía no hay cursor (pasa mientras el item está
   * `NOT_READY`). Guardarla es inofensivo: al mandarla se omite y Plaid vuelve
   * a contar desde el principio, que es lo mismo que una primera sincronización
   * y lo absorbe el dedup.
   */
  readonly cursor: string
  /**
   * Casi siempre `false`: `sincronizar` agota la paginación antes de volver.
   * `true` sólo si se llegó al tope de seguridad de vueltas, y entonces quiere
   * decir "guardá el cursor y volvé a llamar", no "se perdió algo".
   */
  readonly hasMore: boolean
  readonly estado: EstadoDeActualizacion | string
  /** Las cuentas tal como estaban en la última página. Traen el saldo del momento. */
  readonly cuentas: readonly CuentaPlaid[]
}

/**
 * El lote no trajo nada.
 *
 * **No** significa que estemos al día: ver la medición de arriba, donde un lote
 * vacío aparece en medio de la descarga inicial dos de cada cinco veces. Sirve
 * para contar vacíos seguidos, que es lo más cerca que se llega sondeando.
 */
export function loteVacio(lote: LoteDeSincronizacion): boolean {
  return lote.added.length === 0 && lote.modified.length === 0 && lote.removed.length === 0
}

export interface InstitucionPlaid {
  readonly institutionId: string
  readonly nombre: string
  /** ISO 3166-1 alfa-2: 'ES', 'US'. */
  readonly paises: readonly string[]
  /** 'transactions', 'auth', 'balance'… Sin 'transactions' no nos sirve. */
  readonly productos: readonly string[]
  /** Si el banco autentica por OAuth. Los diez españoles que importan, sí. */
  readonly oauth: boolean
}

export interface LinkToken {
  readonly linkToken: string
  /** Instante ISO de caducidad, tal cual lo manda Plaid. Dura cuatro horas. */
  readonly expiration: string
}

export interface ItemCanjeado {
  /**
   * La credencial de larga duración. No caduca; es la llave de todos los datos
   * bancarios de esa conexión y no se escribe en ningún log.
   */
  readonly accessToken: string
  readonly itemId: string
}

/** Dirección del dinero para `/transactions/enrich`. */
export type Direccion = 'INFLOW' | 'OUTFLOW'

export interface MovimientoAEnriquecer {
  /** Identificador nuestro para volver a casar la respuesta. */
  readonly id: string
  readonly description: string
  /**
   * Importe **siempre positivo**, como texto decimal. El sentido lo lleva
   * `direction`, no el signo — es otra convención distinta de la de
   * `/transactions/sync`, y por eso los dos campos van separados.
   */
  readonly importe: string
  readonly direction: Direccion
  readonly isoCurrencyCode: string
  readonly ciudad?: string
  readonly region?: string
  readonly pais?: string
  /** Código de categoría de comercio, si el banco lo dio. */
  readonly mcc?: string
}

export interface MovimientoEnriquecido {
  readonly id: string
  readonly merchantName: string | null
  readonly website: string | null
  readonly logoUrl: string | null
  readonly categoriaPersonal: CategoriaPersonal | null
  readonly paymentChannel: string | null
  readonly contrapartes: readonly ContrapartePlaid[]
  readonly crudo: Crudo
}

/**
 * Le da la vuelta al signo de un importe decimal **sobre el texto**.
 *
 * Existe para que nadie tenga que escribir `String(-Number(texto))`, que es la
 * forma natural de hacerlo y mete el importe en coma flotante en el último
 * sitio donde todavía era exacto. Acá no hay aritmética: se quita o se pone un
 * guion delante.
 *
 * El cero no lleva signo. `-0` es un importe válido en coma flotante y no es un
 * importe válido en un libro.
 */
export function invertirSigno(texto: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(texto)) {
    throw new Error(
      `No es un decimal al que se le pueda invertir el signo: ${JSON.stringify(texto)}`,
    )
  }
  if (/^-?0(\.0+)?$/.test(texto)) return texto.startsWith('-') ? texto.slice(1) : texto
  return texto.startsWith('-') ? texto.slice(1) : `-${texto}`
}
