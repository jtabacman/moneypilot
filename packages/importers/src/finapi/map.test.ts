import { toDecimalString } from '@moneypilot/core'
import { describe, expect, it } from 'vitest'
import {
  type FinapiRawAccount,
  type FinapiRawTransaction,
  mapFinapiAccount,
  mapFinapiStatements,
} from './map.js'

/** Cuenta tal como la devuelve GET /api/v2/accounts, con el saldo como texto. */
const CUENTA: FinapiRawAccount = {
  id: 3587742,
  accountName: 'Girokonto',
  accountNumber: '77777001',
  iban: 'DE13700800000077777001',
  accountCurrency: 'EUR',
  balance: '1234.56',
  lastSuccessfulUpdate: '2024-08-13 10:04:11.000',
  bankName: 'finAPI Test Bank',
}

/** Movimiento observado en el sandbox, con el importe como texto. */
const BASE: FinapiRawTransaction = {
  id: 1860779443,
  accountId: 3587742,
  valueDate: '2024-08-13',
  bankBookingDate: '2024-08-13',
  amount: '-135.89',
  currency: 'EUR',
  purpose: '4/302460/639',
  cleanedPurpose: '4/302460/639',
  counterpartName: 'ALLIANZ LV / FLESSA KG',
  counterpartIban: 'DE26700800000077777000',
  counterpartBic: 'DRESDEFF700',
  counterpartBankName: 'Commerzbank vormals Dresdner Bank',
  type: 'Überweisungsauftrag',
  typeCodeZka: '20',
  category: { id: 418, name: 'Versicherung' },
  isPotentialDuplicate: false,
}

const mov = (over: Partial<FinapiRawTransaction> = {}): FinapiRawTransaction => ({
  ...BASE,
  ...over,
})

const mapear = (movimientos: readonly FinapiRawTransaction[], cuenta: FinapiRawAccount = CUENTA) =>
  mapFinapiAccount(cuenta, movimientos)

describe('el importe nunca pasa por coma flotante', () => {
  it('no pierde un céntimo con un importe grande de muchos dígitos', () => {
    const statement = mapear([mov({ amount: '-99999999999999.99' })])
    expect(toDecimalString(statement.lines[0]?.amount as never)).toBe('-99999999999999.99')
    // La razón de que el importe viaje como texto: esa misma cadena, pasada
    // por Number(), ya no vuelve a ser la misma cadena.
    expect(String(Number('-99999999999999.99'))).not.toBe('-99999999999999.99')
  })

  it('suma los importes de forma exacta, donde el flotante ya deriva', () => {
    const statement = mapear([
      mov({ id: 1, amount: '0.10' }),
      mov({ id: 2, amount: '0.20' }),
      mov({ id: 3, amount: '0.30' }),
    ])
    const total = statement.lines.reduce((acc, line) => acc + line.amount.amount, 0n)
    expect(total).toBe(60n)
    expect(0.1 + 0.2 + 0.3).not.toBe(0.6)
  })

  it('respeta el signo: negativo sale de la cuenta, positivo entra', () => {
    const statement = mapear([mov({ id: 1, amount: '-135.89' }), mov({ id: 2, amount: '2500.00' })])
    expect(statement.lines[0]?.amount.amount).toBe(-13589n)
    expect(statement.lines[1]?.amount.amount).toBe(250000n)
  })

  it('corta la importación entera si el importe llegó como número', () => {
    // Un solo importe numérico significa que alguien hizo JSON.parse sobre la
    // respuesta: llegaron todos así. Fallar ruidosamente es mejor que producir
    // mil seiscientas filas plausibles.
    const envenenado = mov({ amount: -135.89 as unknown as string })
    expect(() => mapear([envenenado])).toThrow(/importe como number/)
  })

  it('rechaza el movimiento en vez de redondear cuando trae más decimales de los que admite la moneda', () => {
    const statement = mapear([mov({ amount: '-135.891' })])
    expect(statement.lines).toHaveLength(0)
    expect(statement.warnings[0]).toMatchObject({ severity: 'error', code: 'importe_ilegible' })
  })
})

