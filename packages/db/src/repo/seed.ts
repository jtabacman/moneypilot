/**
 * Hogar de ejemplo: el cliente arquetipo del piloto, sembrado entero.
 *
 * 18 cuentas reales, 3 países, 2 monedas, una sociedad patrimonial, tres
 * propiedades y ~14 meses de movimientos. No es una base de pruebas: es la
 * demo del producto, y por eso tiene que resistir que alguien la mire de
 * cerca. Los cuatro momentos "wow" del onboarding tienen que verse en los
 * datos, sin que nadie los prepare a mano:
 *
 *   1. La reconciliación cierra en 0,00 en 17 de 18 cuentas, y la que falta
 *      viene con el motivo escrito.
 *   2. Se puede preguntar cuánto cuesta la casa de Madrid, porque cada gasto
 *      está imputado a su propiedad y a su área.
 *   3. Hay gasto compartido 60/40 entre la persona y la sociedad.
 *   4. Hay gasto en dólares con los tres números puestos, y el residuo de
 *      cambio vive en cuentas de trading en vez de desaparecer redondeado.
 *
 * Tres reglas gobiernan el módulo:
 *
 *  - **Determinista.** Ni `Math.random` ni `Date.now`. Los importes salen de
 *    un generador congruencial con semilla fija, las fechas de aritmética
 *    entera sobre `asOf`, y hasta los UUID se derivan por hash del hogar más
 *    una clave estable. Sembrar dos veces la misma base da byte por byte lo
 *    mismo, y eso es lo que permite que la demo se pueda comparar contra una
 *    captura de pantalla de la semana pasada.
 *  - **Reversible.** Todo cuelga de un `import_batch` marcado
 *    `ejemplo:hogar-demo` / `seed`, y `removeDemoData` es revertir ese lote.
 *    Las cuentas y dimensiones no llevan marca en la tabla: se borran por su
 *    conjunto de ids derivado, que es la misma función pura que las creó.
 *  - **No pisa nada.** Si el hogar ya tenía una cuenta o una dimensión con ese
 *    nombre, se reutiliza la suya y no se borra al limpiar. Un ejemplo que
 *    destruye datos reales al desinstalarse no se puede ofrecer.
 *
 * Por qué no se usa `persistImport`: ese módulo modela el extracto de UNA
 * cuenta con contrapartida a una cuenta puente, y acá cada asiento toca varias
 * cuentas, lleva dimensiones con peso y a veces cierra contra cuentas de
 * cambio. Lo que sí se reutiliza es la aritmética del núcleo —
 * `currencyImbalances`, `assertBalanced`, `convert`, `assignOrdinals` — que es
 * donde vive la lógica de balanceo de verdad.
 */

import { createHash } from 'node:crypto'
import {
  type AccountId,
  ARBOL_POR_DEFECTO,
  addDays,
  aplanarArbol,
  assertBalanced,
  assignOrdinals,
  convert,
  currencyImbalances,
  daysInMonth,
  differenceInDays,
  type Money,
  money,
  type PlainDate,
  type Posting,
  parsePlainDate,
  plainDate,
  type RutaDeCategoria,
  SEPARADOR_DE_RUTA,
  toDecimalString,
  toParts,
  transactionFingerprint,
} from '@moneypilot/core'
import type { TenantClient } from '../client.js'

// ── Contrato público ────────────────────────────────────────────────────────

export interface SeedOptions {
  /** Fecha de corte. No se genera ni un movimiento posterior. */
  readonly asOf?: string
  /** Meses de histórico hacia atrás desde `asOf`, incluido el mes en curso. */
  readonly months?: number
}

/** La cuenta que no cuadra, con el motivo. Sin motivo no se muestra un delta. */
export interface SeedDelta {
  readonly account: string
  readonly currency: string
  /** Calculado − declarado, en forma decimal canónica. Nunca un number. */
  readonly delta: string
  readonly reason: string
}

export interface SeedResult {
  readonly batchId: string
  readonly asOf: string
  readonly from: string
  readonly months: number
  readonly baseCurrency: string
  /** Cuentas de banco, tarjeta y efectivo: las 18 del arquetipo. */
  readonly bankAccounts: number
  /** Cuentas de gasto e ingreso que hacen de categorías, más las de sistema. */
  readonly ledgerAccounts: number
  readonly dimensions: number
  readonly dimensionValues: number
  readonly entries: number
  readonly postings: number
  readonly declaredBalances: number
  readonly reconciled: number
  readonly deltas: readonly SeedDelta[]
  readonly pendingReviews: number
  /** Series recurrentes que suben de importe dentro del histórico. */
  readonly raisedSeries: readonly string[]
  /** Series que dejan de cobrarse antes del corte. */
  readonly stoppedSeries: readonly string[]
  /**
   * Postings que quedaron sin importe en la moneda de reporte. Se devuelve
   * aunque sea cero: es la regla central del producto — lo que no se pudo
   * convertir se declara, no se esconde.
   */
  readonly postingsWithoutBase: number
}

export class SeedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SeedError'
  }
}

/** Marca del lote. Es el ancla de todo lo sembrado. */
export const DEMO_BATCH_FILE = 'ejemplo:hogar-demo'
export const DEMO_BATCH_FORMAT = 'seed'

const DEFAULT_AS_OF = '2026-08-13'
const DEFAULT_MONTHS = 14
const MAX_MONTHS = 60

/** Semilla del generador. Cambiarla cambia el ejemplo entero. */
const RNG_SEED = 0x4d_50_53_31

const FX_SOURCE = 'ejemplo:hogar-demo'

type Currency = 'EUR' | 'USD'

// ── Aleatoriedad reproducible ───────────────────────────────────────────────

/**
 * Congruencial lineal (Numerical Recipes). No es criptografía ni pretende
 * serlo: lo único que se le pide es que la misma semilla dé la misma serie en
 * cualquier máquina y versión de Node, que es justo lo que `Math.random` no
 * garantiza.
 */
function createRng(seed: number) {
  let state = seed >>> 0
  const next = (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state
  }
  return {
    /** Entero en [min, max], ambos incluidos. */
    between: (min: number, max: number): number => min + (next() % (max - min + 1)),
    /** true con probabilidad `percent`. */
    chance: (percent: number): boolean => next() % 100 < percent,
    /** Importe en unidades mínimas dentro del rango. */
    minor: (min: number, max: number): bigint => BigInt(min + (next() % (max - min + 1))),
  }
}

type Rng = ReturnType<typeof createRng>

/**
 * UUID derivado del hogar y de una clave estable.
 *
 * Dos razones, y ninguna es estética. Primera: `removeDemoData` puede borrar
 * exactamente lo que el sembrado creó sin necesidad de una columna "esto es de
 * ejemplo" en cada tabla. Segunda: resembrar el mismo hogar reproduce los
 * mismos ids, así que un enlace guardado a un movimiento del ejemplo sigue
 * funcionando. Va el tenant dentro del hash porque el id es clave primaria
 * global: dos hogares con el ejemplo cargado no pueden colisionar.
 */
function seededUuid(tenantId: string, key: string): string {
  const digest = createHash('sha256').update(`${tenantId}\u001F${key}`, 'utf8').digest()
  const bytes = Buffer.from(digest.subarray(0, 16))
  // Versión 8 (UUID de construcción propia) y variante RFC 4122. No es
  // decorativo: un uuid con bits de versión inventados confunde a cualquier
  // herramienta que intente clasificarlo.
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x80, 6)
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8)
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// ── Fechas: aritmética entera sobre la fecha de corte ───────────────────────

function monthBack(asOf: PlainDate, back: number): { year: number; month: number } {
  const { year, month } = toParts(asOf)
  const total = year * 12 + (month - 1) - back
  return { year: Math.floor(total / 12), month: (total % 12) + 1 }
}

/** Día del mes, recortado al último día real: no existe el 31 de febrero. */
function dayIn(year: number, month: number, day: number): PlainDate {
  return plainDate(year, month, Math.min(day, daysInMonth(year, month)))
}

// ── Tipos de cambio del ejemplo ─────────────────────────────────────────────

/**
 * 1 EUR expresado en USD, con cuatro decimales, mes a mes.
 *
 * Serie inventada y declarada como tal (`fx_source = 'ejemplo:hogar-demo'`),
 * pero con variación real: si todos los meses tuvieran la misma tasa, las
 * cuentas de cambio cerrarían solas y el efecto FX —que es uno de los cuatro
 * momentos del producto— no existiría en la demo.
 */
const USD_PER_EUR_E4: readonly bigint[] = [
  10_540n,
  10_612n,
  10_698n,
  10_775n,
  10_861n,
  10_940n,
  11_024n,
  11_118n,
  11_051n,
  10_968n,
  10_884n,
  10_797n,
  10_713n,
  10_648n,
  10_589n,
  10_531n,
  10_602n,
  10_688n,
  10_761n,
  10_845n,
  10_926n,
  11_008n,
  11_083n,
  11_154n,
]

/**
 * La tasa se indexa por **mes del calendario**, no por la posición dentro del
 * histórico.
 *
 * La diferencia importa porque cada posting guarda la fracción junto a
 * `fx_as_of` y `fx_source`: eso afirma "esta era la tasa EUR/USD ese día".
 * Con el índice por posición, sembrar 14 meses y sembrar 6 meses daban tasas
 * distintas para el mismo día, así que dos hogares podían contradecirse sobre
 * el mismo hecho. La tasa tiene que ser función de la fecha y de nada más.
 */
function rateFor(on: PlainDate): bigint {
  const { year, month } = toParts(on)
  const index = (year * 12 + (month - 1)) % USD_PER_EUR_E4.length
  const rate = USD_PER_EUR_E4[index]
  if (rate === undefined) throw new SeedError(`Sin tasa para ${on}`)
  return rate
}

const E4 = 10_000n

/** Convierte entre las dos monedas del ejemplo con la fracción exacta del mes. */
function crossCurrency(amount: bigint, from: Currency, to: Currency, on: PlainDate): bigint {
  if (from === to) return amount
  const rate = rateFor(on)
  return from === 'EUR'
    ? convert(money(amount, 'EUR'), 'USD', rate, E4).amount
    : convert(money(amount, 'USD'), 'EUR', E4, rate).amount
}

// ── Catálogo de cuentas ─────────────────────────────────────────────────────

type AccountKind = 'asset' | 'liability' | 'income' | 'expense' | 'equity' | 'trading'

interface SeedAccount {
  readonly key: string
  readonly kind: AccountKind
  readonly name: string
  readonly currency: Currency
  readonly institution?: string
  readonly country?: 'ES' | 'PT' | 'US'
  /** Enmascarado, como lo dejan los parsers. El número entero nunca entra. */
  readonly accountNumber?: string
  readonly parent?: string
  /** Saldo al inicio del histórico, en unidades mínimas. */
  readonly opening?: bigint
}

/**
 * Las 18 del arquetipo: España, Portugal y Estados Unidos; corrientes, ahorro,
 * tarjetas de crédito (`liability`, saldo negativo = deuda) y efectivo.
 */
