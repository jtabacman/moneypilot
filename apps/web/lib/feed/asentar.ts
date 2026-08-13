/**
 * De un extracto de un feed a un lote del libro.
 *
 * Este módulo es el recorrido común de **todos** los agregadores. Nació dentro
 * del primer proveedor y se movió acá el día que hubo un segundo
 * proveedor, que es exactamente el día en que copiarlo habría empezado a doler:
 * de dos copias del dedup, de la reconciliación y del cálculo de la apertura,
 * la que se queda sin actualizar produce informes que cuadran consigo mismos y
 * con nada más.
 *
 * Lo que queda del lado de cada proveedor es lo que de verdad es suyo: hablar
 * por la red, mapear su forma a `ParsedStatement`, y las particularidades que
 * no comparte con nadie —el cursor de Plaid, el formulario web de finAPI—. Todo
 * lo demás pasa por acá.
 *
 * Todo este módulo defiende una sola frase: **el feed es una fuente de entrada
 * al libro, no un sustituto del libro**. Lo que trae no se lee en tiempo de
 * consulta ni vive en una tabla aparte: se mapea a `ParsedStatement` —el mismo
 * contrato que produce un OFX—, pasa por el mismo pipeline, la misma
 * deduplicación y la misma reconciliación, y se escribe con `persistImport`. Lo
 * único que cambia es `data_source`, que pasa a ser 'api'.
 *
 * La consecuencia práctica es que el lote sincronizado se deshace desde el
 * mismo historial y con el mismo botón que un fichero, sin código nuevo.
 *
 * ── Lo que sí es distinto de un fichero ──────────────────────────────────────
 *
 *  · **Hay saldo de verdad contra el que comprobar.** Un OFX rara vez declara
 *    apertura y cierre; un agregador siempre dice cuánto hay en la cuenta. Eso,
 *    junto con el saldo que nuestro libro ya tenía, cierra la ecuación: saldo
 *    previo + movimientos = lo que dice el banco, o hay delta y se ve.
 *
 *  · **La ventana descargada no es toda la historia, y eso se asienta.** Ver
 *    `apertura.ts`.
 *
 *  · **Un movimiento puede corregirse en su sitio.** Es el veredicto 'updated'
 *    del dedup y se aplica con `updateBookedTransaction`.
 *
 *  · **Un movimiento puede retirarse.** Ver `anulaciones`, más abajo: es lo
 *    único de este módulo que quita algo del libro, y lo hace añadiendo.
 *
 *  · **No se guarda el saldo como `declared_balance`.** Ver `asentarExtracto`.
 *    La apertura es otra cosa y no lo necesita: es un asiento del libro.
 *
 * ── Una transacción, una cuenta ──────────────────────────────────────────────
 *
 * Cada llamada a `asentarExtracto` escribe una cuenta entera o no escribe nada.
 * Quien llama decide si eso va en su propia transacción —lo que hace finAPI,
 * porque puede avanzar cuenta a cuenta— o si varias cuentas comparten una,
 * que es lo que necesita Plaid: su cursor es del item entero y guardarlo sólo
 * es seguro cuando todas las cuentas del item quedaron asentadas.
 */

import { createHash } from 'node:crypto'
import {
  type Money,
  money,
  type ParsedStatement,
  type StatementFormat,
  toDecimalString,
  zero,
} from '@moneypilot/core'
import {
  ensureOpeningEntry,
  type FeedEntryRow,
  type FeedProvider,
  findFeedEntries,
  type OpeningEntryOutcome,
  type PersistableTransaction,
  persistImport,
  readOpeningEntry,
  reverseEntry,
  type TenantClient,
  updateBookedTransaction,
} from '@moneypilot/db'
import { conNombreDeCuenta, existingForAccount, toPersistInput } from '../importacion'
import { type PipelineResult, runStatements, toWireReport, type WireReport } from '../pipeline'
import { aperturaNecesaria, conAvisoDeApertura } from './apertura'
import { SincronizacionError } from './errores'

/* ── Lo que devuelve una cuenta ───────────────────────────────────────────── */

export interface FilaEnRevision {
  readonly lineNumber: number
  readonly bookedOn: string
  readonly description: string
}

/**
 * El asiento de apertura tal como quedó. `null` cuando el banco no declaró
 * saldo: sin un cierre de fuera no hay apertura que calcular, y la
 * reconciliación se queda —con razón— en 'sin_saldo_declarado'.
 */
