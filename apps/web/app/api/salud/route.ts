/**
 * Chequeo de salud: ¿puede esta función hablar con la base?
 *
 * Existe porque el build y la ejecución son dos entornos distintos. Que las
 * migraciones se apliquen durante el build no demuestra que una función
 * serverless pueda abrir una conexión TLS verificada contra el pooler, ni que
 * el rol sin privilegios y la función de alta estén donde deben. Sin esto, la
 * primera vez que alguien lo comprueba es registrándose.
 *
 * No devuelve ningún dato: sólo si cada pieza está o no. Cualquiera puede
 * llamarla, así que no puede contar nada que no sea "funciona / no funciona".
 */

import { createPool } from '@moneypilot/db'
import { NextResponse } from 'next/server'
import { databaseUrl, hasDatabase, hasSupabaseAuth } from '../../../lib/env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Health {
  readonly auth: boolean
  readonly baseConfigurada: boolean
  readonly conecta: boolean
  readonly migraciones: number | null
  readonly rolDeAplicacion: boolean
  readonly altaDeHogar: boolean
  /**
   * Cuánto tarda un viaje de ida y vuelta a la base, en milisegundos.
   *
   * No es un adorno de observabilidad: es el número que decide si una pantalla
   * lenta lo es por una consulta cara o por la distancia entre la función y la
   * base. Cada página hace entre 7 y 15 viajes en serie, así que este número
   * multiplicado por quince es el suelo de lo que puede tardar la más pesada —
   * y la única forma de bajarlo es acercarlas o hacer menos viajes.
   *
   * Se mide con `select 1` sobre una conexión ya abierta, así que no incluye el
   * handshake: es la latencia de una consulta, no la de conectarse.
   */
  readonly idaYVueltaMs: number | null
  /** Abrir la conexión: TCP más TLS. Se paga una vez por conexión nueva. */
  readonly conectarMs: number | null
  readonly error: string | null
}

export async function GET(): Promise<NextResponse<Health>> {
  const base: Health = {
    auth: hasSupabaseAuth(),
    baseConfigurada: hasDatabase(),
    conecta: false,
    migraciones: null,
    rolDeAplicacion: false,
    altaDeHogar: false,
    idaYVueltaMs: null,
    conectarMs: null,
    error: null,
  }

  if (!base.baseConfigurada) return NextResponse.json(base, { status: 503 })

  // Pool propio y efímero: `withHousehold` exige un hogar, y acá no hay
  // ninguno del que hablar. Es de los poquísimos usos legítimos fuera de
  // alcance, junto con el alta.
  const pool = createPool({ connectionString: databaseUrl(), max: 1 })

  try {
    // Primero la conexión sola, para separar el coste de abrirla del de
    // preguntar. La segunda medición ya va sobre una conexión caliente.
    const t0 = Date.now()
    const cliente = await pool.connect()
    const conectarMs = Date.now() - t0

    const t1 = Date.now()
    await cliente.query('select 1')
    const idaYVueltaMs = Date.now() - t1
    cliente.release()

    const { rows } = await pool.query<{
      migraciones: string
      rol: boolean
      alta: boolean
    }>(
      `select (select count(*) from _migration)                             as migraciones,
              (select exists (select 1 from pg_roles
                               where rolname = 'moneypilot_app'))           as rol,
              (to_regprocedure('provision_household(uuid,text,text,char)')
                 is not null)                                               as alta`,
    )

    const row = rows[0]
    if (row === undefined) throw new Error('La consulta no devolvió filas.')

    const migraciones = Number.parseInt(row.migraciones, 10)
    const health: Health = {
      ...base,
      conecta: true,
      migraciones,
      rolDeAplicacion: row.rol,
      altaDeHogar: row.alta,
      idaYVueltaMs,
      conectarMs,
    }
    const sano = migraciones > 0 && row.rol && row.alta
    return NextResponse.json(health, { status: sano ? 200 : 503 })
  } catch (error) {
    // El mensaje de un fallo de conexión no lleva credenciales, pero sí puede
    // llevar el host. Se recorta a la clase de error y ya.
    const raw = error instanceof Error ? error.message : String(error)
    const message = raw.length > 120 ? `${raw.slice(0, 120)}…` : raw
    return NextResponse.json({ ...base, error: message }, { status: 503 })
  } finally {
    await pool.end()
  }
}
