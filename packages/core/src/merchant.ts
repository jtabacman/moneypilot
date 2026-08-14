/**
 * Comercio canónico: convertir el descriptor que escribe el banco en algo
 * buscable.
 *
 * `COMPRA TARJ 5432 IBERDROLA CLIENTE 887` tiene dentro un comercio y, alrededor,
 * el ruido con el que la entidad rellena el campo: la palabra de la operación, el
 * final de la tarjeta, la referencia del cargo. Una regla escrita contra el
 * descriptor crudo sirve para ese cargo y para ninguno más, porque el ruido cambia
 * en cada uno. Este módulo separa las dos cosas y devuelve una clave estable.
 *
 * ── Las dos exigencias, que tiran en direcciones opuestas ───────────────────
 *
 *  · `NETFLIX REF 8812` y `NETFLIX REF 9903` tienen que caer en la MISMA clave.
 *    Si no, el usuario ve treinta comercios donde hay uno y ninguna regla le
 *    cubre el mes que viene.
 *  · `Bar Centrale` y `Bar Manolo` NO pueden caer en la misma. Compartir una
 *    palabra no es ser el mismo negocio.
 *
 * Se resuelven con la misma decisión: **la clave es todo lo que sobrevive a la
 * limpieza, en su orden, no la primera palabra**. Quitar ruido acerca lo que es
 * igual; conservar el resto mantiene separado lo que es distinto. Recortar a un
 * token —la tentación obvia— cumpliría la primera exigencia rompiendo la segunda,
 * y ese error es el caro: un falso positivo manda un gasto a la categoría
 * equivocada, y cuando el usuario lo descubre deja de creerse el resto del
 * informe. **Ante la duda, no agrupar**: dos claves para un mismo comercio son
 * una molestia; una clave para dos comercios es una mentira.
 *
 * Por eso tampoco hay parecido difuso acá. Nada de Jaccard ni de distancias:
 * dos descriptores caen juntos cuando la limpieza los deja idénticos, y si no,
 * no. Es una función pura y explicable — misma entrada, misma salida— y se puede
 * contestar "¿por qué esta categoría?" enseñando qué se quitó.
 *
 * ── Por qué no se reutiliza `normalizeDescription` ──────────────────────────
 *
 * Aquélla alimenta la huella de identidad y **no puede cambiar nunca**: si
 * cambiara, todas las transacciones ya importadas cambiarían de identidad y el
 * dedup dejaría de reconocerlas. Ésta, en cambio, tiene que poder mejorar cuando
 * aparezca un banco que rellene el descriptor de otra forma. Son dos funciones
 * con vidas distintas; compartir el código las ataría a la más rígida de las dos.
 *
 * ── Qué NO hace ─────────────────────────────────────────────────────────────
 *
 * No sabe qué vende el comercio: `IBERDROLA` no es "Suministros" acá. Traducir
 * una clave a una categoría es trabajo del diccionario que consulta el motor, y
 * vive fuera. Este módulo sólo contesta "¿quién cobró?".
 */

/** De dónde salió la clave, en orden de fiabilidad. */
export type MerchantBasis = 'iban' | 'nombre' | 'descripcion'

export interface CanonicalMerchantInput {
  /** El descriptor tal como lo escribió la entidad. */
  readonly description: string
  /** Nombre de la contraparte, cuando el formato lo trae en su propio campo. */
  readonly counterpartName?: string | undefined
  /** IBAN de la contraparte. Es el mejor identificador que existe acá. */
  readonly counterpartIban?: string | undefined
  /** El comercio según el enriquecimiento de un agregador (Plaid). Derivado. */
  readonly merchantName?: string | undefined
}

export interface CanonicalMerchant {
  /**
   * Con qué agrupar y contra qué buscar en el diccionario.
   *
   * Dos espacios de nombres, y la diferencia importa:
   *  · `iban:ES6621000418401234567891` — un identificador, no un texto.
   *  · `IBERDROLA` — el nombre canónico, en mayúsculas y sin acentos. Lo
   *    producen igual `counterpartName` y el descriptor, así que el mismo
   *    comercio cae en la misma clave llegue por donde llegue.
   *
   * **La cadena vacía significa "no hay comercio identificable"**, y agrupar por
   * ella juntaría cosas que no tienen nada que ver. Quien la reciba tiene que
   * tratarla como ausencia, no como una clave más.
   */
  readonly key: string
  /** Lo mismo, pero para enseñárselo a una persona: conserva mayúsculas y tildes. */
  readonly label: string
  readonly basis: MerchantBasis
  /**
   * Cuánto se puede confiar en que dos movimientos con esta clave son el mismo
   * comercio, de 0 a 1. No es una probabilidad: es un orden entre las vías por
   * las que salió la clave, para que una regla pueda exigir un mínimo.
   */
  readonly confidence: number
}

