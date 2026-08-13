'use server'

/**
 * La decisión sobre una fila de la cola de revisión.
 *
 * ── Qué quieren decir «aceptado» y «rechazado» ─────────────────────────────
 *
 * Los dos estados hablan del MOVIMIENTO, no de la sospecha del motor. Aceptado
 * es «esto vale, que cuente»; rechazado es «esto no va al libro». Leerlo al
 * revés —aceptar la sospecha— invertiría el sentido de los dos botones, así
 * que queda escrito acá y los rótulos de la pantalla dicen lo mismo con
 * palabras en vez de con «aceptar» a secas.
 *
 *  · **Posible duplicado.** La transacción NO está en el libro: la importación
 *    la dejó fuera a propósito y la guardó entera en la evidencia (decisión 2
 *    de la cabecera de packages/db/src/repo/import.ts). Entonces:
 *      – «Es duplicado» → rechazado, y no entra nada. La fila se queda con su
 *        evidencia, que pasa a ser lo único que sobrevive de aquella línea del
 *        extracto.
 *      – «No es duplicado» → hay que **materializarla**: crear el asiento con
 *        sus dos patas a partir de la transacción guardada y recién entonces
 *        marcar la fila aceptada, apuntándola a su asiento nuevo.
 *
 *  · **Transferencia sin par**, **sin categorizar**, y en general toda fila que
 *    ya apunta a un asiento: el movimiento YA está en el libro y sigue contando
 *    igual que antes. Resolver es registrar la decisión —quién y cuándo— y
 *    sacar la fila de pendientes. Lo que la decisión todavía no hace se dice en
 *    el mensaje de vuelta en vez de dejar que se suponga.
 *
 * Lo que decide si hay que asentar algo no es el tipo sino **si hay una
 * transacción esperando en la evidencia**, y es a propósito: el día que el
 * importador mande a la cola una transferencia sugerida sin asentarla,
 * aceptarla tiene que meterla al libro y no perderla en silencio.
 *
 * ── Nada a medias ──────────────────────────────────────────────────────────
 *
 * Todo corre dentro de la transacción que abre `writeHousehold`. Lo que puede
 * fallar por datos —falta la cuenta, la moneda no coincide, la huella ya está
 * en el libro— se comprueba ANTES de escribir y se devuelve como mensaje. Lo
 * que se detecta después de escribir se lanza, y entonces Postgres revierte la
 * transacción entera: no existe el estado «media fila aceptada con medio
 * asiento dentro».
 */

import { bookTransaction, type PersistableTransaction, type TenantClient } from '@moneypilot/db'
import { revalidatePath } from 'next/cache'
import { writeHousehold } from '@/lib/data'
import { formatDate, money } from '@/lib/format'
import { type EstadoDecision, falla, hecho, motivoSinPermiso, puedeResolver } from './decision'
import { leerTransaccionEnEspera } from './kinds'

const UUID_FORMA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Aceptar o rechazar una fila de la cola.
 *
 * Los dos botones comparten esta acción y se distinguen por el `value` del que
 * se pulsó: el resultado vuelve pegado a la fila que lo provocó y no en una
 * franja arriba del todo, donde no se sabría a cuál de las veinte se refiere.
 */
