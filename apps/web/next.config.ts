import type { NextConfig } from 'next'

const config: NextConfig = {
  // Los paquetes del workspace se compilan con el resto de la app en vez de
  // consumirse desde dist. Evita tener que recordar el orden de build.
  transpilePackages: ['@moneypilot/core', '@moneypilot/importers'],
  typedRoutes: true,
  eslint: { ignoreDuringBuilds: true },
}

export default config
