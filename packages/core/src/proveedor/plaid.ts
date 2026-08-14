/**
 * La taxonomía de Plaid y su traducción al árbol por defecto.
 *
 * Fuente: el CSV oficial de la taxonomía `personal_finance_category`,
 * `https://plaid.com/documents/transactions-personal-finance-category-taxonomy.csv`,
 * descargado el 13-08-2026. **104 categorías detalladas** agrupadas en 16
 * primarias. Están todas en `CATEGORIAS_DETALLADAS_DE_PLAID`, incluidas las que
 * no traducimos, y el orden es el del fichero.
 *
 * ── Por qué está la lista entera si no se usa entera ────────────────────────
 *
 * Porque hace auditables los huecos. "Mejor un hueco que una correspondencia
 * forzada" es fácil de decir y difícil de comprobar si las categorías que
 * faltan no están escritas en ningún sitio: con la lista al lado, un test dice
 * cuántas hay y cuáles, y la de Plaid llegando con una categoría que no está en
 * la lista es la señal de que su taxonomía se movió.
 *
 * ── Sólo se traduce `detailed`, nunca `primary` ─────────────────────────────
 *
 * `primary` es un encabezado, no una categoría: `GENERAL_MERCHANDISE` abarca
 * desde una librería hasta una tienda de electrónica, y traducirlo obligaría a
 * elegir una de las nuestras al azar. Con `detailed` la pregunta tiene
 * respuesta; sin él, no la tiene, y la respuesta correcta es no contestar.
 *
 * ── Los 19 huecos, y por qué son huecos ─────────────────────────────────────
 *
 *  · **TRANSFER_IN_\* y TRANSFER_OUT_\* (11).** Son movimientos entre cuentas
 *    propias: no hay categoría que poner, hay una contrapartida que emparejar.
 *    Eso lo hace `matchTransfers` con la señal estructural (dos patas, importes
 *    opuestos, fechas cercanas) y marca `is_transfer`. Poner acá una categoría
 *    de gasto es el error que ya se midió contra el corpus: un traspaso a tu
 *    propia cuenta de CaixaBank no es una compra en CaixaBank.
 *  · **LOAN_PAYMENTS_CREDIT_CARD_PAYMENT.** El caso más peligroso de los once
 *    anteriores, y por eso aparte: la liquidación de la tarjeta parece un pago
 *    grande y es un traspaso entre la cuenta y el pasivo de la tarjeta. Si se
 *    clasificara como gasto, cada mes contaríamos el consumo de la tarjeta dos
 *    veces —una en cada compra y otra en la liquidación— y el total del año
 *    saldría casi al doble sin que nada deje de cuadrar.
 *  · **Amortización de deuda (CAR_PAYMENT, PERSONAL_LOAN, STUDENT_LOAN,
 *    OTHER_PAYMENT).** La parte de principal no es gasto, es balance: baja la
 *    deuda. Sólo lo son los intereses, y el proveedor no separa las dos partes.
 *    La hipoteca sí se traduce, con confianza media, porque 'Hipoteca' es una
 *    categoría que el producto ya tiene y el reparto principal/intereses lo
 *    pone el hogar; para un préstamo de coche no hay nodo equivalente, así que
 *    no hay entrada.
 *  · **GENERAL_SERVICES_POSTAGE_AND_SHIPPING, GENERAL_SERVICES_OTHER,
 *    GOVERNMENT_AND_NON_PROFIT_OTHER.** Genéricas de verdad: caben en tres
 *    categorías nuestras y en ninguna.
 *
 * ── Lo que la documentación no dice: `OTHER_OTHER` ──────────────────────────
 *
 * Medido hoy contra el sandbox con 40 descriptores españoles: un Bizum recibido
 * volvió con `pfc_detailed: 'OTHER_OTHER'`, que **no está en el CSV oficial**.
 * O sea que la lista documentada no agota lo que la API emite, y una tabla que
 * diera por cerrada la taxonomía se habría comido el caso en silencio.
 *
 * No se traduce, y no por falta de sitio: `OTHER_OTHER` significa exactamente
 * "no lo sé". Traducir un "no lo sé" a una categoría nuestra sería fabricar una
 * respuesta que el proveedor no dio. Se queda sin correspondencia, que es lo
 * mismo que devuelve para cualquier categoría desconocida, y por eso el
 * comportamiento correcto sale gratis: lo único que hacía falta era no
 * "arreglar" el hueco.
 */

