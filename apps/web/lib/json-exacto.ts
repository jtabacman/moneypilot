/**
 * JSON en el que ningún número llega a ser nunca un `number`.
 *
 * Lo usan todos los clientes de agregador —finAPI, Plaid— porque todos tienen
 * el mismo agujero: mandan los importes como literales numéricos de JSON
 * (`"amount":-135.89`) y `JSON.parse` los convierte a coma flotante IEEE-754
 * antes de que nuestro código vea nada. Todo el núcleo está sobre `bigint`
 * justamente para que eso no ocurra; sería absurdo dejarlo entrar por la puerta
 * de la red. Por eso vive en `lib/` y no dentro de la carpeta de un proveedor.
 *
 * ── Cómo se rompe, con datos de verdad ──────────────────────────────────────
 *
 * En finAPI el daño está en el propio `JSON.parse`: el sandbox devuelve
 * importes de catorce dígitos y `JSON.parse('99999999999999.99')` da
 * `99999999999999.98`. Un céntimo de menos, en silencio, en la primera línea
 * del cliente.
 *
 * En Plaid el daño es un paso más tarde y por eso engaña más. Sus importes
 * sobreviven al `JSON.parse` —comprobado contra su sandbox: los 48 movimientos
 * del banco de prueba vuelven a imprimirse idénticos—, así que quien mire sólo
 * ahí concluye que no hay problema. El problema aparece en cuanto alguien hace
 * cuentas con esos `number`:
 *
 *   - Sumando los 48 importes en coma flotante, **13 de las 48 sumas parciales
 *     salen mal**: a la cuarta ya va `-478.27000000000004`.
 *   - `/accounts/get` devuelve el saldo `23631.9805`, con cuatro decimales. El
 *     truco de siempre para pasar a céntimos, `saldo * 100`, da
 *     `2363198.0500000003`; con `Math.trunc` eso es un céntimo perdido.
 *
 * O sea que en Plaid la garantía que compra este módulo no es "JSON.parse no
 * redondea" sino algo más fuerte: **nunca hay un `number` con el que hacer
 * cuentas**. El texto decimal exacto viaja hasta `fromDecimalString`, que lo
 * convierte a `bigint`, y la aritmética entera no se desvía jamás. De paso deja
 * de depender de un detalle no documentado del serializador de Plaid, que hoy
 * emite la representación más corta que reconstruye el `float64` y mañana
 * puede no hacerlo.
 *
 * ── La técnica ──────────────────────────────────────────────────────────────
 *
 * Antes de deserializar se reescribe el texto crudo entrecomillando **todos**
 * los literales numéricos. El documento que llega a `JSON.parse` no tiene un
 * solo número, así que no hay nada que redondear. Los pocos enteros que sí
 * necesitamos como `number` —número de página, total del catálogo— se
 * convierten después, de uno en uno y a propósito, con `enteroSeguro`.
 *
 * Se entrecomillan todos y no sólo los campos de importe conocidos porque una
 * lista de campos hay que mantenerla: el día que el proveedor añada `feeAmount`
 * nadie se enteraría de que se está redondeando, el importe saldría mal y no
 * habría error en ningún sitio. Además protege de paso los identificadores
 * largos, que en coma flotante pierden precisión igual que el dinero.
 *
 * El reescritor es un escáner léxico, no una expresión regular sobre el texto:
 * una regex confundiría el `-135.89` que viene dentro del concepto de un
 * movimiento con un literal numérico. Acá las cadenas se copian enteras sin
 * mirarlas por dentro.
 *
 * La ida tiene el mismo problema que la vuelta y está al final del fichero:
 * ver `serializarConDecimalesExactos`.
 */

/** Un documento ya leído: no existe la variante `number` a propósito. */
export type ValorJson = string | boolean | null | ValorJson[] | { [clave: string]: ValorJson }

export type ObjetoJson = { [clave: string]: ValorJson }

export class JsonExactoError extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'JsonExactoError'
  }
}

function esDigito(c: string | undefined): boolean {
  return c !== undefined && c >= '0' && c <= '9'
}

/** Los que pueden continuar un literal numérico de JSON: `-1.5e+10`. */
function continuaNumero(c: string | undefined): boolean {
  return esDigito(c) || c === '.' || c === 'e' || c === 'E' || c === '+' || c === '-'
}

