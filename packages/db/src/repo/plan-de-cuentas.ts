/**
 * Escribir en la base el plan de cuentas con el que nace un hogar.
 *
 * ── El árbol ya existía; lo que faltaba era instalarlo ──────────────────────
 *
 * `ARBOL_POR_DEFECTO`, en el núcleo, se abre diciendo «el plan de cuentas con
 * el que arranca un hogar nuevo». Es el árbol contra el que resuelven las cinco
 * capas del clasificador: el diccionario emite «Vivienda > Suministros > Luz y
 * gas» porque esa ruta está ahí. Lo único que nunca existió es el trozo de
 * código que lo escribe en la base cuando se crea el hogar.
 *
 * La consecuencia se veía y no se entendía: el motor proponía y no aplicaba.
 * `resolverRuta` busca la ruta entre las cuentas del hogar, no la encuentra
 * —porque el hogar no tiene ninguna— y la propuesta se anota en
 * `rutasSinCuenta`, que nadie mira. Cinco capas trabajando y todo en «Sin
 * categorizar», sin un solo error en ningún log.
 *
 * ── Y el hogar de ejemplo usa este mismo árbol ──────────────────────────────
 *
 * `seed.ts` tuvo durante un tiempo su propia lista de categorías, con otros
 * nombres —«Casa > Servicios > Luz» donde el árbol dice «Vivienda > Suministros
 * > Luz y gas»—, y las dos convivían mientras nadie instalaba ésta. En cuanto
 * esta función empezó a correr en el alta, chocaron en silencio:
 * `resolveAccounts` reutiliza cuentas por nombre, dieciséis nombres coincidían,
 * y el hogar quedaba con las dos taxonomías cruzadas. Ya no: el ejemplo es un
 * índice contra `ARBOL_POR_DEFECTO` y no tiene taxonomía propia.
 *
 * ── Es un punto de partida, no una jaula ────────────────────────────────────
 *
 * Son cuentas normales, sin ninguna marca que las distinga de las que cree la
 * persona: se renombran, se cuelgan de otro sitio y se borran. Lo único que las
 * ata al motor es el nombre, que es como `resolverRuta` las encuentra — y
 * renombrar una categoría es, legítimamente, decidir que el motor deje de
 * usarla.
 */

import { ARBOL_POR_DEFECTO, aplanarArbol, type NodoDeCategoria } from '@moneypilot/core'
import type { TenantClient } from '../client.js'

/**
 * Cuentas que no son categoría y que el libro necesita igual.
 *
 * La de apertura es la contrapartida del saldo con el que una cuenta empieza
 * antes del primer movimiento descargado. Las de cambio son la contrapartida
 * del método Selinger: sin ellas, un gasto en dólares contra una categoría en
 * euros no balancea por moneda y el residuo se esconde en un redondeo.
 *
 * Se crean en las dos monedas del corredor declarado. No se generan a partir de
 * las cuentas del hogar porque hacen falta **antes** de que exista ninguna.
 */
const CUENTAS_DE_SISTEMA = [
  { kind: 'equity', name: 'Saldo de apertura', currency: 'EUR' },
  { kind: 'equity', name: 'Saldo de apertura (USD)', currency: 'USD' },
  { kind: 'trading', name: 'Cambio de moneda EUR', currency: 'EUR' },
  { kind: 'trading', name: 'Cambio de moneda USD', currency: 'USD' },
] as const

/**
 * Los cuatro ejes con los que nace un hogar. **Sin valores.**
 *
 * Son el otro eje del producto y no una comodidad: la categoría dice qué clase
 * de gasto es —«Vivienda > Comunidad»— y la dimensión dice de quién y de qué es
 * —la casa de Madrid, la sociedad patrimonial, el hijo mayor—. Sin ellas, «qué
 * me cuesta realmente la casa de Madrid» no tiene por dónde responderse, y ésa
 * es literalmente una de las cinco preguntas que el producto se compromete a
 * contestar.
 *
 * Los **valores** —cuáles son tus propiedades, cómo se llaman tus sociedades—
 * los pone el cliente y no se inventan: adivinarlos sería escribir en su libro
 * cosas que no dijo. Lo que se instala es el eje vacío, que es lo que convierte
 * la pantalla de dimensiones en un formulario a rellenar en vez de en una
 * página vacía que no explica qué se espera de ella.
 *
 * El orden no es alfabético: es el de una conversación real. Primero dónde
 * (propiedad), después a través de qué (entidad), después de quién (persona), y
 * al final por qué (proyecto), que es el único que nace y muere.
 */