export interface AperturaDelLote {
  readonly entryId: string | null
  readonly outcome: OpeningEntryOutcome
  /** Importe con el que quedó, como cadena decimal exacta. Nunca un number. */
  readonly importe: string
  /** Con el que estaba antes. Distinto del de arriba sólo si hubo ajuste. */
  readonly importeAnterior: string
  /** Día anterior al primer movimiento de la ventana descargada. */
  readonly fecha: string
}

/** Un movimiento que el banco retiró y que se quitó del libro anulándolo. */
export interface AnulacionDelLote {
  /** El identificador con el que lo mandó el proveedor. */
  readonly externalId: string
  /** El asiento que se anuló, que se queda donde estaba. */
  readonly entryId: string
  /** El asiento espejo que lo anula. */
  readonly reversalId: string
  readonly bookedOn: string
  readonly description: string
  /** Importe del movimiento anulado, como cadena decimal exacta. */
  readonly importe: string
}

export interface CuentaSincronizada {
  readonly kind: 'ok'
  readonly externalAccountId: string
  readonly accountId: string
  readonly nombreDeCuenta: string
  readonly batchId: string
  /** false cuando nada cambió desde la última sincronización. */
  readonly guardado: boolean
  readonly imported: number
  readonly updated: number
  readonly duplicates: number
  readonly needsReview: number
  readonly report: WireReport
  readonly review: readonly FilaEnRevision[]
  readonly apertura: AperturaDelLote | null
  readonly anulados: readonly AnulacionDelLote[]
}

export interface CuentaVacia {
  readonly kind: 'vacia'
  readonly externalAccountId: string
  readonly accountId: string
  readonly nombreDeCuenta: string
  /** Una sincronización sin movimientos nuevos igual puede retirar alguno. */
  readonly anulados: readonly AnulacionDelLote[]
}

export type ResultadoDeCuenta = CuentaSincronizada | CuentaVacia

/* ── La entrada ───────────────────────────────────────────────────────────── */

export interface AsentarExtractoInput {
  readonly provider: FeedProvider
  /** Cómo se llama el proveedor en un mensaje para una persona: 'finAPI', 'Plaid'. */
  readonly proveedorLegible: string
  /** El identificador de la cuenta EN EL PROVEEDOR. */
  readonly externalAccountId: string
  /** La cuenta de nuestro libro que la recibe. */
  readonly accountId: string
  readonly statement: ParsedStatement
  readonly format: StatementFormat
  /** El nombre con el que el lote aparece en el historial. */
  readonly fileName: string
  /**
   * Identificadores que el proveedor retiró en esta lectura.
   *
   * Sólo los que llegan así: no se deduce que algo se retiró porque deje de
   * aparecer. Un feed incremental sólo manda lo que cambió, así que "no vino"
   * es el estado normal de todo lo demás.
   */
  readonly retirados?: readonly string[]
}

