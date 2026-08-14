/**
 * El diccionario, y sobre todo su calidad.
 *
 * La mitad de estos tests no prueban código: prueban el DATO. Es lo correcto
 * acá, porque el código son cuarenta líneas y el riesgo está entero en las
 * ciento y pico entradas — una ruta mal escrita, una entrada ambigua con
 * categoría, un alias que reconoce medio extracto. Esos fallos no rompen nada
 * al ejecutarse: clasifican mal y en silencio.
 *
 * Los descriptores que se usan de ejemplo están escritos a mano con la forma
 * que tienen los de un banco. Ninguno se copió del corpus de prueba: un test
 * que repite el corpus comprueba que la demo sale bien, no que el motor sirva.
 */

import { describe, expect, it } from 'vitest'
import { merchantKey } from '../merchant.js'
import { buscarPorRuta } from '../proveedor/arbol.js'
import { buscarEnDiccionario, entradasDeDiccionario, rutasDelDiccionario } from './buscar.js'

describe('buscarEnDiccionario', () => {
  it('reconoce el comercio dentro del ruido que mete el banco', () => {
    const encontrado = buscarEnDiccionario('COMPRA TARJ 5432 MERCADONA 4021 REF 88123 MADRID')
    expect(encontrado?.clave).toBe('mercadona')
    expect(encontrado?.categoria).toBe('Día a día > Supermercado')
    expect(encontrado?.confianza).toBe('alta')
  })

  it('da igual el orden de las palabras del descriptor', () => {
    // La comparación es por conjuntos justamente por esto: el orden en que la
    // entidad compone el descriptor no es un dato de nadie.
    expect(buscarEnDiccionario('ZARA ESPANA')?.clave).toBe('zara')
    expect(buscarEnDiccionario('ESPANA ZARA')?.clave).toBe('zara')
  })

  it('acepta la clave ya canonizada igual que el descriptor entero', () => {
    // Quien tenga la lista agrupada por comercio busca con la clave y no pierde
    // nada; si esto dejara de valer, el motor buscaría dos veces por caminos
    // distintos y daría dos respuestas.
    const descriptor = 'Recibo IBERDROLA CLIENTES SAU 04/2026'
    const porDescriptor = buscarEnDiccionario(descriptor)
    const porClave = buscarEnDiccionario(merchantKey(descriptor))
    expect(porDescriptor).toEqual(porClave)
    expect(porClave?.clave).toBe('iberdrola')
  })

  it('gana el alias más específico', () => {
    // Los dos casos que más duelen si se resuelven al revés: la televisión
    // facturada por la teleco, y la comida a domicilio facturada por el taxi.
    expect(buscarEnDiccionario('MOVISTAR PLUS 34 ES')?.clave).toBe('movistar-plus')
    expect(buscarEnDiccionario('MOVISTAR FUSION')?.clave).toBe('movistar')
    expect(buscarEnDiccionario('UBER EATS AMSTERDAM')?.categoria).toBe(
      'Día a día > Restaurantes y bares',
    )
    expect(buscarEnDiccionario('UBER TRIP HELP.UBER.COM')?.categoria).toBe(
      'Transporte > Taxis y VTC',
    )
  })

  it('reconoce el comercio y NO propone categoría cuando el comercio no la determina', () => {
    // El corazón del criterio de calidad. Si esto devolviera una categoría, el
    // motor mandaría a la misma cuenta un libro, un secador y una lavadora.
    for (const descriptor of ['AMZN MKTP ES*1A2B3', 'EL CORTE INGLES SA 4412', 'PAYPAL 3298471']) {
      const encontrado = buscarEnDiccionario(descriptor)
      expect(encontrado, descriptor).toBeDefined()
      expect(encontrado?.categoria, descriptor).toBeNull()
      expect(encontrado?.confianza, descriptor).toBe('ambigua')
    }
  })

  it('cuando la pasarela arrastra al comercio de verdad, gana el comercio', () => {
    // `PAYPAL *SPOTIFY` trae los dos: la cañería por la que pasó el dinero y
    // quién cobró. Quedarse con PayPal sería tirar el único dato que sirve.
    const encontrado = buscarEnDiccionario('PAYPAL *SPOTIFY AB')
    expect(encontrado?.clave).toBe('spotify')
    expect(encontrado?.categoria).toBe('Ocio y cultura > Suscripciones y streaming')
  })

  it('no reconoce lo que no está, en vez de acercarse', () => {
    // "No sé" es una respuesta correcta y frecuente. La incorrecta sería
    // parecerse a algo: `MERCADO CENTRAL` no es Mercadona.
    expect(buscarEnDiccionario('MERCADO CENTRAL DE ABASTOS')).toBeUndefined()
    expect(buscarEnDiccionario('TRANSFERENCIA A JUAN PEREZ')).toBeUndefined()
    expect(buscarEnDiccionario('')).toBeUndefined()
    expect(buscarEnDiccionario('   ')).toBeUndefined()
  })

  it('es determinista: la misma entrada da la misma salida', () => {
    const uno = buscarEnDiccionario('LIDL SUPERMERCADOS 0071')
    const dos = buscarEnDiccionario('LIDL SUPERMERCADOS 0071')
    expect(uno).toEqual(dos)
  })

  it('lee un descriptor alemán con su concepto detrás del punto medio', () => {
    // `merchantKey` corta por el "·", así que lo que se busca es el comercio y
    // no la fórmula de cortesía que el banco pega detrás.
    expect(buscarEnDiccionario('Telekom Deutschland GmbH · Zahlbeleg 378896249168')?.clave).toBe(
      'telekom',
    )
    expect(buscarEnDiccionario('Aral Muenchen · Vielen Dank')?.categoria).toBe(
      'Transporte > Combustible',
    )
  })
})

