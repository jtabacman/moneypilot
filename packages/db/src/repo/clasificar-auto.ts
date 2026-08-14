/**
 * El orquestador: cinco capas que saben algo sobre un movimiento, y una sola
 * decisión.
 *
 * Las piezas ya existían y ninguna decide nada por su cuenta —las reglas del
 * usuario, la memoria del hogar, las señales estructurales, la taxonomía del
 * proveedor y el diccionario de comercios—. Lo que faltaba es esto: ponerlas en
 * orden, elegir una, y dejar escrito por qué.
 *
 * ── El orden de precedencia, y por qué ese ────────────────────────────────
 *
 *   1. regla        — lo que el usuario **escribió**
 *   2. memoria      — lo que el usuario **hizo antes**
 *   3. señal        — lo que la **estructura** del movimiento dice sin ambigüedad
 *   4. proveedor    — lo que **opina** el agregador
 *   5. diccionario  — lo que sabemos de los comercios **en general**
 *
 * El criterio es uno solo: **cuanto más cerca del usuario, más manda.** Una
 * regla es una instrucción explícita y no admite discusión. La memoria es la
 * misma voz pero deducida de sus actos, así que va justo detrás. La señal viene
 * del banco, que no opina: dice qué clase de operación fue. El proveedor y el
 * diccionario son terceros que hablan de comercios, no de esta familia, y por
 * eso van al final — el diccionario último porque es el único que ni siquiera
 * vio este movimiento: reconoce un nombre.
 *
 * Un movimiento recibe **como mucho una propuesta**, la de la capa más alta que
 * tenga algo que decir. No se combinan ni se votan: un empate entre capas no
 * existe porque hay un orden, y una propuesta con dos padres no se puede
 * explicar en una frase.
 *
 * ── Qué se aplica solo y qué se sugiere ───────────────────────────────────
 *
 * Es la decisión central del módulo, y el criterio no es «cuánto acierta» sino
 * **quién responde por el error**. Una clasificación automática equivocada no
 * se descubre el día que ocurre: se descubre tres meses después, mirando un
 * informe raro, y para entonces ya contaminó los totales, el presupuesto y la
 * confianza en todo lo demás. Una sugerencia que nadie confirma sólo cuesta que
 * el movimiento siga en «Sin categorizar», que es donde ya estaba.
 *
 *   · **Regla → se aplica.** El usuario escribió la instrucción, la vio en
 *     vista previa con su impacto y la guardó. Si se equivoca, se equivocó él,
 *     y la puede cambiar en un sitio.
 *   · **Memoria unánime y por encima del umbral → se aplica.** Es el hogar
 *     repitiendo su propia decisión: tres veces la misma categoría para el
 *     mismo comercio, nunca otra. La frase que lo explica —«lo mandaste ahí
 *     siete veces»— es comprobable por quien la lee.
 *   · **Memoria unánime que todavía no llega al umbral → se sugiere.** Hay una
 *     sola respuesta y evidencia real, pero dos veces puede ser un solo clic;
 *     ver `MINIMO_POR_DEFECTO`.
 *   · **Memoria NO unánime → no propone nada** y el movimiento cae a la capa
 *     siguiente. Es la doctrina de `memoria.ts` y se respeta: cuando el hogar
 *     usó dos categorías para el mismo comercio, elegir una por él es inventar
 *     una preferencia. Las dos opciones se ofrecen en pantalla, no acá.
 *   · **Señal → se aplica**, y sólo hay una que llegue a categoría. Ver
 *     `SENAL_A_RUTA`, donde están las seis y el porqué de las cinco que no.
 *   · **Proveedor → se sugiere, siempre.** Su `confidence_level` alto dice que
 *     él está seguro de su etiqueta; no dice nada de si su etiqueta significa
 *     una sola categoría en el plan de cuentas de esta familia. Son dos dudas y
 *     se multiplican.
 *   · **Diccionario → se sugiere, siempre**, incluso con confianza `alta`. Que
 *     Iberdrola sea luz es cierto para cualquiera; a qué cuenta de ESTE hogar
 *     va la luz, no lo sabe. Y no hace falta que lo aplique: en cuanto una
 *     persona confirma tres de esas sugerencias, el comercio pasa a la memoria
 *     y a partir de ahí se aplica solo, con la firma del hogar y no la nuestra.
 *     **El diccionario no es el clasificador: es lo que arranca la memoria.**
 *
 * Se aparta a propósito de la propuesta inicial en un punto: el traspaso
 * interno **no se aplica**, y no por prudencia sino porque no se puede.
 * Clasificar es mover la pata de contrapartida a una cuenta de gasto o de
 * ingreso, y un traspaso va contra una cuenta de activo — `assertCategoria` lo
 * rechaza, con razón, porque eso no es clasificar sino reescribir el asiento.
 * Un movimiento que parece un traspaso y quedó contra la bolsa de «Sin
 * categorizar» es un fallo del emparejador de transferencias, y se arregla ahí.
 *
 * ── Todo lo automático queda escrito ──────────────────────────────────────
 *
 * Cada aplicación deja su fila en `classification_change` con `procedencia` y
 * `motivo` (migración 010) y firmada con `autorAutomatico(capa)`. Eso compra
 * tres cosas: contestar «¿por qué esta categoría?» sin recalcular nada, poder
 * deshacer una capa entera, y —la que de verdad obliga— que la memoria no
 * aprenda de sí misma. Ver la precaución 1 de `memoria.ts`.
 *
 * ── Lo que el motor NO ve, y conviene saberlo antes de leer los números ────
 *
 * `senalesDe` y la tabla del proveedor leen campos que el esquema **no
 * guarda**: el IBAN de la contraparte, el concepto común de la Norma 43, el
 * `payment_channel` y la `personal_finance_category` de Plaid viven en el `raw`
 * de `ParsedStatement` y se pierden al persistir — `entry` no tiene columna
 * donde ponerlos. Por eso existe `observaciones`: quien acaba de importar los
 * tiene en memoria y se los puede pasar. Corolario incómodo y honesto: sobre un
 * libro ya cargado esas dos capas no pueden aportar nada, y sólo trabajan
 * enganchadas a la importación. El arreglo de fondo es una columna en `entry`,
 * no una heurística acá.
 */