const BANK_ACCOUNTS: readonly SeedAccount[] = [
  {
    key: 'bbva-corriente',
    kind: 'asset',
    name: 'BBVA Cuenta Corriente',
    currency: 'EUR',
    institution: 'BBVA',
    country: 'ES',
    accountNumber: '****4417',
    opening: 18_400_00n,
  },
  {
    key: 'bbva-ahorro',
    kind: 'asset',
    name: 'BBVA Cuenta Ahorro',
    currency: 'EUR',
    institution: 'BBVA',
    country: 'ES',
    accountNumber: '****9032',
    opening: 62_000_00n,
  },
  {
    key: 'bbva-visa',
    kind: 'liability',
    name: 'BBVA Tarjeta Visa',
    currency: 'EUR',
    institution: 'BBVA',
    country: 'ES',
    accountNumber: '****1188',
    opening: -1_240_00n,
  },
  {
    key: 'santander-corriente',
    kind: 'asset',
    name: 'Santander Cuenta Corriente',
    currency: 'EUR',
    institution: 'Santander',
    country: 'ES',
    accountNumber: '****7720',
    opening: 9_800_00n,
  },
  {
    key: 'santander-sl',
    kind: 'asset',
    name: 'Santander Cuenta Iriarte Patrimonial SL',
    currency: 'EUR',
    institution: 'Santander',
    country: 'ES',
    accountNumber: '****3061',
    opening: 41_500_00n,
  },
  {
    key: 'santander-empresa',
    kind: 'liability',
    name: 'Santander Tarjeta Empresa',
    currency: 'EUR',
    institution: 'Santander',
    country: 'ES',
    accountNumber: '****5504',
    opening: -2_310_00n,
  },
  {
    key: 'caixa-corriente',
    kind: 'asset',
    name: 'CaixaBank Cuenta Corriente',
    currency: 'EUR',
    institution: 'CaixaBank',
    country: 'ES',
    accountNumber: '****2245',
    opening: 7_150_00n,
  },
  {
    key: 'caixa-alquileres',
    kind: 'asset',
    name: 'CaixaBank Cuenta Alquileres',
    currency: 'EUR',
    institution: 'CaixaBank',
    country: 'ES',
    accountNumber: '****8813',
    opening: 3_400_00n,
  },
  {
    key: 'caixa-mastercard',
    kind: 'liability',
    name: 'CaixaBank Tarjeta Mastercard',
    currency: 'EUR',
    institution: 'CaixaBank',
    country: 'ES',
    accountNumber: '****6690',
    opening: -860_00n,
  },
  {
    key: 'efectivo-madrid',
    kind: 'asset',
    name: 'Efectivo Madrid',
    currency: 'EUR',
    country: 'ES',
    opening: 1_200_00n,
  },
  {
    key: 'millennium-corrente',
    kind: 'asset',
    name: 'Millennium Conta Corrente',
    currency: 'EUR',
    institution: 'Millennium bcp',
    country: 'PT',
    accountNumber: '****3378',
    opening: 5_600_00n,
  },
  {
    key: 'millennium-poupanca',
    kind: 'asset',
    name: 'Millennium Poupança',
    currency: 'EUR',
    institution: 'Millennium bcp',
    country: 'PT',
    accountNumber: '****3379',
    opening: 24_000_00n,
  },
  {
    key: 'millennium-cartao',
    kind: 'liability',
    name: 'Millennium Cartão de Crédito',
    currency: 'EUR',
    institution: 'Millennium bcp',
    country: 'PT',
    accountNumber: '****4102',
    opening: -410_00n,
  },
  {
    key: 'chase-checking',
    kind: 'asset',
    name: 'Chase Checking',
    currency: 'USD',
    institution: 'Chase',
    country: 'US',
    accountNumber: '****2091',
    opening: 22_300_00n,
  },
  {
    key: 'chase-savings',
    kind: 'asset',
    name: 'Chase Savings',
    currency: 'USD',
    institution: 'Chase',
    country: 'US',
    accountNumber: '****2092',
    opening: 85_000_00n,
  },
  {
    key: 'amex-platinum',
    kind: 'liability',
    name: 'Amex Platinum',
    currency: 'USD',
    institution: 'American Express',
    country: 'US',
    accountNumber: '****71005',
    opening: -3_180_00n,
  },
  {
    key: 'schwab-efectivo',
    kind: 'asset',
    name: 'Schwab Efectivo',
    currency: 'USD',
    institution: 'Charles Schwab',
    country: 'US',
    accountNumber: '****5540',
    opening: 46_500_00n,
  },
  {
    key: 'efectivo-miami',
    kind: 'asset',
    name: 'Efectivo Miami',
    currency: 'USD',
    country: 'US',
    opening: 900_00n,
  },
]

/**
 * Las categorías del hogar de ejemplo, como **índice** contra el árbol del
 * núcleo — no como una taxonomía propia.
 *
 * ── Por qué dejó de tener la suya ───────────────────────────────────────────
 *
 * Este catálogo tenía sus 38 categorías escritas a mano, con otros nombres que
 * las del núcleo: «Casa > Servicios > Luz» donde `ARBOL_POR_DEFECTO` dice
 * «Vivienda > Suministros > Luz y gas». Mientras nadie instalaba el árbol, las
 * dos convivían sin tocarse. Desde que `instalarPlanDeCuentas` corre en el alta
 * de cada hogar, chocan — y de la peor manera posible, que es en silencio:
 * `resolveAccounts` reutiliza por nombre, dieciséis nombres coincidían
 * («Hipoteca», «Agua», «Supermercado», «Salud», «IRPF»…), y el hogar quedaba
 * con las dos taxonomías cruzadas y «Salud» colgando de la raíz en vez de de
 * «Familia». Ni error, ni aviso.
 *
 * Y había un daño mayor y anterior: quien cargaba el ejemplo y después
 * importaba un extracto veía al motor proponer rutas que su plan no tenía. Las
 * cinco capas trabajando y las propuestas cayendo en `rutasSinCuenta`, que
 * ninguna pantalla enseña.
 *
 * ── Cómo funciona ahora ─────────────────────────────────────────────────────
 *
 * Las claves `cat:*` **se quedan**: hay cientos de movimientos que las
 * referencian y moverlas sería un cambio enorme sin ningún beneficio. Lo que
 * cambia es que ya no llevan nombre ni padre propios: llevan una **ruta** del
 * árbol del núcleo, y el nombre, el tipo y la jerarquía salen de ahí. Si
 * mañana alguien renombra un nodo del árbol, esto rompe en un test —hay uno que
 * exige que toda ruta resuelva— y no en la demo de un cliente.
 *
 * Dos claves pueden apuntar a la misma ruta: `cat:luz` y `cat:gas` van las dos
 * a «Luz y gas», porque el árbol del núcleo no las separa. No se pierde ni un
 * céntimo —los dos movimientos van a la misma cuenta— pero sí se pierde poder
 * enseñarlas por separado, que es una de las series con estacionalidad de la
 * demo. Se asume: la alternativa era que el árbol del núcleo tuviera una hoja
 * más sólo para que la demo luciera, y el árbol es del cliente, no de la demo.
 */
const RUTA_DE_CATEGORIA: Readonly<Record<string, RutaDeCategoria>> = {
  'cat:hipoteca': 'Vivienda > Hipoteca',
  'cat:luz': 'Vivienda > Suministros > Luz y gas',
  'cat:agua': 'Vivienda > Suministros > Agua',
  // Colapsa con `cat:luz`. Ver la cabecera.
  'cat:gas': 'Vivienda > Suministros > Luz y gas',
  'cat:telecom': 'Vivienda > Suministros > Internet y telefonía',
  'cat:comunidad': 'Vivienda > Comunidad de propietarios',
  // Cambia de rama a propósito: en el árbol del núcleo los seguros van juntos,
  // porque la pregunta que se hace un patrimonio es «cuánto pago de seguros»
  // y no «cuánto me cuesta la casa incluyendo su seguro» — eso lo contesta la
  // dimensión propiedad, que es el otro eje.
  'cat:seguro-hogar': 'Seguros > Seguro de hogar',
  'cat:domestico': 'Personal doméstico > Salarios del personal',
  'cat:obra': 'Vivienda > Obras y reformas',
  'cat:ibi': 'Vivienda > IBI y tasas municipales',
  'cat:colegio': 'Educación > Colegio y universidad',
  'cat:super': 'Día a día > Supermercado',
  'cat:restaurantes': 'Día a día > Restaurantes y bares',
  'cat:salud': 'Salud > Dentista',
  'cat:viajes': 'Viajes > Alojamiento',
  // Adobe Creative Cloud. Ver la hoja nueva que se le añadió al árbol: es una
  // herramienta de trabajo y meterla en «Suscripciones y streaming» la habría
  // sumado con Netflix en el mismo total.
  'cat:software': 'Ocio y cultura > Software y herramientas',
  'cat:prensa': 'Ocio y cultura > Suscripciones y streaming',
  'cat:gimnasio': 'Ocio y cultura > Deporte y gimnasio',
  'cat:asesoria': 'Honorarios profesionales > Asesoría fiscal y contable',
  'cat:comisiones': 'Gastos financieros > Comisiones bancarias',
  'cat:oficina': 'Sociedad > Oficina',
  'cat:combustible': 'Transporte > Combustible',
  // «Seguro y taller», y su único movimiento es el seguro del coche. Va al
  // seguro y no al taller porque es lo que el movimiento es — y es además la
  // ruta que el diccionario ES emite para las aseguradoras, así que la demo
  // enseña la misma cuenta que va a usar el motor en un libro de verdad.
  'cat:taller': 'Seguros > Seguro de vehículos',
  'cat:irpf': 'Impuestos > IRPF',
  'cat:sociedades': 'Impuestos > Impuesto de sociedades',
  'cat:sin-categorizar': 'Sin categorizar',
  // La bolsa de INGRESO, que antes no existía: el traspaso sugerido entraba
  // por la de gasto. Un ingreso en una cuenta de gasto no rompe la partida
  // doble —balancea igual— pero cuenta con el signo cambiado en cualquier
  // informe que separe gasto de ingreso, y ésa es la mitad de las pantallas.
  'cat:sin-categorizar-ingreso': 'Ingresos sin categorizar',
  'cat:honorarios': 'Ingresos > Honorarios y facturación',
  'cat:alquileres': 'Ingresos > Alquileres',
  'cat:distribuciones': 'Ingresos > Dividendos y distribuciones',
  'cat:intereses': 'Ingresos > Intereses y cupones',
}

/**
 * Las cuentas de categoría que el ejemplo necesita: las rutas de arriba **más
 * todos sus ancestros**, en orden de profundidad.
 *
 * Los ancestros hacen falta aunque no reciban un céntimo: sin «Vivienda» no se
 * puede colgar «Vivienda > Hipoteca», y sin la jerarquía el informe por área no
 * existe. Van con una clave derivada de la ruta —nadie los referencia por
 * nombre— y las hojas conservan su clave `cat:*` de siempre.
 */
const CATEGORY_ACCOUNTS: readonly SeedAccount[] = construirCategorias()

/** Qué clave de cuenta le corresponde a cada `cat:*`. Ver `cat:gas`. */
const CANONICA_DE_CATEGORIA: ReadonlyMap<string, string> = new Map(
  Object.entries(RUTA_DE_CATEGORIA).map(([clave, ruta]) => [clave, claveDeRuta(ruta)]),
)

/**
 * Añade a un mapa indexado por clave de cuenta las claves `cat:*` que colapsan.
 *
 * Hay dos mapas construidos a partir de `ALL_ACCOUNTS` —el de ids y el de
 * monedas— y los dos tienen que conocer los alias. Se hace con una sola
 * función porque la primera versión sólo arregló el de ids: el ejemplo se caía
 * más adelante, al buscar la moneda de `cat:gas`, con un error distinto que
 * parecía otro problema.
 */
function conAliasDeCategoria<T>(mapa: Map<string, T>): Map<string, T> {
  for (const [clave, canonica] of CANONICA_DE_CATEGORIA) {
    const valor = mapa.get(canonica)
    if (valor !== undefined) mapa.set(clave, valor)
  }
  return mapa
}

function claveDeRuta(ruta: RutaDeCategoria): string {
  // La primera clave `cat:*` que apunte a esa ruta manda, para que las cuentas
  // del ejemplo conserven los identificadores derivados que ya tenían. Si
  // ninguna la reclama —es un ancestro— se deriva de la ruta.
  for (const [clave, suya] of Object.entries(RUTA_DE_CATEGORIA)) {
    if (suya === ruta) return clave
  }
  return `cat:ruta:${ruta}`
}

function construirCategorias(): readonly SeedAccount[] {
  const necesarias = new Set<RutaDeCategoria>()
  for (const ruta of Object.values(RUTA_DE_CATEGORIA)) {
    const partes = ruta.split(SEPARADOR_DE_RUTA)
    for (let n = 1; n <= partes.length; n += 1) {
      necesarias.add(partes.slice(0, n).join(SEPARADOR_DE_RUTA))
    }
  }

  // Se recorre el árbol aplanado y no el conjunto, para que el orden sea el
  // suyo: preorden, o sea padres antes que hijos. `insertAccounts` resuelve
  // `parent_id` contra las que ya insertó, así que el orden no es cosmético.
  const salida: SeedAccount[] = []
  for (const nodo of aplanarArbol(ARBOL_POR_DEFECTO)) {
    if (!necesarias.has(nodo.ruta)) continue
    salida.push({
      key: claveDeRuta(nodo.ruta),
      kind: nodo.tipo,
      name: nodo.nombre,
      currency: 'EUR',
      ...(nodo.rutaDelPadre === null ? {} : { parent: claveDeRuta(nodo.rutaDelPadre) }),
    })
  }
  return salida
}