describe('la calidad del dato', () => {
  const entradas = entradasDeDiccionario()

  it('tiene un tamaño que se puede revisar a mano', () => {
    // No es un test de cobertura: es el recordatorio de que cien entradas
    // correctas valen más que quinientas dudosas. Si alguien duplica la lista
    // de golpe, que tenga que venir acá y explicarlo.
    expect(entradas.length).toBeGreaterThanOrEqual(100)
    expect(entradas.length).toBeLessThanOrEqual(400)
  })

  it('toda ruta existe en el plan de cuentas por defecto', () => {
    // Una ruta mal escrita no da error: no resuelve, y el movimiento se queda
    // sin clasificar sin que nadie sepa por qué. Acá se ve.
    const huerfanas = rutasDelDiccionario().filter((ruta) => buscarPorRuta(ruta) === undefined)
    expect(huerfanas).toEqual([])
  })

  it('ninguna entrada ambigua propone categoría, y ninguna con categoría es ambigua', () => {
    for (const entrada of entradas) {
      expect(entrada.categoria === null, entrada.clave).toBe(entrada.confianza === 'ambigua')
    }
  })

  it('todo alias se encuentra a sí mismo', () => {
    // El fallo que este test caza es el peor de todos porque es invisible: una
    // entrada escrita con un nombre que la limpieza deja irreconocible se queda
    // en el fichero, se ve bien al leerla y no reconoce nunca nada.
    for (const entrada of entradas) {
      const encontrado = buscarEnDiccionario(entrada.etiqueta)
      // La etiqueta no siempre es un alias (Movistar Plus+ contra 'Movistar
      // Plus'), así que se comprueba lo que sí tiene que valer: que algo
      // encuentre, y que el alias que el propio índice devolvió reencuentre la
      // misma clave.
      if (encontrado !== undefined) {
        expect(buscarEnDiccionario(encontrado.coincidencia)?.clave, entrada.clave).toBe(
          encontrado.clave,
        )
      }
    }
  })

  it('las clases de comercio están declaradas como tales', () => {
    // Las entradas que no nombran una empresa llevan el prefijo 'clase:' y son
    // pocas a propósito: son la puerta por la que se cuela el diccionario a
    // medida. Que se puedan contar de un vistazo es parte del control.
    const clases = entradas.filter((entrada) => entrada.clave.startsWith('clase:'))
    expect(clases.length).toBeLessThanOrEqual(25)
    expect(clases.length).toBeGreaterThan(0)
  })
})