export async function asentarExtracto(
  client: TenantClient,
  input: AsentarExtractoInput,
): Promise<ResultadoDeCuenta> {
  const nuestra = await leerCuenta(client, input.accountId)
  const statement = input.statement

  if (statement.account.currency !== nuestra.currency) {
    // Se para acá y no en `persistImport` porque ahí sólo saltaría si hubiera
    // al menos un movimiento: una cuenta en la divisa equivocada y sin
    // movimientos pasaría callada y rompería en la sincronización siguiente.
    throw new SincronizacionError(
      `${input.proveedorLegible} declara la cuenta ${input.externalAccountId} en ` +
        `${statement.account.currency} y "${nuestra.name}" está en ${nuestra.currency}. Una cuenta ` +
        'tiene una sola moneda: los movimientos en otra divisa necesitan su propia cuenta, no una ' +
        'conversión inventada.',
    )
  }

  // Las anulaciones se resuelven antes que nada: pueden ser el único contenido
  // de una sincronización, y en ese caso la cuenta no está "vacía".
  const retiradas = await anulacionesPendientes(client, input.accountId, input.retirados ?? [])

  if (statement.lines.length === 0 && retiradas.length === 0) {
    // No se guarda un lote vacío: ocuparía el hash de contenido y el día que
    // la cuenta tenga movimientos, sincronizarla no haría nada.
    return {
      kind: 'vacia',
      externalAccountId: input.externalAccountId,
      accountId: input.accountId,
      nombreDeCuenta: nuestra.name,
      anulados: [],
    }
  }

  const fechas = statement.lines.map((linea) => linea.bookedOn).sort()
  // Sin líneas nuevas, la ventana la definen los movimientos retirados: son lo
  // único que esta sincronización toca, y la apertura tiene que quedar antes.
  const desde = fechas[0] ?? retiradas.map((fila) => fila.bookedOn).sort()[0] ?? null
  const hasta = fechas[fechas.length - 1] ?? desde

  const existing =
    desde === null || hasta === null
      ? []
      : await existingForAccount(client, input.accountId, { from: desde, to: hasta })
  const saldoPrevio = await saldoDelLibro(client, input.accountId, nuestra.currency)
  const aperturaPrevia = await readOpeningEntry(client, input.accountId)

  const opciones = {
    fileName: input.fileName,
    format: input.format,
    // El uuid de la cuenta es lo único estable para la huella de identidad: si
    // se usara el nombre, renombrarla duplicaría el histórico entero la
    // próxima vez. Ver la cabecera de importacion.ts.
    accountLabel: input.accountId,
    existing,
    source: 'api' as const,
    openingFromLedger: new Map([[input.accountId, saldoPrevio]]),
  }

  // Primera pasada: clasificar. Hace falta antes de reconciliar porque las
  // correcciones y las anulaciones mueven el saldo sin ser líneas importadas, y
  // ese desplazamiento tiene que entrar en el cierre calculado — si no, el
  // delta culparía a la importación de un cambio que ella misma hizo bien.
  const sonda = runStatements([statement], opciones)
  const correcciones = correccionesDe(sonda, input.accountId, nuestra.currency)
  const desplazamientoDeAnulaciones = retiradas.reduce((total, fila) => total - fila.amount, 0n)
  const ajusteTotal = correcciones.total.amount + desplazamientoDeAnulaciones
  const ajustes = ajusteTotal === 0n ? zero(nuestra.currency) : money(ajusteTotal, nuestra.currency)

  const apertura =
    desde === null
      ? null
      : aperturaNecesaria({
          statement,
          sonda,
          accountId: input.accountId,
          currency: nuestra.currency,
          saldoPrevio,
          aperturaPrevia: aperturaPrevia?.amount ?? 0n,
          ajustes,
          primerMovimiento: desde,
        })

  // Segunda pasada: reconciliar de verdad. Con la apertura, el cierre calculado
  // deja de partir de cero y pasa a partir de lo que la cuenta tenía antes de
  // la ventana; el `movementAdjustments` mete el desplazamiento de lo corregido
  // y lo anulado. Cuando ninguna de las dos cosas cambia nada, se reutiliza la
  // sonda: correr el motor otra vez daría exactamente el mismo informe.
  const resultado =
    ajustes.amount === 0n &&
    (apertura === null || apertura.delInforme.amount === saldoPrevio.amount)
      ? sonda
      : runStatements([conAvisoDeApertura(statement, apertura, aperturaPrevia?.amount ?? 0n)], {
          ...opciones,
          ...(apertura === null
            ? {}
            : { openingFromLedger: new Map([[input.accountId, apertura.delInforme]]) }),
          ...(ajustes.amount === 0n
            ? {}
            : { movementAdjustments: new Map([[input.accountId, ajustes]]) }),
        })

  const report = conNombreDeCuenta(toWireReport(resultado.report), input.accountId, nuestra.name)

  // Las correcciones van ANTES del lote nuevo: `updateBookedTransaction` se
  // niega en varios casos legítimos —el asiento está enlazado con una
  // anulación, el gasto está repartido en varias contrapartidas— y es mejor
  // que la sincronización entera se caiga sin escribir nada que dejar un lote
  // escrito y las correcciones a medias. Todo corre en la misma transacción,
  // así que un fallo acá revierte también lo de más arriba.
  for (const correccion of correcciones.filas) {
    await updateBookedTransaction(client, {
      entryId: correccion.entryId,
      accountId: input.accountId,
      transaction: correccion.transaction,
    })
  }

  const anulados = await anular(client, input.proveedorLegible, retiradas, nuestra.currency)

  const guardado =
    statement.lines.length === 0
      ? null
      : await persistImport(client, {
          ...toPersistInput({
            result: resultado,
            accountId: input.accountId,
            fileName: input.fileName,
            contentSha256: huellaDelExtracto(input.provider, input.accountId, statement),
            report,
            source: 'api',
          }),
          // Se cuentan en el lote aunque no las escriba `persistImport`: sin
          // esto, el historial enseñaría 1.612 leídas repartidas en columnas
          // que suman 1.600, y las 12 que faltan no aparecerían en ningún sitio.
          updated: correcciones.filas.length,
          // El saldo del feed NO se guarda como saldo declarado, y es
          // deliberado. `declared_balance` tiene grano de día y significa "esto
          // dijo el banco al cerrar el día X"; lo que da un agregador es el
          // saldo en el instante de su última lectura. Dos sincronizaciones el
          // mismo día devuelven cifras distintas y las dos son ciertas —
          // guardarlas haría que la segunda abortara la importación entera por
          // contradecir a la primera. El saldo sigue haciendo su trabajo donde
          // corresponde: en el informe, como cierre real contra el que se mide
          // el delta, y como origen de la apertura de acá abajo — que es un
          // asiento del libro y no necesita `declared_balance` para nada.
          declaredBalances: [],
        })

  // La apertura va DESPUÉS del lote y dentro de la misma transacción: se ata a
  // él (`batchId`), así que deshacer la importación se la lleva igual que a los
  // movimientos que la hicieron falta. Ver `ensureOpeningEntry`.
  const aperturaAsentada =
    apertura === null
      ? null
      : await ensureOpeningEntry(client, {
          accountId: input.accountId,
          batchId: guardado?.batchId ?? null,
          amount: apertura.importe,
          currency: nuestra.currency,
          bookedOn: apertura.fecha,
          source: 'api',
        })

  if (apertura !== null && aperturaAsentada !== null) {
    // Lo que convierte "delta 0,00" en una afirmación comprobable en vez de una
    // resta que hicimos nosotros: el saldo se relee de la base después de
    // escribir y se contrasta contra el que declaró el banco. Si no coinciden,
    // el informe que se acaba de guardar dice algo que el libro no sostiene, y
    // eso no puede salir por pantalla — se cae la sincronización entera, que
    // corre en una sola transacción y no deja nada escrito.
    if (aperturaAsentada.balance !== apertura.cierreDeclarado.amount) {
      throw new SincronizacionError(
        `Después de asentar la apertura, "${nuestra.name}" suma ` +
          `${toDecimalString(money(aperturaAsentada.balance, nuestra.currency))} y ` +
          `${input.proveedorLegible} declara ${toDecimalString(apertura.cierreDeclarado)}. El ` +
          'informe diría que cuadra y no cuadra: no se guarda una importación que no se puede ' +
          'sostener.',
      )
    }
  }

  if (guardado === null) {
    return {
      kind: 'vacia',
      externalAccountId: input.externalAccountId,
      accountId: input.accountId,
      nombreDeCuenta: nuestra.name,
      anulados,
    }
  }

  return {
    kind: 'ok',
    externalAccountId: input.externalAccountId,
    accountId: input.accountId,
    nombreDeCuenta: nuestra.name,
    batchId: guardado.batchId,
    guardado: !guardado.skippedByContentHash,
    imported: guardado.imported,
    updated: correcciones.filas.length,
    duplicates: guardado.duplicates,
    needsReview: guardado.needsReview,
    report,
    anulados,
    apertura:
      apertura === null || aperturaAsentada === null
        ? null
        : {
            entryId: aperturaAsentada.entryId,
            outcome: aperturaAsentada.outcome,
            importe: toDecimalString(money(aperturaAsentada.amount, nuestra.currency)),
            importeAnterior: toDecimalString(
              money(aperturaAsentada.previousAmount, nuestra.currency),
            ),
            fecha: apertura.fecha,
          },
    review: resultado.classified
      .filter((item) => item.verdict.kind === 'review')
      .map((item) => ({
        lineNumber: item.incoming.lineNumber,
        bookedOn: item.incoming.bookedOn,
        description: item.incoming.description,
      })),
  }
}

