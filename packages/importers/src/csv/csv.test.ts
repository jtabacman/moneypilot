import { toDecimalString } from '@moneypilot/core'
import { describe, expect, it } from 'vitest'
import { inspectCsv, parseCsv } from './parse.js'
import { detectDelimiter, tokenizeCsv } from './tokenize.js'

const utf8 = (text: string) => new TextEncoder().encode(text)
const parse = (text: string, currency = 'EUR', options = {}) =>
  parseCsv(utf8(text), { currency, ...options })
const inspect = (text: string) => inspectCsv(utf8(text))
const amounts = (text: string, currency = 'EUR') =>
  parse(text, currency).lines.map((l) => toDecimalString(l.amount))

/** Formato español: punto y coma, coma decimal, debe/haber separados. */
const BBVA = `Extracto de cuenta
Titular: NOMBRE APELLIDO
Cuenta: ES91 2100 0418 4502 0005 1332

Fecha;Fecha valor;Concepto;Debe;Haber;Saldo
12/03/2026;13/03/2026;COMPRA MERCADONA;142,50;;18.402,55
15/03/2026;15/03/2026;NOMINA;;3.200,00;21.602,55
22/03/2026;23/03/2026;RECIBO IBERDROLA;218,04;;21.384,51`

/** Formato anglosajón: coma, punto decimal, importe firmado. */
const CHASE = `Details,Posting Date,Description,Amount,Type,Balance
DEBIT,03/12/2026,"WHOLE FOODS MKT #1234",-142.50,DEBIT_CARD,8457.31
CREDIT,03/15/2026,"PAYROLL DIRECT DEP",3200.00,ACH_CREDIT,11657.31`

describe('detección del separador', () => {
  it('elige por consistencia, no por frecuencia', () => {
    // El caso que rompe contar apariciones: un fichero separado por punto y
    // coma con importes europeos tiene MÁS comas que puntos y comas.
    expect(detectDelimiter('a;b;c\n1.234,56;x;2.000,00\n9,99;y;1,00')).toBe(';')
  })

  it('reconoce coma, tabulador y barra vertical', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',')
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t')
    expect(detectDelimiter('a|b|c\n1|2|3')).toBe('|')
  })
})

describe('lectura según RFC 4180', () => {
  it('respeta el separador dentro de comillas', () => {
    const rows = tokenizeCsv('a,b\n"uno, dos",tres', ',')
    expect(rows[1]?.cells).toEqual(['uno, dos', 'tres'])
  })

  it('entiende la comilla escapada por duplicación', () => {
    const rows = tokenizeCsv('a\n"dijo ""hola"""', ',')
    expect(rows[1]?.cells).toEqual(['dijo "hola"'])
  })

  it('soporta saltos de línea dentro de un campo', () => {
    // Un concepto bancario de dos renglones es habitual, y parte en dos
    // cualquier lector que divida por líneas antes de parsear.
    const rows = tokenizeCsv('fecha,concepto\n01/01/2026,"TRANSFERENCIA\nDE JUAN PEREZ"', ',')
    expect(rows).toHaveLength(2)
    expect(rows[1]?.cells[1]).toBe('TRANSFERENCIA\nDE JUAN PEREZ')
  })

  it('numera las filas contando los saltos internos', () => {
    const rows = tokenizeCsv('a\n"x\ny"\nz', ',')
    expect(rows.map((r) => r.lineNumber)).toEqual([1, 2, 4])
  })
})

describe('formato español con debe y haber', () => {
  const inspection = inspect(BBVA)

  it('salta el preámbulo y encuentra la cabecera', () => {
    // Muchos bancos ponen titular, cuenta y período encima de la tabla.
    // headerRow cuenta filas no vacías; headerLine es la línea del fichero,
    // que es lo que hay que mostrarle a una persona.
    expect(inspection.headerRow).toBe(3)
    expect(inspection.headerLine).toBe(5)
    expect(inspection.headers).toContain('Concepto')
  })

  it('detecta el layout de dos columnas', () => {
    expect(inspection.layout).toBe('debit_credit')
    expect(inspection.mapping.debit).toBe(3)
    expect(inspection.mapping.credit).toBe(4)
  })

  it('distingue fecha de operación y fecha valor', () => {
    expect(inspection.mapping.date).toBe(0)
    expect(inspection.mapping.valueDate).toBe(1)
    const [first] = parse(BBVA).lines
    expect(first?.bookedOn).toBe('2026-03-12')
    expect(first?.valuedOn).toBe('2026-03-13')
  })

  it('detecta la coma decimal para el fichero entero', () => {
    expect(inspection.decimalSeparator).toBe(',')
  })

  it('da signo negativo al debe y positivo al haber', () => {
    // Confundir esto hace que todos los ingresos aparezcan como gastos.
    expect(amounts(BBVA)).toEqual(['-142.50', '3200.00', '-218.04'])
  })

  it('no confunde el saldo con el importe', () => {
    // La columna Saldo también es numérica y está al lado. Tomarla por
    // importe daría cifras plausibles y completamente equivocadas.
    expect(inspection.mapping.balance).toBe(5)
    expect(amounts(BBVA)[0]).not.toBe('18402.55')
  })
})

