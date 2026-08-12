#!/usr/bin/env node
/**
 * moneypilot — línea de comandos.
 *
 * Dos comandos, y el orden entre ellos es deliberado:
 *
 *   inspect  mira el fichero y dice qué encontró, sin importar nada
 *   import   ejecuta el pipeline completo y emite el informe de conciliación
 *
 * `inspect` existe porque la regla del producto es no importar en silencio.
 * Antes de escribir un solo asiento, alguien tiene que poder ver qué formato
 * se detectó, qué columna es cada cosa y en qué orden se leyeron las fechas.
 */

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { formatMoney, renderImportReport } from '@moneypilot/core'
import { detectFormat, inspectCsv } from '@moneypilot/importers'
import {
  MissingCurrencyError,
  runPipeline,
  UnsupportedFormatError,
  UnsupportedStatementError,
} from './pipeline.js'

const USAGE = `moneypilot — motor de importación y conciliación

  moneypilot inspect <fichero>
      Detecta el formato y muestra el esquema sin importar nada.

  moneypilot import <fichero> [opciones]
      Ejecuta el pipeline completo y emite el informe de conciliación.

Opciones
  --currency <ISO>   Moneda de la cuenta. Obligatoria en QIF y CSV, que no
                     la declaran. Ejemplo: --currency EUR
  --account <nombre> Etiqueta de la cuenta para el informe.
  --json             Emite el informe como JSON en vez de texto.

Ejemplos
  moneypilot inspect extracto.csv
  moneypilot import bbva-marzo.n43
  moneypilot import quicken.qif --currency USD --account "Chase Checking"
`

interface Args {
  readonly command: string | undefined
  readonly file: string | undefined
  readonly currency: string | undefined
  readonly account: string | undefined
  readonly json: boolean
}

function parseArgs(argv: readonly string[]): Args {
  const positional: string[] = []
  let currency: string | undefined
  let account: string | undefined
  let json = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--currency') {
      currency = argv[index + 1]
      index += 1
    } else if (arg === '--account') {
      account = argv[index + 1]
      index += 1
    } else if (arg === '--json') json = true
    else if (arg !== undefined && !arg.startsWith('--')) positional.push(arg)
  }

  return {
    command: positional[0],
    file: positional[1],
    currency,
    account,
    json,
  }
}

function inspect(file: string): number {
  const bytes = new Uint8Array(readFileSync(file))
  const detection = detectFormat(bytes)

  console.log(`fichero    ${basename(file)}  (${bytes.byteLength.toLocaleString('es-ES')} bytes)`)
  console.log(`formato    ${detection.format ?? 'desconocido'} — ${detection.evidence}`)

  if (detection.format === null) {
    console.log('\nNo se puede continuar sin reconocer el formato.')
    return 1
  }

  if (detection.format === 'csv') {
    const csv = inspectCsv(bytes)
    console.log(`separador  ${JSON.stringify(csv.delimiter)}`)
    console.log(
      `cabecera   ${csv.headerLine === null ? 'no encontrada' : `línea ${csv.headerLine}`}`,
    )
    console.log(`fechas     ${csv.dateOrder} — ${csv.dateEvidence}`)
    console.log(`decimales  ${JSON.stringify(csv.decimalSeparator)}`)
    console.log(`importes   ${csv.layout}`)
    console.log(`filas      ${csv.dataRows}`)
    console.log(`confianza  ${csv.confidence}`)

    if (csv.headers.length > 0) {
      console.log('\ncolumnas detectadas')
      for (const [index, header] of csv.headers.entries()) {
        const role = roleOf(csv.mapping, index)
        console.log(`  ${String(index).padStart(2)}  ${header.padEnd(24)}${role}`)
      }
    }
    if (csv.notes.length > 0) {
      console.log('\na revisar')
      for (const note of csv.notes) console.log(`  · ${note}`)
    }
  }

  return 0
}

function roleOf(mapping: ReturnType<typeof inspectCsv>['mapping'], index: number): string {
  if (mapping.date === index) return 'fecha'
  if (mapping.valueDate === index) return 'fecha valor'
  if (mapping.amount === index) return 'importe'
  if (mapping.debit === index) return 'debe'
  if (mapping.credit === index) return 'haber'
  if (mapping.balance === index) return 'saldo (no se importa)'
  if (mapping.currency === index) return 'moneda'
  if (mapping.sign === index) return 'signo'
  if (mapping.description.includes(index)) return 'concepto'
  return '—'
}

function runImport(args: Args): number {
  const file = args.file as string
  const bytes = new Uint8Array(readFileSync(file))

  const result = runPipeline(bytes, {
    fileName: basename(file),
    ...(args.currency === undefined ? {} : { currency: args.currency }),
    ...(args.account === undefined ? {} : { accountLabel: args.account }),
  })

  if (args.json) {
    console.log(
      JSON.stringify(
        result.report,
        (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
        2,
      ),
    )
  } else {
    console.log(renderImportReport(result.report))

    const review = result.classified.filter((item) => item.verdict.kind === 'review')
    if (review.length > 0) {
      console.log('\nA REVISIÓN HUMANA')
      for (const item of review) {
        if (item.verdict.kind !== 'review') continue
        console.log(
          `  línea ${String(item.incoming.lineNumber).padStart(5)}  ` +
            `${item.incoming.bookedOn}  ${formatMoney(item.incoming.amount).padStart(16)}  ` +
            `${item.incoming.description.slice(0, 40)}`,
        )
        console.log(
          `         posible duplicado de ${item.verdict.candidateId} ` +
            `(similitud ${item.verdict.similarity.toFixed(2)}, ${item.verdict.dayGap} día(s))`,
        )
      }
    }

    if (result.transfers.length > 0) {
      console.log('\nTRANSFERENCIAS EMPAREJADAS')
      for (const pair of result.transfers) {
        console.log(
          `  ${pair.outgoing.bookedOn}  ${formatMoney(pair.outgoing.amount).padStart(16)}  ` +
            `${pair.outgoing.accountId} → ${pair.incoming.accountId}  [${pair.confidence}]`,
        )
      }
    }

    console.log('\nNada se escribió: todavía no hay persistencia conectada (--dry-run implícito).')
  }

  return result.report.rejected.length > 0 ? 1 : 0
}

function main(): number {
  const args = parseArgs(process.argv.slice(2))

  if (args.command === undefined || args.command === 'help' || args.command === '--help') {
    console.log(USAGE)
    return 0
  }

  if (args.file === undefined) {
    console.error(`Falta el fichero.\n\n${USAGE}`)
    return 1
  }

  try {
    if (args.command === 'inspect') return inspect(args.file)
    if (args.command === 'import') return runImport(args)
    console.error(`Comando desconocido: ${args.command}\n\n${USAGE}`)
    return 1
  } catch (error) {
    if (
      error instanceof MissingCurrencyError ||
      error instanceof UnsupportedFormatError ||
      error instanceof UnsupportedStatementError
    ) {
      console.error(error.message)
      return 1
    }
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      console.error(`No se encontró el fichero: ${args.file}`)
      return 1
    }
    throw error
  }
}

process.exit(main())
