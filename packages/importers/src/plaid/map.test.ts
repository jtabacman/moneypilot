import { toDecimalString } from '@moneypilot/core'
import { describe, expect, it } from 'vitest'
import {
  type MapPlaidOptions,
  mapPlaidAccount,
  mapPlaidStatements,
  type PlaidRawAccount,
  type PlaidRawTransaction,
} from './map.js'

/** Cuenta tal como la devuelve /accounts/get, con los saldos como texto. */
const CUENTA: PlaidRawAccount = {
  account_id: 'Ku2WqBaXfPhznVdBoMzPT4WMwqxDGmSVMPZ8p',
  name: 'Cuenta Corriente',
  official_name: 'Cuenta Online Sin Comisiones',
  mask: '7001',
  type: 'depository',
  subtype: 'checking',
  balances: {
    current: '1234.56',
    available: '1100.00',
    limit: null,
    iso_currency_code: 'EUR',
    unofficial_currency_code: null,
  },
  institution_name: 'BBVA',
}

/**
 * Un gasto: en Plaid el importe SALE de la cuenta y por eso viene en positivo.
 * El descriptor y el enriquecimiento son los que devuelve el sandbox para el
 * corredor español.
 */
const BASE: PlaidRawTransaction = {
  transaction_id: 'lPNjeW1nR6CDn5okmGQ6hEpMo4lLNoSrzqDje',
  account_id: 'Ku2WqBaXfPhznVdBoMzPT4WMwqxDGmSVMPZ8p',
  pending: false,
  pending_transaction_id: null,
  date: '2024-08-13',
  authorized_date: '2024-08-11',
  datetime: '2024-08-13T00:00:00Z',
  authorized_datetime: '2024-08-11T18:22:04Z',
  amount: '87.32',
  iso_currency_code: 'EUR',
  unofficial_currency_code: null,
  name: 'COMPRA TARJ 5432 MERCADONA MADRID',
  merchant_name: 'Mercadona',
  merchant_entity_id: 'eyg8o776k0QmNgVpAmaQj4WgzW9Qzo6O51gdd',
  website: 'mercadona.es',
  logo_url: 'https://plaid-merchant-logos.plaid.com/mercadona_1.png',
  payment_channel: 'in store',
  transaction_code: null,
  personal_finance_category: {
    primary: 'FOOD_AND_DRINK',
    detailed: 'FOOD_AND_DRINK_GROCERIES',
    confidence_level: 'VERY_HIGH',
  },
  counterparties: [
    {
      name: 'Mercadona',
      type: 'merchant',
      entity_id: 'eyg8o776k0QmNgVpAmaQj4WgzW9Qzo6O51gdd',
      confidence_level: 'VERY_HIGH',
      website: 'mercadona.es',
      logo_url: 'https://plaid-merchant-logos.plaid.com/mercadona_1.png',
    },
  ],
  location: { city: 'Madrid', region: 'MD', postal_code: '28013', country: 'ES' },
}

const mov = (over: Partial<PlaidRawTransaction> = {}): PlaidRawTransaction => ({
  ...BASE,
  ...over,
})

/**
 * Plaid casi nunca manda `last_updated_datetime`, así que la fecha del saldo la
 * pone el llamador. Se fija acá para que los tests no dependan del reloj.
 */
const OPCIONES: MapPlaidOptions = { balanceAsOf: '2024-08-13' }

const mapear = (
  movimientos: readonly PlaidRawTransaction[],
  cuenta: PlaidRawAccount = CUENTA,
  options: MapPlaidOptions = OPCIONES,
) => mapPlaidAccount(cuenta, movimientos, options)

