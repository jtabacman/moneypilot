import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url))

function loadDotEnv(): Record<string, string> {
  const path = fileURLToPath(new URL('./.env', import.meta.url))
  if (!existsSync(path)) return {}
  const out: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).replace(/^["']|["']$/g, '')
  }
  return out
}

export default defineConfig({
  resolve: {
    // Los tests corren contra el código fuente, no contra dist/.
    // Así `pnpm test` no depende de haber compilado antes.
    alias: {
      '@moneypilot/core': pkg('core'),
      '@moneypilot/importers': pkg('importers'),
      '@moneypilot/db': pkg('db'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    environment: 'node',
    globals: false,
    // Los tests que necesitan una base real (RLS, roles, repositorio) leen
    // DATABASE_URL de acá. Sin `.env` se saltan solos en vez de fallar, que es
    // lo correcto: nadie debería necesitar Docker para correr los parsers.
    env: loadDotEnv(),
  },
})
