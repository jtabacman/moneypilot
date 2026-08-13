/**
 * El cliente de Plaid contra un `fetch` de mentira.
 *
 * Acá se comprueba lo que un doble sí puede comprobar: que la paginación no se
 * queda a medias, que el signo llega sin tocar, que un importe que en coma
 * flotante se rompe llega entero, y que los errores salen con el contexto de
 * qué se estaba intentando. Lo que sólo puede decir el servidor de verdad
 * —que los caminos existen y que los campos se llaman como creemos— está en
 * `client.sandbox.test.ts`.
 */

import { fromDecimalString, sum, toDecimalString } from '@moneypilot/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buscarInstituciones,
  canjearPublicToken,
  crearLinkToken,
  crearPublicTokenDeSandbox,
  enriquecer,
  forzarReautenticacion,
  sincronizar,
  traerCuentas,
} from './client'
import { necesitaReautenticacion, PlaidError } from './errores'
import { invertirSigno } from './tipos'

// ── Andamiaje ───────────────────────────────────────────────────────────────

interface Llamada {
  readonly url: string
  readonly cuerpo: Record<string, unknown>
  /** El cuerpo sin deserializar, que es donde se ve si un importe se rompió. */
  readonly crudo: string
}

let llamadas: Llamada[] = []

/** Encola respuestas; cada llamada consume la siguiente. */
function responder(...respuestas: Array<{ status?: number; cuerpo: string }>): void {
  let indice = 0
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const crudo = String(init.body)
    llamadas.push({ url, crudo, cuerpo: JSON.parse(crudo) })
    const siguiente = respuestas[Math.min(indice, respuestas.length - 1)]
    indice += 1
    if (siguiente === undefined) throw new Error('sin respuesta preparada')
    return {
      status: siguiente.status ?? 200,
      ok: (siguiente.status ?? 200) < 400,
      text: async () => siguiente.cuerpo,
    }
  })
}

const ENTORNO = {
  PLAID_BASE: 'https://sandbox.plaid.com',
  PLAID_CLIENT_ID: 'cliente-de-prueba',
  PLAID_SECRET: 'secreto-de-prueba',
}

beforeEach(() => {
  llamadas = []
  for (const [clave, valor] of Object.entries(ENTORNO)) process.env[clave] = valor
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const clave of Object.keys(ENTORNO)) delete process.env[clave]
})

/** Un movimiento de `/transactions/sync`, con lo justo para leerlo. */
function movimiento(campos: Record<string, unknown>): string {
  return JSON.stringify({
    account_id: 'cuenta-1',
    transaction_id: 'mov-1',
    amount: 0,
    iso_currency_code: 'EUR',
    date: '2026-08-12',
    name: 'sin nombre',
    pending: false,
    pending_transaction_id: null,
    ...campos,
  })
}

function lote(campos: Record<string, unknown>): string {
  return JSON.stringify({
    accounts: [],
    added: [],
    modified: [],
    removed: [],
    has_more: false,
    next_cursor: 'cursor-final',
    transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE',
    request_id: 'req-1',
    ...campos,
  })
}

// ── Credenciales ────────────────────────────────────────────────────────────

describe('credenciales', () => {
  it('las manda en el cuerpo y nunca en la URL', async () => {
    responder({ cuerpo: '{"accounts":[]}' })
    await traerCuentas('access-sandbox-1')

    const llamada = llamadas[0]
    expect(llamada?.url).toBe('https://sandbox.plaid.com/accounts/get')
    // Un secreto en la query string acaba en el log de cualquier proxy.
    expect(llamada?.url).not.toContain('secreto-de-prueba')
    expect(llamada?.cuerpo).toMatchObject({
      client_id: 'cliente-de-prueba',
      secret: 'secreto-de-prueba',
      access_token: 'access-sandbox-1',
    })
  })

  it('explica qué variable falta en vez de mandar un cuerpo incompleto', async () => {
    delete process.env['PLAID_SECRET']
    responder({ cuerpo: '{}' })
    await expect(traerCuentas('access-sandbox-1')).rejects.toThrow(/PLAID_SECRET/)
    expect(llamadas).toHaveLength(0)
  })
})

// ── El signo, que está al revés ─────────────────────────────────────────────

