import { toDecimalString } from '@moneypilot/core'
import { describe, expect, it } from 'vitest'
import { detectDateOrder, parseDateWithOrder } from '../shared/dates.js'
import { parseQif } from './parse.js'

const utf8 = (text: string) => new TextEncoder().encode(text)
const parse = (text: string, currency = 'USD', dateOrder?: 'DMY' | 'MDY' | 'YMD') =>
  parseQif(utf8(text), {
    currency,
    ...(dateOrder === undefined ? {} : { dateOrder }),
  })

/** QIF típico de Quicken para EE.UU. */
const QUICKEN = `!Type:Bank
D3/12/2026
T-42.50
PWHOLE FOODS
MPURCHASE 1234
LGroceries
^
D3/15/2026
T3,200.00
PPAYROLL DEPOSIT
LSalary
^
D3/22/2026
T-1,120.00
PNANNY
^`

describe('estructura del fichero', () => {
  const statement = parse(QUICKEN)

  it('lee las transacciones separadas por ^', () => {
    expect(statement.format).toBe('qif')
    expect(statement.lines).toHaveLength(3)
  })

  it('aplica la moneda que indica quien importa, porque el fichero no la trae', () => {
    expect(statement.account.currency).toBe('USD')
    expect(parse(QUICKEN, 'EUR').account.currency).toBe('EUR')
  })

  it('lee importes con separador de miles', () => {
    expect(toDecimalString(statement.lines[1]?.amount as never)).toBe('3200.00')
  })

  it('compone la descripción con P y M', () => {
    expect(statement.lines[0]?.description).toBe('WHOLE FOODS · PURCHASE 1234')
    expect(statement.lines[2]?.description).toBe('NANNY')
  })

  it('conserva todos los campos en raw', () => {
    expect(statement.lines[0]?.raw).toMatchObject({
      L: 'Groceries',
      P: 'WHOLE FOODS',
    })
  })

  it('lee el nombre de cuenta del bloque !Account sin tomarlo por transacción', () => {
    const withAccount = `!Account
NBBVA Corriente
TBank
^
!Type:Bank
D3/12/2026
T-10.00
PCAFE
^`
    const result = parse(withAccount)
    expect(result.account.institution).toBe('BBVA Corriente')
    expect(result.lines).toHaveLength(1)
  })
})

describe('el problema central: el orden de la fecha', () => {
  it('deduce DMY de una sola fecha con día mayor que 12', () => {
    // Basta un 22/03 en cualquier parte del fichero para desambiguar TODAS
    // las demás, incluido el 03/12 que solo sería indecidible.
    const spanish = `!Type:Bank
D03/12/2026
T-42.50
PMERCADONA
^
D22/03/2026
T-13.20
PREPSOL
^`
    const statement = parse(spanish)
    expect(statement.lines[0]?.bookedOn).toBe('2026-12-03')
    expect(statement.lines[1]?.bookedOn).toBe('2026-03-22')
    expect(statement.warnings.some((w) => w.code === 'fecha_ambigua')).toBe(false)
  })

  it('deduce MDY de una fecha con día mayor que 12 en segunda posición', () => {
    const american = `!Type:Bank
D03/12/2026
T-42.50
PSTORE
^
D03/22/2026
T-13.20
PGAS
^`
    const statement = parse(american)
    expect(statement.lines[0]?.bookedOn).toBe('2026-03-12')
    expect(statement.lines[1]?.bookedOn).toBe('2026-03-22')
  })

  it('avisa fuerte cuando el fichero entero es ambiguo', () => {
    // Todas las fechas válidas en ambos órdenes: no hay forma de saberlo, y
    // elegir en silencio pondría las transacciones en el mes equivocado.
    const ambiguous = `!Type:Bank
D03/12/2026
T-42.50
PSTORE
^
D05/06/2026
T-13.20
PGAS
^`
    const statement = parse(ambiguous)
    const warning = statement.warnings.find((w) => w.code === 'fecha_ambigua')
    expect(warning).toBeDefined()
    expect(warning?.severity).toBe('warning')
    expect(warning?.message).toContain('mes equivocado')
  })

  it('deja forzar el orden y entonces no avisa', () => {
    const statement = parse('!Type:Bank\nD03/12/2026\nT-1.00\nPX\n^', 'USD', 'DMY')
    expect(statement.lines[0]?.bookedOn).toBe('2026-12-03')
    expect(statement.warnings.some((w) => w.code === 'fecha_ambigua')).toBe(false)
  })

  it('detecta un fichero internamente inconsistente en vez de elegir', () => {
    const broken = detectDateOrder(['22/03/2026', '03/22/2026'])
    expect(broken.ambiguous).toBe(true)
    expect(broken.evidence).toContain('inconsistente')
  })

  it('entiende el apóstrofo de Quicken para los años 2000', () => {
    // Quicken escribe 12/31'05 para 2005 y 12/31/99 para 1999.
    expect(parseDateWithOrder("12/31'05", 'MDY')).toBe('2005-12-31')
    expect(parseDateWithOrder('12/31/99', 'MDY')).toBe('1999-12-31')
  })

  it('tolera el relleno con espacios de Quicken', () => {
    // Quicken alinea los campos rellenando con espacios: "1/ 3/98".
    expect(parseDateWithOrder('1/ 3/98', 'MDY')).toBe('1998-01-03')
    expect(parseDateWithOrder(' 12 / 31 / 05 ', 'MDY')).toBe('2005-12-31')
  })

  it('el apóstrofo y la barra son convenciones distintas de siglo', () => {
    // La barra con dos dígitos usa el corte de siglo (70): 98 es 1998.
    // El apóstrofo se introdujo por el Y2K y significa siempre 20xx, así que
    // sobrescribe el corte. Mezclarlas es lo que produce fechas en 2098.
    expect(parseDateWithOrder('12/31/98', 'MDY')).toBe('1998-12-31')
    expect(parseDateWithOrder("12/31'05", 'MDY')).toBe('2005-12-31')
    expect(parseDateWithOrder('12/31/05', 'MDY')).toBe('2005-12-31')
  })

  it('reconoce el formato ISO por el año de cuatro dígitos', () => {
    const detection = detectDateOrder(['2026-03-12', '2026-03-22'])
    expect(detection.order).toBe('YMD')
    expect(detection.ambiguous).toBe(false)
    expect(parseDateWithOrder('2026-03-12', 'YMD')).toBe('2026-03-12')
  })
})

