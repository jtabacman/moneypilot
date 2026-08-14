/**
 * El enganche: clasificar lo que acaba de entrar, sin poner en riesgo el lote.
 *
 * Es el pegamento entre dos contratos que ya existen —`persistImport`, que
 * escribe el lote, y `clasificarAutomatico`, que decide categorías— y vive acá
 * porque los dos caminos de entrada lo necesitan igual: el fichero que sube una
 * persona y el feed del agregador. Copiarlo habría sido peor que compartirlo:
 * de dos copias, la que se queda sin actualizar clasifica con menos capas y
 * nadie se entera, porque el resultado sigue pareciendo razonable.
 *
 * ── La regla que gobierna el módulo ─────────────────────────────────────────
 *
 * **Si la clasificación falla, la importación no se pierde.** Suena a un
 * `try/catch` y no lo es: todo esto corre dentro de la MISMA transacción que
 * acaba de escribir el lote, y en Postgres un error deja la transacción
 * abortada — capturarlo en TypeScript devolvería un mensaje bonito y el
 * `commit` de después fallaría igual, tirando el lote entero. Por eso la pasada
 * va dentro de un savepoint: es lo que convierte «se perdió la importación» en
 * «entraron los 1.612 movimientos y la clasificación no anduvo».
 *
 * El orden también es parte de esa promesa: primero se persiste, después se
 * clasifica. Nunca al revés.
 *
 * ── Por qué hay que pasarle observaciones ───────────────────────────────────
 *
 * Dos de las cinco capas —la señal y el proveedor— leen datos que el esquema no
 * guarda: el concepto común de la Norma 43, el `payment_channel` y la
 * `personal_finance_category` de Plaid. Están en el `raw` de cada
 * `StatementLine` y se pierden al persistir, porque `entry` no tiene dónde
 * ponerlos. Este módulo es el único sitio del sistema donde el `raw` y el
 * `entry.id` existen a la vez, y por eso es acá donde se cruzan.
 *
 * El cruce va por **huella**, que es la clave de identidad del asiento, y no
 * por descripción ni por importe: dos cafés de 3,50 el mismo día son dos
 * movimientos distintos y sólo la huella —que lleva el ordinal dentro— los
 * separa. Emparejarlos mal no daría error: le pondría a un movimiento la
 * categoría del de al lado.
 */

import type { ClassifiedTransaction, ParsedStatement } from '@moneypilot/core'
import {
  type ClasificacionAutomatica,
  clasificarAutomatico,
  conSavepoint,
  type ObservacionDelOrigen,
  type Procedencia,
  type TenantClient,
} from '@moneypilot/db'

export type { ObservacionDelOrigen }

export interface CapaDelInforme {
  readonly procedencia: Procedencia
  readonly propuestas: number
  readonly aplicadas: number
}

/**
 * Lo que se cuenta en el informe de importación. Es un recorte de
 * `ClasificacionAutomatica`: acá no viajan las propuestas una a una porque el
 * informe se guarda en `import_batch.report` y son miles de filas que nadie va
 * a leer ahí — se recalculan en /movimientos, que es donde se miran.
 */
export interface ClasificacionDelLote {
  readonly aplicadas: number
  readonly sugeridas: number
  readonly sinPropuesta: number
  readonly porCapa: readonly CapaDelInforme[]
  /** Rutas que alguna capa quiso usar y que este hogar no tiene como cuenta. */
  readonly rutasSinCuenta: readonly { ruta: string; movimientos: number }[]
  /**
   * Qué salió mal, si salió algo. Que esto tenga texto y el lote esté guardado
   * es exactamente el caso que el savepoint existe para permitir.
   */
  readonly error: string | null
}

export interface ClasificarLoteInput {
  /** El lote recién escrito. Acota la pasada a lo que acaba de entrar. */
  readonly batchId: string
  /** Los extractos parseados: de acá sale el `raw` de cada línea. */
  readonly statements: readonly ParsedStatement[]
  /** El veredicto del dedup: de acá sale la huella de cada línea. */
  readonly classified: readonly ClassifiedTransaction[]
  /** Quién enriqueció, cuando el origen es un agregador. */
  readonly proveedor?: 'plaid' | undefined
}