describe('el signo de Plaid', () => {
  it('un gasto llega positivo y un ingreso negativo, tal cual, sin que el cliente opine', async () => {
    // Es la convención de Plaid y es la contraria a la de un extracto.
    // Verificado contra su sandbox: la compra en Uber viene 5.4, el reembolso
    // de United Airlines viene -500.
    responder({
      cuerpo: lote({
        added: [
          JSON.parse(movimiento({ transaction_id: 'gasto', amount: 101.01, name: 'IBERDROLA' })),
          JSON.parse(movimiento({ transaction_id: 'ingreso', amount: -2500.55, name: 'NOMINA' })),
        ],
      }),
    })

    const { added } = await sincronizar('access-sandbox-1')
    const gasto = added[0]
    const ingreso = added[1]

    // El cliente NO da la vuelta al signo: eso es trabajo del mapeador.
    expect(gasto?.importeSalidaPositiva).toBe('101.01')
    expect(ingreso?.importeSalidaPositiva).toBe('-2500.55')
  })

  it('invertirSigno deja el gasto negativo y el ingreso positivo, como el núcleo', async () => {
    // La otra mitad del mismo asunto: cuando el mapeador le dé la vuelta, un
    // gasto tiene que quedar negativo. Si esto se equivoca, todos los gastos
    // entran como ingresos, el asiento igual balancea a cero y no falla nada.
    expect(invertirSigno('101.01')).toBe('-101.01')
    expect(invertirSigno('-2500.55')).toBe('2500.55')

    const gasto = fromDecimalString(invertirSigno('101.01'), 'EUR')
    const ingreso = fromDecimalString(invertirSigno('-2500.55'), 'EUR')
    expect(toDecimalString(gasto)).toBe('-101.01')
    expect(toDecimalString(ingreso)).toBe('2500.55')
    expect(toDecimalString(sum([gasto, ingreso], 'EUR'))).toBe('2399.54')
  })

  it('no produce el cero negativo, que no es un importe de libro', () => {
    expect(invertirSigno('0')).toBe('0')
    expect(invertirSigno('0.00')).toBe('0.00')
    expect(invertirSigno('-0.00')).toBe('0.00')
  })

  it('se niega a invertir algo que no es un decimal', () => {
    expect(() => invertirSigno('1e5')).toThrow()
    expect(() => invertirSigno('')).toThrow()
  })
})

// ── El importe, que no puede pasar por coma flotante ────────────────────────

describe('exactitud de los importes', () => {
  it('un importe que JSON.parse redondea llega entero', async () => {
    // La prueba de que no es paranoia: catorce dígitos y dos decimales.
    expect(JSON.parse('{"a":99999999999999.99}').a.toFixed(2)).toBe('99999999999999.98')

    responder({
      cuerpo:
        '{"accounts":[],"added":[{"account_id":"c1","transaction_id":"t1",' +
        '"amount":99999999999999.99,"iso_currency_code":"EUR","date":"2026-08-12",' +
        '"name":"IMPORTE FEO","pending":false,"pending_transaction_id":null}],' +
        '"modified":[],"removed":[],"has_more":false,"next_cursor":"c",' +
        '"transactions_update_status":"HISTORICAL_UPDATE_COMPLETE"}',
    })

    const { added } = await sincronizar('access-sandbox-1')
    expect(added[0]?.importeSalidaPositiva).toBe('99999999999999.99')
    // Y el núcleo lo acepta sin perder el céntimo.
    expect(toDecimalString(fromDecimalString('99999999999999.99', 'EUR'))).toBe('99999999999999.99')
  })

  it('el saldo de cuatro decimales del sandbox no se convierte en céntimos con deriva', async () => {
    // 23631.9805 es el saldo del "Plaid 401k" del banco de prueba, tal cual.
    // El truco de siempre —multiplicar por cien— da 2363198.0500000003.
    expect(23631.9805 * 100).not.toBe(2363198.05)

    responder({
      cuerpo:
        '{"accounts":[{"account_id":"c1","name":"Plaid 401k","balances":' +
        '{"current":23631.9805,"available":null,"limit":null,"iso_currency_code":"USD",' +
        '"unofficial_currency_code":null},"type":"investment","subtype":"401k"}]}',
    })

    const [cuenta] = await traerCuentas('access-sandbox-1')
    expect(cuenta?.saldoActual).toBe('23631.9805')
  })

  it('escribe el importe de enrich como literal exacto, sin pasar por number', async () => {
    responder({ cuerpo: '{"enriched_transactions":[]}' })
    await enriquecer(
      [
        {
          id: '1',
          description: 'RECIBO IBERDROLA',
          importe: '99999999999999.99',
          direction: 'OUTFLOW',
          isoCurrencyCode: 'EUR',
          pais: 'ES',
        },
      ],
      'depository',
    )

    // Se mira el texto crudo del cuerpo, no el deserializado: es el único sitio
    // donde se ve que el número salió con todos sus dígitos.
    expect(llamadas[0]?.crudo).toContain('"amount":99999999999999.99')
    expect(llamadas[0]?.crudo).not.toContain('99999999999999.98')
  })
})

