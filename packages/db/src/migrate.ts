/**
 * Corredor de migraciones.
 *
 * Deliberadamente mínimo y con SQL a la vista: son ~80 líneas contra la
 * dependencia de un framework que después condiciona el proveedor. Y el SQL
 * plano se puede leer, revisar y ejecutar a mano cuando algo va mal a las tres
 * de la mañana, que es exactamente cuando pasa.
 *
 * Cada migración corre dentro de una transacción y queda registrada con el
 * hash de su contenido. Si un fichero ya aplicado cambia, el corredor se
 * planta en vez de aplicar la diferencia: editar una migración ya ejecutada
 * deja bases distintas según cuándo se creó cada una.
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url))

export interface MigrateResult {
  readonly applied: string[]
  readonly skipped: string[]
}

export async function migrate(connectionString: string): Promise<MigrateResult> {
  const client = new pg.Client({ connectionString })
  await client.connect()

  try {
    await client.query(`
      create table if not exists _migration (
        name        text primary key,
        sha256      char(64) not null,
        applied_at  timestamptz not null default now()
      )
    `)

    const previous = new Map<string, string>()
    const { rows } = await client.query<{ name: string; sha256: string }>(
      'select name, sha256 from _migration',
    )
    for (const row of rows) previous.set(row.name, row.sha256)

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort()

    const applied: string[] = []
    const skipped: string[] = []

    for (const name of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8')
      const sha256 = createHash('sha256').update(sql).digest('hex')
      const seen = previous.get(name)

      if (seen !== undefined) {
        if (seen !== sha256) {
          throw new Error(
            `La migración ${name} ya se aplicó pero su contenido cambió.\n` +
              'Editar una migración ejecutada deja bases distintas según cuándo se creó cada una.\n' +
              'Creá una migración nueva que corrija lo que haga falta.',
          )
        }
        skipped.push(name)
        continue
      }

      await client.query('begin')
      try {
        await client.query(sql)
        await client.query('insert into _migration (name, sha256) values ($1, $2)', [name, sha256])
        await client.query('commit')
        applied.push(name)
      } catch (error) {
        await client.query('rollback')
        throw new Error(`Falló la migración ${name}: ${(error as Error).message}`, { cause: error })
      }
    }

    return { applied, skipped }
  } finally {
    await client.end()
  }
}

// Ejecución directa desde la línea de comandos.
const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])

if (invokedDirectly) {
  const url = process.env['DATABASE_URL']
  if (url === undefined || url === '') {
    console.error(
      'Falta DATABASE_URL. Copiá .env.example a .env y levantá la base con "pnpm db:up".',
    )
    process.exit(1)
  }
  migrate(url)
    .then(({ applied, skipped }) => {
      for (const name of skipped) console.log(`  ya aplicada  ${name}`)
      for (const name of applied) console.log(`  aplicada     ${name}`)
      console.log(
        applied.length === 0 ? 'La base ya estaba al día.' : `${applied.length} migración(es).`,
      )
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    })
}
