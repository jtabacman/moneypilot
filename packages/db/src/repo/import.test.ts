/**
 * La importación tiene que ser reversible de verdad.
 *
 * Estos tests corren contra Postgres, no contra un doble: lo que hay que
 * demostrar es justamente lo que un mock no puede: que los asientos cuadran en
 * la base, que el índice único hace su trabajo, que revertir devuelve los
 * saldos al céntimo y que RLS aísla el lote entero.
 *
 * Sin DATABASE_URL se saltan solos, para que `pnpm test` siga corriendo en una
 * máquina sin Docker.
 */

import { createHash } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createPool,
  type Db,
  type TenantClient,
  withoutTenantScope,
  withTenant,
} from '../client.js'
import { migrate } from '../migrate.js'
import {
  bookTransaction,
  findFeedEntries,
  listImportBatches,
  type PersistableTransaction,
  type PersistImportInput,
  persistImport,
  reverseEntry,
  revertImport,
  updateBookedTransaction,
} from './import.js'

const ADMIN_URL = process.env['DATABASE_URL']
const APP_URL = process.env['DATABASE_APP_URL']
const enabled = ADMIN_URL !== undefined && APP_URL !== undefined
const suite = enabled ? describe : describe.skip

const hash = (seed: string): string => createHash('sha256').update(seed).digest('hex')

/** Sufijo por corrida: otros agentes están usando la misma base al mismo tiempo. */
const RUN = hash(`${process.pid}-${Date.now()}-${Math.random()}`).slice(0, 12)

