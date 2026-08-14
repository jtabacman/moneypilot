/**
 * Comercios españoles.
 *
 * El criterio de admisión, que importa más que el tamaño de la lista:
 *
 *  · **Sólo comercios que existen.** Ni uno inventado. Un diccionario con un
 *    comercio de mentira no falla: acierta en la demo y se equivoca en casa del
 *    cliente, que es la peor forma de fallar.
 *  · **La confianza se gana.** `alta` sólo cuando el comercio determina la
 *    categoría él solo. Iberdrola es luz siempre. Repsol es combustible casi
 *    siempre, pero también factura luz y gas: `media`. El Corte Inglés no es
 *    ninguna categoría: `ambigua`.
 *  · **Las rutas son las del árbol por defecto** (`ARBOL_POR_DEFECTO`), para
 *    que resuelvan contra cuentas que el hogar ya tiene en vez de proponerle un
 *    plan nuevo. Hay un test que lo comprueba entrada por entrada.
 *
 * ── Un comercio que este sistema no reconoce ────────────────────────────────
 *
 * H&M no está. `merchantKey('H&M')` deja dos tokens de una letra —"H" y "M"— y
 * exigir esos dos sueltos reconocería medio extracto. Queda escrito acá para
 * que el próximo que lo busque no lo vuelva a buscar; la solución, si hace
 * falta, es un alias con el nombre legal ("Hennes & Mauritz") el día que se vea
 * en un descriptor de verdad.
 */

import type { Comercio } from './tipos.js'

