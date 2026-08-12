import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url))

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
  },
})
