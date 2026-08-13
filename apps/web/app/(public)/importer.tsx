'use client'

import { useCallback, useRef, useState } from 'react'
import type { WireReport } from '@/lib/pipeline'

interface Response {
  readonly report?: WireReport
  readonly review?: {
    lineNumber: number
    bookedOn: string
    description: string
  }[]
  readonly transfers?: {
    from: string
    to: string
    on: string
    confidence: string
  }[]
  readonly error?: string
}

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'ARS', 'MXN']

const SAMPLES = [
  { file: 'movements.n43', label: 'Norma 43 · banco español', currency: 'EUR' },
  {
    file: 'checking.ofx',
    label: 'OFX · cuenta corriente EE.UU.',
    currency: 'USD',
  },
  { file: 'anzcc.ofx', label: 'OFX · tarjeta de crédito', currency: 'AUD' },
  { file: 'ejemplo-bbva.csv', label: 'CSV · debe y haber', currency: 'EUR' },
]

export function Importer() {
  const [busy, setBusy] = useState(false)
  const [hot, setHot] = useState(false)
  const [result, setResult] = useState<Response | null>(null)
  const [currency, setCurrency] = useState('EUR')
  const inputRef = useRef<HTMLInputElement>(null)

  const send = useCallback(
    async (file: File) => {
      setBusy(true)
      setResult(null)
      const form = new FormData()
      form.set('file', file)
      form.set('currency', currency)
      try {
        const response = await fetch('/api/import', {
          method: 'POST',
          body: form,
        })
        setResult((await response.json()) as Response)
      } catch {
        setResult({
          error: 'No se pudo contactar al servidor. Probá de nuevo.',
        })
      } finally {
        setBusy(false)
      }
    },
    [currency],
  )

  const loadSample = useCallback(async (name: string, sampleCurrency: string) => {
    setCurrency(sampleCurrency)
    setBusy(true)
    setResult(null)
    try {
      const response = await fetch(`/samples/${name}`)
      const blob = await response.blob()
      const form = new FormData()
      form.set('file', new File([blob], name))
      form.set('currency', sampleCurrency)
      const imported = await fetch('/api/import', {
        method: 'POST',
        body: form,
      })
      setResult((await imported.json()) as Response)
    } catch {
      setResult({ error: `No se pudo cargar el ejemplo ${name}.` })
    } finally {
      setBusy(false)
    }
  }, [])

  return (
    <>
      {/* Arrastrar es una comodidad, no el único camino: el botón "Elegir
          fichero" de adentro es un control real, enfocable con teclado y
          anunciado por lector de pantalla. La región sólo agrupa y etiqueta. */}
      <section
        aria-label="Subir un extracto bancario"
        className={`drop${hot ? ' hot' : ''}${busy ? ' busy' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          setHot(true)
        }}
        onDragLeave={() => setHot(false)}
        onDrop={(event) => {
          event.preventDefault()
          setHot(false)
          const file = event.dataTransfer.files[0]
          if (file) void send(file)
        }}
      >
        <h2>{busy ? 'Leyendo el fichero…' : 'Arrastrá un extracto acá'}</h2>
        <p>OFX · QFX · QIF · CSV · Norma 43 — hasta 4 MB</p>

        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            Elegir fichero
          </button>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
            }}
          >
            <span style={{ color: 'var(--ink-soft)' }}>Moneda</span>
            <select
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
              style={{
                font: 'inherit',
                padding: '5px 8px',
                border: '1px solid var(--rule-strong)',
                background: 'var(--paper)',
                color: 'var(--ink)',
                borderRadius: 3,
              }}
            >
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
        </div>

        <input
          ref={inputRef}
          type="file"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void send(file)
          }}
        />

        <div className="samples">
          <b>¿No tenés un extracto a mano?</b> Probá con uno real de una suite de test open source:
          <div className="chips">
            {SAMPLES.map((sample) => (
              <button
                key={sample.file}
                type="button"
                className="chip"
                disabled={busy}
                onClick={() => void loadSample(sample.file, sample.currency)}
              >
                {sample.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {result?.error !== undefined && (
        <div className="error">
          <b>No se pudo importar.</b>
          <br />
          {result.error}
        </div>
      )}

      {result?.report !== undefined && (
        <Report
          report={result.report}
          review={result.review ?? []}
          transfers={result.transfers ?? []}
        />
      )}
    </>
  )
}

function Report({
  report,
  review,
  transfers,
}: {
  report: WireReport
  review: { lineNumber: number; bookedOn: string; description: string }[]
  transfers: { from: string; to: string; on: string; confidence: string }[]
}) {
  const errors = report.warnings.filter((w) => w.severity === 'error')
  const warns = report.warnings.filter((w) => w.severity === 'warning')

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{report.fileName}</h2>
        <small>
          {report.format.toUpperCase()}
          {report.periodFrom !== null && ` · ${report.periodFrom} a ${report.periodTo}`}
        </small>
      </div>

      <dl className="tiles">
        <Tile label="Leídas" value={report.linesRead} />
        <Tile label="Importadas" value={report.imported} />
        <Tile label="Duplicadas" value={report.duplicates} />
        <Tile
          label="A revisión"
          value={report.needsReview}
          tone={report.needsReview > 0 ? 'warn' : undefined}
        />
        <Tile
          label="Rechazadas"
          value={report.rejected.length}
          tone={report.rejected.length > 0 ? 'bad' : undefined}
        />
        <Tile label="Transferencias" value={report.transfersMatched} />
      </dl>

      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Cuenta</th>
              <th className="r">Apertura</th>
              <th className="r">Movimientos</th>
              <th className="r">Calculado</th>
              <th className="r">Real del banco</th>
              <th className="r">Delta</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {report.accounts.map((account) => (
              <tr key={account.accountLabel}>
                <td>
                  {account.accountLabel}{' '}
                  <span style={{ color: 'var(--ink-faint)', fontSize: 11 }}>
                    {account.currency}
                  </span>
                </td>
                <td className="r num">{money(account.openingBalance)}</td>
                <td className={`r num${account.movements.amount.startsWith('-') ? ' neg' : ''}`}>
                  {money(account.movements)}
                </td>
                <td className="r num">{money(account.computedClosing)}</td>
                <td className="r num">{money(account.reportedClosing)}</td>
                <td
                  className="r num"
                  style={{
                    color: account.status === 'conciliada' ? 'var(--accent)' : undefined,
                    fontWeight: account.status === 'delta' ? 600 : undefined,
                  }}
                >
                  {money(account.delta)}
                </td>
                <td>
                  <span
                    className={`status ${account.status === 'conciliada' ? 'ok' : account.status === 'delta' ? 'bad' : 'none'}`}
                  >
                    {account.status === 'conciliada'
                      ? 'verificada'
                      : account.status === 'delta'
                        ? 'DELTA'
                        : 'sin saldo declarado'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Verdict report={report} />

      {(errors.length > 0 || warns.length > 0 || review.length > 0 || transfers.length > 0) && (
        <div className="notes">
          {errors.length > 0 && (
            <>
              <h3>Filas rechazadas</h3>
              <ul>
                {errors.slice(0, 12).map((warning) => (
                  <li key={`${warning.code}-${warning.lineNumber}`}>
                    <code>línea {warning.lineNumber}</code> {warning.message}
                  </li>
                ))}
              </ul>
            </>
          )}
          {warns.length > 0 && (
            <>
              <h3>A revisar</h3>
              <ul>
                {warns.slice(0, 8).map((warning) => (
                  <li key={`${warning.code}-${warning.message}`}>{warning.message}</li>
                ))}
              </ul>
            </>
          )}
          {review.length > 0 && (
            <>
              <h3>Posibles duplicados, a criterio humano</h3>
              <ul>
                {review.map((item) => (
                  <li key={item.lineNumber}>
                    <code>línea {item.lineNumber}</code> {item.bookedOn} · {item.description}
                  </li>
                ))}
              </ul>
            </>
          )}
          {transfers.length > 0 && (
            <>
              <h3>Transferencias emparejadas</h3>
              <ul>
                {transfers.map((pair) => (
                  <li key={`${pair.from}-${pair.to}-${pair.on}`}>
                    {pair.on} · {pair.from} → {pair.to} <code>{pair.confidence}</code>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  )
}

function Verdict({ report }: { report: WireReport }) {
  if (report.isEmpty) {
    return (
      <div className="verdict warn">
        <b>El fichero se reconoció pero no contenía ninguna transacción legible.</b> Puede ser un
        subtipo no soportado o un fichero vacío.
      </div>
    )
  }
  if (!report.isClean) {
    const parts: string[] = []
    const deltas = report.accounts.filter((a) => a.status === 'delta').length
    if (deltas > 0) parts.push(`${deltas} cuenta(s) con delta`)
    if (report.rejected.length > 0) parts.push(`${report.rejected.length} fila(s) rechazada(s)`)
    return (
      <div className="verdict warn">
        <b>Hay que revisar:</b> {parts.join(', ')}.
      </div>
    )
  }
  if (report.verifiedAccounts === 0) {
    return (
      <div className="verdict warn">
        <b>Sin filas rechazadas, pero ninguna cuenta se pudo verificar.</b> Este formato no declara
        saldos, así que la conciliación queda pendiente de contrastar contra el histórico o contra
        el saldo real del banco.
      </div>
    )
  }
  return (
    <div className="verdict ok">
      <b>
        {report.verifiedAccounts} de {report.accounts.length} cuenta(s) verificadas contra el saldo
        del banco
      </b>
      , sin filas rechazadas.
    </div>
  )
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'warn' | 'bad' | undefined
}) {
  return (
    <div className="tile">
      <dt>{label}</dt>
      <dd
        className="num"
        style={{
          color: tone === 'bad' ? 'var(--debit)' : tone === 'warn' ? 'var(--warn)' : undefined,
        }}
      >
        {value}
      </dd>
    </div>
  )
}

function money(value: { amount: string; currency: string } | null): string {
  if (value === null) return '—'
  const negative = value.amount.startsWith('-')
  const [whole = '0', fraction] = value.amount.replace('-', '').split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${negative ? '−' : ''}${grouped}${fraction === undefined ? '' : `,${fraction}`} ${value.currency}`
}