export async function resolverItem(
  _previo: EstadoDecision,
  form: FormData,
): Promise<EstadoDecision> {
  const id = campo(form, 'id')
  const decision = campo(form, 'decision')

  if (!UUID_FORMA.test(id)) return falla('No llegó qué ítem de la cola resolver.')
  if (decision !== 'aceptar' && decision !== 'rechazar') {
    return falla(`No se entiende la decisión ${JSON.stringify(decision)}.`)
  }

  let resultado: EstadoDecision
  try {
    resultado = await writeHousehold(async (client, session) => {
      // Una server action es un endpoint público como cualquier otro: que el
      // botón se le pinte apagado a un rol no impide que le llegue la petición.
      if (!puedeResolver(session.role)) return falla(motivoSinPermiso(session.role))
      return decidir(client, {
        id,
        decision,
        // Sin autor, la auditoría contesta «se resolvió» pero no «quién», que
        // es la mitad de la pregunta que B6 obliga a poder responder.
        autor: session.user.email ?? session.user.id,
      })
    })
  } catch (error) {
    // Todo lo que llega acá revirtió la transacción entera, así que el libro
    // quedó como estaba. Lo único que hay que hacer es contarlo.
    return falla(error instanceof Error ? error.message : 'No se pudo registrar la decisión.')
  }

  // Una fila resuelta cambia el contador de pendientes de /hoy y de /cierre, y
  // si además se asentó, los saldos y todos los informes. Revalidar sólo esta
  // pantalla dejaría al resto contando una cola que ya no existe.
  if (resultado.status === 'ok') revalidatePath('/', 'layout')
  return resultado
}

/* ── La fila y su estado ─────────────────────────────────────────────────── */

interface FilaCola {
  readonly id: string
  readonly kind: string
  readonly state: string
  readonly entry_id: string | null
  readonly evidence: Record<string, unknown> | null
  readonly import_batch_id: string | null
  readonly resolved_on: string | null
  readonly resolved_by: string | null
  /** De su lote: contra qué cuenta iba el extracto del que salió la fila. */
  readonly cuenta_id: string | null
  readonly cuenta: string | null
  readonly formato: string | null
  readonly estado_lote: string | null
}

/**
 * Lee la fila y la deja bloqueada hasta el final de la transacción.
 *
 * El `for update` no es decorativo: sin él, dos clicks casi simultáneos en «no
 * es duplicado» leen los dos «pendiente», los dos materializan y el movimiento
 * entra dos veces. Con el candado, el segundo espera y encuentra la fila ya
 * resuelta. Se bloquea sólo `review_item` —de ahí el `of r`—: el lote y la
 * cuenta se leen de contexto y bloquearlos serviría para frenar importaciones
 * ajenas y para nada más.
 */
async function leerFila(client: TenantClient, id: string): Promise<FilaCola | null> {
  const { rows } = await client.query<FilaCola>(
    `select r.id,
            r.kind::text  as kind,
            r.state::text as state,
            r.entry_id,
            r.evidence,
            r.import_batch_id,
            to_char(r.resolved_at at time zone 'UTC', 'YYYY-MM-DD') as resolved_on,
            r.resolved_by,
            b.account_id   as cuenta_id,
            a.name         as cuenta,
            b.format       as formato,
            b.status::text as estado_lote
       from review_item r
       left join import_batch b on b.id = r.import_batch_id
       left join account a      on a.id = b.account_id
      where r.id = $1::uuid
        for update of r`,
    [id],
  )
  return rows[0] ?? null
}

async function decidir(
  client: TenantClient,
  opts: { id: string; decision: 'aceptar' | 'rechazar'; autor: string },
): Promise<EstadoDecision> {
  const fila = await leerFila(client, opts.id)
  if (fila === null) {
    // Con RLS, la fila de otro hogar es indistinguible de una que no existe, y
    // así tiene que ser: la respuesta no puede confirmar que existe.
    return falla('Ese ítem de revisión no existe en este hogar.')
  }
  if (fila.state !== 'pendiente') return falla(yaResuelta(fila))

  const espera = leerTransaccionEnEspera(fila.evidence ?? {}, fila.entry_id)

  if (opts.decision === 'rechazar') {
    await marcar(client, { id: fila.id, state: 'rechazado', autor: opts.autor, entryId: null })
    if (espera.tipo === 'ya-asentada') {
      // El caso incómodo, dicho entero. Callarlo dejaría a alguien creyendo que
      // acaba de sacar del libro un movimiento que sigue sumando en los saldos.
      return hecho(
        'Marcado como rechazado, con una salvedad que conviene leer: este movimiento YA está en ' +
          'el libro y sigue contando. Descartar el aviso no lo saca — sacarlo sería anular el ' +
          'asiento con otro que lo revierta, y eso todavía no está construido.',
      )
    }
    return hecho(
      'Descartado: el movimiento no entra al libro. La fila se queda a la vista con su ' +
        'evidencia, porque una decisión que no se puede releer no se puede discutir.',
    )
  }

  if (espera.tipo === 'lista') return materializar(client, fila, espera.transaccion, opts.autor)
  if (espera.tipo === 'rota') {
    return falla(
      `La transacción que esperaba en la evidencia no se puede leer: ${espera.motivo}. No se ` +
        'escribió nada. Mirá la evidencia en crudo de la fila antes de decidir.',
    )
  }

  await marcar(client, { id: fila.id, state: 'aceptado', autor: opts.autor, entryId: null })
  return hecho(aceptacionSinAsiento(fila.kind, espera.tipo))
}

