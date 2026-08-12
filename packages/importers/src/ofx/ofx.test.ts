import { toDecimalString } from '@moneypilot/core'
import { describe, expect, it } from 'vitest'
import { parseOfx, parseOfxDate } from './parse.js'
import { parseOfxTree, textOf } from './tokenize.js'

const utf8 = (text: string) => new TextEncoder().encode(text)

/** OFX 1.x real: cabecera propietaria y tags hoja sin cerrar. */
const OFX_1X = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<STMTRS>
<CURDEF>USD
<BANKACCTFROM>
<BANKID>021000021
<ACCTID>1234567890
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260301
<DTEND>20260331
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260312120000.000[-5:EST]
<TRNAMT>-42.50
<FITID>202603120001
<NAME>WHOLE FOODS MKT
<MEMO>PURCHASE 1234
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260315
<TRNAMT>3200.00
<FITID>202603150002
<NAME>PAYROLL DEPOSIT
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>8457.31
<DTASOF>20260331
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`

/** OFX 2.x: XML bien formado, todos los tags cerrados. */
const OFX_2X = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX>
  <BANKMSGSRSV1>
    <STMTTRNRS>
      <STMTRS>
        <CURDEF>EUR</CURDEF>
        <BANKACCTFROM>
          <BANKID>ESBBVA</BANKID>
          <ACCTID>ES9121000418450200051332</ACCTID>
        </BANKACCTFROM>
        <BANKTRANLIST>
          <STMTTRN>
            <TRNTYPE>DEBIT</TRNTYPE>
            <DTPOSTED>20260312</DTPOSTED>
            <TRNAMT>-42,50</TRNAMT>
            <FITID>ABC-1</FITID>
            <NAME>Caf&amp;eacute; Central</NAME>
            <MEMO>N&#243;mina &amp; caf&#233;</MEMO>
          </STMTTRN>
        </BANKTRANLIST>
      </STMTRS>
    </STMTTRNRS>
  </BANKMSGSRSV1>
</OFX>`

describe('tokenizador', () => {
  it('cierra las hojas sin cerrar de SGML', () => {
    const tree = parseOfxTree(`<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260312
<TRNAMT>-42.50
</STMTTRN>`)
    const txn = tree.children[0]
    expect(txn?.tag).toBe('STMTTRN')
    expect(txn?.children).toHaveLength(3)
    expect(textOf(txn, 'TRNTYPE')).toBe('DEBIT')
    expect(textOf(txn, 'TRNAMT')).toBe('-42.50')
  })

  it('aguanta ficheros mixtos con unas hojas cerradas y otras no', () => {
    // Existen bancos que emiten 1.x pero cierran algunos tags. Ni un parser
    // XML ni uno que asuma "ninguna hoja cierra" sobreviven a esto.
    const tree = parseOfxTree(`<STMTTRN>
<TRNTYPE>DEBIT</TRNTYPE>
<DTPOSTED>20260312
<TRNAMT>-42.50</TRNAMT>
<FITID>X1
</STMTTRN>`)
    const txn = tree.children[0]
    expect(txn?.children).toHaveLength(4)
    expect(textOf(txn, 'DTPOSTED')).toBe('20260312')
    expect(textOf(txn, 'FITID')).toBe('X1')
  })

  it('ignora cierres huérfanos en vez de romper el árbol', () => {
    const tree = parseOfxTree('<A><B>1</C></A>')
    expect(textOf(tree.children[0], 'B')).toBe('1')
  })

  it('decodifica entidades numéricas y con nombre', () => {
    const tree = parseOfxTree('<A><B>Caf&#233; &amp; t&eacute;</B></A>')
    expect(textOf(tree.children[0], 'B')).toBe('Café & t&eacute;')
  })
})

describe('OFX 1.x SGML', () => {
  const [statement] = parseOfx(utf8(OFX_1X))

  it('detecta la cuenta y la moneda', () => {
    expect(statement?.format).toBe('ofx')
    expect(statement?.account.currency).toBe('USD')
    expect(statement?.account.institution).toBe('021000021')
  })

  it('enmascara el número de cuenta', () => {
    // Nunca se guarda completo: es superficie de brecha sin valor.
    expect(statement?.account.accountNumber).toBe('••••7890')
    expect(statement?.account.accountNumber).not.toContain('1234567890')
  })

  it('lee las transacciones con signo e importe exactos', () => {
    expect(statement?.lines).toHaveLength(2)
    const [debit, credit] = statement?.lines ?? []
    expect(debit?.bookedOn).toBe('2026-03-12')
    expect(toDecimalString(debit?.amount ?? { amount: 0n, currency: 'USD' as never })).toBe(
      '-42.50',
    )
    expect(debit?.externalId).toBe('202603120001')
    expect(credit?.bookedOn).toBe('2026-03-15')
    expect(toDecimalString(credit?.amount ?? { amount: 0n, currency: 'USD' as never })).toBe(
      '3200.00',
    )
  })

  it('descarta la hora y la zona de DTPOSTED sin correr el día', () => {
    // 20260312120000.000[-5:EST] es el 12 de marzo para el banco. Convertirlo
    // a otra zona lo movería al 11 y rompería los cortes de período.
    expect(statement?.lines[0]?.bookedOn).toBe('2026-03-12')
  })

  it('compone la descripción con NAME y MEMO', () => {
    expect(statement?.lines[0]?.description).toBe('WHOLE FOODS MKT · PURCHASE 1234')
  })

  it('conserva en raw todo lo que no interpretó', () => {
    expect(statement?.lines[0]?.raw).toMatchObject({
      TRNTYPE: 'DEBIT',
      FITID: '202603120001',
      MEMO: 'PURCHASE 1234',
    })
  })

  it('lee el saldo de cierre', () => {
    expect(statement?.closingBalance?.on).toBe('2026-03-31')
    expect(
      toDecimalString(
        statement?.closingBalance?.amount ?? {
          amount: 0n,
          currency: 'USD' as never,
        },
      ),
    ).toBe('8457.31')
  })

  it('NO deriva un saldo de apertura, y eso es deliberado', () => {
    // Derivarlo restando los movimientos haría que el delta diera cero
    // siempre y convertiría la reconciliación en una tautología. OFX no trae
    // saldo de apertura: decir que no lo trae es la verdad.
    expect(statement?.openingBalance).toBeUndefined()
  })
})