suite('importación en un lote reversible', () => {
  let admin: Db
  let app: Db
  const hogaresCreados: string[] = []

  let hogar: string
  let cuenta: string

  beforeAll(async () => {
    await migrate(ADMIN_URL as string)
    admin = createPool({ connectionString: ADMIN_URL as string })
    app = createPool({ connectionString: APP_URL as string })
  }, 60_000)

  afterAll(async () => {
    if (hogaresCreados.length > 0) {
      await withoutTenantScope(admin, async (client) => {
        // En este orden: entry.import_batch_id es ON DELETE RESTRICT, así que
        // el cascade de tenant puede intentar borrar el lote antes que sus
        // asientos y plantarse.
        for (const table of ['review_item', 'declared_balance', 'entry', 'import_batch']) {
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

  async function nuevoHogar(etiqueta: string): Promise<{ tenantId: string; accountId: string }> {
    const creado = await withoutTenantScope(admin, async (client) => {
      const t = await client.query<{ id: string }>(
        'insert into tenant (name, base_currency) values ($1, $2) returning id',
        [`Casa Import ${RUN} ${etiqueta}`, 'EUR'],
      )
      const tenantId = t.rows[0]?.id as string
      const a = await client.query<{ id: string }>(
        `insert into account (tenant_id, kind, name, currency, institution)
         values ($1, 'asset', 'BBVA Corriente', 'EUR', 'BBVA') returning id`,
        [tenantId],
      )
      return { tenantId, accountId: a.rows[0]?.id as string }
    })
    hogaresCreados.push(creado.tenantId)
    return creado
  }

  beforeEach(async () => {
    // Un hogar nuevo por test: las huellas y los hashes de contenido son únicos
    // por hogar, y un test no puede depender de lo que dejó el anterior.
    const creado = await nuevoHogar(`t${hogaresCreados.length}`)
    hogar = creado.tenantId
    cuenta = creado.accountId
  })

  const enHogar = <T>(fn: Parameters<typeof withTenant<T>>[2], tenantId = hogar): Promise<T> =>
    withTenant(app, tenantId, fn)

  function movimiento(
    seed: string,
    amount: bigint,
    bookedOn = '2026-03-14',
  ): PersistableTransaction {
    return {
      bookedOn,
      description: `Compra ${seed}`,
      amount,
      currency: 'EUR',
      fingerprint: hash(`${RUN}-${seed}`),
    }
  }

  function entrada(
    seed: string,
    transactions: readonly PersistableTransaction[],
  ): PersistImportInput {
    return {
      accountId: cuenta,
      fileName: `${seed}.ofx`,
      format: 'ofx',
      contentSha256: hash(`${RUN}-fichero-${seed}`),
      linesRead: transactions.length,
      transactions,
      duplicates: 0,
      needsReview: [],
      rejected: 0,
      declaredBalances: [],
      report: { fileName: `${seed}.ofx`, imported: transactions.length },
    }
  }

  /** Suma de postings por cuenta y moneda. El estado contra el que se compara. */
  async function saldos(tenantId = hogar): Promise<Record<string, string>> {
    return enHogar(async (client) => {
      const { rows } = await client.query<{
        account_id: string
        currency: string
        total: string
      }>(
        `select account_id, currency, sum(amount)::text as total
           from posting group by account_id, currency order by account_id`,
      )
      const out: Record<string, string> = {}
      for (const row of rows) out[`${row.account_id}:${row.currency.trim()}`] = row.total
      return out
    }, tenantId)
  }

  it('cada asiento importado balancea a cero dentro de su moneda', async () => {
    const resultado = await enHogar((client) =>
      persistImport(
        client,
        entrada('balance', [movimiento('a', -4520n), movimiento('b', 130050n)]),
      ),
    )
    expect(resultado.imported).toBe(2)

    const desbalanceados = await enHogar(async (client) => {
      const { rows } = await client.query<{ entry_id: string; total: string }>(
        `select entry_id, sum(amount)::text as total
           from posting group by entry_id, currency having sum(amount) <> 0`,
      )
      return rows
    })
    expect(desbalanceados).toEqual([])
  })

  it('la suma de todos los postings del lote es cero por moneda', async () => {
    await enHogar((client) =>
      persistImport(
        client,
        entrada('total', [
          movimiento('c1', -4520n),
          movimiento('c2', -1n),
          movimiento('c3', 987654n),
        ]),
      ),
    )

    const porMoneda = await enHogar(async (client) => {
      const { rows } = await client.query<{ currency: string; total: string }>(
        `select currency, sum(amount)::text as total from posting group by currency`,
      )
      return rows
    })
    expect(porMoneda).toEqual([{ currency: 'EUR', total: '0' }])
  })

  it('un movimiento genera dos postings: la cuenta del extracto y la contrapartida', async () => {
    await enHogar((client) =>
      persistImport(client, entrada('dos-patas', [movimiento('d', -4520n)])),
    )

    const postings = await enHogar(async (client) => {
      const { rows } = await client.query<{
        ordinal: number
        amount: string
        currency: string
        name: string
      }>(
        `select p.ordinal, p.amount, p.currency, a.name
           from posting p join account a on a.id = p.account_id
          order by p.ordinal`,
      )
      return rows
    })

    expect(postings).toHaveLength(2)
    expect(postings[0]?.amount).toBe('-4520')
    expect(postings[0]?.name).toBe('BBVA Corriente')
    expect(postings[1]?.amount).toBe('4520')
    expect(postings[1]?.name).toBe('Sin categorizar (EUR)')
    expect(postings[1]?.currency.trim()).toBe('EUR')
  })

  it('un abono sin categorizar contra-asienta en una cuenta de ingreso, no de gasto', async () => {
    await enHogar((client) =>
      persistImport(
        client,
        entrada('abono', [movimiento('y1', -4520n), movimiento('y2', 300000n)]),
      ),
    )

    const contrapartidas = await enHogar(async (client) => {
      const { rows } = await client.query<{ kind: string; name: string; amount: string }>(
        `select a.kind::text as kind, a.name, p.amount
           from posting p join account a on a.id = p.account_id
          where p.ordinal = 1 order by p.amount`,
      )
      return rows
    })

    // Un sueldo de 3.000 € no es un gasto de −3.000 €: si cayera en la bolsa de
    // gastos, el informe del mes restaría el sueldo del gasto real.
    expect(contrapartidas).toEqual([
      { kind: 'income', name: 'Ingresos sin categorizar (EUR)', amount: '-300000' },
      { kind: 'expense', name: 'Sin categorizar (EUR)', amount: '4520' },
    ])
  })

  it('no crea la bolsa de ingresos si el extracto no trae ningún abono', async () => {
    await enHogar((client) =>
      persistImport(client, entrada('solo-cargos', [movimiento('y3', -1n)])),
    )

    const cuentas = await enHogar(async (client) => {
      const { rows } = await client.query<{ name: string }>(
        `select name from account where name ilike '%sin categorizar%' order by name`,
      )
      return rows.map((row) => row.name)
    })
    expect(cuentas).toEqual(['Sin categorizar (EUR)'])
  })

  it('asienta la contrapartida en la cuenta indicada cuando se pasa una', async () => {
    const contrapartida = await enHogar(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into account (tenant_id, kind, name, currency)
         values ($1, 'expense', 'Supermercado', 'EUR') returning id`,
        [hogar],
      )
      return rows[0]?.id as string
    })

    await enHogar((client) =>
      persistImport(client, {
        ...entrada('elegida', [movimiento('e', -7000n)]),
        suspenseAccountId: contrapartida,
      }),
    )

    const nombres = await enHogar(async (client) => {
      const { rows } = await client.query<{ name: string }>(
        `select a.name from posting p join account a on a.id = p.account_id order by p.ordinal`,
      )
      return rows.map((row) => row.name)
    })
    expect(nombres).toEqual(['BBVA Corriente', 'Supermercado'])
  })

  it('reutiliza la cuenta "Sin categorizar" que ya tenga el hogar en esa moneda', async () => {
    const propia = await enHogar(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into account (tenant_id, kind, name, currency)
         values ($1, 'expense', 'Sin categorizar', 'EUR') returning id`,
        [hogar],
      )
      return rows[0]?.id as string
    })

    await enHogar((client) => persistImport(client, entrada('reutiliza', [movimiento('w', -900n)])))

    const contrapartida = await enHogar(async (client) => {
      const { rows } = await client.query<{ account_id: string; cuentas: string }>(
        `select p.account_id,
                (select count(*) from account where name like 'Sin categorizar%')::text as cuentas
           from posting p where p.ordinal = 1`,
      )
      return rows[0]
    })
    expect(contrapartida?.account_id).toBe(propia)
    // Y no se creó una segunda bolsa al lado de la que ya existía.
    expect(contrapartida?.cuentas).toBe('1')
  })

  it('rechaza una contrapartida en otra moneda porque el asiento no balancearía', async () => {
    const enDolares = await enHogar(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into account (tenant_id, kind, name, currency)
         values ($1, 'expense', 'Gastos USD', 'USD') returning id`,
        [hogar],
      )
      return rows[0]?.id as string
    })

    await expect(
      enHogar((client) =>
        persistImport(client, {
          ...entrada('mala-contrapartida', [movimiento('f', -100n)]),
          suspenseAccountId: enDolares,
        }),
      ),
    ).rejects.toThrow(/USD.*EUR|EUR.*USD/)
  })

  it('rechaza movimientos en una moneda distinta a la de la cuenta', async () => {
    const enDolares: PersistableTransaction = {
      ...movimiento('g', -100n),
      currency: 'USD',
    }
    await expect(
      enHogar((client) => persistImport(client, entrada('divisa', [enDolares]))),
    ).rejects.toThrow(/USD/)

    const asientos = await enHogar(async (client) =>
      Number(
        (await client.query<{ n: string }>('select count(*)::text as n from entry')).rows[0]?.n,
      ),
    )
    expect(asientos).toBe(0)
  })

  it('no reimporta un fichero ya cargado: mismo hash, mismo lote, nada nuevo', async () => {
    const input = entrada('idempotente', [movimiento('h1', -1000n), movimiento('h2', -2000n)])
    const primero = await enHogar((client) => persistImport(client, input))
    expect(primero.skippedByContentHash).toBe(false)

    // El mismo contenido con otro nombre de fichero sigue siendo el mismo fichero.
    const segundo = await enHogar((client) =>
      persistImport(client, { ...input, fileName: 'copia-descargada-de-nuevo.ofx' }),
    )

    expect(segundo.skippedByContentHash).toBe(true)
    expect(segundo.batchId).toBe(primero.batchId)
    expect(segundo.imported).toBe(2)

    const conteos = await enHogar(async (client) => {
      const { rows } = await client.query<{ lotes: string; asientos: string; postings: string }>(
        `select (select count(*) from import_batch)::text as lotes,
                (select count(*) from entry)::text as asientos,
                (select count(*) from posting)::text as postings`,
      )
      return rows[0]
    })
    expect(conteos).toEqual({ lotes: '1', asientos: '2', postings: '4' })
  })

  it('lo que va a revisión no entra al libro, pero queda entero en review_item', async () => {
    const dudosa = movimiento('i-dudosa', -3350n)
    const resultado = await enHogar((client) =>
      persistImport(client, {
        ...entrada('revision', [movimiento('i-nueva', -1200n)]),
        needsReview: [
          {
            transaction: dudosa,
            evidence: { reason: 'fuzzy', similarity: 0.82, dayGap: 2, candidateId: 'pending:7' },
          },
        ],
      }),
    )

    expect(resultado.imported).toBe(1)
    expect(resultado.needsReview).toBe(1)

    const revision = await enHogar(async (client) => {
      const { rows } = await client.query<{
        kind: string
        state: string
        entry_id: string | null
        counterpart_id: string | null
        evidence: Record<string, Record<string, unknown>>
      }>('select kind, state, entry_id, counterpart_id, evidence from review_item')
      return rows
    })

    expect(revision).toHaveLength(1)
    const fila = revision[0]
    expect(fila?.kind).toBe('posible_duplicado')
    expect(fila?.state).toBe('pendiente')
    // No se asienta: el informe que aprobó el cliente no la contaba como
    // movimiento, y el libro tiene que decir lo mismo que el informe.
    expect(fila?.entry_id).toBeNull()
    // 'pending:7' no es un asiento de la base, así que no se ata la FK.
    expect(fila?.counterpart_id).toBeNull()
    expect(fila?.evidence['transaccion']?.['amountMinor']).toBe('-3350')
    expect(fila?.evidence['transaccion']?.['fingerprint']).toBe(dudosa.fingerprint)
    expect(fila?.evidence['evidencia']?.['similarity']).toBe(0.82)

    const asientos = await enHogar(async (client) =>
      Number(
        (await client.query<{ n: string }>('select count(*)::text as n from entry')).rows[0]?.n,
      ),
    )
    expect(asientos).toBe(1)
  })

  /* ── Materializar lo que esperaba en la cola ───────────────────────────── */

  /**
   * Lo que hace /revisar al aceptar una fila: leer la transacción de la
   * evidencia y volver a armarla. El importe está guardado como TEXTO, así que
   * el paso por `BigInt` es parte de lo que hay que probar — con `Number`, un
   * patrimonio en céntimos pierde céntimos sin avisar.
   */
  async function laQueEspera(
    client: TenantClient,
  ): Promise<{ transaction: PersistableTransaction; batchId: string }> {
    const { rows } = await client.query<{
      transaccion: Record<string, string | null>
      batch: string
    }>(
      `select evidence->'transaccion' as transaccion, import_batch_id::text as batch
         from review_item limit 1`,
    )
    const fila = rows[0]
    if (fila === undefined) throw new Error('No hay ninguna fila esperando en la cola.')
    const guardada = fila.transaccion
    return {
      batchId: fila.batch,
      transaction: {
        bookedOn: guardada['bookedOn'] as string,
        description: guardada['description'] as string,
        amount: BigInt(guardada['amountMinor'] as string),
        currency: guardada['currency'] as string,
        fingerprint: guardada['fingerprint'] as string,
      },
    }
  }

  it('materializar una fila de la cola crea el asiento con sus dos patas y balancea a cero', async () => {
    await enHogar((client) =>
      persistImport(client, {
        ...entrada('materializa', [movimiento('mat-0', -1200n)]),
        needsReview: [
          { transaction: movimiento('mat-1', -8875n), evidence: { reason: 'fuzzy', dayGap: 1 } },
        ],
      }),
    )

    const entryId = await enHogar(async (client) => {
      const espera = await laQueEspera(client)
      return bookTransaction(client, {
        accountId: cuenta,
        batchId: espera.batchId,
        transaction: espera.transaction,
      })
    })

    const patas = await enHogar(async (client) => {
      const { rows } = await client.query<{ ordinal: number; amount: string; name: string }>(
        `select p.ordinal, p.amount, a.name
           from posting p join account a on a.id = p.account_id
          where p.entry_id = $1::uuid order by p.ordinal`,
        [entryId],
      )
      return rows
    })

    expect(patas).toEqual([
      { ordinal: 0, amount: '-8875', name: 'BBVA Corriente' },
      { ordinal: 1, amount: '8875', name: 'Sin categorizar (EUR)' },
    ])
    // Lo que hace comprobable el libro: la suma de las patas es cero por moneda.
    expect(patas.reduce((total, pata) => total + BigInt(pata.amount), 0n)).toBe(0n)
  })

  it('el asiento materializado cuelga del lote que trajo la fila, así que se deshace con él', async () => {
    const lote = await enHogar((client) =>
      persistImport(client, {
        ...entrada('materializa-lote', [movimiento('mat-2', -100n)]),
        needsReview: [{ transaction: movimiento('mat-3', -777n), evidence: {} }],
      }),
    )

    await enHogar(async (client) => {
      const espera = await laQueEspera(client)
      return bookTransaction(client, {
        accountId: cuenta,
        batchId: espera.batchId,
        transaction: espera.transaction,
      })
    })
    expect(await saldos()).not.toEqual({})

    const revertido = await enHogar((client) => revertImport(client, lote.batchId))
    // El importado y el materializado: los dos son del lote.
    expect(revertido.removedEntries).toBe(2)
    expect(await saldos()).toEqual({})
  })

  it('materializar en una moneda que no es la de la cuenta falla y no deja medio asiento', async () => {
    await enHogar((client) =>
      persistImport(client, {
        ...entrada('materializa-divisa', [movimiento('mat-4', -100n)]),
        needsReview: [{ transaction: movimiento('mat-5', -500n), evidence: {} }],
      }),
    )

    await expect(
      enHogar(async (client) => {
        const espera = await laQueEspera(client)
        return bookTransaction(client, {
          accountId: cuenta,
          batchId: espera.batchId,
          transaction: { ...espera.transaction, currency: 'USD' },
        })
      }),
    ).rejects.toThrow(/USD.*EUR|EUR.*USD/)

    // Un asiento a medias sería peor que no asentar: la transacción revierte
    // entera, así que el libro se queda con el único movimiento que importó.
    const conteo = await enHogar(async (client) => {
      const { rows } = await client.query<{ asientos: string; postings: string }>(
        `select (select count(*) from entry)::text as asientos,
                (select count(*) from posting)::text as postings`,
      )
      return rows[0]
    })
    expect(conteo).toEqual({ asientos: '1', postings: '2' })
  })

  it('materializar dos veces la misma fila rebota contra la huella única', async () => {
    await enHogar((client) =>
      persistImport(client, {
        ...entrada('materializa-doble', [movimiento('mat-6', -100n)]),
        needsReview: [{ transaction: movimiento('mat-7', -640n), evidence: {} }],
      }),
    )

    const asentar = () =>
      enHogar(async (client) => {
        const espera = await laQueEspera(client)
        return bookTransaction(client, {
          accountId: cuenta,
          batchId: espera.batchId,
          transaction: espera.transaction,
        })
      })

    await asentar()
    // La huella es la garantía de idempotencia del libro: sin ella, dos clicks
    // seguidos en «no es duplicado» meterían el movimiento dos veces.
    await expect(asentar()).rejects.toThrow(/fingerprint/i)

    const asientos = await enHogar(async (client) =>
      Number(
        (await client.query<{ n: string }>('select count(*)::text as n from entry')).rows[0]?.n,
      ),
    )
    expect(asientos).toBe(2)
  })

  it('materializar contra una cuenta de otro hogar no encuentra la cuenta', async () => {
    await enHogar((client) =>
      persistImport(client, {
        ...entrada('materializa-ajena', [movimiento('mat-8', -100n)]),
        needsReview: [{ transaction: movimiento('mat-9', -900n), evidence: {} }],
      }),
    )
    const vecino = await nuevoHogar('cuenta-ajena')

    await expect(
      enHogar(async (client) => {
        const espera = await laQueEspera(client)
        return bookTransaction(client, {
          accountId: vecino.accountId,
          batchId: espera.batchId,
          transaction: espera.transaction,
        })
      }),
    ).rejects.toThrow(/no existe en este hogar/)
  })

  it('guarda los saldos declarados del extracto atados al lote', async () => {
    const resultado = await enHogar((client) =>
      persistImport(client, {
        ...entrada('saldos', [movimiento('j', -500n)]),
        declaredBalances: [
          { asOf: '2026-02-28', amount: 1_000_00n, currency: 'EUR' },
          { asOf: '2026-03-31', amount: 999_50n, currency: 'EUR' },
        ],
      }),
    )

    const filas = await enHogar(async (client) => {
      const { rows } = await client.query<{
        as_of: string
        amount: string
        import_batch_id: string
      }>(
        `select as_of::text as as_of, amount, import_batch_id
           from declared_balance order by as_of`,
      )
      return rows
    })

    expect(filas.map((f) => [f.as_of, f.amount])).toEqual([
      ['2026-02-28', '100000'],
      ['2026-03-31', '99950'],
    ])
    expect(filas[0]?.import_batch_id).toBe(resultado.batchId)
  })

  it('un saldo declarado que contradice al ya guardado para esa fecha se rechaza', async () => {
    await enHogar((client) =>
      persistImport(client, {
        ...entrada('saldo-1', [movimiento('k1', -100n)]),
        declaredBalances: [{ asOf: '2026-03-31', amount: 100_00n, currency: 'EUR' }],
      }),
    )

    await expect(
      enHogar((client) =>
        persistImport(client, {
          ...entrada('saldo-2', [movimiento('k2', -200n)]),
          declaredBalances: [{ asOf: '2026-03-31', amount: 200_00n, currency: 'EUR' }],
        }),
      ),
    ).rejects.toThrow(/2026-03-31/)
  })

  it('revertir un lote deja los saldos exactamente como estaban antes', async () => {
    await enHogar((client) =>
      persistImport(
        client,
        entrada('previo', [movimiento('l1', -4520n), movimiento('l2', 90000n)]),
      ),
    )
    const antes = await saldos()

    const segundo = await enHogar((client) =>
      persistImport(client, {
        ...entrada('reversible', [movimiento('l3', -1n), movimiento('l4', -333333n)]),
        declaredBalances: [{ asOf: '2026-04-30', amount: 7n, currency: 'EUR' }],
      }),
    )
    expect(await saldos()).not.toEqual(antes)

    const revertido = await enHogar((client) => revertImport(client, segundo.batchId))
    expect(revertido.removedEntries).toBe(2)
    expect(await saldos()).toEqual(antes)

    const restos = await enHogar(async (client) => {
      const { rows } = await client.query<{ saldos: string; asientos: string; estado: string }>(
        `select (select count(*) from declared_balance)::text as saldos,
                (select count(*) from entry)::text as asientos,
                (select status::text from import_batch where id = $1) as estado`,
        [segundo.batchId],
      )
      return rows[0]
    })
    expect(restos).toEqual({ saldos: '0', asientos: '2', estado: 'reverted' })
  })

  it('revertir borra también los postings y la cola de revisión del lote', async () => {
    const lote = await enHogar((client) =>
      persistImport(client, {
        ...entrada('limpieza', [movimiento('m1', -1000n)]),
        needsReview: [{ transaction: movimiento('m2', -2000n), evidence: { reason: 'fuzzy' } }],
      }),
    )

    await enHogar((client) => revertImport(client, lote.batchId))

    const restos = await enHogar(async (client) => {
      const { rows } = await client.query<{
        postings: string
        revisiones: string
        reverted_at: Date | null
      }>(
        `select (select count(*) from posting)::text as postings,
                (select count(*) from review_item)::text as revisiones,
                (select reverted_at from import_batch where id = $1) as reverted_at`,
        [lote.batchId],
      )
      return rows[0]
    })
    expect(restos?.postings).toBe('0')
    expect(restos?.revisiones).toBe('0')
    expect(restos?.reverted_at).not.toBeNull()
  })

  it('revertir dos veces el mismo lote falla diciendo que ya se revirtió', async () => {
    const lote = await enHogar((client) =>
      persistImport(client, entrada('doble-revert', [movimiento('n', -10n)])),
    )
    await enHogar((client) => revertImport(client, lote.batchId))

    await expect(enHogar((client) => revertImport(client, lote.batchId))).rejects.toThrow(
      /ya se revirtió/,
    )
  })

  /**
   * Anula un asiento del lote como manda el esquema: se crea un asiento nuevo
   * con los postings invertidos y el ORIGINAL queda marcado apuntando a él.
   */
  async function anularAsientoDelLote(batchId: string): Promise<void> {
    await enHogar(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'select id from entry where import_batch_id = $1',
        [batchId],
      )
      const original = rows[0]?.id as string
      const corrector = await client.query<{ id: string }>(
        `insert into entry (tenant_id, booked_on, description, source)
         values ($1, '2026-03-20', 'Corrección manual', 'manual') returning id`,
        [hogar],
      )
      const correctorId = corrector.rows[0]?.id as string
      await client.query(
        `insert into posting (tenant_id, entry_id, account_id, ordinal, amount, currency)
         values ($1, $2, $3, 0, 4520, 'EUR')`,
        [hogar, correctorId, cuenta],
      )
      await client.query('update entry set reversed_by = $1 where id = $2', [correctorId, original])
    })
  }

  it('un lote con un asiento ya anulado no se revierte: dejaría el saldo movido', async () => {
    const lote = await enHogar((client) =>
      persistImport(client, entrada('anulado', [movimiento('u', -4520n)])),
    )
    await anularAsientoDelLote(lote.batchId)
    const antes = await saldos()

    await expect(enHogar((client) => revertImport(client, lote.batchId))).rejects.toThrow(
      /asientos de anulación posteriores/,
    )

    // Lo que se protege no es el asiento, es el saldo: borrar el original
    // dejaría vivos los postings invertidos del corrector y la cuenta quedaría
    // con 45,20 € que nunca existieron.
    expect(await saldos()).toEqual(antes)
    const sigueEntero = await enHogar(async (client) => {
      const { rows } = await client.query<{ n: string }>(
        'select count(*)::text as n from entry where import_batch_id = $1',
        [lote.batchId],
      )
      return Number(rows[0]?.n)
    })
    expect(sigueEntero).toBe(1)
  })

  it('tampoco se revierte un lote cuyo asiento anula a otro anterior', async () => {
    const previo = await enHogar((client) =>
      persistImport(client, entrada('previo-anulable', [movimiento('u2', -100n)])),
    )
    const lote = await enHogar((client) =>
      persistImport(client, entrada('anulador', [movimiento('u3', 100n)])),
    )

    await enHogar(async (client) => {
      const { rows } = await client.query<{ id: string; batch: string }>(
        'select id, import_batch_id::text as batch from entry',
      )
      const original = rows.find((row) => row.batch === previo.batchId)?.id as string
      const corrector = rows.find((row) => row.batch === lote.batchId)?.id as string
      await client.query('update entry set reversed_by = $1 where id = $2', [corrector, original])
    })

    await expect(enHogar((client) => revertImport(client, lote.batchId))).rejects.toThrow(
      /asientos de anulación posteriores/,
    )
  })

  it('revertir no se lleva por delante la cola de revisión de otro lote', async () => {
    const primero = await enHogar((client) =>
      persistImport(client, entrada('con-asiento', [movimiento('x1', -100n)])),
    )
    const asientoId = await enHogar(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'select id from entry where import_batch_id = $1',
        [primero.batchId],
      )
      return rows[0]?.id as string
    })

    // El segundo lote marca una dudosa contra un asiento del primero.
    const segundo = await enHogar((client) =>
      persistImport(client, {
        ...entrada('con-revision', [movimiento('x2', -200n)]),
        needsReview: [
          { transaction: movimiento('x3', -100n), evidence: { candidateId: asientoId } },
        ],
      }),
    )

    const revertido = await enHogar((client) => revertImport(client, primero.batchId))
    expect(revertido.detachedReviewItems).toBe(1)

    const cola = await enHogar(async (client) => {
      const { rows } = await client.query<{
        import_batch_id: string
        counterpart_id: string | null
        evidence: Record<string, Record<string, unknown>>
      }>('select import_batch_id, counterpart_id, evidence from review_item')
      return rows
    })
    // La fila sobrevive con su evidencia; sólo pierde el puntero al asiento.
    expect(cola).toHaveLength(1)
    expect(cola[0]?.import_batch_id).toBe(segundo.batchId)
    expect(cola[0]?.counterpart_id).toBeNull()
    expect(cola[0]?.evidence['transaccion']?.['amountMinor']).toBe('-100')
  })

  it('revertir un lote que no existe en el hogar falla con un mensaje claro', async () => {
    await expect(
      enHogar((client) => revertImport(client, '00000000-0000-4000-8000-000000000000')),
    ).rejects.toThrow(/no existe en este hogar/)
  })

  it('después de revertir se puede volver a importar el mismo fichero', async () => {
    const input = entrada('reimportable', [movimiento('o', -4520n)])
    const primero = await enHogar((client) => persistImport(client, input))
    await enHogar((client) => revertImport(client, primero.batchId))

    const segundo = await enHogar((client) => persistImport(client, input))
    expect(segundo.skippedByContentHash).toBe(false)
    expect(segundo.batchId).not.toBe(primero.batchId)
    expect(segundo.imported).toBe(1)
  })

  it('una huella repetida dentro del mismo fichero aborta la importación entera', async () => {
    const repetida = movimiento('p', -4520n)
    await expect(
      enHogar((client) =>
        persistImport(client, entrada('huella-repetida', [repetida, { ...repetida }])),
      ),
    ).rejects.toThrow(/huella/i)

    const lotes = await enHogar((client) => listImportBatches(client))
    expect(lotes).toEqual([])
  })

  it('una huella que ya existe en el hogar aborta la importación y no deja nada a medias', async () => {
    const movimientoOriginal = movimiento('q', -4520n)
    await enHogar((client) => persistImport(client, entrada('primera', [movimientoOriginal])))

    await expect(
      enHogar((client) =>
        persistImport(
          client,
          entrada('segunda', [movimiento('q-otra', -1n), { ...movimientoOriginal }]),
        ),
      ),
    ).rejects.toThrow(/fingerprint/i)

    const lotes = await enHogar((client) => listImportBatches(client))
    expect(lotes).toHaveLength(1)
    expect(lotes[0]?.imported).toBe(1)
  })

  it('la misma huella en mayúsculas es la misma huella y no entra dos veces', async () => {
    const original = movimiento('z', -4520n)
    await enHogar((client) => persistImport(client, entrada('huella-minus', [original])))

    await expect(
      enHogar((client) =>
        persistImport(
          client,
          entrada('huella-mayus', [
            { ...original, fingerprint: original.fingerprint.toUpperCase() },
          ]),
        ),
      ),
    ).rejects.toThrow(/fingerprint/i)

    const asientos = await enHogar(async (client) =>
      Number(
        (await client.query<{ n: string }>('select count(*)::text as n from entry')).rows[0]?.n,
      ),
    )
    expect(asientos).toBe(1)
  })

  it('guarda el motivo de revisión que le pasan y no siempre "posible duplicado"', async () => {
    await enHogar((client) =>
      persistImport(client, {
        ...entrada('motivos', [movimiento('z1', -100n)]),
        needsReview: [
          { transaction: movimiento('z2', -200n), evidence: {}, kind: 'transferencia_sugerida' },
          { transaction: movimiento('z3', -300n), evidence: {} },
        ],
      }),
    )

    const motivos = await enHogar(async (client) => {
      const { rows } = await client.query<{ kind: string }>(
        'select kind::text as kind from review_item order by kind',
      )
      return rows.map((row) => row.kind)
    })
    expect(motivos).toEqual(['posible_duplicado', 'transferencia_sugerida'])
  })

  it('un limit imposible no llega a Postgres convertido en basura', async () => {
    await enHogar((client) => persistImport(client, entrada('limite', [movimiento('z4', -1n)])))
    for (const limit of [Number.NaN, Number.POSITIVE_INFINITY, -3, 0]) {
      const lotes = await enHogar((client) => listImportBatches(client, limit))
      expect(lotes).toHaveLength(1)
    }
  })

  it('el hogar de al lado no ve el lote, ni sus asientos, ni sus postings', async () => {
    await enHogar((client) => persistImport(client, entrada('aislado', [movimiento('r', -4520n)])))
    const vecino = await nuevoHogar('vecino')

    const visto = await withTenant(app, vecino.tenantId, async (client) => {
      const { rows } = await client.query<{
        lotes: string
        asientos: string
        postings: string
        revisiones: string
      }>(
        `select (select count(*) from import_batch)::text as lotes,
                (select count(*) from entry)::text as asientos,
                (select count(*) from posting)::text as postings,
                (select count(*) from review_item)::text as revisiones`,
      )
      return rows[0]
    })
    expect(visto).toEqual({ lotes: '0', asientos: '0', postings: '0', revisiones: '0' })

    const listado = await withTenant(app, vecino.tenantId, (client) => listImportBatches(client))
    expect(listado).toEqual([])
  })

  it('el hogar de al lado tampoco puede revertir el lote', async () => {
    const lote = await enHogar((client) =>
      persistImport(client, entrada('ajeno', [movimiento('s', -4520n)])),
    )
    const vecino = await nuevoHogar('ladron')

    await expect(
      withTenant(app, vecino.tenantId, (client) => revertImport(client, lote.batchId)),
    ).rejects.toThrow(/no existe en este hogar/)

    const sigueEntero = await enHogar(async (client) =>
      Number(
        (await client.query<{ n: string }>('select count(*)::text as n from entry')).rows[0]?.n,
      ),
    )
    expect(sigueEntero).toBe(1)
  })

  it('lista los lotes del hogar del más nuevo al más viejo con su estado', async () => {
    const viejo = await enHogar((client) =>
      persistImport(client, entrada('viejo', [movimiento('t1', -100n)])),
    )
    const nuevo = await enHogar((client) =>
      persistImport(client, {
        ...entrada('nuevo', [movimiento('t2', -200n)]),
        duplicates: 3,
        rejected: 1,
        linesRead: 5,
      }),
    )
    await enHogar((client) => revertImport(client, viejo.batchId))

    const lotes = await enHogar((client) => listImportBatches(client))
    expect(lotes.map((lote) => lote.id)).toEqual([nuevo.batchId, viejo.batchId])
    expect(lotes[0]?.fileName).toBe('nuevo.ofx')
    expect(lotes[0]?.status).toBe('completed')
    expect(lotes[0]?.duplicates).toBe(3)
    expect(lotes[0]?.rejected).toBe(1)
    expect(lotes[0]?.linesRead).toBe(5)
    expect(lotes[0]?.accountId).toBe(cuenta)
    expect(lotes[1]?.status).toBe('reverted')
    expect(lotes[1]?.revertedAt).not.toBeNull()
  })

  it('se niega a persistir fuera de withTenant en vez de escribir sin hogar', async () => {
    await expect(
      withoutTenantScope(app, (client) =>
        persistImport(client, entrada('sin-hogar', [movimiento('v', -1n)])),
      ),
    ).rejects.toThrow(/withTenant/)
  })

  it('carga un extracto de miles de movimientos y lo revierte entero', async () => {
    const muchos = Array.from({ length: 1500 }, (_, index) =>
      movimiento(`masivo-${index}`, BigInt(index % 2 === 0 ? -index - 1 : index + 1)),
    )
    const lote = await enHogar((client) => persistImport(client, entrada('masivo', muchos)))
    expect(lote.imported).toBe(1500)

    const conteo = await enHogar(async (client) => {
      const { rows } = await client.query<{ postings: string; total: string }>(
        `select count(*)::text as postings, coalesce(sum(amount), 0)::text as total from posting`,
      )
      return rows[0]
    })
    expect(conteo).toEqual({ postings: '3000', total: '0' })

    const revertido = await enHogar((client) => revertImport(client, lote.batchId))
    expect(revertido.removedEntries).toBe(1500)
    expect(await saldos()).toEqual({})
  }, 30_000)

  // ── Corrección en su sitio de lo que trae un feed ─────────────────────────

  /** Una importación de feed: lo mismo que un fichero, pero declarando 'api'. */
  function delFeed(seed: string, amount: bigint, bookedOn?: string): PersistImportInput {
    return { ...entrada(seed, [movimiento(seed, amount, bookedOn)]), source: 'api' }
  }

  /** El único asiento del hogar, con la identidad de sus dos patas. */
  async function elAsiento(): Promise<{
    entryId: string
    bancoId: string
    contrapartidaId: string
  }> {
    return enHogar(async (client) => {
      const { rows } = await client.query<{
        entry_id: string
        id: string
        account_id: string
      }>('select p.entry_id, p.id::text as id, p.account_id from posting p order by p.ordinal')
      const banco = rows.find((fila) => fila.account_id === cuenta)
      const otra = rows.find((fila) => fila.account_id !== cuenta)
      if (banco === undefined || otra === undefined) {
        throw new Error('El hogar no tiene un asiento con sus dos patas.')
      }
      return { entryId: banco.entry_id, bancoId: banco.id, contrapartidaId: otra.id }
    })
  }

  interface Pata {
    posting_id: string
    amount: string
    booked_on: string
    description: string
    fingerprint: string
    source: string
  }

  async function estado(entryId: string): Promise<Pata[]> {
    return enHogar(async (client) => {
      const { rows } = await client.query<Pata>(
        `select p.id::text as posting_id, p.amount::text as amount,
                to_char(e.booked_on, 'YYYY-MM-DD') as booked_on, e.description,
                trim(e.fingerprint) as fingerprint, e.source::text as source
           from entry e join posting p on p.entry_id = e.id
          where e.id = $1::uuid
          order by p.ordinal`,
        [entryId],
      )
      return rows
    })
  }

  it('un lote de feed queda marcado como origen api y no como fichero', async () => {
    await enHogar((client) => persistImport(client, delFeed('origen', -1000n)))
    const patas = await estado((await elAsiento()).entryId)
    expect(patas[0]?.source).toBe('api')
  })

  it('la pata bancaria de una actualización conserva su identidad', async () => {
    // Lo que importa no es sólo que el importe quede bien: es que sea LA MISMA
    // fila. De su id cuelgan las dimensiones, y del asiento la cola de
    // revisión y el lote.
    await enHogar((client) => persistImport(client, delFeed('correccion', -13589n)))
    const antes = await elAsiento()

    const resultado = await enHogar((client) =>
      updateBookedTransaction(client, {
        entryId: antes.entryId,
        accountId: cuenta,
        transaction: {
          bookedOn: '2026-03-16',
          description: 'ALLIANZ LV / FLESSA KG',
          amount: -14000n,
          currency: 'EUR',
          fingerprint: hash(`${RUN}-correccion-asentada`),
        },
      }),
    )

    expect(resultado.entryId).toBe(antes.entryId)
    expect(resultado.bankPostingId).toBe(antes.bancoId)
    expect(resultado.counterpartPostingId).toBe(antes.contrapartidaId)
    expect([...resultado.changed].sort()).toEqual([
      'amount',
      'bookedOn',
      'description',
      'fingerprint',
    ])

    const despues = await estado(antes.entryId)
    expect(despues.map((pata) => pata.posting_id)).toEqual([antes.bancoId, antes.contrapartidaId])
    expect(despues.map((pata) => pata.amount)).toEqual(['-14000', '14000'])
    expect(despues[0]?.booked_on).toBe('2026-03-16')
    expect(despues[0]?.description).toBe('ALLIANZ LV / FLESSA KG')
    expect(despues[0]?.fingerprint).toBe(hash(`${RUN}-correccion-asentada`))
    // Sigue cuadrando: la contrapartida se calcula por negación, no se relee.
    expect(despues.reduce((total, pata) => total + BigInt(pata.amount), 0n)).toBe(0n)
  })

  it('la actualización no se lleva por delante la atribución a dimensiones', async () => {
    await enHogar((client) => persistImport(client, delFeed('dimension', -5000n)))
    const antes = await elAsiento()

    await enHogar(async (client) => {
      const dimension = await client.query<{ id: string }>(
        `insert into dimension (tenant_id, key, label) values ($1, 'propiedad', 'Propiedad')
         returning id`,
        [hogar],
      )
      const valor = await client.query<{ id: string }>(
        `insert into dimension_value (tenant_id, dimension_id, label)
         values ($1, $2, 'Casa Madrid') returning id`,
        [hogar, dimension.rows[0]?.id],
      )
      await client.query(
        `insert into posting_dimension (tenant_id, posting_id, dimension_id, dimension_value_id)
         values ($1, $2::bigint, $3, $4)`,
        [hogar, antes.bancoId, dimension.rows[0]?.id, valor.rows[0]?.id],
      )
    })

    await enHogar((client) =>
      updateBookedTransaction(client, {
        entryId: antes.entryId,
        accountId: cuenta,
        transaction: {
          bookedOn: '2026-03-14',
          description: 'Compra dimension asentada',
          amount: -5100n,
          currency: 'EUR',
          fingerprint: hash(`${RUN}-dimension-asentada`),
        },
      }),
    )

    const atribuciones = await enHogar(async (client) => {
      const { rows } = await client.query<{ posting_id: string; label: string }>(
        `select pd.posting_id::text as posting_id, dv.label
           from posting_dimension pd join dimension_value dv on dv.id = pd.dimension_value_id`,
      )
      return rows
    })
    expect(atribuciones).toEqual([{ posting_id: antes.bancoId, label: 'Casa Madrid' }])
  })

  it('la actualización deja el asiento en el lote que lo trajo, que lo sigue deshaciendo', async () => {
    const lote = await enHogar((client) => persistImport(client, delFeed('lote', -2500n)))
    const antes = await elAsiento()

    await enHogar((client) =>
      updateBookedTransaction(client, {
        entryId: antes.entryId,
        accountId: cuenta,
        transaction: {
          bookedOn: '2026-03-14',
          description: 'Compra lote asentada',
          amount: -2600n,
          currency: 'EUR',
          fingerprint: hash(`${RUN}-lote-asentada`),
        },
      }),
    )

    const revertido = await enHogar((client) => revertImport(client, lote.batchId))
    expect(revertido.removedEntries).toBe(1)
    expect(await saldos()).toEqual({})
  })

  it('no reescribe en su sitio un asiento que vino por fichero', async () => {
    // Su identificador es un FITID, no el del proveedor: que coincida es
    // casualidad, y reescribirlo borraría un dato que nadie pidió cambiar.
    await enHogar((client) =>
      persistImport(client, entrada('de-fichero', [movimiento('ff', -100n)])),
    )
    const antes = await elAsiento()

    await expect(
      enHogar((client) =>
        updateBookedTransaction(client, {
          entryId: antes.entryId,
          accountId: cuenta,
          transaction: {
            bookedOn: '2026-03-14',
            description: 'Compra ff',
            amount: -200n,
            currency: 'EUR',
            fingerprint: hash(`${RUN}-ff-2`),
          },
        }),
      ),
    ).rejects.toThrow(/feed/)
  })

  it('no reparte la corrección entre varias contrapartidas', async () => {
    await enHogar((client) => persistImport(client, delFeed('repartido', -10000n)))
    const antes = await elAsiento()

    // El usuario repartió el gasto en dos categorías: 60/40.
    await enHogar(async (client) => {
      await client.query('update posting set amount = -6000 where id = $1::bigint', [
        antes.contrapartidaId,
      ])
      await client.query(
        `insert into posting (tenant_id, entry_id, account_id, ordinal, amount, currency)
         select tenant_id, entry_id, account_id, 2, -4000, currency
           from posting where id = $1::bigint`,
        [antes.contrapartidaId],
      )
    })

    await expect(
      enHogar((client) =>
        updateBookedTransaction(client, {
          entryId: antes.entryId,
          accountId: cuenta,
          transaction: {
            bookedOn: '2026-03-14',
            description: 'Compra repartido',
            amount: -11000n,
            currency: 'EUR',
            fingerprint: hash(`${RUN}-repartido-2`),
          },
        }),
      ),
    ).rejects.toThrow(/contrapartida/)
  })

  it('un cargo que se vuelve abono no es una corrección: se rechaza', async () => {
    await enHogar((client) => persistImport(client, delFeed('signo', -4520n)))
    const antes = await elAsiento()

    await expect(
      enHogar((client) =>
        updateBookedTransaction(client, {
          entryId: antes.entryId,
          accountId: cuenta,
          transaction: {
            bookedOn: '2026-03-14',
            description: 'Compra signo',
            amount: 4520n,
            currency: 'EUR',
            fingerprint: hash(`${RUN}-signo-2`),
          },
        }),
      ),
    ).rejects.toThrow(/signo/)
  })

  it('una huella que ya es de otro asiento no se pisa', async () => {
    await enHogar((client) =>
      persistImport(client, {
        ...entrada('choque', [movimiento('ch-1', -100n), movimiento('ch-2', -200n)]),
        source: 'api',
      }),
    )

    const { entryId, ajena } = await enHogar(async (client) => {
      const { rows } = await client.query<{ id: string; fingerprint: string }>(
        'select id, trim(fingerprint) as fingerprint from entry order by description',
      )
      return { entryId: rows[0]?.id as string, ajena: rows[1]?.fingerprint as string }
    })

    await expect(
      enHogar((client) =>
        updateBookedTransaction(client, {
          entryId,
          accountId: cuenta,
          transaction: {
            bookedOn: '2026-03-14',
            description: 'Compra ch-1',
            amount: -150n,
            currency: 'EUR',
            fingerprint: ajena,
          },
        }),
      ),
    ).rejects.toThrow(/misma identidad/)
  })

  it('no toca un asiento enlazado con una anulación posterior', async () => {
    await enHogar((client) =>
      persistImport(client, {
        ...entrada('anulado', [movimiento('an-1', -100n), movimiento('an-2', -200n)]),
        source: 'api',
      }),
    )

    const entryId = await enHogar(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'select id from entry order by description',
      )
      const primero = rows[0]?.id as string
      await client.query('update entry set reversed_by = $2 where id = $1', [primero, rows[1]?.id])
      return primero
    })

    await expect(
      enHogar((client) =>
        updateBookedTransaction(client, {
          entryId,
          accountId: cuenta,
          transaction: {
            bookedOn: '2026-03-14',
            description: 'Compra an-1',
            amount: -150n,
            currency: 'EUR',
            fingerprint: hash(`${RUN}-an-1-2`),
          },
        }),
      ),
    ).rejects.toThrow(/anulación/)
  })

  it('el hogar de al lado no puede corregir el asiento', async () => {
    await enHogar((client) => persistImport(client, delFeed('vecino', -900n)))
    const antes = await elAsiento()
    const vecino = await nuevoHogar('vecino-feed')

    await expect(
      withTenant(app, vecino.tenantId, (client) =>
        updateBookedTransaction(client, {
          entryId: antes.entryId,
          accountId: vecino.accountId,
          transaction: {
            bookedOn: '2026-03-14',
            description: 'Compra vecino',
            amount: -1000n,
            currency: 'EUR',
            fingerprint: hash(`${RUN}-vecino-2`),
          },
        }),
      ),
    ).rejects.toThrow(/no existe en este hogar/)
  })

  // ── Anular lo que el feed retiró ─────────────────────────────────────────
  //
  // El caso lo trae Plaid: `/transactions/sync` devuelve `removed`, o sea
  // movimientos que el proveedor dice que ya no existen. Borrarlos está
  // descartado —el libro es append-only para lo que ya se enseñó— y no tocarlos
  // es peor, porque la apertura que se recalcula contra el saldo declarado se
  // come la diferencia en silencio. Queda anularlos, que es esto.

  it('la anulación es un espejo exacto: mismas cuentas, importes negados', async () => {
    await enHogar((client) => persistImport(client, delFeed('espejo', -2500n)))
    const antes = await elAsiento()

    const anulacion = await enHogar((client) => reverseEntry(client, { entryId: antes.entryId }))
    expect(anulacion.created).toBe(true)

    const original = await estado(antes.entryId)
    const espejo = await estado(anulacion.reversalId)
    expect(original.map((pata) => pata.amount)).toEqual(['-2500', '2500'])
    // Las mismas cuentas y no la bolsa de sin categorizar: si el gasto estaba
    // atribuido a una categoría, la anulación tiene que descontarlo de ahí.
    expect(espejo.map((pata) => pata.amount)).toEqual(['2500', '-2500'])

    const cuentas = await enHogar(async (client) => {
      const { rows } = await client.query<{ entry_id: string; account_id: string }>(
        'select entry_id, account_id from posting order by entry_id, ordinal',
      )
      return rows
    })
    const deOriginal = cuentas.filter((fila) => fila.entry_id === antes.entryId)
    const deEspejo = cuentas.filter((fila) => fila.entry_id === anulacion.reversalId)
    expect(deEspejo.map((fila) => fila.account_id)).toEqual(
      deOriginal.map((fila) => fila.account_id),
    )

    // El saldo vuelve a cero por suma y no por omisión: los postings del
    // original siguen ahí, y al lado están los del espejo.
    expect(Object.values(await saldos())).toEqual(['0', '0'])
  })

  it('la anulación no lleva huella ni identificador externo', async () => {
    await enHogar((client) => persistImport(client, delFeed('sin-identidad', -100n)))
    const antes = await elAsiento()
    const anulacion = await enHogar((client) => reverseEntry(client, { entryId: antes.entryId }))

    const espejo = await enHogar(async (client) => {
      const { rows } = await client.query<{
        fingerprint: string | null
        external_id: string | null
        booked_on: string
        batch: string | null
      }>(
        `select e.fingerprint, e.external_id, to_char(e.booked_on, 'YYYY-MM-DD') as booked_on,
                e.import_batch_id as batch
           from entry e where e.id = $1`,
        [anulacion.reversalId],
      )
      return rows[0]
    })
    // Con huella, el dedup podría tomarla por el duplicado de una fila del
    // extracto; con identificador externo, el dedup de origen 'api' encontraría
    // dos asientos para el mismo movimiento del proveedor.
    expect(espejo?.fingerprint).toBeNull()
    expect(espejo?.external_id).toBeNull()
    // Va con la fecha del original: un movimiento que el banco dice que nunca
    // ocurrió tiene que desaparecer del mes en el que se contó.
    expect(espejo?.booked_on).toBe('2026-03-14')
    // Y sin lote, para no dejar imposible de deshacer el lote que la trajo.
    expect(espejo?.batch).toBeNull()
  })

  it('anular dos veces no mueve el saldo al doble', async () => {
    await enHogar((client) => persistImport(client, delFeed('idempotente', -700n)))
    const antes = await elAsiento()

    const primera = await enHogar((client) => reverseEntry(client, { entryId: antes.entryId }))
    const segunda = await enHogar((client) => reverseEntry(client, { entryId: antes.entryId }))

    expect(segunda.created).toBe(false)
    expect(segunda.reversalId).toBe(primera.reversalId)
    expect(Object.values(await saldos())).toEqual(['0', '0'])
  })

  it('el lote del asiento anulado ya no se puede deshacer, y se dice por qué', async () => {
    const lote = await enHogar((client) => persistImport(client, delFeed('bloqueado', -400n)))
    const antes = await elAsiento()
    await enHogar((client) => reverseEntry(client, { entryId: antes.entryId }))

    // No es un fallo del diseño: es el diseño. Borrar el original dejaría a su
    // espejo moviendo el saldo solo, en silencio y para siempre.
    await expect(enHogar((client) => revertImport(client, lote.batchId))).rejects.toThrow(
      /asientos de anulación/,
    )
  })

  it('encuentra por identificador del proveedor sólo lo que entró por feed', async () => {
    await enHogar((client) =>
      persistImport(client, {
        ...entrada('busqueda', [
          { ...movimiento('busqueda', -1000n), externalId: 'tx-del-proveedor' },
        ]),
        source: 'api',
      }),
    )
    await enHogar((client) =>
      persistImport(client, {
        ...entrada('de-fichero', [
          { ...movimiento('de-fichero', -2000n), externalId: 'tx-del-proveedor' },
        ]),
      }),
    )

    const encontrados = await enHogar((client) =>
      findFeedEntries(client, cuenta, ['tx-del-proveedor', 'no-existe']),
    )
    // Uno y no dos: un identificador externo sólo significa algo dentro del
    // feed que lo emitió, y el FITID de un OFX puede coincidir por casualidad.
    expect(encontrados).toHaveLength(1)
    expect(encontrados[0]?.amount).toBe(-1000n)
    expect(encontrados[0]?.reversedBy).toBeNull()
  })

  it('el hogar de al lado no puede anular el asiento', async () => {
    await enHogar((client) => persistImport(client, delFeed('vecino-anula', -900n)))
    const antes = await elAsiento()
    const vecino = await nuevoHogar('vecino-anulacion')

    await expect(
      withTenant(app, vecino.tenantId, (client) =>
        reverseEntry(client, { entryId: antes.entryId }),
      ),
    ).rejects.toThrow(/no existe en este hogar/)
  })
})

if (!enabled) {
  describe('importación en un lote reversible', () => {
    it.skip('necesita DATABASE_URL y DATABASE_APP_URL (pnpm db:up)', () => {})
  })
}