// ── Paginación ──────────────────────────────────────────────────────────────

describe('paginación de /transactions/sync', () => {
  it('recorre hasta que has_more sea false y devuelve el cursor final', async () => {
    // Un lote a medias es un informe que cuadra consigo mismo y no con el banco.
    responder(
      {
        cuerpo: lote({
          added: [JSON.parse(movimiento({ transaction_id: 'a' }))],
          has_more: true,
          next_cursor: 'c1',
        }),
      },
      {
        cuerpo: lote({
          added: [JSON.parse(movimiento({ transaction_id: 'b' }))],
          has_more: true,
          next_cursor: 'c2',
        }),
      },
      {
        cuerpo: lote({
          added: [JSON.parse(movimiento({ transaction_id: 'c' }))],
          has_more: false,
          next_cursor: 'c3',
        }),
      },
    )

    const resultado = await sincronizar('access-sandbox-1')
    expect(resultado.added.map((m) => m.transactionId)).toEqual(['a', 'b', 'c'])
    expect(resultado.cursor).toBe('c3')
    expect(resultado.hasMore).toBe(false)
    expect(llamadas).toHaveLength(3)

    // La primera vuelta va sin cursor; las siguientes con el de la anterior.
    expect(llamadas[0]?.cuerpo['cursor']).toBeUndefined()
    expect(llamadas[1]?.cuerpo['cursor']).toBe('c1')
    expect(llamadas[2]?.cuerpo['cursor']).toBe('c2')
  })

  it('acumula modified y removed de todas las vueltas, no sólo de la última', async () => {
    responder(
      {
        cuerpo: lote({
          modified: [JSON.parse(movimiento({ transaction_id: 'm1' }))],
          removed: [{ transaction_id: 'r1', account_id: 'cuenta-1' }],
          has_more: true,
          next_cursor: 'c1',
        }),
      },
      {
        cuerpo: lote({
          modified: [JSON.parse(movimiento({ transaction_id: 'm2' }))],
          removed: [{ transaction_id: 'r2', account_id: null }],
          has_more: false,
          next_cursor: 'c2',
        }),
      },
    )

    const resultado = await sincronizar('access-sandbox-1')
    expect(resultado.modified.map((m) => m.transactionId)).toEqual(['m1', 'm2'])
    expect(resultado.removed).toEqual([
      { transactionId: 'r1', accountId: 'cuenta-1' },
      { transactionId: 'r2', accountId: null },
    ])
  })

  it('manda el cursor que le pasan y no lo pierde', async () => {
    responder({ cuerpo: lote({}) })
    await sincronizar('access-sandbox-1', 'cursor-guardado')
    expect(llamadas[0]?.cuerpo['cursor']).toBe('cursor-guardado')
  })

  it('omite el cursor vacío en vez de mandar un campo en blanco', async () => {
    // Plaid devuelve el cursor vacío mientras el item está NOT_READY, y esa
    // cadena puede acabar guardada. Mandarla de vuelta sería mandar basura;
    // omitirla es una primera sincronización, que es lo correcto.
    responder({ cuerpo: lote({}) })
    await sincronizar('access-sandbox-1', '')
    expect(llamadas[0]?.cuerpo).not.toHaveProperty('cursor')
  })

  it('vuelve a empezar, tirando lo acumulado, si los datos cambian a media paginación', async () => {
    // Plaid corta con este código cuando los datos se mueven por debajo, y pide
    // reiniciar desde el último cursor guardado. Pasa de verdad y a la primera
    // contra su sandbox: un banco recién conectado sigue recibiendo la descarga
    // histórica mientras uno pagina.
    //
    // Lo que hay que comprobar es que la media página NO se cuela en el
    // resultado. Si se colara, el movimiento 'a' saldría dos veces y el informe
    // cuadraría consigo mismo mintiendo sobre el banco.
    responder(
      {
        cuerpo: lote({
          added: [JSON.parse(movimiento({ transaction_id: 'a' }))],
          has_more: true,
          next_cursor: 'c1',
        }),
      },
      {
        status: 400,
        cuerpo: JSON.stringify({
          error_code: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION',
          error_type: 'TRANSACTIONS_ERROR',
          error_message: 'Underlying transaction data changed since last page was fetched.',
        }),
      },
      {
        cuerpo: lote({
          added: [JSON.parse(movimiento({ transaction_id: 'a' }))],
          has_more: true,
          next_cursor: 'c1',
        }),
      },
      {
        cuerpo: lote({
          added: [JSON.parse(movimiento({ transaction_id: 'b' }))],
          has_more: false,
          next_cursor: 'c2',
        }),
      },
    )

    const resultado = await sincronizar('access-sandbox-1', 'cursor-guardado')
    expect(resultado.added.map((m) => m.transactionId)).toEqual(['a', 'b'])
    expect(resultado.cursor).toBe('c2')

    // Y al reiniciar vuelve al cursor con el que se entró, no al de la página
    // donde se cayó: si no, se saltaría todo lo anterior.
    expect(llamadas.map((l) => l.cuerpo['cursor'])).toEqual([
      'cursor-guardado',
      'c1',
      'cursor-guardado',
      'c1',
    ])
  })

  it('se rinde si el reinicio no termina nunca, en vez de girar para siempre', async () => {
    responder({
      status: 400,
      cuerpo: JSON.stringify({
        error_code: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION',
        error_type: 'TRANSACTIONS_ERROR',
        error_message: 'Underlying transaction data changed since last page was fetched.',
      }),
    })
    await expect(sincronizar('access-sandbox-1')).rejects.toThrow(
      /TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION/,
    )
    // Cinco reintentos y el que falla definitivamente.
    expect(llamadas).toHaveLength(6)
  })

  it('corta cuando Plaid pide otra vuelta y devuelve el mismo cursor', async () => {
    // Sería un bucle infinito contra su servidor.
    responder({ cuerpo: lote({ has_more: true, next_cursor: '' }) })
    await expect(sincronizar('access-sandbox-1')).rejects.toThrow(/bucle infinito/)
  })

  it('avisa de que el lote vacío puede ser "todavía no" y no "no hay nada"', async () => {
    // Es la trampa de un banco recién conectado: added vacío, has_more false y
    // ni un error. Sin este campo, quien llama concluye que no hay movimientos.
    responder({
      cuerpo: lote({ transactions_update_status: 'NOT_READY', next_cursor: '' }),
    })
    const resultado = await sincronizar('access-sandbox-1')
    expect(resultado.added).toEqual([])
    expect(resultado.estado).toBe('NOT_READY')
    expect(resultado.cursor).toBe('')
  })
})

