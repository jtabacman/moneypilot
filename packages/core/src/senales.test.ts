import { describe, expect, it } from 'vitest'
import { currencyCode } from './currency.js'
import { fromDecimalString } from './money.js'
import {
  type ContextoDelHogar,
  type MovimientoObservado,
  senalesDe,
  type TipoSenal,
} from './senales.js'

const EUR = currencyCode('EUR')

const CORRIENTE = 'cuenta-corriente'
const AHORRO = 'cuenta-ahorro'
const IBAN_AHORRO = 'ES9121000418450200051332'
const IBAN_AJENO = 'DE89370400440532013000'

const HOGAR: ContextoDelHogar = {
  cuentasPropias: [
    { id: CORRIENTE, nombre: 'Cuenta corriente BBVA', iban: 'ES7921000813610123456789' },
    { id: AHORRO, nombre: 'Ahorro', iban: IBAN_AHORRO },
  ],
}

const movimiento = (
  importe: string,
  extra: Partial<MovimientoObservado> = {},
): MovimientoObservado => ({
  amount: fromDecimalString(importe, EUR),
  accountId: CORRIENTE,
  accountKind: 'asset',
  ...extra,
})

const tipos = (movimiento: MovimientoObservado, contexto: ContextoDelHogar = {}): TipoSenal[] =>
  senalesDe(movimiento, contexto).map((senal) => senal.tipo)

describe('la contraparte es una cuenta del propio hogar', () => {
  it('reconoce el traspaso por el IBAN y dice de qué cuenta se trata', () => {
    const senales = senalesDe(movimiento('-2000.00', { counterpartIban: IBAN_AHORRO }), HOGAR)
    expect(senales).toHaveLength(1)
    expect(senales[0]?.tipo).toBe('traspaso_interno')
    // El motivo tiene que servir para contestarle al usuario, así que nombra la
    // cuenta y el dato que lo probó.
    expect(senales[0]?.motivo).toContain('Ahorro')
    expect(senales[0]?.motivo).toContain(IBAN_AHORRO)
  })

  it('compara IBAN normalizado: los espacios y las minúsculas no cambian nada', () => {
    expect(
      tipos(movimiento('-2000.00', { counterpartIban: 'es91 2100 0418 4502 0005 1332' }), HOGAR),
    ).toContain('traspaso_interno')
  })

  it('un IBAN que no es del hogar no produce traspaso', () => {
    expect(tipos(movimiento('-2000.00', { counterpartIban: IBAN_AJENO }), HOGAR)).toEqual([])
  })

  it('sin las cuentas del hogar en el contexto no se afirma nada', () => {
    // La ausencia de contexto no es prueba de que no sea un traspaso.
    expect(tipos(movimiento('-2000.00', { counterpartIban: IBAN_AHORRO }))).toEqual([])
  })

  it('acepta la contraparte ya resuelta a una cuenta', () => {
    const senales = senalesDe(movimiento('-500.00', { counterpartAccountId: AHORRO }), HOGAR)
    expect(senales[0]?.tipo).toBe('traspaso_interno')
  })

  it('por nombre sólo con igualdad exacta', () => {
    expect(tipos(movimiento('-500.00', { counterpartName: 'ahorro' }), HOGAR)).toEqual([
      'traspaso_interno',
    ])
    // Parecido no alcanza: si se aceptara, un pago a un tercero que se llamara
    // parecido desaparecería del informe como si fuera dinero propio.
    expect(tipos(movimiento('-500.00', { counterpartName: 'Ahorro Familiar SL' }), HOGAR)).toEqual(
      [],
    )
  })

  it('el traspaso interno calla la señal de ingreso venga de donde venga', () => {
    // Si el dinero sale de otra cuenta del hogar, no entró de ningún sitio; que
    // el agregador diga INCOME sobre eso es un error suyo.
    const senales = tipos(
      movimiento('2000.00', {
        counterpartIban: IBAN_AHORRO,
        personalFinanceCategory: { primary: 'INCOME', confidenceLevel: 'VERY_HIGH' },
      }),
      HOGAR,
    )
    expect(senales).toEqual(['traspaso_interno'])
  })
})

describe('signo y tipo de cuenta', () => {
  it('lo que entra en una cuenta de activo es ingreso', () => {
    const senales = senalesDe(movimiento('1850.00'), HOGAR)
    expect(senales.map((senal) => senal.tipo)).toEqual(['ingreso'])
    expect(senales[0]?.motivo).toContain('1850.00 EUR')
  })

  it('en una cuenta de deuda un importe positivo NO es ingreso', () => {
    // Es el pago de la tarjeta o una devolución: contarlo como ingreso inflaría
    // los ingresos del mes con dinero que ya estaba dentro.
    expect(tipos(movimiento('1850.00', { accountKind: 'liability' }), HOGAR)).toEqual([])
  })

  it('lo que sale no produce señal de ingreso', () => {
    expect(tipos(movimiento('-45.20'), HOGAR)).toEqual([])
  })
})

