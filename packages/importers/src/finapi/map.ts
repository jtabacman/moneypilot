/**
 * Mapeador del feed de finAPI al contrato de los parsers.
 *
 * finAPI es un agregador: lo que devuelve no es el fichero del banco, es la
 * lectura que **ellos** hicieron del banco. Este módulo existe para que esa
 * diferencia no se filtre al motor. Es una función pura —sin red, sin I/O,
 * sin reloj— exactamente igual que los cinco parsers de fichero, y produce lo
 * mismo que ellos: un `ParsedStatement`. La fuente nueva entra por el enchufe
 * que ya existe (pipeline → dedup → `persistImport` → mismas reglas, mismos
 * reportes) o no entra. Un feed es una fuente de entrada al libro, nunca un
 * sustituto del libro.
 *
 * ── El peligro número uno: el importe ───────────────────────────────────────
 *
 * En la respuesta de finAPI el importe viaja como número decimal de JSON
 * (`"amount": -135.89`). Un `JSON.parse` lo convierte en coma flotante **antes
 * de que nadie lo mire**, que es exactamente lo que el núcleo entero existe
 * para impedir. Por eso este módulo recibe los importes como **texto**: el
 * cliente HTTP tiene que sacarlos del cuerpo crudo de la respuesta y pasarlos
 * tal cual. Si aun así llega un `number`, acá se falla ruidosamente en vez de
 * convertirlo. Un céntimo de deriva no se ve, y lo que no se ve no se arregla.
 *
 * Tampoco se usa `parseAmount` de `shared/numeric`: esa función existe para
 * adivinar el locale de un fichero de banco ("1.234" puede ser mil doscientos
 * treinta y cuatro o uno coma dos). Acá no hay nada que adivinar — la gramática
 * de los números de JSON tiene punto decimal y no tiene separador de miles—, y
 * dejar que la heurística opine sobre un dato que ya es inequívoco sólo puede
 * empeorarlo.
 */

import {
  type CurrencyCode,
  currencyCode,
  fromDecimalString,
  type Money,
  type ParsedStatement,
  ParseError,
  type ParseWarning,
  type PlainDate,
  type StatementBalance,
  type StatementLine,
  tryParsePlainDate,
} from '@moneypilot/core'
import { maskAccountNumber } from '../shared/mask.js'

/**
 * Un movimiento tal como lo devuelve `GET /api/v2/transactions?view=userView`,
 * con una única desviación deliberada: `amount` es `string`.
 */
export interface FinapiRawTransaction {
  /** Identificador estable dentro del usuario de finAPI. Atributo, no clave. */
  readonly id: number
  readonly accountId: number
  /**
   * Fecha valor. Va a `valuedOn`; nunca se mezcla con la contable.
   *
   * Admite `null` porque finAPI puede no mandarla y el cliente HTTP no tiene
   * por qué inventarse una cadena vacía para disimularlo. `toPlainDate` ya
   * trata la ausencia, y `buildLine` ya sabe rechazar la línea con su aviso.
   */
  readonly valueDate: string | null
  /** Fecha contable del banco. Es la canónica. Mismo motivo para el `null`. */
  readonly bankBookingDate: string | null
  /**
   * Decimal como TEXTO, nunca `number`. Ver la cabecera del módulo: si esto
   * llega como número, el importe ya pasó por coma flotante.
   */
  readonly amount: string
  readonly currency: string
  /** Concepto crudo del banco. */
  readonly purpose: string | null
  /** Concepto después del limpiador de finAPI. Derivado, no original. */
  readonly cleanedPurpose: string | null
  readonly counterpartName: string | null
  readonly counterpartIban: string | null
  readonly counterpartBic: string | null
  readonly counterpartBankName: string | null
  readonly type: string | null
  readonly typeCodeZka: string | null
  /** Taxonomía de finAPI, en alemán. NO es nuestra categoría contable. */
  readonly category: { readonly id: number; readonly name: string } | null
  /** La detección de duplicados de ELLOS. Evidencia, no veredicto. */
  readonly isPotentialDuplicate: boolean
  /**
   * El reloj del agregador, no el del banco. Se conserva en `raw` para poder
   * auditar cuándo lo vieron ellos, pero no se usa para nada más: usarlo como
   * fecha contable ataría nuestros cortes de período a cuándo corrió su
   * sincronización.
   */
  readonly finapiBookingDate?: string | null
}