export const COMERCIOS_ES: readonly Comercio[] = [
  // ── Energía ───────────────────────────────────────────────────────────────
  // La luz y el gas comparten hoja en el árbol, así que las comercializadoras
  // que venden las dos cosas —Naturgy, EDP— no pierden confianza por eso: la
  // ruta es la misma vendan lo que vendan.
  {
    clave: 'iberdrola',
    etiqueta: 'Iberdrola',
    alias: ['Iberdrola'],
    categoria: 'Vivienda > Suministros > Luz y gas',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'endesa',
    etiqueta: 'Endesa',
    alias: ['Endesa'],
    categoria: 'Vivienda > Suministros > Luz y gas',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'naturgy',
    etiqueta: 'Naturgy',
    alias: ['Naturgy', 'Gas Natural Fenosa'],
    categoria: 'Vivienda > Suministros > Luz y gas',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'holaluz',
    etiqueta: 'Holaluz',
    alias: ['Holaluz'],
    categoria: 'Vivienda > Suministros > Luz y gas',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'som-energia',
    etiqueta: 'Som Energia',
    alias: ['Som Energia'],
    categoria: 'Vivienda > Suministros > Luz y gas',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'edp',
    etiqueta: 'EDP',
    alias: ['EDP Energia', 'EDP Comercializadora'],
    categoria: 'Vivienda > Suministros > Luz y gas',
    confianza: 'alta',
  },
  {
    // Más específico que 'Repsol' —cuatro tokens contra uno—, así que la
    // factura de la luz no se lee como un depósito de gasolina.
    clave: 'repsol-luz-y-gas',
    etiqueta: 'Repsol Luz y Gas',
    alias: ['Repsol Luz y Gas'],
    categoria: 'Vivienda > Suministros > Luz y gas',
    pais: 'ES',
    confianza: 'alta',
  },

  // ── Agua ──────────────────────────────────────────────────────────────────
  // El agua es municipal: no hay marca nacional, sino las operadoras de las
  // áreas metropolitanas grandes.
  {
    clave: 'canal-isabel-ii',
    etiqueta: 'Canal de Isabel II',
    alias: ['Canal de Isabel II'],
    categoria: 'Vivienda > Suministros > Agua',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'aigues-de-barcelona',
    etiqueta: 'Aigües de Barcelona',
    alias: ['Aigües de Barcelona'],
    categoria: 'Vivienda > Suministros > Agua',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'emasesa',
    etiqueta: 'Emasesa',
    alias: ['Emasesa'],
    categoria: 'Vivienda > Suministros > Agua',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'hidralia',
    etiqueta: 'Hidralia',
    alias: ['Hidralia'],
    categoria: 'Vivienda > Suministros > Agua',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'aguas-de-valencia',
    etiqueta: 'Aguas de Valencia',
    alias: ['Aguas de Valencia', 'Global Omnium'],
    categoria: 'Vivienda > Suministros > Agua',
    pais: 'ES',
    confianza: 'alta',
  },

  // ── Telecomunicaciones ────────────────────────────────────────────────────
  {
    clave: 'movistar',
    etiqueta: 'Movistar',
    alias: ['Movistar'],
    categoria: 'Vivienda > Suministros > Internet y telefonía',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    // Dos tokens contra uno: cuando el descriptor dice "Plus", gana la
    // televisión y no la línea de teléfono.
    clave: 'movistar-plus',
    etiqueta: 'Movistar Plus+',
    alias: ['Movistar Plus'],
    categoria: 'Ocio y cultura > Suscripciones y streaming',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'telefonica',
    etiqueta: 'Telefónica',
    alias: ['Telefónica'],
    categoria: 'Vivienda > Suministros > Internet y telefonía',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'orange',
    etiqueta: 'Orange',
    alias: ['Orange'],
    categoria: 'Vivienda > Suministros > Internet y telefonía',
    confianza: 'alta',
  },
  {
    clave: 'yoigo',
    etiqueta: 'Yoigo',
    alias: ['Yoigo'],
    categoria: 'Vivienda > Suministros > Internet y telefonía',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'masmovil',
    etiqueta: 'MásMóvil',
    alias: ['MásMóvil'],
    categoria: 'Vivienda > Suministros > Internet y telefonía',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'digi',
    etiqueta: 'Digi',
    alias: ['Digi Spain', 'Digi Mobil'],
    categoria: 'Vivienda > Suministros > Internet y telefonía',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'pepephone',
    etiqueta: 'Pepephone',
    alias: ['Pepephone'],
    categoria: 'Vivienda > Suministros > Internet y telefonía',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'jazztel',
    etiqueta: 'Jazztel',
    alias: ['Jazztel'],
    categoria: 'Vivienda > Suministros > Internet y telefonía',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'lowi',
    etiqueta: 'Lowi',
    alias: ['Lowi'],
    categoria: 'Vivienda > Suministros > Internet y telefonía',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'simyo',
    etiqueta: 'Simyo',
    alias: ['Simyo'],
    categoria: 'Vivienda > Suministros > Internet y telefonía',
    pais: 'ES',
    confianza: 'alta',
  },

  // ── Supermercados ─────────────────────────────────────────────────────────
  {
    clave: 'mercadona',
    etiqueta: 'Mercadona',
    alias: ['Mercadona'],
    categoria: 'Día a día > Supermercado',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    // Los formatos de barrio son alimentación pura; el hipermercado no, y por
    // eso va aparte y con menos confianza.
    clave: 'carrefour-express',
    etiqueta: 'Carrefour Express',
    alias: ['Carrefour Express', 'Carrefour Market'],
    categoria: 'Día a día > Supermercado',
    confianza: 'alta',
  },
  {
    clave: 'carrefour',
    etiqueta: 'Carrefour',
    alias: ['Carrefour'],
    categoria: 'Día a día > Supermercado',
    confianza: 'media',
  },
  {
    clave: 'alcampo',
    etiqueta: 'Alcampo',
    alias: ['Alcampo'],
    categoria: 'Día a día > Supermercado',
    pais: 'ES',
    confianza: 'media',
  },
  {
    clave: 'eroski',
    etiqueta: 'Eroski',
    alias: ['Eroski'],
    categoria: 'Día a día > Supermercado',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'consum',
    etiqueta: 'Consum',
    alias: ['Consum'],
    categoria: 'Día a día > Supermercado',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'ahorramas',
    etiqueta: 'Ahorramas',
    alias: ['Ahorramas'],
    categoria: 'Día a día > Supermercado',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'caprabo',
    etiqueta: 'Caprabo',
    alias: ['Caprabo'],
    categoria: 'Día a día > Supermercado',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'condis',
    etiqueta: 'Condis',
    alias: ['Condis'],
    categoria: 'Día a día > Supermercado',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'bonpreu',
    etiqueta: 'Bonpreu Esclat',
    alias: ['Bonpreu', 'Esclat'],
    categoria: 'Día a día > Supermercado',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'gadis',
    etiqueta: 'Gadis',
    alias: ['Gadis'],
    categoria: 'Día a día > Supermercado',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'alimerka',
    etiqueta: 'Alimerka',
    alias: ['Alimerka'],
    categoria: 'Día a día > Supermercado',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'supercor',
    etiqueta: 'Supercor',
    alias: ['Supercor'],
    categoria: 'Día a día > Supermercado',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'hipercor',
    etiqueta: 'Hipercor',
    alias: ['Hipercor'],
    categoria: 'Día a día > Supermercado',
    pais: 'ES',
    confianza: 'media',
  },
  {
    // Dia entra sólo con el nombre largo. "DIA" suelto es una palabra corriente
    // en un descriptor español —"PAGO DIA 15"— y reconocer un supermercado ahí
    // mandaría a la compra semanal cualquier cosa.
    clave: 'dia',
    etiqueta: 'Dia',
    alias: ['Supermercados Dia', 'Dia Maxi'],
    categoria: 'Día a día > Supermercado',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    // El caso del enunciado: en El Corte Inglés se compra un abrigo, un
    // lavavajillas y la cena. Poner una categoría acá sería inventarla.
    clave: 'el-corte-ingles',
    etiqueta: 'El Corte Inglés',
    alias: ['El Corte Inglés'],
    categoria: null,
    pais: 'ES',
    confianza: 'ambigua',
  },

  // ── Combustible y vehículo ────────────────────────────────────────────────
  {
    // Repsol y Cepsa venden también luz y gas, y con el mismo nombre: media.
    // BP y Shell no tienen comercializadora doméstica en España, así que su
    // cargo sólo puede ser combustible.
    clave: 'repsol',
    etiqueta: 'Repsol',
    alias: ['Repsol'],
    categoria: 'Transporte > Combustible',
    pais: 'ES',
    confianza: 'media',
  },
  {
    clave: 'cepsa',
    etiqueta: 'Cepsa',
    alias: ['Cepsa'],
    categoria: 'Transporte > Combustible',
    pais: 'ES',
    confianza: 'media',
  },
  {
    clave: 'bp',
    etiqueta: 'BP',
    alias: ['BP'],
    categoria: 'Transporte > Combustible',
    confianza: 'alta',
  },
  {
    clave: 'galp',
    etiqueta: 'Galp',
    alias: ['Galp'],
    categoria: 'Transporte > Combustible',
    confianza: 'media',
  },
  {
    clave: 'ballenoil',
    etiqueta: 'Ballenoil',
    alias: ['Ballenoil'],
    categoria: 'Transporte > Combustible',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'plenoil',
    etiqueta: 'Plenoil',
    alias: ['Plenoil'],
    categoria: 'Transporte > Combustible',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'petroprix',
    etiqueta: 'Petroprix',
    alias: ['Petroprix'],
    categoria: 'Transporte > Combustible',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'empark',
    etiqueta: 'Empark',
    alias: ['Empark'],
    categoria: 'Transporte > Peajes y aparcamiento',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'saba-aparcamientos',
    etiqueta: 'Saba',
    alias: ['Saba Aparcamientos'],
    categoria: 'Transporte > Peajes y aparcamiento',
    pais: 'ES',
    confianza: 'alta',
  },

  // ── Transporte público y VTC ──────────────────────────────────────────────
  {
    // El AVE a Sevilla es un viaje y el abono de cercanías es el día a día, y
    // los dos dicen "RENFE": media.
    clave: 'renfe',
    etiqueta: 'Renfe',
    alias: ['Renfe'],
    categoria: 'Transporte > Transporte público',
    pais: 'ES',
    confianza: 'media',
  },
  {
    clave: 'metro-de-madrid',
    etiqueta: 'Metro de Madrid',
    alias: ['Metro de Madrid'],
    categoria: 'Transporte > Transporte público',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'emt-madrid',
    etiqueta: 'EMT Madrid',
    alias: ['EMT Madrid'],
    categoria: 'Transporte > Transporte público',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'tmb',
    etiqueta: 'TMB',
    alias: ['TMB', 'Transports Metropolitans de Barcelona'],
    categoria: 'Transporte > Transporte público',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'crtm',
    etiqueta: 'Consorcio Regional de Transportes',
    alias: ['Consorcio Regional de Transportes'],
    categoria: 'Transporte > Transporte público',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'cabify',
    etiqueta: 'Cabify',
    alias: ['Cabify'],
    categoria: 'Transporte > Taxis y VTC',
    confianza: 'alta',
  },
  {
    clave: 'free-now',
    etiqueta: 'FREE NOW',
    alias: ['Free Now', 'FreeNow'],
    categoria: 'Transporte > Taxis y VTC',
    confianza: 'alta',
  },

  // ── Seguros ───────────────────────────────────────────────────────────────
  // Los multirramo van como ambiguos y no es pereza: Mapfre vende el coche, la
  // casa, la salud y el plan de pensiones con el mismo nombre en el descriptor.
  // Cuál de los cinco es lo dice el recibo, que el diccionario no ve.
  {
    clave: 'mapfre',
    etiqueta: 'Mapfre',
    alias: ['Mapfre'],
    categoria: null,
    pais: 'ES',
    confianza: 'ambigua',
  },
  {
    clave: 'catalana-occidente',
    etiqueta: 'Occident',
    alias: ['Catalana Occidente', 'Occident Seguros'],
    categoria: null,
    pais: 'ES',
    confianza: 'ambigua',
  },
  {
    clave: 'mutua-madrilena',
    etiqueta: 'Mutua Madrileña',
    alias: ['Mutua Madrileña'],
    categoria: 'Seguros > Seguro de vehículos',
    pais: 'ES',
    confianza: 'media',
  },
  {
    clave: 'linea-directa',
    etiqueta: 'Línea Directa',
    alias: ['Línea Directa'],
    categoria: 'Seguros > Seguro de vehículos',
    pais: 'ES',
    confianza: 'media',
  },
  {
    clave: 'verti',
    etiqueta: 'Verti',
    alias: ['Verti Seguros'],
    categoria: 'Seguros > Seguro de vehículos',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'sanitas',
    etiqueta: 'Sanitas',
    alias: ['Sanitas'],
    categoria: 'Seguros > Seguro de salud',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'adeslas',
    etiqueta: 'Adeslas',
    alias: ['Adeslas'],
    categoria: 'Seguros > Seguro de salud',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'asisa',
    etiqueta: 'Asisa',
    alias: ['Asisa'],
    categoria: 'Seguros > Seguro de salud',
    pais: 'ES',
    confianza: 'alta',
  },

  // ── Salud ─────────────────────────────────────────────────────────────────
  {
    clave: 'quironsalud',
    etiqueta: 'Quirónsalud',
    alias: ['Quirónsalud', 'Hospital Quirón'],
    categoria: 'Salud > Médicos y clínicas',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'vithas',
    etiqueta: 'Vithas',
    alias: ['Vithas'],
    categoria: 'Salud > Médicos y clínicas',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'hm-hospitales',
    etiqueta: 'HM Hospitales',
    alias: ['HM Hospitales'],
    categoria: 'Salud > Médicos y clínicas',
    pais: 'ES',
    confianza: 'alta',
  },

  // ── Restauración y comida a domicilio ─────────────────────────────────────
  {
    // Glovo reparte la cena, pero también la compra del súper y una farmacia de
    // guardia: media.
    clave: 'glovo',
    etiqueta: 'Glovo',
    alias: ['Glovo'],
    categoria: 'Día a día > Restaurantes y bares',
    confianza: 'media',
  },
  {
    clave: 'just-eat',
    etiqueta: 'Just Eat',
    alias: ['Just Eat'],
    categoria: 'Día a día > Restaurantes y bares',
    confianza: 'alta',
  },
  {
    clave: 'deliveroo',
    etiqueta: 'Deliveroo',
    alias: ['Deliveroo'],
    categoria: 'Día a día > Restaurantes y bares',
    confianza: 'alta',
  },
  {
    clave: 'telepizza',
    etiqueta: 'Telepizza',
    alias: ['Telepizza'],
    categoria: 'Día a día > Restaurantes y bares',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'goiko',
    etiqueta: 'Goiko',
    alias: ['Goiko'],
    categoria: 'Día a día > Restaurantes y bares',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'rodilla',
    etiqueta: 'Rodilla',
    alias: ['Rodilla'],
    categoria: 'Día a día > Restaurantes y bares',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'pans-and-company',
    etiqueta: 'Pans & Company',
    alias: ['Pans & Company'],
    categoria: 'Día a día > Restaurantes y bares',
    pais: 'ES',
    confianza: 'alta',
  },

  // ── Compras ───────────────────────────────────────────────────────────────
  // Los almacenes de bricolaje son `media` porque cubren dos hojas distintas
  // del árbol: cambiar un grifo es mantenimiento y reformar el baño es obra. Se
  // propone la más frecuente y decide una persona.
  {
    clave: 'leroy-merlin',
    etiqueta: 'Leroy Merlin',
    alias: ['Leroy Merlin'],
    categoria: 'Vivienda > Mantenimiento y reparaciones',
    confianza: 'media',
  },
  {
    clave: 'bricomart',
    etiqueta: 'Bricomart',
    alias: ['Bricomart'],
    categoria: 'Vivienda > Mantenimiento y reparaciones',
    pais: 'ES',
    confianza: 'media',
  },
  {
    clave: 'brico-depot',
    etiqueta: 'Brico Depôt',
    alias: ['Brico Depot'],
    categoria: 'Vivienda > Mantenimiento y reparaciones',
    pais: 'ES',
    confianza: 'media',
  },
  {
    clave: 'media-markt',
    etiqueta: 'MediaMarkt',
    alias: ['MediaMarkt', 'Media Markt'],
    categoria: 'Día a día > Compras generales',
    confianza: 'alta',
  },
  {
    clave: 'pccomponentes',
    etiqueta: 'PcComponentes',
    alias: ['PcComponentes'],
    categoria: 'Día a día > Compras generales',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'fnac',
    etiqueta: 'Fnac',
    alias: ['Fnac'],
    categoria: 'Día a día > Compras generales',
    confianza: 'alta',
  },
  {
    clave: 'zara',
    etiqueta: 'Zara',
    alias: ['Zara'],
    categoria: 'Día a día > Ropa y calzado',
    confianza: 'alta',
  },
  {
    clave: 'massimo-dutti',
    etiqueta: 'Massimo Dutti',
    alias: ['Massimo Dutti'],
    categoria: 'Día a día > Ropa y calzado',
    confianza: 'alta',
  },
  {
    clave: 'bershka',
    etiqueta: 'Bershka',
    alias: ['Bershka'],
    categoria: 'Día a día > Ropa y calzado',
    confianza: 'alta',
  },
  {
    clave: 'stradivarius',
    etiqueta: 'Stradivarius',
    alias: ['Stradivarius'],
    categoria: 'Día a día > Ropa y calzado',
    confianza: 'alta',
  },
  {
    clave: 'pull-and-bear',
    etiqueta: 'Pull & Bear',
    alias: ['Pull & Bear'],
    categoria: 'Día a día > Ropa y calzado',
    confianza: 'alta',
  },
  {
    clave: 'mango',
    etiqueta: 'Mango',
    alias: ['Mango Shop', 'Punto FA'],
    categoria: 'Día a día > Ropa y calzado',
    confianza: 'alta',
  },
  {
    clave: 'primark',
    etiqueta: 'Primark',
    alias: ['Primark'],
    categoria: 'Día a día > Ropa y calzado',
    confianza: 'alta',
  },
  {
    clave: 'decathlon',
    etiqueta: 'Decathlon',
    alias: ['Decathlon'],
    categoria: 'Día a día > Ropa y calzado',
    confianza: 'media',
  },

  // ── Gimnasios ─────────────────────────────────────────────────────────────
  {
    clave: 'basic-fit',
    etiqueta: 'Basic-Fit',
    alias: ['Basic Fit'],
    categoria: 'Ocio y cultura > Deporte y gimnasio',
    confianza: 'alta',
  },
  {
    clave: 'altafit',
    etiqueta: 'Altafit',
    alias: ['Altafit'],
    categoria: 'Ocio y cultura > Deporte y gimnasio',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'vivagym',
    etiqueta: 'VivaGym',
    alias: ['VivaGym'],
    categoria: 'Ocio y cultura > Deporte y gimnasio',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'metropolitan',
    etiqueta: 'Metropolitan',
    alias: ['Club Metropolitan'],
    categoria: 'Ocio y cultura > Deporte y gimnasio',
    pais: 'ES',
    confianza: 'alta',
  },

  // ── Administración ────────────────────────────────────────────────────────
  {
    // La Agencia Tributaria cobra IRPF, sociedades, patrimonio y una multa: se
    // sabe que es un impuesto, no cuál. La raíz 'Impuestos' existe en el árbol
    // y es exactamente lo que se puede afirmar.
    clave: 'agencia-tributaria',
    etiqueta: 'Agencia Tributaria',
    alias: ['Agencia Tributaria', 'AEAT'],
    categoria: 'Impuestos',
    pais: 'ES',
    confianza: 'media',
  },
  {
    // La Tesorería cobra la cuota del autónomo, la del empleado de hogar y la
    // de la sociedad, y en el árbol son tres cuentas distintas y en tres ramas
    // distintas. Reconocerla y callarse es lo correcto.
    clave: 'tesoreria-seguridad-social',
    etiqueta: 'Seguridad Social',
    alias: ['Seguridad Social'],
    categoria: null,
    pais: 'ES',
    confianza: 'ambigua',
  },

  // ── Banca ─────────────────────────────────────────────────────────────────
  // Todos ambiguos, y es el resultado correcto. Un cargo con el nombre de tu
  // banco puede ser una comisión, la cuota de la hipoteca, el recibo de la
  // tarjeta o un traspaso a tu propia cuenta —que ni siquiera es un gasto—. Lo
  // que decide es el concepto, no la contraparte. Que estén acá sirve para lo
  // contrario de lo habitual: para que nadie los adivine.
  {
    clave: 'bbva',
    etiqueta: 'BBVA',
    alias: ['BBVA'],
    categoria: null,
    pais: 'ES',
    confianza: 'ambigua',
  },
  {
    clave: 'santander',
    etiqueta: 'Banco Santander',
    alias: ['Banco Santander'],
    categoria: null,
    pais: 'ES',
    confianza: 'ambigua',
  },
  {
    clave: 'caixabank',
    etiqueta: 'CaixaBank',
    alias: ['CaixaBank'],
    categoria: null,
    pais: 'ES',
    confianza: 'ambigua',
  },
  {
    clave: 'sabadell',
    etiqueta: 'Banco Sabadell',
    alias: ['Banco Sabadell'],
    categoria: null,
    pais: 'ES',
    confianza: 'ambigua',
  },
  {
    clave: 'bankinter',
    etiqueta: 'Bankinter',
    alias: ['Bankinter'],
    categoria: null,
    pais: 'ES',
    confianza: 'ambigua',
  },
  {
    clave: 'unicaja',
    etiqueta: 'Unicaja',
    alias: ['Unicaja'],
    categoria: null,
    pais: 'ES',
    confianza: 'ambigua',
  },
  {
    clave: 'abanca',
    etiqueta: 'Abanca',
    alias: ['Abanca'],
    categoria: null,
    pais: 'ES',
    confianza: 'ambigua',
  },
  {
    clave: 'kutxabank',
    etiqueta: 'Kutxabank',
    alias: ['Kutxabank'],
    categoria: null,
    pais: 'ES',
    confianza: 'ambigua',
  },
  {
    clave: 'ibercaja',
    etiqueta: 'Ibercaja',
    alias: ['Ibercaja'],
    categoria: null,
    pais: 'ES',
    confianza: 'ambigua',
  },
  {
    clave: 'openbank',
    etiqueta: 'Openbank',
    alias: ['Openbank'],
    categoria: null,
    pais: 'ES',
    confianza: 'ambigua',
  },
  {
    clave: 'cajamar',
    etiqueta: 'Cajamar',
    alias: ['Cajamar'],
    categoria: null,
    pais: 'ES',
    confianza: 'ambigua',
  },
  {
    // Bizum mueve dinero entre personas. Lo que se pagó con él no está en el
    // descriptor, y muchas veces ni siquiera es un gasto.
    clave: 'bizum',
    etiqueta: 'Bizum',
    alias: ['Bizum'],
    categoria: null,
    pais: 'ES',
    confianza: 'ambigua',
  },
]
