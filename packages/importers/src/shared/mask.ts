/**
 * Enmascarado de números de cuenta.
 *
 * Nunca se guarda el número completo. El sistema sólo necesita los últimos
 * dígitos para que una persona reconozca de qué cuenta habla; el resto es
 * superficie de brecha sin contrapartida de valor.
 */

const KEEP = 4

export function maskAccountNumber(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length <= KEEP) return digits === '' ? undefined : `••••${digits}`
  return `••••${digits.slice(-KEEP)}`
}
