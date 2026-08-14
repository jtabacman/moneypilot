/**
 * Señales estructurales de un movimiento: lo que trae **además del texto**.
 *
 * El descriptor es la parte vistosa y la menos fiable. Alrededor de él llegan
 * datos que la entidad emite en campos propios —el IBAN de la contraparte, el
 * concepto de la Norma 43, el canal de pago, el signo— y que no dependen de cómo
 * un banco haya decidido redactar la línea ese mes. Este módulo los lee y devuelve
 * observaciones, cada una con su motivo escrito en castellano llano.
 *
 * ── Qué es una señal y qué no ───────────────────────────────────────────────
 *
 * Una señal es **evidencia positiva**: "esto es un traspaso interno", "esto es
 * efectivo". No es una categoría ni una decisión; quien clasifica las combina con
 * el comercio y con las reglas del hogar. Que no haya señal no significa lo
 * contrario de la señal, significa que no hubo nada que lo dijera.
 *
 * Por eso cada `motivo` cita el dato concreto que la produjo. Cuando el usuario
 * pregunte "¿por qué esta categoría?", la respuesta se arma con estos textos, y
 * una respuesta del estilo "porque sí" no vale.
 *
 * ── La señal que más importa ────────────────────────────────────────────────
 *
 * **Que la contraparte sea otra cuenta del propio hogar.** Es la más segura que
 * existe —no es una heurística sobre un texto, es una igualdad de IBAN— y la que
 * más distorsiona los totales cuando falta: sin ella, mover 2.000 € de la cuenta
 * corriente al ahorro sale en el informe como un gasto de 2.000 y un ingreso de
 * 2.000, y el mes entero deja de significar nada.
 *
 * Se afirma sólo con pruebas duras: IBAN o id de cuenta ya resuelto, o el nombre
 * de la contraparte idéntico al de una cuenta del hogar. Nada de parecidos: un
 * falso positivo acá **borra un gasto real** del informe, que es peor que no
 * detectar el traspaso.
 *
 * ── Norma 43: qué se puede interpretar y qué no ─────────────────────────────
 *
 * `concepto_comun` (01–17, 98, 99) es del estándar sectorial: significa lo mismo
 * en todas las entidades y sí se puede leer. `concepto_propio` es **de cada
 * banco**: el 007 de Sabadell no es el 007 de CaixaBank. Acá no se interpreta
 * nunca, y no por falta de ganas — inventar esa tabla produciría clasificaciones
 * seguras de sí mismas y equivocadas, que es la peor combinación posible. La
 * forma honesta de aprovecharlo sería una tabla por entidad escrita por quien
 * conoce la entidad, no adivinada acá.
 *
 * ── De dónde salen los datos ────────────────────────────────────────────────
 *
 * Módulo puro: sin red, sin base y sin reloj. El llamador arma
 * `MovimientoObservado` desde lo que ya guarda el `raw` de cada origen —
 * `payment_channel`, `personal_finance_category.primary` y `transaction_code` en
 * Plaid; `concepto_comun` y `concepto_propio` en la Norma 43— y desde la cuenta
 * contra la que se asienta. Traducir esos nombres es trabajo del importador; acá
 * llegan ya nombrados.
 */

import { normalizarIban } from './merchant.js'
import { type Money, toDecimalString } from './money.js'

export type TipoSenal =
  /** Las dos patas son cuentas del hogar: el dinero cambia de sitio, no se gasta. */
  | 'traspaso_interno'
  /** Dinero que entra de fuera. */
  | 'ingreso'
  /** Efectivo: cajero, ventanilla. */
  | 'efectivo'
  /** Un cargo del banco por operar, no una compra. */
  | 'comision'
  /** Recibo domiciliado u orden permanente: se repite solo todos los meses. */
  | 'domiciliacion'
  /** Operación con tarjeta. */
  | 'tarjeta'

export interface Senal {
  readonly tipo: TipoSenal
  /** Por qué. En castellano llano y citando el dato: es lo que se le enseña al usuario. */
  readonly motivo: string
}