import type { CorrespondenciaDeCategoria } from './correspondencia.js'

/**
 * Las 104 categorías detalladas, tal cual y en el orden del CSV oficial. Es
 * dato, no configuración: no se edita a mano, se vuelve a bajar.
 */
export const CATEGORIAS_DETALLADAS_DE_PLAID: readonly string[] = [
  'INCOME_DIVIDENDS',
  'INCOME_INTEREST_EARNED',
  'INCOME_RETIREMENT_PENSION',
  'INCOME_TAX_REFUND',
  'INCOME_UNEMPLOYMENT',
  'INCOME_WAGES',
  'INCOME_OTHER_INCOME',
  'TRANSFER_IN_CASH_ADVANCES_AND_LOANS',
  'TRANSFER_IN_DEPOSIT',
  'TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS',
  'TRANSFER_IN_SAVINGS',
  'TRANSFER_IN_ACCOUNT_TRANSFER',
  'TRANSFER_IN_OTHER_TRANSFER_IN',
  'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS',
  'TRANSFER_OUT_SAVINGS',
  'TRANSFER_OUT_WITHDRAWAL',
  'TRANSFER_OUT_ACCOUNT_TRANSFER',
  'TRANSFER_OUT_OTHER_TRANSFER_OUT',
  'LOAN_PAYMENTS_CAR_PAYMENT',
  'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
  'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT',
  'LOAN_PAYMENTS_MORTGAGE_PAYMENT',
  'LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT',
  'LOAN_PAYMENTS_OTHER_PAYMENT',
  'BANK_FEES_ATM_FEES',
  'BANK_FEES_FOREIGN_TRANSACTION_FEES',
  'BANK_FEES_INSUFFICIENT_FUNDS',
  'BANK_FEES_INTEREST_CHARGE',
  'BANK_FEES_OVERDRAFT_FEES',
  'BANK_FEES_OTHER_BANK_FEES',
  'ENTERTAINMENT_CASINOS_AND_GAMBLING',
  'ENTERTAINMENT_MUSIC_AND_AUDIO',
  'ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS',
  'ENTERTAINMENT_TV_AND_MOVIES',
  'ENTERTAINMENT_VIDEO_GAMES',
  'ENTERTAINMENT_OTHER_ENTERTAINMENT',
  'FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR',
  'FOOD_AND_DRINK_COFFEE',
  'FOOD_AND_DRINK_FAST_FOOD',
  'FOOD_AND_DRINK_GROCERIES',
  'FOOD_AND_DRINK_RESTAURANT',
  'FOOD_AND_DRINK_VENDING_MACHINES',
  'FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK',
  'GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS',
  'GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES',
  'GENERAL_MERCHANDISE_CONVENIENCE_STORES',
  'GENERAL_MERCHANDISE_DEPARTMENT_STORES',
  'GENERAL_MERCHANDISE_DISCOUNT_STORES',
  'GENERAL_MERCHANDISE_ELECTRONICS',
  'GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES',
  'GENERAL_MERCHANDISE_OFFICE_SUPPLIES',
  'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES',
  'GENERAL_MERCHANDISE_PET_SUPPLIES',
  'GENERAL_MERCHANDISE_SPORTING_GOODS',
  'GENERAL_MERCHANDISE_SUPERSTORES',
  'GENERAL_MERCHANDISE_TOBACCO_AND_VAPE',
  'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE',
  'HOME_IMPROVEMENT_FURNITURE',
  'HOME_IMPROVEMENT_HARDWARE',
  'HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE',
  'HOME_IMPROVEMENT_SECURITY',
  'HOME_IMPROVEMENT_OTHER_HOME_IMPROVEMENT',
  'MEDICAL_DENTAL_CARE',
  'MEDICAL_EYE_CARE',
  'MEDICAL_NURSING_CARE',
  'MEDICAL_PHARMACIES_AND_SUPPLEMENTS',
  'MEDICAL_PRIMARY_CARE',
  'MEDICAL_VETERINARY_SERVICES',
  'MEDICAL_OTHER_MEDICAL',
  'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS',
  'PERSONAL_CARE_HAIR_AND_BEAUTY',
  'PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING',
  'PERSONAL_CARE_OTHER_PERSONAL_CARE',
  'GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING',
  'GENERAL_SERVICES_AUTOMOTIVE',
  'GENERAL_SERVICES_CHILDCARE',
  'GENERAL_SERVICES_CONSULTING_AND_LEGAL',
  'GENERAL_SERVICES_EDUCATION',
  'GENERAL_SERVICES_INSURANCE',
  'GENERAL_SERVICES_POSTAGE_AND_SHIPPING',
  'GENERAL_SERVICES_STORAGE',
  'GENERAL_SERVICES_OTHER_GENERAL_SERVICES',
  'GOVERNMENT_AND_NON_PROFIT_DONATIONS',
  'GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES',
  'GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT',
  'GOVERNMENT_AND_NON_PROFIT_OTHER_GOVERNMENT_AND_NON_PROFIT',
  'TRANSPORTATION_BIKES_AND_SCOOTERS',
  'TRANSPORTATION_GAS',
  'TRANSPORTATION_PARKING',
  'TRANSPORTATION_PUBLIC_TRANSIT',
  'TRANSPORTATION_TAXIS_AND_RIDE_SHARES',
  'TRANSPORTATION_TOLLS',
  'TRANSPORTATION_OTHER_TRANSPORTATION',
  'TRAVEL_FLIGHTS',
  'TRAVEL_LODGING',
  'TRAVEL_RENTAL_CARS',
  'TRAVEL_OTHER_TRAVEL',
  'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY',
  'RENT_AND_UTILITIES_INTERNET_AND_CABLE',
  'RENT_AND_UTILITIES_RENT',
  'RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT',
  'RENT_AND_UTILITIES_TELEPHONE',
  'RENT_AND_UTILITIES_WATER',
  'RENT_AND_UTILITIES_OTHER_UTILITIES',
]