describe('formato anglosajón con importe firmado', () => {
  const inspection = inspect(CHASE)

  it('detecta el layout de una columna', () => {
    expect(inspection.layout).toBe('signed')
    expect(inspection.decimalSeparator).toBe('.')
  })

  it('respeta el signo que ya trae el fichero', () => {
    expect(amounts(CHASE, 'USD')).toEqual(['-142.50', '3200.00'])
  })

  it('deduce MDY del propio contenido', () => {
    // 03/15 sólo puede ser MDY. Una sola fecha así resuelve todo el fichero.
    expect(inspection.dateOrder).toBe('MDY')
    expect(inspection.dateAmbiguous).toBe(false)
    expect(parse(CHASE, 'USD').lines[0]?.bookedOn).toBe('2026-03-12')
  })

  it('junta varias columnas de texto en la descripción', () => {
    expect(parse(CHASE, 'USD').lines[0]?.description).toContain('WHOLE FOODS MKT')
  })
})

describe('columna de indicador D/H', () => {
  const file = `Fecha;Concepto;Importe;D/H
12/03/2026;COMPRA;142,50;D
15/03/2026;NOMINA;3200,00;H`

  it('aplica el signo desde el indicador', () => {
    expect(inspect(file).layout).toBe('sign_column')
    expect(amounts(file)).toEqual(['-142.50', '3200.00'])
  })

  it('avisa cuando el indicador no se reconoce', () => {
    const weird = file.replace(';D\n', ';?\n')
    const statement = parse(weird)
    expect(statement.warnings.some((w) => w.code === 'signo_desconocido')).toBe(true)
  })
})

describe('confianza y confirmación humana', () => {
  it('un fichero bien formado se detecta con confianza alta', () => {
    expect(inspect(BBVA).confidence).toBeGreaterThanOrEqual(0.8)
    expect(inspect(CHASE).confidence).toBeGreaterThanOrEqual(0.8)
  })

  it('sin cabecera baja la confianza y lo dice', () => {
    const headerless = '12/03/2026;COMPRA MERCADONA;-142,50\n15/03/2026;NOMINA;3200,00'
    const inspection = inspect(headerless)
    expect(inspection.headerRow).toBeNull()
    expect(inspection.confidence).toBeLessThan(0.8)
    expect(inspection.notes.join(' ')).toContain('confirmarlo')
  })

  it('igual saca los datos de un fichero sin cabecera', () => {
    const headerless = '12/03/2026;COMPRA MERCADONA;-142,50\n15/03/2026;NOMINA;3200,00'
    expect(amounts(headerless)).toEqual(['-142.50', '3200.00'])
  })

  it('el aviso del esquema viaja con el resultado', () => {
    const statement = parse('12/03/2026;COMPRA;-142,50')
    expect(statement.warnings.some((w) => w.code === 'esquema_detectado')).toBe(true)
  })

  it('deja sobrescribir el mapeo cuando el humano corrige', () => {
    const odd = `A;B;C
12/03/2026;lo que sea;-142,50`
    const statement = parseCsv(utf8(odd), {
      currency: 'EUR',
      mapping: { date: 0, description: [1], amount: 2 },
    })
    expect(statement.lines).toHaveLength(1)
    expect(toDecimalString(statement.lines[0]?.amount as never)).toBe('-142.50')
  })

  it('deja invertir el signo para exports de tarjeta', () => {
    // Varios bancos exportan los cargos de tarjeta en positivo.
    const card = `Fecha;Concepto;Importe
12/03/2026;COMPRA;142,50`
    expect(amounts(card)).toEqual(['142.50'])
    expect(
      parse(card, 'EUR', { invertSign: true }).lines.map((l) => toDecimalString(l.amount)),
    ).toEqual(['-142.50'])
  })
})

describe('filas y ficheros rotos', () => {
  it('salta las filas de totales que no tienen fecha', () => {
    const withTotals = `${BBVA}\n;;TOTAL;360,54;3.200,00;`
    expect(parse(withTotals).lines).toHaveLength(3)
  })

  it('rechaza una fecha ilegible con motivo y sigue', () => {
    const broken = `Fecha;Concepto;Importe
no-es-fecha;X;-10,00
15/03/2026;Y;-20,00`
    const statement = parse(broken)
    expect(statement.lines).toHaveLength(1)
    expect(statement.warnings.some((w) => w.code === 'fecha_ilegible')).toBe(true)
  })

  it('rechaza un importe ilegible con motivo', () => {
    const broken = `Fecha;Concepto;Importe
12/03/2026;X;no-es-importe`
    const statement = parse(broken)
    expect(statement.lines).toHaveLength(0)
    expect(statement.warnings.some((w) => w.code === 'importe_ilegible')).toBe(true)
  })

  it('no se cae con un fichero vacío', () => {
    expect(parse('').lines).toHaveLength(0)
  })
})
