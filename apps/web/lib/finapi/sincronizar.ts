/**
 * De un feed de finAPI a un lote del libro.
 *
 * Todo este módulo defiende una sola frase: **el feed es una fuente de entrada
 * al libro, no un sustituto del libro**. Los movimientos que trae finAPI no se
 * leen en tiempo de consulta ni viven en una tabla aparte: se mapean a
 * `ParsedStatement` —el mismo contrato que produce un OFX—, pasan por el mismo
 * pipeline, la misma deduplicación y la misma reconciliación, y se escriben con
 * `persistImport`. Lo único que cambia es `data_source`, que pasa a ser 'api'.
 *
 * La consecuencia práctica es que el lote sincronizado se deshace desde el
 * mismo historial y con el mismo botón que un fichero, sin código nuevo.
 *
 * ── Lo que sí es distinto de un fichero ──────────────────────────────────────
 *
 *  · **Hay saldo de verdad contra el que comprobar.** Un OFX rara vez declara
 *    apertura y cierre; finAPI siempre dice cuánto hay en la cuenta. Eso, junto
 *    con el saldo que nuestro libro ya tenía, cierra la ecuación por primera
 *    vez: saldo previo + movimientos = lo que dice el banco, o hay delta y se
 *    ve. Ver `openingFromLedger` en el pipeline.
 *
 *  · **Un movimiento puede corregirse en su sitio.** El identificador de
 *    finAPI es estable entre pendiente y asentado, así que un importe que
 *    cambia no es un movimiento nuevo: es el mismo, corregido. Eso es el
 *    veredicto 'updated' del dedup y se aplica con `updateBookedTransaction`.
 *
 *  · **No se guarda el saldo como `declared_balance`.** Ver `sincronizarCuenta`.
 *
 * ── Una petición, una cuenta ─────────────────────────────────────────────────
 *
 * El corpus del sandbox son 1.612 movimientos en cuatro páginas. Hacerlo todo
 * en una petición es pedirle a la suerte que el tiempo alcance, y una petición
 * cortada a la mitad es lo único que no nos podemos permitir: dejaría medio
 * lote escrito. Por eso la unidad de trabajo es **una cuenta**, y cada cuenta
 * corre dentro de su propia transacción: o entra entera o no entra.
 */

import { createHash } from 'node:crypto'
import { type Money, money, type ParsedStatement, toDecimalString, zero } from '@moneypilot/core'
import {
  type AccountKind,
  ensureLedgerAccount,
  type FeedConnectionRow,
  listFeedAccounts,
  markFeedAccountSynced,
  type PersistableTransaction,
  persistImport,
  readConnection,
  type TenantClient,
  updateBookedTransaction,
} from '@moneypilot/db'
import { mapFinapiAccount, maskAccountNumber } from '@moneypilot/importers'
import { conNombreDeCuenta, existingForAccount, toPersistInput } from '../importacion'
import { type PipelineResult, runStatements, toWireReport, type WireReport } from '../pipeline'
import { traerCuentas, traerMovimientos } from './client'
import { PROVEEDOR } from './hogar'
import type { FinapiRawAccount } from './tipos'

/** Traer cuatro páginas de 500 movimientos no es instantáneo. */
const TIMEOUT_MOVIMIENTOS_MS = 60_000
const TIMEOUT_CUENTAS_MS = 20_000

export class SincronizacionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SincronizacionError'
  }
}

/* ── Preparar: una cuenta nuestra por cada cuenta de finAPI ───────────────── */

export interface CuentaDelFeed {
  /** El id de la cuenta EN finAPI. Es con lo que se pide la sincronización. */
  readonly externalAccountId: string
  /** La cuenta de nuestro libro que la recibe. */
  readonly accountId: string
  readonly nombre: string
  readonly moneda: string
  readonly institucion: string | null
  /** El saldo que declara finAPI, como cadena decimal exacta. */
  readonly saldoDeclarado: string | null
  /** true si esta preparación acaba de crear la cuenta del libro. */
  readonly creada: boolean
}

/**
 * Asegura que cada cuenta de finAPI tenga su cuenta en el libro, y devuelve el
 * plan de sincronización.
 *
 * Es idempotente: llamarla dos veces no crea nada la segunda vez. Y no toca
 * ningún movimiento — es sólo el plan, para que la pantalla pueda enseñar
 * cuántas cuentas hay antes de empezar y avanzar de a una.
 */