/**
 * Cuentas de sistema. Las de cambio son la contrapartida del método Selinger:
 * sin ellas, un gasto en dólares contra una categoría en euros no balancea por
 * moneda y el residuo se esconde en un redondeo.
 */
const SYSTEM_ACCOUNTS: readonly SeedAccount[] = [
  { key: 'sys:apertura-eur', kind: 'equity', name: 'Saldo de apertura', currency: 'EUR' },
  { key: 'sys:apertura-usd', kind: 'equity', name: 'Saldo de apertura (USD)', currency: 'USD' },
  { key: 'sys:cambio-eur', kind: 'trading', name: 'Cambio de moneda EUR', currency: 'EUR' },
  { key: 'sys:cambio-usd', kind: 'trading', name: 'Cambio de moneda USD', currency: 'USD' },
]

const ALL_ACCOUNTS: readonly SeedAccount[] = [
  ...BANK_ACCOUNTS,
  ...CATEGORY_ACCOUNTS,
  ...SYSTEM_ACCOUNTS,
]

const TRADING_ACCOUNT: Readonly<Record<Currency, string>> = {
  EUR: 'sys:cambio-eur',
  USD: 'sys:cambio-usd',
}

const OPENING_ACCOUNT: Readonly<Record<Currency, string>> = {
  EUR: 'sys:apertura-eur',
  USD: 'sys:apertura-usd',
}

interface CardSpec {
  readonly key: string
  readonly settledFrom: string
  readonly day: number
  readonly label: string
}

/** Tarjetas y de dónde se pagan. Se liquidan por el importe exacto del mes anterior. */
const CARDS: readonly CardSpec[] = [
  { key: 'bbva-visa', settledFrom: 'bbva-corriente', day: 5, label: 'BBVA Visa' },
  {
    key: 'caixa-mastercard',
    settledFrom: 'caixa-corriente',
    day: 7,
    label: 'CaixaBank Mastercard',
  },
  {
    key: 'santander-empresa',
    settledFrom: 'santander-sl',
    day: 9,
    label: 'Santander Tarjeta Empresa',
  },
  {
    key: 'millennium-cartao',
    settledFrom: 'millennium-corrente',
    day: 11,
    label: 'Millennium Cartão',
  },
  { key: 'amex-platinum', settledFrom: 'chase-checking', day: 25, label: 'Amex Platinum' },
]

// ── Catálogo de dimensiones ─────────────────────────────────────────────────

interface SeedDimension {
  readonly key: string
  readonly label: string
  readonly position: number
}

interface SeedDimensionValue {
  readonly key: string
  readonly dimension: string
  readonly label: string
  readonly parent?: string
}

const DIMENSIONS: readonly SeedDimension[] = [
  { key: 'propiedad', label: 'Propiedad', position: 1 },
  { key: 'entidad', label: 'Entidad', position: 2 },
  { key: 'persona', label: 'Persona', position: 3 },
  { key: 'proyecto', label: 'Proyecto', position: 4 },
]

/**
 * Las áreas cuelgan de su propiedad. El separador va en la etiqueta porque
 * `dimension_value_unique` es por (dimensión, etiqueta): tres propiedades con
 * un hijo "Obra" cada una necesitan tres etiquetas distintas, y la alternativa
 * —una dimensión por propiedad— rompe el reporte comparativo.
 */
function propertyValues(key: string, label: string): SeedDimensionValue[] {
  const areas = ['Obra', 'Servicios', 'Personal', 'Impuestos', 'Seguros']
  return [
    { key, dimension: 'propiedad', label },
    ...areas.map((area) => ({
      key: `${key}:${area.toLowerCase()}`,
      dimension: 'propiedad',
      label: `${label} · ${area}`,
      parent: key,
    })),
  ]
}

const DIMENSION_VALUES: readonly SeedDimensionValue[] = [
  ...propertyValues('prop:madrid', 'Casa Madrid'),
  ...propertyValues('prop:lisboa', 'Piso Lisboa'),
  ...propertyValues('prop:miami', 'Apartamento Miami'),

  { key: 'ent:personal', dimension: 'entidad', label: 'Personal' },
  { key: 'ent:sl', dimension: 'entidad', label: 'Iriarte Patrimonial SL' },

  { key: 'per:alvaro', dimension: 'persona', label: 'Álvaro Iriarte (titular)' },
  { key: 'per:marta', dimension: 'persona', label: 'Marta Ruiz (pareja)' },
  { key: 'per:mateo', dimension: 'persona', label: 'Mateo Iriarte' },
  { key: 'per:ines', dimension: 'persona', label: 'Inés Iriarte' },
  { key: 'per:lucia', dimension: 'persona', label: 'Lucía Ferreira (asistente)' },
  { key: 'per:gestoria', dimension: 'persona', label: 'Gestoría Ferrer (contador)' },

  { key: 'pro:reforma', dimension: 'proyecto', label: 'Reforma cocina Madrid' },
  { key: 'pro:temporada', dimension: 'proyecto', label: 'Alquiler de temporada Lisboa' },
  { key: 'pro:garaje', dimension: 'proyecto', label: 'Compra plaza de garaje' },
]

// ── Movimientos: estructura intermedia ──────────────────────────────────────

interface SeedDim {
  readonly value: string
  /** Peso en partes por millón. Entero, nunca fracción de coma flotante. */
  readonly ppm: number
}

interface SeedLeg {
  readonly account: string
  readonly amount: bigint
  readonly currency: Currency
  /** Los otros dos de los "tres números" de un gasto en el exterior. */
  readonly native?: { readonly amount: bigint; readonly currency: Currency } | undefined
  readonly memo?: string | undefined
  readonly isTransfer?: boolean | undefined
  readonly dims?: readonly SeedDim[] | undefined
}

interface SeedMovement {
  readonly seq: number
  readonly bookedOn: PlainDate
  readonly valuedOn?: PlainDate | undefined
  readonly description: string
  readonly legs: readonly SeedLeg[]
  /** Etiqueta interna para poder colgarle un review_item después. */
  readonly tag?: string | undefined
}

interface BuildContext {
  readonly rng: Rng
  readonly movements: SeedMovement[]
  readonly currencyOf: ReadonlyMap<string, Currency>
  readonly isCard: ReadonlySet<string>
  /** Cargos acumulados del mes por tarjeta, para liquidarla exacta el mes siguiente. */
  readonly cardCharges: Map<string, bigint>
}

function currencyOf(ctx: BuildContext, account: string): Currency {
  const currency = ctx.currencyOf.get(account)
  if (currency === undefined) throw new SeedError(`Cuenta desconocida en el ejemplo: ${account}`)
  return currency
}

/**
 * Cierra los residuos por moneda contra las cuentas de cambio.
 *
 * Es el mismo mecanismo que `balanceWithTradingAccounts` del núcleo, invocado
 * sobre su primitiva (`currencyImbalances`) porque las patas del sembrado
 * llevan dimensiones con peso y moneda nativa, y el `Posting` del núcleo no
 * transporta el ppm. La aritmética de balanceo sigue siendo la del núcleo.
 */
function closeWithTrading(legs: readonly SeedLeg[]): SeedLeg[] {
  const imbalances = currencyImbalances(asCorePostings(legs))
  if (imbalances.size === 0) return [...legs]
  const closed = [...legs]
  for (const currency of [...imbalances.keys()].sort()) {
    const residual = imbalances.get(currency) ?? 0n
    closed.push({
      account: TRADING_ACCOUNT[currency as Currency],
      amount: -residual,
      currency: currency as Currency,
      isTransfer: true,
      memo: 'Contrapartida de conversión de moneda',
    })
  }
  return closed
}

function asCorePostings(legs: readonly SeedLeg[]): Posting[] {
  return legs.map((leg) => ({
    accountId: leg.account as AccountId,
    amount: money(leg.amount, leg.currency),
  }))
}

function push(
  ctx: BuildContext,
  movement: Omit<SeedMovement, 'seq' | 'legs'> & { readonly legs: SeedLeg[] },
): void {
  const legs = closeWithTrading(movement.legs)
  // El invariante se comprueba acá y no sólo en el test: un ejemplo que no
  // balancea es peor que no tener ejemplo.
  assertBalanced(asCorePostings(legs))
  ctx.movements.push({ ...movement, legs, seq: ctx.movements.length })
}

interface ExpenseSpec {
  readonly on: PlainDate
  readonly description: string
  readonly from: string
  readonly category: string
  /** Magnitud positiva, en la moneda de la cuenta que paga. */
  readonly amount: bigint
  readonly dims?: readonly SeedDim[] | undefined
  readonly native?: { readonly amount: bigint; readonly currency: Currency } | undefined
  readonly memo?: string | undefined
  readonly valuedOn?: PlainDate | undefined
  readonly tag?: string | undefined
}

function expense(ctx: BuildContext, spec: ExpenseSpec): void {
  const payCurrency = currencyOf(ctx, spec.from)
  const categoryCurrency = currencyOf(ctx, spec.category)
  const categoryAmount = crossCurrency(spec.amount, payCurrency, categoryCurrency, spec.on)

  push(ctx, {
    bookedOn: spec.on,
    valuedOn: spec.valuedOn,
    description: spec.description,
    tag: spec.tag,
    legs: [
      {
        account: spec.from,
        amount: -spec.amount,
        currency: payCurrency,
        native: spec.native,
        memo: spec.memo,
      },
      {
        account: spec.category,
        amount: categoryAmount,
        currency: categoryCurrency,
        dims: spec.dims,
      },
    ],
  })

  if (ctx.isCard.has(spec.from)) {
    ctx.cardCharges.set(spec.from, (ctx.cardCharges.get(spec.from) ?? 0n) + spec.amount)
  }
}

interface IncomeSpec {
  readonly on: PlainDate
  readonly description: string
  readonly into: string
  readonly category: string
  readonly amount: bigint
  readonly dims?: readonly SeedDim[] | undefined
  readonly memo?: string | undefined
  readonly tag?: string | undefined
}

function income(ctx: BuildContext, spec: IncomeSpec): void {
  const intoCurrency = currencyOf(ctx, spec.into)
  const categoryCurrency = currencyOf(ctx, spec.category)
  const categoryAmount = crossCurrency(spec.amount, intoCurrency, categoryCurrency, spec.on)

  push(ctx, {
    bookedOn: spec.on,
    description: spec.description,
    tag: spec.tag,
    legs: [
      { account: spec.into, amount: spec.amount, currency: intoCurrency, memo: spec.memo },
      {
        account: spec.category,
        amount: -categoryAmount,
        currency: categoryCurrency,
        dims: spec.dims,
      },
    ],
  })
}

interface TransferSpec {
  readonly on: PlainDate
  readonly description: string
  readonly from: string
  readonly to: string
  readonly amount: bigint
  /** Importe recibido, si hubo conversión. Si no se pasa, se calcula. */
  readonly received?: bigint | undefined
  readonly tag?: string | undefined
}

function transfer(ctx: BuildContext, spec: TransferSpec): void {
  const fromCurrency = currencyOf(ctx, spec.from)
  const toCurrency = currencyOf(ctx, spec.to)
  const received = spec.received ?? crossCurrency(spec.amount, fromCurrency, toCurrency, spec.on)

  push(ctx, {
    bookedOn: spec.on,
    description: spec.description,
    tag: spec.tag,
    legs: [
      { account: spec.from, amount: -spec.amount, currency: fromCurrency, isTransfer: true },
      { account: spec.to, amount: received, currency: toCurrency, isTransfer: true },
    ],
  })
}

// ── Series recurrentes ──────────────────────────────────────────────────────

interface RecurringSpec {
  readonly day: number
  readonly description: string
  readonly account: string
  readonly category: string
  readonly amount: bigint
  readonly dims?: readonly SeedDim[] | undefined
  /** Meses del calendario en los que se cobra. Sin esto, todos. */
  readonly onlyMonths?: readonly number[] | undefined
  /** Sube a este importe en los últimos N meses del histórico. */
  readonly raiseTo?: { readonly amount: bigint; readonly lastMonths: number } | undefined
  /** Deja de cobrarse N meses antes del corte. */
  readonly stopsBefore?: number | undefined
}

const FULL = 1_000_000

