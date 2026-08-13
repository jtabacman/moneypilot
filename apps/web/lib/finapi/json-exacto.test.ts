import { describe, expect, it } from 'vitest'
import {
  aplanar,
  cadena,
  enteroSeguro,
  entrecomillarNumeros,
  JsonExactoError,
  objeto,
  parsearSinFlotantes,
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