import {
  buscarEnDiccionario,
  buscarPorRuta,
  type CuentaPropia,
  canonicalMerchant,
  mapearCategoriaDeProveedor,
  money,
  type Proveedor,
  type RutaDeCategoria,
  senalesDe,
  type TipoSenal,
} from '@moneypilot/core'
import type { TenantClient } from '../client.js'
import {
  type Procedencia,
  planRules,
  type RuleDimensionRow,
  reclassify,
  setDimensions,
  sqlSinCategorizar,
} from './classify.js'
import { autorAutomatico, type OpcionDeCategoria, proponerPorMemoria } from './memoria.js'
import { categoryTree } from './read-ledger.js'

export type { Procedencia }

// ── Contrato público ────────────────────────────────────────────────────────

/**
 * Sale del barril de `@moneypilot/db` como `PropuestaAutomatica`: `memoria.ts`
 * ya exporta una `Propuesta`, que es otra cosa —la memoria devuelve el recuerdo
 * entero, con sus opciones, y no una decisión—. Acá dentro conserva el nombre
 * corto porque acá no hay confusión posible.
 */
export interface Propuesta {
  readonly entryId: string
  /** Cuenta de gasto o ingreso de ESTE hogar, ya resuelta. */
  readonly categoryId: string
  /** Las dimensiones que viajan con la categoría. Vacío es lo normal. */
  readonly dimensiones: readonly RuleDimensionRow[]
  readonly procedencia: Procedencia
  /**
   * Qué regla lo decidió, cuando fue una. `null` en las otras cuatro capas.
   *
   * Viaja hasta `classification_change.rule_id`, y por eso está en el contrato
   * y no escondido: sin él, una clasificación hecha por una regla se registraría
   * igual que una hecha por la memoria, y «mostrame todo lo que puso esta regla»
   * —o deshacerlo— dejaría de tener respuesta. La procedencia dice de qué capa
   * vino; esto dice de cuál de las veinte reglas.
   */
  readonly ruleId: string | null
  /** En castellano llano y citando el dato. Es lo que se le enseña al usuario. */
  readonly motivo: string
  /**
   * Si se puede escribir sin preguntar. `false` no significa «peor propuesta»:
   * significa que la responsabilidad del error no es del hogar.
   */
  readonly automatica: boolean
  /**
   * De qué movimiento habla la propuesta.
   *
   * Va acá y no lo busca la pantalla porque el motor ya lo tiene delante: leer
   * la descripción por segunda vez sería una consulta más por cada propuesta, y
   * una propuesta sin el movimiento al lado no se puede enseñar. La fecha y el
   * importe son de la pata bancaria, que es la que una persona reconoce.
   */
  readonly movimiento: MovimientoDeLaPropuesta
}

/**
 * Lo que devuelve una capa: la propuesta sin el movimiento.
 *
 * Las capas no lo adjuntan porque no es asunto suyo — todas reciben la misma
 * `Pendiente` y copiarlo cinco veces sería cinco sitios donde olvidarse de un
 * campo. Lo pega el bucle, una sola vez, justo antes de guardar la propuesta.
 */
type PropuestaDeCapa = Omit<Propuesta, 'movimiento'>

export interface MovimientoDeLaPropuesta {
  readonly description: string
  readonly bookedOn: string
  /** En unidades mínimas, con el signo de la pata bancaria. */
  readonly amount: bigint
  readonly currency: string
  readonly accountName: string
}

/**
 * Lo que el origen trajo y la base no guarda.
 *
 * Lo rellena quien importa, que es el único momento en que existe. Los nombres
 * son los de `MovimientoObservado` (senales.ts) a propósito: acá no se traduce
 * nada, se transporta.
 */
export interface ObservacionDelOrigen {
  readonly counterpartName?: string | undefined
  readonly counterpartIban?: string | undefined
  /** Cuando el importador ya resolvió la contraparte a una cuenta del hogar. */
  readonly counterpartAccountId?: string | undefined
  readonly merchantName?: string | undefined
  /** Plaid: 'in store', 'online', 'other'. */
  readonly paymentChannel?: string | undefined
  /** Lo emite la entidad: 'direct debit', 'atm', 'bank charge'… */
  readonly transactionCode?: string | undefined
  /** Norma 43, concepto común: 01–17, 98, 99. */
  readonly conceptoComun?: string | undefined
  /** Norma 43, concepto propio. Se transporta y no se interpreta nunca. */
  readonly conceptoPropio?: string | undefined
  /** La categoría del agregador, en SU taxonomía y sin traducir. */
  readonly categoriaDelProveedor?: CategoriaDelProveedor | undefined
}

export interface CategoriaDelProveedor {
  readonly proveedor: Proveedor
  /** Plaid: `personal_finance_category.detailed`. Nunca la `primary`. */
  readonly detailed: string
  readonly primary?: string | undefined
  /** 'VERY_HIGH' … 'UNKNOWN'. La duda del proveedor, no la nuestra. */
  readonly confianza?: string | undefined
}

export interface ClasificarAutoOptions {
  /**
   * Acota la pasada. Sin esto se recorre **todo lo que esté sin categorizar**,
   * que es lo que quiere la pantalla de reglas; una importación pasa los suyos.
   */
  readonly entryIds?: readonly string[] | undefined
  /**
   * `false` no escribe nada y devuelve exactamente lo que haría. Es obligatorio
   * y no tiene valor por defecto por lo mismo que `soloSinCategorizar` en
   * `applyRule`: es la decisión, y quien llama tiene que haberla tomado.
   */
  readonly aplicar: boolean
  readonly observaciones?: ReadonlyMap<string, ObservacionDelOrigen> | undefined
  /** Cuántas decisiones del hogar hacen falta para que la memoria aplique sola. */
  readonly minimoDeMemoria?: number | undefined
  /**
   * Deja fuera las propuestas que una persona ya rechazó (`propuesta_rechazada`).
   *
   * Por defecto **false**, para no cambiar lo que ven /reglas ni la
   * importación: ahí la pregunta es «qué propondría el motor», y esconder lo
   * rechazado convertiría esa medición en otra cosa. Lo enciende la cola de
   * revisión, que es la única pantalla donde una propuesta rechazada volviendo
   * a aparecer significa que la cola no sirve.
   */
  readonly excluirRechazadas?: boolean | undefined
  /**
   * Cuántos movimientos sin categorizar mirar como mucho, de los más antiguos a
   * los más nuevos.
   *
   * Es para la pantalla, no para la importación. Medido: 566 sin categorizar se
   * recalculan en 75-140 ms, pero 4.528 tardan tres segundos —el coste es
   * superlineal y el cuello es el SQL, no el motor—, y un hogar que carga dos
   * años de historia por fichero llega a ese número el primer día.
   */
  readonly limite?: number | undefined
}

