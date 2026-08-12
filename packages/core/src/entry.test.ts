import { describe, expect, it } from 'vitest'
import { currencyCode } from './currency.js'
import {
  accountMovement,
  assertBalanced,
  balanceWithTradingAccounts,
  currencyImbalances,
  isBalanced,
  type Posting,
  UnbalancedEntryError,
} from './entry.js'
import type { AccountId } from './ids.js'
import { allocate, fromDecimalString, sum } from './money.js'

const EUR = currencyCode('EUR')
const USD = currencyCode('USD')

const acct = (name: string) => name as AccountId
const CHECKING = acct('checking-eur')
const GROCERIES = acct('expense-groceries')
const SAVINGS_USD = acct('savings-usd')
const COMPANY = acct('expense-company')

const posting = (accountId: AccountId, amount: string, currency = EUR): Posting => ({
  accountId,
  amount: fromDecimalString(amount, currency),
})

const tradingAccount = (currency: string) => acct(`trading-${currency.toLowerCase()}`)

describe('invariante de balanceo', () => {
  it('acepta una entry simple de dos patas', () => {
    const postings = [posting(CHECKING, '-42.50'), posting(GROCERIES, '42.50')]
    expect(isBalanced(postings)).toBe(true)
    expect(() => assertBalanced(postings)).not.toThrow()
  })

  it('rechaza una entry que no cierra y dice cuánto falta', () => {
    const postings = [posting(CHECKING, '-42.50'), posting(GROCERIES, '42.00')]
    expect(isBalanced(postings)).toBe(false)
    expect(currencyImbalances(postings).get(EUR)).toBe(-50n)
    expect(() => assertBalanced(postings)).toThrow(UnbalancedEntryError)
  })

  it('acepta un split de N patas', () => {
    const parts = allocate(fromDecimalString('100.00', EUR), [0.6, 0.4])
    const targets = [GROCERIES, COMPANY]
    const postings: Posting[] = [
      { accountId: CHECKING, amount: fromDecimalString('-100.00', EUR) },
      ...parts.map((amount, index) => ({
        accountId: targets[index] ?? GROCERIES,
        amount,
      })),
    ]
    expect(isBalanced(postings)).toBe(true)
    expect(parts.map((p) => p.amount)).toEqual([6000n, 4000n])
  })

  it('un gasto compartido con peso indivisible sigue cerrando', () => {
    const parts = allocate(fromDecimalString('100.00', EUR), [1, 1, 1])
    const postings: Posting[] = [
      { accountId: CHECKING, amount: fromDecimalString('-100.00', EUR) },
      ...parts.map((amount) => ({ accountId: GROCERIES, amount })),
    ]
    expect(isBalanced(postings)).toBe(true)
    expect(sum(parts, EUR).amount).toBe(10000n)
  })
})

describe('cuentas de trading para conversiones', () => {
  it('cierra una transferencia entre monedas distintas', () => {
    // 100 EUR salen; llegan 108,73 USD.
    const raw = [posting(CHECKING, '-100.00', EUR), posting(SAVINGS_USD, '108.73', USD)]
    expect(isBalanced(raw)).toBe(false)

    const balanced = balanceWithTradingAccounts(raw, tradingAccount)
    expect(isBalanced(balanced)).toBe(true)
    expect(balanced).toHaveLength(4)

    const eurLeg = balanced.find((p) => p.accountId === tradingAccount('EUR'))
    const usdLeg = balanced.find((p) => p.accountId === tradingAccount('USD'))
    expect(eurLeg?.amount.amount).toBe(10000n)
    expect(usdLeg?.amount.amount).toBe(-10873n)
  })

  it('es idempotente sobre una entry ya balanceada', () => {
    const postings = [posting(CHECKING, '-42.50'), posting(GROCERIES, '42.50')]
    expect(balanceWithTradingAccounts(postings, tradingAccount)).toEqual(postings)
  })

  it('genera las patas en orden determinista', () => {
    const raw = [posting(CHECKING, '-100.00', EUR), posting(SAVINGS_USD, '108.73', USD)]
    const a = balanceWithTradingAccounts(raw, tradingAccount)
    const b = balanceWithTradingAccounts(raw, tradingAccount)
    expect(a.map((p) => p.accountId)).toEqual(b.map((p) => p.accountId))
  })

  it('marca las patas de trading como transferencia, no como gasto', () => {
    const raw = [posting(CHECKING, '-100.00', EUR), posting(SAVINGS_USD, '108.73', USD)]
    const generated = balanceWithTradingAccounts(raw, tradingAccount).slice(2)
    expect(generated.every((p) => p.isTransfer === true)).toBe(true)
  })
})

describe('accountMovement', () => {
  it('suma sólo las patas de la cuenta y moneda pedidas', () => {
    const postings = [
      posting(CHECKING, '-42.50'),
      posting(CHECKING, '-10.00'),
      posting(GROCERIES, '52.50'),
      posting(SAVINGS_USD, '108.73', USD),
    ]
    expect(accountMovement(postings, CHECKING, EUR).amount).toBe(-5250n)
    expect(accountMovement(postings, SAVINGS_USD, USD).amount).toBe(10873n)
    expect(accountMovement(postings, SAVINGS_USD, EUR).amount).toBe(0n)
  })
})