/** La taxonomía de Plaid, tal como la manda Plaid. Ver `plaid/map.ts`. */
export interface CategoriaDeAgregador {
  readonly primary?: string | undefined
  /** 'VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'. */
  readonly confidenceLevel?: string | undefined
}

export interface MovimientoObservado {
  /** Con el signo del libro ya normalizado: negativo sale de la cuenta. */
  readonly amount: Money
  /** La cuenta contra la que se asienta la pata bancaria. */
  readonly accountId?: string | undefined
  /**
   * Sólo 'asset' o 'liability': una pata bancaria no puede ser otra cosa. Importa
   * porque en una cuenta de deuda un importe positivo no es un ingreso.
   */
  readonly accountKind?: 'asset' | 'liability' | undefined
  readonly counterpartIban?: string | undefined
  readonly counterpartName?: string | undefined
  /** Cuando el importador ya resolvió la contraparte a una cuenta del hogar. */
  readonly counterpartAccountId?: string | undefined
  /** Plaid: 'in store', 'online' u 'other'. */
  readonly paymentChannel?: string | undefined
  readonly personalFinanceCategory?: CategoriaDeAgregador | undefined
  /** Plaid en Europa: 'direct debit', 'transfer', 'atm'… Lo emite la entidad. */
  readonly transactionCode?: string | undefined
  /** Norma 43, concepto común: 01–17, 98, 99. Estándar del sector. */
  readonly conceptoComun?: string | undefined
  /**
   * Norma 43, concepto propio. **Se acepta y no se interpreta.**
   *
   * Está declarado justo para que se vea que la omisión es deliberada: sin saber
   * qué entidad emitió el fichero, un 007 no significa nada. Ver la cabecera.
   */
  readonly conceptoPropio?: string | undefined
}

export interface CuentaPropia {
  readonly id: string
  readonly nombre?: string | undefined
  readonly iban?: string | undefined
}

export interface ContextoDelHogar {
  /**
   * Las cuentas del hogar, para poder reconocer un traspaso interno. Si no se
   * pasan, esa señal no se emite nunca — y su ausencia no prueba nada.
   */
  readonly cuentasPropias?: readonly CuentaPropia[] | undefined
}

// ── Norma 43 ─────────────────────────────────────────────────────────────────

interface ConceptoComun {
  /** Cómo lo llama el estándar. Va literal al motivo. */
  readonly etiqueta: string
  /** La señal que produce, si produce alguna. */
  readonly senal?: TipoSenal | undefined
  /** Cuando sólo tiene ese sentido con un signo concreto. */
  readonly signo?: 'entra' | 'sale' | undefined
}

/**
 * Los conceptos comunes del CSB43, con la señal que produce cada uno.
 *
 * Están **todos**, también los que no producen ninguna, y eso es a propósito: la
 * lista completa deja ver que las ausencias son decisiones y no olvidos. Los tres
 * casos que más tientan y que se dejan en blanco:
 *
 *  · **01, talones y reintegros.** Mezcla cheques con reintegros por ventanilla.
 *    Sólo el segundo es efectivo, y el código no distingue cuál es.
 *  · **02, abonarés e ingresos.** Es dinero que entra, pero ingresar en tu propia
 *    cuenta el efectivo que ya tenías no es un ingreso: sería contarlo dos veces.
 *  · **04, giros y transferencias.** Dice que hubo una transferencia, no que sea
 *    entre cuentas propias. Una transferencia a un tercero también es 04, y
 *    tomarla por traspaso interno haría desaparecer el gasto del informe.
 */