export interface ResumenDeCapa {
  readonly procedencia: Procedencia
  readonly propuestas: number
  /** De ésas, cuántas se podían escribir sin preguntar. */
  readonly automaticas: number
  /** Cuántas se escribieron de verdad. Con `aplicar: false` es siempre 0. */
  readonly aplicadas: number
}

/**
 * Una ruta que alguna capa quiso usar y que este hogar no tiene como cuenta.
 *
 * No es un error: es la lista de trabajo más rentable que produce el motor.
 * «El diccionario reconoció 180 movimientos como restaurantes y no tenés esa
 * categoría» es una frase accionable; crear la cuenta clasifica los 180 de
 * golpe. Ver `resolverRuta` para qué se intenta antes de rendirse.
 */
export interface RutaSinCuenta {
  readonly ruta: RutaDeCategoria
  readonly procedencia: Procedencia
  readonly movimientos: number
}

export interface ClasificacionAutomatica {
  readonly propuestas: readonly Propuesta[]
  /** Movimientos escritos. Con `aplicar: false`, cero. */
  readonly aplicadas: number
  /** Propuestas que quedaron sin escribir y esperan a una persona. */
  readonly sugeridas: number
  /** Movimientos mirados sobre los que ninguna capa tuvo nada que decir. */
  readonly sinPropuesta: number
  readonly porCapa: readonly ResumenDeCapa[]
  readonly rutasSinCuenta: readonly RutaSinCuenta[]
  /** Reglas que reventaron al evaluarse. La pasada sigue sin ellas. */
  readonly reglasFallidas: readonly { ruleId: string; name: string; error: string }[]
}

export class ClasificacionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClasificacionError'
  }
}

/**
 * Separador de unidad (0x1F), escrito como escape a propósito y por el mismo
 * motivo que en `identity.ts` y en `memoria.ts`: un carácter de control literal
 * en el fuente es invisible al leerlo y cualquier formateador se lo puede
 * comer. Va entre los campos de una clave compuesta para que dos combinaciones
 * distintas no puedan producir la misma cadena al concatenarse.
 */
const SEPARADOR = '\u001F'

/** El orden en que mandan. Es el contrato del módulo, no un detalle. */
const CAPAS: readonly Procedencia[] = ['regla', 'memoria', 'senal', 'proveedor', 'diccionario']

// ── Señales que llegan a categoría ──────────────────────────────────────────

/**
 * De una señal estructural a una ruta de categoría.
 *
 * Están **las seis**, también las cinco que no producen ninguna, y es a
 * propósito: la lista completa deja ver que las ausencias son decisiones. El
 * criterio para entrar es duro — la señal tiene que determinar la categoría por
 * sí sola, en cualquier hogar y sin mirar nada más:
 *
 *  · **traspaso_interno** → no hay categoría que poner. Las dos patas son
 *    cuentas propias, y apuntar una contrapartida a una cuenta de activo no es
 *    clasificar: es convertir el asiento en otra cosa. `assertCategoria` lo
 *    rechaza y hace bien.
 *  · **ingreso** → dice que entra dinero, no de dónde. Una nómina, un alquiler
 *    y la devolución de Hacienda son tres categorías distintas y las tres son
 *    ingresos. El movimiento ya está en «Ingresos sin categorizar», que dice
 *    exactamente eso: mandarlo a «Otros ingresos» cambiaría el nombre del
 *    problema por uno que parece resuelto.
 *  · **efectivo** → sacar del cajero mueve dinero de la cuenta al bolsillo. Es
 *    un traspaso a la cuenta de efectivo, no un gasto, y por eso el árbol por
 *    defecto no tiene ninguna categoría para eso. Gastar ese efectivo sí es un
 *    gasto, pero eso no llega nunca al extracto.
 *  · **comision** → la única. Un cargo que cobra el banco por operar es un
 *    gasto financiero en cualquier hogar del mundo, no depende del comercio ni
 *    del plan de cuentas, y lo afirma la entidad en un campo suyo (el concepto
 *    17 de la Norma 43, o un `transaction_code` de 'bank charge').
 *  · **domiciliacion** → dice cómo se pagó, no qué se pagó. Por domiciliación
 *    viajan la luz, el colegio y el seguro.
 *  · **tarjeta** → lo mismo, y todavía menos: casi todo el extracto es tarjeta.
 */
const SENAL_A_RUTA: Readonly<Record<TipoSenal, RutaDeCategoria | null>> = {
  traspaso_interno: null,
  ingreso: null,
  efectivo: null,
  comision: 'Gastos financieros > Comisiones bancarias',
  domiciliacion: null,
  tarjeta: null,
}

// ── La pasada ───────────────────────────────────────────────────────────────

