/**
 * Comercios alemanes.
 *
 * Están porque el corpus con el que se prueba el motor es alemán, y un
 * diccionario que sólo habla español no diría nada sobre él. Valen las mismas
 * reglas que en España, con dos avisos propios:
 *
 *  · **Los nombres de ejemplo del corpus NO están.** "Max Mustermann", "VB
 *    Musterstadt", "Braumüller GmbH" y compañía son el equivalente alemán de
 *    "Juan Pérez": no son comercios, son relleno de un fichero de muestra.
 *    Meterlos haría que la demo clasificara más y que el producto no supiera
 *    nada. Lo que sí está son las cadenas de verdad que aparecen al lado —Aldi,
 *    Lidl, Telekom, Deutsche Bahn, Aral, Allianz—, que son las que un hogar
 *    alemán tiene de verdad en su extracto.
 *
 *  · **E.ON no se puede reconocer.** "E.ON" se compacta a "EON" cuando lleva
 *    los dos puntos, pero llega también como "E.ON Energie" y como "E ON", y
 *    entonces queda una letra suelta que no distingue nada. Le pasa lo mismo a
 *    1&1. Quedan anotados para que no se vuelvan a intentar; el arreglo, si
 *    hace falta, es por el nombre legal completo.
 */

import type { Comercio } from './tipos.js'

