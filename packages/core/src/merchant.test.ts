import { describe, expect, it } from 'vitest'
import { canonicalMerchant, merchantKey, normalizarIban } from './merchant.js'

/** Un IBAN español con el dígito de control correcto. */
const IBAN_VALIDO = 'ES9121000418450200051332'

describe('agrupar lo que es el mismo comercio', () => {
  it('junta el mismo comercio con tres referencias distintas', () => {
    const claves = ['NETFLIX REF 8812', 'NETFLIX REF 9903', 'NETFLIX REF 1204'].map((description) =>
      canonicalMerchant({ description }),
    )
    expect(claves.map((comercio) => comercio.key)).toEqual(['NETFLIX', 'NETFLIX', 'NETFLIX'])
    expect(claves.every((comercio) => comercio.basis === 'descripcion')).toBe(true)
  })

  it('saca el comercio de entre la palabrería de la operación', () => {
    // El ejemplo del enunciado: palabra de operación, final de tarjeta y
    // referencia alrededor de lo único que identifica a quien cobró.
    expect(canonicalMerchant({ description: 'COMPRA TARJ 5432 IBERDROLA CLIENTE 887' })).toEqual({
      key: 'IBERDROLA',
      label: 'IBERDROLA',
      basis: 'descripcion',
      confidence: 0.75,
    })
  })

  it('ignora la forma jurídica: Hornbach AG y HORNBACH S.L. son Hornbach', () => {
    expect(merchantKey('Hornbach AG')).toBe('HORNBACH')
    expect(merchantKey('HORNBACH S.L.')).toBe('HORNBACH')
    expect(merchantKey('Hornbach')).toBe('HORNBACH')
    // Cadena de sufijos con su conector: se van los tres tokens.
    expect(merchantKey('Bankhaus Max Flessa und Co')).toBe('BANKHAUS MAX FLESSA')
    expect(merchantKey('Müller Handel GmbH & Co. KG')).toBe('MULLER HANDEL')
  })

  it('corta por el separador de composición: el concepto no es el comercio', () => {
    const largo = canonicalMerchant({ description: 'Aldi Sued · Vielen Dank für Ihren Einkauf' })
    const corto = canonicalMerchant({ description: 'Aldi Sued · Vielen Dank' })
    expect(largo.key).toBe('ALDI SUED')
    expect(corto.key).toBe(largo.key)
    // La etiqueta conserva las mayúsculas del original para poder enseñarla.
    expect(largo.label).toBe('Aldi Sued')
  })

  it('quita fechas embebidas, sucursales y códigos postales', () => {
    expect(merchantKey('MERCADONA 12/03/2024')).toBe('MERCADONA')
    expect(merchantKey('MERCADONA 2024-03-12')).toBe('MERCADONA')
    expect(merchantKey('Lidl Leopoldstr.')).toBe('LIDL')
    expect(merchantKey('Lidl Neuhauser Str.')).toBe('LIDL')
    expect(merchantKey('JET Tankstelle, Hohenlohe')).toBe('JET TANKSTELLE')
    expect(merchantKey('CARREFOUR 28001 MADRID')).toBe('CARREFOUR')
  })

  it('quita el número de tarjeta en las formas en que llega enmascarado', () => {
    expect(merchantKey('COMPRA ****1234 DECATHLON')).toBe('DECATHLON')
    expect(merchantKey('DECATHLON 4532XXXX1234')).toBe('DECATHLON')
    expect(merchantKey('DECATHLON XXXX 1234')).toBe('DECATHLON')
  })

  it('no distingue por acentos ni por mayúsculas', () => {
    expect(merchantKey('Gestoría Ferrer')).toBe('GESTORIA FERRER')
    expect(merchantKey('GESTORIA FERRER')).toBe('GESTORIA FERRER')
  })

  it('la etiqueta vuelve a producir la misma clave', () => {
    // Idempotencia: el diccionario guarda etiquetas y busca claves, así que
    // volver a canonicalizar lo ya canonicalizado no puede mover nada de sitio.
    const primera = canonicalMerchant({ description: 'COMPRA TARJ 5432 IBERDROLA CLIENTE 887' })
    expect(merchantKey(primera.label)).toBe(primera.key)
  })
})