describe('lo que QIF no puede dar, y hay que decir', () => {
  const statement = parse(QUICKEN)

  it('no inventa saldos: el formato no los trae', () => {
    // Sin apertura ni cierre, la reconciliación depende de datos externos.
    // Fabricarlos daría delta cero siempre y no probaría nada.
    expect(statement.openingBalance).toBeUndefined()
    expect(statement.closingBalance).toBeUndefined()
  })

  it('no inventa un identificador: no existe en el formato', () => {
    // Sin FITID, la identidad depende enteramente de la huella canónica.
    expect(statement.lines.every((l) => l.externalId === undefined)).toBe(true)
  })
})

describe('filas rotas', () => {
  it('rechaza la transacción sin fecha y sigue con el resto', () => {
    const file = `!Type:Bank
T-42.50
PSIN FECHA
^
D3/15/2026
T-10.00
PCON FECHA
^`
    const statement = parse(file)
    expect(statement.lines).toHaveLength(1)
    expect(statement.warnings.some((w) => w.code === 'fecha_ilegible')).toBe(true)
  })

  it('rechaza la transacción sin importe y dice por qué', () => {
    const statement = parse('!Type:Bank\nD3/15/2026\nPSIN IMPORTE\n^')
    expect(statement.lines).toHaveLength(0)
    expect(statement.warnings.some((w) => w.code === 'importe_ilegible')).toBe(true)
  })

  it('acepta U cuando no hay T', () => {
    const statement = parse('!Type:Bank\nD3/15/2026\nU-42.50\nPX\n^')
    expect(toDecimalString(statement.lines[0]?.amount as never)).toBe('-42.50')
  })

  it('registra los desgloses en vez de perderlos', () => {
    const file = `!Type:Bank
D3/15/2026
T-100.00
PLEROY MERLIN
SObra
$-60.00
SHerramientas
$-40.00
^`
    const statement = parse(file)
    expect(statement.lines).toHaveLength(1)
    expect(statement.warnings.some((w) => w.code === 'split_detectado')).toBe(true)
    expect(statement.lines[0]?.raw['S']).toBe('Obra\nHerramientas')
  })

  it('cierra la última transacción aunque falte el ^ final', () => {
    const statement = parse('!Type:Bank\nD3/15/2026\nT-10.00\nPX')
    expect(statement.lines).toHaveLength(1)
  })

  it('no se cae con un fichero vacío', () => {
    expect(parse('').lines).toHaveLength(0)
  })
})