/** Una cuenta de `GET /api/v2/accounts`, otra vez con los importes como texto. */
export interface FinapiRawAccount {
  readonly id: number
  /** "Girokonto", "Tagesgeldkonto"… el nombre que le pone el banco. */
  readonly accountName: string | null
  readonly accountNumber: string | null
  readonly iban: string | null
  readonly accountCurrency: string | null
  /** Saldo actual como TEXTO. Mismo motivo que en los movimientos. */
  readonly balance?: string | null
  /**
   * Instante de la última lectura correcta del banco
   * ('YYYY-MM-DD HH:mm:ss.SSS'). Es la fecha a la que corresponde `balance`.
   */
  readonly lastSuccessfulUpdate?: string | null
  /** Viene de la conexión bancaria; el cliente lo adjunta si lo tiene. */
  readonly bankName?: string | null
}

export interface MapFinapiOptions {
  /**
   * Moneda a usar si la cuenta no declara ninguna. Se avisa siempre que haga
   * falta recurrir a ella: una cuenta sin moneda es un dato que falta, no un
   * detalle.
   */
  readonly fallbackCurrency?: string
}

/**
 * Convierte una cuenta de finAPI y sus movimientos en un extracto.
 *
 * Los movimientos que no se pueden asentar sin inventar un dato (otra cuenta,
 * otra divisa, sin fecha, importe ilegible) no se cuelan: se descartan con un
 * aviso de severidad `error` y su número de línea, que es lo que el informe de
 * importación muestra como fila rechazada. Descartar en silencio es la única
 * forma de fallar que este producto no se permite.
 */
export function mapFinapiAccount(
  cuenta: FinapiRawAccount,
  movimientos: readonly FinapiRawTransaction[],
  options: MapFinapiOptions = {},
): ParsedStatement {
  const warnings: ParseWarning[] = []
  const currency = resolveCurrency(cuenta, options, warnings)

  const lines: StatementLine[] = []
  for (const [index, dated] of orderForImport(movimientos).entries()) {
    const line = buildLine(dated, index + 1, cuenta, currency, warnings)
    if (line !== null) lines.push(line)
  }

  const closingBalance = readBalance(cuenta, currency, warnings)

  return {
    format: 'finapi',
    account: {
      currency,
      ...pick('institution', institutionOf(cuenta)),
      // Enmascarado como en todos los parsers: del IBAN propio sólo hacen
      // falta los últimos dígitos para que una persona reconozca la cuenta.
      ...pick('accountNumber', maskAccountNumber(text(cuenta.iban) ?? text(cuenta.accountNumber))),
    },
    ...pick('closingBalance', closingBalance),
    lines,
    warnings,
  }
}

/**
 * Agrupa por cuenta lo que devuelven los dos endpoints y produce un extracto
 * por cuenta, igual que `parseOfx` con un fichero de varias cuentas.
 *
 * `GET /transactions` devuelve los movimientos de todas las cuentas mezclados,
 * así que agrupar es parte del mapeo y no del cliente: hacerlo mal atribuye
 * movimientos a la cuenta equivocada, que es un error que cuadra igual y
 * miente igual.
 */