export async function clasificarAutomatico(
  client: TenantClient,
  opts: ClasificarAutoOptions,
): Promise<ClasificacionAutomatica> {
  if (typeof opts?.aplicar !== 'boolean') {
    throw new ClasificacionError(
      'aplicar tiene que ser true o false, explícitamente: es la diferencia entre enseñar lo ' +
        'que haría el motor y escribirlo en el libro de alguien.',
    )
  }

  const pendientes = await sinCategorizar(client, opts.entryIds, opts.limite)
  if (pendientes.length === 0) return vacio()

  const plan = await planRules(client, {
    entryIds: pendientes.map((fila) => fila.entryId),
    soloSinCategorizar: true,
  })
  const catalogo = await catalogoDeCuentas(client)
  const propias = await cuentasPropias(client)
  const observaciones = opts.observaciones ?? new Map<string, ObservacionDelOrigen>()

  const sinCuenta = new Map<string, RutaSinCuenta>()
  const anotarRutaPerdida = (ruta: RutaDeCategoria, procedencia: Procedencia): undefined => {
    const clave = `${procedencia}${SEPARADOR}${ruta}`
    const actual = sinCuenta.get(clave)
    sinCuenta.set(clave, {
      ruta,
      procedencia,
      movimientos: (actual?.movimientos ?? 0) + 1,
    })
    return undefined
  }

  const propuestas: Propuesta[] = []
  const decidido = new Set<string>()

  // El movimiento se le pega a cada propuesta acá, en un solo sitio: una
  // propuesta sin el movimiento al lado no se puede enseñar, y hacerlo en cada
  // capa serían cinco sitios donde olvidarse.
  const pendientePorId = new Map(pendientes.map((fila) => [fila.entryId, fila]))
  const conMovimiento = (propuesta: PropuestaDeCapa): Propuesta | null => {
    const fila = pendientePorId.get(propuesta.entryId)
    // Sin `??`: una propuesta sobre un asiento que no está entre los pendientes
    // es un fallo del motor, no un dato que falte. Se descarta en vez de
    // inventarle una descripción vacía que después alguien lee en pantalla.
    if (fila === undefined) return null
    return {
      ...propuesta,
      movimiento: {
        description: fila.description,
        bookedOn: fila.bookedOn,
        amount: fila.amount,
        currency: fila.currency,
        accountName: fila.accountName,
      },
    }
  }
  const anotar = (propuesta: PropuestaDeCapa): void => {
    const completa = conMovimiento(propuesta)
    if (completa !== null) propuestas.push(completa)
  }

  // ── Capa 1: las reglas ────────────────────────────────────────────────────
  // No se resuelve ninguna ruta acá: una regla ya apunta a una cuenta concreta
  // de este hogar, que es la diferencia entre lo que escribió el usuario y lo
  // que le proponemos nosotros.
  for (const reclamo of plan.porRegla) {
    const categoryId = reclamo.regla.categoryId
    if (categoryId === null) continue
    for (const entryId of reclamo.categoria) {
      decidido.add(entryId)
      anotar({
        entryId,
        categoryId,
        dimensiones: plan.dimensiones.get(entryId) ?? [],
        procedencia: 'regla',
        ruleId: reclamo.regla.id,
        motivo: reclamo.motivo,
        automatica: true,
      })
    }
  }

  // ── Capa 2: la memoria del hogar ──────────────────────────────────────────
  const paraMemoria = pendientes.filter((fila) => !decidido.has(fila.entryId))
  if (paraMemoria.length > 0) {
    const recordadas = await proponerPorMemoria(
      client,
      paraMemoria.map((fila) => ({ entryId: fila.entryId, description: fila.description })),
      opts.minimoDeMemoria === undefined ? {} : { minimo: opts.minimoDeMemoria },
    )
    for (const recordada of recordadas) {
      const elegida = deLaMemoria(recordada.recuerdo.automatica, recordada.recuerdo.opciones, {
        unanime: recordada.recuerdo.unanime,
      })
      if (elegida === null) continue
      decidido.add(recordada.entryId)
      anotar({
        entryId: recordada.entryId,
        categoryId: elegida.opcion.categoryId,
        dimensiones: elegida.opcion.dimensiones,
        procedencia: 'memoria',
        ruleId: null,
        motivo: recordada.motivo,
        automatica: elegida.automatica,
      })
    }
  }

  // ── Capas 3, 4 y 5: señal, proveedor y diccionario ────────────────────────
  // Las tres son puras y se resuelven por movimiento, así que se recorren
  // juntas: el primer resultado gana y las de abajo ni se consultan.
  for (const fila of pendientes) {
    if (decidido.has(fila.entryId)) continue
    const observacion = observaciones.get(fila.entryId)
    const propuesta =
      porSenal(fila, observacion, propias, catalogo, anotarRutaPerdida) ??
      porProveedor(fila, observacion, catalogo, anotarRutaPerdida) ??
      porDiccionario(fila, observacion, catalogo, anotarRutaPerdida)
    if (propuesta === null) continue
    decidido.add(fila.entryId)
    anotar(propuesta)
  }

  // Las rechazadas se quitan **al final**, no dentro de cada capa. Si se
  // quitaran antes, una propuesta rechazada del diccionario haría que el
  // movimiento «cayera» a la capa de abajo — y debajo del diccionario no hay
  // ninguna, así que el efecto real sería que a veces se ofrece otra cosa y a
  // veces nada, según qué capa hubiera contestado. La pregunta que contesta el
  // motor no cambia porque alguien haya dicho que no a su respuesta.
  const vivas = opts.excluirRechazadas ? await sinLasRechazadas(client, propuestas) : propuestas

  const aplicadasPorCapa = opts.aplicar ? await escribir(client, vivas) : new Map()

  return {
    propuestas: vivas,
    aplicadas: [...aplicadasPorCapa.values()].reduce((total, n) => total + n, 0),
    sugeridas: vivas.filter((p) => !opts.aplicar || !p.automatica).length,
    sinPropuesta: pendientes.length - decidido.size,
    porCapa: CAPAS.map((procedencia) => {
      const suyas = vivas.filter((p) => p.procedencia === procedencia)
      return {
        procedencia,
        propuestas: suyas.length,
        automaticas: suyas.filter((p) => p.automatica).length,
        aplicadas: aplicadasPorCapa.get(procedencia) ?? 0,
      }
    }).filter((capa) => capa.propuestas > 0),
    rutasSinCuenta: [...sinCuenta.values()].sort((a, b) => b.movimientos - a.movimientos),
    reglasFallidas: plan.fallidas,
  }
}

function vacio(): ClasificacionAutomatica {
  return {
    propuestas: [],
    aplicadas: 0,
    sugeridas: 0,
    sinPropuesta: 0,
    porCapa: [],
    rutasSinCuenta: [],
    reglasFallidas: [],
  }
}