describe('las dos fechas del banco, y el reloj del agregador que se ignora', () => {
  it('usa bankBookingDate como fecha contable y conserva valueDate aparte', () => {
    const statement = mapear([mov({ bankBookingDate: '2024-08-13', valueDate: '2024-08-15' })])
    expect(statement.lines[0]?.bookedOn).toBe('2024-08-13')
    expect(statement.lines[0]?.valuedOn).toBe('2024-08-15')
  })

  it('no toma finapiBookingDate como fecha contable, aunque difiera, pero lo conserva', () => {
    const statement = mapear([
      mov({ bankBookingDate: '2024-08-13', finapiBookingDate: '2024-08-20' }),
    ])
    expect(statement.lines[0]?.bookedOn).toBe('2024-08-13')
    expect(statement.lines[0]?.raw['finapiBookingDate']).toBe('2024-08-20')
  })

  it('cae a la fecha valor cuando falta la contable, y lo avisa', () => {
    const statement = mapear([mov({ bankBookingDate: '', valueDate: '2024-08-15' })])
    expect(statement.lines[0]?.bookedOn).toBe('2024-08-15')
    expect(statement.warnings).toContainEqual(
      expect.objectContaining({ code: 'fecha_contable_ausente', severity: 'warning' }),
    )
  })

  it('descarta el movimiento, visiblemente, cuando no hay ninguna fecha legible', () => {
    const statement = mapear([mov({ bankBookingDate: 'ayer', valueDate: '' })])
    expect(statement.lines).toHaveLength(0)
    expect(statement.warnings[0]).toMatchObject({
      severity: 'error',
      code: 'fecha_ilegible',
      lineNumber: 1,
    })
  })

  it('ordena por fecha contable e id para que la línea sea reproducible entre lecturas', () => {
    // El feed devuelve un JSON cuyo orden decide el servidor; lineNumber acaba
    // en el informe, así que el orden lo ponemos nosotros.
    const statement = mapear([
      mov({ id: 30, bankBookingDate: '2024-09-01' }),
      mov({ id: 10, bankBookingDate: '2024-08-13' }),
      mov({ id: 5, bankBookingDate: '2024-09-01' }),
    ])
    expect(statement.lines.map((line) => line.externalId)).toEqual(['10', '5', '30'])
    expect(statement.lines.map((line) => line.lineNumber)).toEqual([1, 2, 3])
  })
})

describe('qué ve el usuario y qué se guarda crudo', () => {
  it('compone la descripción con la contraparte primero y el concepto después', () => {
    const statement = mapear([mov()])
    expect(statement.lines[0]?.description).toBe('ALLIANZ LV / FLESSA KG · 4/302460/639')
  })

  it('no repite el texto cuando contraparte y concepto son el mismo', () => {
    const statement = mapear([mov({ purpose: 'ALLIANZ LV / FLESSA KG' })])
    expect(statement.lines[0]?.description).toBe('ALLIANZ LV / FLESSA KG')
  })

  it('un movimiento sin contraparte no rompe: cae al concepto', () => {
    const statement = mapear([
      mov({
        counterpartName: null,
        counterpartIban: null,
        counterpartBic: null,
        counterpartBankName: null,
      }),
    ])
    expect(statement.lines).toHaveLength(1)
    expect(statement.lines[0]?.description).toBe('4/302460/639')
    expect(statement.lines[0]?.raw['counterpartIban']).toBeUndefined()
  })

  it('sin contraparte ni concepto usa el tipo antes que quedarse mudo', () => {
    const statement = mapear([mov({ counterpartName: null, purpose: null, cleanedPurpose: null })])
    expect(statement.lines[0]?.description).toBe('Überweisungsauftrag')
  })

  it('nunca mete cleanedPurpose en la descripción: es texto derivado por finAPI', () => {
    // La descripción alimenta la huella de identidad. Si dependiera del
    // limpiador de ellos, el día que lo mejoren dejaríamos de reconocer lo ya
    // importado.
    const statement = mapear([mov({ cleanedPurpose: 'ALLIANZ SEGUROS' })])
    expect(statement.lines[0]?.description).not.toContain('ALLIANZ SEGUROS')
    expect(statement.lines[0]?.raw['cleanedPurpose']).toBe('ALLIANZ SEGUROS')
  })

  it('sobreviven los tres textos crudos: contraparte, concepto y concepto limpio', () => {
    const statement = mapear([mov({ cleanedPurpose: 'concepto limpio' })])
    expect(statement.lines[0]?.raw).toMatchObject({
      counterpartName: 'ALLIANZ LV / FLESSA KG',
      purpose: '4/302460/639',
      cleanedPurpose: 'concepto limpio',
    })
  })

  it('guarda el IBAN de la contraparte entero, que es la clave estable de comercio', () => {
    const statement = mapear([mov()])
    expect(statement.lines[0]?.raw['counterpartIban']).toBe('DE26700800000077777000')
    expect(statement.lines[0]?.raw['counterpartBic']).toBe('DRESDEFF700')
  })

  it('guarda el importe como texto tal cual vino, que es la prueba de la auditoría', () => {
    const statement = mapear([mov({ amount: '-135.89' })])
    expect(statement.lines[0]?.raw['amount']).toBe('-135.89')
  })

  it('conserva la categoría de finAPI como dato, sin dejarla tocar la descripción', () => {
    // Ellos resuelven descriptor→comercio; comercio→estructura contable
    // depende del plan de esta familia y no lo sabe un agregador alemán.
    const statement = mapear([mov()])
    expect(statement.lines[0]?.raw['category.name']).toBe('Versicherung')
    expect(statement.lines[0]?.description).not.toContain('Versicherung')
  })

  it('el id de finAPI viaja como externalId, o sea como atributo', () => {
    const statement = mapear([mov({ id: 1860779443 })])
    expect(statement.lines[0]?.externalId).toBe('1860779443')
  })
})

