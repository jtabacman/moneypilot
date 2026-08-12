/**
 * Detección de formato por contenido, no por extensión.
 *
 * La extensión miente con frecuencia: los bancos exportan `.qfx` que son OFX
 * puro, `.txt` que son Norma 43, y `.csv` que son en realidad tabulados. Y un
 * fichero renombrado a mano no cambia lo que tiene adentro.
 */

import type { StatementFormat } from '@moneypilot/core'
import { decodeBuffer } from './shared/decode.js'

export interface FormatDetection {
  readonly format: StatementFormat | null
  readonly evidence: string
}

export function detectFormat(bytes: Uint8Array): FormatDetection {
  const head = decodeBuffer(bytes.subarray(0, 4096)).text

  if (/OFXHEADER\s*[:=]/i.test(head) || /<OFX[\s>]/i.test(head)) {
    return {
      format: /INTU\.BID/i.test(head) ? 'qfx' : 'ofx',
      evidence: 'contiene la cabecera OFX',
    }
  }

  if (/^!(Type:|Account|Option)/im.test(head)) {
    return { format: 'qif', evidence: 'contiene una directiva QIF (!Type, !Account)' }
  }

  // Norma 43: registros que empiezan por 11 y 22, de largo fijo cercano a 80.
  const lines = head.split(/\r?\n/).filter((line) => line.trim() !== '')
  const first = lines[0] ?? ''
  if (/^11\d{18}/.test(first) && lines.some((line) => /^22/.test(line))) {
    return { format: 'n43', evidence: 'registros de cabecera 11 y movimiento 22 de Norma 43' }
  }

  if (/<Document[\s>]/i.test(head) && /camt\.053/i.test(head)) {
    return { format: 'camt053', evidence: 'documento ISO 20022 camt.053' }
  }

  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return { format: 'pdf', evidence: 'cabecera %PDF' }
  }

  // Para el CSV no alcanza con mirar la primera línea: muchos extractos
  // empiezan con "Extracto de cuenta" o el nombre del titular, sin ningún
  // separador. Se busca un separador que produzca el mismo número de columnas
  // en varias líneas seguidas, que es la firma real de una tabla.
  const delimited = findDelimitedBlock(lines)
  if (delimited !== null) {
    return {
      format: 'csv',
      evidence: `${delimited.rows} filas consecutivas con ${delimited.columns} columnas separadas por ${JSON.stringify(delimited.delimiter)}`,
    }
  }

  return { format: null, evidence: 'no se reconoció ningún formato conocido' }
}

interface DelimitedBlock {
  readonly delimiter: string
  readonly columns: number
  readonly rows: number
}

function findDelimitedBlock(lines: readonly string[]): DelimitedBlock | null {
  let best: DelimitedBlock | null = null

  for (const delimiter of [';', ',', '\t', '|']) {
    let run = 0
    let columns = 0
    for (const line of lines.slice(0, 40)) {
      const count = line.split(delimiter).length
      if (count >= 2 && (run === 0 || count === columns)) {
        if (run === 0) columns = count
        run += 1
        if (best === null || run > best.rows) best = { delimiter, columns, rows: run }
      } else {
        run = count >= 2 ? 1 : 0
        columns = count >= 2 ? count : 0
      }
    }
  }

  return best !== null && best.rows >= 2 ? best : null
}