export const SIN_CLASIFICAR: ClasificacionDelLote = {
  aplicadas: 0,
  sugeridas: 0,
  sinPropuesta: 0,
  porCapa: [],
  rutasSinCuenta: [],
  error: null,
}

export async function clasificarLote(
  client: TenantClient,
  input: ClasificarLoteInput,
): Promise<ClasificacionDelLote> {
  try {
    return await conSavepoint(client, async () => {
      const entryIds = await asientosDelLote(client, input.batchId)
      if (entryIds.size === 0) return SIN_CLASIFICAR

      const resultado = await clasificarAutomatico(client, {
        entryIds: [...entryIds.values()],
        aplicar: true,
        observaciones: observacionesDelLote(input, entryIds),
      })
      return alInforme(resultado)
    })
  } catch (error) {
    // El lote sobrevive: el savepoint deshizo sólo lo de acá. Lo que no
    // sobrevive es el silencio — el informe dice que la clasificación no corrió
    // y por qué, porque un cero sin explicación se lee como «no había nada que
    // clasificar», que es otra cosa.
    return {
      ...SIN_CLASIFICAR,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function alInforme(resultado: ClasificacionAutomatica): ClasificacionDelLote {
  return {
    aplicadas: resultado.aplicadas,
    sugeridas: resultado.sugeridas,
    sinPropuesta: resultado.sinPropuesta,
    porCapa: resultado.porCapa.map((capa) => ({
      procedencia: capa.procedencia,
      propuestas: capa.propuestas,
      aplicadas: capa.aplicadas,
    })),
    rutasSinCuenta: resultado.rutasSinCuenta.map((perdida) => ({
      ruta: perdida.ruta,
      movimientos: perdida.movimientos,
    })),
    error: null,
  }
}

/**
 * Los asientos del lote, indexados por huella.
 *
 * Va en SQL directo y no por el repositorio por el mismo motivo que
 * `existingForAccount`: la capa de lectura no expone la huella porque no es
 * algo que se le enseñe a nadie — es la clave técnica de la identidad.
 *
 * Se leen del lote y no de `input.classified` a propósito: lo que hay en la
 * base es la verdad de qué entró. Una fila que el dedup dio por nueva y que
 * `persistImport` no escribió —porque el fichero ya estaba cargado entero, por
 * ejemplo— no tiene asiento al que clasificar, y arrancar de la lista de
 * candidatos en vez de del libro llevaría a buscar ids que no existen.
 */
async function asientosDelLote(
  client: TenantClient,
  batchId: string,
): Promise<Map<string, string>> {
  const { rows } = await client.query<{ id: string; fingerprint: string | null }>(
    `select id, trim(fingerprint) as fingerprint
       from entry
      where import_batch_id = $1::uuid`,
    [batchId],
  )
  const porHuella = new Map<string, string>()
  for (const row of rows) {
    // El asiento de apertura no tiene huella y no viene de ninguna línea: entra
    // igual a la pasada (por eso el valor va al mapa) pero sin observaciones.
    porHuella.set(row.fingerprint ?? `sin-huella:${row.id}`, row.id)
  }
  return porHuella
}

/**
 * Lo que trajo el origen y la base no guarda, indexado por asiento.
 *
 * El camino es huella → número de línea → `raw`. La huella la pone el dedup y
 * el número de línea viaja con ella; el `raw` está en el extracto parseado.
 * Cuando algún eslabón no está —un formato que no numera, dos líneas con el
 * mismo número— no se adivina: ese movimiento se queda sin observaciones y lo
 * clasifican las capas que no las necesitan.
 */
function observacionesDelLote(
  input: ClasificarLoteInput,
  porHuella: ReadonlyMap<string, string>,
): Map<string, ObservacionDelOrigen> {
  const lineas = lineasPorNumero(input.statements)
  const salida = new Map<string, ObservacionDelOrigen>()

  for (const item of input.classified) {
    const entryId = porHuella.get(item.fingerprint)
    if (entryId === undefined) continue
    const raw = lineas.get(item.incoming.lineNumber)
    if (raw === undefined) continue
    const observacion = leerRaw(raw, input.proveedor)
    if (observacion !== null) salida.set(entryId, observacion)
  }
  return salida
}

/**
 * Las líneas por número, y `undefined` para los números repetidos.
 *
 * Un extracto con dos cuentas puede repetir la numeración, y ahí emparejar por
 * número le pondría a un movimiento el `raw` de otro. La ruta de importación
 * rechaza esos ficheros antes de llegar acá y el feed va cuenta por cuenta, así
 * que en la práctica no pasa; el borrado es lo que hace que si algún día pasa,
 * el resultado sea «no sé» y no una categoría equivocada con cara de segura.
 */
function lineasPorNumero(
  statements: readonly ParsedStatement[],
): Map<number, Readonly<Record<string, string>> | undefined> {
  const porNumero = new Map<number, Readonly<Record<string, string>> | undefined>()
  for (const statement of statements) {
    for (const linea of statement.lines) {
      if (porNumero.has(linea.lineNumber)) porNumero.set(linea.lineNumber, undefined)
      else porNumero.set(linea.lineNumber, linea.raw)
    }
  }
  return porNumero
}

/**
 * De las claves del `raw` a los campos que leen las capas.
 *
 * Se leen **sólo las claves documentadas** de los dos formatos que las emiten,
 * y por su nombre exacto:
 *
 *  · Norma 43 → `concepto_comun` y `concepto_propio` (ver `n43/parse.ts`). El
 *    propio se transporta y no se interpreta nunca: el 007 de un banco no es el
 *    007 de otro.
 *  · Plaid → `personal_finance_category.*`, `merchant_name`, `payment_channel`
 *    y `transaction_code` (ver `collectRaw` en `plaid/map.ts`).
 *
 * Nada de recorrer el `raw` buscando claves que suenen parecido. Un OFX que
 * traiga un campo llamado `payment_channel` no significa lo mismo que el de
 * Plaid, y tomarlo por bueno metería una señal falsa por la puerta de atrás.
 *
 * La categoría del proveedor sólo se lee cuando quien llama declara de qué
 * proveedor es el lote: la etiqueta `GENERAL_SERVICES_INSURANCE` no dice de
 * quién es, y traducirla con la tabla equivocada es el error que la capa de
 * correspondencias existe para no cometer.
 */
function leerRaw(
  raw: Readonly<Record<string, string>>,
  proveedor: 'plaid' | undefined,
): ObservacionDelOrigen | null {
  const texto = (clave: string): string | undefined => {
    const valor = raw[clave]?.trim()
    return valor === undefined || valor === '' ? undefined : valor
  }

  const conceptoComun = texto('concepto_comun')
  const conceptoPropio = texto('concepto_propio')
  const merchantName = texto('merchant_name')
  const paymentChannel = texto('payment_channel')
  const transactionCode = texto('transaction_code')
  const detailed = proveedor === undefined ? undefined : texto('personal_finance_category.detailed')
  const primary = texto('personal_finance_category.primary')
  const confianza = texto('personal_finance_category.confidence_level')

  const observacion: ObservacionDelOrigen = {
    ...(conceptoComun === undefined ? {} : { conceptoComun }),
    ...(conceptoPropio === undefined ? {} : { conceptoPropio }),
    ...(merchantName === undefined ? {} : { merchantName }),
    ...(paymentChannel === undefined ? {} : { paymentChannel }),
    ...(transactionCode === undefined ? {} : { transactionCode }),
    ...(detailed === undefined || proveedor === undefined
      ? {}
      : {
          categoriaDelProveedor: {
            proveedor,
            detailed,
            ...(primary === undefined ? {} : { primary }),
            ...(confianza === undefined ? {} : { confianza }),
          },
        }),
  }
  // Un objeto vacío en el mapa haría creer a quien lo lea que el origen mandó
  // algo. Que no haya entrada es la verdad.
  return Object.keys(observacion).length === 0 ? null : observacion
}
