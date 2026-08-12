# Decisiones de tooling

Reglas desactivadas y por qué. Va acá y no en `biome.json` porque Biome no
admite comentarios en su configuración: es JSON estricto, y un `//` la invalida
entera — con la consecuencia desagradable de que Biome sigue funcionando pero
con sus valores por defecto, reformateando el repositorio sin avisar.

## `complexity/useLiteralKeys` — desactivada

Biome pide `process.env.FOO` en vez de `process.env['FOO']`.

TypeScript, con `noPropertyAccessFromIndexSignature: true` en
`tsconfig.base.json`, exige exactamente lo contrario para tipos con índice
como `process.env`.

Gana TypeScript. Su regla obliga a escribir el acceso de una forma que deja
visible que **la variable puede no existir**, que es justo lo que hay que
tener presente al leer configuración: la mitad de los fallos de despliegue
son una variable de entorno ausente.

## `complexity/noForEach` — desactivada

Preferencia de estilo sin efecto sobre la corrección.

## Ficheros excluidos

`dist/`, `.next/`, `next-env.d.ts` y `*.tsbuildinfo` son generados. Analizarlos
produce cientos de diagnósticos sobre código que nadie escribió ni puede
arreglar.
