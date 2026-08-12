import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { toDecimalString } from '@moneypilot/core'
import { describe, expect, it } from 'vitest'
import { parseN43 } from './parse.js'

const FIXTURE = fileURLToPath(new URL('../../../../fixtures/n43/movements.n43', import.meta.url))
const real = (): Uint8Array => new Uint8Array(readFileSync(FIXTURE))

/** Codifica como ISO-8859-1, que es lo que emiten los bancos españoles. */
const latin1 = (text: string): Uint8Array =>
  new Uint8Array([...text].map((ch) => ch.charCodeAt(0) & 0xff))

describe('fichero real de un banco español', () => {
  const [statement] = parseN43(real())

  it('lee la cabecera de cuenta', () => {
    expect(statement?.format).toBe('n43')
    expect(statement?.account.currency).toBe('EUR')
    expect(statement?.account.institution).toBe('ACCOUNT NAME')
  })

  it('enmascara el número de cuenta', () => {
    expect(statement?.account.accountNumber).toBe('••••4412')
  })

  it('traduce la clave numérica de divisa 978 a EUR', () => {
    expect(statement?.account.currency).toBe('EUR')
  })

  it('lee los 16 movimientos', () => {
    expect(statement?.lines).toHaveLength(16)
  })

  it('acepta líneas de menos de 80 caracteres en vez de rechazar el fichero', () => {
    // Este fichero real trae líneas de 70, 77, 79 y 81 caracteres. La norma
    // dice 80 fijos; los bancos recortan los espacios finales. Un parser
    // fiel al spec rechazaría todo por una diferencia que no cambia un dato.
    const lengths = new Set(
      readFileSync(FIXTURE, 'latin1')
        .split(/\r?\n/)
        .filter((l) => l.trim() !== '')
        .map((l) => l.length),
    )
    expect(lengths.size).toBeGreaterThan(1)
    expect(Math.min(...lengths)).toBeLessThan(80)
    expect(statement?.lines.length).toBeGreaterThan(0)
  })

  it('normaliza el signo: debe sale, haber entra', () => {
    const debits = statement?.lines.filter((l) => l.amount.amount < 0n) ?? []
    const credits = statement?.lines.filter((l) => l.amount.amount > 0n) ?? []
    expect(debits).toHaveLength(15)
    expect(credits).toHaveLength(1)
    expect(toDecimalString(credits[0]?.amount ?? { amount: 0n, currency: 'EUR' as never })).toBe(
      '500.00',
    )
  })

  it('lee los importes sin separador decimal, con dos decimales implícitos', () => {
    const first = statement?.lines[0]
    expect(toDecimalString(first?.amount ?? { amount: 0n, currency: 'EUR' as never })).toBe(
      '-23.99',
    )
  })

  it('interpreta las fechas AAMMDD y distingue operación de valor', () => {
    expect(statement?.lines[0]?.bookedOn).toBe('2020-02-03')
    expect(statement?.lines[0]?.valuedOn).toBe('2020-02-04')
  })

  it('usa los registros 23 como descripción', () => {
    expect(statement?.lines[0]?.description).toContain('COMPRA TARG')
    expect(statement?.lines[0]?.description).toContain('SHOP TO BUY SEVERAL THINGS')
  })

  it('lee las dos puntas del saldo', () => {
    expect(statement?.openingBalance?.on).toBe('2020-02-03')
    expect(
      toDecimalString(
        statement?.openingBalance?.amount ?? {
          amount: 0n,
          currency: 'EUR' as never,
        },
      ),
    ).toBe('2463.43')
    expect(statement?.closingBalance?.on).toBe('2020-02-10')
    expect(
      toDecimalString(
        statement?.closingBalance?.amount ?? {
          amount: 0n,
          currency: 'EUR' as never,
        },
      ),
    ).toBe('2301.59')
  })

  it('la aritmética del fichero cuadra al céntimo', () => {
    // 2.463,43 − 661,84 + 500,00 = 2.301,59
    // Esta comprobación es lo que hace a Norma 43 más valioso que OFX: se
    // puede verificar el extracto con el fichero solo, sin datos previos.
    expect(statement?.warnings.filter((w) => w.code === 'descuadre_aritmetico')).toHaveLength(0)
    expect(statement?.warnings.filter((w) => w.code === 'totales_no_coinciden')).toHaveLength(0)

    const movements = (statement?.lines ?? []).reduce((total, l) => total + l.amount.amount, 0n)
    const opening = statement?.openingBalance?.amount.amount ?? 0n
    expect(opening + movements).toBe(statement?.closingBalance?.amount.amount)
  })

  it('conserva las referencias del banco en raw', () => {
    expect(statement?.lines[0]?.raw).toMatchObject({
      concepto_comun: '12',
      concepto_propio: '408',
      referencia2: '1234567890123456',
    })
  })

  it('mantiene como distintos dos movimientos idénticos', () => {
    // El fichero trae dos cargos byte a byte iguales de SCHOOL OF ENGLISH.
    // Son dos transacciones reales; colapsarlas sería perder plata.
    const english = statement?.lines.filter((l) => l.description.includes('SCHOOL OF ENGLISH'))
    expect(english).toHaveLength(2)
  })

  it('es determinista', () => {
    expect(JSON.stringify(parseN43(real()), bigints)).toBe(
      JSON.stringify(parseN43(real()), bigints),
    )
  })
})