export function mapFinapiStatements(
  cuentas: readonly FinapiRawAccount[],
  movimientos: readonly FinapiRawTransaction[],
  options: MapFinapiOptions = {},
): ParsedStatement[] {
  const porCuenta = new Map<number, FinapiRawTransaction[]>()
  for (const cuenta of cuentas) porCuenta.set(cuenta.id, [])

  const huerfanos: number[] = []
  for (const movimiento of movimientos) {
    const grupo = porCuenta.get(movimiento.accountId)
    if (grupo === undefined) huerfanos.push(movimiento.id)
    else grupo.push(movimiento)
  }

  // Un movimiento sin cuenta no se puede asentar, y tirarlo callado sería
  // perder plata sin dejar rastro. Es un fallo del cliente (pidió movimientos
  // de cuentas que no trajo), no un dato dudoso: se corta la importación.
  if (huerfanos.length > 0) {
    throw new ParseError(
      `${huerfanos.length} movimiento(s) pertenecen a cuentas que no se pasaron ` +
        `(por ejemplo el ${huerfanos[0]}). Hay que leer /accounts antes que /transactions.`,
      'movimiento_huerfano',
    )
  }

  return cuentas.map((cuenta) => mapFinapiAccount(cuenta, porCuenta.get(cuenta.id) ?? [], options))
}

// ── Fechas ───────────────────────────────────────────────────────────────────

interface DatedTransaction {
  readonly tx: FinapiRawTransaction
  /** Contable. `null` cuando no hay ninguna fecha legible. */
  readonly bookedOn: PlainDate | null
  readonly valuedOn: PlainDate | null
  /** true si hubo que usar la fecha valor como contable. */
  readonly bookedFromValueDate: boolean
}

/**
 * Un feed no tiene líneas: tiene un JSON cuyo orden decide el servidor. Como
 * `lineNumber` termina en el informe y en los identificadores de la previa, se
 * impone un orden propio —fecha contable y luego id— para que dos lecturas del
 * mismo lote produzcan exactamente los mismos números y el informe se lea en
 * orden cronológico.
 */
function orderForImport(movimientos: readonly FinapiRawTransaction[]): DatedTransaction[] {
  const dated = movimientos.map((tx) => {
    const bankBooking = toPlainDate(tx.bankBookingDate)
    const valuedOn = toPlainDate(tx.valueDate)
    return {
      tx,
      bookedOn: bankBooking ?? valuedOn,
      valuedOn,
      bookedFromValueDate: bankBooking === null && valuedOn !== null,
    }
  })

  // Los que no tienen fecha van al final: '~' es mayor que cualquier dígito,
  // así que ordena sin necesidad de una rama aparte.
  return dated.sort((a, b) => {
    const keyA = a.bookedOn ?? '~'
    const keyB = b.bookedOn ?? '~'
    if (keyA !== keyB) return keyA < keyB ? -1 : 1
    if (a.tx.id === b.tx.id) return 0
    return a.tx.id < b.tx.id ? -1 : 1
  })
}