const CONCEPTOS_COMUNES: Readonly<Record<string, ConceptoComun>> = {
  '01': { etiqueta: 'talones y reintegros' },
  '02': { etiqueta: 'abonarés, entregas e ingresos' },
  '03': {
    etiqueta: 'domiciliados: recibos, letras y pagos por su cuenta',
    senal: 'domiciliacion',
  },
  '04': { etiqueta: 'giros, transferencias, traspasos y cheques' },
  '05': { etiqueta: 'amortizaciones de préstamos y créditos' },
  '06': { etiqueta: 'remesas de efectos' },
  '07': { etiqueta: 'suscripciones, dividendos pasivos y canjes' },
  '08': { etiqueta: 'dividendos, intereses y plusvalías', senal: 'ingreso', signo: 'entra' },
  '09': { etiqueta: 'compraventa de valores' },
  '10': { etiqueta: 'cheques de gasolina' },
  '11': { etiqueta: 'cajero automático', senal: 'efectivo' },
  '12': { etiqueta: 'tarjetas de crédito y de débito', senal: 'tarjeta' },
  '13': { etiqueta: 'operaciones de extranjero' },
  '14': { etiqueta: 'devoluciones e impagados' },
  // Cubre las nóminas (entra) y los seguros sociales que paga la empresa (sale).
  // Sólo el primer sentido es un ingreso, y el signo es lo que los separa.
  '15': { etiqueta: 'nóminas y seguros sociales', senal: 'ingreso', signo: 'entra' },
  '16': { etiqueta: 'timbres, corretaje y pólizas' },
  '17': {
    etiqueta: 'intereses, comisiones, custodia, gastos e impuestos',
    senal: 'comision',
  },
  '98': { etiqueta: 'anulaciones y correcciones de asiento' },
  '99': { etiqueta: 'varios' },
}

/** El concepto que habla de transferencias sin decir entre quiénes. Ver arriba. */
const CONCEPTO_TRANSFERENCIA = '04'

// ── Plaid ────────────────────────────────────────────────────────────────────

/**
 * De la taxonomía de Plaid se leen tres valores y sólo tres.
 *
 * INCOME, TRANSFER_IN y TRANSFER_OUT son afirmaciones sobre la **mecánica** del
 * movimiento, y ahí Plaid acierta. El resto de su taxonomía (FOOD_AND_DRINK,
 * TRANSPORTATION…) es una opinión sobre en qué se gastó, y traducirla a nuestro
 * plan de cuentas —si el seguro es de la sociedad o gasto personal— depende de
 * cómo esté montada esta familia, que un agregador no puede saber. La misma
 * frontera que ya traza `plaid/map.ts` al guardar la categoría en `raw` sin tocar
 * la contrapartida.
 */
const CATEGORIA_INGRESO = 'INCOME'
const CATEGORIAS_DE_TRANSFERENCIA: ReadonlySet<string> = new Set(['TRANSFER_IN', 'TRANSFER_OUT'])

/** Con esta confianza, el dato de Plaid es una conjetura y no se usa. */
const CONFIANZA_INSUFICIENTE: ReadonlySet<string> = new Set(['LOW', 'UNKNOWN'])

interface CodigoDeOperacion {
  readonly senal: TipoSenal
  readonly signo?: 'entra' | 'sale' | undefined
}

/**
 * `transaction_code`: lo emite la entidad, no Plaid, y sale de una lista cerrada.
 *
 * 'transfer' no está, por lo mismo que el 04 de la Norma 43. 'cheque',
 * 'adjustment' y 'bill payment' tampoco: un pago de factura puede ser
 * domiciliado o hecho a mano, y el código no lo aclara.
 */
const CODIGOS_DE_OPERACION: Readonly<Record<string, readonly CodigoDeOperacion[]>> = {
  atm: [{ senal: 'efectivo' }],
  cash: [{ senal: 'efectivo' }],
  'bank charge': [{ senal: 'comision' }],
  // Los intereses van en los dos sentidos y el signo decide cuál: pagados son un
  // cargo del banco; cobrados son dinero que entra.
  interest: [
    { senal: 'comision', signo: 'sale' },
    { senal: 'ingreso', signo: 'entra' },
  ],
  'direct debit': [{ senal: 'domiciliacion' }],
  'standing order': [{ senal: 'domiciliacion' }],
}

/**
 * Canal presencial. En un extracto bancario una operación presencial es con
 * tarjeta: el efectivo que se gasta en el comercio no llega nunca al feed, sólo
 * llega la retirada del cajero.
 *
 * 'online' no produce señal: por ahí viajan igual una compra con tarjeta, una
 * domiciliación y una transferencia, así que no distingue nada.
 */