export async function prepararCuentas(
  client: TenantClient,
  token: string,
  conexiones: readonly FeedConnectionRow[],
): Promise<CuentaDelFeed[]> {
  const cuentas = await traerCuentas(token, { timeoutMs: TIMEOUT_CUENTAS_MS })

  // Por identificador de conexión bancaria y no sólo la recién completada: un
  // hogar puede tener dos bancos conectados, y `GET /accounts` devuelve las
  // cuentas de todos mezcladas. Sin el mapa, las del banco que se conectó la
  // semana pasada se crearían sin institución.
  const porConexion = new Map(
    conexiones
      .filter((conexion) => conexion.bankConnectionId !== null)
      .map((conexion) => [conexion.bankConnectionId as string, conexion]),
  )

  const plan: CuentaDelFeed[] = []
  for (const cuenta of cuentas) {
    const suya =
      cuenta.bankConnectionId === null ? undefined : porConexion.get(cuenta.bankConnectionId)
    const institucion = suya?.bankName ?? null
    const enlazadaA = suya?.id ?? null

    const resultado = await ensureLedgerAccount(client, {
      provider: PROVEEDOR,
      externalAccountId: String(cuenta.id),
      connectionId: enlazadaA,
      name: nombreDe(cuenta, institucion),
      kind: claseDe(cuenta.accountType),
      currency: cuenta.accountCurrency ?? 'EUR',
      institution: institucion,
      // Enmascarado como en todos los parsers: del número propio sólo hacen
      // falta los últimos dígitos para que una persona reconozca la cuenta.
      accountNumber: maskAccountNumber(cuenta.iban ?? cuenta.accountNumber ?? undefined) ?? null,
      country: paisDeIban(cuenta.iban),
    })

    plan.push({
      externalAccountId: String(cuenta.id),
      accountId: resultado.accountId,
      nombre: resultado.name,
      moneda: (cuenta.accountCurrency ?? 'EUR').toUpperCase(),
      institucion,
      saldoDeclarado: cuenta.balance,
      creada: resultado.created,
    })
  }

  return plan
}

/**
 * La clase contable de la cuenta, desde el tipo que declara finAPI.
 *
 * Sólo se distingue lo que cambia el signo del patrimonio: una tarjeta y un
 * préstamo son deuda, todo lo demás es activo. Afinar más —distinguir depósito
 * de cuenta corriente— no cambia ningún número y sí multiplica las formas de
 * equivocarse con una taxonomía ajena. Si queda mal, se ve y se corrige.
 */
function claseDe(accountType: string | null): AccountKind {
  const tipo = (accountType ?? '').trim().toLowerCase()
  return tipo === 'creditcard' || tipo === 'loan' ? 'liability' : 'asset'
}

function nombreDe(cuenta: FinapiRawAccount, institucion: string | null): string {
  const propio = (cuenta.accountName ?? '').trim()
  const base = propio === '' ? `Cuenta ${cuenta.id}` : propio
  return institucion === null ? base : `${institucion} · ${base}`
}

/**
 * El país sale del IBAN y no de otro sitio porque finAPI no lo declara. Dos
 * letras mayúsculas al principio es exactamente lo que define el estándar.
 */
function paisDeIban(iban: string | null): string | null {
  const limpio = (iban ?? '').trim().toUpperCase()
  return /^[A-Z]{2}/.test(limpio) ? limpio.slice(0, 2) : null
}

/* ── Sincronizar una cuenta ───────────────────────────────────────────────── */

export interface FilaEnRevision {
  readonly lineNumber: number
  readonly bookedOn: string
  readonly description: string
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
}

export interface CuentaVacia {
  readonly kind: 'vacia'
  readonly externalAccountId: string
  readonly accountId: string
  readonly nombreDeCuenta: string
}

export type ResultadoDeCuenta = CuentaSincronizada | CuentaVacia

export interface SincronizarCuentaInput {
  readonly token: string
  readonly externalAccountId: string
}

