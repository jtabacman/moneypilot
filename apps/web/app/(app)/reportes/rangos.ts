/**
 * Los rangos relativos del catálogo de filtros, resueltos a fechas concretas.
 *
 * Se resuelven en el servidor y viajan ya calculados al constructor. La razón
 * no es de rendimiento: es que "últimos 12 meses" tiene que significar lo
 * mismo en la pantalla, en el PDF programado del día 5 y en el enlace que se
 * comparte con el asesor. Si cada consumidor lo resolviera con el reloj de su
 * propia máquina, el mismo IR daría tres respuestas distintas y ninguna
 * estaría mal.
 *
 * Toda la aritmética es sobre 'YYYY-MM-DD' y enteros. Ni un `new Date(iso)`:
 * al oeste de Greenwich devuelve el día anterior.
 */

import { addMonths, firstDayOfMonth, lastDayOfMonth, monthOf } from '@/lib/data'
import type { ResolvedRange } from './ir'

/** Días desde la era civil (algoritmo de Hinnant). Entero puro, sin Date. */
function toDays(iso: string): number {
  const [ys, ms, ds] = iso.split('-')
  const y = Number.parseInt(ys ?? '1970', 10)
  const m = Number.parseInt(ms ?? '1', 10)
  const d = Number.parseInt(ds ?? '1', 10)
  const year = m <= 2 ? y - 1 : y
  const era = Math.floor(year / 400)
  const yoe = year - era * 400
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

function fromDays(days: number): string {
  const z = days + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  )
  const y = yoe + era * 400
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp + (mp < 10 ? 3 : -9)
  const year = m <= 2 ? y + 1 : y
  return `${String(year).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function addDays(iso: string, days: number): string {
  return fromDays(toDays(iso) + days)
}

/** El trimestre al que pertenece un mes 'YYYY-MM', como par de meses. */
function quarterOf(month: string): { from: string; to: string } {
  const [ys, ms] = month.split('-')
  const year = Number.parseInt(ys ?? '1970', 10)
  const m = Number.parseInt(ms ?? '1', 10)
  const first = Math.floor((m - 1) / 3) * 3 + 1
  const start = `${year}-${String(first).padStart(2, '0')}`
  return { from: firstDayOfMonth(start), to: lastDayOfMonth(addMonths(start, 2)) }
}

/**
 * Los nueve rangos que ofrece el constructor.
 *
 * Los dos últimos miran hacia adelante porque la pregunta de liquidez —"¿me
 * alcanza?"— no se responde con historia.
 */
export function buildRanges(today: string): ResolvedRange[] {
  const month = monthOf(today)
  const previous = addMonths(month, -1)
  const previousQuarter = quarterOf(firstDayOfMonth(addMonths(month, -3)).slice(0, 7))
  const year = today.slice(0, 4)

  return [
    {
      id: 'this_month',
      label: 'Este mes',
      from: firstDayOfMonth(month),
      to: lastDayOfMonth(month),
    },
    {
      id: 'previous_month',
      label: 'El mes pasado',
      from: firstDayOfMonth(previous),
      to: lastDayOfMonth(previous),
    },
    {
      id: 'last_3_months',
      label: 'Los últimos 3 meses',
      from: firstDayOfMonth(addMonths(month, -2)),
      to: lastDayOfMonth(month),
    },
    {
      id: 'last_12_months',
      label: 'Los últimos 12 meses',
      from: firstDayOfMonth(addMonths(month, -11)),
      to: lastDayOfMonth(month),
    },
    {
      id: 'previous_quarter',
      label: 'El trimestre anterior',
      from: previousQuarter.from,
      to: previousQuarter.to,
    },
    { id: 'year_to_date', label: 'Lo que va de año', from: `${year}-01-01`, to: today },
    {
      id: 'last_year',
      label: 'El año pasado',
      from: `${Number.parseInt(year, 10) - 1}-01-01`,
      to: `${Number.parseInt(year, 10) - 1}-12-31`,
    },
    { id: 'next_13_weeks', label: 'Las próximas 13 semanas', from: today, to: addDays(today, 90) },
    {
      id: 'next_12_months',
      label: 'Los próximos 12 meses',
      from: today,
      to: lastDayOfMonth(addMonths(month, 11)),
    },
  ]
}
