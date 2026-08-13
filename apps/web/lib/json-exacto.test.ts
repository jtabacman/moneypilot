import { describe, expect, it } from 'vitest'
import {
  aplanar,
  cadena,
  decimalExacto,
  enteroSeguro,
  entrecomillarNumeros,
  JsonExactoError,
  objeto,
  parsearSinFlotantes,
  serializarConDecimalesExactos,
} from './json-exacto'

describe('entrecomillarNumeros', () => {
  it('convierte en cadena el literal numérico de un importe', () => {
    expect(entrecomillarNumeros('{"amount":-135.89}')).toBe('{"amount":"-135.89"}')
  })

  it('no toca los números que están dentro de una cadena', () => {
    // El concepto de un movimiento real trae barras, dígitos y hasta importes.
    // Una expresión regular sobre el texto crudo los rompería; el escáner
    // copia la cadena entera sin mirar dentro.
    const crudo = '{"purpose":"4/302460/639 -135.89 EUR","amount":-135.89}'
    expect(entrecomillarNumeros(crudo)).toBe(
      '{"purpose":"4/302460/639 -135.89 EUR","amount":"-135.89"}',
    )
  })

  it('respeta las comillas escapadas dentro de una cadena', () => {
    const crudo = '{"purpose":"dijo \\"12.34\\" y colgó","amount":1.00}'
    expect(entrecomillarNumeros(crudo)).toBe(
      '{"purpose":"dijo \\"12.34\\" y colgó","amount":"1.00"}',
    )
  })

  it('mantiene true, false y null como están', () => {
    expect(entrecomillarNumeros('{"a":true,"b":false,"c":null}')).toBe(
      '{"a":true,"b":false,"c":null}',
    )
  })

  it('entrecomilla también dentro de listas y con notación exponencial', () => {
    expect(entrecomillarNumeros('{"c":[419,420,-1.5e+10]}')).toBe('{"c":["419","420","-1.5e+10"]}')
  })
})

describe('parsearSinFlotantes', () => {
  it('deja el importe como la cadena exacta que mandó el servidor', () => {
    const raiz = objeto(parsearSinFlotantes('{"amount":-135.89}'), 'raíz')
    expect(cadena(raiz, 'amount')).toBe('-135.89')
  })

  it('conserva los decimales que JSON.parse redondearía', () => {
    // La prueba de que esto no es paranoia: catorce dígitos y dos decimales.
    // JSON.parse devuelve 99999999999999.98 — un céntimo menos, sin avisar.
    const crudo = '{"amount":99999999999999.99}'
    expect(JSON.parse(crudo).amount.toFixed(2)).toBe('99999999999999.98')

    const raiz = objeto(parsearSinFlotantes(crudo), 'raíz')
    expect(cadena(raiz, 'amount')).toBe('99999999999999.99')
  })

  it('conserva los ceros de la derecha, que en dinero significan algo', () => {
    const raiz = objeto(parsearSinFlotantes('{"amount":-350.00}'), 'raíz')
    expect(cadena(raiz, 'amount')).toBe('-350.00')
  })

  it('no pierde precisión en un identificador largo', () => {
    const raiz = objeto(parsearSinFlotantes('{"id":9007199254740993}'), 'raíz')
    expect(cadena(raiz, 'id')).toBe('9007199254740993')
  })

  it('explica el fallo cuando el cuerpo no es JSON', () => {
    expect(() => parsearSinFlotantes('<html>502 Bad Gateway</html>')).toThrow(JsonExactoError)
  })
})

describe('enteroSeguro', () => {
  it('lee un número de página', () => {
    expect(enteroSeguro('323', 'paging.pageCount')).toBe(323)
  })

  it('rechaza un decimal en vez de truncarlo en silencio', () => {
    expect(() => enteroSeguro('3.5', 'paging.pageCount')).toThrow(JsonExactoError)
  })

  it('rechaza un entero que no cabe sin perder precisión', () => {
    expect(() => enteroSeguro('9007199254740993', 'un id')).toThrow(JsonExactoError)
  })
})

describe('aplanar', () => {
  it('aplana lo anidado con clave punteada para que quepa en raw', () => {
    const valor = parsearSinFlotantes(
      '{"id":1,"category":{"id":418,"name":"Versicherung"},"labels":["a","b"],"isNew":true}',
    )
    expect(aplanar(valor)).toEqual({
      id: '1',
      'category.id': '418',
      'category.name': 'Versicherung',
      'labels.0': 'a',
      'labels.1': 'b',
      isNew: 'true',
    })
  })

  it('omite los nulos y las cadenas vacías en vez de guardar ruido', () => {
    expect(aplanar(parsearSinFlotantes('{"a":null,"b":"","c":"x"}'))).toEqual({ c: 'x' })
  })
})

describe('serializarConDecimalesExactos', () => {
  it('escribe el importe como literal numérico sin pasar por number', () => {
    // El de siempre: por `Number` este importe sale con un céntimo de menos.
    expect(Number('99999999999999.99').toFixed(2)).toBe('99999999999999.98')

    const cuerpo = serializarConDecimalesExactos({ amount: decimalExacto('99999999999999.99') })
    expect(cuerpo).toBe('{"amount":99999999999999.99}')
  })

  it('conserva los ceros de la derecha que JSON.stringify de un number borra', () => {
    expect(JSON.stringify({ amount: 350.0 })).toBe('{"amount":350}')
    expect(serializarConDecimalesExactos({ amount: decimalExacto('350.00') })).toBe(
      '{"amount":350.00}',
    )
  })

  it('deja intacto todo lo demás, incluidas las cadenas que parecen números', () => {
    const cuerpo = serializarConDecimalesExactos({
      id: '101',
      description: 'COMPRA 12.34 EUR',
      amount: decimalExacto('-135.89'),
      pending: true,
      location: { country: 'ES' },
      lista: [decimalExacto('1.10'), decimalExacto('2.20')],
    })
    expect(cuerpo).toBe(
      '{"id":"101","description":"COMPRA 12.34 EUR","amount":-135.89,"pending":true,' +
        '"location":{"country":"ES"},"lista":[1.10,2.20]}',
    )
  })

  it('no se deja engañar por un texto que imita al centinela', () => {
    // El centinela lleva un nonce aleatorio justamente por esto. Si fuera fijo,
    // un concepto de movimiento que lo contuviera saldría convertido en número
    // y el cuerpo se rompería —o peor, colaría un importe inventado.
    const cuerpo = serializarConDecimalesExactos({
      description: 'd0000000000000000000000000000000',
      amount: decimalExacto('1.00'),
    })
    expect(JSON.parse(cuerpo).description).toBe('d0000000000000000000000000000000')
    expect(cuerpo).toContain('"amount":1.00')
  })

  it('rechaza lo que no es un decimal en vez de escribirlo en el cuerpo', () => {
    expect(() => decimalExacto('1,5')).toThrow(JsonExactoError)
    expect(() => decimalExacto('1e5')).toThrow(JsonExactoError)
    expect(() => decimalExacto('')).toThrow(JsonExactoError)
    // Sin esto, un `null` en el ledger acabaría siendo un literal en el cuerpo.
    expect(() => decimalExacto('NaN')).toThrow(JsonExactoError)
  })
})