describe('el signo de Plaid está invertido y acá se endereza', () => {
  it('un gasto, que Plaid manda en positivo, entra negativo', () => {
    // Es la línea que si se equivoca no rompe nada: el asiento balancearía a
    // cero igual y el informe saldría limpio, con todos los gastos contados
    // como ingresos.
    const statement = mapear([mov({ amount: '87.32' })])
    expect(statement.lines[0]?.amount.amount).toBe(-8732n)
  })

  it('un ingreso, que Plaid manda en negativo, entra positivo', () => {
    const statement = mapear([mov({ amount: '-2500.00', name: 'NOMINA AGOSTO' })])
    expect(statement.lines[0]?.amount.amount).toBe(250000n)
  })

  it('con un gasto y un ingreso en el mismo lote, el neto es el que espera el libro', () => {
    const statement = mapear([
      mov({ transaction_id: 'a', amount: '87.32', name: 'MERCADONA' }),
      mov({ transaction_id: 'b', amount: '-2500.00', name: 'NOMINA' }),
    ])
    const neto = statement.lines.reduce((acc, line) => acc + line.amount.amount, 0n)
    // Cobrar 2.500 y gastar 87,32 deja +2.412,68, no −2.412,68.
    expect(neto).toBe(241268n)
  })

  it('un importe cero no se convierte en un cero con signo', () => {
    const statement = mapear([mov({ amount: '0.00' })])
    expect(statement.lines[0]?.amount.amount).toBe(0n)
    expect(toDecimalString(statement.lines[0]?.amount as never)).toBe('0.00')
  })

  it('el crudo conserva el signo de Plaid sin invertir, que es la prueba de qué mandaron', () => {
    const statement = mapear([mov({ amount: '87.32' })])
    expect(statement.lines[0]?.raw['amount']).toBe('87.32')
    expect(statement.lines[0]?.amount.amount).toBe(-8732n)
    // Quién lee ese '87.32' sabe qué convenio aplicar porque el lote declara el
    // formato; por eso el crudo no necesita explicarse a sí mismo.
    expect(statement.format).toBe('plaid')
  })
})

describe('el importe nunca pasa por coma flotante', () => {
  it('no pierde un céntimo con un importe grande de muchos dígitos', () => {
    const statement = mapear([mov({ amount: '99999999999999.99' })])
    expect(toDecimalString(statement.lines[0]?.amount as never)).toBe('-99999999999999.99')
    // La razón de que el importe viaje como texto: esa misma cadena, pasada por
    // Number(), ya no vuelve a ser la misma cadena.
    expect(String(Number('99999999999999.99'))).not.toBe('99999999999999.99')
  })

  it('suma los importes de forma exacta, donde el flotante ya deriva', () => {
    const statement = mapear([
      mov({ transaction_id: '1', amount: '0.10' }),
      mov({ transaction_id: '2', amount: '0.20' }),
      mov({ transaction_id: '3', amount: '0.30' }),
    ])
    const total = statement.lines.reduce((acc, line) => acc + line.amount.amount, 0n)
    expect(total).toBe(-60n)
    expect(0.1 + 0.2 + 0.3).not.toBe(0.6)
  })

  it('corta la importación entera si el importe llegó como número', () => {
    // Un solo importe numérico significa que alguien hizo JSON.parse sobre la
    // respuesta: llegaron todos así. Fallar ruidosamente es mejor que producir
    // mil filas plausibles.
    const envenenado = mov({ amount: 87.32 as unknown as string })
    expect(() => mapear([envenenado])).toThrow(/importe como number/)
  })

  it('rechaza el movimiento en vez de redondear cuando trae más decimales de los que admite la moneda', () => {
    const statement = mapear([mov({ amount: '87.325' })])
    expect(statement.lines).toHaveLength(0)
    expect(statement.warnings[0]).toMatchObject({ severity: 'error', code: 'importe_ilegible' })
  })
})

describe('las dos fechas, y el instante con zona que se ignora', () => {
  it('usa date como fecha de asiento y authorized_date como fecha valor', () => {
    // date es la del extracto y la que entra en la huella de identidad;
    // authorized_date es cuándo se pasó la tarjeta.
    const statement = mapear([mov({ date: '2024-08-13', authorized_date: '2024-08-11' })])
    expect(statement.lines[0]?.bookedOn).toBe('2024-08-13')
    expect(statement.lines[0]?.valuedOn).toBe('2024-08-11')
  })

  it('cae a la fecha de autorización cuando falta la de asiento, y lo avisa', () => {
    const statement = mapear([mov({ date: null, authorized_date: '2024-08-11' })])
    expect(statement.lines[0]?.bookedOn).toBe('2024-08-11')
    expect(statement.warnings).toContainEqual(
      expect.objectContaining({ code: 'fecha_contable_ausente', severity: 'warning' }),
    )
  })

  it('descarta el movimiento, visiblemente, cuando no hay ninguna fecha legible', () => {
    const statement = mapear([mov({ date: 'ayer', authorized_date: '' })])
    expect(statement.lines).toHaveLength(0)
    expect(statement.warnings[0]).toMatchObject({
      severity: 'error',
      code: 'fecha_ilegible',
      lineNumber: 1,
    })
  })

  it('no toma el instante con zona como fecha, pero lo conserva', () => {
    // Construir un Date con '2024-08-13T23:30:00Z' y pedirle el día corre la
    // fecha según dónde corra el servidor. El día se recorta del texto.
    const statement = mapear([mov({ date: '2024-08-13', datetime: '2024-08-13T23:30:00Z' })])
    expect(statement.lines[0]?.bookedOn).toBe('2024-08-13')
    expect(statement.lines[0]?.raw['datetime']).toBe('2024-08-13T23:30:00Z')
    expect(statement.lines[0]?.raw['authorized_datetime']).toBe('2024-08-11T18:22:04Z')
  })

  it('ordena por fecha de asiento e identificador para que la línea sea reproducible', () => {
    // El feed devuelve un JSON cuyo orden decide el servidor; lineNumber acaba
    // en el informe, así que el orden lo ponemos nosotros.
    const statement = mapear([
      mov({ transaction_id: 'c', date: '2024-09-01' }),
      mov({ transaction_id: 'b', date: '2024-08-13' }),
      mov({ transaction_id: 'a', date: '2024-09-01' }),
    ])
    expect(statement.lines.map((line) => line.externalId)).toEqual(['b', 'a', 'c'])
    expect(statement.lines.map((line) => line.lineNumber)).toEqual([1, 2, 3])
  })
})