export const COMERCIOS_DE: readonly Comercio[] = [
  // ── Supermercados y droguerías ────────────────────────────────────────────
  {
    // Sólo 'Aldi': "Aldi Süd" y "Aldi Sued" son la misma cadena escrita de dos
    // formas y un alias con la región no reconocería más que ésa.
    clave: 'aldi',
    etiqueta: 'Aldi',
    alias: ['Aldi'],
    categoria: 'Día a día > Supermercado',
    confianza: 'alta',
  },
  {
    clave: 'lidl',
    etiqueta: 'Lidl',
    alias: ['Lidl'],
    categoria: 'Día a día > Supermercado',
    confianza: 'alta',
  },
  {
    clave: 'rewe',
    etiqueta: 'REWE',
    alias: ['REWE'],
    categoria: 'Día a día > Supermercado',
    pais: 'DE',
    confianza: 'alta',
  },
  {
    clave: 'edeka',
    etiqueta: 'Edeka',
    alias: ['Edeka'],
    categoria: 'Día a día > Supermercado',
    pais: 'DE',
    confianza: 'alta',
  },
  {
    clave: 'penny',
    etiqueta: 'Penny',
    alias: ['Penny Markt'],
    categoria: 'Día a día > Supermercado',
    pais: 'DE',
    confianza: 'alta',
  },
  {
    clave: 'netto-marken-discount',
    etiqueta: 'Netto Marken-Discount',
    alias: ['Netto Marken Discount'],
    categoria: 'Día a día > Supermercado',
    pais: 'DE',
    confianza: 'alta',
  },
  {
    clave: 'kaufland',
    etiqueta: 'Kaufland',
    alias: ['Kaufland'],
    categoria: 'Día a día > Supermercado',
    pais: 'DE',
    confianza: 'media',
  },
  {
    clave: 'tengelmann',
    etiqueta: 'Tengelmann',
    alias: ['Tengelmann'],
    categoria: 'Día a día > Supermercado',
    pais: 'DE',
    confianza: 'alta',
  },
  {
    clave: 'dm-drogerie',
    etiqueta: 'dm-drogerie markt',
    alias: ['dm Drogerie'],
    categoria: 'Día a día > Cuidado personal',
    pais: 'DE',
    confianza: 'alta',
  },
  {
    clave: 'rossmann',
    etiqueta: 'Rossmann',
    alias: ['Rossmann'],
    categoria: 'Día a día > Cuidado personal',
    pais: 'DE',
    confianza: 'alta',
  },

  // ── Energía ───────────────────────────────────────────────────────────────
  {
    clave: 'vattenfall',
    etiqueta: 'Vattenfall',
    alias: ['Vattenfall'],
    categoria: 'Vivienda > Suministros > Luz y gas',
    pais: 'DE',
    confianza: 'alta',
  },
  {
    clave: 'yello-strom',
    etiqueta: 'Yello Strom',
    alias: ['Yello Strom'],
    categoria: 'Vivienda > Suministros > Luz y gas',
    pais: 'DE',
    confianza: 'alta',
  },
  {
    clave: 'rwe',
    etiqueta: 'RWE',
    alias: ['RWE'],
    categoria: 'Vivienda > Suministros > Luz y gas',
    pais: 'DE',
    confianza: 'alta',
  },
  {
    // Los Stadtwerke municipales facturan luz, gas, agua y a veces el autobús
    // en el mismo recibo, y en el árbol ésas son hojas distintas. Lo que se
    // puede afirmar es la rama: 'Suministros'.
    clave: 'stadtwerke',
    etiqueta: 'Stadtwerke',
    alias: ['Stadtwerke'],
    categoria: 'Vivienda > Suministros',
    pais: 'DE',
    confianza: 'media',
  },

  // ── Telecomunicaciones ────────────────────────────────────────────────────
  {
    clave: 'telekom',
    etiqueta: 'Telekom Deutschland',
    alias: ['Telekom'],
    categoria: 'Vivienda > Suministros > Internet y telefonía',
    pais: 'DE',
    confianza: 'alta',
  },
  {
    clave: 'congstar',
    etiqueta: 'congstar',
    alias: ['congstar'],
    categoria: 'Vivienda > Suministros > Internet y telefonía',
    pais: 'DE',
    confianza: 'alta',
  },

  // ── Transporte ────────────────────────────────────────────────────────────
  {
    // Como Renfe: el abono de cercanías y el ICE a Berlín llevan el mismo
    // nombre.
    clave: 'deutsche-bahn',
    etiqueta: 'Deutsche Bahn',
    alias: ['Deutsche Bahn', 'DB Vertrieb', 'DB Fernverkehr'],
    categoria: 'Transporte > Transporte público',
    pais: 'DE',
    confianza: 'media',
  },
  {
    clave: 'bvg',
    etiqueta: 'BVG',
    alias: ['BVG', 'Berliner Verkehrsbetriebe'],
    categoria: 'Transporte > Transporte público',
    pais: 'DE',
    confianza: 'alta',
  },
  {
    clave: 'mvg-muenchen',
    etiqueta: 'MVG München',
    alias: ['MVG'],
    categoria: 'Transporte > Transporte público',
    pais: 'DE',
    confianza: 'alta',
  },
  {
    clave: 'hvv',
    etiqueta: 'HVV',
    alias: ['HVV'],
    categoria: 'Transporte > Transporte público',
    pais: 'DE',
    confianza: 'alta',
  },

  // ── Combustible ───────────────────────────────────────────────────────────
  {
    clave: 'aral',
    etiqueta: 'Aral',
    alias: ['Aral'],
    categoria: 'Transporte > Combustible',
    pais: 'DE',
    confianza: 'alta',
  },
  {
    clave: 'jet',
    etiqueta: 'JET',
    alias: ['JET Tankstelle'],
    categoria: 'Transporte > Combustible',
    pais: 'DE',
    confianza: 'alta',
  },
  {
    clave: 'esso',
    etiqueta: 'Esso',
    alias: ['Esso'],
    categoria: 'Transporte > Combustible',
    confianza: 'alta',
  },
  {
    clave: 'agip',
    etiqueta: 'Agip',
    alias: ['Agip'],
    categoria: 'Transporte > Combustible',
    confianza: 'alta',
  },
  {
    clave: 'total-tankstelle',
    etiqueta: 'TotalEnergies',
    alias: ['Total Tankstelle', 'TotalEnergies Tankstelle'],
    categoria: 'Transporte > Combustible',
    pais: 'DE',
    confianza: 'alta',
  },

  // ── Vehículo ──────────────────────────────────────────────────────────────
  {
    // BMW Leasing GmbH sólo financia vehículos, así que el cargo es la cuota.
    // "BMW" a secas no entra: puede ser el concesionario, el taller o el coche.
    clave: 'bmw-leasing',
    etiqueta: 'BMW Leasing',
    alias: ['BMW Leasing'],
    categoria: 'Transporte > Alquiler y renting',
    pais: 'DE',
    confianza: 'alta',
  },
  {
    // El TÜV certifica ascensores y calderas además de coches, pero en el
    // extracto de una familia es la inspección del coche: media. Los dos alias
    // son las dos formas en que llega el nombre —con diéresis y transliterado—
    // y dan tokens distintos.
    clave: 'tuev',
    etiqueta: 'TÜV',
    alias: ['TÜV', 'TUEV'],
    categoria: 'Transporte > Mantenimiento y taller',
    pais: 'DE',
    confianza: 'media',
  },
  {
    clave: 'dekra',
    etiqueta: 'Dekra',
    alias: ['Dekra'],
    categoria: 'Transporte > Mantenimiento y taller',
    pais: 'DE',
    confianza: 'media',
  },
  {
    clave: 'adac',
    etiqueta: 'ADAC',
    alias: ['ADAC'],
    categoria: 'Transporte > Mantenimiento y taller',
    pais: 'DE',
    confianza: 'media',
  },

  // ── Seguros y cajas de enfermedad ─────────────────────────────────────────
  {
    clave: 'allianz',
    etiqueta: 'Allianz',
    alias: ['Allianz'],
    categoria: null,
    confianza: 'ambigua',
  },
  {
    clave: 'huk-coburg',
    etiqueta: 'HUK-COBURG',
    alias: ['HUK Coburg'],
    categoria: null,
    pais: 'DE',
    confianza: 'ambigua',
  },
  {
    clave: 'debeka',
    etiqueta: 'Debeka',
    alias: ['Debeka'],
    categoria: null,
    pais: 'DE',
    confianza: 'ambigua',
  },
  {
    clave: 'aok',
    etiqueta: 'AOK',
    alias: ['AOK'],
    categoria: 'Seguros > Seguro de salud',
    pais: 'DE',
    confianza: 'alta',
  },
  {
    clave: 'techniker-krankenkasse',
    etiqueta: 'Techniker Krankenkasse',
    alias: ['Techniker Krankenkasse'],
    categoria: 'Seguros > Seguro de salud',
    pais: 'DE',
    confianza: 'alta',
  },
  {
    clave: 'barmer',
    etiqueta: 'Barmer',
    alias: ['Barmer'],
    categoria: 'Seguros > Seguro de salud',
    pais: 'DE',
    confianza: 'alta',
  },
  {
    clave: 'dak-gesundheit',
    etiqueta: 'DAK-Gesundheit',
    alias: ['DAK Gesundheit'],
    categoria: 'Seguros > Seguro de salud',
    pais: 'DE',
    confianza: 'alta',
  },

  // ── Bricolaje y hogar ─────────────────────────────────────────────────────
  {
    clave: 'hornbach',
    etiqueta: 'Hornbach',
    alias: ['Hornbach'],
    categoria: 'Vivienda > Mantenimiento y reparaciones',
    confianza: 'media',
  },
  {
    clave: 'obi',
    etiqueta: 'OBI',
    alias: ['OBI Baumarkt', 'OBI Markt'],
    categoria: 'Vivienda > Mantenimiento y reparaciones',
    confianza: 'media',
  },
  {
    clave: 'bauhaus',
    etiqueta: 'Bauhaus',
    alias: ['Bauhaus'],
    categoria: 'Vivienda > Mantenimiento y reparaciones',
    confianza: 'media',
  },
  {
    clave: 'toom',
    etiqueta: 'toom Baumarkt',
    alias: ['toom Baumarkt'],
    categoria: 'Vivienda > Mantenimiento y reparaciones',
    pais: 'DE',
    confianza: 'media',
  },
  {
    clave: 'hagebaumarkt',
    etiqueta: 'hagebaumarkt',
    alias: ['hagebaumarkt'],
    categoria: 'Vivienda > Mantenimiento y reparaciones',
    pais: 'DE',
    confianza: 'media',
  },

  // ── Electrónica ───────────────────────────────────────────────────────────
  {
    clave: 'saturn',
    etiqueta: 'Saturn',
    alias: ['Saturn Electro', 'Saturn Markt'],
    categoria: 'Día a día > Compras generales',
    pais: 'DE',
    confianza: 'alta',
  },
  {
    clave: 'conrad',
    etiqueta: 'Conrad Electronic',
    alias: ['Conrad Electronic'],
    categoria: 'Día a día > Compras generales',
    pais: 'DE',
    confianza: 'alta',
  },

  // ── Televisión pública ────────────────────────────────────────────────────
  {
    clave: 'rundfunkbeitrag',
    etiqueta: 'Rundfunkbeitrag',
    alias: ['Rundfunkbeitrag', 'Beitragsservice'],
    categoria: 'Ocio y cultura > Suscripciones y streaming',
    pais: 'DE',
    confianza: 'alta',
  },

  // ── Banca ─────────────────────────────────────────────────────────────────
  // Ambiguos por el mismo motivo que los españoles: el banco no dice qué se
  // pagó.
  {
    clave: 'deutsche-bank',
    etiqueta: 'Deutsche Bank',
    alias: ['Deutsche Bank'],
    categoria: null,
    pais: 'DE',
    confianza: 'ambigua',
  },
  {
    clave: 'commerzbank',
    etiqueta: 'Commerzbank',
    alias: ['Commerzbank'],
    categoria: null,
    pais: 'DE',
    confianza: 'ambigua',
  },
  {
    clave: 'sparkasse',
    etiqueta: 'Sparkasse',
    alias: ['Sparkasse'],
    categoria: null,
    pais: 'DE',
    confianza: 'ambigua',
  },
  {
    clave: 'volksbank',
    etiqueta: 'Volksbank',
    alias: ['Volksbank'],
    categoria: null,
    pais: 'DE',
    confianza: 'ambigua',
  },
  {
    clave: 'dkb',
    etiqueta: 'DKB',
    alias: ['DKB'],
    categoria: null,
    pais: 'DE',
    confianza: 'ambigua',
  },
  {
    clave: 'postbank',
    etiqueta: 'Postbank',
    alias: ['Postbank'],
    categoria: null,
    pais: 'DE',
    confianza: 'ambigua',
  },
  {
    clave: 'comdirect',
    etiqueta: 'comdirect',
    alias: ['comdirect'],
    categoria: null,
    pais: 'DE',
    confianza: 'ambigua',
  },
  {
    clave: 'dab-bank',
    etiqueta: 'DAB Bank',
    alias: ['DAB Bank'],
    categoria: null,
    pais: 'DE',
    confianza: 'ambigua',
  },
]