/* ── Lo que el banco retiró ───────────────────────────────────────────────── */

/**
 * Qué se hace con un movimiento que el proveedor dice que ya no existe.
 *
 * El caso normal es que **no haya nada que hacer**: lo que un feed retira suele
 * ser una autorización pendiente, y los pendientes no entran al libro (ver la
 * cabecera del mapeador). El identificador retirado no corresponde a ningún
 * asiento, se cuenta y se acabó.
 *
 * Cuando sí corresponde —el banco rectificó un movimiento que ya había
 * asentado— hay tres salidas posibles y sólo una sirve:
 *
 *  · **Borrarlo.** Está descartada de entrada: el libro es append-only para lo
 *    que ya se enseñó. Ese asiento puede tener dimensiones asignadas a mano,
 *    estar emparejado como transferencia y haber salido en un informe que
 *    alguien ya leyó. Borrarlo cambia el pasado sin dejar rastro.
 *
 *  · **No tocarlo y avisar.** Es lo que parece prudente y es lo peor de los
 *    tres, porque el aviso no sobrevive: el saldo del libro se queda con un
 *    movimiento que el banco ya no cuenta, y la apertura —que se recalcula
 *    contra el saldo declarado— absorbe la diferencia en silencio y la
 *    atribuye a "historia anterior a la ventana". El delta sale cero, el
 *    informe dice que cuadra, y la cuenta arrastra para siempre un movimiento
 *    que no existió. Un error que cuadra es el que nadie encuentra.
 *
 *  · **Anularlo con un asiento espejo**, que es lo que se hace. El original se
 *    queda donde está, enlazado por `reversed_by` con su anulación; el saldo
 *    llega al del banco por suma y no por omisión; y en el registro quedan las
 *    dos líneas, que es lo que permite explicar dentro de seis meses por qué el
 *    mes de marzo cambió de cifra.
 *
 * La anulación **no se ata al lote** de la sincronización que la trajo. Ver
 * `ReverseEntryInput.batchId`: el chequeo de `revertImport` bloquea cualquier
 * lote que tenga un asiento enlazado con una anulación, así que atarla dejaría
 * el lote entero imposible de deshacer por culpa de un movimiento retirado. Y
 * además sería mentira: deshacer una importación no hace que el banco vuelva a
 * reconocer el movimiento que retiró.
 */
