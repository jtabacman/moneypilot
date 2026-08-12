/**
 * Falla si hay caracteres de control literales en el fuente.
 *
 * Por qué existe este check: usamos U+001F como separador de campos dentro del
 * string canónico que se hashea para la identidad de cada transacción. Escrito
 * como carácter literal es invisible al leer el código y cualquier formateador,
 * copiar-pegar o herramienta de refactor puede comérselo. Si eso pasa, el hash
 * cambia en silencio, el dedup deja de reconocer lo ya importado, y la próxima
 * importación duplica la base entera sin un solo error en pantalla.
 *
 * Escrito con el escape barra-u-0-0-1-F el valor es idéntico y el riesgo
 * desaparece.
 *
 * Nota: este fichero construye el rango con escapes en vez de un literal, para
 * no violar su propia regla.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Todo control ASCII salvo tab (09), LF (0A) y CR (0D), más DEL (7F).
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]', 'g')

const SKIP = new Set(['node_modules', 'dist', '.git', 'coverage', '.vitest'])
const EXTENSIONS = /\.(ts|mts|cts|js|mjs|json)$/

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (EXTENSIONS.test(full)) out.push(full)
  }
  return out
}

const roots = process.argv.slice(2)
const targets = roots.length > 0 ? roots : ['packages', 'apps', 'scripts']

let found = 0
for (const root of targets) {
  let files
  try {
    files = walk(root)
  } catch {
    continue
  }
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    for (const match of src.matchAll(CONTROL)) {
      found += 1
      const at = match.index ?? 0
      const line = src.slice(0, at).split('\n').length
      const code = match[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')
      console.error(`${file}:${line}  control literal U+${code} — usar el escape \\u${code}`)
    }
  }
}

if (found > 0) {
  console.error(`\n${found} carácter(es) de control literal(es). Ver scripts/check-control-chars.mjs`)
  process.exit(1)
}
console.log('sin caracteres de control literales')
