/**
 * Tokenizador de OFX, para SGML (1.x) y XML (2.x) con el mismo código.
 *
 * OFX 1.x es SGML: los tags hoja **no se cierran**.
 *
 *     <STMTTRN>
 *     <TRNTYPE>DEBIT
 *     <DTPOSTED>20260312
 *     <TRNAMT>-42.50
 *     </STMTTRN>
 *
 * OFX 2.x es XML bien formado y sí los cierra. Y en la práctica hay ficheros
 * mixtos: bancos que emiten 1.x pero cierran algunos hojas. Por eso no sirve
 * un parser XML de librería —falla con el 1.x— ni asumir que ninguna hoja
 * cierra —falla con los mixtos—.
 *
 * La regla que resuelve las tres formas: **una hoja se cierra sola en cuanto
 * aparece el siguiente tag**. Si además viene su cierre explícito, ya no está
 * en la pila y no molesta.
 */

export interface OfxNode {
  readonly tag: string
  readonly value: string | null
  readonly children: readonly OfxNode[]
}

interface MutableNode {
  tag: string
  value: string | null
  children: MutableNode[]
}

const TAG_RE = /<(\/)?([A-Za-z0-9._:-]+)[^>]*?(\/)?>/g
const PROCESSING_INSTRUCTION_RE = /<\?[\s\S]*?\?>/g
const COMMENT_RE = /<!--[\s\S]*?-->/g

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16)
      return Number.isNaN(code) ? match : String.fromCodePoint(code)
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10)
      return Number.isNaN(code) ? match : String.fromCodePoint(code)
    }
    return ENTITIES[entity.toLowerCase()] ?? match
  })
}

/** Construye el árbol a partir del cuerpo del fichero (desde `<OFX>`). */
export function parseOfxTree(body: string): OfxNode {
  const cleaned = body.replace(COMMENT_RE, ' ').replace(PROCESSING_INSTRUCTION_RE, ' ')

  const root: MutableNode = { tag: '#root', value: null, children: [] }
  const stack: MutableNode[] = [root]

  /** Cierra las hojas ya completas: una hoja con valor no admite hijos. */
  const closeCompletedLeaves = (): void => {
    while (stack.length > 1) {
      const top = stack[stack.length - 1]
      if (top === undefined || top.value === null) break
      stack.pop()
    }
  }

  let cursor = 0
  TAG_RE.lastIndex = 0
  let match = TAG_RE.exec(cleaned)

  while (match !== null) {
    const text = cleaned.slice(cursor, match.index).trim()
    const current = stack[stack.length - 1]
    if (text !== '' && current !== undefined && current !== root && current.value === null) {
      current.value = decodeEntities(text)
    }
    cursor = TAG_RE.lastIndex

    const isClosing = match[1] === '/'
    const name = (match[2] ?? '').toUpperCase()
    const isSelfClosing = match[3] === '/'

    closeCompletedLeaves()
    const parent = stack[stack.length - 1]
    if (parent === undefined) break

    if (isClosing) {
      // Buscar hacia atrás el contenedor que corresponde. Si no está en la
      // pila, el cierre es huérfano y se ignora en vez de romper el árbol.
      for (let index = stack.length - 1; index >= 1; index -= 1) {
        if (stack[index]?.tag === name) {
          stack.length = index
          break
        }
      }
    } else if (isSelfClosing) {
      parent.children.push({ tag: name, value: null, children: [] })
    } else {
      const node: MutableNode = { tag: name, value: null, children: [] }
      parent.children.push(node)
      stack.push(node)
    }

    match = TAG_RE.exec(cleaned)
  }

  // Texto final después del último tag.
  const trailing = cleaned.slice(cursor).trim()
  const last = stack[stack.length - 1]
  if (trailing !== '' && last !== undefined && last !== root && last.value === null) {
    last.value = decodeEntities(trailing)
  }

  return root
}

// ── Accesores ────────────────────────────────────────────────────────────────

export function child(node: OfxNode | undefined, tag: string): OfxNode | undefined {
  return node?.children.find((candidate) => candidate.tag === tag.toUpperCase())
}

export function childrenOf(node: OfxNode | undefined, tag: string): OfxNode[] {
  const upper = tag.toUpperCase()
  return (node?.children ?? []).filter((candidate) => candidate.tag === upper)
}

export function textOf(node: OfxNode | undefined, tag: string): string | undefined {
  const found = child(node, tag)
  const value = found?.value
  return value === null || value === undefined || value === '' ? undefined : value
}

/** Primer descendiente con ese tag, a cualquier profundidad. */
export function findDeep(node: OfxNode, tag: string): OfxNode | undefined {
  const upper = tag.toUpperCase()
  if (node.tag === upper) return node
  for (const candidate of node.children) {
    const found = findDeep(candidate, upper)
    if (found !== undefined) return found
  }
  return undefined
}

/** Todos los descendientes con ese tag, a cualquier profundidad. */
export function findAllDeep(node: OfxNode, tag: string): OfxNode[] {
  const upper = tag.toUpperCase()
  const out: OfxNode[] = []
  const walk = (current: OfxNode): void => {
    if (current.tag === upper) out.push(current)
    for (const candidate of current.children) walk(candidate)
  }
  walk(node)
  return out
}