describe('un movimiento pendiente no entra al libro', () => {
  const PENDIENTE = mov({
    transaction_id: 'PENDIENTE-1',
    pending: true,
    pending_transaction_id: null,
    date: '2024-08-11',
    amount: '52.00',
    name: 'RESTAURANTE CASA PACO',
  })

  it('no produce línea, y lo dice con su número de línea', () => {
    const statement = mapear([PENDIENTE])
    expect(statement.lines).toHaveLength(0)
    expect(statement.warnings).toContainEqual(
      expect.objectContaining({ code: 'movimiento_pendiente', severity: 'info', lineNumber: 1 }),
    )
  })

  it('el aviso es info y no error: no es una fila rechazada del informe', () => {
    // El informe convierte en "fila rechazada" cualquier aviso de severidad
    // error con línea. Un pendiente no es un fallo, así que una sincronización
    // con pendientes tiene que poder salir limpia.
    const statement = mapear([PENDIENTE])
    expect(statement.warnings.filter((aviso) => aviso.severity === 'error')).toEqual([])
  })

  it('resume el total de lo que quedó fuera, que es lo que explica el delta', () => {
    const statement = mapear([
      PENDIENTE,
      mov({ transaction_id: 'PENDIENTE-2', pending: true, amount: '35.32' }),
    ])
    expect(statement.warnings).toContainEqual(
      expect.objectContaining({
        code: 'pendientes_no_asentados',
        severity: 'info',
        message: expect.stringContaining('-87.32'),
      }),
    )
  })

  it('cuando asienta entra el movimiento nuevo, con el importe definitivo y el hilo al pendiente', () => {
    // Plaid emite OTRO transaction_id cuando asienta y manda el pendiente en
    // 'removed'. Como el pendiente nunca entró al libro, no hay nada que
    // corregir ni que borrar — y el importe cambió, que es justamente por qué
    // no entró: la propina no estaba.
    expect(mapear([PENDIENTE]).lines).toHaveLength(0)

    const asentado = mapear([
      mov({
        transaction_id: 'ASENTADO-9',
        pending: false,
        pending_transaction_id: 'PENDIENTE-1',
        date: '2024-08-13',
        amount: '58.20',
        name: 'RESTAURANTE CASA PACO',
      }),
    ])
    expect(asentado.lines).toHaveLength(1)
    expect(asentado.lines[0]?.externalId).toBe('ASENTADO-9')
    expect(asentado.lines[0]?.amount.amount).toBe(-5820n)
    expect(asentado.lines[0]?.raw['pending_transaction_id']).toBe('PENDIENTE-1')
  })

  it('un pendiente con el importe roto se rechaza igual, no se lo traga el filtro', () => {
    // Si esperáramos a que asiente para verlo, el fallo aparecería tres días
    // más tarde y sin relación aparente con esta sincronización.
    const statement = mapear([mov({ pending: true, amount: 'muchísimo' })])
    expect(statement.warnings[0]).toMatchObject({ severity: 'error', code: 'importe_ilegible' })
  })

  it('distingue "no estaba pendiente" de "no lo dijeron"', () => {
    expect(mapear([mov({ pending: false })]).lines[0]?.raw['pending']).toBe('false')
    const sinDato = mov({ pending: undefined as unknown as boolean })
    expect(mapear([sinDato]).lines[0]?.raw['pending']).toBeUndefined()
  })
})

