/**
 * La traducción entre el informe que se le enseña al cliente y lo que entra al
 * libro.
 *
 * Vive al lado de la ruta y no en `lib/` a propósito: no es una pieza
 * reutilizable, es el pegamento entre dos contratos que ya existen —el
 * resultado de `runPipeline` y la entrada de `persistImport`—. El día que haya
 * una segunda superficie que persista importaciones, lo que se comparte es el
 * paquete entero, no medio módulo de la web.
 *
 * Dos decisiones de acá gobiernan que reimportar funcione:
 *
 *  1. **La cuenta del pipeline es el uuid de la cuenta del hogar.** La huella
 *     canónica incluye el identificador de cuenta, así que tiene que ser algo
 *     que no cambie nunca. Si se usara el nombre, renombrar "BBVA" a "BBVA
 *     Corriente" cambiaría todas las huellas futuras y el extracto del mes
 *     siguiente entraría duplicado entero, en silencio. Lo que se enseña sigue
 *     siendo el nombre: ver `conNombreDeCuenta`.
 *
 *  2. **El dedup se corre contra lo que ya está en el libro.** Sin eso, el
 *     segundo extracto que solape con el primero —que es lo normal: los bancos
 *     dan rangos que se pisan— llegaría a Postgres con huellas repetidas y
 *     rebotaría contra el índice único con un error que no explica nada, en
 *     vez de contarlas como duplicadas en el informe.
 */

import { createHash } from 'node:crypto'
import {
  addDays,
  type ClassifiedTransaction,
  money,
  type ParsedStatement,
  parsePlainDate,
  type TransactionRef,
} from '@moneypilot/core'
import type {
  DeclaredBalanceInput,
  NeedsReviewTransaction,
  PersistableTransaction,
  PersistImportInput,
  TenantClient,
} from '@moneypilot/db'
import type { PipelineResult, WireReport } from '@/lib/pipeline'

/** Hash del contenido, que es lo que hace idempotente reimportar el fichero. */
export function contentHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/* ── Lo que ya está en el libro ──────────────────────────────────────────── */

/**
 * Margen a cada lado del período del fichero para buscar candidatos.
 *
 * No es un número al azar y no puede quedarse corto: la pasada determinista
 * compara huellas, y la huella lleva la fecha dentro, así que un duplicado
 * exacto cae siempre dentro del propio período. La difusa mira ±5 días. Treinta
 * cubre las dos con holgura y mantiene acotada la lectura, que si no sería el
 * histórico entero de la cuenta en memoria.
 */
const MARGEN_DIAS = 30

interface FilaExistente {
  readonly id: string
  readonly booked_on: string
  readonly description: string
  readonly fingerprint: string
  readonly external_id: string | null
  readonly amount: string
  readonly currency: string
}

/**
 * Los asientos que ya tiene la cuenta alrededor del período del extracto.
 *
 * Va en SQL directo y no por el repositorio porque la capa de lectura no
 * expone la huella: `movements()` devuelve lo que se le enseña al usuario, y
 * la huella no es eso — es la clave técnica del dedup. Cuando exista una
 * función de repositorio que la devuelva, esta consulta se borra y se llama a
 * aquélla.
 */
export async function existingForAccount(
  client: TenantClient,
  accountId: string,
  period: { readonly from: string; readonly to: string },
): Promise<TransactionRef[]> {
  const desde = addDays(parsePlainDate(period.from), -MARGEN_DIAS)
  const hasta = addDays(parsePlainDate(period.to), MARGEN_DIAS)

  const { rows } = await client.query<FilaExistente>(
    // `distinct on` con orden por ordinal: la pata de la cuenta del extracto es
    // la 0, pero un asiento escrito a mano puede tener la suya en otro sitio, y
    // perderlo acá lo convertiría en un duplicado la próxima importación.
    `select distinct on (e.id)
            e.id,
            to_char(e.booked_on, 'YYYY-MM-DD') as booked_on,
            e.description,
            trim(e.fingerprint) as fingerprint,
            e.external_id,
            p.amount::text as amount,
            trim(p.currency) as currency
       from entry e
       join posting p on p.entry_id = e.id and p.account_id = $1::uuid
      where e.fingerprint is not null
        and e.booked_on between $2::date and $3::date
      order by e.id, p.ordinal`,
    [accountId, desde, hasta],
  )

  return rows.map((row) => ({
    id: row.id,
    // La misma clave con la que el pipeline identifica la cuenta: si no
    // coincidiera, la pasada difusa no encontraría ni un candidato.
    accountId,
    bookedOn: parsePlainDate(row.booked_on),
    amount: money(BigInt(row.amount), row.currency),
    description: row.description,
    fingerprint: row.fingerprint,
    ...(row.external_id === null ? {} : { externalId: row.external_id }),
  }))
}