function yaResuelta(fila: FilaCola): string {
  const cuando = fila.resolved_on === null ? '' : ` el ${formatDate(fila.resolved_on, 'long')}`
  const quien = fila.resolved_by === null ? '' : ` por ${fila.resolved_by}`
  return (
    `Esta fila ya se resolvió como «${fila.state}»${cuando}${quien}, así que no se tocó nada. ` +
    'Una decisión de la cola no se toma dos veces: si hoy la verías distinta, lo que corresponde ' +
    'es corregir el movimiento, no reescribir la decisión vieja.'
  )
}

function aceptacionSinAsiento(kind: string, tipo: 'ya-asentada' | 'sin-transaccion'): string {
  if (tipo === 'sin-transaccion') {
    return (
      'Aceptado. La fila no traía ninguna transacción esperando ni apunta a un asiento, así que ' +
      'no había nada que asentar: lo que queda registrado es la decisión, con quién y cuándo.'
    )
  }
  if (kind === 'transferencia_sugerida') {
    return (
      'Aceptado: los dos movimientos son el mismo traspaso, y queda registrado quién lo dijo y ' +
      'cuándo. Lo que esta decisión todavía NO hace es marcar sus patas como traspaso, así que ' +
      'por ahora siguen contando como gasto y como ingreso en los informes.'
    )
  }
  if (kind === 'sin_categorizar') {
    return (
      'Aceptado: el movimiento se queda en el libro tal como está y la fila sale de pendientes. ' +
      'Ojo, esto no le pone categoría — sigue en la bolsa de sin categorizar hasta que se la des.'
    )
  }
  return (
    'Aceptado: el movimiento ya estaba en el libro, así que no había nada que asentar. Queda ' +
    'registrado quién lo dio por bueno y cuándo.'
  )
}

/* ── Materializar ────────────────────────────────────────────────────────── */

/**
 * Crea el asiento de una transacción que estaba esperando fuera del libro.
 *
 * El orden importa y no es casual: primero lo que puede fallar por datos —y que
 * se contesta con un mensaje sin haber escrito nada—, después el asiento, y
 * recién al final la marca en la cola. Si algo revienta en medio, la
 * transacción entera se va para atrás.
 */
