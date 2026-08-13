/**
 * /reglas/nueva — proponer una regla y ver qué haría antes de hacerla.
 *
 * Se llega de tres sitios y los tres importan: desde la lista de lo que falta
 * por categorizar (`?texto=NETFLIX&ejemplo=...`), desde un movimiento concreto
 * del registro (`?texto=...`), y a mano. Por eso el descriptor llega por query
 * string y la vista previa se calcula sola en cuanto hay texto: quien viene de
 * ver «342 movimientos sin categorizar de este comercio» no tiene que volver a
 * escribir nada para saber si la regla los agarra.
 */

import Link from 'next/link'
import { readHousehold } from '@/lib/data'
import { PageBar } from '../../ui'
import { camposDeQuery, type QueryParams } from '../criterios'
import { Editor, prepararEditor } from '../editor'
import { AvisoDeRol } from '../piezas'

export const dynamic = 'force-dynamic'

export default async function NuevaReglaPage({
  searchParams,
}: {
  searchParams: Promise<QueryParams>
}) {
  const params = await searchParams
  const { session, data } = await readHousehold((client, sesion) =>
    prepararEditor(client, sesion, params, null),
  )

  const ejemploBruto = camposDeQuery(params).uno('ejemplo')
  const ejemplo = ejemploBruto === null || ejemploBruto === '' ? null : ejemploBruto

  return (
    <>
      <PageBar
        title="Nueva regla"
        blurb="Mirá a cuántos movimientos alcanza antes de aplicarla."
        tools={
          <Link className="btn" href="/reglas">
            Volver a las reglas
          </Link>
        }
      />

      <div className="page">
        <AvisoDeRol role={session.role} />

        <Editor datos={data} reglaId={null} ejemplo={ejemplo} />

        <div className="panel">
          <div className="notes">
            <h3>Qué hace una regla</h3>
            <ul>
              <li>
                Mira la descripción de cada movimiento —la que escribe el banco— y, si coincide, lo
                manda a una categoría y le pone las dimensiones que digas. El importe, la fecha y la
                cuenta no se tocan nunca: lo único que cambia es la contrapartida, así que el
                asiento sigue cuadrando.
              </li>
              <li>
                Se aplica <b>sola</b> a cada importación nueva mientras esté activa. Sobre lo que ya
                está registrado se aplica solamente cuando pulsás «Guardar y aplicar», y siempre
                después de enseñarte a cuántos alcanza.
              </li>
              <li>
                Si dos reglas alcanzan al mismo movimiento gana la de mayor prioridad, y a igualdad
                la más vieja. Un movimiento lo clasifica una sola regla.
              </li>
              <li>
                Los traspasos entre tus cuentas y los tickets repartidos entre varias categorías
                quedan fuera: los primeros no tienen categoría que cambiar y aplastar los segundos
                destruiría el reparto. La vista previa los cuenta aparte.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </>
  )
}
