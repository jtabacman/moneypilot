/**
 * El plan con el que nace un hogar, contra una base de verdad.
 *
 * Lo que hay que demostrar acá no es «crea 86 filas». Es la propiedad de la que
 * dependía todo y que nadie había comprobado nunca:
 *
 *   **Toda ruta que una capa del clasificador puede emitir tiene una cuenta en
 *   la que escribir.**
 *
 * Cuando eso no se cumple, no hay error, ni log, ni fila roja: la propuesta se
 * anota en `rutasSinCuenta` —que ninguna pantalla enseña— y el movimiento se
 * queda en «Sin categorizar». Cinco capas trabajando y un libro entero sin
 * clasificar, con todos los tests en verde. Ese fallo estuvo vivo hasta que se
 * conectaron tres bancos y se miró el resultado a ojo.
 *
 * Por eso el test de abajo no compara contra una lista escrita a mano: recorre
 * el diccionario y la tabla del proveedor **enteros** y exige que cada ruta que
 * pueden llegar a decir resuelva contra el hogar recién creado. Añadir mañana
 * una entrada al diccionario con una ruta que el árbol no tiene rompe acá, que
 * es donde tiene que romper.
 *
 * Sin DATABASE_URL se saltan solos, para que `pnpm test` siga corriendo en una
 * máquina sin Docker.
 */

import { createHash } from 'node:crypto'
import {
  ARBOL_POR_DEFECTO,
  aplanarArbol,
  buscarPorRuta,
  CORRESPONDENCIAS_POR_PROVEEDOR,
  rutasDelDiccionario,
} from '@moneypilot/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPool, type Db, withoutTenantScope, withTenant } from '../client.js'
import { migrate } from '../migrate.js'
import { instalarPlanDeCuentas } from './plan-de-cuentas.js'

const ADMIN_URL = process.env['DATABASE_URL']
const APP_URL = process.env['DATABASE_APP_URL']
const enabled = ADMIN_URL !== undefined && APP_URL !== undefined
const suite = enabled ? describe : describe.skip

const hash = (seed: string): string => createHash('sha256').update(seed).digest('hex')
/** Sufijo por corrida: otros agentes usan la misma base al mismo tiempo. */
const RUN = hash(`${process.pid}-${Date.now()}-${Math.random()}`).slice(0, 12)

let admin: Db
let app: Db
const creados: string[] = []

async function hogarVacio(etiqueta: string): Promise<string> {
  const id = await withoutTenantScope(admin, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      'insert into tenant (name, base_currency) values ($1, $2) returning id',
      [`Plan ${RUN} ${etiqueta}`, 'EUR'],
    )
    const fila = rows[0]
    if (fila === undefined) throw new Error('no se creó el hogar')
    return fila.id
  })
  creados.push(id)
  return id
}

interface CuentaFila {
  readonly id: string
  readonly name: string
  readonly kind: string
  readonly parent_id: string | null
}

async function cuentasDe(tenantId: string): Promise<readonly CuentaFila[]> {
  return withTenant(app, tenantId, async (client) => {
    const { rows } = await client.query<CuentaFila>(
      'select id, name, kind::text as kind, parent_id from account',
    )
    return rows
  })
}

/** La ruta de una cuenta, subiendo por `parent_id`. El mismo formato del árbol. */
function rutaDe(fila: CuentaFila, porId: Map<string, CuentaFila>): string {
  const partes: string[] = [fila.name]
  let actual = fila.parent_id
  while (actual !== null) {
    const padre = porId.get(actual)
    if (padre === undefined) break
    partes.unshift(padre.name)
    actual = padre.parent_id
  }
  return partes.join(' > ')
}

/**
 * Resuelve una ruta contra las cuentas del hogar **con la misma regla que
 * `resolverRuta`**: por ruta completa, o por el nombre de la hoja.
 *
 * Copiar la regla en vez de importarla es deliberado. `resolverRuta` es privada
 * de `clasificar-auto.ts`, y si mañana se relajara —emparejar por prefijo, por
 * parecido— este test seguiría en verde por la razón equivocada: mediría la
 * tolerancia nueva en vez de si el plan cubre el diccionario.
 */
async function resolutorDeRutas(tenantId: string): Promise<(ruta: string) => boolean> {
  const filas = await cuentasDe(tenantId)
  const porId = new Map(filas.map((f) => [f.id, f]))
  const rutas = new Set(filas.map((f) => rutaDe(f, porId)))
  const hojas = new Set(filas.map((f) => f.name))
  return (ruta) => rutas.has(ruta) || hojas.has(ruta.slice(ruta.lastIndexOf('>') + 1).trim())
}

