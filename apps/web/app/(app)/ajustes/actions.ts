'use server'

import { hasDemoData, sqlSinCategorizar } from '@moneypilot/db'
import { revalidatePath } from 'next/cache'
import { readHousehold, writeHousehold } from '@/lib/data'
import { esMonedaConocida } from './monedas'

/**
 * Los ajustes del hogar y las consecuencias reales de tocarlos.
 *
 * Dos cosas que se comprobaron contra la base antes de escribir la pantalla:
 *
 *  1. **`select * from tenant` devuelve más de una fila.** Además de
 *     `tenant_isolation`, la migración 004 añadió `tenant_by_membership`, que
 *     es permisiva y por lo tanto se combina con OR: quien pertenece a varios
 *     hogares los ve todos. Acá hace falta el de la sesión, así que la
 *     consulta filtra por `app_current_tenant()` de forma explícita.
 *
 *  2. **La moneda de reporte no se puede cambiar impunemente.** Cada posting
 *     lleva `base_amount` y `base_currency` congelados a la fecha, y las
 *     lecturas comparan esa moneda con la del hogar (`case when
 *     p.base_currency = $1 then p.base_amount end`). Cambiar la moneda del
 *     hogar no recalcula nada: deja fuera del consolidado, de golpe, todo lo
 *     que ya estaba convertido. Por eso el cambio se niega cuando hay
 *     historia, con el número exacto de movimientos que se caerían.
 */

export interface Hogar {
  readonly nombre: string
  readonly monedaBase: string
  readonly creado: string
}

export interface MonedaCongelada {
  readonly moneda: string
  readonly postings: number
  /**
   * De esos apuntes, cuántos llevaron una tasa de verdad. El resto ya estaban
   * en la moneda de reporte. Sin este número, un rango de fechas al lado de
   * "1.688 apuntes" se lee como que se convirtieron los 1.688.
   */
  readonly conTasa: number
  readonly desde: string | null
  readonly hasta: string | null
}

export interface FuenteFx {
  readonly fuente: string
  readonly postings: number
}

export interface Consolidacion {
  readonly postings: number
  readonly asientos: number
  /** Movimientos sin importe en moneda de reporte: quedan fuera de todo total. */
  readonly sinBase: number
  /** Movimientos a los que se les aplicó una tasa de verdad. */
  readonly conTasa: number
  readonly porMoneda: readonly MonedaCongelada[]
  readonly fuentes: readonly FuenteFx[]
  /** Filas de la tabla global `fx_rate`. Es compartida, no es del hogar. */
  readonly tasasGuardadas: number
}

export interface LoteEjemplo {
  readonly asientos: number
  readonly creado: string
  readonly estado: string
}

export interface PanelAjustes {
  readonly hogar: Hogar
  readonly correo: string | null
  readonly rol: string
  readonly consolidacion: Consolidacion
  readonly ejemploCargado: boolean
  readonly lote: LoteEjemplo | null
  /**
   * Cuántas cuentas de categoría tiene el hogar, sin contar las bolsas del
   * importador.
   *
   * Cero significa que el motor de clasificación **no tiene dónde escribir**:
   * propone, no encuentra la cuenta y todo queda sin categorizar sin dar
   * ningún error. Le pasa a los hogares creados antes de que el alta instalara
   * el plan, y no hay forma de que se enteren solos.
   */
  readonly categorias: number
}

interface HogarRow {
  readonly name: string
  readonly base_currency: string
  readonly created_on: string
}

interface ResumenRow {
  readonly postings: number
  readonly asientos: number
  readonly sin_base: number
  readonly con_tasa: number
}

interface MonedaRow {
  readonly base_currency: string | null
  readonly postings: number
  readonly con_tasa: number
  readonly desde: string | null
  readonly hasta: string | null
}

interface FuenteRow {
  readonly fuente: string | null
  readonly postings: number
}

interface LoteRow {
  readonly imported: number
  readonly estado: string
  readonly creado: string
}