const RECURRING: readonly RecurringSpec[] = [
  {
    day: 1,
    description: 'Hipoteca Casa Madrid — BBVA',
    account: 'bbva-corriente',
    category: 'cat:hipoteca',
    amount: 1_842_00n,
    dims: [
      { value: 'prop:madrid', ppm: FULL },
      { value: 'ent:personal', ppm: FULL },
    ],
  },
  {
    day: 5,
    description: 'Crédito habitação Millennium — Piso Lisboa',
    account: 'millennium-corrente',
    category: 'cat:hipoteca',
    amount: 612_40n,
    dims: [
      { value: 'prop:lisboa', ppm: FULL },
      { value: 'ent:sl', ppm: FULL },
    ],
  },
  {
    // La serie que sube: +22% en los últimos cuatro meses. Es el hallazgo que
    // la pantalla de fugas tiene que encontrar sola.
    day: 8,
    description: 'Seguro hogar Casa Madrid — Mapfre',
    account: 'caixa-corriente',
    category: 'cat:seguro-hogar',
    amount: 118_40n,
    raiseTo: { amount: 144_45n, lastMonths: 4 },
    dims: [
      { value: 'prop:madrid:seguros', ppm: FULL },
      { value: 'ent:personal', ppm: FULL },
    ],
  },
  {
    day: 3,
    description: 'Colegio Internacional — cuota mensual',
    account: 'santander-corriente',
    category: 'cat:colegio',
    amount: 1_180_00n,
    onlyMonths: [1, 2, 3, 4, 5, 6, 9, 10, 11, 12],
    dims: [
      { value: 'ent:personal', ppm: FULL },
      { value: 'per:mateo', ppm: 500_000 },
      { value: 'per:ines', ppm: 500_000 },
    ],
  },
  {
    day: 28,
    description: 'Nómina Lucía Ferreira — servicio doméstico',
    account: 'bbva-corriente',
    category: 'cat:domestico',
    amount: 1_250_00n,
    dims: [
      { value: 'prop:madrid:personal', ppm: FULL },
      { value: 'ent:personal', ppm: FULL },
      { value: 'per:lucia', ppm: FULL },
    ],
  },
  {
    day: 5,
    description: 'Comunidad de propietarios Madrid',
    account: 'caixa-corriente',
    category: 'cat:comunidad',
    amount: 215_00n,
    dims: [
      { value: 'prop:madrid:servicios', ppm: FULL },
      { value: 'ent:personal', ppm: FULL },
    ],
  },
  {
    day: 15,
    description: 'Canal de Isabel II — agua Casa Madrid',
    account: 'caixa-corriente',
    category: 'cat:agua',
    amount: 47_30n,
    onlyMonths: [1, 3, 5, 7, 9, 11],
    dims: [
      { value: 'prop:madrid:servicios', ppm: FULL },
      { value: 'ent:personal', ppm: FULL },
    ],
  },
  {
    day: 20,
    description: 'Movistar fibra y móviles',
    account: 'bbva-corriente',
    category: 'cat:telecom',
    amount: 89_90n,
    dims: [
      { value: 'prop:madrid:servicios', ppm: FULL },
      { value: 'ent:personal', ppm: FULL },
    ],
  },
  {
    day: 18,
    description: 'Naturgy gas Casa Madrid',
    account: 'caixa-corriente',
    category: 'cat:gas',
    amount: 61_20n,
    onlyMonths: [1, 2, 3, 4, 10, 11, 12],
    dims: [
      { value: 'prop:madrid:servicios', ppm: FULL },
      { value: 'ent:personal', ppm: FULL },
    ],
  },
  {
    // La serie que deja de cobrarse cinco meses antes del corte.
    day: 2,
    description: 'Gimnasio Metropolitan — cuota',
    account: 'bbva-visa',
    category: 'cat:gimnasio',
    amount: 78_00n,
    stopsBefore: 5,
    dims: [
      { value: 'ent:personal', ppm: FULL },
      { value: 'per:alvaro', ppm: FULL },
    ],
  },
  {
    day: 14,
    description: 'Adobe Creative Cloud',
    account: 'bbva-visa',
    category: 'cat:software',
    amount: 63_49n,
    dims: [{ value: 'ent:personal', ppm: FULL }],
  },
  {
    day: 19,
    description: 'Netflix y El País digital',
    account: 'bbva-visa',
    category: 'cat:prensa',
    amount: 35_98n,
    dims: [{ value: 'ent:personal', ppm: FULL }],
  },
  {
    day: 22,
    description: 'Seguro coche Mapfre',
    account: 'bbva-corriente',
    category: 'cat:taller',
    amount: 68_20n,
    dims: [{ value: 'ent:personal', ppm: FULL }],
  },
  {
    day: 10,
    description: 'Gestoría Ferrer — iguala mensual',
    account: 'santander-sl',
    category: 'cat:asesoria',
    amount: 450_00n,
    dims: [
      { value: 'ent:sl', ppm: FULL },
      { value: 'per:gestoria', ppm: FULL },
    ],
  },
  {
    day: 6,
    description: 'Condominium Association — Miami',
    account: 'chase-checking',
    category: 'cat:comunidad',
    amount: 780_00n,
    dims: [
      { value: 'prop:miami:servicios', ppm: FULL },
      { value: 'ent:personal', ppm: FULL },
    ],
  },
  {
    day: 9,
    description: 'Citizens Property Insurance — Miami',
    account: 'chase-checking',
    category: 'cat:seguro-hogar',
    amount: 412_00n,
    onlyMonths: [1, 4, 7, 10],
    dims: [
      { value: 'prop:miami:seguros', ppm: FULL },
      { value: 'ent:personal', ppm: FULL },
    ],
  },
  {
    day: 20,
    description: 'IRPF pago fraccionado',
    account: 'santander-corriente',
    category: 'cat:irpf',
    amount: 3_480_00n,
    onlyMonths: [1, 4, 7, 10],
    dims: [
      { value: 'ent:personal', ppm: FULL },
      { value: 'per:alvaro', ppm: FULL },
    ],
  },
  {
    day: 25,
    description: 'Impuesto de sociedades — Iriarte Patrimonial SL',
    account: 'santander-sl',
    category: 'cat:sociedades',
    amount: 9_240_00n,
    onlyMonths: [7],
    dims: [{ value: 'ent:sl', ppm: FULL }],
  },
  {
    day: 5,
    description: 'IBI Casa Madrid',
    account: 'caixa-alquileres',
    category: 'cat:ibi',
    amount: 1_186_40n,
    onlyMonths: [10],
    dims: [
      { value: 'prop:madrid:impuestos', ppm: FULL },
      { value: 'ent:personal', ppm: FULL },
    ],
  },
  {
    day: 12,
    description: 'IMI Piso Lisboa',
    account: 'millennium-corrente',
    category: 'cat:ibi',
    amount: 418_60n,
    onlyMonths: [4],
    dims: [
      { value: 'prop:lisboa:impuestos', ppm: FULL },
      { value: 'ent:sl', ppm: FULL },
    ],
  },
  {
    day: 10,
    description: 'Miami-Dade property tax',
    account: 'chase-checking',
    category: 'cat:ibi',
    amount: 2_840_00n,
    onlyMonths: [11],
    dims: [
      { value: 'prop:miami:impuestos', ppm: FULL },
      { value: 'ent:personal', ppm: FULL },
    ],
  },
  {
    // La comisión que el banco SÍ cobra y el libro sí tiene. Existe para que la
    // cuenta con delta se entienda: el hogar ya conoce esta línea, y la que
    // falta es otra del mismo banco que el extracto todavía no trajo.
    day: 20,
    description: 'Comisión de mantenimiento CaixaBank',
    account: 'caixa-corriente',
    category: 'cat:comisiones',
    amount: 12_50n,
    onlyMonths: [1, 4, 7, 10],
    dims: [{ value: 'ent:personal', ppm: FULL }],
  },
]

/**
 * Las series que el histórico generado enseña **de verdad**.
 *
 * No se devuelve la tabla `RECURRING` tal cual: con un histórico corto, la
 * serie que sube o la que deja de cobrarse pueden no llegar a existir, y
 * anunciarlas igual sería exactamente el dato inventado que el producto no se
 * permite. Se comprueba contra los movimientos que quedaron.
 */
function summarizeSeries(movements: readonly SeedMovement[]): {
  raised: string[]
  stopped: string[]
} {
  const amountsByDescription = new Map<string, Set<string>>()
  const lastMonthByDescription = new Map<string, string>()
  let lastMonth = ''
  for (const movement of movements) {
    const main = movement.legs[0]
    if (main === undefined) continue
    const seen = amountsByDescription.get(movement.description) ?? new Set<string>()
    seen.add(main.amount.toString())
    amountsByDescription.set(movement.description, seen)

    const month = movement.bookedOn.slice(0, 7)
    const previous = lastMonthByDescription.get(movement.description)
    if (previous === undefined || month > previous) {
      lastMonthByDescription.set(movement.description, month)
    }
    if (month > lastMonth) lastMonth = month
  }

  const raised = RECURRING.filter((spec) => {
    if (spec.raiseTo === undefined) return false
    const seen = amountsByDescription.get(spec.description)
    // Los dos importes tienen que estar: sin el de antes no hay subida que ver.
    const nuevo = spec.raiseTo.amount
    return seen?.has((-spec.amount).toString()) === true && seen.has((-nuevo).toString())
  }).map((spec) => spec.description)

  // Que la serie exista no prueba que haya dejado de cobrarse: con un histórico
  // corto, o con un `stopsBefore` que no llegue a morder, la serie llega hasta
  // el último mes y anunciarla como cesada sería el dato inventado que este
  // módulo no se permite. Se exige que su último mes sea anterior al último mes
  // del histórico, que es lo que el usuario va a ver en la pantalla.
  const stopped = RECURRING.filter((spec) => {
    if (spec.stopsBefore === undefined) return false
    const last = lastMonthByDescription.get(spec.description)
    return last !== undefined && last < lastMonth
  }).map((spec) => spec.description)

  return { raised, stopped }
}

// ── Generación del histórico ────────────────────────────────────────────────

const SUPERMARKETS = [
  'Mercadona Madrid',
  'El Corte Inglés Supermercado',
  'Carrefour Market',
  'Alcampo',
]
const RESTAURANTS = ['Taberna La Carmencita', 'Sushi Bar Nikkei', 'Casa Lucio', 'Bar Tomate']
const MIAMI_MERCHANTS = ['Whole Foods Brickell', 'Publix Miami Beach', 'Joe’s Stone Crab']

function pick(rng: Rng, list: readonly string[]): string {
  return list[rng.between(0, list.length - 1)] ?? list[0] ?? ''
}