// ── Campos del movimiento ───────────────────────────────────────────────────

describe('lectura del movimiento', () => {
  it('deja pasar pending y pending_transaction_id, que es lo que usa el dedup', async () => {
    responder({
      cuerpo: lote({
        added: [
          JSON.parse(movimiento({ transaction_id: 'pendiente', pending: true })),
          JSON.parse(
            movimiento({
              transaction_id: 'asentado',
              pending: false,
              pending_transaction_id: 'pendiente',
            }),
          ),
        ],
      }),
    })

    const { added } = await sincronizar('access-sandbox-1')
    expect(added[0]?.pending).toBe(true)
    expect(added[0]?.pendingTransactionId).toBeNull()
    // El asentado llega con OTRO id y apuntando al pendiente. Sin estos dos
    // campos el dedup vería dos movimientos distintos y duplicaría el gasto.
    expect(added[1]?.pending).toBe(false)
    expect(added[1]?.pendingTransactionId).toBe('pendiente')
  })

  it('descarta media categoría en vez de propagar un hueco', async () => {
    responder({
      cuerpo: lote({
        added: [
          JSON.parse(
            movimiento({
              transaction_id: 'entera',
              personal_finance_category: {
                primary: 'TRANSPORTATION',
                detailed: 'TRANSPORTATION_TAXIS_AND_RIDE_SHARES',
                confidence_level: 'LOW',
              },
            }),
          ),
          JSON.parse(
            movimiento({ transaction_id: 'media', personal_finance_category: { primary: 'X' } }),
          ),
        ],
      }),
    })

    const { added } = await sincronizar('access-sandbox-1')
    expect(added[0]?.categoriaPersonal).toEqual({
      primary: 'TRANSPORTATION',
      detailed: 'TRANSPORTATION_TAXIS_AND_RIDE_SHARES',
      confidenceLevel: 'LOW',
    })
    expect(added[1]?.categoriaPersonal).toBeNull()
  })

  it('guarda en crudo todo lo que no cabe en un campo tipado', async () => {
    responder({
      cuerpo: lote({
        added: [JSON.parse(movimiento({ transaction_id: 't', category_id: '22016000' }))],
      }),
    })
    const { added } = await sincronizar('access-sandbox-1')
    expect(added[0]?.crudo['category_id']).toBe('22016000')
    expect(added[0]?.crudo['transaction_id']).toBe('t')
  })
})

