import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

const config: NextConfig = {
  // Los paquetes del workspace se compilan con el resto de la app en vez de
  // consumirse desde dist. Evita tener que recordar el orden de build.
  transpilePackages: ['@moneypilot/core', '@moneypilot/importers'],

  // En un monorepo Next infiere la raíz del workspace y a veces se equivoca:
  // si acierta de más, empaqueta medio repositorio en cada función; si acierta
  // de menos, deja fuera ficheros de packages/ y la función falla en runtime
  // con un módulo que no encuentra. Declararla evita las dos cosas.
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),

  typedRoutes: true,
  eslint: { ignoreDuringBuilds: true },
}

export default config
