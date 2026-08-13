/**
 * Mapeador del feed de Plaid al contrato de los parsers.
 *
 * Mismo recorrido que `finapi/map.ts`, y las mismas decisiones: función pura
 * —sin red, sin I/O, sin reloj— que produce un `ParsedStatement`, para que la
 * fuente nueva entre por el enchufe que ya existe (pipeline → dedup →
 * `persistImport` → mismas reglas, mismos informes) o no entre. Un feed es una
 * fuente de entrada al libro, nunca un sustituto del libro.
 *
 * Lo que cambia respecto de finAPI son tres cosas, y las tres son trampas.
 *
 * ── 1. EL SIGNO ESTÁ AL REVÉS ───────────────────────────────────────────────
 *
 * En Plaid un importe **positivo significa que el dinero SALE** de la cuenta, y
 * uno negativo que entra. Es al revés que en un extracto y al revés que nuestro
 * convenio (`StatementLine.amount`: negativo = sale de la cuenta). Acá se
 * invierte, y es la línea más peligrosa del módulo: si esto se equivoca, todos
 * los gastos entran como ingresos, el patrimonio sale espejado y **no falla
 * nada** — el asiento balancea a cero igual, y si el saldo también se hubiera
 * invertido la reconciliación cuadraría igual. Un error que cuadra es el que
 * nadie encuentra. Por eso hay tests en las dos direcciones, y por eso la
 * inversión se hace con `negate` sobre el `bigint` ya parseado y no
 * manipulando el texto del signo, que es donde se cuelan el '+' y el '-0'.
 *
 * ── 2. El importe viaja como TEXTO ──────────────────────────────────────────
 *
 * En la respuesta de Plaid el importe es un literal numérico de JSON
 * (`"amount": 101.01`). Un `JSON.parse` lo convierte en coma flotante **antes
 * de que nadie lo mire**, que es exactamente lo que el núcleo entero existe
 * para impedir. Por eso este módulo recibe los importes como texto: el cliente
 * HTTP los saca del cuerpo crudo con el mismo lector de JSON exacto que ya se
 * usa para finAPI —un escáner léxico que entrecomilla todos los números— y los
 * pasa tal cual. Si aun así llega un `number`, acá se falla ruidosamente en vez
 * de convertirlo. Un céntimo de deriva no se ve, y lo que no se ve no se
 * arregla.
 *
 * Tampoco se usa `parseAmount` de `shared/numeric`: esa función existe para
 * adivinar el locale de un fichero de banco ("1.234" puede ser mil doscientos
 * treinta y cuatro o uno coma dos). Acá no hay nada que adivinar —la gramática
 * de los números de JSON tiene punto decimal y no tiene separador de miles— y
 * dejar que la heurística opine sobre un dato inequívoco sólo puede empeorarlo.
 *
 * ── 3. Un movimiento pendiente NO entra al libro ────────────────────────────
 *
 * Plaid marca con `pending: true` la operación que el banco vio pero todavía no
 * asentó. Acá se mapea, se cuenta y se avisa con su importe, pero no produce
 * línea. Dos razones que apuntan al mismo sitio:
 *
 *  · **La reconciliación.** `balances.current` es el saldo asentado y los
 *    pendientes no están dentro. Meterlos como líneas garantiza un delta en
 *    cada sincronización, y un delta sin causa visible es justo el fallo que el
 *    informe de importación existe para no tener. Peor: ese delta se da vuelta
 *    solo unos días después, cuando la operación asienta, así que ni siquiera
 *    es un desfase estable contra el que uno pueda calibrar.
 *
 *  · **El importe todavía no es el importe.** Un pendiente de restaurante entra
 *    sin la propina; uno en divisa, con una estimación de cambio. Asentarlo es
 *    escribir en el libro un número que sabemos que va a cambiar.
 *
 * Y cuando asienta no hay nada que deshacer. Plaid emite un movimiento NUEVO,
 * con otro `transaction_id`, que apunta al anterior por `pending_transaction_id`
 * y manda el pendiente en `removed`: como el pendiente nunca entró, el asentado
 * entra como lo que es —un movimiento nuevo— y el `removed` no tiene nada que
 * borrar. Si en cambio la entidad reutiliza el mismo `transaction_id` y lo manda
 * en `modified`, la línea aparece por primera vez el día que asienta. Los dos
 * caminos dejan el libro diciendo lo mismo, y ninguno depende de que el borrado
 * funcione.
 *
 * El coste está declarado y es real: hasta que asienta, el movimiento no está en
 * el libro. Está en el informe, como aviso, con su importe y con el total.
 *
 * ── Lo que este módulo NO hace ──────────────────────────────────────────────
 *
 * `/transactions/sync` devuelve `added`, `modified` y `removed` con un cursor.
 * Acá entran `added` y `modified` mezclados y sin distinguirlos: los dos son
 * transacciones completas, y quién es novedad y quién corrección lo decide el
 * dedup, que para eso tiene el veredicto 'updated'. `removed` no llega nunca —
 * no son transacciones, son identificadores de movimientos que el banco retiró,
 * y borrar del libro es una operación del orquestador, con su transacción y su
 * lote reversible, no de un mapeador puro. El cursor tampoco es asunto de acá.
 */