/* ── Del informe al libro ────────────────────────────────────────────────── */

export interface PersistArgs {
  readonly result: PipelineResult
  readonly accountId: string
  readonly fileName: string
  readonly contentSha256: string
  /** El informe tal cual se le devuelve al cliente, ya sin bigint. */
  readonly report: WireReport
}

export function toPersistInput(args: PersistArgs): PersistImportInput {
  const { report } = args.result

  const transactions: PersistableTransaction[] = []
  const needsReview: NeedsReviewTransaction[] = []

  for (const item of args.result.classified) {
    if (item.verdict.kind === 'new') {
      transactions.push(persistable(item))
      continue
    }
    if (item.verdict.kind !== 'review') continue
    needsReview.push({
      transaction: persistable(item),
      // La evidencia se guarda entera: es lo que le va a permitir a alguien
      // decidir dentro de seis meses por qué esta fila quedó en la cola.
      evidence: {
        reason: item.verdict.reason,
        candidateId: item.verdict.candidateId,
        similarity: item.verdict.similarity,
        dayGap: item.verdict.dayGap,
        lineNumber: item.incoming.lineNumber,
        fileName: args.fileName,
      },
      kind: 'posible_duplicado',
    })
  }

  return {
    accountId: args.accountId,
    fileName: args.fileName,
    format: report.format,
    contentSha256: args.contentSha256,
    linesRead: report.linesRead,
    transactions,
    duplicates: report.duplicates,
    needsReview,
    rejected: report.rejected.length,
    declaredBalances: declaredBalancesOf(args.result.statements),
    report: args.report,
  }
}

function persistable(item: ClassifiedTransaction): PersistableTransaction {
  return {
    bookedOn: item.incoming.bookedOn,
    description: item.incoming.description,
    amount: item.incoming.amount.amount,
    currency: item.incoming.amount.currency,
    fingerprint: item.fingerprint,
    ...(item.incoming.externalId === undefined ? {} : { externalId: item.incoming.externalId }),
  }
}

/**
 * Los saldos que declara el propio extracto, que son lo que después permite
 * comprobar la reconciliación contra algo que no calculamos nosotros.
 */
function declaredBalancesOf(statements: readonly ParsedStatement[]): DeclaredBalanceInput[] {
  const out: DeclaredBalanceInput[] = []
  for (const statement of statements) {
    for (const balance of [statement.openingBalance, statement.closingBalance]) {
      if (balance === undefined) continue
      out.push({
        asOf: balance.on,
        amount: balance.amount.amount,
        currency: balance.amount.currency,
      })
    }
  }
  return out
}

/* ── Etiqueta de la cuenta ───────────────────────────────────────────────── */

/**
 * Devuelve el informe con el nombre de la cuenta donde el pipeline puso su
 * uuid.
 *
 * El uuid es la clave de la huella (ver la cabecera) y el nombre es lo que
 * entiende una persona. Esta función es la costura entre las dos, y se aplica
 * una sola vez, en la frontera: lo que se guarda en el lote es ya el informe
 * que el cliente vio.
 */
export function conNombreDeCuenta(
  report: WireReport,
  accountId: string,
  accountName: string,
): WireReport {
  return {
    ...report,
    accounts: report.accounts.map((account) => ({
      ...account,
      accountLabel: account.accountLabel.startsWith(accountId)
        ? // Lo que sigue al uuid es el número de cuenta enmascarado que trajo el
          // fichero, y eso sí vale la pena conservarlo.
          `${accountName}${account.accountLabel.slice(accountId.length)}`
        : account.accountLabel,
    })),
  }
}