// ── Errores ─────────────────────────────────────────────────────────────────

describe('errores', () => {
  it('envuelve el error de Plaid diciendo qué se intentaba, con su código', async () => {
    responder({
      status: 400,
      cuerpo: JSON.stringify({
        display_message: null,
        error_code: 'INVALID_ACCESS_TOKEN',
        error_message: 'provided access token is in an invalid format',
        error_type: 'INVALID_INPUT',
        request_id: 'req-abc',
        suggested_action: null,
      }),
    })

    const error = await traerCuentas('basura').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PlaidError)
    const plaid = error as PlaidError
    expect(plaid.message).toContain('no se pudo traer las cuentas')
    expect(plaid.message).toContain('HTTP 400')
    expect(plaid.message).toContain('provided access token is in an invalid format')
    expect(plaid.message).toContain('[INVALID_INPUT/INVALID_ACCESS_TOKEN]')
    expect(plaid.errorCode).toBe('INVALID_ACCESS_TOKEN')
    expect(plaid.requestId).toBe('req-abc')
  })

  it('prefiere display_message, que es el único escrito para la persona', async () => {
    responder({
      status: 400,
      cuerpo: JSON.stringify({
        display_message: 'Tu banco pide que vuelvas a iniciar sesión.',
        error_message: 'the login details of this item have changed',
        error_code: 'ITEM_LOGIN_REQUIRED',
        error_type: 'ITEM_ERROR',
        suggested_action: 'Guide the user through Link update mode.',
      }),
    })

    const error = await sincronizar('access-sandbox-1').catch((e: unknown) => e)
    expect((error as PlaidError).message).toContain('Tu banco pide que vuelvas a iniciar sesión.')
    expect((error as PlaidError).message).toContain('Guide the user through Link update mode.')
    // Es el caso que hay que distinguir: no se arregla reintentando.
    expect(necesitaReautenticacion(error)).toBe(true)
  })

  it('dice qué vuelta de la paginación falló', async () => {
    responder(
      { cuerpo: lote({ has_more: true, next_cursor: 'c1' }) },
      { status: 500, cuerpo: '<html>502 Bad Gateway</html>' },
    )
    const error = await sincronizar('access-sandbox-1').catch((e: unknown) => e)
    expect((error as PlaidError).message).toContain('vuelta 2')
  })

  it('distingue un corte por timeout de un servidor inalcanzable', async () => {
    vi.stubGlobal('fetch', async () => {
      const error = new Error('The operation was aborted due to timeout')
      error.name = 'TimeoutError'
      throw error
    })
    const error = await traerCuentas('access-sandbox-1', { timeoutMs: 5_000 }).catch(
      (e: unknown) => e,
    )
    expect((error as PlaidError).message).toContain('no contestó en 5 s')
    expect(necesitaReautenticacion(error)).toBe(false)
  })

  it('no se cree una respuesta que no es JSON', async () => {
    responder({ cuerpo: '<html>no soy JSON</html>' })
    await expect(traerCuentas('access-sandbox-1')).rejects.toThrow(PlaidError)
  })
})

// ── Link ────────────────────────────────────────────────────────────────────

describe('link token', () => {
  it('pide transactions para España y Estados Unidos', async () => {
    responder({
      cuerpo:
        '{"link_token":"link-sandbox-1","expiration":"2026-08-14T01:33:50Z","request_id":"r"}',
    })
    const token = await crearLinkToken('hogar-1', ['ES', 'US'])
    expect(token).toEqual({ linkToken: 'link-sandbox-1', expiration: '2026-08-14T01:33:50Z' })
    expect(llamadas[0]?.cuerpo).toMatchObject({
      user: { client_user_id: 'hogar-1' },
      country_codes: ['ES', 'US'],
      products: ['transactions'],
      language: 'es',
    })
  })

  it('en modo actualización manda el access_token y NO products', async () => {
    // Plaid rechaza el cuerpo si se mandan los dos: el item ya tiene productos.
    responder({ cuerpo: '{"link_token":"link-sandbox-2","expiration":"2026-08-14T01:33:50Z"}' })
    await crearLinkToken('hogar-1', ['ES'], { accessToken: 'access-sandbox-1' })
    expect(llamadas[0]?.cuerpo).toHaveProperty('access_token', 'access-sandbox-1')
    expect(llamadas[0]?.cuerpo).not.toHaveProperty('products')
  })

  it('se niega a pedir un token sin países en vez de dejar que falle Plaid', async () => {
    responder({ cuerpo: '{}' })
    await expect(crearLinkToken('hogar-1', [])).rejects.toThrow(/al menos un país/)
    expect(llamadas).toHaveLength(0)
  })

  it('canjea el public token por el access token y el item', async () => {
    responder({
      cuerpo: '{"access_token":"access-sandbox-9","item_id":"item-9","request_id":"r"}',
    })
    await expect(canjearPublicToken('public-sandbox-9')).resolves.toEqual({
      accessToken: 'access-sandbox-9',
      itemId: 'item-9',
    })
  })
})