describe('qué ve el usuario y qué se guarda crudo', () => {
  it('la descripción es el descriptor del banco, nunca el comercio que dedujo Plaid', () => {
    // La descripción alimenta la huella de identidad. Si dependiera del
    // enriquecimiento de ellos, el día que lo mejoren dejaríamos de reconocer lo
    // ya importado. Misma decisión que con cleanedPurpose en finAPI.
    const statement = mapear([mov()])
    expect(statement.lines[0]?.description).toBe('COMPRA TARJ 5432 MERCADONA MADRID')
    expect(statement.lines[0]?.description).not.toContain('Mercadona ')
  })

  it('sólo cuando el banco no manda descriptor cae al comercio, antes que quedarse muda', () => {
    const statement = mapear([mov({ name: null })])
    expect(statement.lines[0]?.description).toBe('Mercadona')
  })

  it('sin descriptor ni comercio usa el código de operación europeo', () => {
    const statement = mapear([
      mov({ name: null, merchant_name: null, transaction_code: 'direct debit' }),
    ])
    expect(statement.lines[0]?.description).toBe('direct debit')
  })

  it('sobreviven los dos textos crudos: el del banco y el de Plaid', () => {
    const statement = mapear([mov()])
    expect(statement.lines[0]?.raw).toMatchObject({
      name: 'COMPRA TARJ 5432 MERCADONA MADRID',
      merchant_name: 'Mercadona',
    })
  })

  it('conserva la categoría de Plaid con su confianza, sin dejarla tocar la descripción', () => {
    // Ellos resuelven descriptor→comercio; comercio→estructura contable depende
    // del plan de esta familia y no lo sabe un agregador.
    const statement = mapear([mov()])
    expect(statement.lines[0]?.raw).toMatchObject({
      'personal_finance_category.primary': 'FOOD_AND_DRINK',
      'personal_finance_category.detailed': 'FOOD_AND_DRINK_GROCERIES',
      'personal_finance_category.confidence_level': 'VERY_HIGH',
    })
    expect(statement.lines[0]?.description).not.toContain('FOOD_AND_DRINK')
  })

  it('guarda las contrapartes con su tipo, su confianza y su identificador estable', () => {
    // El identificador de comercio es a Plaid lo que el IBAN de la contraparte
    // era a finAPI: el texto cambia entre cargos, el identificador no.
    const statement = mapear([mov()])
    expect(statement.lines[0]?.raw).toMatchObject({
      'counterparties.0.name': 'Mercadona',
      'counterparties.0.type': 'merchant',
      'counterparties.0.entity_id': 'eyg8o776k0QmNgVpAmaQj4WgzW9Qzo6O51gdd',
      'counterparties.0.confidence_level': 'VERY_HIGH',
      merchant_entity_id: 'eyg8o776k0QmNgVpAmaQj4WgzW9Qzo6O51gdd',
    })
  })

  it('guarda el canal, el país, la ciudad y la web', () => {
    const statement = mapear([mov()])
    expect(statement.lines[0]?.raw).toMatchObject({
      payment_channel: 'in store',
      'location.country': 'ES',
      'location.city': 'Madrid',
      website: 'mercadona.es',
    })
  })

  it('el transaction_id viaja como externalId, que para un feed es la clave del dedup', () => {
    const statement = mapear([mov({ transaction_id: 'lPNjeW1nR6CDn5okmGQ6hEpMo4lLNoSrzqDje' })])
    expect(statement.lines[0]?.externalId).toBe('lPNjeW1nR6CDn5okmGQ6hEpMo4lLNoSrzqDje')
    expect(statement.lines[0]?.raw['transaction_id']).toBe('lPNjeW1nR6CDn5okmGQ6hEpMo4lLNoSrzqDje')
  })

  it('rechaza el movimiento sin identificador en vez de asentar algo incorregible', () => {
    // Sin transaction_id, un 'modified' posterior no lo encuentra: entraría como
    // movimiento nuevo y se contaría dos veces.
    const statement = mapear([mov({ transaction_id: '  ' })])
    expect(statement.lines).toHaveLength(0)
    expect(statement.warnings[0]).toMatchObject({
      severity: 'error',
      code: 'identificador_ausente',
      lineNumber: 1,
    })
  })
})