function buildMovements(asOf: PlainDate, months: number, accounts: readonly SeedAccount[]) {
  const ctx: BuildContext = {
    rng: createRng(RNG_SEED),
    movements: [],
    currencyOf: conAliasDeCategoria(new Map(accounts.map((a) => [a.key, a.currency]))),
    isCard: new Set(CARDS.map((c) => c.key)),
    cardCharges: new Map(),
  }

  const first = monthBack(asOf, months - 1)
  const historyStart = dayIn(first.year, first.month, 1)

  // ── Apertura ──
  // Un asiento por moneda. El histórico es un recorte: sin apertura, los
  // saldos no cuadran nunca contra el banco y la reconciliación miente.
  for (const currency of ['EUR', 'USD'] as const) {
    const legs: SeedLeg[] = []
    let total = 0n
    for (const account of BANK_ACCOUNTS) {
      if (account.currency !== currency || account.opening === undefined) continue
      legs.push({ account: account.key, amount: account.opening, currency })
      total += account.opening
    }
    if (legs.length === 0) continue
    legs.push({ account: OPENING_ACCOUNT[currency], amount: -total, currency })
    push(ctx, {
      bookedOn: addDays(historyStart, -1),
      description: `Saldo de apertura del histórico (${currency})`,
      legs,
    })
  }

  // Las tarjetas arrancan con su deuda de apertura, que se liquida el primer
  // mes: si no, el primer extracto mostraría un pago que no corresponde a nada.
  for (const card of CARDS) {
    const spec = BANK_ACCOUNTS.find((a) => a.key === card.key)
    const opening = spec?.opening ?? 0n
    ctx.cardCharges.set(card.key, opening < 0n ? -opening : 0n)
  }

  for (let index = 0; index < months; index += 1) {
    const { year, month } = monthBack(asOf, months - 1 - index)
    const day = (n: number): PlainDate => dayIn(year, month, n)
    /** Meses que faltan hasta el corte. 0 es el mes en curso. */
    const remaining = months - 1 - index

    // ── Liquidación de tarjetas ──
    for (const card of CARDS) {
      const charged = ctx.cardCharges.get(card.key) ?? 0n
      ctx.cardCharges.set(card.key, 0n)
      if (charged <= 0n) continue
      transfer(ctx, {
        on: day(card.day),
        description: `Pago tarjeta ${card.label}`,
        from: card.settledFrom,
        to: card.key,
        amount: charged,
      })
    }

    // ── Recurrentes ──
    for (const spec of RECURRING) {
      if (spec.onlyMonths !== undefined && !spec.onlyMonths.includes(month)) continue
      if (spec.stopsBefore !== undefined && remaining < spec.stopsBefore) continue
      const amount =
        spec.raiseTo !== undefined && remaining < spec.raiseTo.lastMonths
          ? spec.raiseTo.amount
          : spec.amount
      expense(ctx, {
        on: day(spec.day),
        description: spec.description,
        from: spec.account,
        category: spec.category,
        amount,
        dims: spec.dims,
      })
    }

    // ── Luz, con estacionalidad de verdad ──
    const winter = month === 12 || month <= 3
    expense(ctx, {
      on: day(12),
      description: 'Iberdrola luz Casa Madrid',
      from: 'caixa-corriente',
      category: 'cat:luz',
      amount: 92_00n + (winter ? 41_00n : 0n) + ctx.rng.minor(-900, 1_400),
      dims: [
        { value: 'prop:madrid:servicios', ppm: FULL },
        { value: 'ent:personal', ppm: FULL },
      ],
    })

    // ── Gasto variable ──
    for (let i = 0; i < ctx.rng.between(4, 6); i += 1) {
      const slot = ctx.rng.between(0, 9)
      const card = slot <= 5 ? 'caixa-mastercard' : slot <= 8 ? 'bbva-visa' : 'millennium-cartao'
      const name = pick(ctx.rng, SUPERMARKETS)
      const on = day(ctx.rng.between(1, 28))
      expense(ctx, {
        on,
        valuedOn: addDays(on, 1),
        description: name,
        from: card,
        category: 'cat:super',
        amount: ctx.rng.minor(38_00, 176_00),
        dims: [{ value: 'ent:personal', ppm: FULL }],
      })
    }

    for (let i = 0; i < ctx.rng.between(2, 5); i += 1) {
      const name = pick(ctx.rng, RESTAURANTS)
      expense(ctx, {
        on: day(ctx.rng.between(1, 28)),
        description: name,
        from: 'bbva-visa',
        category: 'cat:restaurantes',
        amount: ctx.rng.minor(18_00, 145_00),
        dims: [{ value: 'ent:personal', ppm: FULL }],
      })
    }

    for (let i = 0; i < ctx.rng.between(1, 3); i += 1) {
      expense(ctx, {
        on: day(ctx.rng.between(1, 28)),
        description: 'Repsol estación de servicio',
        from: 'bbva-visa',
        category: 'cat:combustible',
        amount: ctx.rng.minor(48_00, 96_00),
        dims: [{ value: 'ent:personal', ppm: FULL }],
      })
    }

    // Salud a nombre de la pareja: es la categoría que en la vida real dispara
    // la conversación sobre qué ve el contador y qué no.
    if (ctx.rng.chance(40)) {
      expense(ctx, {
        on: day(ctx.rng.between(3, 26)),
        description: 'Clínica Dental Velázquez',
        from: 'caixa-corriente',
        category: 'cat:salud',
        amount: ctx.rng.minor(60_00, 420_00),
        dims: [
          { value: 'ent:personal', ppm: FULL },
          { value: 'per:marta', ppm: FULL },
        ],
      })
    }

    // Efectivo: primero se saca, después se gasta. Sin la retirada, el gasto en
    // efectivo aparecería de la nada y el saldo de la corriente sería falso.
    transfer(ctx, {
      on: day(ctx.rng.between(2, 10)),
      description: 'Retirada de efectivo cajero BBVA',
      from: 'bbva-corriente',
      to: 'efectivo-madrid',
      amount: BigInt(ctx.rng.between(2, 5)) * 100_00n,
    })
    for (let i = 0; i < ctx.rng.between(3, 5); i += 1) {
      expense(ctx, {
        on: day(ctx.rng.between(3, 28)),
        description: 'Gasto en efectivo',
        from: 'efectivo-madrid',
        category: ctx.rng.chance(50) ? 'cat:super' : 'cat:restaurantes',
        amount: ctx.rng.minor(20_00, 140_00),
        dims: [{ value: 'ent:personal', ppm: FULL }],
      })
    }

    // ── Gasto de la sociedad ──
    for (let i = 0; i < ctx.rng.between(1, 3); i += 1) {
      expense(ctx, {
        on: day(ctx.rng.between(2, 26)),
        description: 'Amazon Business — material de oficina',
        from: 'santander-empresa',
        category: 'cat:oficina',
        amount: ctx.rng.minor(42_00, 380_00),
        dims: [{ value: 'ent:sl', ppm: FULL }],
      })
    }

    // ── Estados Unidos: dólares de verdad, con cuentas de cambio ──
    for (let i = 0; i < ctx.rng.between(2, 4); i += 1) {
      const name = pick(ctx.rng, MIAMI_MERCHANTS)
      const on = day(ctx.rng.between(1, 27))
      expense(ctx, {
        on,
        valuedOn: addDays(on, 2),
        description: name,
        from: 'amex-platinum',
        category: ctx.rng.chance(60) ? 'cat:super' : 'cat:restaurantes',
        amount: ctx.rng.minor(35_00, 280_00),
        dims: [{ value: 'ent:personal', ppm: FULL }],
      })
    }

    // Tarjeta americana usada en Europa: el importe llega en dólares pero el
    // comercio cobró en euros. Los tres números, en el otro sentido.
    if (ctx.rng.chance(45)) {
      const native = ctx.rng.minor(180_00, 640_00)
      const on = day(ctx.rng.between(4, 24))
      expense(ctx, {
        on,
        description: 'Hotel Tivoli Lisboa',
        from: 'amex-platinum',
        category: 'cat:viajes',
        amount: crossCurrency(native, 'EUR', 'USD', on),
        native: { amount: native, currency: 'EUR' },
        dims: [{ value: 'ent:personal', ppm: FULL }],
      })
    }

    // Tarjeta española usada en Estados Unidos: importe en euros, comercio en
    // dólares. Es el caso clásico de los tres números.
    if (ctx.rng.chance(35)) {
      const native = ctx.rng.minor(90_00, 520_00)
      const on = day(ctx.rng.between(5, 25))
      expense(ctx, {
        on,
        description: 'B&H Photo New York',
        from: 'bbva-visa',
        category: 'cat:oficina',
        amount: crossCurrency(native, 'USD', 'EUR', on),
        native: { amount: native, currency: 'USD' },
        dims: [{ value: 'ent:personal', ppm: FULL }],
      })
    }

    // ── Obra: el gasto compartido 60/40 entre la persona y la sociedad ──
    if (remaining >= 6 && remaining <= 8) {
      const certification = [6_500_00n, 8_200_00n, 4_900_00n][8 - remaining] ?? 5_000_00n
      expense(ctx, {
        on: day(16),
        description: 'Reforma cocina Madrid — certificación de obra',
        from: 'santander-corriente',
        category: 'cat:obra',
        amount: certification,
        dims: [
          { value: 'prop:madrid:obra', ppm: FULL },
          { value: 'pro:reforma', ppm: FULL },
          // 60/40 entre la persona y la sociedad: el reparto con peso es el
          // diferencial estructural, y sin un caso real no se puede enseñar.
          { value: 'ent:personal', ppm: 600_000 },
          { value: 'ent:sl', ppm: 400_000 },
        ],
      })
    }

    // ── Ingresos ──
    income(ctx, {
      on: day(4),
      description: 'Alquiler Piso Lisboa',
      into: 'millennium-corrente',
      category: 'cat:alquileres',
      amount: 1_450_00n,
      dims: [
        { value: 'prop:lisboa', ppm: FULL },
        { value: 'ent:sl', ppm: FULL },
        { value: 'pro:temporada', ppm: FULL },
      ],
    })
    income(ctx, {
      on: day(6),
      description: 'Alquiler plaza de garaje Madrid',
      into: 'caixa-alquileres',
      category: 'cat:alquileres',
      amount: 180_00n,
      dims: [
        { value: 'prop:madrid', ppm: FULL },
        { value: 'ent:sl', ppm: FULL },
        { value: 'pro:garaje', ppm: FULL },
      ],
    })
    income(ctx, {
      on: day(3),
      description: 'Rent Apartamento Miami',
      into: 'chase-checking',
      category: 'cat:alquileres',
      amount: 3_200_00n,
      dims: [
        { value: 'prop:miami', ppm: FULL },
        { value: 'ent:personal', ppm: FULL },
      ],
    })

    if (ctx.rng.chance(65)) {
      income(ctx, {
        on: day(ctx.rng.between(8, 26)),
        description: 'Honorarios consultoría estratégica',
        into: 'santander-sl',
        category: 'cat:honorarios',
        amount: ctx.rng.minor(4_500_00, 12_400_00),
        dims: [
          { value: 'ent:sl', ppm: FULL },
          { value: 'per:alvaro', ppm: FULL },
        ],
      })
    }

    // La distribución grande: un solo mes, y se nota en todos los reportes.
    if (remaining === 5) {
      income(ctx, {
        on: day(17),
        description: 'Distribución fondo Arcano IX',
        into: 'santander-sl',
        category: 'cat:distribuciones',
        amount: 85_000_00n,
        dims: [{ value: 'ent:sl', ppm: FULL }],
      })
    }

    if (month % 3 === 0) {
      income(ctx, {
        on: day(27),
        description: 'Intereses Millennium Poupança',
        into: 'millennium-poupanca',
        category: 'cat:intereses',
        amount: ctx.rng.minor(96_00, 148_00),
        dims: [{ value: 'ent:sl', ppm: FULL }],
      })
      income(ctx, {
        on: day(27),
        description: 'Interest Chase Savings',
        into: 'chase-savings',
        category: 'cat:intereses',
        amount: ctx.rng.minor(180_00, 260_00),
        dims: [{ value: 'ent:personal', ppm: FULL }],
      })
      income(ctx, {
        on: day(28),
        description: 'Schwab cash sweep interest',
        into: 'schwab-efectivo',
        category: 'cat:intereses',
        amount: ctx.rng.minor(120_00, 190_00),
        dims: [{ value: 'ent:personal', ppm: FULL }],
      })
    }

    // ── Traspasos internos ──
    // Los importes no son decorativos: la sociedad es la que cobra y las
    // cuentas personales son las que pagan, así que sin estos dos traspasos
    // las corrientes terminarían en descubierto de decenas de miles de euros y
    // el ejemplo no resistiría que un cliente le mirara los saldos.
    transfer(ctx, {
      on: day(2),
      description: 'Traspaso de Iriarte Patrimonial SL a cuenta personal',
      from: 'santander-sl',
      to: 'bbva-corriente',
      amount: 7_000_00n,
    })
    transfer(ctx, {
      on: day(2),
      description: 'Traspaso de Iriarte Patrimonial SL para colegio e impuestos',
      from: 'santander-sl',
      to: 'santander-corriente',
      amount: 3_500_00n,
    })
    transfer(ctx, {
      on: day(3),
      description: 'Traspaso a CaixaBank para gastos de casa',
      from: 'bbva-corriente',
      to: 'caixa-corriente',
      amount: 1_200_00n,
    })
    transfer(ctx, {
      on: day(27),
      description: 'Traspaso a cuenta de ahorro',
      from: 'bbva-corriente',
      to: 'bbva-ahorro',
      amount: 800_00n,
    })
    transfer(ctx, {
      on: day(26),
      description: 'Transferência para poupança',
      from: 'millennium-corrente',
      to: 'millennium-poupanca',
      amount: 300_00n,
    })
    transfer(ctx, {
      on: day(24),
      description: 'Transfer to Chase Savings',
      from: 'chase-checking',
      to: 'chase-savings',
      amount: 1_500_00n,
    })
    if (ctx.rng.chance(60)) {
      transfer(ctx, {
        on: day(15),
        description: 'ATM withdrawal Miami',
        from: 'chase-checking',
        to: 'efectivo-miami',
        amount: BigInt(ctx.rng.between(2, 4)) * 100_00n,
      })
      expense(ctx, {
        on: day(18),
        description: 'Gasto en efectivo Miami',
        from: 'efectivo-miami',
        category: 'cat:restaurantes',
        amount: ctx.rng.minor(25_00, 120_00),
        dims: [{ value: 'ent:personal', ppm: FULL }],
      })
    }

    // Conversión de verdad: euros que salen y dólares que entran, a la tasa del
    // mes. El residuo queda en las cuentas de cambio, que es de donde después
    // sale la barra de efecto cambiario.
    if (month % 3 === 1) {
      transfer(ctx, {
        on: day(21),
        description: 'Transferencia BBVA a Chase (conversión EUR/USD)',
        from: 'bbva-ahorro',
        to: 'chase-checking',
        amount: 6_000_00n,
      })
    }

    // ── Lo que va a quedar pendiente de revisión ──
    if (remaining <= 1) {
      expense(ctx, {
        // Antes del día 13 a propósito: así el movimiento del mes en curso cae
        // dentro del corte por defecto y la cola de revisión de la demo no
        // queda con un elemento menos según la fecha.
        on: day(ctx.rng.between(4, 12)),
        description: `Cargo TRF ${ctx.rng.between(1000, 9999)} sin concepto`,
        from: 'santander-corriente',
        category: 'cat:sin-categorizar',
        amount: ctx.rng.minor(120_00, 940_00),
        tag: `sin-categorizar-${remaining}`,
      })
    }

    if (remaining === 1) {
      // Las dos patas de la misma transferencia, cada una por su lado y con dos
      // días de diferencia: exactamente lo que llega cuando cada banco exporta
      // su propio fichero. El emparejamiento es una propuesta, no un hecho.
      expense(ctx, {
        on: day(14),
        description: 'Transferencia enviada a cuenta propia',
        from: 'caixa-corriente',
        category: 'cat:sin-categorizar',
        amount: 3_000_00n,
        tag: 'traspaso-sugerido-salida',
      })
      income(ctx, {
        on: day(16),
        description: 'Transferência recebida de conta própria',
        into: 'millennium-corrente',
        // La bolsa de INGRESO, no la de gasto. Entraba contra la de gasto y no
        // rompía nada visible —la partida doble balancea igual— pero contaba
        // con el signo cambiado en toda pantalla que separe gasto de ingreso,
        // que son la mitad. El motor tiene las dos bolsas justamente por esto.
        category: 'cat:sin-categorizar-ingreso',
        amount: 3_000_00n,
        tag: 'traspaso-sugerido-entrada',
      })
    }

    if (remaining === 0) {
      // Dos cargos idénticos el mismo día. Pueden ser dos compras reales o un
      // duplicado del banco; el sistema no lo decide solo.
      for (const tag of ['duplicado-a', 'duplicado-b']) {
        expense(ctx, {
          on: day(6),
          description: 'El Corte Inglés Supermercado',
          from: 'caixa-mastercard',
          category: 'cat:super',
          amount: 84_20n,
          dims: [{ value: 'ent:personal', ppm: FULL }],
          tag,
        })
      }
    }
  }

  // Nada después del corte, pase lo que pase con los días recortados de cada
  // mes. Se filtra al final en vez de comprobarlo en cada generador: una sola
  // guardia que no se puede olvidar.
  const kept = ctx.movements.filter((m) => m.bookedOn <= asOf)
  kept.sort((a, b) =>
    a.bookedOn === b.bookedOn ? a.seq - b.seq : a.bookedOn < b.bookedOn ? -1 : 1,
  )
  return kept
}