const CANAL_PRESENCIAL = 'in store'

// ── Precedencia ──────────────────────────────────────────────────────────────

/**
 * Cuando dos fuentes dicen lo mismo se devuelve **una sola señal**, la de la
 * fuente más fuerte: dos motivos para el mismo tipo no aclaran nada y obligan a
 * quien lo lea a desempatar. El orden es el de cuánto puede equivocarse la
 * fuente.
 */
const FUERZA = {
  /** Una igualdad de IBAN. No hay interpretación posible. */
  contraparte: 4,
  /** Un código que emitió la entidad según un estándar. */
  entidad: 3,
  /** El enriquecimiento de un agregador: acierta mucho, pero opina. */
  agregador: 2,
  /** Aritmética nuestra sobre el signo y el tipo de cuenta. */
  signo: 1,
} as const

/** Orden fijo de salida. Que dos ejecuciones devuelvan lo mismo, en el mismo orden. */
const ORDEN: readonly TipoSenal[] = [
  'traspaso_interno',
  'ingreso',
  'efectivo',
  'comision',
  'domiciliacion',
  'tarjeta',
]

interface Candidata extends Senal {
  readonly fuerza: number
}

// ── Contrato público ─────────────────────────────────────────────────────────

export function senalesDe(
  movimiento: MovimientoObservado,
  contexto: ContextoDelHogar = {},
): Senal[] {
  const candidatas: Candidata[] = []
  const entra = movimiento.amount.amount > 0n

  const propia = cuentaPropiaDeLaContraparte(movimiento, contexto)
  if (propia !== null) {
    candidatas.push({
      tipo: 'traspaso_interno',
      motivo: propia.motivo,
      fuerza: FUERZA.contraparte,
    })
  }

  const concepto = conceptoComunDe(movimiento.conceptoComun)
  if (concepto !== null && concepto.dato.senal !== undefined) {
    const { senal, signo, etiqueta } = concepto.dato
    if (signo === undefined || (signo === 'entra') === entra) {
      candidatas.push({
        tipo: senal,
        motivo:
          `El concepto común ${concepto.codigo} de la Norma 43 es «${etiqueta}», y ese código ` +
          'significa lo mismo en todas las entidades.',
        fuerza: FUERZA.entidad,
      })
    }
  }

  const codigo = codigoDeOperacionDe(movimiento.transactionCode)
  if (codigo !== null) {
    for (const efecto of codigo.efectos) {
      if (efecto.signo !== undefined && (efecto.signo === 'entra') !== entra) continue
      candidatas.push({
        tipo: efecto.senal,
        motivo: `La entidad marca la operación como «${codigo.valor}» en transaction_code.`,
        fuerza: FUERZA.entidad,
      })
    }
  }

  const categoria = categoriaDeAgregadorDe(movimiento.personalFinanceCategory)
  if (categoria !== null && categoria.primary === CATEGORIA_INGRESO) {
    candidatas.push({
      tipo: 'ingreso',
      motivo: `El agregador clasifica el movimiento como ${CATEGORIA_INGRESO}${categoria.confianza}.`,
      fuerza: FUERZA.agregador,
    })
  }

  if (enMinusculas(movimiento.paymentChannel) === CANAL_PRESENCIAL) {
    candidatas.push({
      tipo: 'tarjeta',
      motivo:
        `El agregador marca el canal «${CANAL_PRESENCIAL}»: la compra se hizo en el comercio, y ` +
        'lo presencial que llega al extracto es con tarjeta.',
      fuerza: FUERZA.agregador,
    })
  }

  // El signo es lo último porque es lo más flojo, y sólo habla cuando nada
  // sugiere que el dinero venga de otra cuenta del propio hogar.
  if (
    entra &&
    movimiento.accountKind !== 'liability' &&
    !pareceTraspaso(propia, concepto, categoria)
  ) {
    candidatas.push({
      tipo: 'ingreso',
      motivo:
        `Entran ${toDecimalString(movimiento.amount)} ${movimiento.amount.currency} en una cuenta ` +
        `${movimiento.accountKind === 'asset' ? 'de activo' : 'del hogar'} y nada indica que ` +
        'salgan de otra cuenta propia.',
      fuerza: FUERZA.signo,
    })
  }

  return resolver(candidatas, propia !== null)
}