describe('la detección de duplicados de ellos es evidencia, no veredicto', () => {
  it('no descarta el movimiento que finAPI marca como posible duplicado', () => {
    const statement = mapear([mov({ isPotentialDuplicate: true })])
    expect(statement.lines).toHaveLength(1)
    expect(statement.lines[0]?.raw['isPotentialDuplicate']).toBe('true')
  })

  it('deja la marca como aviso con su línea para que la revise nuestra pasada', () => {
    const statement = mapear([mov({ isPotentialDuplicate: true })])
    expect(statement.warnings).toContainEqual(
      expect.objectContaining({
        code: 'posible_duplicado_origen',
        severity: 'info',
        lineNumber: 1,
      }),
    )
  })

  it('distingue "no lo marcaron" de "no lo dijeron"', () => {
    expect(
      mapear([mov({ isPotentialDuplicate: false })]).lines[0]?.raw['isPotentialDuplicate'],
    ).toBe('false')
    const sinDato = mov({ isPotentialDuplicate: undefined as unknown as boolean })
    expect(mapear([sinDato]).lines[0]?.raw['isPotentialDuplicate']).toBeUndefined()
  })
})

describe('la cuenta y sus límites', () => {
  it('declara formato finapi y la moneda de la cuenta', () => {
    const statement = mapear([mov()])
    expect(statement.format).toBe('finapi')
    expect(statement.account.currency).toBe('EUR')
  })

  it('enmascara el IBAN propio y compone el nombre con banco y cuenta', () => {
    const statement = mapear([mov()])
    expect(statement.account.accountNumber).toBe('••••7001')
    expect(statement.account.institution).toBe('finAPI Test Bank · Girokonto')
  })

  it('declara el saldo con su fecha y avisa de que es el del feed, no un cierre', () => {
    const statement = mapear([mov()])
    expect(statement.closingBalance?.on).toBe('2024-08-13')
    expect(toDecimalString(statement.closingBalance?.amount as never)).toBe('1234.56')
    expect(statement.warnings).toContainEqual(
      expect.objectContaining({ code: 'saldo_de_feed', severity: 'info' }),
    )
  })

  it('no declara saldo sin fecha: no habría contra qué conciliarlo', () => {
    const statement = mapear([mov()], { ...CUENTA, lastSuccessfulUpdate: null })
    expect(statement.closingBalance).toBeUndefined()
    expect(statement.warnings).toContainEqual(expect.objectContaining({ code: 'saldo_sin_fecha' }))
  })

  it('avisa cuando la cuenta no declara moneda en vez de asumirla callado', () => {
    const statement = mapear([mov()], { ...CUENTA, accountCurrency: null })
    expect(statement.account.currency).toBe('EUR')
    expect(statement.warnings).toContainEqual(
      expect.objectContaining({ code: 'moneda_no_declarada', severity: 'warning' }),
    )
  })

  it('rechaza el movimiento en otra divisa en vez de mezclarlo en el saldo', () => {
    const statement = mapear([mov({ currency: 'USD' })])
    expect(statement.lines).toHaveLength(0)
    expect(statement.warnings[0]).toMatchObject({ severity: 'error', code: 'divisa_distinta' })
  })

  it('rechaza el movimiento de otra cuenta en vez de atribuírselo a esta', () => {
    const statement = mapear([mov({ accountId: 999999 })])
    expect(statement.lines).toHaveLength(0)
    expect(statement.warnings[0]).toMatchObject({ severity: 'error', code: 'cuenta_ajena' })
  })
})

describe('varias cuentas en una sola lectura', () => {
  const OTRA: FinapiRawAccount = { ...CUENTA, id: 3587743, iban: 'DE13700800000077777002' }

  it('agrupa los movimientos por cuenta, que vienen mezclados de /transactions', () => {
    const statements = mapFinapiStatements(
      [CUENTA, OTRA],
      [
        mov({ id: 1, accountId: 3587742 }),
        mov({ id: 2, accountId: 3587743 }),
        mov({ id: 3, accountId: 3587743 }),
      ],
    )
    expect(statements.map((statement) => statement.lines.length)).toEqual([1, 2])
    expect(statements[1]?.account.accountNumber).toBe('••••7002')
  })

  it('corta si un movimiento apunta a una cuenta que no se pasó, en vez de perderlo', () => {
    expect(() => mapFinapiStatements([CUENTA], [mov({ id: 7, accountId: 3587743 })])).toThrow(
      /movimiento/,
    )
  })
})
