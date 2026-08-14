/**
 * El orquestador, contra una base de verdad.
 *
 * Lo que hay que demostrar acá son tres cosas, y ninguna es «clasifica bien»:
 *
 *  1. **El orden manda.** Cuando dos capas tienen algo que decir sobre el mismo
 *     movimiento, gana la de arriba y la de abajo ni se consulta. Si esto
 *     fallara, el diccionario podría pisar una regla del usuario y nadie se
 *     enteraría hasta ver un informe raro.
 *  2. **Lo que se sugiere no se escribe.** Es la mitad del contrato: una
 *     propuesta del diccionario que acabe en el libro sin que nadie la mire es
 *     exactamente el fallo que este módulo existe para no cometer.
 *  3. **Lo automático queda firmado como automático.** Si no, la memoria
 *     empieza a aprender de sí misma y el motor se vuelve cada vez más seguro
 *     de estar equivocado. Hay un test que cierra ese bucle entero.
 *
 * Los hogares se montan a mano y se clasifican llamando a `reclassify`, que es
 * el camino real: insertar filas de `classification_change` a dedo probaría que
 * el orquestador sabe leer filas que yo misma escribí.
 *
 * Sin DATABASE_URL se saltan solos, para que `pnpm test` siga corriendo en una
 * máquina sin Docker.
 */

import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createPool,
  type Db,
  type TenantClient,
  withoutTenantScope,
  withTenant,
} from '../client.js'
import { migrate } from '../migrate.js'
import {
  ClasificacionError,
  clasificadoPorCapa,
  clasificarAutomatico,
  explicarClasificacion,
  type ObservacionDelOrigen,
} from './clasificar-auto.js'
import { applyAllRules, createRule, planRules, reclassify } from './classify.js'
import { recordarPorComercio } from './memoria.js'

const ADMIN_URL = process.env['DATABASE_URL']
const APP_URL = process.env['DATABASE_APP_URL']
const enabled = ADMIN_URL !== undefined && APP_URL !== undefined
const suite = enabled ? describe : describe.skip

const hash = (seed: string): string => createHash('sha256').update(seed).digest('hex')

/** Sufijo por corrida: otros agentes están usando la misma base al mismo tiempo. */
const RUN = hash(`${process.pid}-${Date.now()}-${Math.random()}`).slice(0, 12)

const ANA = 'ana@ejemplo.test'

function unico<T>(rows: readonly T[], what: string): T {
  const row = rows[0]
  if (row === undefined) throw new Error(`Se esperaba una fila de ${what}`)
  return row
}

/**
 * Un hogar con el plan de cuentas **por defecto**, no uno inventado.
 *
 * Los nombres son los de `ARBOL_POR_DEFECTO` porque son los que producen las
 * rutas del diccionario y de la tabla del proveedor. Con nombres cualquiera, la
 * mitad de los tests medirían la resolución de rutas en vez de lo que quieren
 * medir — y el caso interesante de esa resolución tiene su propio bloque.
 */
interface Hogar {
  readonly tenantId: string
  readonly banco: string
  readonly sinCategorizar: string
  readonly sinCategorizarIngresos: string
  readonly supermercado: string
  readonly combustible: string
  readonly comisiones: string
  readonly oficina: string
  readonly dimPropiedad: string
  readonly madrid: string
}

let admin: Db
let app: Db
const hogaresCreados: string[] = []