const CONFIANZA = {
  /** El IBAN es estable y no tiene ruido: no hay nada mejor. */
  iban: 1,
  /** La forma es de IBAN pero el dígito de control no cuadra. Ver `ibanDe`. */
  ibanDudoso: 0.8,
  /** Un campo de nombre ya viene sin la parafernalia del descriptor. */
  nombre: 0.9,
  /** Un nombre que se quedó en una sigla corta agrupa más de lo que debería. */
  nombreCorto: 0.6,
  /** Sacado del texto: sobrevivió a la limpieza, que es más de lo que parece. */
  descripcion: 0.75,
  /** Del texto no quedó más que una palabra corta. Sirve, pero con reservas. */
  descripcionCorta: 0.5,
  nada: 0,
} as const

/** Un token que quedó en pie, en sus dos formas: la que se ve y la que se busca. */
interface Token {
  readonly original: string
  readonly clave: string
}

// ── Contrato público ─────────────────────────────────────────────────────────

export function canonicalMerchant(input: CanonicalMerchantInput): CanonicalMerchant {
  // `counterpartName` antes que `merchantName`: el primero lo manda la entidad y
  // el segundo lo deduce un agregador. Cuando los dos vienen y no coinciden, el
  // que puede cambiar solo de un día para otro es el segundo.
  const nombre = limpiar(input.counterpartName ?? '')

  const iban = ibanDe(input.counterpartIban)
  if (iban !== null) {
    // El IBAN manda siempre que esté: sobrevive a que el banco reescriba el
    // descriptor, a que el comercio cambie de nombre comercial y a que el
    // agregador mejore su enriquecimiento. Ninguna de las otras dos vías
    // aguanta esas tres cosas.
    return {
      key: `iban:${iban.valor}`,
      label: nombre.label === '' ? iban.valor : nombre.label,
      basis: 'iban',
      confidence: iban.controlValido ? CONFIANZA.iban : CONFIANZA.ibanDudoso,
    }
  }

  const comercio = nombre.key === '' ? limpiar(input.merchantName ?? '') : nombre
  if (comercio.key !== '') {
    return {
      key: comercio.key,
      label: comercio.label,
      basis: 'nombre',
      confidence: comercio.corto ? CONFIANZA.nombreCorto : CONFIANZA.nombre,
    }
  }

  const texto = limpiar(input.description)
  if (texto.key === '') {
    // Nada sobrevivió. Devolver el descriptor entero como clave sería peor que
    // no devolver nada: juntaría en un mismo cajón todo lo ilegible del hogar.
    return { key: '', label: '', basis: 'descripcion', confidence: CONFIANZA.nada }
  }
  return {
    key: texto.key,
    label: texto.label,
    basis: 'descripcion',
    confidence: texto.corto ? CONFIANZA.descripcionCorta : CONFIANZA.descripcion,
  }
}

/**
 * La clave canónica de un texto suelto.
 *
 * Existe para quien mantiene el diccionario de comercios: sus entradas tienen
 * que pasar por esta misma función o la búsqueda no encuentra nada. Escribir
 * "Iberdrola S.A." en el diccionario y buscar `IBERDROLA` en tiempo de ejecución
 * es el fallo silencioso que esto evita.
 */
export function merchantKey(texto: string): string {
  return limpiar(texto).key
}

/**
 * Normaliza un IBAN a su forma canónica, o `null` si no lo parece.
 *
 * Se exporta porque `senales.ts` compara el IBAN de la contraparte con los de
 * las cuentas del hogar, y esa comparación sólo es correcta si los dos lados
 * pasaron por la misma normalización: `es66 2100 ...` y `ES6621000...` son el
 * mismo número escrito de dos maneras.
 */
export function normalizarIban(valor: string | null | undefined): string | null {
  return ibanDe(valor)?.valor ?? null
}

// ── IBAN ─────────────────────────────────────────────────────────────────────

const FORMA_IBAN = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/

interface IbanCanonico {
  readonly valor: string
  readonly controlValido: boolean
}