/**
 * finAPI manda fechas 'YYYY-MM-DD' y marcas de tiempo
 * 'YYYY-MM-DD HH:mm:ss.SSS'. Nos quedamos con el día tal como lo escribió el
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
  cuenta: FinapiRawAccount,
  currency: CurrencyCode,
  warnings: ParseWarning[],
): StatementLine | null {
  const { tx, bookedOn, valuedOn, bookedFromValueDate } = dated

  // Se comprueba antes que nada porque no es un dato dudoso de una fila: si un
  // importe llegó como número, llegaron todos así y la importación entera está
  // mal. Mejor cortarla que producir 1.612 filas plausibles.
  if (typeof tx.amount !== 'string') {
    throw new ParseError(
      `El movimiento ${tx.id} trae el importe como ${typeof tx.amount} en vez de texto. ` +
        'Alguien hizo JSON.parse sobre la respuesta de finAPI y el importe ya pasó por coma ' +
        'flotante: hay que leerlo del cuerpo crudo de la respuesta.',
      'importe_no_textual',
      lineNumber,
    )
  }

  if (tx.accountId !== cuenta.id) {
    warnings.push({
      severity: 'error',
      code: 'cuenta_ajena',
      message: `El movimiento ${tx.id} es de la cuenta ${tx.accountId}, no de la ${cuenta.id}.`,
      lineNumber,
    })
    return null
  }

  if (bookedOn === null) {
    warnings.push({
      severity: 'error',
      code: 'fecha_ilegible',
      message:
        `El movimiento ${tx.id} no trae ninguna fecha legible ` +
        `(bankBookingDate: ${JSON.stringify(tx.bankBookingDate)}, ` +
        `valueDate: ${JSON.stringify(tx.valueDate)}).`,
      lineNumber,
    })
    return null
  }

  if (bookedFromValueDate) {
    // La fecha contable entra en la huella de identidad: cambiarla en silencio
    // haría que el mismo movimiento tenga dos identidades según cuándo se
    // sincronizó. Se usa la de valor porque es la única que hay, y se avisa.
    warnings.push({
      severity: 'warning',
      code: 'fecha_contable_ausente',
      message: `El movimiento ${tx.id} no trae fecha contable; se usa la de valor (${bookedOn}).`,
      lineNumber,
    })
  }

  // Mezclar divisas dentro de una cuenta produce un saldo que no significa
  // nada. Preferimos una fila rechazada y visible en el informe a un importe
  // plausible y equivocado, que es el peor error posible acá.
  const declared = text(tx.currency)
  if (declared !== undefined && declared.toUpperCase() !== currency) {
    warnings.push({
      severity: 'error',
      code: 'divisa_distinta',
      message: `El movimiento ${tx.id} está en ${declared} y la cuenta en ${currency}.`,
      lineNumber,
    })
    return null
  }

  let amount: Money
  try {
    amount = fromDecimalString(tx.amount.trim(), currency)
  } catch (error) {
    warnings.push({
      severity: 'error',
      code: 'importe_ilegible',
      message: `Importe inaceptable en el movimiento ${tx.id}: ${JSON.stringify(tx.amount)} (${String(error)})`,
      lineNumber,
    })
    return null
  }

  // La detección de duplicados de finAPI no ve nuestro libro: mira su propia
  // ventana de descarga. Obedecerla borraría movimientos legítimos (dos cafés
  // de 3,50 el mismo día son dos transacciones reales) e ignorarla tiraría una
  // señal gratis. Va como evidencia, en `raw` y como aviso con su línea, para
  // que la decisión la tome nuestra pasada, que sí conoce lo ya asentado.
  if (tx.isPotentialDuplicate === true) {
    warnings.push({
      severity: 'info',
      code: 'posible_duplicado_origen',
      message: `finAPI marca el movimiento ${tx.id} como posible duplicado. Es evidencia para la revisión, no un veredicto.`,
      lineNumber,
    })
  }

  return {
    lineNumber,
    bookedOn,
    amount,
    description: buildDescription(tx),
    raw: collectRaw(tx),
    ...pick('valuedOn', valuedOn ?? undefined),
    // El id de finAPI es estable dentro del usuario y el dedup siempre lo
    // compara junto a la cuenta, así que sirve de señal. Sigue siendo un
    // atributo: la clave es nuestra huella.
    ...pick('externalId', String(tx.id)),
  }
}

/**
 * Qué ve el usuario.
 *
 * Hay tres candidatos y la elección no es de estilo:
 *
 *  - `counterpartName` va primero porque es lo único que una persona
 *    reconoce. "ALLIANZ LV / FLESSA KG" dice quién cobró; "4/302460/639" no
 *    dice nada.
 *  - `purpose` se conserva a continuación, no se descarta. En los adeudos
 *    lleva el número de contrato o de factura, y es lo que distingue dos
 *    pagos al mismo acreedor el mismo día — o sea, lo que evita que el
 *    ordinal tenga que desempatar movimientos que en realidad son distintos.
 *  - `cleanedPurpose` **no entra nunca** en la descripción, sólo en `raw`. Es
 *    el resultado del limpiador de finAPI, y la descripción alimenta
 *    `normalizeDescription`, o sea la huella de identidad. Atar la identidad
 *    de nuestras transacciones a un algoritmo de un tercero significa que el
 *    día que ellos lo mejoren, nuestro dedup deja de reconocer lo ya
 *    importado. La huella sólo puede depender de lo que emitió el banco.
 *
 * (Que un descriptor mute entre sincronizaciones —de pendiente a contabilizado
 * con otro texto— es un riesgo propio del feed. Se resuelve en la pasada
 * difusa del dedup, que manda a revisión humana; no acá.)
 */