/**
 * Qué dice la memoria: la categoría que se puede escribir sola, la que sólo se
 * puede sugerir, o nada.
 *
 * El caso de en medio es el que justifica que esto sea una función y no un
 * `if`: un comercio que el hogar mandó **siempre** a la misma categoría pero
 * sólo dos veces tiene una respuesta única y evidencia real. Tirarla porque no
 * llega al umbral desperdicia lo único que la memoria sabe; escribirla sola
 * rompe el umbral. Se sugiere, con la frase que ya dice cuántas veces van y
 * cuántas faltan.
 *
 * Y el caso que no se resuelve: si el hogar usó dos categorías para el mismo
 * comercio, acá no se elige ninguna. Es la doctrina de `memoria.ts` y elegir la
 * más usada sería inventarle una preferencia; el movimiento cae a la capa
 * siguiente y las dos opciones se enseñan en pantalla.
 */
function deLaMemoria(
  automatica: OpcionDeCategoria | null,
  opciones: readonly OpcionDeCategoria[],
  estado: { unanime: boolean },
): { opcion: OpcionDeCategoria; automatica: boolean } | null {
  if (automatica !== null) return { opcion: automatica, automatica: true }
  if (!estado.unanime) return null
  const unica = opciones[0]
  return unica === undefined ? null : { opcion: unica, automatica: false }
}

// ── Capa 3: la señal ────────────────────────────────────────────────────────

function porSenal(
  fila: Pendiente,
  observacion: ObservacionDelOrigen | undefined,
  propias: readonly CuentaPropia[],
  catalogo: CatalogoDeCuentas,
  perdida: (ruta: RutaDeCategoria, procedencia: Procedencia) => undefined,
): PropuestaDeCapa | null {
  const senales = senalesDe(
    {
      amount: money(fila.amount, fila.currency),
      accountId: fila.accountId,
      accountKind: fila.accountKind,
      ...(observacion?.counterpartName === undefined
        ? {}
        : { counterpartName: observacion.counterpartName }),
      ...(observacion?.counterpartIban === undefined
        ? {}
        : { counterpartIban: observacion.counterpartIban }),
      ...(observacion?.counterpartAccountId === undefined
        ? {}
        : { counterpartAccountId: observacion.counterpartAccountId }),
      ...(observacion?.paymentChannel === undefined
        ? {}
        : { paymentChannel: observacion.paymentChannel }),
      ...(observacion?.transactionCode === undefined
        ? {}
        : { transactionCode: observacion.transactionCode }),
      ...(observacion?.conceptoComun === undefined
        ? {}
        : { conceptoComun: observacion.conceptoComun }),
      ...(observacion?.conceptoPropio === undefined
        ? {}
        : { conceptoPropio: observacion.conceptoPropio }),
      ...(observacion?.categoriaDelProveedor === undefined
        ? {}
        : {
            personalFinanceCategory: {
              ...(observacion.categoriaDelProveedor.primary === undefined
                ? {}
                : { primary: observacion.categoriaDelProveedor.primary }),
              ...(observacion.categoriaDelProveedor.confianza === undefined
                ? {}
                : { confidenceLevel: observacion.categoriaDelProveedor.confianza }),
            },
          }),
    },
    { cuentasPropias: propias },
  )

  for (const senal of senales) {
    const ruta = SENAL_A_RUTA[senal.tipo]
    if (ruta === null) continue
    const categoryId = resolverRuta(ruta, catalogo)
    if (categoryId === null) return perdida(ruta, 'senal') ?? null
    return {
      entryId: fila.entryId,
      categoryId,
      dimensiones: [],
      procedencia: 'senal',
      ruleId: null,
      motivo: senal.motivo,
      automatica: true,
    }
  }
  return null
}

// ── Capa 4: el proveedor ────────────────────────────────────────────────────

function porProveedor(
  fila: Pendiente,
  observacion: ObservacionDelOrigen | undefined,
  catalogo: CatalogoDeCuentas,
  perdida: (ruta: RutaDeCategoria, procedencia: Procedencia) => undefined,
): PropuestaDeCapa | null {
  const dicho = observacion?.categoriaDelProveedor
  if (dicho === undefined) return null
  const traduccion = mapearCategoriaDeProveedor(dicho.proveedor, dicho.detailed)
  if (traduccion === undefined) return null
  const categoryId = resolverRuta(traduccion.ruta, catalogo)
  if (categoryId === null) return perdida(traduccion.ruta, 'proveedor') ?? null

  // Nunca se le enseña al usuario la categoría del proveedor: lo que ve es la
  // suya. El nombre del proveedor sí, porque es de quién viene la afirmación.
  const seguridad =
    dicho.confianza === undefined ? '' : ` con confianza ${dicho.confianza.toLowerCase()}`
  return {
    entryId: fila.entryId,
    categoryId,
    dimensiones: [],
    procedencia: 'proveedor',
    ruleId: null,
    motivo:
      `${nombreDelProveedor(dicho.proveedor)} clasifica este movimiento en su propia taxonomía` +
      `${seguridad}, y esa etiqueta equivale a «${traduccion.ruta}» con confianza ` +
      `${traduccion.confianza}. Lo decide una persona: el agregador no conoce tu plan de cuentas.`,
    automatica: false,
  }
}

function nombreDelProveedor(proveedor: Proveedor): string {
  return proveedor === 'plaid' ? 'Plaid' : proveedor
}

// ── Capa 5: el diccionario ──────────────────────────────────────────────────

function porDiccionario(
  fila: Pendiente,
  observacion: ObservacionDelOrigen | undefined,
  catalogo: CatalogoDeCuentas,
  perdida: (ruta: RutaDeCategoria, procedencia: Procedencia) => undefined,
): PropuestaDeCapa | null {
  const comercio = canonicalMerchant({
    description: fila.description,
    ...(observacion?.counterpartName === undefined
      ? {}
      : { counterpartName: observacion.counterpartName }),
    ...(observacion?.counterpartIban === undefined
      ? {}
      : { counterpartIban: observacion.counterpartIban }),
    ...(observacion?.merchantName === undefined ? {} : { merchantName: observacion.merchantName }),
  })
  // La cadena vacía es «no hay comercio identificable», no una clave. Ver
  // merchant.ts: buscar por ella juntaría todo lo ilegible del hogar.
  if (comercio.key === '') return null

  const encontrado = buscarEnDiccionario(comercio.key)
  if (encontrado === undefined) return null
  // Reconocido y sin categoría: es una respuesta y no un fallo. Amazon no es
  // una categoría. Se calla en vez de bajar a adivinar.
  if (encontrado.categoria === null) return null

  const categoryId = resolverRuta(encontrado.categoria, catalogo)
  if (categoryId === null) return perdida(encontrado.categoria, 'diccionario') ?? null

  const matiz =
    encontrado.confianza === 'alta'
      ? 'ese comercio va siempre ahí'
      : 'ese comercio suele ir ahí, pero vende de varias cosas'
  return {
    entryId: fila.entryId,
    categoryId,
    dimensiones: [],
    procedencia: 'diccionario',
    ruleId: null,
    motivo:
      `El descriptor «${fila.description}» se reconoce como ${encontrado.etiqueta} (por ` +
      `«${encontrado.coincidencia}»), y ${matiz}: «${encontrado.categoria}». Lo confirmás vos; a ` +
      'la tercera vez que lo hagas, este comercio se clasifica solo.',
    automatica: false,
  }
}