export async function leerAjustes(): Promise<PanelAjustes> {
  const { session, data } = await readHousehold(async (client) => {
    // En serie: las siete van por el mismo cliente —una transacción, una
    // conexión—, así que pg las encola igual. Promise.all daba paralelismo
    // aparente y un aviso de query concurrente sobre un cliente ocupado, que
    // en pg@9 será un error.
    const hogar = await client.query<HogarRow>(
      `select name, base_currency, to_char(created_at, 'YYYY-MM-DD') as created_on
         from tenant
        where id = app_current_tenant()`,
    )
    const resumen = await client.query<ResumenRow>(
      `select count(*)::int                                          as postings,
              count(distinct entry_id)::int                          as asientos,
              count(*) filter (where base_amount is null)::int       as sin_base,
              count(*) filter (where fx_numerator is not null)::int  as con_tasa
         from posting`,
    )
    const monedas = await client.query<MonedaRow>(
      `select base_currency,
              count(*)::int                                         as postings,
              count(*) filter (where fx_numerator is not null)::int  as con_tasa,
              to_char(min(fx_as_of), 'YYYY-MM-DD') as desde,
              to_char(max(fx_as_of), 'YYYY-MM-DD') as hasta
         from posting
        where base_amount is not null
        group by base_currency
        order by count(*) desc`,
    )
    const fuentes = await client.query<FuenteRow>(
      `select fx_source as fuente, count(*)::int as postings
         from posting
        where fx_numerator is not null
        group by fx_source
        order by count(*) desc`,
    )
    // fx_rate es global y de sólo lectura para la aplicación: no lleva
    // tenant_id ni policy, así que este número es del sistema, no del hogar.
    // Las bolsas del importador —«Sin categorizar», «Ingresos sin
    // categorizar»— son cuentas de gasto e ingreso como cualquier otra, así
    // que contarlas diría que el hogar tiene plan cuando no lo tiene.
    const categorias = await client.query<{ n: number }>(
      `select count(*)::int as n
         from account
        where kind in ('expense', 'income')
          and not ${sqlSinCategorizar('account')}`,
    )
    const tasas = await client.query<{ tasas: number }>(
      'select count(*)::int as tasas from fx_rate',
    )
    const ejemplo = await hasDemoData(client)
    // El lote del ejemplo se reconoce por su formato, que ningún importador
    // real produce. `hasDemoData` sigue siendo la autoridad sobre si está
    // cargado; esto es sólo el detalle para poder contarlo.
    const lotes = await client.query<LoteRow>(
      `select imported, status::text as estado, to_char(created_at, 'YYYY-MM-DD') as creado
         from import_batch
        where format = 'seed'
        order by created_at desc
        limit 1`,
    )

    return {
      hogar: hogar.rows[0],
      resumen: resumen.rows[0],
      monedas: monedas.rows,
      fuentes: fuentes.rows,
      tasas: tasas.rows[0]?.tasas ?? 0,
      ejemplo,
      categorias: categorias.rows[0]?.n ?? 0,
      lote: lotes.rows[0],
    }
  })

  const fila = data.hogar
  const resumen = data.resumen

  return {
    hogar: {
      nombre: fila?.name ?? session.householdName,
      monedaBase: (fila?.base_currency ?? session.baseCurrency).trim().toUpperCase(),
      creado: fila?.created_on ?? '',
    },
    correo: session.user.email,
    rol: session.role,
    consolidacion: {
      postings: resumen?.postings ?? 0,
      asientos: resumen?.asientos ?? 0,
      sinBase: resumen?.sin_base ?? 0,
      conTasa: resumen?.con_tasa ?? 0,
      porMoneda: data.monedas.map((row) => ({
        moneda: (row.base_currency ?? '').trim().toUpperCase(),
        postings: row.postings,
        conTasa: row.con_tasa,
        desde: row.desde,
        hasta: row.hasta,
      })),
      fuentes: data.fuentes.map((row) => ({
        fuente: row.fuente ?? 'sin declarar',
        postings: row.postings,
      })),
      tasasGuardadas: data.tasas,
    },
    ejemploCargado: data.ejemplo,
    categorias: data.categorias,
    lote:
      data.lote === undefined
        ? null
        : { asientos: data.lote.imported, creado: data.lote.creado, estado: data.lote.estado },
  }
}

/* ── Guardar los datos del hogar ─────────────────────────────────────────── */

export interface ResultadoAjustes {
  readonly error?: string
  readonly aviso?: string
}

const NOMBRE_MAXIMO = 80

export async function guardarHogar(
  _prev: ResultadoAjustes,
  form: FormData,
): Promise<ResultadoAjustes> {
  const nombreCrudo = form.get('nombre')
  const monedaCruda = form.get('moneda')

  if (typeof nombreCrudo !== 'string' || nombreCrudo.trim() === '') {
    return { error: 'El hogar necesita un nombre.' }
  }
  const nombre = nombreCrudo.trim().slice(0, NOMBRE_MAXIMO)

  if (typeof monedaCruda !== 'string' || !esMonedaConocida(monedaCruda.trim().toUpperCase())) {
    return { error: 'Esa no es una de las monedas de reporte disponibles.' }
  }
  const moneda = monedaCruda.trim().toUpperCase()

  const resultado = await writeHousehold(async (client) => {
    const { rows } = await client.query<{ name: string; base_currency: string }>(
      'select name, base_currency from tenant where id = app_current_tenant()',
    )
    const actual = rows[0]
    if (actual === undefined) return { error: 'No se encontró el hogar de la sesión.' }

    const monedaActual = actual.base_currency.trim().toUpperCase()

    if (monedaActual !== moneda) {
      const { rows: congelados } = await client.query<{ n: number }>(
        `select count(*)::int as n
           from posting
          where base_amount is not null and base_currency <> $1::char(3)`,
        [moneda],
      )
      const n = congelados[0]?.n ?? 0
      if (n > 0) {
        return {
          error:
            `No se cambió nada. Hay ${n} movimientos ya consolidados en ${monedaActual} con la ` +
            `tasa de su fecha, y esa conversión está congelada: no se recalcula nunca, porque un ` +
            `reporte emitido en marzo tiene que dar lo mismo en diciembre. Si el hogar pasara a ` +
            `${moneda}, esos ${n} movimientos no se convertirían — se caerían del consolidado y ` +
            `cada total de la aplicación aparecería avisando de que le faltan. Cambiar la moneda ` +
            `de reporte con historia cargada exige reconsolidar el histórico, y eso todavía no ` +
            `existe.`,
        }
      }
    }

    const hecho = await client.query<{ name: string; base_currency: string }>(
      `update tenant
          set name = $1, base_currency = $2::char(3)
        where id = app_current_tenant()
      returning name, base_currency`,
      [nombre, moneda],
    )
    if (hecho.rows[0] === undefined) return { error: 'La base no aplicó el cambio.' }

    if (monedaActual !== moneda) {
      return {
        aviso:
          `Guardado. El hogar se llama "${nombre}" y consolida en ${moneda}. Como no había ` +
          `historia convertida, el cambio de moneda no dejó nada fuera.`,
      }
    }
    return { aviso: `Guardado. El hogar se llama "${nombre}".` }
  })

  // Fuera de la transacción: el nombre del hogar sale en el menú lateral de
  // todas las pantallas, así que se revalida el layout entero.
  if (resultado.aviso !== undefined) revalidatePath('/', 'layout')
  return resultado
}