describe('OFX 2.x XML', () => {
  const [statement] = parseOfx(utf8(OFX_2X))

  it('lee el mismo modelo desde XML', () => {
    expect(statement?.account.currency).toBe('EUR')
    expect(statement?.lines).toHaveLength(1)
  })

  it('acepta la coma como separador decimal', () => {
    expect(
      toDecimalString(statement?.lines[0]?.amount ?? { amount: 0n, currency: 'EUR' as never }),
    ).toBe('-42.50')
  })

  it('decodifica las entidades de la descripción', () => {
    expect(statement?.lines[0]?.description).toContain('Nómina')
    expect(statement?.lines[0]?.description).toContain('café')
  })
})

describe('casos que rompen importadores ingenuos', () => {
  it('lee tarjetas de crédito (CCSTMTRS)', () => {
    const file = `OFXHEADER:100

<OFX>
<CREDITCARDMSGSRSV1>
<CCSTMTTRNRS>
<CCSTMTRS>
<CURDEF>USD
<CCACCTFROM>
<ACCTID>4111111111111111
</CCACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260310
<TRNAMT>-89.99
<FITID>CC-1
<NAME>AMZN Mktp
</STMTTRN>
</BANKTRANLIST>
</CCSTMTRS>
</CCSTMTTRNRS>
</CREDITCARDMSGSRSV1>
</OFX>`
    const [statement] = parseOfx(utf8(file))
    expect(statement?.lines).toHaveLength(1)
    expect(statement?.account.accountNumber).toBe('••••1111')
  })

  it('devuelve un extracto por cada cuenta del fichero', () => {
    const twoAccounts = OFX_1X.replace(
      '</BANKMSGSRSV1>',
      `<STMTTRNRS>
<STMTRS>
<CURDEF>USD
<BANKACCTFROM>
<ACCTID>9999
</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<DTPOSTED>20260320
<TRNAMT>-10.00
<FITID>B-1
<NAME>OTRA CUENTA
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>`,
    )
    const statements = parseOfx(utf8(twoAccounts))
    expect(statements).toHaveLength(2)
    expect(statements[1]?.lines[0]?.description).toBe('OTRA CUENTA')
  })

  it('detecta QFX por los campos de Intuit', () => {
    const qfx = OFX_1X.replace('<OFX>', '<OFX>\n<INTU.BID>01234')
    expect(parseOfx(utf8(qfx))[0]?.format).toBe('qfx')
  })

  it('decodifica windows-1252 cuando la cabecera lo declara', () => {
    // "Nómina" en cp1252: la ó es un solo byte 0xF3, que en UTF-8 es inválido.
    const header = OFX_1X.slice(0, OFX_1X.indexOf('<OFX>'))
    const body = OFX_1X.slice(OFX_1X.indexOf('<OFX>')).replace('PAYROLL DEPOSIT', 'Nómina')
    const bytes = new Uint8Array([
      ...[...header].map((c) => c.charCodeAt(0)),
      ...[...body].map((c) => c.charCodeAt(0)),
    ])
    const [statement] = parseOfx(bytes)
    expect(statement?.lines[1]?.description).toBe('Nómina')
  })

  it('rechaza la fila sin fecha con motivo, y sigue con el resto', () => {
    const broken = OFX_1X.replace('<DTPOSTED>20260315\n', '')
    const [statement] = parseOfx(utf8(broken))
    expect(statement?.lines).toHaveLength(1)
    expect(statement?.warnings.some((w) => w.code === 'fecha_ilegible')).toBe(true)
  })

  it('avisa cuando el fichero no declara moneda en vez de asumir en silencio', () => {
    const [statement] = parseOfx(utf8(OFX_1X.replace('<CURDEF>USD\n', '')))
    expect(statement?.warnings.some((w) => w.code === 'moneda_no_declarada')).toBe(true)
  })

  it('devuelve lista vacía si no hay ningún extracto', () => {
    expect(parseOfx(utf8('<OFX><SIGNONMSGSRSV1></SIGNONMSGSRSV1></OFX>'))).toEqual([])
  })
})

describe('parseOfxDate', () => {
  it('acepta las formas del estándar', () => {
    expect(parseOfxDate('20260312')).toBe('2026-03-12')
    expect(parseOfxDate('20260312120000')).toBe('2026-03-12')
    expect(parseOfxDate('20260312120000.000[-5:EST]')).toBe('2026-03-12')
  })

  it('rechaza lo que no puede leer', () => {
    expect(parseOfxDate(undefined)).toBeNull()
    expect(parseOfxDate('12/03/2026')).toBeNull()
    expect(parseOfxDate('20260230')).toBeNull()
  })
})