import {
  type CurrencyCode,
  currencyCode,
  fromDecimalString,
  type Money,
  negate,
  type ParsedStatement,
  ParseError,
  type ParseWarning,
  type PlainDate,
  type StatementBalance,
  type StatementLine,
  toDecimalString,
  tryParsePlainDate,
} from '@moneypilot/core'
import { maskAccountNumber } from '../shared/mask.js'

/**
 * Los nombres de campo van en snake_case, tal como los manda Plaid.
 *
 * Renombrarlos a camelCase obligaría a traducir mentalmente cada vez que
 * alguien compare este fichero con la documentación o con una respuesta cruda
 * guardada en `raw`, y esa traducción es donde se pierden los campos. La
 * interfaz de un proveedor se parece al proveedor.
 */

/**
 * Una contraparte según el motor de entidades de Plaid: comercio, procesador,
 * aplicación de pagos. Es enriquecimiento de ELLOS, no un dato del banco.
 */
export interface PlaidCounterparty {
  readonly name: string | null
  /** 'merchant', 'financial_institution', 'payment_app', 'marketplace'… */
  readonly type: string | null
  /**
   * Identificador estable del comercio dentro de Plaid. Es el análogo del IBAN
   * de la contraparte en finAPI: sobrevive a los cambios de descriptor, así que
   * es mucho mejor clave de comercio para las reglas que cualquier texto.
   */
  readonly entity_id?: string | null
  /** 'VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'. */
  readonly confidence_level?: string | null
  readonly website?: string | null
  readonly logo_url?: string | null
}

/** La taxonomía de Plaid. NO es nuestra cuenta contable. Ver `collectRaw`. */
export interface PlaidPersonalFinanceCategory {
  readonly primary: string | null
  readonly detailed: string | null
  readonly confidence_level?: string | null
}

/**
 * Dónde ocurrió, según Plaid.
 *
 * Deliberadamente **no** se declaran `address`, `lat` ni `lon`. El contrato de
 * `raw` es no perder nada de lo que explique el movimiento y el dinero; la
 * calle exacta y las coordenadas de cada compra de una familia no cambian
 * ninguna decisión contable y sí convierten nuestra base en un registro de
 * dónde estuvo cada uno. Lo que no se guarda no se filtra.
 */
export interface PlaidLocation {
  readonly city?: string | null
  readonly region?: string | null
  readonly postal_code?: string | null
  readonly country?: string | null
}

/**
 * Un movimiento tal como lo devuelve `/transactions/sync` (en `added` o en
 * `modified`), con una única desviación deliberada: `amount` es `string`.
 */
export interface PlaidRawTransaction {
  /**
   * Identificador del movimiento dentro del item. Va a `externalId`, y para
   * origen 'api' **es la clave del dedup** (siempre junto a la cuenta): es lo
   * único estable cuando la descripción, el importe o la fecha cambian.
   */
  readonly transaction_id: string
  readonly account_id: string
  /** true mientras el banco no lo haya asentado. Ver la cabecera del módulo. */
  readonly pending: boolean
  /**
   * Cuando este movimiento es el asiento definitivo de uno que estaba
   * pendiente, acá viene el `transaction_id` de aquél. Es el hilo entre los dos
   * y se conserva siempre.
   */
  readonly pending_transaction_id: string | null
  /**
   * Fecha de asiento. Es la canónica: va a `bookedOn`.
   *
   * Admite `null` porque el cliente HTTP no tiene por qué inventarse una cadena
   * vacía para disimular un campo ausente. `buildLine` ya sabe rechazar la
   * línea con su aviso.
   */
  readonly date: string | null
  /** Fecha en que se autorizó la operación. Va a `valuedOn`, nunca a `bookedOn`. */
  readonly authorized_date: string | null
  /** Instante ISO-8601 con zona. Se conserva en `raw` y no se usa como fecha. */
  readonly datetime?: string | null
  readonly authorized_datetime?: string | null
  /**
   * Decimal como TEXTO, nunca `number`, y **con el signo de Plaid**: positivo
   * es dinero que sale. La inversión la hace este módulo, no el cliente, para
   * que haya un solo sitio donde el convenio se cruza.
   */
  readonly amount: string
  readonly iso_currency_code: string | null
  /** Para cripto y monedas fuera de ISO 4217. Exactamente uno de los dos viene. */
  readonly unofficial_currency_code: string | null
  /** El descriptor tal como lo manda la entidad. Es lo que ve el usuario. */
  readonly name: string | null
  /** El comercio según el enriquecimiento de Plaid. Derivado, no original. */
  readonly merchant_name: string | null
  readonly merchant_entity_id?: string | null
  readonly website?: string | null
  readonly logo_url?: string | null
  /** 'in store', 'online' u 'other'. */
  readonly payment_channel: string | null
  /**
   * Código del tipo de operación en Europa ('direct debit', 'transfer',
   * 'atm'…). Lo emite la entidad, no Plaid; es el análogo de `typeCodeZka`.
   */
  readonly transaction_code?: string | null
  readonly personal_finance_category: PlaidPersonalFinanceCategory | null
  readonly counterparties?: readonly PlaidCounterparty[] | null
  readonly location?: PlaidLocation | null
}