/**
 * La traducción. 85 de las 104; los 19 huecos están explicados en la cabecera.
 *
 * Las entradas que apuntan a un nodo intermedio ('Seguros', 'Impuestos',
 * 'Salud') no son un descuido: cuando el proveedor acierta la familia y no la
 * hoja, dejarlo en el padre es más honesto que elegir una hoja a suerte, y el
 * movimiento queda igualmente fuera de la bolsa de sin categorizar.
 */
export const CORRESPONDENCIAS_DE_PLAID: ReadonlyMap<string, CorrespondenciaDeCategoria> = new Map<
  string,
  CorrespondenciaDeCategoria
>([
  // ── Ingresos ──────────────────────────────────────────────────────────────
  ['INCOME_WAGES', { ruta: 'Ingresos > Nóminas y salarios', confianza: 'alta' }],
  ['INCOME_DIVIDENDS', { ruta: 'Ingresos > Dividendos y distribuciones', confianza: 'alta' }],
  ['INCOME_INTEREST_EARNED', { ruta: 'Ingresos > Intereses y cupones', confianza: 'alta' }],
  ['INCOME_RETIREMENT_PENSION', { ruta: 'Ingresos > Pensiones', confianza: 'alta' }],
  ['INCOME_TAX_REFUND', { ruta: 'Ingresos > Devoluciones de impuestos', confianza: 'alta' }],
  ['INCOME_UNEMPLOYMENT', { ruta: 'Ingresos > Otros ingresos', confianza: 'media' }],
  // Media y no alta porque su 'other income' incluye explícitamente el alquiler
  // —que para este cliente es una categoría propia y de las que más importan—
  // junto con pensiones alimenticias y prestaciones. Aceptarlo como 'Otros'
  // sería enterrar el ingreso por alquiler en el cajón de sastre.
  ['INCOME_OTHER_INCOME', { ruta: 'Ingresos > Otros ingresos', confianza: 'media' }],

  // ── Deuda ─────────────────────────────────────────────────────────────────
  // Media: el recibo trae principal e intereses juntos y el proveedor no los
  // separa. La categoría es la correcta; el reparto lo decide el hogar.
  ['LOAN_PAYMENTS_MORTGAGE_PAYMENT', { ruta: 'Vivienda > Hipoteca', confianza: 'media' }],

  // ── Comisiones e intereses del banco ──────────────────────────────────────
  ['BANK_FEES_ATM_FEES', { ruta: 'Gastos financieros > Comisiones bancarias', confianza: 'alta' }],
  [
    'BANK_FEES_FOREIGN_TRANSACTION_FEES',
    { ruta: 'Gastos financieros > Comisiones bancarias', confianza: 'alta' },
  ],
  [
    'BANK_FEES_INSUFFICIENT_FUNDS',
    { ruta: 'Gastos financieros > Comisiones bancarias', confianza: 'alta' },
  ],
  [
    'BANK_FEES_OVERDRAFT_FEES',
    { ruta: 'Gastos financieros > Comisiones bancarias', confianza: 'alta' },
  ],
  [
    'BANK_FEES_OTHER_BANK_FEES',
    { ruta: 'Gastos financieros > Comisiones bancarias', confianza: 'alta' },
  ],
  [
    'BANK_FEES_INTEREST_CHARGE',
    { ruta: 'Gastos financieros > Intereses de préstamos', confianza: 'alta' },
  ],

  // ── Ocio ──────────────────────────────────────────────────────────────────
  [
    'ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS',
    { ruta: 'Ocio y cultura > Espectáculos y cultura', confianza: 'alta' },
  ],
  // Las dos mezclan la suscripción mensual con la entrada suelta (Plaid junta
  // "streaming services and movie theaters" en la misma categoría), y para el
  // cliente no son lo mismo: una es un gasto recurrente que se puede cancelar.
  [
    'ENTERTAINMENT_MUSIC_AND_AUDIO',
    { ruta: 'Ocio y cultura > Suscripciones y streaming', confianza: 'media' },
  ],
  [
    'ENTERTAINMENT_TV_AND_MOVIES',
    { ruta: 'Ocio y cultura > Suscripciones y streaming', confianza: 'media' },
  ],
  ['ENTERTAINMENT_VIDEO_GAMES', { ruta: 'Ocio y cultura', confianza: 'media' }],
  ['ENTERTAINMENT_CASINOS_AND_GAMBLING', { ruta: 'Ocio y cultura', confianza: 'media' }],
  ['ENTERTAINMENT_OTHER_ENTERTAINMENT', { ruta: 'Ocio y cultura', confianza: 'media' }],

  // ── Comida ────────────────────────────────────────────────────────────────
  ['FOOD_AND_DRINK_GROCERIES', { ruta: 'Día a día > Supermercado', confianza: 'alta' }],
  ['FOOD_AND_DRINK_RESTAURANT', { ruta: 'Día a día > Restaurantes y bares', confianza: 'alta' }],
  ['FOOD_AND_DRINK_FAST_FOOD', { ruta: 'Día a día > Restaurantes y bares', confianza: 'alta' }],
  ['FOOD_AND_DRINK_COFFEE', { ruta: 'Día a día > Restaurantes y bares', confianza: 'alta' }],
  // Una bodega puede ser la compra de la semana o una botella para regalar.
  ['FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR', { ruta: 'Día a día > Supermercado', confianza: 'media' }],
  [
    'FOOD_AND_DRINK_VENDING_MACHINES',
    { ruta: 'Día a día > Restaurantes y bares', confianza: 'media' },
  ],
  [
    'FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK',
    { ruta: 'Día a día > Restaurantes y bares', confianza: 'media' },
  ],

  // ── Compras ───────────────────────────────────────────────────────────────
  [
    'GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES',
    { ruta: 'Día a día > Ropa y calzado', confianza: 'alta' },
  ],
  [
    'GENERAL_MERCHANDISE_DEPARTMENT_STORES',
    { ruta: 'Día a día > Compras generales', confianza: 'alta' },
  ],
  [
    'GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS',
    { ruta: 'Ocio y cultura > Libros y prensa', confianza: 'alta' },
  ],
  ['GENERAL_MERCHANDISE_PET_SUPPLIES', { ruta: 'Día a día > Mascotas', confianza: 'alta' }],
  // El Corte Inglés y Amazon venden de todo, incluida la compra de la semana:
  // por eso las tiendas de todo a la vez se quedan en media, aunque el
  // proveedor esté seguro del comercio.
  [
    'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES',
    { ruta: 'Día a día > Compras generales', confianza: 'media' },
  ],
  ['GENERAL_MERCHANDISE_SUPERSTORES', { ruta: 'Día a día > Supermercado', confianza: 'media' }],
  [
    'GENERAL_MERCHANDISE_CONVENIENCE_STORES',
    { ruta: 'Día a día > Supermercado', confianza: 'media' },
  ],
  [
    'GENERAL_MERCHANDISE_DISCOUNT_STORES',
    { ruta: 'Día a día > Compras generales', confianza: 'media' },
  ],
  [
    'GENERAL_MERCHANDISE_ELECTRONICS',
    { ruta: 'Día a día > Compras generales', confianza: 'media' },
  ],
  [
    'GENERAL_MERCHANDISE_TOBACCO_AND_VAPE',
    { ruta: 'Día a día > Compras generales', confianza: 'media' },
  ],
  [
    'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE',
    { ruta: 'Día a día > Compras generales', confianza: 'media' },
  ],
  [
    'GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES',
    { ruta: 'Día a día > Regalos y donativos', confianza: 'media' },
  ],
  [
    'GENERAL_MERCHANDISE_SPORTING_GOODS',
    { ruta: 'Ocio y cultura > Deporte y gimnasio', confianza: 'media' },
  ],
  // El material de oficina de una familia con sociedad casi siempre es de la
  // sociedad; casi, y de ahí la media.
  ['GENERAL_MERCHANDISE_OFFICE_SUPPLIES', { ruta: 'Sociedad > Oficina', confianza: 'media' }],

  // ── La casa por dentro ────────────────────────────────────────────────────
  [
    'HOME_IMPROVEMENT_FURNITURE',
    { ruta: 'Vivienda > Mobiliario y equipamiento', confianza: 'alta' },
  ],
  [
    'HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE',
    { ruta: 'Vivienda > Mantenimiento y reparaciones', confianza: 'alta' },
  ],
  ['HOME_IMPROVEMENT_SECURITY', { ruta: 'Vivienda > Seguridad y alarma', confianza: 'alta' }],
  // La ferretería es la reparación del sábado y también la reforma entera; el
  // descriptor no distingue una junta de un albañil, y para este cliente la
  // diferencia entre gasto y obra tiene consecuencias fiscales.
  [
    'HOME_IMPROVEMENT_HARDWARE',
    { ruta: 'Vivienda > Mantenimiento y reparaciones', confianza: 'media' },
  ],
  [
    'HOME_IMPROVEMENT_OTHER_HOME_IMPROVEMENT',
    { ruta: 'Vivienda > Mantenimiento y reparaciones', confianza: 'media' },
  ],

  // ── Salud ─────────────────────────────────────────────────────────────────
  ['MEDICAL_PRIMARY_CARE', { ruta: 'Salud > Médicos y clínicas', confianza: 'alta' }],
  ['MEDICAL_DENTAL_CARE', { ruta: 'Salud > Dentista', confianza: 'alta' }],
  ['MEDICAL_PHARMACIES_AND_SUPPLEMENTS', { ruta: 'Salud > Farmacia', confianza: 'alta' }],
  ['MEDICAL_VETERINARY_SERVICES', { ruta: 'Día a día > Mascotas', confianza: 'alta' }],
  ['MEDICAL_EYE_CARE', { ruta: 'Salud > Médicos y clínicas', confianza: 'media' }],
  // Cuidar a un mayor en casa es tan probable que sea personal doméstico como
  // una residencia; el proveedor no lo sabe y nosotros tampoco desde acá.
  ['MEDICAL_NURSING_CARE', { ruta: 'Salud > Médicos y clínicas', confianza: 'media' }],
  ['MEDICAL_OTHER_MEDICAL', { ruta: 'Salud', confianza: 'media' }],

  // ── Cuidado personal ──────────────────────────────────────────────────────
  [
    'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS',
    { ruta: 'Ocio y cultura > Deporte y gimnasio', confianza: 'alta' },
  ],
  ['PERSONAL_CARE_HAIR_AND_BEAUTY', { ruta: 'Día a día > Cuidado personal', confianza: 'alta' }],
  [
    'PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING',
    { ruta: 'Día a día > Cuidado personal', confianza: 'media' },
  ],
  [
    'PERSONAL_CARE_OTHER_PERSONAL_CARE',
    { ruta: 'Día a día > Cuidado personal', confianza: 'media' },
  ],

  // ── Servicios ─────────────────────────────────────────────────────────────
  // La del enunciado: su categoría genérica de seguros contra nuestra raíz de
  // seguros. Alta porque un recibo de seguro es un seguro en cualquier plan de
  // cuentas; de qué (hogar, coche, vida) lo dirá el diccionario de comercios o
  // una regla del hogar, y mientras tanto queda en el padre, que es cierto.
  ['GENERAL_SERVICES_INSURANCE', { ruta: 'Seguros', confianza: 'alta' }],
  [
    'GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING',
    { ruta: 'Honorarios profesionales > Asesoría fiscal y contable', confianza: 'alta' },
  ],
  [
    'GENERAL_SERVICES_AUTOMOTIVE',
    { ruta: 'Transporte > Mantenimiento y taller', confianza: 'alta' },
  ],
  ['GENERAL_SERVICES_EDUCATION', { ruta: 'Educación > Colegio y universidad', confianza: 'alta' }],
  // Su 'consulting and legal' junta al abogado con cualquier consultor.
  [
    'GENERAL_SERVICES_CONSULTING_AND_LEGAL',
    { ruta: 'Honorarios profesionales > Abogados', confianza: 'media' },
  ],
  // Guardería y niñera caen en la misma categoría de Plaid, y en este hogar la
  // segunda es personal doméstico con su nómina.
  [
    'GENERAL_SERVICES_CHILDCARE',
    { ruta: 'Educación > Guardería y cuidado de menores', confianza: 'media' },
  ],
  // El trastero es un coste de vivienda aunque no esté en la vivienda; no hay
  // hoja para él y el padre es lo más preciso que se puede decir.
  ['GENERAL_SERVICES_STORAGE', { ruta: 'Vivienda', confianza: 'media' }],

  // ── Administración pública y donativos ────────────────────────────────────
  [
    'GOVERNMENT_AND_NON_PROFIT_DONATIONS',
    { ruta: 'Día a día > Regalos y donativos', confianza: 'alta' },
  ],
  // Que es un impuesto lo sabemos; cuál, no. Y en España la respuesta cambia
  // mucho: IRPF, patrimonio, IBI y sociedades tienen contribuyentes distintos.
  ['GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT', { ruta: 'Impuestos', confianza: 'media' }],
  // Esta categoría es la que recibe el recibo del ayuntamiento —medido contra
  // descriptores españoles reales— y también la renovación del pasaporte.
  [
    'GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES',
    { ruta: 'Impuestos', confianza: 'media' },
  ],

  // ── Moverse ───────────────────────────────────────────────────────────────
  ['TRANSPORTATION_GAS', { ruta: 'Transporte > Combustible', confianza: 'alta' }],
  ['TRANSPORTATION_PARKING', { ruta: 'Transporte > Peajes y aparcamiento', confianza: 'alta' }],
  ['TRANSPORTATION_TOLLS', { ruta: 'Transporte > Peajes y aparcamiento', confianza: 'alta' }],
  ['TRANSPORTATION_PUBLIC_TRANSIT', { ruta: 'Transporte > Transporte público', confianza: 'alta' }],
  ['TRANSPORTATION_TAXIS_AND_RIDE_SHARES', { ruta: 'Transporte > Taxis y VTC', confianza: 'alta' }],
  ['TRANSPORTATION_BIKES_AND_SCOOTERS', { ruta: 'Transporte', confianza: 'media' }],
  ['TRANSPORTATION_OTHER_TRANSPORTATION', { ruta: 'Transporte', confianza: 'media' }],

  // ── Viajar ────────────────────────────────────────────────────────────────
  ['TRAVEL_FLIGHTS', { ruta: 'Viajes > Vuelos', confianza: 'alta' }],
  ['TRAVEL_LODGING', { ruta: 'Viajes > Alojamiento', confianza: 'alta' }],
  // Un coche de alquiler suele ser parte de un viaje, pero el renting mensual
  // del coche de casa cae en esta misma categoría.
  ['TRAVEL_RENTAL_CARS', { ruta: 'Transporte > Alquiler y renting', confianza: 'media' }],
  ['TRAVEL_OTHER_TRAVEL', { ruta: 'Viajes > Otros gastos de viaje', confianza: 'media' }],

  // ── Suministros y alquiler ────────────────────────────────────────────────
  [
    'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY',
    { ruta: 'Vivienda > Suministros > Luz y gas', confianza: 'alta' },
  ],
  ['RENT_AND_UTILITIES_WATER', { ruta: 'Vivienda > Suministros > Agua', confianza: 'alta' }],
  [
    'RENT_AND_UTILITIES_INTERNET_AND_CABLE',
    { ruta: 'Vivienda > Suministros > Internet y telefonía', confianza: 'alta' },
  ],
  [
    'RENT_AND_UTILITIES_TELEPHONE',
    { ruta: 'Vivienda > Suministros > Internet y telefonía', confianza: 'alta' },
  ],
  [
    'RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT',
    { ruta: 'Vivienda > Suministros > Basuras y saneamiento', confianza: 'alta' },
  ],
  ['RENT_AND_UTILITIES_RENT', { ruta: 'Vivienda > Alquiler', confianza: 'alta' }],
  ['RENT_AND_UTILITIES_OTHER_UTILITIES', { ruta: 'Vivienda > Suministros', confianza: 'media' }],
])
