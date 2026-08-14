/**
 * Comercios sin país, y los dos países pequeños del corpus.
 *
 * Tres bloques:
 *
 *  1. **Internacionales.** Netflix cobra igual en Madrid que en Múnich, así que
 *     no llevan `pais`: no hay un sitio desde el que mirarlos.
 *  2. **Portugal y Estados Unidos.** Cinco y ocho entradas. Están porque el
 *     hogar de ejemplo tiene un piso en Lisboa y un apartamento en Miami, y
 *     porque un "Personal CFO" que no sabe leer un extracto de fuera del país
 *     no sirve para la familia que lo contrata justamente por eso.
 *  3. **Clases de comercio.** Ver la sección; es la parte que hay que mirar con
 *     más desconfianza y por eso está separada y explicada.
 *
 * Sobre las suscripciones de software: el árbol por defecto no tiene una hoja
 * para ellas y **no se le inventa una acá**. Todas caen en 'Ocio y cultura >
 * Suscripciones y streaming', que es literalmente lo que son, y las que igual
 * podrían ser gasto de la sociedad —las herramientas de trabajo— bajan a
 * `media` para que lo decida una persona.
 */

import type { Comercio } from './tipos.js'

export const COMERCIOS_INTERNACIONALES: readonly Comercio[] = [
  // ── Suscripciones y streaming ─────────────────────────────────────────────
  {
    clave: 'netflix',
    etiqueta: 'Netflix',
    alias: ['Netflix'],
    categoria: 'Ocio y cultura > Suscripciones y streaming',
    confianza: 'alta',
  },
  {
    clave: 'spotify',
    etiqueta: 'Spotify',
    alias: ['Spotify'],
    categoria: 'Ocio y cultura > Suscripciones y streaming',
    confianza: 'alta',
  },
  {
    clave: 'disney-plus',
    etiqueta: 'Disney+',
    alias: ['Disney Plus', 'DisneyPlus'],
    categoria: 'Ocio y cultura > Suscripciones y streaming',
    confianza: 'alta',
  },
  {
    clave: 'hbo-max',
    etiqueta: 'HBO Max',
    alias: ['HBO'],
    categoria: 'Ocio y cultura > Suscripciones y streaming',
    confianza: 'alta',
  },
  {
    clave: 'prime-video',
    etiqueta: 'Prime Video',
    alias: ['Prime Video'],
    categoria: 'Ocio y cultura > Suscripciones y streaming',
    confianza: 'alta',
  },
  {
    clave: 'dazn',
    etiqueta: 'DAZN',
    alias: ['DAZN'],
    categoria: 'Ocio y cultura > Suscripciones y streaming',
    confianza: 'alta',
  },
  {
    clave: 'filmin',
    etiqueta: 'Filmin',
    alias: ['Filmin'],
    categoria: 'Ocio y cultura > Suscripciones y streaming',
    confianza: 'alta',
  },
  {
    clave: 'audible',
    etiqueta: 'Audible',
    alias: ['Audible'],
    categoria: 'Ocio y cultura > Suscripciones y streaming',
    confianza: 'alta',
  },
  {
    clave: 'amazon-prime',
    etiqueta: 'Amazon Prime',
    alias: ['Amazon Prime'],
    categoria: 'Ocio y cultura > Suscripciones y streaming',
    confianza: 'alta',
  },
  {
    clave: 'apple-music',
    etiqueta: 'Apple Music',
    alias: ['Apple Music'],
    categoria: 'Ocio y cultura > Suscripciones y streaming',
    confianza: 'alta',
  },
  {
    clave: 'icloud',
    etiqueta: 'iCloud',
    alias: ['iCloud'],
    categoria: 'Ocio y cultura > Suscripciones y streaming',
    confianza: 'alta',
  },
  {
    clave: 'dropbox',
    etiqueta: 'Dropbox',
    alias: ['Dropbox'],
    categoria: 'Ocio y cultura > Suscripciones y streaming',
    confianza: 'alta',
  },
  {
    clave: 'microsoft-365',
    etiqueta: 'Microsoft 365',
    alias: ['Microsoft 365', 'Office 365'],
    categoria: 'Ocio y cultura > Suscripciones y streaming',
    confianza: 'media',
  },
  {
    clave: 'adobe',
    etiqueta: 'Adobe',
    alias: ['Adobe'],
    categoria: 'Ocio y cultura > Suscripciones y streaming',
    confianza: 'media',
  },
  {
    clave: 'canva',
    etiqueta: 'Canva',
    alias: ['Canva'],
    categoria: 'Ocio y cultura > Suscripciones y streaming',
    confianza: 'media',
  },
  {
    clave: 'notion',
    etiqueta: 'Notion',
    alias: ['Notion Labs'],
    categoria: 'Ocio y cultura > Suscripciones y streaming',
    confianza: 'media',
  },
  {
    clave: 'slack',
    etiqueta: 'Slack',
    alias: ['Slack Technologies'],
    categoria: 'Ocio y cultura > Suscripciones y streaming',
    confianza: 'media',
  },
  {
    clave: 'zoom',
    etiqueta: 'Zoom',
    alias: ['Zoom Video', 'Zoom.us'],
    categoria: 'Ocio y cultura > Suscripciones y streaming',
    confianza: 'media',
  },
  {
    clave: 'github',
    etiqueta: 'GitHub',
    alias: ['GitHub'],
    categoria: 'Ocio y cultura > Suscripciones y streaming',
    confianza: 'media',
  },
  {
    clave: 'atlassian',
    etiqueta: 'Atlassian',
    alias: ['Atlassian'],
    categoria: 'Ocio y cultura > Suscripciones y streaming',
    confianza: 'media',
  },
  {
    clave: 'figma',
    etiqueta: 'Figma',
    alias: ['Figma'],
    categoria: 'Ocio y cultura > Suscripciones y streaming',
    confianza: 'media',
  },
  {
    clave: 'aws',
    etiqueta: 'Amazon Web Services',
    alias: ['Amazon Web Services', 'AWS EMEA'],
    categoria: 'Ocio y cultura > Suscripciones y streaming',
    confianza: 'media',
  },
  {
    clave: 'google-cloud',
    etiqueta: 'Google Cloud',
    alias: ['Google Cloud'],
    categoria: 'Ocio y cultura > Suscripciones y streaming',
    confianza: 'media',
  },
  {
    // Microsoft a secas vende Azure, una consola y un teclado.
    clave: 'microsoft',
    etiqueta: 'Microsoft',
    alias: ['Microsoft'],
    categoria: null,
    confianza: 'ambigua',
  },
  {
    // Apple es un teléfono, una suscripción, una app y un cable.
    clave: 'apple',
    etiqueta: 'Apple',
    alias: ['Apple'],
    categoria: null,
    confianza: 'ambigua',
  },
  {
    clave: 'google',
    etiqueta: 'Google',
    alias: ['Google'],
    categoria: null,
    confianza: 'ambigua',
  },

  // ── Comercio electrónico: los ambiguos de verdad ──────────────────────────
  {
    // Del enunciado: Amazon no es una categoría. En el mismo mes hay un libro,
    // un secador y el material de la oficina.
    clave: 'amazon',
    etiqueta: 'Amazon',
    alias: ['Amazon', 'AMZN Mktp'],
    categoria: null,
    confianza: 'ambigua',
  },
  {
    clave: 'ebay',
    etiqueta: 'eBay',
    alias: ['eBay'],
    categoria: null,
    confianza: 'ambigua',
  },
  {
    clave: 'aliexpress',
    etiqueta: 'AliExpress',
    alias: ['AliExpress'],
    categoria: null,
    confianza: 'ambigua',
  },
  {
    clave: 'temu',
    etiqueta: 'Temu',
    alias: ['Temu'],
    categoria: null,
    confianza: 'ambigua',
  },
  {
    clave: 'wallapop',
    etiqueta: 'Wallapop',
    alias: ['Wallapop'],
    categoria: null,
    confianza: 'ambigua',
  },
  {
    // PayPal y Stripe no son comercios: son la cañería por la que pasó el pago.
    // Lo que se compró está detrás y el descriptor no lo trae.
    clave: 'paypal',
    etiqueta: 'PayPal',
    alias: ['PayPal'],
    categoria: null,
    confianza: 'ambigua',
  },
  {
    clave: 'stripe',
    etiqueta: 'Stripe',
    alias: ['Stripe'],
    categoria: null,
    confianza: 'ambigua',
  },
  {
    clave: 'revolut',
    etiqueta: 'Revolut',
    alias: ['Revolut'],
    categoria: null,
    confianza: 'ambigua',
  },
  {
    clave: 'n26',
    etiqueta: 'N26',
    alias: ['N26'],
    categoria: null,
    confianza: 'ambigua',
  },

  // ── Ropa y deporte ────────────────────────────────────────────────────────
  {
    clave: 'zalando',
    etiqueta: 'Zalando',
    alias: ['Zalando'],
    categoria: 'Día a día > Ropa y calzado',
    confianza: 'alta',
  },
  {
    clave: 'shein',
    etiqueta: 'Shein',
    alias: ['Shein'],
    categoria: 'Día a día > Ropa y calzado',
    confianza: 'alta',
  },
  {
    clave: 'asos',
    etiqueta: 'ASOS',
    alias: ['ASOS'],
    categoria: 'Día a día > Ropa y calzado',
    confianza: 'alta',
  },
  {
    clave: 'nike',
    etiqueta: 'Nike',
    alias: ['Nike'],
    categoria: 'Día a día > Ropa y calzado',
    confianza: 'alta',
  },
  {
    clave: 'adidas',
    etiqueta: 'Adidas',
    alias: ['Adidas'],
    categoria: 'Día a día > Ropa y calzado',
    confianza: 'alta',
  },

  // ── Restauración de cadena ────────────────────────────────────────────────
  {
    // El apóstrofo lo resuelve `merchantKey`: "McDonald's" y "MCDONALDS" dan el
    // mismo token, así que con un alias alcanza.
    clave: 'mcdonalds',
    etiqueta: "McDonald's",
    alias: ["McDonald's"],
    categoria: 'Día a día > Restaurantes y bares',
    confianza: 'alta',
  },
  {
    clave: 'burger-king',
    etiqueta: 'Burger King',
    alias: ['Burger King'],
    categoria: 'Día a día > Restaurantes y bares',
    confianza: 'alta',
  },
  {
    clave: 'kfc',
    etiqueta: 'KFC',
    alias: ['KFC'],
    categoria: 'Día a día > Restaurantes y bares',
    confianza: 'alta',
  },
  {
    clave: 'dominos-pizza',
    etiqueta: "Domino's Pizza",
    alias: ["Domino's Pizza"],
    categoria: 'Día a día > Restaurantes y bares',
    confianza: 'alta',
  },
  {
    clave: 'starbucks',
    etiqueta: 'Starbucks',
    alias: ['Starbucks'],
    categoria: 'Día a día > Restaurantes y bares',
    confianza: 'alta',
  },
  {
    clave: 'subway',
    etiqueta: 'Subway',
    alias: ['Subway'],
    categoria: 'Día a día > Restaurantes y bares',
    confianza: 'alta',
  },
  {
    clave: 'taco-bell',
    etiqueta: 'Taco Bell',
    alias: ['Taco Bell'],
    categoria: 'Día a día > Restaurantes y bares',
    confianza: 'alta',
  },
  {
    clave: 'five-guys',
    etiqueta: 'Five Guys',
    alias: ['Five Guys'],
    categoria: 'Día a día > Restaurantes y bares',
    confianza: 'alta',
  },
  {
    clave: 'uber-eats',
    etiqueta: 'Uber Eats',
    alias: ['Uber Eats'],
    categoria: 'Día a día > Restaurantes y bares',
    confianza: 'alta',
  },
  {
    // Menos específico que 'Uber Eats', así que sólo gana cuando el descriptor
    // no dice "Eats".
    clave: 'uber',
    etiqueta: 'Uber',
    alias: ['Uber'],
    categoria: 'Transporte > Taxis y VTC',
    confianza: 'media',
  },

  // ── Viajes ────────────────────────────────────────────────────────────────
  {
    clave: 'iberia',
    etiqueta: 'Iberia',
    alias: ['Iberia'],
    categoria: 'Viajes > Vuelos',
    confianza: 'alta',
  },
  {
    clave: 'vueling',
    etiqueta: 'Vueling',
    alias: ['Vueling'],
    categoria: 'Viajes > Vuelos',
    confianza: 'alta',
  },
  {
    clave: 'ryanair',
    etiqueta: 'Ryanair',
    alias: ['Ryanair'],
    categoria: 'Viajes > Vuelos',
    confianza: 'alta',
  },
  {
    clave: 'easyjet',
    etiqueta: 'easyJet',
    alias: ['easyJet'],
    categoria: 'Viajes > Vuelos',
    confianza: 'alta',
  },
  {
    clave: 'air-europa',
    etiqueta: 'Air Europa',
    alias: ['Air Europa'],
    categoria: 'Viajes > Vuelos',
    confianza: 'alta',
  },
  {
    clave: 'lufthansa',
    etiqueta: 'Lufthansa',
    alias: ['Lufthansa'],
    categoria: 'Viajes > Vuelos',
    confianza: 'alta',
  },
  {
    clave: 'air-france',
    etiqueta: 'Air France',
    alias: ['Air France'],
    categoria: 'Viajes > Vuelos',
    confianza: 'alta',
  },
  {
    clave: 'klm',
    etiqueta: 'KLM',
    alias: ['KLM'],
    categoria: 'Viajes > Vuelos',
    confianza: 'alta',
  },
  {
    clave: 'booking',
    etiqueta: 'Booking.com',
    alias: ['Booking'],
    categoria: 'Viajes > Alojamiento',
    confianza: 'alta',
  },
  {
    clave: 'airbnb',
    etiqueta: 'Airbnb',
    alias: ['Airbnb'],
    categoria: 'Viajes > Alojamiento',
    confianza: 'alta',
  },
  {
    // Las agencias venden el vuelo, el hotel y el paquete entero en el mismo
    // cargo: 'Otros gastos de viaje' es lo único honesto.
    clave: 'expedia',
    etiqueta: 'Expedia',
    alias: ['Expedia'],
    categoria: 'Viajes > Otros gastos de viaje',
    confianza: 'media',
  },
  {
    clave: 'edreams',
    etiqueta: 'eDreams',
    alias: ['eDreams'],
    categoria: 'Viajes > Otros gastos de viaje',
    confianza: 'media',
  },
  {
    clave: 'nh-hoteles',
    etiqueta: 'NH Hoteles',
    alias: ['NH Hoteles'],
    categoria: 'Viajes > Alojamiento',
    confianza: 'alta',
  },
  {
    clave: 'melia',
    etiqueta: 'Meliá',
    alias: ['Meliá Hotels'],
    categoria: 'Viajes > Alojamiento',
    confianza: 'alta',
  },
  {
    clave: 'ibis',
    etiqueta: 'Ibis',
    alias: ['Ibis'],
    categoria: 'Viajes > Alojamiento',
    confianza: 'alta',
  },
  {
    clave: 'marriott',
    etiqueta: 'Marriott',
    alias: ['Marriott'],
    categoria: 'Viajes > Alojamiento',
    confianza: 'alta',
  },
  {
    clave: 'hilton',
    etiqueta: 'Hilton',
    alias: ['Hilton'],
    categoria: 'Viajes > Alojamiento',
    confianza: 'alta',
  },
  {
    clave: 'paradores',
    etiqueta: 'Paradores',
    alias: ['Paradores'],
    categoria: 'Viajes > Alojamiento',
    confianza: 'alta',
  },

  // ── Ocio ──────────────────────────────────────────────────────────────────
  {
    clave: 'steam',
    etiqueta: 'Steam',
    alias: ['Steamgames', 'Steampowered'],
    categoria: 'Ocio y cultura > Espectáculos y cultura',
    confianza: 'media',
  },
  {
    clave: 'playstation',
    etiqueta: 'PlayStation',
    alias: ['PlayStation'],
    categoria: 'Ocio y cultura > Espectáculos y cultura',
    confianza: 'media',
  },
  {
    clave: 'nintendo',
    etiqueta: 'Nintendo',
    alias: ['Nintendo'],
    categoria: 'Ocio y cultura > Espectáculos y cultura',
    confianza: 'media',
  },
  {
    clave: 'xbox',
    etiqueta: 'Xbox',
    alias: ['Xbox'],
    categoria: 'Ocio y cultura > Espectáculos y cultura',
    confianza: 'media',
  },
  {
    clave: 'cinesa',
    etiqueta: 'Cinesa',
    alias: ['Cinesa'],
    categoria: 'Ocio y cultura > Espectáculos y cultura',
    confianza: 'alta',
  },
  {
    clave: 'kinepolis',
    etiqueta: 'Kinépolis',
    alias: ['Kinépolis'],
    categoria: 'Ocio y cultura > Espectáculos y cultura',
    confianza: 'alta',
  },
  {
    clave: 'ikea',
    etiqueta: 'IKEA',
    alias: ['IKEA'],
    categoria: 'Vivienda > Mobiliario y equipamiento',
    confianza: 'media',
  },

  // ── Portugal ──────────────────────────────────────────────────────────────
  {
    clave: 'continente',
    etiqueta: 'Continente',
    alias: ['Continente Modelo', 'Sonae MC'],
    categoria: 'Día a día > Supermercado',
    pais: 'PT',
    confianza: 'alta',
  },
  {
    clave: 'pingo-doce',
    etiqueta: 'Pingo Doce',
    alias: ['Pingo Doce'],
    categoria: 'Día a día > Supermercado',
    pais: 'PT',
    confianza: 'alta',
  },
  {
    clave: 'meo',
    etiqueta: 'MEO',
    alias: ['MEO Altice'],
    categoria: 'Vivienda > Suministros > Internet y telefonía',
    pais: 'PT',
    confianza: 'alta',
  },
  {
    clave: 'nos-comunicacoes',
    etiqueta: 'NOS',
    alias: ['NOS Comunicações'],
    categoria: 'Vivienda > Suministros > Internet y telefonía',
    pais: 'PT',
    confianza: 'alta',
  },
  {
    clave: 'millennium-bcp',
    etiqueta: 'Millennium BCP',
    alias: ['Millennium BCP'],
    categoria: null,
    pais: 'PT',
    confianza: 'ambigua',
  },

  // ── Estados Unidos ────────────────────────────────────────────────────────
  {
    clave: 'publix',
    etiqueta: 'Publix',
    alias: ['Publix'],
    categoria: 'Día a día > Supermercado',
    pais: 'US',
    confianza: 'alta',
  },
  {
    clave: 'whole-foods',
    etiqueta: 'Whole Foods Market',
    alias: ['Whole Foods'],
    categoria: 'Día a día > Supermercado',
    pais: 'US',
    confianza: 'alta',
  },
  {
    clave: 'trader-joes',
    etiqueta: "Trader Joe's",
    alias: ["Trader Joe's"],
    categoria: 'Día a día > Supermercado',
    pais: 'US',
    confianza: 'alta',
  },
  {
    clave: 'walmart',
    etiqueta: 'Walmart',
    alias: ['Walmart'],
    categoria: 'Día a día > Supermercado',
    pais: 'US',
    confianza: 'media',
  },
  {
    clave: 'cvs-pharmacy',
    etiqueta: 'CVS Pharmacy',
    alias: ['CVS Pharmacy'],
    categoria: 'Salud > Farmacia',
    pais: 'US',
    confianza: 'alta',
  },
  {
    clave: 'walgreens',
    etiqueta: 'Walgreens',
    alias: ['Walgreens'],
    categoria: 'Salud > Farmacia',
    pais: 'US',
    confianza: 'alta',
  },
  {
    clave: 'comcast-xfinity',
    etiqueta: 'Xfinity',
    alias: ['Xfinity', 'Comcast'],
    categoria: 'Vivienda > Suministros > Internet y telefonía',
    pais: 'US',
    confianza: 'alta',
  },
  {
    clave: 'chase',
    etiqueta: 'Chase',
    alias: ['Chase Bank', 'JPMorgan Chase'],
    categoria: null,
    pais: 'US',
    confianza: 'ambigua',
  },

  // ── Clases de comercio ────────────────────────────────────────────────────
  //
  // Acá no hay una marca sino el nombre del oficio: "Farmacia Pérez" no está en
  // ningún registro de marcas y sin embargo cualquiera sabe qué es. Son las
  // únicas entradas que no nombran una empresa, así que van juntas y con el
  // criterio escrito:
  //
  //  · Entra la palabra que NOMBRA EL OFICIO y cuya categoría no admite
  //    discusión: una farmacia vende medicamentos, una gasolinera vende
  //    combustible, un colegio cobra la escolarización.
  //  · NO entra la palabra que nombra un sitio donde puede pasar cualquier
  //    cosa. "Café", "Bar" y "Gasthaus" se quedaron fuera: un Gasthaus es tanto
  //    una cena como una noche de hotel. Y hay una razón peor para no meterlos:
  //    los habría añadido después de mirar los descriptores del corpus de
  //    prueba, que es exactamente la trampa que convierte un diccionario en una
  //    demo maquillada.
  {
    clave: 'clase:farmacia',
    etiqueta: 'Farmacia',
    alias: ['Farmacia'],
    categoria: 'Salud > Farmacia',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'clase:apotheke',
    etiqueta: 'Apotheke',
    alias: ['Apotheke'],
    categoria: 'Salud > Farmacia',
    pais: 'DE',
    confianza: 'alta',
  },
  {
    clave: 'clase:clinica-dental',
    etiqueta: 'Clínica dental',
    alias: ['Clínica Dental'],
    categoria: 'Salud > Dentista',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'clase:optica',
    etiqueta: 'Óptica',
    alias: ['Óptica'],
    categoria: 'Salud > Médicos y clínicas',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'clase:krankenversicherung',
    etiqueta: 'Krankenversicherung',
    alias: ['Krankenversicherung', 'Krankenkasse'],
    categoria: 'Seguros > Seguro de salud',
    pais: 'DE',
    confianza: 'alta',
  },
  {
    clave: 'clase:colegio',
    etiqueta: 'Colegio',
    alias: ['Colegio'],
    categoria: 'Educación > Colegio y universidad',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'clase:guarderia',
    etiqueta: 'Guardería',
    alias: ['Guardería', 'Escuela Infantil'],
    categoria: 'Educación > Guardería y cuidado de menores',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'clase:estacion-de-servicio',
    etiqueta: 'Estación de servicio',
    alias: ['Estación de Servicio'],
    categoria: 'Transporte > Combustible',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'clase:tankstelle',
    etiqueta: 'Tankstelle',
    alias: ['Tankstelle'],
    categoria: 'Transporte > Combustible',
    pais: 'DE',
    confianza: 'alta',
  },
  {
    clave: 'clase:taxi',
    etiqueta: 'Taxi',
    alias: ['Taxi'],
    categoria: 'Transporte > Taxis y VTC',
    confianza: 'alta',
  },
  {
    clave: 'clase:parking',
    etiqueta: 'Parking',
    alias: ['Parking', 'Aparcamiento'],
    categoria: 'Transporte > Peajes y aparcamiento',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'clase:peaje',
    etiqueta: 'Peaje',
    alias: ['Peaje'],
    categoria: 'Transporte > Peajes y aparcamiento',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'clase:itv',
    etiqueta: 'ITV',
    alias: ['ITV'],
    categoria: 'Transporte > Mantenimiento y taller',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'clase:restaurante',
    etiqueta: 'Restaurante',
    alias: ['Restaurante', 'Restaurant'],
    categoria: 'Día a día > Restaurantes y bares',
    confianza: 'alta',
  },
  {
    clave: 'clase:hotel',
    etiqueta: 'Hotel',
    alias: ['Hotel'],
    categoria: 'Viajes > Alojamiento',
    confianza: 'alta',
  },
  {
    clave: 'clase:gimnasio',
    etiqueta: 'Gimnasio',
    alias: ['Gimnasio'],
    categoria: 'Ocio y cultura > Deporte y gimnasio',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    // La nómina es lo único del diccionario que es un ingreso, y por eso vale
    // la pena que esté: sin ella, el sueldo —que es la línea más grande del
    // mes— se queda en la bolsa de sin categorizar.
    clave: 'clase:nomina',
    etiqueta: 'Nómina',
    alias: ['Nómina'],
    categoria: 'Ingresos > Nóminas y salarios',
    pais: 'ES',
    confianza: 'alta',
  },
  {
    clave: 'clase:gehalt',
    etiqueta: 'Lohn und Gehalt',
    alias: ['Gehalt', 'Lohn'],
    categoria: 'Ingresos > Nóminas y salarios',
    pais: 'DE',
    confianza: 'alta',
  },
  {
    // "Miete" y "alquiler" parecen clasificables y no lo son: la misma palabra
    // es el gasto del inquilino ('Vivienda > Alquiler') y el ingreso del casero
    // ('Ingresos > Alquileres'), y quién es cada uno lo dice el signo del
    // importe, que el diccionario no mira. Está para decir "esto es un
    // alquiler" y callarse la categoría.
    clave: 'clase:alquiler',
    etiqueta: 'Alquiler',
    alias: ['Alquiler', 'Miete'],
    categoria: null,
    confianza: 'ambigua',
  },
]