export async function sincronizarCuenta(
  client: TenantClient,
  input: SincronizarCuentaInput,
): Promise<ResultadoDeCuenta> {
  const enlace = (await listFeedAccounts(client, PROVEEDOR)).find(
    (fila) => fila.externalAccountId === input.externalAccountId,
  )
  if (enlace === undefined) {
    throw new SincronizacionError(
      `La cuenta ${input.externalAccountId} de finAPI no está enlazada con ninguna cuenta de este ` +
        'hogar. Volvé a pulsar "Ya terminé, traer los movimientos" para prepararlas.',
    )
  }

  const nuestra = await leerCuenta(client, enlace.accountId)
  const conexion = await leerConexionDelEnlace(client, enlace.connectionId)

  const cuentas = await traerCuentas(input.token, { timeoutMs: TIMEOUT_CUENTAS_MS })
  const cruda = cuentas.find((cuenta) => String(cuenta.id) === input.externalAccountId)
  if (cruda === undefined) {
    throw new SincronizacionError(
      `finAPI ya no devuelve la cuenta ${input.externalAccountId}. Puede que la conexión bancaria ` +
        'se haya borrado allá; los movimientos que ya importaste siguen en tu libro.',
    )
  }

  const movimientos = await traerMovimientos(input.token, {
    accountIds: [input.externalAccountId],
    timeoutMs: TIMEOUT_MOVIMIENTOS_MS,
  })

  const statement = mapFinapiAccount(
    // `bankName` no viene con la cuenta: finAPI lo tiene en la conexión
    // bancaria. Se adjunta acá para que el mapeador pueda componer la
    // institución igual que hace un parser con la cabecera del fichero.
    { ...cruda, bankName: conexion?.bankName ?? null },
    movimientos,
    { fallbackCurrency: nuestra.currency },
  )

  if (statement.account.currency !== nuestra.currency) {
    // Se para acá y no en `persistImport` porque ahí sólo saltaría si hubiera
    // al menos un movimiento: una cuenta en la divisa equivocada y sin
    // movimientos pasaría callada y rompería en la sincronización siguiente.
    throw new SincronizacionError(
      `finAPI declara la cuenta ${input.externalAccountId} en ${statement.account.currency} y ` +
        `"${nuestra.name}" está en ${nuestra.currency}. Una cuenta tiene una sola moneda: los ` +
        'movimientos en otra divisa necesitan su propia cuenta, no una conversión inventada.',
    )
  }

  if (statement.lines.length === 0) {
    // No se guarda un lote vacío: ocuparía el hash de contenido y el día que
    // la cuenta tenga movimientos, sincronizarla no haría nada.
    return {
      kind: 'vacia',
      externalAccountId: input.externalAccountId,
      accountId: enlace.accountId,
      nombreDeCuenta: nuestra.name,
    }
  }

  const fechas = statement.lines.map((linea) => linea.bookedOn).sort()
  const desde = fechas[0] as string
  const hasta = fechas[fechas.length - 1] as string

  const existing = await existingForAccount(client, enlace.accountId, { from: desde, to: hasta })
  const saldoPrevio = await saldoDelLibro(client, enlace.accountId, nuestra.currency)

  const opciones = {
    fileName: nombreDelLote(nuestra.name, cruda),
    format: 'finapi' as const,
    // El uuid de la cuenta es lo único estable para la huella de identidad: si
    // se usara el nombre, renombrarla duplicaría el histórico entero la
    // próxima vez. Ver la cabecera de importacion.ts.
    accountLabel: enlace.accountId,
    existing,
    source: 'api' as const,
    openingFromLedger: new Map([[enlace.accountId, saldoPrevio]]),
  }

  // Primera pasada: clasificar. Hace falta antes de reconciliar porque las
  // correcciones en su sitio mueven el saldo sin ser líneas importadas, y ese
  // desplazamiento tiene que entrar en el cierre calculado — si no, el delta
  // culparía a la importación de un cambio que ella misma hizo bien.
  const sonda = runStatements([statement], opciones)
  const correcciones = correccionesDe(sonda, enlace.accountId, nuestra.currency)

  const resultado =
    correcciones.total.amount === 0n
      ? sonda
      : runStatements([statement], {
          ...opciones,
          movementAdjustments: new Map([[enlace.accountId, correcciones.total]]),
        })

  const report = conNombreDeCuenta(toWireReport(resultado.report), enlace.accountId, nuestra.name)

  // Las correcciones van ANTES del lote nuevo: `updateBookedTransaction` se
  // niega en varios casos legítimos —el asiento está enlazado con una
  // anulación, el gasto está repartido en varias contrapartidas— y es mejor
  // que la sincronización entera se caiga sin escribir nada que dejar un lote
  // escrito y las correcciones a medias. Todo corre en la misma transacción,
  // así que un fallo acá revierte también lo de más arriba.
  for (const correccion of correcciones.filas) {
    await updateBookedTransaction(client, {
      entryId: correccion.entryId,
      accountId: enlace.accountId,
      transaction: correccion.transaction,
    })
  }

  const base = toPersistInput({
    result: resultado,
    accountId: enlace.accountId,
    fileName: opciones.fileName,
    contentSha256: huellaDelExtracto(enlace.accountId, statement),
    report,
    source: 'api',
  })

  const guardado = await persistImport(client, {
    ...base,
    // Se cuentan en el lote aunque no las escriba `persistImport`: sin esto,
    // el historial enseñaría 1.612 leídas repartidas en columnas que suman
    // 1.600, y las 12 que faltan no aparecerían en ningún sitio.
    updated: correcciones.filas.length,
    // El saldo del feed NO se guarda como saldo declarado, y es deliberado.
    // `declared_balance` tiene grano de día y significa "esto dijo el banco al
    // cerrar el día X"; lo que da finAPI es el saldo en el instante de su
    // última lectura. Dos sincronizaciones el mismo día devuelven cifras
    // distintas y las dos son ciertas — guardarlas haría que la segunda
    // abortara la importación entera por contradecir a la primera. El saldo
    // sigue haciendo su trabajo donde corresponde: en el informe, como cierre
    // real contra el que se mide el delta.
    declaredBalances: [],
  })

  await markFeedAccountSynced(client, PROVEEDOR, input.externalAccountId)

  return {
    kind: 'ok',
    externalAccountId: input.externalAccountId,
    accountId: enlace.accountId,
    nombreDeCuenta: nuestra.name,
    batchId: guardado.batchId,
    guardado: !guardado.skippedByContentHash,
    imported: guardado.imported,
    updated: correcciones.filas.length,
    duplicates: guardado.duplicates,
    needsReview: guardado.needsReview,
    report,
    review: resultado.classified
      .filter((item) => item.verdict.kind === 'review')
      .map((item) => ({
        lineNumber: item.incoming.lineNumber,
        bookedOn: item.incoming.bookedOn,
        description: item.incoming.description,
      })),
  }
}