export interface PlaidBalances {
  /**
   * Saldo asentado, como TEXTO. Es el que corresponde al libro: los pendientes
   * no están dentro, y acá tampoco entran.
   */
  readonly current: string | null
  /** Disponible: descuenta retenciones y pendientes. No se usa para conciliar. */
  readonly available?: string | null
  readonly limit?: string | null
  readonly iso_currency_code: string | null
  readonly unofficial_currency_code: string | null
  /**
   * Cuándo leyó la entidad ese saldo. Muy pocas instituciones lo mandan; cuando
   * falta, la fecha la pone el llamador con `balanceAsOf`.
   */
  readonly last_updated_datetime?: string | null
}

/** Una cuenta de `/accounts/get`, otra vez con los importes como texto. */
export interface PlaidRawAccount {
  readonly account_id: string
  /** El nombre corto, el que el usuario reconoce en su banco. */
  readonly name: string | null
  /** El nombre formal del producto. Más preciso y menos legible. */
  readonly official_name: string | null
  /** Últimos dígitos de la cuenta. Plaid ya lo manda enmascarado. */
  readonly mask: string | null
  /** 'depository', 'credit', 'loan', 'investment', 'brokerage', 'other'. */
  readonly type: string | null
  readonly subtype: string | null
  readonly balances: PlaidBalances
  /** No viene con la cuenta: el cliente lo adjunta desde `/institutions`. */
  readonly institution_name?: string | null
}

export interface MapPlaidOptions {
  /**
   * Moneda a usar si la cuenta no declara ninguna. Se avisa siempre que haga
   * falta recurrir a ella: una cuenta sin moneda es un dato que falta, no un
   * detalle.
   */
  readonly fallbackCurrency?: string
  /**
   * Día al que corresponde el saldo, cuando Plaid no lo declara — que es casi
   * siempre.
   *
   * Lo pone el llamador porque el llamador es el único que sabe cuándo
   * preguntó, y porque un mapeador puro no mira el reloj: si esta función
   * leyera la hora, dos ejecuciones sobre el mismo lote darían extractos
   * distintos y el informe dejaría de ser reproducible. Sin fecha no se declara
   * saldo, y sin saldo declarado no hay contra qué conciliar.
   */
  readonly balanceAsOf?: string
}

/**
 * Cuentas donde Plaid expresa el saldo como importe ADEUDADO en positivo.
 *
 * Es la misma inversión que la de los importes, en el otro extremo: una tarjeta
 * con 1.200 de deuda viene como `current: 1200` y en el libro es −1.200. Si se
 * copiara tal cual, el patrimonio sumaría la deuda en vez de restarla y el
 * delta de la reconciliación saldría al doble del saldo.
 */
const CUENTAS_DE_DEUDA = new Set(['credit', 'loan'])

/**
 * Convierte una cuenta de Plaid y sus movimientos en un extracto.
 *
 * Los movimientos que no se pueden asentar sin inventar un dato (otra cuenta,
 * otra divisa, sin fecha, sin identificador, importe ilegible) no se cuelan: se
 * descartan con un aviso de severidad `error` y su número de línea, que es lo
 * que el informe de importación muestra como fila rechazada. Los pendientes se
 * descartan también, pero con severidad `info`: no son un fallo, son un
 * movimiento que todavía no ocurrió del todo. Descartar en silencio es la única
 * forma de fallar que este producto no se permite.
 */
export function mapPlaidAccount(
  cuenta: PlaidRawAccount,
  movimientos: readonly PlaidRawTransaction[],
  options: MapPlaidOptions = {},
): ParsedStatement {
  const warnings: ParseWarning[] = []
  const currency = resolveCurrency(cuenta, options, warnings)

  const lines: StatementLine[] = []
  const pendientes: Money[] = []
  for (const [index, dated] of orderForImport(movimientos).entries()) {
    const line = buildLine(dated, index + 1, cuenta, currency, warnings, pendientes)
    if (line !== null) lines.push(line)
  }
  if (pendientes.length > 0) warnings.push(resumenDePendientes(pendientes, currency))

  const closingBalance = readBalance(cuenta, currency, options, warnings)

  return {
    format: 'plaid',
    account: {
      currency,
      ...pick('institution', institutionOf(cuenta)),
      // Enmascarado como en todos los parsers. Plaid ya manda sólo los últimos
      // dígitos, pero pasa igual por el mismo enmascarador: así el formato es
      // idéntico al del resto del sistema y una entidad que devolviera algo más
      // largo de lo que promete no cuela un número entero en la base.
      ...pick('accountNumber', maskAccountNumber(text(cuenta.mask))),
    },
    ...pick('closingBalance', closingBalance),
    lines,
    warnings,
  }
}