// ── De una ruta a una cuenta de este hogar ──────────────────────────────────

interface CuentaDelCatalogo {
  readonly id: string
  readonly kind: 'expense' | 'income'
}

interface CatalogoDeCuentas {
  /** Camino completo, «Casa > Servicios > Luz». */
  readonly porRuta: ReadonlyMap<string, CuentaDelCatalogo>
  /** Nombre de la hoja. Es único por hogar; ver abajo. */
  readonly porNombre: ReadonlyMap<string, CuentaDelCatalogo>
}

/**
 * Resuelve una ruta del árbol por defecto contra el plan de cuentas real.
 *
 * Dos intentos, los dos **exactos**, y ninguno difuso:
 *
 *  1. **El camino completo.** Es el caso del hogar creado con el árbol por
 *     defecto, que es como nacen los hogares nuevos.
 *  2. **El nombre de la hoja.** No es una concesión: `account_name_unique` es
 *     `(tenant_id, name)`, así que el nombre de una cuenta es único **en todo
 *     el hogar** y por tanto identifica una sola. Es lo que hace que
 *     «Día a día > Supermercado» encuentre el «Supermercado» de un hogar que
 *     lo colgó de «Familia». Reorganizar el plan de cuentas es normal y no
 *     puede dejar al motor ciego.
 *
 * Y una comprobación que no se salta: la **clase** tiene que coincidir. Si el
 * árbol dice que esa ruta es de ingreso y la cuenta del hogar que se llama
 * igual es de gasto, no es la misma cuenta por mucho que comparta el nombre, y
 * mandarle un cobro convertiría un ingreso en un gasto negativo.
 *
 * Lo que no se hace, y es donde estaría la tentación: nada de sinónimos, ni de
 * parecidos, ni de «la que más se parece». «Restaurantes y bares» no encuentra
 * «Restaurantes», y así tiene que ser — la ruta que no resuelve sale en
 * `rutasSinCuenta`, que es una lista de cuentas por crear y no un fallo
 * silencioso. Una tabla de equivalencias escrita mirando el plan de cuentas de
 * un cliente concreto sería, exactamente, hacer trampa.
 */
function resolverRuta(ruta: RutaDeCategoria, catalogo: CatalogoDeCuentas): string | null {
  const nodo = buscarPorRuta(ruta)
  const esperado = nodo?.tipo
  const hoja = ruta.slice(ruta.lastIndexOf('>') + 1).trim()

  for (const candidata of [catalogo.porRuta.get(ruta), catalogo.porNombre.get(hoja)]) {
    if (candidata === undefined) continue
    if (esperado !== undefined && candidata.kind !== esperado) continue
    return candidata.id
  }
  return null
}

async function catalogoDeCuentas(client: TenantClient): Promise<CatalogoDeCuentas> {
  const porRuta = new Map<string, CuentaDelCatalogo>()
  const porNombre = new Map<string, CuentaDelCatalogo>()
  for (const nodo of await categoryTree(client)) {
    // Las bolsas del importador son cuentas de gasto y de ingreso como
    // cualquier otra: nada en la tabla las distingue, así que nada impediría
    // que una ruta resolviera contra ellas. Hoy ninguna capa apunta ahí —el
    // diccionario y la tabla del proveedor no tienen esas rutas—, así que esto
    // es un cepo y no un arreglo: está para que el día que alguien añada una,
    // el motor no «clasifique» dejando el movimiento donde ya estaba y
    // escribiendo una fila de auditoría que dice que hizo algo.
    if (esBolsa(nodo.name)) continue
    const cuenta = { id: nodo.id, kind: nodo.kind }
    porRuta.set(nodo.path, cuenta)
    porNombre.set(nodo.name, cuenta)
  }
  return { porRuta, porNombre }
}

/**
 * Las bolsas del importador, reconocidas por nombre porque no hay otra cosa por
 * la que reconocerlas: acá una categoría es una cuenta y ninguna columna la
 * marca. La misma comprobación, en SQL, es `sqlSinCategorizar` de classify.ts.
 */
function esBolsa(nombre: string): boolean {
  return (
    nombre === 'Sin categorizar' ||
    nombre === 'Ingresos sin categorizar' ||
    nombre.startsWith('Sin categorizar (') ||
    nombre.startsWith('Ingresos sin categorizar (')
  )
}

// ── Lo que hay sin categorizar ──────────────────────────────────────────────

interface Pendiente {
  readonly entryId: string
  readonly description: string
  readonly bookedOn: string
  /** La pata bancaria: la línea que el usuario reconoce en su extracto. */
  readonly accountId: string
  readonly accountName: string
  readonly accountKind: 'asset' | 'liability'
  readonly amount: bigint
  readonly currency: string
}

/**
 * Los movimientos sin categorizar que además **se pueden** clasificar.
 *
 * El filtro por una sola pata de gasto o ingreso no es una optimización: es la
 * misma regla que `classify.ts` aplica al escribir. Un asiento sin pata de
 * categoría es un traspaso o una apertura y no hay nada que mover; uno con dos
 * es un ticket repartido y aplastarlo perdería el reparto. Traerlos acá para
 * que las cinco capas les busquen categoría y después descubrir que no se puede
 * los contaría como «sin propuesta», que es mentira: no es que nadie supiera,
 * es que no había pregunta.
 */
