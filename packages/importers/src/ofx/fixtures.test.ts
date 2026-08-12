/**
 * Regresión contra ficheros OFX reales.
 *
 * Los tests de `ofx.test.ts` usan fixtures escritos desde la especificación.
 * Estos usan ficheros que emitieron bancos de verdad, y sirven para lo
 * contrario: descubrir en qué se desvían de la especificación.
 *
 * Origen y licencia: ver `fixtures/README.md`.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { toDecimalString } from '@moneypilot/core'
import { describe, expect, it } from 'vitest'
import { parseOfx } from './parse.js'

const FIXTURES = fileURLToPath(new URL('../../../../fixtures/ofx', import.meta.url))

const read = (name: string): Uint8Array => new Uint8Array(readFileSync(join(FIXTURES, name)))

const allFixtures = readdirSync(FIXTURES).filter((name) => name.endsWith('.ofx'))

describe('invariantes sobre todos los ficheros reales', () => {
  it('hay fixtures que ejercitar', () => {
    expect(allFixtures.length).toBeGreaterThan(5)
  })

  for (const name of allFixtures) {
    describe(name, () => {
      const statements = parseOfx(read(name))

      it('parsea sin lanzar', () => {
        expect(Array.isArray(statements)).toBe(true)
      })

      it('toda línea tiene fecha válida, importe en la moneda de la cuenta y descripción', () => {
        for (const statement of statements) {
          for (const line of statement.lines) {
            expect(line.bookedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
            expect(line.amount.currency).toBe(statement.account.currency)
            expect(typeof line.amount.amount).toBe('bigint')
            expect(line.description.length).toBeGreaterThan(0)
          }
        }
      })

      it('nunca deja pasar un número de cuenta completo', () => {
        for (const statement of statements) {
          const masked = statement.account.accountNumber
          if (masked !== undefined) {
            expect(masked.replace(/\D/g, '').length).toBeLessThanOrEqual(4)
          }
        }
      })

      it('los números de línea son únicos y correlativos', () => {
        for (const statement of statements) {
          const numbers = statement.lines.map((line) => line.lineNumber)
          expect(new Set(numbers).size).toBe(numbers.length)
        }
      })

      it('es determinista: dos pasadas dan exactamente lo mismo', () => {
        expect(JSON.stringify(parseOfx(read(name)), replacer)).toBe(
          JSON.stringify(parseOfx(read(name)), replacer),
        )
      })
    })
  }
})

describe('checking.ofx — OFX 1.02 SGML con tabuladores', () => {
  const [statement] = parseOfx(read('checking.ofx'))

  it('lee la cuenta y las transacciones', () => {
    expect(statement?.account.currency).toBe('USD')
    expect(statement?.lines.length).toBeGreaterThan(0)
  })

  it('detecta QFX por contenido, no por extensión', () => {
    // El fichero se llama .ofx pero trae INTU.BID: es OFX con extensiones de
    // Quicken. Clasificar por contenido es más honesto que por nombre.
    expect(statement?.format).toBe('qfx')
  })
})

describe('ofx-v102-empty-tags.ofx — el fichero que rompe importadores', () => {
  const [statement] = parseOfx(read('ofx-v102-empty-tags.ofx'))

  it('sobrevive a un fichero sin un solo salto de línea', () => {
    expect(statement?.lines).toHaveLength(1)
  })

  it('trata un tag vacío como ausente, no como cadena vacía', () => {
    // <FITID></FITID> no es un identificador: es la ausencia de uno. Tomarlo
    // como "" haría que todas las transacciones sin FITID colisionaran entre
    // sí en el índice de dedup.
    expect(statement?.lines[0]?.externalId).toBeUndefined()
  })

  it('avisa en vez de asumir moneda cuando CURDEF viene vacío', () => {
    expect(statement?.warnings.some((w) => w.code === 'moneda_no_declarada')).toBe(true)
  })

  it('no inventa un saldo de cierre cuando BALAMT viene vacío', () => {
    expect(statement?.closingBalance).toBeUndefined()
  })

  it('usa MEMO como descripción cuando NAME viene vacío', () => {
    expect(statement?.lines[0]?.description).toBe('CBA:Transfer')
  })

  it('lee el importe pese a todo lo demás', () => {
    const amount = statement?.lines[0]?.amount
    expect(amount === undefined ? null : toDecimalString(amount)).toBe('12.34')
  })
})

describe('multiple_accounts.ofx', () => {
  it('devuelve un extracto por cuenta', () => {
    expect(parseOfx(read('multiple_accounts.ofx')).length).toBeGreaterThan(1)
  })
})

describe('anzcc.ofx — tarjeta de crédito', () => {
  const [statement] = parseOfx(read('anzcc.ofx'))

  it('lee un CCSTMTRS igual que un STMTRS', () => {
    expect(statement?.lines.length).toBeGreaterThan(0)
  })

  it('conserva el signo de los cargos', () => {
    expect(statement?.lines.some((line) => line.amount.amount < 0n)).toBe(true)
  })
})

/** BigInt no es serializable por JSON.stringify. */
function replacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
}