/**
 * Agrupa por cuenta lo que devuelve una sincronización y produce un extracto por
 * cuenta, igual que `parseOfx` con un fichero de varias cuentas.
 *
 * `/transactions/sync` devuelve los movimientos de todas las cuentas del item
 * mezclados, así que agrupar es parte del mapeo y no del cliente: hacerlo mal
 * atribuye movimientos a la cuenta equivocada, que es un error que cuadra igual
 * y miente igual.
 */
export function mapPlaidStatements(
  cuentas: readonly PlaidRawAccount[],
  movimientos: readonly PlaidRawTransaction[],
  options: MapPlaidOptions = {},
): ParsedStatement[] {
  const porCuenta = new Map<string, PlaidRawTransaction[]>()
  for (const cuenta of cuentas) porCuenta.set(cuenta.account_id, [])

  const huerfanos: string[] = []
  for (const movimiento of movimientos) {
    const grupo = porCuenta.get(movimiento.account_id)
    if (grupo === undefined) huerfanos.push(movimiento.transaction_id)
    else grupo.push(movimiento)
  }

  // Un movimiento sin cuenta no se puede asentar, y tirarlo callado sería perder
  // plata sin dejar rastro. Es un fallo del cliente (pidió movimientos de
  // cuentas que no trajo), no un dato dudoso: se corta la importación.
  if (huerfanos.length > 0) {
    throw new ParseError(
      `${huerfanos.length} movimiento(s) pertenecen a cuentas que no se pasaron ` +
        `(por ejemplo el ${huerfanos[0]}). Hay que leer /accounts/get antes de mapear.`,
      'movimiento_huerfano',
    )
  }

  return cuentas.map((cuenta) =>
    mapPlaidAccount(cuenta, porCuenta.get(cuenta.account_id) ?? [], options),
  )
}

// ── Fechas ───────────────────────────────────────────────────────────────────

interface DatedTransaction {
  readonly tx: PlaidRawTransaction
  /** Contable. `null` cuando no hay ninguna fecha legible. */
  readonly bookedOn: PlainDate | null
  readonly valuedOn: PlainDate | null
  /** true si hubo que usar la fecha de autorización como contable. */
  readonly bookedFromAuthorized: boolean
}

/**
 * Cuál es cuál, y por qué.
 *
 * `date` es la fecha de asiento —el día en que el movimiento quedó en la cuenta,
 * y el que el banco enseña en el extracto—, así que es `bookedOn`: la canónica
 * para cortes de período y para la huella de identidad.
 *
 * `authorized_date` es cuándo se autorizó la operación: el día que uno pasó la
 * tarjeta. Va a `valuedOn`, que es donde el modelo guarda "cuándo ocurrió" sin
 * mezclarlo con "cuándo se asentó". Usarla como contable movería las
 * transacciones de mes —una compra del 31 que asienta el 2 se iría al mes
 * anterior— y, peor, cambiaría la huella de identidad de todo lo ya importado
 * el día que Plaid empiece a rellenar el campo en una entidad donde hoy viene
 * vacío.
 *
 * El orden de las líneas también se impone acá. Un feed no tiene filas: tiene un
 * JSON cuyo orden decide el servidor. Como `lineNumber` termina en el informe y
 * en los identificadores de la previa, se ordena por fecha contable y luego por
 * `transaction_id` para que dos lecturas del mismo lote produzcan exactamente
 * los mismos números y el informe se lea en orden cronológico.
 */
function orderForImport(movimientos: readonly PlaidRawTransaction[]): DatedTransaction[] {
  const dated = movimientos.map((tx) => {
    const booking = toPlainDate(tx.date)
    const valuedOn = toPlainDate(tx.authorized_date)
    return {
      tx,
      bookedOn: booking ?? valuedOn,
      valuedOn,
      bookedFromAuthorized: booking === null && valuedOn !== null,
    }
  })

  // Los que no tienen fecha van al final: '~' es mayor que cualquier dígito, así
  // que ordena sin necesidad de una rama aparte.
  return dated.sort((a, b) => {
    const keyA = a.bookedOn ?? '~'
    const keyB = b.bookedOn ?? '~'
    if (keyA !== keyB) return keyA < keyB ? -1 : 1
    if (a.tx.transaction_id === b.tx.transaction_id) return 0
    return a.tx.transaction_id < b.tx.transaction_id ? -1 : 1
  })
}