async function sinCategorizar(
  client: TenantClient,
  entryIds: readonly string[] | undefined,
  limite: number | undefined,
): Promise<Pendiente[]> {
  if (entryIds !== undefined && entryIds.length === 0) return []

  const { rows } = await client.query<{
    entry_id: string
    description: string
    booked_on: string
    account_id: string
    account_name: string
    kind: 'asset' | 'liability'
    amount: string
    currency: string
  }>(
    `with candidato as (
       select distinct p.entry_id
         from posting p
         join account a on a.id = p.account_id
        where a.kind in ('expense', 'income')
          and ${sqlSinCategorizar('a')}
          and ($1::uuid[] is null or p.entry_id = any($1::uuid[]))
     ),
     categoria as (
       select p.entry_id, count(*) as patas
         from posting p
         join account a on a.id = p.account_id
        where p.entry_id in (select entry_id from candidato)
          and a.kind in ('expense', 'income')
        group by p.entry_id
     ),
     banco as (
       -- La pata bancaria de mayor importe. Un asiento con dos ya quedó fuera
       -- por no tener exactamente una de categoría, así que acá el 'distinct
       -- on' sólo desempata casos degenerados.
       select distinct on (p.entry_id)
              p.entry_id, p.account_id, a.name as account_name, a.kind, p.amount, p.currency
         from posting p
         join account a on a.id = p.account_id
        where p.entry_id in (select entry_id from candidato)
          and a.kind in ('asset', 'liability')
        order by p.entry_id, abs(p.amount) desc, p.ordinal
     )
     select e.id            as entry_id,
            e.description,
            e.booked_on::text as booked_on,
            b.account_id,
            b.account_name,
            b.kind,
            b.amount::text  as amount,
            trim(b.currency) as currency
       from candidato c
       join entry e     on e.id = c.entry_id
       join categoria k on k.entry_id = c.entry_id and k.patas = 1
       join banco b     on b.entry_id = c.entry_id
      order by e.booked_on, e.id
      ${limite === undefined ? '' : 'limit $2'}`,
    limite === undefined
      ? [entryIds === undefined ? null : [...new Set(entryIds)]]
      : [entryIds === undefined ? null : [...new Set(entryIds)], limite],
  )

  return rows.map((row) => ({
    entryId: row.entry_id,
    description: row.description,
    bookedOn: row.booked_on,
    accountId: row.account_id,
    accountName: row.account_name,
    accountKind: row.kind,
    amount: BigInt(row.amount),
    currency: row.currency,
  }))
}

export interface RechazoDePropuesta {
  readonly entryId: string
  readonly categoryId: string
  readonly procedencia?: Procedencia | undefined
  readonly motivo?: string | undefined
  /** Quién dijo que no. El correo de la persona, nunca `sistema:`. */
  readonly rechazadoPor: string
}

/**
 * Registra que una persona descartó una propuesta concreta.
 *
 * `on conflict do nothing`: rechazar dos veces lo mismo no es un error, es un
 * doble clic. Y el rechazo **no toca el libro** — el movimiento se queda donde
 * estaba, en la bolsa de sin categorizar, disponible para que otra capa u otra
 * persona diga otra cosa.
 */
export async function rechazarPropuesta(
  client: TenantClient,
  rechazo: RechazoDePropuesta,
): Promise<{ registrado: boolean }> {
  const { rowCount } = await client.query(
    `insert into propuesta_rechazada
       (tenant_id, entry_id, category_id, procedencia, motivo, rechazado_por)
     values (current_setting('app.tenant_id')::uuid, $1::uuid, $2::uuid,
             $3::classification_source, $4, $5)
     on conflict (entry_id, category_id) do nothing`,
    [
      rechazo.entryId,
      rechazo.categoryId,
      rechazo.procedencia ?? null,
      rechazo.motivo ?? null,
      rechazo.rechazadoPor,
    ],
  )
  return { registrado: (rowCount ?? 0) > 0 }
}

/**
 * Quita las propuestas que una persona ya rechazó.
 *
 * El par es (asiento, categoría) y no sólo el asiento: rechazar es decir «esto
 * no va **ahí**», no «no me preguntes más por esto». Si el motor cambia de
 * opinión y propone otra categoría, se vuelve a ofrecer.
 */
async function sinLasRechazadas(
  client: TenantClient,
  propuestas: readonly Propuesta[],
): Promise<Propuesta[]> {
  if (propuestas.length === 0) return []
  const { rows } = await client.query<{ entry_id: string; category_id: string }>(
    `select entry_id, category_id
       from propuesta_rechazada
      where entry_id = any($1::uuid[])`,
    [[...new Set(propuestas.map((p) => p.entryId))]],
  )
  if (rows.length === 0) return [...propuestas]
  const rechazadas = new Set(rows.map((row) => `${row.entry_id}\u001F${row.category_id}`))
  return propuestas.filter((p) => !rechazadas.has(`${p.entryId}\u001F${p.categoryId}`))
}

/**
 * Las cuentas del hogar, para que `senalesDe` pueda reconocer un traspaso.
 *
 * No se les pasa IBAN porque el esquema no lo guarda: `account.account_number`
 * está enmascarado por los parsers y comparar máscaras encontraría parejas que
 * no lo son. Queda el nombre, que `senalesDe` exige idéntico.
 */
async function cuentasPropias(client: TenantClient): Promise<CuentaPropia[]> {
  const { rows } = await client.query<{ id: string; name: string }>(
    "select id, name from account where kind in ('asset', 'liability')",
  )
  return rows.map((row) => ({ id: row.id, nombre: row.name }))
}

// ── Escribir ────────────────────────────────────────────────────────────────

/**
 * Escribe las propuestas automáticas, agrupadas.
 *
 * Se agrupa por categoría, capa **y motivo** porque el motivo es lo que se
 * guarda en cada fila de auditoría: dos movimientos que van a «Supermercado»
 * por dos comercios distintos son dos grupos, y tienen que serlo o la
 * explicación de uno acabaría escrita en el otro. Los grupos son pocos —uno por
 * regla, uno por comercio recordado— así que agrupar convierte miles de
 * escrituras en decenas sin perder ni una palabra.
 */