function buildDescription(tx: FinapiRawTransaction): string {
  const counterpart = text(tx.counterpartName)
  const purpose = text(tx.purpose)

  if (counterpart !== undefined && purpose !== undefined) {
    return counterpart === purpose ? counterpart : `${counterpart} · ${purpose}`
  }
  // Último recurso, y sólo cuando no hay nada del banco: sin descripción, la
  // fila es ilegible para el usuario.
  return counterpart ?? purpose ?? text(tx.cleanedPurpose) ?? text(tx.type) ?? 'Sin descripción'
}

/**
 * Todo lo que vino, tal cual. `raw` es la única prueba cuando dentro de seis
 * meses haya que responder por qué una transacción quedó como quedó.
 *
 * Dos cosas que se guardan por motivos concretos:
 *
 *  - `counterpartIban` **sin enmascarar**. Es mejor clave de comercio que
 *    cualquier descriptor porque es estable: el texto del concepto cambia
 *    entre cargos, el IBAN del acreedor no. Es lo que va a hacer que las
 *    reglas funcionen mucho mejor que con un fichero, y enmascararlo
 *    destruiría justo la propiedad que lo hace útil. (La regla de enmascarar
 *    es para el número de cuenta *propio*, que es superficie de brecha sin
 *    contrapartida de valor.)
 *  - `category`. Es la taxonomía de finAPI, en alemán, y no es una categoría
 *    contable: resuelve descriptor→comercio, que es un problema de texto y lo
 *    hacen bien. Comercio→estructura de cuentas —si la Allianz es seguro de
 *    la sociedad o gasto personal— depende del plan contable de esta familia,
 *    y eso no lo puede saber un agregador alemán. Se conserva como dato y no
 *    toca la cuenta de contrapartida.
 */
function collectRaw(tx: FinapiRawTransaction): Record<string, string> {
  const raw: Record<string, string> = {}
  put(raw, 'id', tx.id)
  put(raw, 'accountId', tx.accountId)
  put(raw, 'valueDate', tx.valueDate)
  put(raw, 'bankBookingDate', tx.bankBookingDate)
  put(raw, 'finapiBookingDate', tx.finapiBookingDate)
  // El texto del importe tal como vino: es la prueba de que nunca pasó por un
  // número, y con lo que se compara si alguna vez hay que auditar el céntimo.
  put(raw, 'amount', tx.amount)
  put(raw, 'currency', tx.currency)
  put(raw, 'purpose', tx.purpose)
  put(raw, 'cleanedPurpose', tx.cleanedPurpose)
  put(raw, 'counterpartName', tx.counterpartName)
  put(raw, 'counterpartIban', tx.counterpartIban)
  put(raw, 'counterpartBic', tx.counterpartBic)
  put(raw, 'counterpartBankName', tx.counterpartBankName)
  put(raw, 'type', tx.type)
  put(raw, 'typeCodeZka', tx.typeCodeZka)
  if (tx.category !== null && tx.category !== undefined) {
    put(raw, 'category.id', tx.category.id)
    put(raw, 'category.name', tx.category.name)
  }
  // Siempre, también cuando es false: "no lo marcaron" y "no lo dijeron" son
  // cosas distintas y la evidencia tiene que distinguirlas.
  if (typeof tx.isPotentialDuplicate === 'boolean') {
    raw['isPotentialDuplicate'] = String(tx.isPotentialDuplicate)
  }
  return raw
}