/**
 * Plaid manda fechas 'YYYY-MM-DD' e instantes ISO-8601 con zona
 * ('2024-08-13T10:04:11Z'). Nos quedamos con el día tal como lo escribió el
 * origen: cortando el texto, nunca construyendo un `Date`, que reinterpretaría
 * el instante en la zona del servidor y correría la fecha un día.
 */
function toPlainDate(raw: string | null | undefined): PlainDate | null {
  if (raw === null || raw === undefined) return null
  const trimmed = raw.trim()
  if (trimmed === '') return null
  return tryParsePlainDate(trimmed.slice(0, 10))
}

// ── Movimiento ───────────────────────────────────────────────────────────────

function buildLine(
  dated: DatedTransaction,
  lineNumber: number,
  cuenta: PlaidRawAccount,
  currency: CurrencyCode,
  warnings: ParseWarning[],
  pendientes: Money[],
): StatementLine | null {
  const { tx, bookedOn, valuedOn, bookedFromAuthorized } = dated

  // Se comprueba antes que nada porque no es un dato dudoso de una fila: si un
  // importe llegó como número, llegaron todos así y la importación entera está
  // mal. Mejor cortarla que producir mil filas plausibles.
  if (typeof tx.amount !== 'string') {
    throw new ParseError(
      `El movimiento ${tx.transaction_id} trae el importe como ${typeof tx.amount} en vez de ` +
        'texto. Alguien hizo JSON.parse sobre la respuesta de Plaid y el importe ya pasó por coma ' +
        'flotante: hay que leerlo del cuerpo crudo de la respuesta.',
      'importe_no_textual',
      lineNumber,
    )
  }

  if (tx.account_id !== cuenta.account_id) {
    warnings.push({
      severity: 'error',
      code: 'cuenta_ajena',
      message: `El movimiento ${tx.transaction_id} es de la cuenta ${tx.account_id}, no de la ${cuenta.account_id}.`,
      lineNumber,
    })
    return null
  }

  // Sin identificador, este movimiento no se puede corregir nunca: el dedup de
  // origen 'api' recae en la huella, y la huella lleva dentro el importe, la
  // fecha y la descripción — las tres cosas que cambian cuando el banco corrige.
  // Un 'modified' posterior entraría como movimiento nuevo y lo contaría dos
  // veces. Preferimos una fila rechazada y visible.
  if (text(tx.transaction_id) === undefined) {
    warnings.push({
      severity: 'error',
      code: 'identificador_ausente',
      message:
        'Un movimiento llegó sin transaction_id. Es la clave con la que el feed corrige lo ya ' +
        'asentado; sin ella no se puede asentar sin arriesgarse a duplicarlo en la próxima ' +
        'sincronización.',
      lineNumber,
    })
    return null
  }

  if (bookedOn === null) {
    warnings.push({
      severity: 'error',
      code: 'fecha_ilegible',
      message:
        `El movimiento ${tx.transaction_id} no trae ninguna fecha legible ` +
        `(date: ${JSON.stringify(tx.date)}, authorized_date: ${JSON.stringify(tx.authorized_date)}).`,
      lineNumber,
    })
    return null
  }

  if (bookedFromAuthorized) {
    // La fecha contable entra en la huella de identidad: cambiarla en silencio
    // haría que el mismo movimiento tenga dos identidades según cuándo se
    // sincronizó. Se usa la de autorización porque es la única que hay, y se
    // avisa.
    warnings.push({
      severity: 'warning',
      code: 'fecha_contable_ausente',
      message: `El movimiento ${tx.transaction_id} no trae fecha de asiento; se usa la de autorización (${bookedOn}).`,
      lineNumber,
    })
  }

  // Mezclar divisas dentro de una cuenta produce un saldo que no significa nada.
  // Preferimos una fila rechazada y visible en el informe a un importe plausible
  // y equivocado, que es el peor error posible acá.
  const declared = text(tx.iso_currency_code) ?? text(tx.unofficial_currency_code)
  if (declared !== undefined && declared.toUpperCase() !== currency) {
    warnings.push({
      severity: 'error',
      code: 'divisa_distinta',
      message: `El movimiento ${tx.transaction_id} está en ${declared} y la cuenta en ${currency}.`,
      lineNumber,
    })
    return null
  }

  let amount: Money
  try {
    // Acá y en ningún otro sitio se cruza el convenio de signos. `negate` opera
    // sobre el bigint ya parseado: invertir el texto ('+3' → '-3', '0.00' →
    // '-0.00') sería una fuente de casos raros a cambio de nada.
    amount = negate(fromDecimalString(tx.amount.trim(), currency))
  } catch (error) {
    warnings.push({
      severity: 'error',
      code: 'importe_ilegible',
      message: `Importe inaceptable en el movimiento ${tx.transaction_id}: ${JSON.stringify(tx.amount)} (${String(error)})`,
      lineNumber,
    })
    return null
  }

  // El pendiente se descarta al final y no al principio a propósito: primero se
  // valida como cualquier otro. Un pendiente con la fecha rota o el importe
  // ilegible tiene que verse hoy en el informe y no dentro de tres días, cuando
  // asiente y siga roto.
  if (tx.pending === true) {
    pendientes.push(amount)
    warnings.push({
      severity: 'info',
      code: 'movimiento_pendiente',
      message:
        `El movimiento ${tx.transaction_id} (${bookedOn}, ${toDecimalString(amount)} ${currency}, ` +
        `${buildDescription(tx)}) está pendiente de asiento y no entra al libro. Entrará cuando ` +
        'el banco lo asiente, con el importe definitivo.',
      lineNumber,
    })
    return null
  }

  return {
    lineNumber,
    bookedOn,
    amount,
    description: buildDescription(tx),
    raw: collectRaw(tx),
    ...pick('valuedOn', valuedOn ?? undefined),
    // Para origen 'api' esto es la clave del dedup, no un atributo más: es lo
    // que permite que un 'modified' corrija el asiento en su sitio en vez de
    // duplicarlo. Va tal cual vino, sin prefijos ni normalización.
    externalId: tx.transaction_id,
  }
}