async function anulacionesPendientes(
  client: TenantClient,
  accountId: string,
  retirados: readonly string[],
): Promise<FeedEntryRow[]> {
  if (retirados.length === 0) return []
  const encontrados = await findFeedEntries(client, accountId, retirados)
  // Los que ya están anulados no se vuelven a anular: `reverseEntry` también es
  // idempotente, pero si se filtraran acá tarde el desplazamiento del saldo se
  // contaría igual y la reconciliación saldría corrida por el importe entero.
  return encontrados.filter((fila) => fila.reversedBy === null)
}

async function anular(
  client: TenantClient,
  proveedorLegible: string,
  retiradas: readonly FeedEntryRow[],
  currency: string,
): Promise<AnulacionDelLote[]> {
  const anulados: AnulacionDelLote[] = []
  for (const fila of retiradas) {
    const resultado = await reverseEntry(client, {
      entryId: fila.entryId,
      description: `Anulado: ${proveedorLegible} retiró este movimiento — ${fila.description}`,
    })
    anulados.push({
      externalId: fila.externalId,
      entryId: fila.entryId,
      reversalId: resultado.reversalId,
      bookedOn: fila.bookedOn,
      description: fila.description,
      importe: toDecimalString(money(fila.amount, currency)),
    })
  }
  return anulados
}

/* ── Correcciones en su sitio ─────────────────────────────────────────────── */

interface Correccion {
  readonly entryId: string
  readonly transaction: PersistableTransaction
  /** Cuánto mueve el saldo esta corrección. Cero si sólo cambió el texto. */
  readonly desplazamiento: bigint
}

interface Correcciones {
  readonly filas: readonly Correccion[]
  readonly total: Money
}

/**
 * Los movimientos que ya estaban y que el banco corrigió.
 *
 * El desplazamiento se calcula desde el propio veredicto (`changes.amount`) y
 * no releyendo la base: es el mismo dato con el que se decidió que había
 * cambio, así que no pueden discrepar.
 */
function correccionesDe(
  resultado: PipelineResult,
  accountId: string,
  currency: string,
): Correcciones {
  const filas: Correccion[] = []
  let total = 0n

  for (const item of resultado.classified) {
    const veredicto = item.verdict
    if (veredicto.kind !== 'updated') continue
    if (item.incoming.accountId !== accountId) continue

    const cambio = veredicto.changes.amount
    const desplazamiento = cambio === undefined ? 0n : cambio.after.amount - cambio.before.amount
    total += desplazamiento

    filas.push({
      entryId: veredicto.existingId,
      transaction: {
        bookedOn: item.incoming.bookedOn,
        description: item.incoming.description,
        amount: item.incoming.amount.amount,
        currency: item.incoming.amount.currency,
        fingerprint: item.fingerprint,
        ...(item.incoming.externalId === undefined ? {} : { externalId: item.incoming.externalId }),
        // Obligatorio, no decorativo: `updateBookedTransaction` escribe
        // `valued_on = $3` sin coalesce, así que omitirla acá borraría la fecha
        // valor que ya estaba guardada cada vez que el banco corrige un importe.
        ...(item.incoming.valuedOn === undefined ? {} : { valuedOn: item.incoming.valuedOn }),
      },
      desplazamiento,
    })
  }

  return { filas, total: total === 0n ? zero(currency) : money(total, currency) }
}

