/**
 * Los tipos de la cola de revisión y la evidencia que traen.
 *
 * Vive en un módulo aparte porque /hoy también cuenta la cola por tipo, y dos
 * copias del mismo diccionario se desincronizan el día que el motor aprende un
 * tipo nuevo.
 */

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
