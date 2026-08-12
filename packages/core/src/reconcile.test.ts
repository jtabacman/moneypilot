import { describe, expect, it } from 'vitest'
import { currencyCode } from './currency.js'
import { fromDecimalString } from './money.js'
import { parsePlainDate } from './plain-date.js'
import {
  accountsWithDelta,
  type ImportReport,
  importReportIsClean,
  openingEntryAmount,
  reconcileAccount,
  renderImportReport,
  totalMovements,
} from './reconcile.js'

const EUR = currencyCode('EUR')
const eur = (value: string) => fromDecimalString(value, EUR)

describe('reconcileAccount', () => {
  it('marca conciliada cuando apertura + movimientos da el saldo declarado', () => {
    const result = reconcileAccount({
      accountId: 'a1',
      accountLabel: 'BBVA Corriente',
      currency: EUR,
      openingBalance: eur('1000.00'),
      closingBalance: eur('857.50'),
      movements: eur('-142.50'),
      linesImported: 3,
    })
    expect(result.status).toBe('conciliada')
    expect(result.delta?.amount).toBe(0n)
    expect(result.computedClosing?.amount).toBe(85750n)
  })

  it('detecta un delta de un solo céntimo', () => {
    const result = reconcileAccount({
      accountId: 'a1',
      accountLabel: 'BBVA Corriente',
      currency: EUR,
      openingBalance: eur('1000.00'),
      closingBalance: eur('857.49'),
      movements: eur('-142.50'),
      linesImported: 3,
    })
    expect(result.status).toBe('delta')
    expect(result.delta?.amount).toBe(1n)
  })

  it('no inventa un estado cuando el extracto no declara saldos', () => {
    const result = reconcileAccount({
      accountId: 'a1',
      accountLabel: 'Cuenta sin saldos',
      currency: EUR,
      movements: eur('-142.50'),
      linesImported: 3,
    })
    expect(result.status).toBe('sin_saldo_declarado')
    expect(result.delta).toBeNull()
    expect(result.computedClosing).toBeNull()
  })
})

describe('openingEntryAmount', () => {
  it('calcula la apertura hacia atrás desde el saldo conocido', () => {
    // La cuenta existe hace 15 años pero sólo importamos 24 meses: la
    // diferencia entre el saldo real y lo cargado es el asiento de apertura.
    const opening = openingEntryAmount(eur('12500.00'), eur('-3400.00'))
    expect(opening.amount).toBe(1590000n)
  })

  it('da cero cuando los movimientos explican todo el saldo', () => {
    expect(openingEntryAmount(eur('500.00'), eur('500.00')).amount).toBe(0n)
  })
})

describe('totalMovements', () => {
  it('suma sólo la moneda pedida', () => {
    const total = totalMovements(
      [eur('-42.50'), eur('-13.20'), fromDecimalString('-100.00', currencyCode('USD'))],
      EUR,
    )
    expect(total.amount).toBe(-5570n)
  })
})

const baseReport = (overrides: Partial<ImportReport> = {}): ImportReport => ({
  batchId: 'batch-01',
  fileName: 'bbva-2026-03.n43',
  format: 'n43',
  importedAt: '2026-08-12T10:00:00Z',
  linesRead: 120,
  imported: 115,
  duplicates: 5,
  needsReview: 0,
  rejected: [],
  transfersMatched: 2,
  warnings: [],
  periodFrom: parsePlainDate('2026-03-01'),
  periodTo: parsePlainDate('2026-03-31'),
  accounts: [
    reconcileAccount({
      accountId: 'a1',
      accountLabel: 'BBVA Corriente',
      currency: EUR,
      openingBalance: eur('1000.00'),
      closingBalance: eur('857.50'),
      movements: eur('-142.50'),
      linesImported: 115,
    }),
  ],
  ...overrides,
})

describe('informe de importación', () => {
  it('un informe sin deltas ni rechazos está limpio', () => {
    expect(importReportIsClean(baseReport())).toBe(true)
  })

  it('una sola fila rechazada ensucia el informe', () => {
    const report = baseReport({
      rejected: [
        { lineNumber: 42, reason: 'fecha_ilegible', detail: 'no se pudo inferir el formato' },
      ],
    })
    expect(importReportIsClean(report)).toBe(false)
  })

  it('un delta de un céntimo ensucia el informe', () => {
    const report = baseReport({
      accounts: [
        reconcileAccount({
          accountId: 'a1',
          accountLabel: 'BBVA Corriente',
          currency: EUR,
          openingBalance: eur('1000.00'),
          closingBalance: eur('857.51'),
          movements: eur('-142.50'),
          linesImported: 115,
        }),
      ],
    })
    expect(importReportIsClean(report)).toBe(false)
    expect(accountsWithDelta(report)).toHaveLength(1)
  })

  it('el render muestra los números que hacen creíble la importación', () => {
    const output = renderImportReport(baseReport())
    expect(output).toContain('INFORME DE IMPORTACIÓN')
    expect(output).toContain('bbva-2026-03.n43')
    expect(output).toContain('BBVA Corriente')
    expect(output).toContain('857.50 EUR')
    expect(output).toContain('0.00 EUR')
    expect(output).toContain('todas las cuentas cuadran')
  })

  it('el render declara los problemas en vez de esconderlos', () => {
    const output = renderImportReport(
      baseReport({
        rejected: [
          {
            lineNumber: 42,
            reason: 'importe_ilegible',
            detail: 'campo vacío',
            raw: '2026-03-01;;;',
          },
        ],
        warnings: [
          { severity: 'warning', code: 'fecha_ambigua', message: 'formato inferido como DD/MM' },
        ],
      }),
    )
    expect(output).toContain('FILAS RECHAZADAS')
    expect(output).toContain('importe_ilegible')
    expect(output).toContain('2026-03-01;;;')
    expect(output).toContain('AVISOS')
    expect(output).toContain('RESULTADO: revisar')
  })
})