// ── Persistencia ────────────────────────────────────────────────────────────

interface ResolvedAccount extends SeedAccount {
  readonly id: string
  /** true si la cuenta ya existía en el hogar y sólo se reutiliza. */
  readonly preexisting: boolean
}

async function currentTenantId(client: TenantClient): Promise<string> {
  const { rows } = await client.query<{ tenant_id: string | null }>(
    'select app_current_tenant() as tenant_id',
  )
  const tenantId = rows[0]?.tenant_id ?? null
  if (tenantId === null) {
    throw new SeedError(
      'El sembrado tiene que correr dentro de withTenant: sin app.tenant_id fijado, RLS no ' +
        'devolvería ni aceptaría ninguna fila.',
    )
  }
  return tenantId
}

export async function hasDemoData(client: TenantClient): Promise<boolean> {
  const { rows } = await client.query<{ present: boolean }>(
    'select exists(select 1 from import_batch where file_name = $1 and format = $2) as present',
    [DEMO_BATCH_FILE, DEMO_BATCH_FORMAT],
  )
  return rows[0]?.present === true
}

export async function seedDemoHousehold(
  client: TenantClient,
  opts: SeedOptions = {},
): Promise<SeedResult> {
  const asOf = parsePlainDate(opts.asOf ?? DEFAULT_AS_OF)
  const months = opts.months ?? DEFAULT_MONTHS
  if (!Number.isInteger(months) || months < 1 || months > MAX_MONTHS) {
    throw new SeedError(`months tiene que ser un entero entre 1 y ${MAX_MONTHS}, no ${months}`)
  }

  const tenantId = await currentTenantId(client)
  if (await hasDemoData(client)) {
    throw new SeedError(
      'Este hogar ya tiene el ejemplo cargado. Borralo con removeDemoData antes de volver a ' +
        'sembrarlo: dos ejemplos superpuestos dan saldos que no cuadran con nada.',
    )
  }

  const { rows: tenantRows } = await client.query<{ base_currency: string }>(
    'select base_currency from tenant',
  )
  const baseCurrency = (tenantRows[0]?.base_currency ?? 'EUR').trim().toUpperCase()

  const accounts = await resolveAccounts(client, tenantId)
  // Con los alias: `cat:gas` y `cat:luz` son la misma ruta del árbol, así que
  // hay una sola cuenta y dos claves que la nombran.
  const accountId = conAliasDeCategoria(new Map(accounts.map((a) => [a.key, a.id])))
  const accountName = new Map(accounts.map((a) => [a.key, a.name]))
  const values = await resolveDimensions(client, tenantId)

  const movements = buildMovements(asOf, months, ALL_ACCOUNTS)
  const series = summarizeSeries(movements)
  const first = monthBack(asOf, months - 1)
  const from = addDays(dayIn(first.year, first.month, 1), -1)

  // ── Identidad de cada asiento ──
  // El ordinal distingue dos cargos idénticos del mismo día, que es justo el
  // caso que el ejemplo siembra a propósito. Sin él, el índice único de huellas
  // rechazaría el segundo y el ejemplo no tendría duplicado que revisar.
  const withOrdinals = assignOrdinals(
    movements.map((movement) => {
      const main = movement.legs[0]
      if (main === undefined) throw new SeedError('Asiento sin patas en el ejemplo')
      // Sin `??`: si la cuenta no estuviera resuelta, caer a la clave del
      // catálogo produciría una huella calculada sobre un id que no existe.
      // No falla nada, y el hogar queda con huellas que no se corresponden con
      // sus asientos — el peor modo de fallo posible para un índice único.
      const account = accountId.get(main.account)
      if (account === undefined) throw new SeedError(`Cuenta desconocida: ${main.account}`)
      return {
        accountId: account,
        bookedOn: movement.bookedOn,
        amount: money(main.amount, main.currency),
        descriptionRaw: movement.description,
      }
    }),
  )

  const batchId = seededUuid(tenantId, 'batch')
  // Id y movimiento viajan juntos: emparejarlos después por índice es una
  // invitación a que un `?? ''` tape un desfase entre las dos listas.
  const entries = movements.map((movement, index) => ({
    movement,
    id: seededUuid(tenantId, `entry:${index}`),
  }))
  const entryIds = entries.map((entry) => entry.id)
  const fingerprints = withOrdinals.map((row) => transactionFingerprint(row))

  // ── Importes en la moneda de reporte ──
  let postingsWithoutBase = 0
  const postingRows: PostingRow[] = []
  const dimensionRows: { entryId: string; ordinal: number; valueId: string; ppm: number }[] = []

  for (const { movement, id: entryId } of entries) {
    for (const [ordinal, leg] of movement.legs.entries()) {
      // La misma fecha para las dos patas del asiento: si cada una tomara una
      // tasa distinta, los importes en moneda de reporte dejarían de sumar cero
      // y cualquier informe que agregue `base_amount` arrastraría el residuo.
      const converted = toBase(leg.amount, leg.currency, baseCurrency, movement.bookedOn)
      if (converted === null) postingsWithoutBase += 1
      const account = accountId.get(leg.account)
      if (account === undefined) throw new SeedError(`Cuenta desconocida: ${leg.account}`)
      postingRows.push({
        entryId,
        accountId: account,
        ordinal,
        amount: leg.amount,
        currency: leg.currency,
        nativeAmount: leg.native?.amount ?? null,
        nativeCurrency: leg.native?.currency ?? null,
        baseAmount: converted?.amount ?? null,
        baseCurrency: converted === null ? null : baseCurrency,
        fxNumerator: converted?.fx?.numerator ?? null,
        fxDenominator: converted?.fx?.denominator ?? null,
        fxAsOf: converted?.fx === undefined ? null : movement.bookedOn,
        fxSource: converted?.fx === undefined ? null : FX_SOURCE,
        memo: leg.memo ?? null,
        isTransfer: leg.isTransfer === true,
      })
      for (const dim of leg.dims ?? []) {
        const valueId = values.valueId.get(dim.value)
        if (valueId === undefined)
          throw new SeedError(`Valor de dimensión desconocido: ${dim.value}`)
        dimensionRows.push({ entryId, ordinal, valueId, ppm: dim.ppm })
      }
    }
  }

  // ── Reconciliación: 17 cuadran, 1 no, y se dice por qué ──
  const computed = new Map<string, bigint>()
  for (const row of postingRows) {
    computed.set(row.accountId, (computed.get(row.accountId) ?? 0n) + row.amount)
  }

  // La cuenta que no cuadra es una sola y está elegida a mano: el saldo
  // declarado es menor que el calculado porque falta un movimiento real que el
  // extracto todavía no trajo. Es el momento "wow" del paso 3 del onboarding —
  // 17 de 18 en 0,00 y de la que falta se sabe el motivo—, y sólo funciona si
  // el motivo es verdadero dentro del ejemplo, no una etiqueta puesta encima.
  const deltaAccount = BANK_ACCOUNTS.find((a) => a.key === 'caixa-corriente')
  if (deltaAccount === undefined) throw new SeedError('Falta la cuenta con delta del ejemplo')
  const deltaAmount = 47_35n
  const deltaReason =
    'Comisión por transferencia internacional que el banco cobró y el extracto de este período ' +
    'todavía no trae. El movimiento no existe en el libro: por eso el saldo declarado es menor.'

  const balances = BANK_ACCOUNTS.map((account) => {
    const id = accountId.get(account.key)
    if (id === undefined) throw new SeedError(`Cuenta desconocida: ${account.key}`)
    const total = computed.get(id) ?? 0n
    const declared = account.key === deltaAccount.key ? total - deltaAmount : total
    return { id, key: account.key, currency: account.currency, declared }
  })

  const deltas: SeedDelta[] = [
    {
      account: accountName.get(deltaAccount.key) ?? deltaAccount.name,
      currency: deltaAccount.currency,
      delta: toDecimalString(money(deltaAmount, deltaAccount.currency)),
      reason: deltaReason,
    },
  ]

  // ── Cola de revisión ──
  const entryByTag = new Map<string, TaggedEntry>()
  for (const { movement, id } of entries) {
    const main = movement.legs[0]
    if (movement.tag === undefined || main === undefined) continue
    entryByTag.set(movement.tag, {
      id,
      bookedOn: movement.bookedOn,
      amount: money(main.amount, main.currency),
    })
  }
  const reviews = buildReviews(entryByTag)

  const report = {
    ejemplo: true,
    nota:
      'Datos de ejemplo generados por seedDemoHousehold. No son movimientos reales de ningún ' +
      'banco: el lote se llama ejemplo:hogar-demo y se borra entero con removeDemoData.',
    as_of: asOf,
    desde: from,
    meses: months,
    cuentas_bancarias: BANK_ACCOUNTS.length,
    cuentas_conciliadas: BANK_ACCOUNTS.length - deltas.length,
    cuentas_con_delta: deltas,
    series_que_subieron: series.raised,
    series_que_dejaron_de_cobrarse: series.stopped,
    postings_sin_importe_base: postingsWithoutBase,
    moneda_de_reporte: baseCurrency,
  }

  // ── Escritura ──
  await insertAccounts(client, tenantId, accounts)
  await insertDimensions(client, tenantId, values)
  await client.query(
    `insert into import_batch (
       id, tenant_id, file_name, format, content_sha256, status,
       lines_read, imported, duplicates, needs_review, rejected, report
     ) values ($1, $2, $3, $4, $5, 'completed', $6, $6, 0, $7, 0, $8::jsonb)`,
    [
      batchId,
      tenantId,
      DEMO_BATCH_FILE,
      DEMO_BATCH_FORMAT,
      contentHash(tenantId, asOf, months),
      movements.length,
      reviews.filter((r) => r.state === 'pendiente').length,
      JSON.stringify(report),
    ],
  )

  await insertEntries(client, tenantId, batchId, movements, entryIds, fingerprints)
  const postingIds = await insertPostings(client, tenantId, postingRows)
  await insertPostingDimensions(client, tenantId, dimensionRows, postingIds, values.dimensionOf)
  await insertDeclaredBalances(client, tenantId, batchId, balances, asOf)
  await insertReviews(client, tenantId, batchId, reviews)

  return {
    batchId,
    asOf,
    from,
    months,
    baseCurrency,
    bankAccounts: BANK_ACCOUNTS.length,
    ledgerAccounts: CATEGORY_ACCOUNTS.length + SYSTEM_ACCOUNTS.length,
    dimensions: DIMENSIONS.length,
    dimensionValues: DIMENSION_VALUES.length,
    entries: movements.length,
    postings: postingRows.length,
    declaredBalances: balances.length,
    reconciled: balances.length - deltas.length,
    deltas,
    pendingReviews: reviews.filter((r) => r.state === 'pendiente').length,
    raisedSeries: series.raised,
    stoppedSeries: series.stopped,
    postingsWithoutBase,
  }
}