function finDeCadena(texto: string, inicio: number): number {
  let i = inicio + 1
  while (i < texto.length) {
    const c = texto[i]
    // Una barra invertida se come el carácter siguiente, sea cual sea. Así
    // `"dijo \"hola\""` no termina en la comilla del medio.
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '"') return i + 1
    i += 1
  }
  // Cadena sin cerrar: el documento está roto. Devolvemos el final y dejamos
  // que falle `JSON.parse`, cuyo mensaje de error es mejor que el nuestro.
  return texto.length
}

/**
 * Devuelve el mismo JSON con cada literal numérico convertido en cadena.
 * `{"amount":-135.89}` → `{"amount":"-135.89"}`.
 */
export function entrecomillarNumeros(texto: string): string {
  let salida = ''
  let ultimo = 0
  let i = 0
  while (i < texto.length) {
    const c = texto[i]
    if (c === '"') {
      i = finDeCadena(texto, i)
      continue
    }
    // Fuera de una cadena, en JSON válido un dígito o un '-' sólo pueden
    // empezar un número: las claves siempre van entre comillas.
    if (esDigito(c) || c === '-') {
      let j = i + 1
      while (j < texto.length && continuaNumero(texto[j])) j += 1
      salida += `${texto.slice(ultimo, i)}"${texto.slice(i, j)}"`
      ultimo = j
      i = j
      continue
    }
    i += 1
  }
  return salida + texto.slice(ultimo)
}

/** Deserializa dejando cada número como la cadena exacta que mandó el servidor. */
export function parsearSinFlotantes(texto: string): ValorJson {
  let valor: unknown
  try {
    valor = JSON.parse(entrecomillarNumeros(texto))
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error)
    throw new JsonExactoError(`La respuesta no es JSON válido: ${motivo}`)
  }
  return valor as ValorJson
}

// ── Accesores ───────────────────────────────────────────────────────────────
//
// Después del reescritor todo es cadena, así que leer un campo es siempre lo
// mismo. Estos accesores existen para que la conversión de vuelta a `number`
// ocurra sólo donde alguien la escribió con intención.