/**
 * Una señal por tipo, la de la fuente más fuerte, en orden fijo.
 *
 * Con un traspaso interno confirmado se descarta el ingreso venga de donde
 * venga: si el dinero sale de otra cuenta del hogar, no entró de ningún sitio, y
 * un agregador que diga INCOME sobre eso se está equivocando. Dejar las dos
 * señales obligaría a quien clasifica a resolver una contradicción que acá ya
 * está resuelta.
 */
function resolver(candidatas: readonly Candidata[], hayTraspaso: boolean): Senal[] {
  const mejor = new Map<TipoSenal, Candidata>()
  for (const candidata of candidatas) {
    if (hayTraspaso && candidata.tipo === 'ingreso') continue
    const actual = mejor.get(candidata.tipo)
    if (actual === undefined || candidata.fuerza > actual.fuerza)
      mejor.set(candidata.tipo, candidata)
  }

  const senales: Senal[] = []
  for (const tipo of ORDEN) {
    const candidata = mejor.get(tipo)
    if (candidata !== undefined) senales.push({ tipo: candidata.tipo, motivo: candidata.motivo })
  }
  return senales
}

// ── Contraparte ──────────────────────────────────────────────────────────────

interface ContraparteInterna {
  readonly cuenta: CuentaPropia
  readonly motivo: string
}

/**
 * ¿La contraparte es una cuenta de este hogar?
 *
 * Tres pruebas, todas de igualdad exacta y ninguna de parecido:
 *
 *  1. El id, cuando el importador ya lo resolvió. No hay nada que interpretar.
 *  2. El IBAN, normalizado por los dos lados — `es66 2100…` y `ES6621…` son el
 *     mismo número escrito distinto, y compararlos en crudo no encontraría nada.
 *  3. El nombre, **idéntico** al de la cuenta una vez quitados acentos y
 *     mayúsculas. Es la más floja de las tres y por eso exige igualdad completa:
 *     con un parecido, una transferencia a un tercero que se llame como tu cuenta
 *     desaparecería del informe.
 */
function cuentaPropiaDeLaContraparte(
  movimiento: MovimientoObservado,
  contexto: ContextoDelHogar,
): ContraparteInterna | null {
  const cuentas = contexto.cuentasPropias ?? []
  if (cuentas.length === 0) return null

  const propioId = texto(movimiento.counterpartAccountId)
  if (propioId !== null) {
    const cuenta = cuentas.find((candidata) => candidata.id === propioId)
    if (cuenta !== undefined) {
      return {
        cuenta,
        motivo:
          `La contraparte ya está resuelta a ${nombreDe(cuenta)}, que es una cuenta del propio ` +
          'hogar: el dinero cambia de sitio, no sale del patrimonio.',
      }
    }
  }

  const iban = normalizarIban(movimiento.counterpartIban)
  if (iban !== null) {
    const cuenta = cuentas.find((candidata) => normalizarIban(candidata.iban) === iban)
    if (cuenta !== undefined) {
      return {
        cuenta,
        motivo:
          `El IBAN de la contraparte (${iban}) es el de ${nombreDe(cuenta)}, una cuenta del ` +
          'propio hogar: el dinero cambia de sitio, no sale del patrimonio.',
      }
    }
  }

  const nombre = comparable(movimiento.counterpartName)
  if (nombre !== null) {
    const cuenta = cuentas.find((candidata) => comparable(candidata.nombre) === nombre)
    if (cuenta !== undefined) {
      return {
        cuenta,
        motivo:
          `El nombre de la contraparte coincide exactamente con el de ${nombreDe(cuenta)}, una ` +
          'cuenta del propio hogar.',
      }
    }
  }

  return null
}