describe('la cuenta y sus límites', () => {
  it('declara formato plaid, la moneda, la máscara y el nombre compuesto', () => {
    const statement = mapear([mov()])
    expect(statement.format).toBe('plaid')
    expect(statement.account.currency).toBe('EUR')
    expect(statement.account.accountNumber).toBe('••••7001')
    expect(statement.account.institution).toBe('BBVA · Cuenta Corriente')
  })

  it('declara el saldo con la fecha que puso el llamador y avisa de que es el del feed', () => {
    const statement = mapear([mov()])
    expect(statement.closingBalance?.on).toBe('2024-08-13')
    expect(toDecimalString(statement.closingBalance?.amount as never)).toBe('1234.56')
    expect(statement.warnings).toContainEqual(
      expect.objectContaining({ code: 'saldo_de_feed', severity: 'info' }),
    )
  })

  it('prefiere la fecha de la entidad a la del llamador cuando la entidad la manda', () => {
    const statement = mapear([mov()], {
      ...CUENTA,
      balances: { ...CUENTA.balances, last_updated_datetime: '2024-08-12T09:15:00Z' },
    })
    expect(statement.closingBalance?.on).toBe('2024-08-12')
  })

  it('no declara saldo sin fecha: no habría contra qué conciliarlo', () => {
    const statement = mapear([mov()], CUENTA, {})
    expect(statement.closingBalance).toBeUndefined()
    expect(statement.warnings).toContainEqual(expect.objectContaining({ code: 'saldo_sin_fecha' }))
  })

  it('invierte el saldo de una tarjeta, que Plaid declara como deuda en positivo', () => {
    // Copiarlo tal cual sumaría la deuda al patrimonio en vez de restarla.
    const tarjeta: PlaidRawAccount = {
      ...CUENTA,
      account_id: 'tarjeta-1',
      name: 'Tarjeta Visa',
      type: 'credit',
      subtype: 'credit card',
      balances: { ...CUENTA.balances, current: '1200.00' },
    }
    const statement = mapear([mov({ account_id: 'tarjeta-1' })], tarjeta)
    expect(toDecimalString(statement.closingBalance?.amount as never)).toBe('-1200.00')
    expect(statement.warnings).toContainEqual(
      expect.objectContaining({ code: 'saldo_de_deuda_invertido', severity: 'info' }),
    )
  })

  it('avisa cuando la moneda no es ISO en vez de asumir sus decimales callado', () => {
    const cripto: PlaidRawAccount = {
      ...CUENTA,
      balances: {
        ...CUENTA.balances,
        iso_currency_code: null,
        unofficial_currency_code: 'BTC',
      },
    }
    const statement = mapear(
      [mov({ iso_currency_code: null, unofficial_currency_code: 'BTC' })],
      cripto,
    )
    expect(statement.account.currency).toBe('BTC')
    expect(statement.warnings).toContainEqual(
      expect.objectContaining({ code: 'divisa_no_oficial', severity: 'warning' }),
    )
  })

  it('avisa cuando la cuenta no declara moneda en vez de asumirla callado', () => {
    const statement = mapear([mov()], {
      ...CUENTA,
      balances: { ...CUENTA.balances, iso_currency_code: null },
    })
    expect(statement.account.currency).toBe('EUR')
    expect(statement.warnings).toContainEqual(
      expect.objectContaining({ code: 'moneda_no_declarada', severity: 'warning' }),
    )
  })

  it('rechaza el movimiento en otra divisa en vez de mezclarlo en el saldo', () => {
    const statement = mapear([mov({ iso_currency_code: 'USD' })])
    expect(statement.lines).toHaveLength(0)
    expect(statement.warnings[0]).toMatchObject({ severity: 'error', code: 'divisa_distinta' })
  })

  it('rechaza el movimiento de otra cuenta en vez de atribuírselo a esta', () => {
    const statement = mapear([mov({ account_id: 'otra-cuenta' })])
    expect(statement.lines).toHaveLength(0)
    expect(statement.warnings[0]).toMatchObject({ severity: 'error', code: 'cuenta_ajena' })
  })
})

describe('varias cuentas en una sola sincronización', () => {
  const OTRA: PlaidRawAccount = { ...CUENTA, account_id: 'cuenta-2', mask: '7002' }

  it('agrupa los movimientos por cuenta, que vienen mezclados de /transactions/sync', () => {
    const statements = mapPlaidStatements(
      [CUENTA, OTRA],
      [
        mov({ transaction_id: '1', account_id: CUENTA.account_id }),
        mov({ transaction_id: '2', account_id: 'cuenta-2' }),
        mov({ transaction_id: '3', account_id: 'cuenta-2' }),
      ],
      OPCIONES,
    )
    expect(statements.map((statement) => statement.lines.length)).toEqual([1, 2])
    expect(statements[1]?.account.accountNumber).toBe('••••7002')
  })

  it('corta si un movimiento apunta a una cuenta que no se pasó, en vez de perderlo', () => {
    expect(() =>
      mapPlaidStatements([CUENTA], [mov({ transaction_id: '7', account_id: 'cuenta-2' })]),
    ).toThrow(/movimiento/)
  })
})