/**
 * Un IBAN con el dígito de control roto sigue siendo una clave estable —el mismo
 * texto malo llega igual en cada cargo—, así que se usa igual y lo que baja es la
 * confianza. Lo que no se acepta es algo que ni siquiera tiene forma de IBAN: eso
 * no es un IBAN sucio, es otro campo que llegó al parámetro equivocado, y tomarlo
 * por bueno taparía el error de arriba.
 */
function ibanDe(valor: string | null | undefined): IbanCanonico | null {
  if (valor === null || valor === undefined) return null
  const limpio = valor.replace(/[\s.-]/g, '').toUpperCase()
  if (!FORMA_IBAN.test(limpio)) return null
  return { valor: limpio, controlValido: control97(limpio) === 1 }
}

/** ISO 13616: se rota el país al final, las letras valen 10..35, y el resto es 1. */
function control97(iban: string): number {
  const rotado = iban.slice(4) + iban.slice(0, 4)
  let resto = 0
  for (const caracter of rotado) {
    const digitos =
      caracter >= '0' && caracter <= '9' ? caracter : String(caracter.charCodeAt(0) - 55)
    for (const digito of digitos) resto = (resto * 10 + Number(digito)) % 97
  }
  return resto
}

// ── Limpieza del texto ───────────────────────────────────────────────────────

interface TextoLimpio {
  readonly key: string
  readonly label: string
  /** Quedó una sola palabra corta: agrupa, pero conviene desconfiar. */
  readonly corto: boolean
}

/**
 * Separadores con los que este sistema —y buena parte de los feeds— compone
 * "quién · concepto": el punto medio y las rayas largas, siempre entre espacios.
 *
 * Se corta por el primero y se conserva lo de la izquierda. Sin esto,
 * `Aldi Sued · Vielen Dank für Ihren Einkauf` y `Aldi Sued · Vielen Dank` serían
 * dos comercios distintos, que es justo el fallo que este módulo existe para no
 * tener. El guion ASCII con espacios NO está en la lista a propósito: aparece
 * dentro de nombres propios y cortar por él partiría comercios de verdad.
 */
const SEPARADOR_DE_COMPOSICION = /\s[·—–]\s/u

/** Fecha ISO embebida: 2024-03-12, 2024/03/12. */
const FECHA_ISO = /\b\d{4}[-/.]\d{2}[-/.]\d{2}\b/g

/** Fecha con el día delante: 12/03/2024, 12.03.24. */
const FECHA_DIA_MES = /\b(\d{1,2})[./-](\d{1,2})[./-]\d{2,4}\b/g

/**
 * Fecha sin año: 12/03.
 *
 * Exige los dos ceros a la izquierda, y por eso `24/7` no es una fecha: sin esa
 * exigencia, el horario que forma parte del nombre del comercio desaparecería.
 */
const FECHA_SIN_ANO = /\b(\d{2})[./-](\d{2})\b/g

/**
 * Números de tarjeta, en las dos formas en que llegan: enmascarado con equis o
 * asteriscos, y la palabra de la tarjeta seguida de los últimos dígitos.
 *
 * El `\b` va DENTRO del grupo opcional del principio. Puesto delante del todo, la
 * máscara con asteriscos no coincidiría nunca: entre un espacio y un `*` no hay
 * frontera de palabra que valga, porque ninguno de los dos es una letra.
 */
const TARJETA_ENMASCARADA = /(?:\b\d{4}[\s-]?)?[x*]{2,}[\s-]?\d{2,4}\b/gi
const TARJETA_CON_PALABRA =
  /\b(?:tarj|tarjeta|card|karte|visa|mastercard|maestro)\b\.?\s*(?:n[ºo°]?\.?\s*)?\d{3,}\b/gi

/**
 * Referencias: una palabra que anuncia un código, y el código.
 *
 * El código tiene que **empezar por un dígito**, y no es un detalle: sin esa
 * exigencia, `REF IBERDROLA` se comería el comercio junto con la palabra `REF`.
 * Con ella, `REF 8812` desaparece y `REF ABC` se queda —ruido de más, que es el
 * lado por el que hay que equivocarse.
 */
