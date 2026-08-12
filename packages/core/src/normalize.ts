/**
 * Normalización de descripciones de comercio.
 *
 * Cumple dos funciones distintas y hay que no confundirlas:
 *  - `normalizeDescription` alimenta el hash canónico de identidad. Tiene que
 *    ser **estable para siempre**: si cambia, todas las transacciones ya
 *    importadas cambian de identidad y el dedup deja de funcionar.
 *  - `descriptionTokens` alimenta la comparación difusa del dedup de segunda
 *    pasada. Esa sí puede evolucionar.
 */

/** Quita acentos y diacríticos sin perder la letra base. */
function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

/**
 * VERSIONADO: si esto cambia, hay que subir `IDENTITY_VERSION` en identity.ts
 * y re-hashear la base. No es un detalle: es el contrato de identidad.
 */
export function normalizeDescription(raw: string): string {
  return stripDiacritics(raw)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Ruido que los bancos meten en el descriptor y que no identifica al comercio:
 * números de autorización, referencias, fechas embebidas, últimos dígitos de
 * tarjeta. Se quitan solo para comparar, nunca para el hash.
 */
const NOISE_PATTERNS: readonly RegExp[] = [
  /\bREF\s?\d+\b/g,
  /\bAUT[H]?\s?\d+\b/g,
  /\bTRN\s?\d+\b/g,
  /\bX{2,}\d{2,}\b/g,
  /\b\d{2}[/-]\d{2}([/-]\d{2,4})?\b/g,
  /\b\d{6,}\b/g,
]

const STOPWORDS = new Set([
  'SA',
  'SL',
  'SLU',
  'SAU',
  'INC',
  'LLC',
  'LTD',
  'GMBH',
  'BV',
  'NV',
  'SRL',
  'THE',
  'DE',
  'DEL',
  'LA',
  'EL',
  'Y',
  'AND',
  'COMPRA',
  'PAGO',
  'TARJETA',
  'PURCHASE',
  'PAYMENT',
  'CARD',
  'DEBIT',
  'CREDIT',
])

export function descriptionTokens(raw: string): Set<string> {
  let cleaned = normalizeDescription(raw)
  for (const pattern of NOISE_PATTERNS) cleaned = cleaned.replace(pattern, ' ')
  const tokens = cleaned.split(/\s+/).filter((token) => token.length > 1 && !STOPWORDS.has(token))
  return new Set(tokens)
}

/**
 * Similitud de Jaccard sobre conjuntos de tokens. Devuelve 0..1.
 *
 * Elegida sobre la distancia de Levenshtein a propósito: los descriptores
 * bancarios varían por reordenamiento y por campos añadidos, no por erratas.
 * "AMZN MKTP ES*1A2B3" y "AMZN MKTP ES" comparten tokens; su distancia de
 * edición, en cambio, es enorme.
 */
export function tokenSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection += 1
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}