// ── Catálogo ────────────────────────────────────────────────────────────────

describe('catálogo', () => {
  it('busca filtrando por el producto que necesitamos', async () => {
    responder({
      cuerpo: JSON.stringify({
        institutions: [
          {
            institution_id: 'ins_68',
            name: 'BBVA - Banca Personal',
            country_codes: ['ES'],
            products: ['auth', 'transactions'],
            oauth: true,
          },
        ],
      }),
    })

    const bancos = await buscarInstituciones('BBVA', ['ES'])
    expect(bancos[0]).toEqual({
      institutionId: 'ins_68',
      nombre: 'BBVA - Banca Personal',
      paises: ['ES'],
      productos: ['auth', 'transactions'],
      oauth: true,
    })
    // Un banco que expone la cuenta y no los movimientos no nos sirve, y eso
    // no se ve hasta que ya conectaste.
    expect(llamadas[0]?.cuerpo['products']).toEqual(['transactions'])
  })
})

// ── Las de sandbox, que no pueden correr contra producción ──────────────────

describe('operaciones de sandbox', () => {
  it('se niegan a salir a la red si PLAID_BASE no es el sandbox', async () => {
    process.env['PLAID_BASE'] = 'https://production.plaid.com'
    responder({ cuerpo: '{}' })

    // reset_login contra una conexión real la tumba y obliga a la familia a
    // reconectar el banco. No es una comprobación teórica.
    await expect(forzarReautenticacion('access-production-1')).rejects.toThrow(
      /sólo existe en el sandbox/,
    )
    await expect(crearPublicTokenDeSandbox('ins_68', ['transactions'])).rejects.toThrow(
      /sólo existe en el sandbox/,
    )
    expect(llamadas).toHaveLength(0)
  })

  it('no confunden un host que sólo contiene la palabra sandbox', async () => {
    process.env['PLAID_BASE'] = 'https://production.plaid.com/sandbox'
    responder({ cuerpo: '{}' })
    await expect(forzarReautenticacion('access-production-1')).rejects.toThrow(
      /sólo existe en el sandbox/,
    )
  })

  it('mandan el usuario a medida como JSON dentro del campo de texto', async () => {
    responder({ cuerpo: '{"public_token":"public-sandbox-1","request_id":"r"}' })
    await crearPublicTokenDeSandbox('ins_109508', ['transactions'], {
      usuarioAMedida: { override_accounts: [{ type: 'depository', currency: 'EUR' }] },
    })

    const opciones = llamadas[0]?.cuerpo['options'] as Record<string, string>
    expect(opciones['override_username']).toBe('user_custom')
    expect(JSON.parse(opciones['override_password'] as string)).toEqual({
      override_accounts: [{ type: 'depository', currency: 'EUR' }],
    })
  })
})

describe('el histórico que se pide', () => {
  it('pide 730 días aunque nadie lo diga, porque después no se puede ampliar', async () => {
    // Plaid pide 90 si no se dice nada, y el histórico de un Item no se puede
    // ensanchar sin borrarlo y hacer que el cliente vuelva a autenticarse en su
    // banco. Este test existe para que quitar el defecto rompa algo: el
    // parámetro estuvo cableado y sin usar, y así conectaríamos con 90.
    responder({
      cuerpo: JSON.stringify({
        added: [],
        modified: [],
        removed: [],
        next_cursor: 'c',
        has_more: false,
      }),
    })

    await sincronizar('access-sandbox-x')

    const opciones = llamadas[0]?.cuerpo['options'] as { days_requested?: number } | undefined
    expect(opciones?.days_requested).toBe(730)
  })
})