function contentHash(tenantId: string, asOf: string, months: number): string {
  return createHash('sha256')
    .update(`${DEMO_BATCH_FILE}\u001F${tenantId}\u001F${asOf}\u001F${months}`, 'utf8')
    .digest('hex')
}

interface BaseConversion {
  readonly amount: bigint
  readonly fx?: { readonly numerator: bigint; readonly denominator: bigint }
}

/**
 * Importe en la moneda de reporte, congelado a la tasa del mes.
 *
 * Devuelve null cuando no hay forma de convertir —un hogar cuya moneda de
 * reporte no sea ni EUR ni USD— y el llamador lo cuenta. Poner cero, o poner
 * el importe sin convertir, sería inventar plata.
 */
function toBase(
  amount: bigint,
  currency: Currency,
  baseCurrency: string,
  on: PlainDate,
): BaseConversion | null {
  if (currency === baseCurrency) return { amount }
  const rate = rateFor(on)
  if (currency === 'USD' && baseCurrency === 'EUR') {
    return {
      amount: convert(money(amount, 'USD'), 'EUR', E4, rate).amount,
      fx: { numerator: E4, denominator: rate },
    }
  }
  if (currency === 'EUR' && baseCurrency === 'USD') {
    return {
      amount: convert(money(amount, 'EUR'), 'USD', rate, E4).amount,
      fx: { numerator: rate, denominator: E4 },
    }
  }
  return null
}

interface PostingRow {
  readonly entryId: string
  readonly accountId: string
  readonly ordinal: number
  readonly amount: bigint
  readonly currency: Currency
  readonly nativeAmount: bigint | null
  readonly nativeCurrency: Currency | null
  readonly baseAmount: bigint | null
  readonly baseCurrency: string | null
  readonly fxNumerator: bigint | null
  readonly fxDenominator: bigint | null
  readonly fxAsOf: string | null
  readonly fxSource: string | null
  readonly memo: string | null
  readonly isTransfer: boolean
}

interface ReviewRow {
  readonly key: string
  readonly kind: 'posible_duplicado' | 'transferencia_sugerida' | 'sin_categorizar'
  readonly state: 'pendiente' | 'aceptado' | 'rechazado'
  readonly entryId: string | null
  readonly counterpartId: string | null
  readonly evidence: unknown
}

/** El asiento al que apunta una revisión, con lo que hace falta para probarla. */
interface TaggedEntry {
  readonly id: string
  readonly bookedOn: PlainDate
  readonly amount: Money
}

/**
 * La evidencia se **deriva** de los asientos que se sembraron, no se escribe a
 * mano junto a la explicación.
 *
 * Importa más de lo que parece: la evidencia es lo que el producto le enseña a
 * una persona para que decida. Si el importe y los días vienen de una constante
 * copiada, cambiar el movimiento generado deja la evidencia mintiendo sin que
 * falle nada, y la cola de revisión pasa a describir movimientos que no son los
 * que están en el libro.
 */
function buildReviews(entryByTag: ReadonlyMap<string, TaggedEntry>): ReviewRow[] {
  const rows: ReviewRow[] = []
  const at = (tag: string): TaggedEntry | null => entryByTag.get(tag) ?? null

  const duplicateA = at('duplicado-a')
  const duplicateB = at('duplicado-b')
  if (duplicateA !== null && duplicateB !== null) {
    rows.push({
      key: 'duplicado',
      kind: 'posible_duplicado',
      state: 'pendiente',
      entryId: duplicateB.id,
      counterpartId: duplicateA.id,
      evidence: {
        similitud: 1,
        dias_de_diferencia: differenceInDays(duplicateA.bookedOn, duplicateB.bookedOn),
        importe: toDecimalString(duplicateB.amount),
        moneda: duplicateB.amount.currency,
        motivo:
          'Dos cargos idénticos el mismo día en la misma tarjeta. Pueden ser dos compras ' +
          'reales; el sistema no descarta por su cuenta.',
      },
    })
  }

  const out = at('traspaso-sugerido-salida')
  const into = at('traspaso-sugerido-entrada')
  if (out !== null && into !== null) {
    const gap = differenceInDays(out.bookedOn, into.bookedOn)
    rows.push({
      key: 'traspaso',
      kind: 'transferencia_sugerida',
      state: 'pendiente',
      entryId: out.id,
      counterpartId: into.id,
      evidence: {
        dias_de_diferencia: gap,
        importe: toDecimalString(into.amount),
        moneda: into.amount.currency,
        motivo: `Salida y entrada del mismo importe en dos cuentas propias, con ${gap} días de gap.`,
      },
    })
  }

  for (const tag of ['sin-categorizar-1', 'sin-categorizar-0']) {
    const entry = at(tag)
    if (entry === null) continue
    rows.push({
      key: tag,
      kind: 'sin_categorizar',
      state: 'pendiente',
      entryId: entry.id,
      counterpartId: null,
      evidence: {
        importe: toDecimalString(entry.amount),
        moneda: entry.amount.currency,
        motivo: 'El descriptor no permite deducir la categoría. Hace falta una decisión humana.',
      },
    })
  }

  return rows
}

// ── Resolución de cuentas y dimensiones ─────────────────────────────────────

/**
 * Ids de las cuentas del ejemplo, reutilizando las que el hogar ya tuviera con
 * el mismo nombre.
 *
 * Si el nombre coincide pero el tipo o la moneda no, se falla en vez de
 * adivinar: asentar euros contra una cuenta en dólares no produce ningún error
 * de base de datos, sólo un patrimonio equivocado.
 */
async function resolveAccounts(client: TenantClient, tenantId: string): Promise<ResolvedAccount[]> {
  const { rows } = await client.query<{
    id: string
    name: string
    kind: string
    currency: string
  }>('select id, name, kind, currency from account where name = any($1::text[])', [
    ALL_ACCOUNTS.map((a) => a.name),
  ])
  const existing = new Map(rows.map((row) => [row.name, row]))

  return ALL_ACCOUNTS.map((account) => {
    const found = existing.get(account.name)
    if (found === undefined) {
      return { ...account, id: seededUuid(tenantId, `account:${account.key}`), preexisting: false }
    }
    if (found.kind !== account.kind || found.currency.trim() !== account.currency) {
      throw new SeedError(
        `El hogar ya tiene una cuenta llamada ${JSON.stringify(account.name)} que es ` +
          `${found.kind}/${found.currency.trim()} y el ejemplo la necesita ` +
          `${account.kind}/${account.currency}. Renombrala o sembrá en un hogar limpio.`,
      )
    }
    return { ...account, id: found.id, preexisting: true }
  })
}

interface ResolvedDimensions {
  readonly dimensions: readonly { key: string; id: string; preexisting: boolean }[]
  readonly values: readonly {
    key: string
    id: string
    dimensionId: string
    parentId: string | null
    label: string
    preexisting: boolean
  }[]
  readonly valueId: ReadonlyMap<string, string>
  /** Dimensión a la que pertenece cada valor: la tabla puente la necesita. */
  readonly dimensionOf: ReadonlyMap<string, string>
}

async function resolveDimensions(
  client: TenantClient,
  tenantId: string,
): Promise<ResolvedDimensions> {
  const { rows: dimRows } = await client.query<{ id: string; key: string }>(
    'select id, key from dimension where key = any($1::text[])',
    [DIMENSIONS.map((d) => d.key)],
  )
  const existingDims = new Map(dimRows.map((row) => [row.key, row.id]))

  const dimensions = DIMENSIONS.map((dimension) => {
    const found = existingDims.get(dimension.key)
    return {
      key: dimension.key,
      id: found ?? seededUuid(tenantId, `dimension:${dimension.key}`),
      preexisting: found !== undefined,
    }
  })
  const dimensionIdByKey = new Map(dimensions.map((d) => [d.key, d.id]))

  const { rows: valueRows } = await client.query<{
    id: string
    dimension_id: string
    label: string
  }>('select id, dimension_id, label from dimension_value where label = any($1::text[])', [
    DIMENSION_VALUES.map((v) => v.label),
  ])
  const existingValues = new Map(
    valueRows.map((row) => [`${row.dimension_id}\u001F${row.label}`, row.id]),
  )

  const idByKey = new Map<string, string>()
  const values = DIMENSION_VALUES.map((value) => {
    const dimensionId = dimensionIdByKey.get(value.dimension) ?? ''
    const found = existingValues.get(`${dimensionId}\u001F${value.label}`)
    const id = found ?? seededUuid(tenantId, `dimension_value:${value.key}`)
    idByKey.set(value.key, id)
    return {
      key: value.key,
      id,
      dimensionId,
      label: value.label,
      parentId: null as string | null,
      preexisting: found !== undefined,
    }
  })

  const withParents = values.map((value, index) => {
    const parentKey = DIMENSION_VALUES[index]?.parent
    return parentKey === undefined ? value : { ...value, parentId: idByKey.get(parentKey) ?? null }
  })

  return {
    dimensions,
    values: withParents,
    valueId: idByKey,
    dimensionOf: new Map(withParents.map((v) => [v.id, v.dimensionId])),
  }
}

// ── Inserciones masivas ─────────────────────────────────────────────────────

async function insertAccounts(
  client: TenantClient,
  tenantId: string,
  accounts: readonly ResolvedAccount[],
): Promise<void> {
  const fresh = accounts.filter((a) => !a.preexisting)
  if (fresh.length === 0) return
  const idByKey = new Map(accounts.map((a) => [a.key, a.id]))

  await client.query(
    `insert into account (
       id, tenant_id, kind, name, currency, institution, account_number, country, parent_id
     )
     select a.id, $1::uuid, a.kind::account_kind, a.name, a.currency,
            a.institution, a.account_number, a.country, a.parent_id
       from unnest($2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[],
                   $7::text[], $8::text[], $9::uuid[])
         as a(id, kind, name, currency, institution, account_number, country, parent_id)`,
    [
      tenantId,
      fresh.map((a) => a.id),
      fresh.map((a) => a.kind),
      fresh.map((a) => a.name),
      fresh.map((a) => a.currency),
      fresh.map((a) => a.institution ?? null),
      fresh.map((a) => a.accountNumber ?? null),
      fresh.map((a) => a.country ?? null),
      fresh.map((a) => (a.parent === undefined ? null : (idByKey.get(a.parent) ?? null))),
    ],
  )
}