export function esObjeto(valor: ValorJson | undefined): valor is ObjetoJson {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

export function objeto(valor: ValorJson | undefined, donde: string): ObjetoJson {
  if (!esObjeto(valor)) throw new JsonExactoError(`Se esperaba un objeto en ${donde}`)
  return valor
}

export function lista(valor: ValorJson | undefined, donde: string): ValorJson[] {
  if (!Array.isArray(valor)) throw new JsonExactoError(`Se esperaba una lista en ${donde}`)
  return valor
}

/** El campo tal cual, o `null` si no vino, vino nulo o vino vacío. */
export function cadena(fuente: ObjetoJson, clave: string): string | null {
  const valor = fuente[clave]
  if (typeof valor === 'string') return valor === '' ? null : valor
  if (typeof valor === 'boolean') return valor ? 'true' : 'false'
  return null
}

export function cadenaObligatoria(fuente: ObjetoJson, clave: string, donde: string): string {
  const valor = cadena(fuente, clave)
  if (valor === null) throw new JsonExactoError(`Falta el campo "${clave}" en ${donde}`)
  return valor
}

/**
 * Convierte un entero de la respuesta a `number`.
 *
 * **Nunca para dinero.** Es para páginas, totales e identificadores de banco,
 * donde un `number` es lo natural y el rango es pequeño. Falla si el valor no
 * es un entero exacto en vez de devolver algo aproximado.
 */
export function enteroSeguro(texto: string, donde: string): number {
  if (!/^-?\d+$/.test(texto)) {
    throw new JsonExactoError(`Se esperaba un entero en ${donde} y vino ${JSON.stringify(texto)}`)
  }
  const valor = Number(texto)
  if (!Number.isSafeInteger(valor)) {
    throw new JsonExactoError(`El entero de ${donde} no cabe sin perder precisión: ${texto}`)
  }
  return valor
}

/**
 * Aplana el objeto a `clave -> texto` para guardarlo en el `raw` de la línea.
 *
 * El contrato de los parsers es "lo que no cabe en un campo tipado va a `raw`,
 * sin perder nada", y un movimiento de agregador trae categoría, etiquetas y
 * datos de la contraparte anidados. Se aplanan con clave punteada
 * (`category.name`, `labels.0`) en vez de serializarlos a JSON porque dentro
 * de seis meses alguien va a tener que leer esto para explicar un asiento.
 */
export function aplanar(valor: ValorJson, prefijo = ''): Record<string, string> {
  const salida: Record<string, string> = {}
  const visitar = (actual: ValorJson, camino: string): void => {
    if (actual === null) return
    if (typeof actual === 'string') {
      if (actual !== '' && camino !== '') salida[camino] = actual
      return
    }
    if (typeof actual === 'boolean') {
      if (camino !== '') salida[camino] = actual ? 'true' : 'false'
      return
    }
    if (Array.isArray(actual)) {
      for (const [indice, elemento] of actual.entries()) {
        visitar(elemento, camino === '' ? String(indice) : `${camino}.${indice}`)
      }
      return
    }
    for (const [clave, elemento] of Object.entries(actual)) {
      visitar(elemento, camino === '' ? clave : `${camino}.${clave}`)
    }
  }
  visitar(valor, prefijo)
  return salida
}

// ── Serialización: el mismo problema, de salida ─────────────────────────────

/**
 * Un decimal que hay que escribir en el cuerpo **tal cual**, sin pasar por
 * `number`.
 *
 * Existe porque el peligro no es sólo de entrada. `/transactions/enrich` de
 * Plaid recibe el importe como literal numérico de JSON, y el importe que le
 * mandamos sale de nuestro libro, donde es un `bigint` con su representación
 * decimal exacta. Escribirlo con `JSON.stringify({ amount: Number(texto) })`
 * lo hace pasar por coma flotante en el último metro, después de que todo el
 * resto del sistema se haya cuidado de evitarlo.
 */
export class DecimalExacto {
  constructor(readonly texto: string) {
    if (!/^-?\d+(\.\d+)?$/.test(texto)) {
      throw new JsonExactoError(
        `No es un decimal que se pueda escribir en JSON: ${JSON.stringify(texto)}`,
      )
    }
  }
}

export function decimalExacto(texto: string): DecimalExacto {
  return new DecimalExacto(texto)
}

/**
 * Serializa dejando cada `DecimalExacto` como el literal numérico exacto.
 *
 * `JSON.stringify` no tiene forma de emitir texto crudo en posición de valor,
 * así que se hace en dos pasos: primero cada decimal se sustituye por una
 * cadena centinela, se serializa normalmente, y después se reemplaza la
 * cadena —con sus comillas— por el literal.
 *
 * El centinela lleva un nonce aleatorio por llamada. Sin él, un concepto de
 * movimiento que contuviera por casualidad el texto del centinela saldría
 * convertido en número y rompería el cuerpo; con él la colisión no es
 * plausible. Y el literal ya está validado por el constructor, así que lo que
 * se inyecta no puede ser otra cosa que dígitos, un punto y un signo.
 */
export function serializarConDecimalesExactos(valor: unknown): string {
  const literales: string[] = []
  const nonce = `d${crypto.randomUUID().replaceAll('-', '')}`

  const sustituir = (actual: unknown): unknown => {
    if (actual instanceof DecimalExacto) {
      literales.push(actual.texto)
      return `${nonce}${literales.length - 1}`
    }
    if (Array.isArray(actual)) return actual.map(sustituir)
    if (typeof actual === 'object' && actual !== null) {
      return Object.fromEntries(
        Object.entries(actual as Record<string, unknown>).map(([clave, valor]) => [
          clave,
          sustituir(valor),
        ]),
      )
    }
    return actual
  }

  const texto = JSON.stringify(sustituir(valor))
  if (literales.length === 0) return texto
  return texto.replaceAll(new RegExp(`"${nonce}(\\d+)"`, 'g'), (_coincidencia, indice: string) => {
    const literal = literales[Number(indice)]
    // Inalcanzable salvo bug: los índices los generamos nosotros dos líneas
    // arriba. Fallar es mejor que escribir "undefined" en un cuerpo de dinero.
    if (literal === undefined) throw new JsonExactoError('Centinela decimal sin literal asociado')
    return literal
  })
}