/* ── Piezas ───────────────────────────────────────────────────────────────── */

/**
 * Huella del contenido del extracto, que es lo que hace idempotente
 * resincronizar.
 *
 * Un fichero tiene bytes y se le hace sha256; un feed no, así que hay que
 * fabricar el equivalente. Se hace **con lo que llega al libro** —id del
 * proveedor, fechas, importe, descripción y el saldo declarado— y no con la
 * respuesta cruda entera: si se hashara todo, un cambio en la categoría del
 * agregador o en su reloj produciría un lote nuevo que resultaría ser 1.612
 * duplicados, y el historial se llenaría de lotes sin asientos.
 *
 * Va la cuenta de nuestro libro dentro a propósito: dos cuentas distintas del
 * agregador podrían tener contenidos idénticos —una cuenta recién abierta y
 * vacía, por ejemplo— y sin esto la segunda se saltaría creyendo que ya estaba.
 *
 * Y va el proveedor, que es lo que impide que el mismo extracto traído por dos
 * agregadores distintos se tome por repetido: el índice de hash de contenido es
 * por hogar, no por proveedor.
 *
 * El importe entra como cadena decimal canónica desde el `Money`, o sea desde
 * el bigint: en ningún punto de esta función hay un número de coma flotante.
 */
export function huellaDelExtracto(
  provider: FeedProvider,
  accountId: string,
  statement: ParsedStatement,
): string {
  const hash = createHash('sha256')
  hash.update(`moneypilot/${provider}/extracto/v1\n`)
  hash.update(`${accountId}\n`)
  hash.update(`${statement.account.currency}\n`)
  hash.update(
    statement.closingBalance === undefined
      ? 'sin-saldo\n'
      : `${toDecimalString(statement.closingBalance.amount)}@${statement.closingBalance.on}\n`,
  )
  for (const linea of statement.lines) {
    hash.update(
      [
        linea.externalId ?? '',
        linea.bookedOn,
        linea.valuedOn ?? '',
        toDecimalString(linea.amount),
        linea.description,
        // El separador va escrito con el escape y NUNCA como carácter literal: es
        // invisible al leer y cualquier formateador puede comérselo, y entonces el
        // hash cambia en silencio. Ver scripts/check-control-chars.mjs.
      ].join('\u001F'),
    )
    hash.update('\n')
  }
  return hash.digest('hex')
}

export interface CuentaDelLibro {
  readonly name: string
  readonly currency: string
}

export async function leerCuenta(client: TenantClient, accountId: string): Promise<CuentaDelLibro> {
  const { rows } = await client.query<{ name: string; currency: string }>(
    'select name, trim(currency) as currency from account where id = $1',
    [accountId],
  )
  const cuenta = rows[0]
  if (cuenta === undefined) {
    // Con RLS, la cuenta de otro hogar es indistinguible de una inexistente.
    throw new SincronizacionError(`La cuenta ${accountId} ya no existe en este hogar.`)
  }
  return { name: cuenta.name, currency: cuenta.currency.toUpperCase() }
}

/**
 * El saldo que la cuenta ya tenía en nuestro libro.
 *
 * Va en SQL directo y no por `accountBalances`, que resuelve el hogar entero
 * con joins laterales para devolver además saldos declarados y contadores de
 * movimientos: acá hace falta un número de una cuenta, antes de escribir nada.
 *
 * Sólo los postings en la moneda de la cuenta, igual que hace la capa de
 * lectura: mezclar divisas daría un saldo que no significa nada, y el esquema
 * da por sentado que una cuenta tiene una sola.
 */
export async function saldoDelLibro(
  client: TenantClient,
  accountId: string,
  currency: string,
): Promise<Money> {
  const { rows } = await client.query<{ saldo: string }>(
    `select coalesce(sum(p.amount) filter (where trim(p.currency) = $2), 0)::text as saldo
       from posting p
      where p.account_id = $1`,
    [accountId, currency],
  )
  // `::text` y `BigInt`: `sum()` sobre bigint devuelve numeric, y numeric por
  // JSON pierde precisión en cuanto el saldo pasa de 2^53 unidades mínimas.
  return money(BigInt(rows[0]?.saldo ?? '0'), currency)
}