async function escribir(
  client: TenantClient,
  propuestas: readonly Propuesta[],
): Promise<Map<Procedencia, number>> {
  const grupos = new Map<string, { propuesta: Propuesta; entryIds: string[] }>()
  for (const propuesta of propuestas) {
    if (!propuesta.automatica) continue
    const clave = [
      propuesta.procedencia,
      propuesta.categoryId,
      propuesta.ruleId ?? '',
      propuesta.motivo,
    ].join(SEPARADOR)
    const grupo = grupos.get(clave) ?? { propuesta, entryIds: [] }
    grupo.entryIds.push(propuesta.entryId)
    grupos.set(clave, grupo)
  }

  const aplicadas = new Map<Procedencia, number>()
  for (const { propuesta, entryIds } of grupos.values()) {
    const changedBy = autorAutomatico(propuesta.procedencia)
    const hecho = await reclassify(client, {
      entryIds,
      categoryId: propuesta.categoryId,
      changedBy,
      // Sin esto, lo que puso una regla quedaría registrado igual que lo que
      // puso la memoria y «deshacé lo de esta regla» no tendría respuesta.
      ...(propuesta.ruleId === null ? {} : { ruleId: propuesta.ruleId }),
      procedencia: propuesta.procedencia,
      motivo: propuesta.motivo,
    })
    aplicadas.set(
      propuesta.procedencia,
      (aplicadas.get(propuesta.procedencia) ?? 0) + hecho.changed,
    )

    if (propuesta.dimensiones.length > 0) {
      await setDimensions(client, {
        entryIds,
        assignments: propuesta.dimensiones.map((dim) => ({
          dimensionId: dim.dimensionId,
          dimensionValueId: dim.valueId,
          weightPpm: dim.weightPpm,
        })),
        changedBy,
        procedencia: propuesta.procedencia,
        motivo: propuesta.motivo,
      })
    }
  }
  return aplicadas
}

// ── «¿Por qué esta categoría?» ──────────────────────────────────────────────

export interface Explicacion {
  readonly entryId: string
  /** `null` si la puso una persona. Ver la migración 010. */
  readonly procedencia: Procedencia | null
  /** La frase congelada en el momento del cambio. */
  readonly motivo: string | null
  readonly ruleId: string | null
  /** Nombre de la regla, si sigue existiendo. */
  readonly regla: string | null
  readonly changedBy: string
  /** Instante ISO. Acá el instante completo sí es lo correcto. */
  readonly changedAt: string
}

/**
 * De dónde salió la categoría que hoy tiene cada movimiento.
 *
 * Se devuelve **la última** decisión de categoría de cada asiento, y sólo si
 * sigue en pie: si después de que el motor lo clasificara una persona lo movió
 * a otro sitio, lo que hay hoy en el libro no lo puso el motor y decir que sí
 * sería lo peor que puede hacer una auditoría. Las filas de atribución
 * (`from = to`, que son cambios de dimensión) se descartan por lo mismo: no
 * contestan a esta pregunta.
 *
 * Sin fila no hay explicación, y eso también es una respuesta: el movimiento
 * nunca se reclasificó — cayó donde lo dejó el importador, o lo trajo un
 * asiento escrito a mano con su categoría puesta.
 */
export async function explicarClasificacion(
  client: TenantClient,
  entryIds: readonly string[],
): Promise<Map<string, Explicacion>> {
  const unicos = [...new Set(entryIds)]
  const salida = new Map<string, Explicacion>()
  if (unicos.length === 0) return salida

  const { rows } = await client.query<{
    entry_id: string
    procedencia: Procedencia | null
    motivo: string | null
    rule_id: string | null
    regla: string | null
    changed_by: string
    changed_at: Date
  }>(
    `select distinct on (p.entry_id)
            p.entry_id, cc.procedencia, cc.motivo, cc.rule_id,
            r.name as regla, cc.changed_by, cc.changed_at
       from classification_change cc
       join posting p  on p.id = cc.posting_id
       -- Que la pata siga apuntando a donde la mandó este cambio es la prueba
       -- de que la decisión sigue en pie. Es el mismo filtro que usa memoria.ts.
       join account a  on a.id = p.account_id and a.id = cc.to_account_id
       left join rule r on r.id = cc.rule_id
      where p.entry_id = any($1::uuid[])
        and cc.from_account_id is distinct from cc.to_account_id
      order by p.entry_id, cc.changed_at desc, cc.id desc`,
    [unicos],
  )

  for (const row of rows) {
    salida.set(row.entry_id, {
      entryId: row.entry_id,
      procedencia: row.procedencia,
      motivo: row.motivo,
      ruleId: row.rule_id,
      regla: row.regla,
      changedBy: row.changed_by,
      changedAt: row.changed_at.toISOString(),
    })
  }
  return salida
}

// ── Lo que ya clasificó cada capa ───────────────────────────────────────────

export interface ClasificadoPorCapa {
  /** `null` es una persona. */
  readonly procedencia: Procedencia | null
  readonly movimientos: number
}

/**
 * Cuántos movimientos tiene hoy su categoría puesta por cada capa.
 *
 * Se cuenta sobre la ÚLTIMA decisión de cada pata y sólo si sigue en pie, igual
 * que `explicarClasificacion`. Un recuento sobre todas las filas del registro
 * diría que el diccionario clasificó cuatrocientos movimientos cuando el hogar
 * corrigió trescientos: contaría intentos, no resultados, y sería el número que
 * más se parece a una mentira útil.
 */
export async function clasificadoPorCapa(client: TenantClient): Promise<ClasificadoPorCapa[]> {
  const { rows } = await client.query<{ procedencia: Procedencia | null; movimientos: number }>(
    `with ultima as (
       select distinct on (cc.posting_id) cc.posting_id, cc.procedencia, cc.to_account_id
         from classification_change cc
        where cc.from_account_id is distinct from cc.to_account_id
        order by cc.posting_id, cc.changed_at desc, cc.id desc
     )
     select u.procedencia, count(*)::int as movimientos
       from ultima u
       join posting p on p.id = u.posting_id and p.account_id = u.to_account_id
      group by u.procedencia
      order by movimientos desc`,
  )
  return rows.map((row) => ({
    procedencia: row.procedencia,
    movimientos: Number(row.movimientos),
  }))
}