/**
 * Qué ve el usuario.
 *
 * `name` es el descriptor que emitió la entidad; `merchant_name` es el comercio
 * que dedujo Plaid. Gana `name`, y no es una elección de estilo: la descripción
 * alimenta `normalizeDescription`, o sea la huella de identidad. Atar la
 * identidad de nuestras transacciones al enriquecimiento de un tercero significa
 * que el día que ellos lo mejoren —y lo mejoran seguido, es su producto— la
 * huella cambia sola y dejamos de reconocer lo ya importado, tanto lo que entró
 * por este feed como lo que entró por fichero. La huella sólo puede depender de
 * lo que emitió el banco.
 *
 * Es exactamente la decisión que ya se tomó en finAPI con `cleanedPurpose`, y
 * `merchant_name` es el mismo animal. Lo mismo vale, con más razón, para
 * `counterparties[].name` y para `personal_finance_category`.
 *
 * `merchant_name` sólo aparece como último recurso, cuando la entidad no mandó
 * descriptor: sin descripción la fila es ilegible para el usuario, y una línea
 * ilegible es peor que una huella atada al enriquecimiento.
 *
 * (Que el descriptor mute entre sincronizaciones es un riesgo propio del feed.
 * Para origen 'api' lo resuelve `transaction_id`, que manda antes que la huella;
 * ver la cabecera de dedup.ts.)
 */
function buildDescription(tx: PlaidRawTransaction): string {
  return text(tx.name) ?? text(tx.merchant_name) ?? text(tx.transaction_code) ?? 'Sin descripción'
}

/**
 * Todo lo que vino, tal cual. `raw` es la única prueba cuando dentro de seis
 * meses haya que responder por qué una transacción quedó como quedó.
 *
 * Tres cosas que se guardan por motivos concretos:
 *
 *  - `amount` **con el signo de Plaid**, sin invertir: es la prueba de qué mandó
 *    el proveedor, y para eso tiene que ser literal. Que no coincida en signo
 *    con `line.amount` no es una ambigüedad: el lote declara `format: 'plaid'`,
 *    y ahí está dicho, una vez y en el sitio correcto, qué convenio siguió lo
 *    que se guardó.
 *  - `merchant_entity_id` y `counterparties.N.entity_id`. Son identificadores
 *    estables de comercio, que es justo lo que un descriptor no es: el texto
 *    cambia entre cargos, el identificador no. Es lo que va a hacer que las
 *    reglas funcionen mucho mejor que con un fichero. Que no entren en la
 *    descripción no significa que se tiren.
 *  - `personal_finance_category` con su confianza. Es la taxonomía de Plaid y no
 *    es una categoría contable: ellos resuelven descriptor→comercio, que es un
 *    problema de texto y lo hacen bien. Comercio→estructura de cuentas —si el
 *    seguro es de la sociedad o gasto personal— depende del plan contable de
 *    esta familia, y eso no lo puede saber un agregador. Se conserva como dato,
 *    con su nivel de confianza para que una regla pueda exigirlo, y **no toca la
 *    cuenta de contrapartida**.
 */
