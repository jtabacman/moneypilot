/**
 * /reglas/[id] — una regla, su impacto de hoy y qué hacer con ella.
 *
 * Es la misma pantalla que /reglas/nueva con la regla guardada como punto de
 * partida. Abrirla ya calcula el impacto: la pregunta que trae a alguien acá es
 * «¿a qué está alcanzando esto ahora?», y contestarla exige pulsar un botón en
 * casi todos los productos que hacen esto.
 */

import { listRules, type RuleRow } from '@moneypilot/db'
import Link from 'next/link'
import { readHousehold } from '@/lib/data'
import { formatDate } from '@/lib/format'
import { Empty, PageBar } from '../../ui'
import type { QueryParams } from '../criterios'
import { Editor, prepararEditor } from '../editor'
import { BorrarRegla } from '../form'
import { AvisoDeRol } from '../piezas'

export const dynamic = 'force-dynamic'

export default async function ReglaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<QueryParams>
}) {
  const { id } = await params
  const query = await searchParams

  const { session, data } = await readHousehold(async (client, sesion) => {
    // Se piden todas y se busca la nuestra: son decenas, y el repositorio no
    // expone una lectura por id. Bajo RLS, una regla de otro hogar
    // sencillamente no está en la lista, que es como tiene que ser.
    const reglas = await listRules(client)
    const regla = reglas.find((candidata) => candidata.id === id) ?? null
    if (regla === null) return { regla: null, editor: null }
    return { regla, editor: await prepararEditor(client, sesion, query, regla) }
  })

  if (data.regla === null || data.editor === null) {
    return (
      <>
        <PageBar title="Esa regla ya no está" />
        <div className="page">
          <div className="panel">
            <Empty
              title="No encontramos esta regla"
              action={
                <Link className="btn primary" href="/reglas">
                  Volver a las reglas
                </Link>
              }
            >
              O se borró, o el enlace es de otro hogar. Lo que la regla hubiera clasificado sigue
              como estaba: borrar una regla nunca descategoriza nada.
            </Empty>
          </div>
        </div>
      </>
    )
  }

  const { regla, editor } = data

  return (
    <>
      <PageBar
        title={regla.name}
        blurb="Cambiá lo que quieras, mirá el impacto y recién entonces aplicá."
        tools={
          <>
            {regla.enabled ? (
              <span className="status ok">activa</span>
            ) : (
              <span className="status none">parada</span>
            )}
            <Link className="btn" href="/reglas">
              Volver a las reglas
            </Link>
          </>
        }
      />

      <div className="page">
        <AvisoDeRol role={session.role} />

        {editor.rangoIlegible && (
          <div className="banner">
            <b>El rango de importe de esta regla no se puede escribir en este formulario.</b> Está
            guardado con un mínimo y un máximo que cruzan el cero —alcanza cargos y abonos a la vez—
            y acá el importe se dice como «sólo cargos» o «sólo abonos». La regla sigue funcionando
            tal como está, pero si guardás desde esta pantalla el rango se reemplaza por lo que diga
            el formulario.
          </div>
        )}

        <Editor datos={editor} reglaId={regla.id} ejemplo={null} />

        <div className="panel">
          <div className="panel-head">
            <h2>La regla en el hogar</h2>
            <small>Quién la puso y desde cuándo</small>
          </div>
          <div className="panel-body">
            <Historia regla={regla} />
          </div>
          <BorrarRegla reglaId={regla.id} />
        </div>
      </div>
    </>
  )
}

/**
 * Cuándo se creó y cuándo se tocó por última vez.
 *
 * Las dos fechas salen de un instante ISO y se enseñan como día: la hora exacta
 * de una regla no le importa a nadie, y el día se lee con el mismo formato que
 * el resto del producto. Se corta el string en vez de construir un `Date`,
 * igual que en toda la aplicación.
 */
function Historia({ regla }: { regla: RuleRow }) {
  const creada = formatDate(regla.createdAt.slice(0, 10), 'long')
  const tocada = formatDate(regla.updatedAt.slice(0, 10), 'long')

  return (
    <p className="small">
      {`Creada el ${creada}`}
      {regla.createdBy === null ? '.' : ` por ${regla.createdBy}.`}
      {tocada === creada ? ' No se modificó desde entonces.' : ` Última modificación el ${tocada}.`}{' '}
      Cada movimiento que esta regla reclasificó quedó registrado con su autor y su fecha, así que
      borrarla no borra la historia de lo que hizo.
    </p>
  )
}