const DIMENSIONES_POR_DEFECTO = [
  { key: 'propiedad', label: 'Propiedad', position: 1 },
  { key: 'entidad', label: 'Entidad', position: 2 },
  { key: 'persona', label: 'Persona', position: 3 },
  { key: 'proyecto', label: 'Proyecto', position: 4 },
] as const

export interface PlanInstalado {
  readonly creadas: number
  /** Las que ya estaban con ese nombre. No se tocan. */
  readonly existentes: number
  /** Ejes de dimensión creados. Los valores siempre los pone el cliente. */
  readonly dimensiones: number
}

/**
 * Escribe las cuentas que falten. Idempotente: correrlo dos veces no duplica.
 *
 * La comprobación es **por nombre**, y no por identificador, porque estas
 * cuentas no dejan rastro en la tabla — a propósito. La consecuencia asumida es
 * que si el hogar ya tiene una cuenta llamada «Salud», ésa es la suya y no se
 * duplica ni se pisa. Y no es sólo una preferencia: `account_name_unique` es
 * `(tenant_id, name)`, así que intentar crearla otra vez sería un error, no una
 * fila de más.
 *
 * Los padres antes que los hijos, porque `parent_id` apunta a una fila que
 * tiene que existir. `aplanarArbol` recorre en preorden y eso ya lo garantiza;
 * aun así el padre se busca en el mapa y, si faltara, la cuenta se crea en la
 * raíz en vez de perderse.
 */
export async function instalarPlanDeCuentas(
  client: TenantClient,
  arbol: readonly NodoDeCategoria[] = ARBOL_POR_DEFECTO,
): Promise<PlanInstalado> {
  const { rows } = await client.query<{ id: string; name: string }>('select id, name from account')
  const idPorNombre = new Map(rows.map((fila) => [fila.name, fila.id]))
  const idPorRuta = new Map<string, string>()

  let creadas = 0
  let existentes = 0

  const crear = async (
    kind: string,
    name: string,
    currency: string,
    parentId: string | null,
  ): Promise<string | undefined> => {
    const yaEsta = idPorNombre.get(name)
    if (yaEsta !== undefined) {
      existentes += 1
      return yaEsta
    }
    const insertada = await client.query<{ id: string }>(
      `insert into account (tenant_id, kind, name, currency, parent_id)
       values (current_setting('app.tenant_id')::uuid, $1::account_kind, $2, $3, $4::uuid)
       returning id`,
      [kind, name, currency, parentId],
    )
    const id = insertada.rows[0]?.id
    if (id !== undefined) idPorNombre.set(name, id)
    creadas += 1
    return id
  }

  // Las categorías, todas en la moneda de reporte: una cuenta tiene una sola
  // moneda y lo que cruza divisas cierra contra las cuentas de cambio.
  for (const categoria of aplanarArbol(arbol)) {
    const padre =
      categoria.rutaDelPadre === null ? null : (idPorRuta.get(categoria.rutaDelPadre) ?? null)
    const id = await crear(categoria.tipo, categoria.nombre, 'EUR', padre)
    if (id !== undefined) idPorRuta.set(categoria.ruta, id)
  }

  for (const cuenta of CUENTAS_DE_SISTEMA) {
    await crear(cuenta.kind, cuenta.name, cuenta.currency, null)
  }

  // Los ejes. `on conflict do nothing` sobre `dimension_key_unique`: un hogar
  // que ya renombró «Propiedad» a «Inmuebles» conserva su clave y su etiqueta,
  // porque lo que identifica al eje es la clave y ésa no cambia. Correrlo dos
  // veces no crea nada; correrlo sobre un hogar que borró un eje lo devuelve,
  // que es lo correcto: sin él, media aplicación no tiene dónde apoyarse.
  const dimensiones = await client.query<{ id: string }>(
    `insert into dimension (tenant_id, key, label, position)
     select current_setting('app.tenant_id')::uuid, d.key, d.label, d.position
       from unnest($1::text[], $2::text[], $3::int[]) as d(key, label, position)
     on conflict (tenant_id, key) do nothing
     returning id`,
    [
      DIMENSIONES_POR_DEFECTO.map((d) => d.key),
      DIMENSIONES_POR_DEFECTO.map((d) => d.label),
      DIMENSIONES_POR_DEFECTO.map((d) => d.position),
    ],
  )

  return { creadas, existentes, dimensiones: dimensiones.rowCount ?? 0 }
}