function collectRaw(tx: PlaidRawTransaction): Record<string, string> {
  const raw: Record<string, string> = {}
  put(raw, 'transaction_id', tx.transaction_id)
  put(raw, 'account_id', tx.account_id)
  put(raw, 'pending_transaction_id', tx.pending_transaction_id)
  put(raw, 'date', tx.date)
  put(raw, 'authorized_date', tx.authorized_date)
  put(raw, 'datetime', tx.datetime)
  put(raw, 'authorized_datetime', tx.authorized_datetime)
  put(raw, 'amount', tx.amount)
  put(raw, 'iso_currency_code', tx.iso_currency_code)
  put(raw, 'unofficial_currency_code', tx.unofficial_currency_code)
  put(raw, 'name', tx.name)
  put(raw, 'merchant_name', tx.merchant_name)
  put(raw, 'merchant_entity_id', tx.merchant_entity_id)
  put(raw, 'website', tx.website)
  put(raw, 'logo_url', tx.logo_url)
  put(raw, 'payment_channel', tx.payment_channel)
  put(raw, 'transaction_code', tx.transaction_code)

  const pfc = tx.personal_finance_category
  if (pfc !== null && pfc !== undefined) {
    put(raw, 'personal_finance_category.primary', pfc.primary)
    put(raw, 'personal_finance_category.detailed', pfc.detailed)
    put(raw, 'personal_finance_category.confidence_level', pfc.confidence_level)
  }

  const location = tx.location
  if (location !== null && location !== undefined) {
    put(raw, 'location.country', location.country)
    put(raw, 'location.city', location.city)
    put(raw, 'location.region', location.region)
    put(raw, 'location.postal_code', location.postal_code)
  }

  // Clave punteada con el índice, igual que el aplanador del lector de JSON:
  // dentro de seis meses alguien va a tener que leer esto para explicar un
  // asiento, y `counterparties.0.name` se lee; un JSON serializado dentro de una
  // columna de texto, no.
  for (const [indice, parte] of (tx.counterparties ?? []).entries()) {
    put(raw, `counterparties.${indice}.name`, parte.name)
    put(raw, `counterparties.${indice}.type`, parte.type)
    put(raw, `counterparties.${indice}.entity_id`, parte.entity_id)
    put(raw, `counterparties.${indice}.confidence_level`, parte.confidence_level)
    put(raw, `counterparties.${indice}.website`, parte.website)
    put(raw, `counterparties.${indice}.logo_url`, parte.logo_url)
  }

  // Siempre, también cuando es false: "no estaba pendiente" y "no lo dijeron"
  // son cosas distintas, y la evidencia tiene que distinguirlas. Con un feed que
  // decide qué entra al libro según este campo, más todavía.
  if (typeof tx.pending === 'boolean') raw['pending'] = String(tx.pending)
  return raw
}

/**
 * Un solo aviso con el total de lo que quedó fuera.
 *
 * Los pendientes ya se avisan de a uno, con su línea, pero el delta de la
 * reconciliación es **un** número: para poder atribuirlo hace falta el otro
 * número al lado. Con esto, "el saldo no cuadra por 87,32" se explica sin abrir
 * nada más.
 */
function resumenDePendientes(pendientes: readonly Money[], currency: CurrencyCode): ParseWarning {
  let total = 0n
  for (const pendiente of pendientes) total += pendiente.amount
  return {
    severity: 'info',
    code: 'pendientes_no_asentados',
    message:
      `${pendientes.length} movimiento(s) pendientes no entran al libro; suman ` +
      `${toDecimalString({ amount: total, currency })} ${currency}. Si el saldo declarado los ` +
      'incluyera, ése es exactamente el desfase esperado.',
  }
}

// ── Cuenta ───────────────────────────────────────────────────────────────────

function resolveCurrency(
  cuenta: PlaidRawAccount,
  options: MapPlaidOptions,
  warnings: ParseWarning[],
): CurrencyCode {
  const oficial = text(cuenta.balances.iso_currency_code)
  const noOficial = text(cuenta.balances.unofficial_currency_code)

  if (oficial === undefined && noOficial !== undefined) {
    // Se acepta y se avisa, en vez de rechazar la cuenta entera. El riesgo real
    // es el exponente: fuera de ISO 4217 no sabemos cuántos decimales tiene la
    // unidad mínima y `currencyExponent` va a asumir 2. Eso no se queda
    // escondido — un importe de ocho decimales revienta movimiento por
    // movimiento con 'importe_ilegible' en vez de perder dígitos en silencio.
    warnings.push({
      severity: 'warning',
      code: 'divisa_no_oficial',
      message:
        `La cuenta ${cuenta.account_id} no declara moneda ISO sino ${JSON.stringify(noOficial)}. ` +
        'Se la trata con dos decimales, que es lo que asume el núcleo; si la unidad mínima no es ' +
        'esa, los importes se van a rechazar de a uno en vez de redondearse.',
    })
  }

  const candidate = oficial ?? noOficial ?? text(options.fallbackCurrency)
  if (candidate === undefined) {
    warnings.push({
      severity: 'warning',
      code: 'moneda_no_declarada',
      message: `La cuenta ${cuenta.account_id} no declara moneda; se asume EUR. Verificar antes de importar.`,
    })
    return currencyCode('EUR')
  }
  try {
    return currencyCode(candidate)
  } catch {
    warnings.push({
      severity: 'error',
      code: 'moneda_invalida',
      message: `Moneda inválida en la cuenta ${cuenta.account_id}: ${JSON.stringify(candidate)}. Se asume EUR.`,
    })
    return currencyCode('EUR')
  }
}