/* ── Piezas ───────────────────────────────────────────────────────────────── */

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

/**
 * Huella del contenido del extracto, que es lo que hace idempotente
 * resincronizar.
 *
 * Un fichero tiene bytes y se le hace sha256; un feed no, así que hay que
 * fabricar el equivalente. Se hace **con lo que llega al libro** —id del
 * proveedor, fechas, importe, descripción y el saldo declarado— y no con la
 * respuesta cruda entera: si se hashara todo, un cambio en la categoría alemana
 * o en el reloj de finAPI produciría un lote nuevo que resultaría ser 1.612
 * duplicados, y el historial se llenaría de lotes sin asientos.
 *
 * Va la cuenta de nuestro libro dentro a propósito: dos cuentas distintas del
 * agregador podrían tener contenidos idénticos —una cuenta recién abierta y
 * vacía, por ejemplo— y sin esto la segunda se saltaría creyendo que ya estaba.
 *
 * El importe entra como cadena decimal canónica desde el `Money`, o sea desde
 * el bigint: en ningún punto de esta función hay un número de coma flotante.
 */
export function huellaDelExtracto(accountId: string, statement: ParsedStatement): string {
  const hash = createHash('sha256')
  hash.update('moneypilot/finapi/extracto/v1\n')
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
      ].join('\u001F'),
    )
    hash.update('\n')
  }
  return hash.digest('hex')
}

/**
 * El nombre con el que el lote aparece en el historial.
 *
 * La columna dice "Origen" y no "Fichero" justamente por esto: acá no hubo
 * ningún fichero, y escribir uno inventado haría que alguien lo buscara en su
 * disco dentro de seis meses.
 */
function nombreDelLote(nombreDeCuenta: string, cuenta: FinapiRawAccount): string {
  return `finAPI · ${nombreDeCuenta} (cuenta ${cuenta.id})`
}

interface CuentaDelLibro {
  readonly name: string
  readonly currency: string
}

async function leerCuenta(client: TenantClient, accountId: string): Promise<CuentaDelLibro> {
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

async function leerConexionDelEnlace(
  client: TenantClient,
  connectionId: string | null,
): Promise<FeedConnectionRow | null> {
  return connectionId === null ? null : readConnection(client, connectionId)
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
async function saldoDelLibro(
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