describe('detección de problemas', () => {
  /**
   * Los registros de Norma 43 son campos de ancho fijo, y armarlos
   * concatenando strings a mano desfasa un carácter sin que se note. Este
   * constructor declara ancho por ancho, así que el test dice qué campo es
   * cada cosa y no puede quedar corrido.
   */
  const record = (...fields: [value: string, width: number][]): string =>
    fields
      .map(([value, width]) =>
        value.slice(0, width).padStart(width, /^\d*$/.test(value) && value !== '' ? '0' : ' '),
      )
      .join('')

  const header = (openingMinor: string, sign = '2', currency = '978') =>
    record(
      ['11', 2],
      ['1111', 4],
      ['2222', 4],
      ['3333444412', 10],
      ['200203', 6],
      ['200210', 6],
      [sign, 1],
      [openingMinor, 14],
      [currency, 3],
      ['3', 1],
      ['ACCOUNT NAME'.padEnd(26), 26],
      ['   ', 3],
    )

  const movement = (amountMinor: string, sign = '1', date = '200203') =>
    record(
      ['22', 2],
      ['    ', 4],
      ['2222', 4],
      [date, 6],
      [date, 6],
      ['12', 2],
      ['408', 3],
      [sign, 1],
      [amountMinor, 14],
      ['0000000000', 10],
      ['000000000000', 12],
      ['1234567890123456', 16],
    )

  const footer = (totalDebit: string, totalCredit: string, closingMinor: string) =>
    record(
      ['33', 2],
      ['1111', 4],
      ['2222', 4],
      ['3333444412', 10],
      ['00001', 5],
      [totalDebit, 14],
      ['00001', 5],
      [totalCredit, 14],
      ['2', 1],
      [closingMinor, 14],
      ['978', 3],
      ['    ', 4],
    )

  it('avisa cuando la aritmética del fichero no cierra', () => {
    const file = [
      header('00000000100000'),
      movement('00000000010000'),
      footer('00000000010000', '00000000000000', '00000000099999'),
    ].join('\n')
    const [statement] = parseN43(latin1(file))
    const descuadre = statement?.warnings.find((w) => w.code === 'descuadre_aritmetico')
    expect(descuadre).toBeDefined()
    expect(descuadre?.severity).toBe('error')
    expect(descuadre?.message).toContain('90000')
  })

  it('avisa de una divisa desconocida en vez de fallar', () => {
    const file = [header('00000000100000', '2', 'XXX'), movement('00000000010000')].join('\n')
    const [statement] = parseN43(latin1(file))
    expect(statement?.warnings.some((w) => w.code === 'divisa_desconocida')).toBe(true)
    expect(statement?.account.currency).toBe('EUR')
  })

  it('acepta el código alfabético pero deja constancia de la desviación', () => {
    const [statement] = parseN43(latin1(header('00000000100000', '2', 'USD')))
    expect(statement?.account.currency).toBe('USD')
    expect(statement?.warnings.some((w) => w.code === 'divisa_no_numerica')).toBe(true)
  })

  it('no acepta tres letras cualesquiera como moneda', () => {
    // Un campo con basura convertido en "moneda" válida sería invisible: como
    // el balanceo es por moneda, cada una cerraría en cero por separado.
    const [statement] = parseN43(latin1(header('00000000100000', '2', 'ZQK')))
    expect(statement?.account.currency).toBe('EUR')
    expect(statement?.warnings.some((w) => w.code === 'divisa_desconocida')).toBe(true)
  })

  it('avisa de un registro huérfano sin cabecera', () => {
    const [first] = parseN43(latin1(movement('00000000010000')))
    expect(first).toBeUndefined()
  })

  it('separa varias cuentas en el mismo fichero', () => {
    const file = [
      header('00000000100000'),
      movement('00000000010000'),
      footer('00000000010000', '00000000000000', '00000000090000'),
      header('00000000200000'),
      movement('00000000020000'),
      footer('00000000020000', '00000000000000', '00000000180000'),
    ].join('\n')
    expect(parseN43(latin1(file))).toHaveLength(2)
  })

  it('normaliza el signo del movimiento: 1 sale, 2 entra', () => {
    const file = [
      header('00000000100000'),
      movement('00000000010000', '1'),
      movement('00000000005000', '2'),
    ].join('\n')
    const [statement] = parseN43(latin1(file))
    expect(statement?.lines.map((l) => l.amount.amount)).toEqual([-10000n, 5000n])
  })

  it('resuelve el siglo de los años de dos dígitos', () => {
    // La norma sólo trae AAMMDD. Con el corte en 70, "98" es 1998 y "26" es
    // 2026 — un extracto de Money con quince años de historia lo necesita.
    const old = header('00000000100000').replace('200203200210', '980203980210')
    const [statement] = parseN43(latin1(old))
    expect(statement?.openingBalance?.on).toBe('1998-02-03')
  })
})

function bigints(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
}