/** Nombre del banco y de la cuenta: dos cuentas en el mismo banco se distinguen. */
function institutionOf(cuenta: PlaidRawAccount): string | undefined {
  const parts = [
    text(cuenta.institution_name),
    text(cuenta.name) ?? text(cuenta.official_name),
  ].filter((value): value is string => value !== undefined)
  return parts.length === 0 ? undefined : parts.join(' · ')
}

/**
 * El saldo del feed **no es un saldo de cierre de período**: es el saldo que
 * Plaid leyó de la entidad. Se declara igual, y con su fecha, por un motivo
 * concreto: `openingEntryAmount` calcula hacia atrás el asiento de apertura
 * desde un saldo conocido, que es justo lo que hace falta cuando se importan 24
 * meses de una cuenta que existe hace 15 años.
 *
 * Se usa `current` y no `available`. `available` descuenta retenciones y
 * pendientes —o sea, cosas que no están asentadas—, y en una tarjeta ni
 * siquiera es un saldo sino el crédito que queda. `current` es el saldo
 * asentado, que es exactamente lo que nuestras líneas suman, ya que los
 * pendientes se quedan fuera.
 *
 * No convierte la importación en conciliada por sí solo: sin saldo de apertura
 * declarado, `reconcileAccount` reporta 'sin_saldo_declarado', que es la verdad.
 * Derivar la apertura restando los movimientos daría delta cero siempre y
 * convertiría la comprobación en una tautología.
 */
function readBalance(
  cuenta: PlaidRawAccount,
  currency: CurrencyCode,
  options: MapPlaidOptions,
  warnings: ParseWarning[],
): StatementBalance | undefined {
  const balance = cuenta.balances.current
  if (balance === null || balance === undefined) return undefined

  if (typeof balance !== 'string') {
    throw new ParseError(
      `El saldo de la cuenta ${cuenta.account_id} llegó como ${typeof balance} en vez de texto: ` +
        'pasó por coma flotante antes de que lo viéramos.',
      'importe_no_textual',
    )
  }

  // La de la entidad primero: es cuándo se leyó de verdad. La del llamador es el
  // reemplazo honesto —cuándo preguntamos nosotros— y Plaid casi nunca manda la
  // primera.
  const on = toPlainDate(cuenta.balances.last_updated_datetime) ?? toPlainDate(options.balanceAsOf)
  if (on === null) {
    warnings.push({
      severity: 'warning',
      code: 'saldo_sin_fecha',
      message:
        `La cuenta ${cuenta.account_id} declara saldo pero no cuándo se leyó, y el llamador no ` +
        'pasó balanceAsOf; sin fecha no se puede conciliar contra nada.',
    })
    return undefined
  }

  let amount: Money
  try {
    amount = fromDecimalString(balance.trim(), currency)
  } catch (error) {
    warnings.push({
      severity: 'warning',
      code: 'saldo_ilegible',
      message: `Saldo ilegible en la cuenta ${cuenta.account_id}: ${JSON.stringify(balance)} (${String(error)})`,
    })
    return undefined
  }

  const esDeuda = CUENTAS_DE_DEUDA.has((text(cuenta.type) ?? '').toLowerCase())
  if (esDeuda) {
    amount = negate(amount)
    warnings.push({
      severity: 'info',
      code: 'saldo_de_deuda_invertido',
      message:
        `La cuenta ${cuenta.account_id} es de tipo ${cuenta.type} y Plaid declara su saldo como ` +
        `importe adeudado en positivo; se guarda como ${toDecimalString(amount)} ${currency}, que ` +
        'es como lo ve el libro.',
    })
  }

  warnings.push({
    severity: 'info',
    code: 'saldo_de_feed',
    message:
      `El saldo declarado (${on}) es el que Plaid leyó de la entidad, no el cierre del período ` +
      'descargado, y es el saldo asentado: no incluye los pendientes.',
  })
  return { amount, on }
}

// ── Utilidades ───────────────────────────────────────────────────────────────

/** Texto útil o nada: el vacío y el blanco son ausencia, no dato. */
function text(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Escribe en `raw` sin perder nada y sin guardar ausencias. Los importes
 * **nunca** pasan por acá convertidos: llegan ya como string.
 */
function put(raw: Record<string, string>, key: string, value: string | null | undefined) {
  if (value === null || value === undefined) return
  const asText = value.trim()
  if (asText === '') return
  raw[key] = asText
}

/** Omite la clave cuando el valor es undefined, para respetar exactOptionalPropertyTypes. */
function pick<K extends string, V>(
  key: K,
  value: V | undefined,
): Record<K, V> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>)
}