// ── Cuenta ───────────────────────────────────────────────────────────────────

function resolveCurrency(
  cuenta: FinapiRawAccount,
  options: MapFinapiOptions,
  warnings: ParseWarning[],
): CurrencyCode {
  const candidate = text(cuenta.accountCurrency) ?? text(options.fallbackCurrency)
  if (candidate === undefined) {
    warnings.push({
      severity: 'warning',
      code: 'moneda_no_declarada',
      message: `La cuenta ${cuenta.id} no declara moneda; se asume EUR. Verificar antes de importar.`,
    })
    return currencyCode('EUR')
  }
  try {
    return currencyCode(candidate)
  } catch {
    warnings.push({
      severity: 'error',
      code: 'moneda_invalida',
      message: `Moneda inválida en la cuenta ${cuenta.id}: ${JSON.stringify(candidate)}. Se asume EUR.`,
    })
    return currencyCode('EUR')
  }
}

/** Nombre del banco y de la cuenta: dos cuentas en el mismo banco se distinguen. */
function institutionOf(cuenta: FinapiRawAccount): string | undefined {
  const parts = [text(cuenta.bankName), text(cuenta.accountName)].filter(
    (value): value is string => value !== undefined,
  )
  return parts.length === 0 ? undefined : parts.join(' · ')
}

/**
 * El saldo del feed **no es un saldo de cierre de período**: es el saldo que
 * finAPI leyó del banco en su última actualización correcta. Se declara igual,
 * y con su fecha, por un motivo concreto: `openingEntryAmount` calcula hacia
 * atrás el asiento de apertura desde un saldo conocido, que es justo lo que
 * hace falta cuando se importan 24 meses de una cuenta que existe hace 15 años.
 *
 * No convierte la importación en conciliada por sí solo: sin saldo de apertura
 * declarado, `reconcileAccount` reporta 'sin_saldo_declarado', que es la
 * verdad. Derivar la apertura restando los movimientos daría delta cero
 * siempre y convertiría la comprobación en una tautología.
 */
function readBalance(
  cuenta: FinapiRawAccount,
  currency: CurrencyCode,
  warnings: ParseWarning[],
): StatementBalance | undefined {
  const balance = cuenta.balance
  if (balance === null || balance === undefined) return undefined

  if (typeof balance !== 'string') {
    throw new ParseError(
      `El saldo de la cuenta ${cuenta.id} llegó como ${typeof balance} en vez de texto: ` +
        'pasó por coma flotante antes de que lo viéramos.',
      'importe_no_textual',
    )
  }

  const on = toPlainDate(cuenta.lastSuccessfulUpdate)
  if (on === null) {
    warnings.push({
      severity: 'warning',
      code: 'saldo_sin_fecha',
      message: `La cuenta ${cuenta.id} declara saldo pero no cuándo se leyó; sin fecha no se puede conciliar contra nada.`,
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
      message: `Saldo ilegible en la cuenta ${cuenta.id}: ${JSON.stringify(balance)} (${String(error)})`,
    })
    return undefined
  }

  warnings.push({
    severity: 'info',
    code: 'saldo_de_feed',
    message: `El saldo declarado (${on}) es el que finAPI leyó del banco en su última actualización, no el cierre del período descargado.`,
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
 * Escribe en `raw` sin perder nada y sin guardar ausencias. Coacciona números
 * a texto porque los identificadores y los códigos son enteros exactos; los
 * importes **nunca** pasan por acá convertidos: llegan ya como string.
 */
function put(raw: Record<string, string>, key: string, value: string | number | null | undefined) {
  if (value === null || value === undefined) return
  const asText = typeof value === 'string' ? value.trim() : String(value)
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