describe('Norma 43', () => {
  it('lee los conceptos comunes, que son estándar del sector', () => {
    expect(tipos(movimiento('-62.10', { conceptoComun: '03' }))).toEqual(['domiciliacion'])
    expect(tipos(movimiento('-100.00', { conceptoComun: '11' }))).toEqual(['efectivo'])
    expect(tipos(movimiento('-38.90', { conceptoComun: '12' }))).toEqual(['tarjeta'])
    expect(tipos(movimiento('-4.50', { conceptoComun: '17' }))).toEqual(['comision'])
    expect(tipos(movimiento('2400.00', { conceptoComun: '15' }))).toEqual(['ingreso'])
  })

  it('el motivo cita el código y lo que significa en el estándar', () => {
    const senales = senalesDe(movimiento('-62.10', { conceptoComun: '03' }))
    expect(senales[0]?.motivo).toContain('concepto común 03')
    expect(senales[0]?.motivo).toContain('domiciliados')
  })

  it('un concepto propio desconocido no produce ninguna señal', () => {
    // El 007 de Sabadell no es el 007 de CaixaBank: sin saber la entidad, este
    // campo no significa nada y acá no se interpreta nunca.
    expect(tipos(movimiento('-62.10', { conceptoPropio: '007' }))).toEqual([])
    expect(tipos(movimiento('-62.10', { conceptoPropio: '999' }))).toEqual([])
    // Y tampoco cambia lo que dice el concepto común que va a su lado.
    expect(tipos(movimiento('-62.10', { conceptoComun: '03', conceptoPropio: '007' }))).toEqual([
      'domiciliacion',
    ])
  })

  it('un concepto común fuera de la tabla tampoco se adivina', () => {
    expect(tipos(movimiento('-62.10', { conceptoComun: '77' }))).toEqual([])
  })

  it('el 04 dice transferencia, no dice que sea entre cuentas propias', () => {
    // No produce traspaso interno; lo que hace es callar el ingreso por signo,
    // porque el dinero podría venir del propio ahorro o de un cliente.
    expect(tipos(movimiento('2000.00', { conceptoComun: '04' }), HOGAR)).toEqual([])
  })

  it('el signo decide en los conceptos que valen para los dos lados', () => {
    // 15 son nóminas (entra) y seguros sociales (sale): sólo lo primero es ingreso.
    expect(tipos(movimiento('-980.00', { conceptoComun: '15' }))).toEqual([])
    expect(tipos(movimiento('120.00', { conceptoComun: '08' }))).toEqual(['ingreso'])
  })
})

describe('datos del agregador', () => {
  it('INCOME produce ingreso y cita la confianza declarada', () => {
    const senales = senalesDe(
      movimiento('2400.00', {
        personalFinanceCategory: { primary: 'INCOME', confidenceLevel: 'VERY_HIGH' },
      }),
    )
    expect(senales.map((senal) => senal.tipo)).toEqual(['ingreso'])
    expect(senales[0]?.motivo).toContain('VERY_HIGH')
  })

  it('con confianza baja el dato no se usa', () => {
    // Queda el ingreso por signo, que es nuestro, no el del agregador.
    const senales = senalesDe(
      movimiento('2400.00', {
        personalFinanceCategory: { primary: 'INCOME', confidenceLevel: 'LOW' },
      }),
    )
    expect(senales[0]?.motivo).not.toContain('INCOME')
  })

  it('TRANSFER_IN calla el ingreso sin afirmar un traspaso interno', () => {
    expect(
      tipos(movimiento('2000.00', { personalFinanceCategory: { primary: 'TRANSFER_IN' } })),
    ).toEqual([])
  })

  it('el canal presencial es tarjeta; el canal online no dice nada', () => {
    expect(tipos(movimiento('-38.90', { paymentChannel: 'in store' }))).toEqual(['tarjeta'])
    // Por 'online' viajan igual una compra, una domiciliación y una transferencia.
    expect(tipos(movimiento('-38.90', { paymentChannel: 'online' }))).toEqual([])
  })

  it('el resto de su taxonomía no se traduce a nada', () => {
    // FOOD_AND_DRINK es una opinión sobre en qué se gastó, y el plan de cuentas
    // de esta familia no lo puede decidir un agregador.
    expect(
      tipos(movimiento('-38.90', { personalFinanceCategory: { primary: 'FOOD_AND_DRINK' } })),
    ).toEqual([])
  })
})

describe('transaction_code de la entidad', () => {
  it('traduce los códigos de la lista cerrada', () => {
    expect(tipos(movimiento('-100.00', { transactionCode: 'atm' }))).toEqual(['efectivo'])
    expect(tipos(movimiento('-62.10', { transactionCode: 'direct debit' }))).toEqual([
      'domiciliacion',
    ])
    expect(tipos(movimiento('-62.10', { transactionCode: 'DIRECT_DEBIT' }))).toEqual([
      'domiciliacion',
    ])
    expect(tipos(movimiento('-3.00', { transactionCode: 'bank charge' }))).toEqual(['comision'])
  })

  it('los intereses cambian de sentido con el signo', () => {
    expect(tipos(movimiento('-12.00', { transactionCode: 'interest' }))).toEqual(['comision'])
    expect(tipos(movimiento('12.00', { transactionCode: 'interest' }))).toEqual(['ingreso'])
  })

  it("'transfer' no produce traspaso interno", () => {
    expect(tipos(movimiento('-2000.00', { transactionCode: 'transfer' }), HOGAR)).toEqual([])
  })
})

describe('forma de la respuesta', () => {
  it('una sola señal por tipo, la de la fuente más fuerte', () => {
    const senales = senalesDe(
      movimiento('-62.10', { conceptoComun: '03', transactionCode: 'direct debit' }),
    )
    expect(senales).toHaveLength(1)
    // Gana el código de la Norma 43 porque los dos son de la entidad y ése es
    // el primero que se mira; lo que no puede pasar es que salgan dos.
    expect(senales[0]?.motivo).toContain('Norma 43')
  })

  it('orden fijo y salida reproducible', () => {
    const observado = movimiento('-38.90', {
      conceptoComun: '12',
      transactionCode: 'atm',
      paymentChannel: 'in store',
    })
    expect(tipos(observado)).toEqual(['efectivo', 'tarjeta'])
    expect(senalesDe(observado)).toEqual(senalesDe(observado))
  })

  it('sin nada que mirar, ninguna señal', () => {
    expect(senalesDe(movimiento('-38.90'))).toEqual([])
  })
})
