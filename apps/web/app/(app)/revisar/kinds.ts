/**
 * Los tipos de la cola de revisión y la evidencia que traen.
 *
 * Vive en un módulo aparte porque /hoy también cuenta la cola por tipo, y dos
 * copias del mismo diccionario se desincronizan el día que el motor aprende un
 * tipo nuevo. Por lo mismo, la lectura de la transacción que espera dentro de
 * la evidencia está acá y no en la acción que la asienta: la pantalla necesita
 * enseñarla y la acción necesita escribirla, y las dos tienen que estar
 * mirando exactamente los mismos campos.
 */

import type { PersistableTransaction } from '@moneypilot/db'

/** Los tres que emite el esquema hoy (`review_kind`). */
const ETIQUETA: Readonly<Record<string, string>> = {
  posible_duplicado: 'Duplicado probable',
  transferencia_sugerida: 'Transferencia sin par',
  sin_categorizar: 'Sin categorizar',
}

const EXPLICACION: Readonly<Record<string, string>> = {
  posible_duplicado:
    'Se parece mucho a un movimiento que ya estaba. La pasada exacta no lo dio por repetido, así que la difusa lo mandó acá en vez de descartarlo.',
  transferencia_sugerida:
    'Una salida y una entrada de importe parecido en dos cuentas tuyas. Si son el mismo traspaso, no es gasto ni ingreso y no debería contar dos veces.',
  sin_categorizar:
    'El descriptor no alcanza para deducir la categoría. Adivinarla metería el gasto en un informe que después no cuadra con lo que el usuario recuerda.',
}

/** Un tipo que todavía no conocemos se enseña tal cual: nunca "otro". */
export function etiquetaTipo(kind: string): string {
  return ETIQUETA[kind] ?? kind.replace(/_/g, ' ')
}

export function explicacionTipo(kind: string): string | null {
  return EXPLICACION[kind] ?? null
}

export interface Evidencia {
  /** Días entre el movimiento y su candidato. */
  readonly dias: number | null
  /** Similitud del texto, 0..1. */
  readonly similitud: number | null
  readonly motivo: string | null
  /** Todo lo demás del blob, tal cual, para no esconder nada. */
  readonly resto: readonly (readonly [string, string])[]
}

const CLAVES_DIAS = ['dias_de_diferencia', 'dayGap']
const CLAVES_SIMILITUD = ['similitud', 'similarity']
/**
 * Sólo `motivo`, que es una frase escrita para una persona. El `reason` del
 * veredicto del núcleo es un token de máquina —`fuzzy`, `fingerprint`— y
 * pintarlo donde va una explicación deja al usuario leyendo la variable en vez
 * del argumento. Cae en el volcado crudo de abajo, que es su sitio.
 */
const CLAVES_MOTIVO = ['motivo']

/**
 * Normaliza el blob de evidencia a lo que la pantalla sabe contar.
 *
 * Las claves llegan en dos idiomas: el sembrador escribe en español y el
 * importador guarda el veredicto del núcleo, que está en inglés
 * (`dayGap`, `similarity`). Se leen los dos y **lo que no se reconoce se
 * enseña igual**, en crudo: la evidencia es el argumento por el que el motor
 * no decidió solo, y recortarla a lo que la vista entiende deja al usuario
 * decidiendo con menos información que la máquina.
 */
export function leerEvidencia(evidence: Record<string, unknown>): Evidencia {
  // El importador envuelve el veredicto: { transaccion, evidencia }. La capa de
  // dentro trae las claves interesantes.
  const anidada = evidence['evidencia']
  const plano: Record<string, unknown> =
    typeof anidada === 'object' && anidada !== null && !Array.isArray(anidada)
      ? { ...evidence, ...(anidada as Record<string, unknown>) }
      : evidence

  const dias = numero(plano, CLAVES_DIAS)
  const similitud = numero(plano, CLAVES_SIMILITUD)
  const motivo = texto(plano, CLAVES_MOTIVO)

  const reconocidas = new Set([
    ...CLAVES_DIAS,
    ...CLAVES_SIMILITUD,
    ...CLAVES_MOTIVO,
    'evidencia',
    'transaccion',
  ])
  const resto = Object.entries(plano)
    .filter(([clave]) => !reconocidas.has(clave))
    .map(([clave, valor]) => [clave.replace(/_/g, ' '), aTexto(valor)] as const)

  return { dias, similitud, motivo, resto }
}

function numero(fuente: Record<string, unknown>, claves: readonly string[]): number | null {
  for (const clave of claves) {
    const valor = fuente[clave]
    if (typeof valor === 'number' && Number.isFinite(valor)) return valor
  }
  return null
}