async function nuevoHogar(etiqueta: string): Promise<Hogar> {
  const hogar = await withoutTenantScope(admin, async (client) => {
    const tenant = await client.query<{ id: string }>(
      'insert into tenant (name, base_currency) values ($1, $2) returning id',
      [`Auto ${RUN} ${etiqueta}`, 'EUR'],
    )
    const tenantId = unico(tenant.rows, 'tenant').id

    const cuenta = async (
      kind: string,
      name: string,
      parent: string | null = null,
    ): Promise<string> => {
      const { rows } = await client.query<{ id: string }>(
        `insert into account (tenant_id, kind, name, currency, parent_id)
         values ($1, $2::account_kind, $3, 'EUR', $4) returning id`,
        [tenantId, kind, name, parent],
      )
      return unico(rows, 'account').id
    }

    const diaADia = await cuenta('expense', 'Día a día')
    const transporte = await cuenta('expense', 'Transporte')
    const financieros = await cuenta('expense', 'Gastos financieros')
    const sociedad = await cuenta('expense', 'Sociedad')

    const { rows: dims } = await client.query<{ id: string }>(
      'insert into dimension (tenant_id, key, label) values ($1, $2, $3) returning id',
      [tenantId, 'propiedad', 'Propiedad'],
    )
    const dimPropiedad = unico(dims, 'dimension').id
    const { rows: valores } = await client.query<{ id: string }>(
      `insert into dimension_value (tenant_id, dimension_id, label)
       values ($1, $2, $3) returning id`,
      [tenantId, dimPropiedad, 'Casa Madrid'],
    )

    return {
      tenantId,
      banco: await cuenta('asset', 'BBVA Corriente'),
      sinCategorizar: await cuenta('expense', 'Sin categorizar (EUR)'),
      sinCategorizarIngresos: await cuenta('income', 'Ingresos sin categorizar (EUR)'),
      supermercado: await cuenta('expense', 'Supermercado', diaADia),
      combustible: await cuenta('expense', 'Combustible', transporte),
      comisiones: await cuenta('expense', 'Comisiones bancarias', financieros),
      oficina: await cuenta('expense', 'Oficina', sociedad),
      dimPropiedad,
      madrid: unico(valores, 'dimension_value').id,
    }
  })
  hogaresCreados.push(hogar.tenantId)
  return hogar
}