/**
 * ¿Hay algo que sugiera que el dinero viene de otra cuenta propia?
 *
 * Sirve para callar la señal de ingreso, no para afirmar un traspaso. Un
 * TRANSFER_IN de Plaid o un 04 de la Norma 43 dicen "esto llegó por
 * transferencia", que puede ser tu propio ahorro o la factura que te pagó un
 * cliente. Sin saber cuál de las dos, afirmar "ingreso" es apostar; no decir nada
 * deja el movimiento en manos del resto del sistema, que es lo correcto.
 */
function pareceTraspaso(
  propia: ContraparteInterna | null,
  concepto: ConceptoLeido | null,
  categoria: CategoriaLeida | null,
): boolean {
  if (propia !== null) return true
  if (concepto?.codigo === CONCEPTO_TRANSFERENCIA) return true
  return categoria !== null && CATEGORIAS_DE_TRANSFERENCIA.has(categoria.primary)
}

// ── Lectura de los campos ────────────────────────────────────────────────────

interface ConceptoLeido {
  readonly codigo: string
  readonly dato: ConceptoComun
}

/**
 * El concepto común llega como dos caracteres, y hay bancos que mandan '3' donde
 * el estándar dice '03'. Un código que no está en la tabla no produce señal: el
 * estándar tiene los que tiene, y lo que no reconocemos no lo adivinamos.
 */
function conceptoComunDe(valor: string | null | undefined): ConceptoLeido | null {
  const limpio = texto(valor)
  if (limpio === null) return null
  const codigo = limpio.length === 1 ? `0${limpio}` : limpio
  const dato = Object.hasOwn(CONCEPTOS_COMUNES, codigo) ? CONCEPTOS_COMUNES[codigo] : undefined
  return dato === undefined ? null : { codigo, dato }
}

interface CodigoLeido {
  readonly valor: string
  readonly efectos: readonly CodigoDeOperacion[]
}

function codigoDeOperacionDe(valor: string | null | undefined): CodigoLeido | null {
  const limpio = enMinusculas(valor)
  if (limpio === null) return null
  const efectos = Object.hasOwn(CODIGOS_DE_OPERACION, limpio)
    ? CODIGOS_DE_OPERACION[limpio]
    : undefined
  return efectos === undefined ? null : { valor: limpio, efectos }
}

interface CategoriaLeida {
  readonly primary: string
  /** Trozo de frase con la confianza declarada, o vacío si no vino ninguna. */
  readonly confianza: string
}

function categoriaDeAgregadorDe(
  categoria: CategoriaDeAgregador | null | undefined,
): CategoriaLeida | null {
  if (categoria === null || categoria === undefined) return null
  const primary = enMayusculas(categoria.primary)
  if (primary === null) return null
  const nivel = enMayusculas(categoria.confidenceLevel)
  // Con confianza declarada baja, el dato es una conjetura del agregador. Una
  // conjetura sobre una conjetura no es una señal.
  if (nivel !== null && CONFIANZA_INSUFICIENTE.has(nivel)) return null
  return { primary, confianza: nivel === null ? '' : ` con confianza ${nivel}` }
}

/** Minúsculas y un solo espacio entre palabras: 'DIRECT_DEBIT' y 'Direct Debit' son lo mismo. */
function enMinusculas(valor: string | null | undefined): string | null {
  const limpio = texto(valor)
  return limpio === null ? null : limpio.toLowerCase().replace(/[_\s]+/g, ' ')
}

function enMayusculas(valor: string | null | undefined): string | null {
  const limpio = texto(valor)
  return limpio === null ? null : limpio.toUpperCase()
}

function nombreDe(cuenta: CuentaPropia): string {
  const nombre = texto(cuenta.nombre)
  return nombre === null ? `la cuenta ${cuenta.id}` : `la cuenta «${nombre}»`
}

/** Texto útil o nada: el vacío y el blanco son ausencia, no dato. */
function texto(valor: string | null | undefined): string | null {
  if (typeof valor !== 'string') return null
  const limpio = valor.trim()
  return limpio === '' ? null : limpio
}

/** Para comparar nombres: sin acentos, sin mayúsculas y sin espacios de más. */
function comparable(valor: string | null | undefined): string | null {
  const limpio = texto(valor)
  if (limpio === null) return null
  return limpio
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
}