async function insertDimensions(
  client: TenantClient,
  tenantId: string,
  resolved: ResolvedDimensions,
): Promise<void> {
  const freshDimensions = resolved.dimensions.filter((d) => !d.preexisting)
  if (freshDimensions.length > 0) {
    const byKey = new Map(DIMENSIONS.map((d) => [d.key, d]))
    await client.query(
      `insert into dimension (id, tenant_id, key, label, position)
       select d.id, $1::uuid, d.key, d.label, d.position
         from unnest($2::uuid[], $3::text[], $4::text[], $5::int[])
           as d(id, key, label, position)`,
      [
        tenantId,
        freshDimensions.map((d) => d.id),
        freshDimensions.map((d) => d.key),
        freshDimensions.map((d) => byKey.get(d.key)?.label ?? d.key),
        freshDimensions.map((d) => byKey.get(d.key)?.position ?? 0),
      ],
    )
  }

  // Padres antes que hijos: `parent_id` es una clave foránea a la misma tabla.
  const fresh = resolved.values.filter((v) => !v.preexisting)
  for (const generation of [
    fresh.filter((v) => v.parentId === null),
    fresh.filter((v) => v.parentId !== null),
  ]) {
    if (generation.length === 0) continue
    await client.query(
      `insert into dimension_value (id, tenant_id, dimension_id, label, parent_id)
       select v.id, $1::uuid, v.dimension_id, v.label, v.parent_id
         from unnest($2::uuid[], $3::uuid[], $4::text[], $5::uuid[])
           as v(id, dimension_id, label, parent_id)`,
      [
        tenantId,
        generation.map((v) => v.id),
        generation.map((v) => v.dimensionId),
        generation.map((v) => v.label),
        generation.map((v) => v.parentId),
      ],
    )
  }
}

async function insertEntries(
  client: TenantClient,
  tenantId: string,
  batchId: string,
  movements: readonly SeedMovement[],
  entryIds: readonly string[],
  fingerprints: readonly string[],
): Promise<void> {
  await client.query(
    `insert into entry (
       id, tenant_id, booked_on, valued_on, description, source, import_batch_id, fingerprint
     )
     select e.id, $1::uuid, e.booked_on, e.valued_on, e.description,
            'manual'::data_source, $2::uuid, e.fingerprint
       from unnest($3::uuid[], $4::date[], $5::date[], $6::text[], $7::text[])
         as e(id, booked_on, valued_on, description, fingerprint)`,
    [
      tenantId,
      batchId,
      entryIds,
      movements.map((m) => m.bookedOn),
      movements.map((m) => m.valuedOn ?? null),
      movements.map((m) => m.description),
      fingerprints,
    ],
  )
}

async function insertPostings(
  client: TenantClient,
  tenantId: string,
  rows: readonly PostingRow[],
): Promise<Map<string, string>> {
  const { rows: inserted } = await client.query<{
    id: string
    entry_id: string
    ordinal: number
  }>(
    `insert into posting (
       tenant_id, entry_id, account_id, ordinal, amount, currency,
       native_amount, native_currency, base_amount, base_currency,
       fx_numerator, fx_denominator, fx_as_of, fx_source, memo, is_transfer
     )
     select $1::uuid, p.entry_id, p.account_id, p.ordinal, p.amount, p.currency,
            p.native_amount, p.native_currency, p.base_amount, p.base_currency,
            p.fx_numerator, p.fx_denominator, p.fx_as_of, p.fx_source, p.memo, p.is_transfer
       from unnest($2::uuid[], $3::uuid[], $4::smallint[], $5::bigint[], $6::char(3)[],
                   $7::bigint[], $8::char(3)[], $9::bigint[], $10::char(3)[],
                   $11::bigint[], $12::bigint[], $13::date[], $14::text[], $15::text[],
                   $16::boolean[])
         as p(entry_id, account_id, ordinal, amount, currency,
              native_amount, native_currency, base_amount, base_currency,
              fx_numerator, fx_denominator, fx_as_of, fx_source, memo, is_transfer)
     returning id, entry_id, ordinal`,
    [
      tenantId,
      rows.map((r) => r.entryId),
      rows.map((r) => r.accountId),
      rows.map((r) => r.ordinal),
      rows.map((r) => r.amount.toString()),
      rows.map((r) => r.currency),
      rows.map((r) => (r.nativeAmount === null ? null : r.nativeAmount.toString())),
      rows.map((r) => r.nativeCurrency),
      rows.map((r) => (r.baseAmount === null ? null : r.baseAmount.toString())),
      rows.map((r) => r.baseCurrency),
      rows.map((r) => (r.fxNumerator === null ? null : r.fxNumerator.toString())),
      rows.map((r) => (r.fxDenominator === null ? null : r.fxDenominator.toString())),
      rows.map((r) => r.fxAsOf),
      rows.map((r) => r.fxSource),
      rows.map((r) => r.memo),
      rows.map((r) => r.isTransfer),
    ],
  )

  // Se indexa por (asiento, ordinal) y no por el orden de las filas devueltas:
  // `returning` no promete conservarlo, y si algún día no lo conserva, las
  // dimensiones se colgarían de la pata equivocada sin que nada fallara.
  return new Map(inserted.map((row) => [`${row.entry_id}\u001F${row.ordinal}`, row.id]))
}

async function insertPostingDimensions(
  client: TenantClient,
  tenantId: string,
  rows: readonly { entryId: string; ordinal: number; valueId: string; ppm: number }[],
  postingIds: ReadonlyMap<string, string>,
  dimensionOf: ReadonlyMap<string, string>,
): Promise<void> {
  if (rows.length === 0) return
  const postingId: string[] = []
  const dimensionId: string[] = []
  const valueId: string[] = []
  const weight: number[] = []

  for (const row of rows) {
    const posting = postingIds.get(`${row.entryId}\u001F${row.ordinal}`)
    const dimension = dimensionOf.get(row.valueId)
    if (posting === undefined || dimension === undefined) {
      throw new SeedError('No se pudo resolver la pata o la dimensión de una atribución')
    }
    postingId.push(posting)
    dimensionId.push(dimension)
    valueId.push(row.valueId)
    weight.push(row.ppm)
  }

  await client.query(
    `insert into posting_dimension (tenant_id, posting_id, dimension_id, dimension_value_id, weight_ppm)
     select $1::uuid, d.posting_id, d.dimension_id, d.dimension_value_id, d.weight_ppm
       from unnest($2::bigint[], $3::uuid[], $4::uuid[], $5::int[])
         as d(posting_id, dimension_id, dimension_value_id, weight_ppm)`,
    [tenantId, postingId, dimensionId, valueId, weight],
  )
}

async function insertDeclaredBalances(
  client: TenantClient,
  tenantId: string,
  batchId: string,
  balances: readonly { id: string; currency: string; declared: bigint }[],
  asOf: PlainDate,
): Promise<void> {
  await client.query(
    `insert into declared_balance (tenant_id, account_id, as_of, amount, currency, import_batch_id)
     select $1::uuid, b.account_id, $2::date, b.amount, b.currency, $3::uuid
       from unnest($4::uuid[], $5::bigint[], $6::char(3)[])
         as b(account_id, amount, currency)`,
    [
      tenantId,
      asOf,
      batchId,
      balances.map((b) => b.id),
      balances.map((b) => b.declared.toString()),
      balances.map((b) => b.currency),
    ],
  )
}

async function insertReviews(
  client: TenantClient,
  tenantId: string,
  batchId: string,
  rows: readonly ReviewRow[],
): Promise<void> {
  if (rows.length === 0) return
  await client.query(
    `insert into review_item (tenant_id, kind, state, entry_id, counterpart_id, evidence, import_batch_id)
     select $1::uuid, r.kind::review_kind, r.state::review_state, r.entry_id, r.counterpart_id,
            r.evidence::jsonb, $2::uuid
       from unnest($3::text[], $4::text[], $5::uuid[], $6::uuid[], $7::text[])
         as r(kind, state, entry_id, counterpart_id, evidence)`,
    [
      tenantId,
      batchId,
      rows.map((r) => r.kind),
      rows.map((r) => r.state),
      rows.map((r) => r.entryId),
      rows.map((r) => r.counterpartId),
      rows.map((r) => JSON.stringify(r.evidence)),
    ],
  )
}

// ── Borrado ─────────────────────────────────────────────────────────────────

/**
 * Revierte el lote del ejemplo y deja el hogar como estaba.
 *
 * Las cuentas y dimensiones se borran por el conjunto de ids derivado del
 * hogar, que es la misma función pura que las creó. Lo que ya existía antes
 * conservó su id propio, así que no está en ese conjunto y sobrevive — que es
 * exactamente la garantía que hace que el ejemplo se pueda ofrecer a alguien
 * que ya tiene datos cargados.
 */
export async function removeDemoData(client: TenantClient): Promise<{ removed: number }> {
  const tenantId = await currentTenantId(client)

  const { rows } = await client.query<{ id: string }>(
    'select id from import_batch where file_name = $1 and format = $2',
    [DEMO_BATCH_FILE, DEMO_BATCH_FORMAT],
  )
  const batchIds = rows.map((row) => row.id)

  let removed = 0
  const run = async (sql: string, params: unknown[]): Promise<void> => {
    const result = await client.query(sql, params)
    removed += result.rowCount ?? 0
  }

  // Todos los lotes de una pasada. Normalmente hay uno solo, pero recorrerlos
  // en un bucle con seis consultas por vuelta convierte una limpieza en un
  // número de viajes a la base que depende de los datos, y no hay ninguna razón
  // para pagarlo: las mismas seis consultas con un array de ids hacen lo mismo.
  if (batchIds.length > 0) {
    // Se resuelven los ids antes de borrar, en dos consultas que van derechas
    // al índice, en vez de un `delete ... where id in (subconsulta)`.
    //
    // No es una preferencia de estilo: con la subconsulta anidada, y sin
    // estadísticas frescas de unas tablas que se acaban de escribir, el
    // planificador elige un plan correlacionado que reejecuta el join por cada
    // fila candidata. Medido sobre este mismo ejemplo: 98 segundos para borrar
    // 797 filas de tablas de menos de 2.000. Con los ids en un array, el plan
    // es el mismo siempre y no depende de que alguien haya pasado un ANALYZE.
    const entryIds = (
      await client.query<{ id: string }>(
        'select id from entry where import_batch_id = any($1::uuid[])',
        [batchIds],
      )
    ).rows.map((row) => row.id)

    const postingIds =
      entryIds.length === 0
        ? []
        : (
            await client.query<{ id: string }>(
              'select id from posting where entry_id = any($1::uuid[])',
              [entryIds],
            )
          ).rows.map((row) => row.id)

    if (postingIds.length > 0) {
      await run('delete from posting_dimension where posting_id = any($1::bigint[])', [postingIds])
      await run('delete from posting where id = any($1::bigint[])', [postingIds])
    }
    await run('delete from review_item where import_batch_id = any($1::uuid[])', [batchIds])
    await run('delete from declared_balance where import_batch_id = any($1::uuid[])', [batchIds])
    await run('delete from entry where import_batch_id = any($1::uuid[])', [batchIds])
    await run('delete from import_batch where id = any($1::uuid[])', [batchIds])
  }

  const valueIds = DIMENSION_VALUES.map((v) => seededUuid(tenantId, `dimension_value:${v.key}`))
  await run('delete from dimension_value where id = any($1::uuid[]) and parent_id is not null', [
    valueIds,
  ])
  await run('delete from dimension_value where id = any($1::uuid[])', [valueIds])
  await run('delete from dimension where id = any($1::uuid[])', [
    DIMENSIONS.map((d) => seededUuid(tenantId, `dimension:${d.key}`)),
  ])

  // Las cuentas tienen jerarquía y `parent_id` es `on delete restrict`, así que
  // se borran por generaciones desde las hojas. El bucle no supone una
  // profundidad concreta: termina cuando una pasada no borra nada.
  const accountIds = ALL_ACCOUNTS.map((a) => seededUuid(tenantId, `account:${a.key}`))
  for (;;) {
    const result = await client.query(
      `delete from account
        where id = any($1::uuid[])
          and not exists (select 1 from account child where child.parent_id = account.id)`,
      [accountIds],
    )
    const deleted = result.rowCount ?? 0
    removed += deleted
    if (deleted === 0) break
  }

  return { removed }
}