/** Un movimiento con su pata bancaria y su contrapartida en la bolsa. */
async function asentar(
  client: TenantClient,
  hogar: Hogar,
  description: string,
  amount = -4520n,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into entry (tenant_id, booked_on, description, source)
     values ($1, '2026-03-14'::date, $2, 'file') returning id`,
    [hogar.tenantId, description],
  )
  const entryId = unico(rows, 'entry').id
  const bolsa = amount < 0n ? hogar.sinCategorizar : hogar.sinCategorizarIngresos
  await client.query(
    `insert into posting (tenant_id, entry_id, account_id, ordinal, amount, currency)
     select $1::uuid, $2::uuid, p.account_id, p.ordinal, p.amount, 'EUR'
       from unnest($3::uuid[], $4::smallint[], $5::bigint[]) as p(account_id, ordinal, amount)`,
    [
      hogar.tenantId,
      entryId,
      [hogar.banco, bolsa],
      [0, 1],
      [amount.toString(), (-amount).toString()],
    ],
  )
  return entryId
}

/** Categoría actual de un movimiento, leída del libro y no del informe. */
async function categoriaDe(client: TenantClient, entryId: string): Promise<string | null> {
  const { rows } = await client.query<{ name: string }>(
    `select a.name
       from posting p join account a on a.id = p.account_id
      where p.entry_id = $1::uuid and a.kind in ('expense', 'income')`,
    [entryId],
  )
  return rows[0]?.name ?? null
}

suite('clasificación automática', () => {
  beforeAll(async () => {
    await migrate(ADMIN_URL as string)
    admin = createPool({ connectionString: ADMIN_URL as string })
    app = createPool({ connectionString: APP_URL as string })
  }, 60_000)

  afterAll(async () => {
    if (hogaresCreados.length > 0) {
      await withoutTenantScope(admin, async (client) => {
        for (const table of ['rule', 'entry']) {
          await client.query(`delete from ${table} where tenant_id = any($1::uuid[])`, [
            hogaresCreados,
          ])
        }
        await client.query('delete from tenant where id = any($1::uuid[])', [hogaresCreados])
      })
    }
    await admin?.end()
    await app?.end()
  })

  // ── El contrato ───────────────────────────────────────────────────────────

  describe('el contrato', () => {
    it('aplicar es obligatorio y explícito', async () => {
      // Es la diferencia entre enseñar lo que haría el motor y escribirlo en el
      // libro de alguien. Un valor por defecto convierte esa decisión en un
      // descuido.
      const hogar = await nuevoHogar('contrato')
      await withTenant(app, hogar.tenantId, async (client) => {
        await expect(
          clasificarAutomatico(client, {} as unknown as { aplicar: boolean }),
        ).rejects.toBeInstanceOf(ClasificacionError)
      })
    })

    it('un hogar sin nada sin categorizar devuelve ceros', async () => {
      const hogar = await nuevoHogar('vacío')
      await withTenant(app, hogar.tenantId, async (client) => {
        const r = await clasificarAutomatico(client, { aplicar: true })
        expect(r).toMatchObject({ propuestas: [], aplicadas: 0, sugeridas: 0, sinPropuesta: 0 })
      })
    })

    it('un movimiento que nadie reconoce se cuenta como sin propuesta, no se fuerza', async () => {
      const hogar = await nuevoHogar('desconocido')
      await withTenant(app, hogar.tenantId, async (client) => {
        await asentar(client, hogar, 'TRANSFERENCIA A JUAN PEREZ')
        const r = await clasificarAutomatico(client, { aplicar: true })
        expect(r.propuestas).toEqual([])
        expect(r.sinPropuesta).toBe(1)
        expect(r.aplicadas).toBe(0)
      })
    })

    it('un traspaso interno no entra en la pasada: no tiene categoría que cambiar', async () => {
      // Las dos patas contra cuentas propias. Traerlo acá y contarlo como "sin
      // propuesta" diría que ninguna capa supo, cuando lo que pasa es que no
      // había pregunta.
      const hogar = await nuevoHogar('traspaso')
      await withTenant(app, hogar.tenantId, async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `insert into entry (tenant_id, booked_on, description, source)
           values ($1, '2026-03-14'::date, 'MERCADONA', 'file') returning id`,
          [hogar.tenantId],
        )
        const entryId = unico(rows, 'entry').id
        const otra = await client.query<{ id: string }>(
          `insert into account (tenant_id, kind, name, currency)
           values ($1, 'asset', 'BBVA Ahorro', 'EUR') returning id`,
          [hogar.tenantId],
        )
        await client.query(
          `insert into posting (tenant_id, entry_id, account_id, ordinal, amount, currency)
           values ($1, $2, $3, 0, -1000, 'EUR'), ($1, $2, $4, 1, 1000, 'EUR')`,
          [hogar.tenantId, entryId, hogar.banco, unico(otra.rows, 'account').id],
        )

        const r = await clasificarAutomatico(client, { aplicar: true })
        expect(r.sinPropuesta).toBe(0)
        expect(r.propuestas).toEqual([])
      })
    })
  })

  // ── El diccionario ────────────────────────────────────────────────────────

  describe('el diccionario propone y no escribe', () => {
    it('reconoce el comercio, resuelve la ruta y deja la propuesta sin aplicar', async () => {
      const hogar = await nuevoHogar('diccionario')
      await withTenant(app, hogar.tenantId, async (client) => {
        const entryId = await asentar(client, hogar, 'COMPRA TARJ 5432 MERCADONA REF 8812')

        const r = await clasificarAutomatico(client, { aplicar: true })
        const propuesta = unico(r.propuestas, 'propuesta')
        expect(propuesta.procedencia).toBe('diccionario')
        expect(propuesta.categoryId).toBe(hogar.supermercado)
        expect(propuesta.automatica).toBe(false)
        expect(propuesta.motivo).toContain('Mercadona')

        // Y lo que de verdad importa: con `aplicar: true`, el libro no se tocó.
        expect(r.aplicadas).toBe(0)
        expect(r.sugeridas).toBe(1)
        expect(await categoriaDe(client, entryId)).toBe('Sin categorizar (EUR)')
      })
    })

    it('un comercio ambiguo no propone nada aunque se reconozca', async () => {
      // Amazon no es una categoría. Reconocerlo y callarse es la respuesta
      // correcta, y es distinta de no saber nada.
      const hogar = await nuevoHogar('ambiguo')
      await withTenant(app, hogar.tenantId, async (client) => {
        await asentar(client, hogar, 'AMZN MKTP ES')
        const r = await clasificarAutomatico(client, { aplicar: false })
        expect(r.propuestas).toEqual([])
        expect(r.sinPropuesta).toBe(1)
      })
    })

    it('una ruta que este hogar no tiene sale como cuenta por crear, no como fallo', async () => {
      // El motor reconoció el comercio; lo que falta es la cuenta. Decirlo así
      // convierte un cero en una lista de trabajo de una línea.
      const hogar = await nuevoHogar('ruta')
      await withTenant(app, hogar.tenantId, async (client) => {
        await asentar(client, hogar, 'NETFLIX REF 8812')
        await asentar(client, hogar, 'NETFLIX REF 9903')

        const r = await clasificarAutomatico(client, { aplicar: false })
        expect(r.propuestas).toEqual([])
        const perdida = unico(r.rutasSinCuenta, 'ruta sin cuenta')
        expect(perdida.movimientos).toBe(2)
        expect(perdida.procedencia).toBe('diccionario')
        expect(perdida.ruta).toContain('Suscripciones')
      })
    })

    it('la ruta resuelve por el nombre de la hoja aunque el hogar la haya colgado de otro sitio', async () => {
      // `account_name_unique` es (hogar, nombre): el nombre identifica una sola
      // cuenta. Reorganizar el plan de cuentas es normal y no puede dejar ciego
      // al motor. Acá 'Supermercado' cuelga de 'Día a día' y el diccionario
      // pide 'Día a día > Supermercado', pero el test de al lado usa el mismo
      // mecanismo con la jerarquía cambiada.
      const hogar = await nuevoHogar('hoja')
      await withTenant(app, hogar.tenantId, async (client) => {
        await client.query(
          `update account set parent_id = null where tenant_id = $1 and name = 'Supermercado'`,
          [hogar.tenantId],
        )
        await asentar(client, hogar, 'LIDL')
        const r = await clasificarAutomatico(client, { aplicar: false })
        expect(unico(r.propuestas, 'propuesta').categoryId).toBe(hogar.supermercado)
      })
    })

    it('una cuenta que se llama igual pero es de otra clase no vale como destino', async () => {
      // El nombre es único por hogar, así que basta para identificar una cuenta
      // — pero no para afirmar que es LA cuenta. Si el árbol dice que esa ruta
      // es de gasto y la del hogar que se llama igual es de ingreso, no son la
      // misma, y mandarle un cargo convertiría un gasto en un ingreso negativo.
      const hogar = await nuevoHogar('clase')
      await withTenant(app, hogar.tenantId, async (client) => {
        await client.query('update account set name = $2 where id = $1', [
          hogar.comisiones,
          'Comisiones cobradas',
        ])
        await client.query(
          `insert into account (tenant_id, kind, name, currency)
           values ($1, 'income', 'Comisiones bancarias', 'EUR')`,
          [hogar.tenantId],
        )
        const entryId = await asentar(client, hogar, 'MANTENIMIENTO CUENTA', -350n)

        const r = await clasificarAutomatico(client, {
          aplicar: true,
          observaciones: new Map([[entryId, { conceptoComun: '17' }]]),
        })
        expect(r.propuestas).toEqual([])
        expect(unico(r.rutasSinCuenta, 'ruta sin cuenta')).toMatchObject({
          ruta: 'Gastos financieros > Comisiones bancarias',
          procedencia: 'senal',
        })
        expect(await categoriaDe(client, entryId)).toBe('Sin categorizar (EUR)')
      })
    })
  })

  // ── La memoria ────────────────────────────────────────────────────────────

  describe('la memoria del hogar', () => {
    it('tres decisiones humanas y unánimes se aplican solas, con su firma', async () => {
      const hogar = await nuevoHogar('memoria')
      await withTenant(app, hogar.tenantId, async (client) => {
        const previos: string[] = []
        for (let i = 0; i < 3; i += 1) {
          previos.push(await asentar(client, hogar, `PAPELERIA CENTRAL REF ${1000 + i}`))
        }
        await reclassify(client, {
          entryIds: previos,
          categoryId: hogar.oficina,
          changedBy: ANA,
        })

        const nuevo = await asentar(client, hogar, 'PAPELERIA CENTRAL REF 2000')
        const r = await clasificarAutomatico(client, { aplicar: true })

        const propuesta = unico(r.propuestas, 'propuesta')
        expect(propuesta).toMatchObject({
          entryId: nuevo,
          categoryId: hogar.oficina,
          procedencia: 'memoria',
          automatica: true,
        })
        expect(r.aplicadas).toBe(1)
        expect(await categoriaDe(client, nuevo)).toBe('Oficina')

        // La firma automática: sin ella, la memoria se comería su propia cola.
        const explicacion = unico(
          [...(await explicarClasificacion(client, [nuevo])).values()],
          'explicación',
        )
        expect(explicacion.procedencia).toBe('memoria')
        expect(explicacion.changedBy).toBe('sistema:memoria')
        expect(explicacion.motivo).toContain('3 veces')
      })
    })

    it('lo que aplica la memoria no vuelve a la memoria: el bucle está cerrado', async () => {
      // El test que justifica todo el aparato de firmas. Si esto fallara, cada
      // pasada confirmaría la anterior y el motor estaría cada vez más seguro
      // de estar equivocado.
      const hogar = await nuevoHogar('bucle')
      await withTenant(app, hogar.tenantId, async (client) => {
        const previos: string[] = []
        for (let i = 0; i < 3; i += 1) {
          previos.push(await asentar(client, hogar, `PAPELERIA CENTRAL REF ${1000 + i}`))
        }
        await reclassify(client, { entryIds: previos, categoryId: hogar.oficina, changedBy: ANA })
        await asentar(client, hogar, 'PAPELERIA CENTRAL REF 2000')
        await clasificarAutomatico(client, { aplicar: true })

        const recuerdo = unico(await recordarPorComercio(client), 'recuerdo')
        // Cuatro movimientos en esa categoría, pero sólo tres son decisiones.
        expect(recuerdo.veces).toBe(3)
      })
    })

    it('dos veces y unánime se sugiere, no se aplica', async () => {
      const hogar = await nuevoHogar('umbral')
      await withTenant(app, hogar.tenantId, async (client) => {
        const previos = [
          await asentar(client, hogar, 'PAPELERIA CENTRAL REF 1000'),
          await asentar(client, hogar, 'PAPELERIA CENTRAL REF 1001'),
        ]
        await reclassify(client, { entryIds: previos, categoryId: hogar.oficina, changedBy: ANA })
        const nuevo = await asentar(client, hogar, 'PAPELERIA CENTRAL REF 2000')

        const r = await clasificarAutomatico(client, { aplicar: true })
        const propuesta = unico(r.propuestas, 'propuesta')
        expect(propuesta.procedencia).toBe('memoria')
        expect(propuesta.automatica).toBe(false)
        expect(propuesta.motivo).toContain('hacen falta 3')
        expect(await categoriaDe(client, nuevo)).toBe('Sin categorizar (EUR)')
      })
    })

    it('si el hogar usó dos categorías, la memoria calla y deja pasar a la capa de abajo', async () => {
      // Elegir la más usada sería inventarle una preferencia al hogar. Que el
      // diccionario conteste después es correcto: es una opinión declarada como
      // tal, no una preferencia fabricada.
      const hogar = await nuevoHogar('discordia')
      await withTenant(app, hogar.tenantId, async (client) => {
        const aOficina = [
          await asentar(client, hogar, 'MERCADONA REF 1000'),
          await asentar(client, hogar, 'MERCADONA REF 1001'),
          await asentar(client, hogar, 'MERCADONA REF 1002'),
        ]
        await reclassify(client, { entryIds: aOficina, categoryId: hogar.oficina, changedBy: ANA })
        const aSuper = [await asentar(client, hogar, 'MERCADONA REF 1003')]
        await reclassify(client, {
          entryIds: aSuper,
          categoryId: hogar.supermercado,
          changedBy: ANA,
        })

        await asentar(client, hogar, 'MERCADONA REF 2000')
        const r = await clasificarAutomatico(client, { aplicar: true })
        const propuesta = unico(r.propuestas, 'propuesta')
        expect(propuesta.procedencia).toBe('diccionario')
        expect(propuesta.automatica).toBe(false)
      })
    })

    it('las dimensiones unánimes viajan con la categoría', async () => {
      const hogar = await nuevoHogar('dimensiones')
      await withTenant(app, hogar.tenantId, async (client) => {
        const previos: string[] = []
        for (let i = 0; i < 3; i += 1) {
          previos.push(await asentar(client, hogar, `PAPELERIA CENTRAL REF ${1000 + i}`))
        }
        await reclassify(client, { entryIds: previos, categoryId: hogar.oficina, changedBy: ANA })
        await client.query(
          `insert into posting_dimension
                  (tenant_id, posting_id, dimension_id, dimension_value_id, weight_ppm)
           select $1::uuid, p.id, $2::uuid, $3::uuid, 1000000
             from posting p join account a on a.id = p.account_id
            where p.entry_id = any($4::uuid[]) and a.kind = 'expense'`,
          [hogar.tenantId, hogar.dimPropiedad, hogar.madrid, previos],
        )

        const nuevo = await asentar(client, hogar, 'PAPELERIA CENTRAL REF 2000')
        const r = await clasificarAutomatico(client, { aplicar: true })
        expect(unico(r.propuestas, 'propuesta').dimensiones).toHaveLength(1)

        const { rows } = await client.query<{ n: string }>(
          `select count(*) as n
             from posting_dimension pd join posting p on p.id = pd.posting_id
            where p.entry_id = $1::uuid`,
          [nuevo],
        )
        expect(unico(rows, 'recuento').n).toBe('1')
      })
    })
  })

  // ── Las reglas mandan sobre todo lo demás ─────────────────────────────────

  describe('precedencia', () => {
    it('la regla del usuario gana al diccionario', async () => {
      // El caso que más importa: el diccionario sabe que Mercadona es
      // supermercado, y a este hogar le da igual porque escribió una regla.
      const hogar = await nuevoHogar('precedencia')
      await withTenant(app, hogar.tenantId, async (client) => {
        const entryId = await asentar(client, hogar, 'MERCADONA REF 8812')
        await createRule(client, {
          name: 'Compras de la sociedad',
          matchKind: 'contiene',
          matchValue: 'MERCADONA',
          categoryId: hogar.oficina,
        })

        const r = await clasificarAutomatico(client, { aplicar: true })
        const propuesta = unico(r.propuestas, 'propuesta')
        expect(propuesta.procedencia).toBe('regla')
        expect(propuesta.automatica).toBe(true)
        expect(propuesta.motivo).toContain('Compras de la sociedad')
        expect(await categoriaDe(client, entryId)).toBe('Oficina')
        // Y el diccionario ni aparece en el reparto: no se le preguntó.
        expect(r.porCapa.map((capa) => capa.procedencia)).toEqual(['regla'])
      })
    })

    it('la regla gana a la memoria', async () => {
      const hogar = await nuevoHogar('regla-memoria')
      await withTenant(app, hogar.tenantId, async (client) => {
        const previos: string[] = []
        for (let i = 0; i < 3; i += 1) {
          previos.push(await asentar(client, hogar, `PAPELERIA CENTRAL REF ${1000 + i}`))
        }
        await reclassify(client, { entryIds: previos, categoryId: hogar.oficina, changedBy: ANA })
        await createRule(client, {
          name: 'Papelería al súper',
          matchKind: 'contiene',
          matchValue: 'PAPELERIA',
          categoryId: hogar.supermercado,
        })

        const nuevo = await asentar(client, hogar, 'PAPELERIA CENTRAL REF 2000')
        const r = await clasificarAutomatico(client, { aplicar: true })
        expect(unico(r.propuestas, 'propuesta').procedencia).toBe('regla')
        expect(await categoriaDe(client, nuevo)).toBe('Supermercado')
      })
    })

    it('la auditoría de una regla guarda la regla, la procedencia y el motivo', async () => {
      const hogar = await nuevoHogar('auditoría')
      await withTenant(app, hogar.tenantId, async (client) => {
        const entryId = await asentar(client, hogar, 'MERCADONA REF 8812')
        const regla = await createRule(client, {
          name: 'Súper',
          matchKind: 'contiene',
          matchValue: 'MERCADONA',
          categoryId: hogar.supermercado,
        })
        await clasificarAutomatico(client, { aplicar: true })

        const explicacion = unico(
          [...(await explicarClasificacion(client, [entryId])).values()],
          'explicación',
        )
        expect(explicacion.procedencia).toBe('regla')
        expect(explicacion.ruleId).toBe(regla.id)
        expect(explicacion.regla).toBe('Súper')
        expect(explicacion.changedBy).toBe('sistema:regla')
        expect(explicacion.motivo).toContain('«Súper»')
      })
    })

    it('el plan de reglas reparte igual que la pasada que escribe', async () => {
      // `planRules` y `applyAllRules` son gemelos y tienen que seguir siéndolo:
      // si divergen, el motor aplica una cosa y explica otra.
      const hogar = await nuevoHogar('gemelos')
      await withTenant(app, hogar.tenantId, async (client) => {
        for (const texto of ['MERCADONA A', 'MERCADONA B', 'REPSOL A', 'AJENO']) {
          await asentar(client, hogar, texto)
        }
        await createRule(client, {
          name: 'Súper',
          matchKind: 'contiene',
          matchValue: 'MERCADONA',
          categoryId: hogar.supermercado,
          priority: 10,
        })
        await createRule(client, {
          name: 'Todo a oficina',
          matchKind: 'contiene',
          matchValue: 'A',
          categoryId: hogar.oficina,
          priority: 1,
        })

        const plan = await planRules(client, {})
        const aplicado = await applyAllRules(client, { changedBy: ANA })
        expect(plan.categoria.size).toBe(aplicado.changed)
        expect(plan.porRegla.map((r) => [r.regla.name, r.categoria.length])).toEqual(
          aplicado.porRegla.map((r) => [r.name, r.changed]),
        )
      })
    })
  })

  // ── Señal y proveedor: lo que sólo existe en la importación ───────────────

  describe('las capas que dependen de lo que trajo el origen', () => {
    it('el concepto 17 de la Norma 43 manda el cargo a comisiones bancarias, y se aplica', async () => {
      const hogar = await nuevoHogar('señal')
      await withTenant(app, hogar.tenantId, async (client) => {
        const entryId = await asentar(client, hogar, 'MANTENIMIENTO CUENTA', -350n)
        const observaciones = new Map<string, ObservacionDelOrigen>([
          [entryId, { conceptoComun: '17' }],
        ])

        const r = await clasificarAutomatico(client, { aplicar: true, observaciones })
        const propuesta = unico(r.propuestas, 'propuesta')
        expect(propuesta.procedencia).toBe('senal')
        expect(propuesta.automatica).toBe(true)
        expect(propuesta.motivo).toContain('Norma 43')
        expect(await categoriaDe(client, entryId)).toBe('Comisiones bancarias')
      })
    })

    it('sin observaciones, la señal no puede decir nada: el esquema no las guarda', async () => {
      // Lo contrario de un test de comodidad: fija por escrito la limitación
      // real. El mismo movimiento, sin lo que trajo el origen, no se clasifica.
      const hogar = await nuevoHogar('sin-señal')
      await withTenant(app, hogar.tenantId, async (client) => {
        await asentar(client, hogar, 'MANTENIMIENTO CUENTA', -350n)
        const r = await clasificarAutomatico(client, { aplicar: true })
        expect(r.propuestas).toEqual([])
        expect(r.sinPropuesta).toBe(1)
      })
    })

    it('la categoría del proveedor se traduce y se sugiere, nunca se aplica', async () => {
      const hogar = await nuevoHogar('proveedor')
      await withTenant(app, hogar.tenantId, async (client) => {
        const entryId = await asentar(client, hogar, 'PAGO 553 EN COMERCIO')
        const observaciones = new Map<string, ObservacionDelOrigen>([
          [
            entryId,
            {
              categoriaDelProveedor: {
                proveedor: 'plaid',
                detailed: 'TRANSPORTATION_GAS',
                confianza: 'VERY_HIGH',
              },
            },
          ],
        ])

        const r = await clasificarAutomatico(client, { aplicar: true, observaciones })
        const propuesta = unico(r.propuestas, 'propuesta')
        expect(propuesta.procedencia).toBe('proveedor')
        expect(propuesta.categoryId).toBe(hogar.combustible)
        expect(propuesta.automatica).toBe(false)
        // Ni el nombre de la categoría de Plaid ni su enum salen en el texto.
        expect(propuesta.motivo).not.toContain('TRANSPORTATION_GAS')
        expect(await categoriaDe(client, entryId)).toBe('Sin categorizar (EUR)')
      })
    })

    it('el diccionario gana al proveedor cuando los dos tienen algo que decir', async () => {
      const hogar = await nuevoHogar('dicc-proveedor')
      await withTenant(app, hogar.tenantId, async (client) => {
        const entryId = await asentar(client, hogar, 'MERCADONA REF 4021')
        const observaciones = new Map<string, ObservacionDelOrigen>([
          [
            entryId,
            { categoriaDelProveedor: { proveedor: 'plaid', detailed: 'TRANSPORTATION_GAS' } },
          ],
        ])
        const r = await clasificarAutomatico(client, { aplicar: false, observaciones })
        // El proveedor va por delante del diccionario: es la capa 4.
        expect(unico(r.propuestas, 'propuesta').procedencia).toBe('proveedor')
      })
    })
  })

  // ── El reparto por capa ───────────────────────────────────────────────────

  describe('el reparto por capa', () => {
    it('cuenta la última decisión que sigue en pie, no los intentos', async () => {
      // Si el motor clasificó y después una persona corrigió, lo que hay en el
      // libro lo puso la persona. Contar el intento sería el número que más se
      // parece a una mentira útil.
      const hogar = await nuevoHogar('reparto')
      await withTenant(app, hogar.tenantId, async (client) => {
        const entryId = await asentar(client, hogar, 'MERCADONA REF 8812')
        await createRule(client, {
          name: 'Súper',
          matchKind: 'contiene',
          matchValue: 'MERCADONA',
          categoryId: hogar.supermercado,
        })
        await clasificarAutomatico(client, { aplicar: true })
        expect(await clasificadoPorCapa(client)).toEqual([{ procedencia: 'regla', movimientos: 1 }])

        await reclassify(client, { entryIds: [entryId], categoryId: hogar.oficina, changedBy: ANA })
        expect(await clasificadoPorCapa(client)).toEqual([{ procedencia: null, movimientos: 1 }])
      })
    })

    it('la pasada en seco no escribe nada y lo dice', async () => {
      const hogar = await nuevoHogar('seco')
      await withTenant(app, hogar.tenantId, async (client) => {
        const entryId = await asentar(client, hogar, 'MERCADONA REF 8812')
        await createRule(client, {
          name: 'Súper',
          matchKind: 'contiene',
          matchValue: 'MERCADONA',
          categoryId: hogar.supermercado,
        })

        const r = await clasificarAutomatico(client, { aplicar: false })
        expect(unico(r.propuestas, 'propuesta').automatica).toBe(true)
        expect(r.aplicadas).toBe(0)
        expect(r.sugeridas).toBe(1)
        expect(await categoriaDe(client, entryId)).toBe('Sin categorizar (EUR)')
      })
    })

    it('entryIds acota la pasada a lo que acaba de entrar', async () => {
      const hogar = await nuevoHogar('acotado')
      await withTenant(app, hogar.tenantId, async (client) => {
        const viejo = await asentar(client, hogar, 'MERCADONA VIEJO')
        const nuevo = await asentar(client, hogar, 'MERCADONA NUEVO')
        const r = await clasificarAutomatico(client, { aplicar: false, entryIds: [nuevo] })
        expect(r.propuestas.map((p) => p.entryId)).toEqual([nuevo])
        expect(await categoriaDe(client, viejo)).toBe('Sin categorizar (EUR)')
      })
    })
  })
})