describe('no fundir comercios distintos', () => {
  it('compartir una palabra no los hace el mismo negocio', () => {
    expect(merchantKey('Bar Centrale')).not.toBe(merchantKey('Bar Manolo'))
    expect(merchantKey('Hotel am Wasserturm')).not.toBe(merchantKey('Hotel Adlon'))
    expect(merchantKey('Cafe am Dom')).not.toBe(merchantKey('Cafe Glockenspiel'))
  })

  it('conserva los números cortos que son parte del nombre', () => {
    // Borrar todos los dígitos juntaría dos locales distintos en una sola clave.
    expect(merchantKey('STUDIO 54')).toBe('STUDIO 54')
    expect(merchantKey('STUDIO 33')).not.toBe(merchantKey('STUDIO 54'))
    expect(merchantKey('OPEN 24/7')).toBe('OPEN 24 7')
  })

  it('una referencia sin dígitos no se lleva por delante al comercio', () => {
    // La palabra 'REF' sólo arrastra lo que va detrás si empieza por un número.
    expect(merchantKey('REF IBERDROLA')).toBe('REF IBERDROLA')
  })
})

describe('de dónde sale la clave', () => {
  it('el IBAN manda sobre el nombre y sobre el texto', () => {
    const comercio = canonicalMerchant({
      description: 'ADEUDO SEPA RECIBO 998877',
      counterpartName: 'Iberdrola Clientes SAU',
      counterpartIban: IBAN_VALIDO,
    })
    expect(comercio.basis).toBe('iban')
    expect(comercio.key).toBe(`iban:${IBAN_VALIDO}`)
    expect(comercio.confidence).toBe(1)
    // La etiqueta sigue siendo legible: el IBAN es la clave, no lo que se enseña.
    expect(comercio.label).toBe('Iberdrola Clientes')
  })

  it('el mismo IBAN escrito de dos maneras es una sola clave', () => {
    const conEspacios = canonicalMerchant({
      description: 'x',
      counterpartIban: 'es91 2100 0418 4502 0005 1332',
    })
    expect(conEspacios.key).toBe(`iban:${IBAN_VALIDO}`)
    expect(normalizarIban('es91-2100-0418-4502-0005-1332')).toBe(IBAN_VALIDO)
  })

  it('un IBAN con el dígito de control roto sirve igual, con menos confianza', () => {
    // Sigue siendo estable —llega igual de mal en cada cargo—, así que agrupa.
    const comercio = canonicalMerchant({
      description: 'ADEUDO',
      counterpartIban: 'ES9921000418450200051332',
    })
    expect(comercio.basis).toBe('iban')
    expect(comercio.confidence).toBe(0.8)
  })

  it('lo que no tiene forma de IBAN no se toma por IBAN', () => {
    // Un campo mal mapeado no puede convertirse en la clave de un comercio.
    expect(normalizarIban('CUENTA PROPIA')).toBeNull()
    const comercio = canonicalMerchant({
      description: 'PAGO 12',
      counterpartName: 'Amazon Europe SA',
      counterpartIban: 'no-es-un-iban',
    })
    expect(comercio.basis).toBe('nombre')
    expect(comercio.key).toBe('AMAZON EUROPE')
  })

  it('el nombre de la entidad gana al enriquecimiento del agregador', () => {
    const comercio = canonicalMerchant({
      description: 'PURCHASE 4455',
      counterpartName: 'Amazon Europe SA',
      merchantName: 'Amazon',
    })
    expect(comercio.basis).toBe('nombre')
    expect(comercio.key).toBe('AMAZON EUROPE')
    expect(comercio.confidence).toBe(0.9)
  })

  it('cae al enriquecimiento sólo cuando la entidad no manda nombre', () => {
    const comercio = canonicalMerchant({ description: 'PURCHASE 4455', merchantName: 'Amazon' })
    expect(comercio).toEqual({
      key: 'AMAZON',
      label: 'Amazon',
      basis: 'nombre',
      confidence: 0.9,
    })
  })
})

describe('cuando no hay comercio', () => {
  it('devuelve la clave vacía en vez de inventar un cajón común', () => {
    // Con el descriptor entero por clave, todo lo ilegible del hogar acabaría
    // agrupado en un comercio que no existe.
    const comercio = canonicalMerchant({ description: 'COMPRA TARJ 5432' })
    expect(comercio).toEqual({ key: '', label: '', basis: 'descripcion', confidence: 0 })
    expect(canonicalMerchant({ description: '   ' }).key).toBe('')
  })

  it('avisa con menos confianza cuando sólo queda una sigla corta', () => {
    const comercio = canonicalMerchant({ description: 'COMPRA GA 470/11' })
    expect(comercio.key).toBe('GA')
    expect(comercio.confidence).toBe(0.5)
  })
})
