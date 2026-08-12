/**
 * Decodificación de ficheros de extracto.
 *
 * Los formatos legacy vienen en cualquier cosa: OFX 1.x declara CHARSET en su
 * cabecera propietaria (típicamente 1252 o ISO-8859-1), Norma 43 es ISO-8859-1
 * de facto, y los CSV de bancos europeos llegan con BOM o sin él.
 *
 * Decodificar mal no rompe: corrompe. "Nómina" se convierte en "NÃ³mina" y esa
 * transacción queda con una descripción distinta para siempre — con lo cual su
 * huella canónica cambia y el dedup deja de reconocerla.
 */

export interface DecodedFile {
  readonly text: string
  readonly encoding: string
  readonly hadBom: boolean
}

const BOM_UTF8 = [0xef, 0xbb, 0xbf] as const
const BOM_UTF16LE = [0xff, 0xfe] as const
const BOM_UTF16BE = [0xfe, 0xff] as const

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false
  return prefix.every((byte, index) => bytes[index] === byte)
}

/** Normaliza los alias que aparecen en cabeceras reales a nombres de TextDecoder. */
export function normalizeEncodingLabel(declared: string | undefined): string | undefined {
  if (declared === undefined) return undefined
  const label = declared.trim().toLowerCase().replace(/[_\s]/g, '-')
  if (label === '' || label === 'none') return undefined
  // OFX 1.x escribe el charset como número de code page.
  if (label === '1252' || label === 'cp1252' || label === 'windows-1252') return 'windows-1252'
  if (label === '8859-1' || label === 'iso-8859-1' || label === 'latin1') return 'iso-8859-1'
  if (label === 'utf-8' || label === 'utf8') return 'utf-8'
  return label
}

/**
 * Decodifica respetando, en este orden: BOM, encoding declarado, UTF-8 válido,
 * y como último recurso windows-1252 — que nunca falla porque define los 256
 * bytes, y es el encoding real de la mayoría de los ficheros legacy.
 */
export function decodeBuffer(bytes: Uint8Array, declared?: string): DecodedFile {
  if (startsWith(bytes, BOM_UTF8)) {
    return { text: decodeWith(bytes.subarray(3), 'utf-8'), encoding: 'utf-8', hadBom: true }
  }
  if (startsWith(bytes, BOM_UTF16LE)) {
    return { text: decodeWith(bytes.subarray(2), 'utf-16le'), encoding: 'utf-16le', hadBom: true }
  }
  if (startsWith(bytes, BOM_UTF16BE)) {
    return { text: decodeWith(bytes.subarray(2), 'utf-16be'), encoding: 'utf-16be', hadBom: true }
  }

  const label = normalizeEncodingLabel(declared)
  if (label !== undefined) {
    try {
      return { text: decodeWith(bytes, label), encoding: label, hadBom: false }
    } catch {
      // Encoding declarado que TextDecoder no conoce: seguimos con la detección.
    }
  }

  // UTF-8 estricto: si el fichero es UTF-8 válido, casi seguro lo es de verdad.
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    return { text: decoder.decode(bytes), encoding: 'utf-8', hadBom: false }
  } catch {
    return { text: decodeWith(bytes, 'windows-1252'), encoding: 'windows-1252', hadBom: false }
  }
}

function decodeWith(bytes: Uint8Array, label: string): string {
  return new TextDecoder(label).decode(bytes)
}