function texto(fuente: Record<string, unknown>, claves: readonly string[]): string | null {
  for (const clave of claves) {
    const valor = fuente[clave]
    if (typeof valor === 'string' && valor.trim() !== '') return valor
  }
  return null
}

function aTexto(valor: unknown): string {
  if (typeof valor === 'string') return valor
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor)
  if (valor === null || valor === undefined) return '—'
  return JSON.stringify(valor)
}

/* ── La transacción que espera fuera del libro ───────────────────────────── */

const FECHA_FORMA = /^\d{4}-\d{2}-\d{2}$/
const ENTERO_FORMA = /^-?\d+$/
const HUELLA_FORMA = /^[0-9a-f]{64}$/i
const MONEDA_FORMA = /^[A-Za-z]{3}$/

export type TransaccionEnEspera =
  /** La fila apunta a un asiento: el movimiento ya está en el libro. */
  | { readonly tipo: 'ya-asentada' }
  /** Ni asiento ni transacción guardada: la fila es un aviso y nada más. */
  | { readonly tipo: 'sin-transaccion' }
  /** Hay algo guardado pero no se puede leer. El motivo se enseña, no se traga. */
  | { readonly tipo: 'rota'; readonly motivo: string }
  | { readonly tipo: 'lista'; readonly transaccion: PersistableTransaction }

/**
 * Reconstruye la transacción que `persistImport` dejó guardada en la evidencia.
 *
 * Existe porque lo que va a revisión NO entra al libro: la fila no tiene
 * asiento y por eso `reviewQueue` no le puede poner ni fecha, ni importe, ni
 * descripción. Todo eso está acá dentro, y sin leerlo la pantalla le pediría a
 * alguien que decida sobre una fila en blanco.
 *
 * Nada se da por bueno. Lo escrito ahí es JSON —texto y números de
 * JavaScript—, así que el importe viene como cadena decimal (a propósito: un
 * importe como número JSON es el error de coma flotante reintroducido en la
 * frontera) y se convierte con `BigInt`, nunca con `Number`. La comprobación
 * con la expresión regular va ANTES de convertir, porque `BigInt('')` es `0n`
 * y un importe vacío se colaría como un movimiento de cero euros.
 */
export function leerTransaccionEnEspera(
  evidence: Record<string, unknown>,
  entryId: string | null,
): TransaccionEnEspera {
  if (entryId !== null) return { tipo: 'ya-asentada' }

  const bruto = evidence['transaccion']
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) {
    return { tipo: 'sin-transaccion' }
  }
  const guardada = bruto as Record<string, unknown>

  const bookedOn = cadena(guardada, 'bookedOn')
  if (bookedOn === null || !FECHA_FORMA.test(bookedOn)) {
    return { tipo: 'rota', motivo: 'la fecha contable no es una fecha YYYY-MM-DD' }
  }
  const valuedOn = cadena(guardada, 'valuedOn')
  if (valuedOn !== null && !FECHA_FORMA.test(valuedOn)) {
    return { tipo: 'rota', motivo: 'la fecha de valor no es una fecha YYYY-MM-DD' }
  }
  const amountMinor = cadena(guardada, 'amountMinor')
  if (amountMinor === null || !ENTERO_FORMA.test(amountMinor)) {
    return { tipo: 'rota', motivo: 'el importe no es un entero en unidades mínimas' }
  }
  const currency = cadena(guardada, 'currency')
  if (currency === null || !MONEDA_FORMA.test(currency)) {
    return { tipo: 'rota', motivo: 'la moneda no es un código de tres letras' }
  }
  const fingerprint = cadena(guardada, 'fingerprint')
  if (fingerprint === null || !HUELLA_FORMA.test(fingerprint)) {
    return { tipo: 'rota', motivo: 'la huella no es un sha256 de 64 caracteres' }
  }
  const description = cadena(guardada, 'description')
  if (description === null) {
    // Inventarle una descripción sería escribir en el libro un texto que no
    // dijo nadie, y el libro es lo que después se compara contra el extracto.
    return { tipo: 'rota', motivo: 'no trae la descripción del movimiento' }
  }
  const externalId = cadena(guardada, 'externalId')
  const memo = cadena(guardada, 'memo')

  return {
    tipo: 'lista',
    transaccion: {
      bookedOn,
      description,
      amount: BigInt(amountMinor),
      currency: currency.toUpperCase(),
      fingerprint,
      ...(valuedOn === null ? {} : { valuedOn }),
      ...(externalId === null ? {} : { externalId }),
      ...(memo === null ? {} : { memo }),
    },
  }
}

function cadena(fuente: Record<string, unknown>, clave: string): string | null {
  const valor = fuente[clave]
  return typeof valor === 'string' && valor.trim() !== '' ? valor : null
}