const REFERENCIA_CON_PALABRA =
  /\b(?:ref|refª|referencia|rfcia|aut|auth|autorizacion|autorización|trn|op|nr|nro|num|n[ºo°]|cliente|kunde|beleg|zahlbeleg|mandato|mandat|re|fact|factura|recibo|contrato|poliza|póliza|expte)\b\.?\s*[:#]?\s*\d[\dA-Za-z/-]*\b/giu

/**
 * Códigos partidos por barras o guiones: 5/12346/645, 470/11.
 *
 * Hacen falta cinco dígitos o tres grupos para que cuente como código. `24/7` se
 * queda: tres dígitos en dos grupos son más nombre de comercio que referencia.
 */
const CODIGO_CON_BARRAS = /\b\d+(?:[/-]\d+)+\b/g

/**
 * Una tirada larga de dígitos no identifica a nadie: es un número de recibo, de
 * contrato o de cuenta. Las cortas se quedan, porque `7 ELEVEN` y `STUDIO 54` sí
 * son parte del nombre y borrarlas fundiría comercios distintos.
 */
const NUMERO_LARGO = /\b\d{5,}\b/g

/**
 * Lugares, y sólo los que están **marcados como lugares** por la estructura del
 * texto: un código postal con su población, una calle alemana, o una coma final
 * seguida de una sola palabra.
 *
 * Reconocer que `Miami Beach` es una ciudad necesita un callejero, y este módulo
 * no lo tiene ni lo va a inventar. La consecuencia está aceptada: dos sucursales
 * en ciudades distintas pueden quedar en dos claves. Eso fragmenta, que es la
 * forma barata de fallar; confundir dos comercios sería la cara.
 */
const CODIGO_POSTAL_Y_LUGAR = /\b\d{4,5}\s+\p{L}[\p{L}'’-]+/gu
// Dos formas y dos ramas, no una con la palabra de delante opcional: con la
// opcional, `Lidl Leopoldstr.` se lleva también el `Lidl`, que es el comercio.
//   · pegada al nombre de la calle:  Leopoldstr.
//   · suelta detrás de él:           Neuhauser Str.  (se va la palabra también)
const CALLE = /\b\p{L}{2,}(?:stra(?:ss|ß)e|str)\.?\b|\b\p{L}{2,}\s+(?:stra(?:ss|ß)e|str)\.?\b/giu
const CALLE_ESPANOLA = /\bc\/\s*\p{L}+/giu
const COMA_Y_UNA_PALABRA = /,\s*\p{L}[\p{L}'’-]*\s*$/u

/**
 * Palabras que describen la operación, no a quién cobró.
 *
 * Se quitan **sólo cuando van al principio**, que es donde las pone el banco. En
 * medio de un nombre son parte del nombre: `PAGO FACIL` es un comercio y
 * `TARJETA MOVIL` también.
 */
const PALABRAS_DE_OPERACION: ReadonlySet<string> = new Set([
  'COMPRA',
  'COMPRAS',
  'PAGO',
  'PAGOS',
  'ADEUDO',
  'CARGO',
  'ABONO',
  'TARJ',
  'TARJETA',
  'CARD',
  'KARTE',
  'KARTENZAHLUNG',
  'LASTSCHRIFT',
  'UBERWEISUNG',
  'PURCHASE',
  'PAYMENT',
  'DEBIT',
  'CREDIT',
  'POS',
  'EC',
])

/**
 * Sufijos societarios. `Hornbach AG`, `Hornbach` y `HORNBACH S.L.` son la misma
 * empresa cobrando; la forma jurídica cambia con el papeleo, no con el negocio.
 *
 * Se quitan sólo por el final, que es donde van, y en cadena: `GmbH & Co. KG` son
 * tres tokens y se van los tres.
 */
const SUFIJOS_SOCIETARIOS: ReadonlySet<string> = new Set([
  'SA',
  'SAU',
  'SAS',
  'SASU',
  'SL',
  'SLU',
  'SLNE',
  'SC',
  'SCP',
  'SARL',
  'SRL',
  'SPRL',
  'SPA',
  'GMBH',
  'MBH',
  'AG',
  'KG',
  'KGAA',
  'OHG',
  'GBR',
  'UG',
  'EG',
  'EV',
  'LTD',
  'LIMITED',
  'LLC',
  'LLP',
  'PLC',
  'INC',
  'CORP',
  'BV',
  'NV',
  'AB',
  'AS',
  'OY',
  'APS',
  'LDA',
  'CO',
])

/** Conectores que sólo se van si arrastran un sufijo detrás: el `und` de `und Co`. */
const CONECTORES: ReadonlySet<string> = new Set(['UND', 'Y', 'AND', 'E'])

function limpiar(entrada: string): TextoLimpio {
  if (typeof entrada !== 'string') return { key: '', label: '', corto: false }

  let texto = entrada.split(SEPARADOR_DE_COMPOSICION)[0] ?? ''
  texto = compactarSiglas(texto)

  texto = texto.replace(FECHA_ISO, ' ')
  texto = texto.replace(FECHA_DIA_MES, (coincidencia, dia: string, mes: string) =>
    esDiaYMes(dia, mes) ? ' ' : coincidencia,
  )
  texto = texto.replace(FECHA_SIN_ANO, (coincidencia, dia: string, mes: string) =>
    esDiaYMes(dia, mes) ? ' ' : coincidencia,
  )
  texto = texto.replace(TARJETA_CON_PALABRA, ' ')
  texto = texto.replace(TARJETA_ENMASCARADA, ' ')
  texto = texto.replace(REFERENCIA_CON_PALABRA, ' ')

  // El código postal se busca ANTES que las tiradas largas de dígitos: si el
  // número desapareciera primero, la población se quedaría suelta y sin la
  // marca que la delata como lugar.
  texto = texto.replace(CODIGO_POSTAL_Y_LUGAR, ' ')
  texto = texto.replace(CALLE, ' ')
  texto = texto.replace(CALLE_ESPANOLA, ' ')
  texto = texto.replace(CODIGO_CON_BARRAS, (coincidencia) =>
    esCodigo(coincidencia) ? ' ' : coincidencia,
  )
  texto = texto.replace(NUMERO_LARGO, ' ')
  texto = texto.replace(COMA_Y_UNA_PALABRA, ' ')

  let tokens = tokenizar(texto)
  tokens = quitarPalabrasDeOperacion(tokens)
  tokens = quitarSufijosSocietarios(tokens)

  const key = tokens.map((token) => token.clave).join(' ')
  const label = tokens.map((token) => token.original).join(' ')
  const primero = tokens[0]
  return { key, label, corto: tokens.length === 1 && (primero?.clave.length ?? 0) < 4 }
}

/**
 * Un día y un mes plausibles. Sin esta comprobación, `24/7` sería una fecha y
 * `OPEN 24/7` perdería lo único que lo distingue.
 */
function esDiaYMes(dia: string, mes: string): boolean {
  const d = Number(dia)
  const m = Number(mes)
  return d >= 1 && d <= 31 && m >= 1 && m <= 12
}

/** Cinco dígitos o tres grupos: por debajo de eso no hay referencia que valga. */
function esCodigo(coincidencia: string): boolean {
  const grupos = coincidencia.split(/[/-]/)
  const digitos = coincidencia.replace(/\D/g, '').length
  return digitos >= 5 || grupos.length >= 3
}

/**
 * `S.L.` → `SL`, `S.A.U.` → `SAU`.
 *
 * Hay que hacerlo antes de partir en tokens: si no, la sigla se rompe en letras
 * sueltas y el sufijo societario deja de reconocerse.
 */
function compactarSiglas(texto: string): string {
  return texto.replace(/\b(?:\p{L}\.){2,}/gu, (sigla) => sigla.replace(/\./g, ''))
}

/**
 * Se parte por todo lo que no sea letra ni dígito.
 *
 * El `&` cuenta como separador para que `H&M` y `H & M` den la misma clave: dos
 * formas de escribir lo mismo no pueden ser dos comercios.
 */
function tokenizar(texto: string): Token[] {
  const tokens: Token[] = []
  for (const bruto of texto.split(/[^\p{L}\p{N}'’]+/u)) {
    const original = bruto.replace(/^['’]+|['’]+$/g, '')
    if (original === '') continue
    const clave = sinDiacriticos(original)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
    if (clave === '') continue
    tokens.push({ original, clave })
  }
  return tokens
}

function sinDiacriticos(valor: string): string {
  return valor.normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

function quitarPalabrasDeOperacion(tokens: readonly Token[]): Token[] {
  let desde = 0
  while (desde < tokens.length && PALABRAS_DE_OPERACION.has(tokens[desde]?.clave ?? '')) desde += 1
  return tokens.slice(desde)
}

function quitarSufijosSocietarios(tokens: readonly Token[]): Token[] {
  let hasta = tokens.length
  let quitados = 0
  while (hasta > 0) {
    const clave = tokens[hasta - 1]?.clave ?? ''
    if (SUFIJOS_SOCIETARIOS.has(clave)) {
      hasta -= 1
      quitados += 1
      continue
    }
    // El conector se va sólo si ya se fue el sufijo que introducía. Suelto, la
    // `Y` de `Ferrer y Asociados` es parte del nombre.
    if (quitados > 0 && CONECTORES.has(clave)) {
      hasta -= 1
      continue
    }
    break
  }
  return tokens.slice(0, hasta)
}