async function materializar(
  client: TenantClient,
  fila: FilaCola,
  transaccion: PersistableTransaction,
  autor: string,
): Promise<EstadoDecision> {
  if (fila.cuenta_id === null) {
    return falla(
      'No se sabe contra qué cuenta asentar este movimiento: la fila no vino de una importación, ' +
        'o el lote que la trajo se quedó sin cuenta asociada. La transacción sigue entera en la ' +
        'evidencia, así que no se pierde.',
    )
  }
  if (fila.estado_lote === 'reverted') {
    return falla(
      'El lote que trajo esta fila se deshizo. Asentar ahora el movimiento contradiría aquel ' +
        'deshacer: si lo querés dentro, volvé a importar el fichero.',
    )
  }

  // La huella es la garantía de idempotencia del libro. Chocar contra su índice
  // único abortaría la transacción con un error de Postgres que no le dice nada
  // a nadie; comprobarla antes convierte eso en la respuesta correcta, que es
  // «esto ya está dentro, entonces sí era un duplicado».
  const { rows } = await client.query<{ booked_on: string; description: string }>(
    `select to_char(booked_on, 'YYYY-MM-DD') as booked_on, description
       from entry where fingerprint = $1 limit 1`,
    [transaccion.fingerprint.toLowerCase()],
  )
  const gemelo = rows[0]
  if (gemelo !== undefined) {
    return falla(
      `El libro ya tiene un asiento con esta misma huella («${gemelo.description}», ` +
        `${formatDate(gemelo.booked_on, 'long')}): este movimiento ya está dentro. Si es el ` +
        'mismo, la respuesta es «Es duplicado».',
    )
  }

  const entryId = await bookTransaction(client, {
    accountId: fila.cuenta_id,
    // El asiento nace del mismo lote que trajo la fila, así que deshacer aquella
    // importación se lo sigue llevando.
    batchId: fila.import_batch_id,
    transaction: transaccion,
    source: (fila.formato ?? '').trim().toLowerCase() === 'pdf' ? 'pdf' : 'file',
  })

  await verificarBalance(client, entryId)
  await marcar(client, { id: fila.id, state: 'aceptado', autor, entryId })

  return hecho(
    `Asentado: «${transaccion.description}», ${money(transaccion.amount, transaccion.currency)} ` +
      `el ${formatDate(transaccion.bookedOn, 'long')} en ${fila.cuenta ?? 'la cuenta del extracto'}. ` +
      'La contrapartida entra sin categorizar hasta que le pongas una categoría.',
  )
}

/**
 * El asiento que se acaba de escribir suma cero dentro de cada moneda.
 *
 * `bookTransaction` lo garantiza por construcción —la contrapartida se calcula
 * negando el importe—, y aun así se comprueba: éste es el único camino por el
 * que un asiento nace de un JSON guardado hace semanas en vez de un parser, y
 * el día que ese blob traiga algo raro es preferible que el asiento no exista a
 * que exista descuadrado. Es una consulta de dos filas sobre una operación que
 * el usuario hace de a una, no una pasada masiva.
 */
async function verificarBalance(client: TenantClient, entryId: string): Promise<void> {
  const { rows } = await client.query<{ currency: string; total: string }>(
    `select trim(currency) as currency, sum(amount)::text as total
       from posting where entry_id = $1::uuid group by currency`,
    [entryId],
  )
  const descuadre = rows.filter((row) => BigInt(row.total) !== 0n)
  if (descuadre.length === 0) return

  // Lanzar y no devolver: el asiento YA está escrito, así que la única forma de
  // no dejarlo dentro es que se caiga la transacción.
  throw new Error(
    'El asiento no habría balanceado a cero ' +
      `(${descuadre.map((row) => `${row.total} en ${row.currency}`).join(', ')}), ` +
      'así que no se guardó nada.',
  )
}

async function marcar(
  client: TenantClient,
  opts: {
    id: string
    state: 'aceptado' | 'rechazado'
    autor: string
    /** El asiento recién creado, cuando la fila no tenía ninguno. */
    entryId: string | null
  },
): Promise<void> {
  const result = await client.query(
    `update review_item
        set state = $2::review_state,
            resolved_at = now(),
            resolved_by = $3,
            entry_id = coalesce($4::uuid, entry_id)
      where id = $1::uuid and state = 'pendiente'`,
    [opts.id, opts.state, opts.autor, opts.entryId],
  )
  if (result.rowCount === 1) return

  // Con el candado de `leerFila` esto no debería pasar nunca. Si pasa, lanzar
  // revierte también el asiento que se acabe de escribir, que es lo que evita
  // que una carrera deje un movimiento duplicado en el libro.
  throw new Error('Otra sesión resolvió esta fila mientras decidías; no se guardó nada.')
}

function campo(form: FormData, nombre: string): string {
  const valor = form.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}