suite('el plan de cuentas con el que nace un hogar', () => {
  beforeAll(async () => {
    if (!enabled) return
    admin = createPool({ connectionString: ADMIN_URL as string, max: 4 })
    app = createPool({ connectionString: APP_URL as string, max: 4 })
    await migrate(ADMIN_URL as string)
  }, 60_000)

  afterAll(async () => {
    if (!enabled) return
    if (creados.length > 0) {
      await withoutTenantScope(admin, (client) =>
        client.query('delete from tenant where id = any($1::uuid[])', [creados]),
      )
    }
    await admin.end()
    await app.end()
  })

  it('escribe el árbol entero, con la jerarquía intacta', async () => {
    const tenantId = await hogarVacio('arbol')
    const resultado = await withTenant(app, tenantId, (client) => instalarPlanDeCuentas(client))

    const esperadas = aplanarArbol(ARBOL_POR_DEFECTO)
    // Las de sistema van además de las categorías: apertura y cambio en las dos
    // monedas del corredor.
    expect(resultado.creadas).toBe(esperadas.length + 4)
    expect(resultado.existentes).toBe(0)

    const filas = await cuentasDe(tenantId)
    const porId = new Map(filas.map((f) => [f.id, f]))
    const rutas = new Set(filas.map((f) => rutaDe(f, porId)))

    // La jerarquía y no sólo los nombres: si «Luz y gas» quedara colgando de la
    // raíz en vez de de «Vivienda > Suministros», el nombre estaría igual y el
    // informe por área saldría mal.
    for (const categoria of esperadas) {
      expect(rutas.has(categoria.ruta), `falta la ruta «${categoria.ruta}»`).toBe(true)
    }
  })

  it('cada cuenta hereda el tipo que el árbol le da', async () => {
    const tenantId = await hogarVacio('tipos')
    await withTenant(app, tenantId, (client) => instalarPlanDeCuentas(client))

    const filas = await cuentasDe(tenantId)
    const porId = new Map(filas.map((f) => [f.id, f]))
    for (const fila of filas) {
      const nodo = buscarPorRuta(rutaDe(fila, porId))
      if (nodo === undefined) continue // las de sistema no están en el árbol
      // Un ingreso guardado como gasto suma con el signo cambiado y el neto del
      // mes sale del revés sin que nada avise.
      expect(fila.kind, `«${fila.name}» debería ser ${nodo.tipo}`).toBe(nodo.tipo)
    }
  })

  it('toda ruta que el diccionario puede emitir tiene dónde escribirse', async () => {
    // El test que faltaba. Ver la cabecera del fichero.
    const tenantId = await hogarVacio('diccionario')
    await withTenant(app, tenantId, (client) => instalarPlanDeCuentas(client))
    const resolver = await resolutorDeRutas(tenantId)

    const huerfanas = rutasDelDiccionario().filter((ruta) => !resolver(ruta))
    expect(huerfanas, `rutas del diccionario sin cuenta:\n${huerfanas.join('\n')}`).toEqual([])
    // Y que de verdad había algo que comprobar: un diccionario vacío pasaría
    // este test sin decir nada.
    expect(rutasDelDiccionario().length).toBeGreaterThan(20)
  })

  it('toda ruta de la tabla del proveedor tiene dónde escribirse', async () => {
    const tenantId = await hogarVacio('proveedor')
    await withTenant(app, tenantId, (client) => instalarPlanDeCuentas(client))
    const resolver = await resolutorDeRutas(tenantId)

    const huerfanas: string[] = []
    for (const [proveedor, tabla] of Object.entries(CORRESPONDENCIAS_POR_PROVEEDOR)) {
      for (const [etiqueta, traduccion] of tabla) {
        if (!resolver(traduccion.ruta))
          huerfanas.push(`${proveedor} ${etiqueta} → ${traduccion.ruta}`)
      }
    }
    expect(huerfanas, `rutas del proveedor sin cuenta:\n${huerfanas.join('\n')}`).toEqual([])
  })

  it('crea los cuatro ejes de dimensión, y ninguno con valores', async () => {
    const tenantId = await hogarVacio('dimensiones')
    const resultado = await withTenant(app, tenantId, (client) => instalarPlanDeCuentas(client))
    expect(resultado.dimensiones).toBe(4)

    await withTenant(app, tenantId, async (client) => {
      const { rows } = await client.query<{ key: string; label: string; position: number }>(
        'select key, label, position from dimension order by position',
      )
      expect(rows.map((r) => r.key)).toEqual(['propiedad', 'entidad', 'persona', 'proyecto'])

      // Los valores son del cliente. Inventarle «Casa Madrid» sería escribir en
      // su libro algo que no dijo.
      const { rows: valores } = await client.query<{ n: string }>(
        'select count(*)::text as n from dimension_value',
      )
      expect(valores[0]?.n).toBe('0')
    })
  })

  it('correrlo dos veces no duplica nada', async () => {
    const tenantId = await hogarVacio('idempotente')
    const primera = await withTenant(app, tenantId, (client) => instalarPlanDeCuentas(client))
    const segunda = await withTenant(app, tenantId, (client) => instalarPlanDeCuentas(client))

    expect(segunda.creadas).toBe(0)
    expect(segunda.existentes).toBe(primera.creadas)
    expect(segunda.dimensiones).toBe(0)

    const filas = await cuentasDe(tenantId)
    expect(filas.length).toBe(primera.creadas)
    // `account_name_unique` es (tenant_id, name): un segundo intento no es una
    // fila de más, es un error. Que no lo sea es lo que se comprueba.
    expect(new Set(filas.map((f) => f.name)).size).toBe(filas.length)
  })

  it('respeta una cuenta que el hogar ya tenía con ese nombre', async () => {
    const tenantId = await hogarVacio('respeta')
    const propia = await withTenant(app, tenantId, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into account (tenant_id, kind, name, currency)
         values (current_setting('app.tenant_id')::uuid, 'expense', 'Salud', 'EUR')
         returning id`,
      )
      return rows[0]?.id
    })

    const resultado = await withTenant(app, tenantId, (client) => instalarPlanDeCuentas(client))
    expect(resultado.existentes).toBe(1)

    const filas = await cuentasDe(tenantId)
    const salud = filas.filter((f) => f.name === 'Salud')
    // Una sola, y la del cliente: la suya puede tener movimientos colgando y
    // pisarla los dejaría apuntando a una cuenta que ya no significa lo mismo.
    expect(salud.length).toBe(1)
    expect(salud[0]?.id).toBe(propia)
  })
})
