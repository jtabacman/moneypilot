import { formatDate } from '@/lib/format'
import { navItem } from '@/lib/nav'
import { Empty, PageBar } from '../ui'
import { type Acceso, listarAccesos } from './actions'
import { AccionesAcceso, FormularioInvitacion } from './forms'
import { CasosBorde, MatrizPermisos } from './referencia'

/**
 * Quién entra al hogar, hasta cuándo y con qué alcance.
 *
 * Esta pantalla **no** enseña el estado vacío de las demás. No depende de que
 * haya movimientos cargados: un hogar recién creado ya tiene una membresía —
 * la del titular— y la primera pregunta de este cliente, antes incluso de
 * subir un extracto, es a quién le va a dar acceso a esto. Mandarlo a
 * "cargá datos primero" sería esconderle su propia estructura de gobierno.
 */
export const dynamic = 'force-dynamic'

const NAV = navItem('/accesos')

/**
 * `13 ago 2026`. El año no es opcional en esta pantalla: un acceso concedido
 * hace dos años y uno concedido este mes se leen igual con el formato corto, y
 * la antigüedad de un permiso es justamente el dato que se está revisando.
 */
function fecha(iso: string): string {
  return `${formatDate(iso, 'short')} ${iso.slice(0, 4)}`
}

export default async function Accesos() {
  const panel = await listarAccesos()
  const propia = panel.accesos.find((acceso) => acceso.soyYo)
  const externos = panel.accesos.filter(
    (acceso) => acceso.rol !== 'titular' && acceso.rol !== 'pareja',
  )
  const caduca = propia?.caduca ?? null
  const dias = propia?.dias ?? null
  // Un acceso del hogar sin caducidad es correcto; uno externo sin caducidad
  // es el incumplimiento de B6 que la columna Estado ya pinta en rojo. El
  // recuadro tiene que decir lo mismo que la tabla: "nunca" a secas se lee
  // como tranquilidad justo en el caso que hay que corregir.
  const propioEsExterno =
    propia !== undefined && propia.rol !== 'titular' && propia.rol !== 'pareja'

  return (
    <>
      <PageBar
        title={NAV?.label ?? 'Accesos'}
        blurb={NAV?.blurb ?? 'Quién entra, a qué, hasta cuándo, y qué se llevó.'}
        tools={<span className="role">{panel.rolPropio}</span>}
      />

      <div className="page">
        <div className="tiles">
          <div className="tile">
            <div className="k">Tu acceso</div>
            <div className="v">{panel.rolPropio}</div>
            <div className="sub">{panel.correoPropio ?? 'sin correo'}</div>
          </div>
          <div className="tile">
            <div className="k">Desde</div>
            <div className="v">{propia === undefined ? '—' : fecha(propia.desde)}</div>
            <div className="sub">en {panel.hogar}</div>
          </div>
          <div className="tile">
            <div className="k">Caduca</div>
            <div className="v">
              {caduca === null ? (propioEsExterno ? 'sin fecha' : 'nunca') : fecha(caduca)}
            </div>
            <div className="sub">
              {caduca === null ? (
                propioEsExterno ? (
                  <span className="status bad">B6 exige caducidad y este acceso no la tiene</span>
                ) : (
                  'el acceso del hogar no caduca'
                )
              ) : dias === null ? (
                'ya venció'
              ) : (
                `faltan ${dias} días`
              )}
            </div>
          </div>
          {/* Este número sale de la lista visible, así que sólo se enseña cuando
              la lista está completa. Un "0 invitados" calculado sobre una fila
              es peor que no dar el dato: se lee como que no hay nadie más. */}
          <div className="tile">
            <div className="k">Invitados externos</div>
            <div className="v">{panel.rosterCompleto ? externos.length : '—'}</div>
            <div className="sub">
              {panel.rosterCompleto
                ? 'contador, asistente o asesor'
                : 'la base todavía no deja contarlos'}
            </div>
          </div>
        </div>

        <section className="panel">
          <div className="panel-head">
            <h2>Personas con acceso</h2>
            <small>{panel.hogar}</small>
          </div>

          {!panel.rosterCompleto && (
            <div className="panel-body">
              <div className="banner">
                <b>Esta lista está incompleta, y la base es la razón.</b> La tabla{' '}
                <code>membership</code> tiene una sola política de fila, <code>membership_own</code>
                , que filtra por persona y no por hogar — tiene que ser así porque es la tabla que
                decide el aislamiento y una política que dependiera del hogar se resolvería en
                círculo. Mientras no exista una segunda que abra el hogar a quien pertenece a él,
                esta pantalla sólo puede enseñarte tu propia membresía, aunque haya más gente
                dentro. Preferimos decírtelo a enseñarte una lista de uno y dejar que la leas como
                completa.
              </div>
            </div>
          )}

          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Persona</th>
                  <th>Rol</th>
                  <th>Desde</th>
                  <th>Caducidad</th>
                  <th>Estado</th>
                  <th className="r">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {panel.accesos.map((acceso) => (
                  <tr key={acceso.id}>
                    <td>
                      {acceso.email ?? (
                        <span className="num faint">{acceso.usuario.slice(0, 8)}</span>
                      )}
                      {acceso.soyYo && <span className="small faint"> · vos</span>}
                    </td>
                    <td>
                      <span className="role">{acceso.rol}</span>
                    </td>
                    <td className="small faint">{fecha(acceso.desde)}</td>
                    <td className="small">
                      {acceso.caduca === null ? (
                        <span className="faint">—</span>
                      ) : (
                        fecha(acceso.caduca)
                      )}
                    </td>
                    <td>
                      <Estado acceso={acceso} />
                    </td>
                    <td className="r">
                      <AccionesAcceso
                        id={acceso.id}
                        rol={acceso.rol}
                        revocada={acceso.revocada !== null}
                        soyYo={acceso.soyYo}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="notes">
            <h3>Lo que hace cada botón</h3>
            <ul>
              <li>
                <b>Renovar</b> pone la caducidad en la ventana del rol contada desde hoy: 90 días
                para contador y asistente, 30 para asesor. Desde hoy y no desde la fecha vencida,
                porque renovar sobre una fecha pasada da una caducidad que nace caducada.
              </li>
              <li>
                <b>Revocar</b> escribe <code>revoked_at</code> y la siguiente petición de esa
                persona ya no resuelve a este hogar. No aparece sobre un titular ni sobre una
                pareja: eso es una separación de hogar, no un click.
              </li>
            </ul>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Invitar a alguien</h2>
            <small>Tres perfiles, un click</small>
          </div>
          <div className="panel-body">
            <FormularioInvitacion />
          </div>
          <div className="verdict warn">
            <b>El alta todavía la hace el equipo.</b> Los tres perfiles están acá para que se vea
            qué implica cada uno, pero el botón está deshabilitado y dice por qué: no hay forma de
            crear el acceso desde esta pantalla. Es el paso 6 del onboarding y dura media hora.
          </div>
        </section>

        <MatrizPermisos />

        <CasosBorde />

        <section className="panel">
          <div className="panel-head">
            <h2>Quién vio qué y cuándo</h2>
            <small>Registro de accesos</small>
          </div>
          <Empty title="Todavía no se está guardando">
            El registro de accesos no existe como tabla, así que no hay nada que enseñar acá — y
            tampoco hay nada guardado que podamos enseñar más adelante sobre lo que pasó hasta hoy.
            Cuando exista, va a registrar cada lectura y cada exportación con persona, alcance y
            fecha, y va a ser filtrable. Es una función de gobernanza familiar antes que de
            seguridad: el miedo de este cliente es tanto el ex-cónyuge y el asistente como el
            intruso.
          </Empty>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Cómo está aplicado hoy el permiso</h2>
            <small>Políticas de fila sobre membership</small>
          </div>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Política</th>
                  <th>Comandos</th>
                  <th>Condición que aplica Postgres</th>
                </tr>
              </thead>
              <tbody>
                {panel.policies.map((policy) => (
                  <tr key={policy.nombre}>
                    <td>
                      <code>{policy.nombre}</code>
                    </td>
                    <td className="small faint">{policy.comando}</td>
                    <td>
                      <code className="small">{policy.expresion}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="notes">
            <h3>Por qué se enseña esto</h3>
            <ul>
              <li>
                Sale de <code>pg_policies</code> en esta misma consulta: es lo que la base está
                aplicando ahora mismo, no lo que creemos que aplica.
              </li>
              <li>
                El rol recorta el menú lateral, pero <b>todavía no recorta la ruta</b>: alguien con
                sesión en este hogar que escriba la dirección a mano llega igual. El filtro por rol
                y por dimensión tiene que vivir en la capa de consulta, no en el menú, y ese es el
                trabajo que falta.
              </li>
            </ul>
          </div>
        </section>
      </div>
    </>
  )
}

/**
 * Un acceso externo sin fecha de caducidad no es "permanente": es un
 * incumplimiento de la propia política, y se pinta como tal.
 */
function Estado({ acceso }: { acceso: Acceso }) {
  if (acceso.estado === 'revocada') {
    return (
      <span
        className="status none"
        title={acceso.revocada === null ? 'Revocada' : `Revocada el ${fecha(acceso.revocada)}`}
      >
        revocada
      </span>
    )
  }
  if (acceso.estado === 'caducada') return <span className="status bad">caducada</span>
  if (acceso.estado === 'por-caducar') {
    return <span className="status warn">caduca en {acceso.dias ?? 0} días</span>
  }
  if (acceso.estado === 'sin-caducidad') {
    if (acceso.rol === 'titular' || acceso.rol === 'pareja') {
      return <span className="status ok">permanente</span>
    }
    return (
      <span className="status bad" title="B6 exige caducidad para todo acceso externo">
        sin caducidad
      </span>
    )
  }
  return (
    <span className="status ok">activa{acceso.dias === null ? '' : ` · ${acceso.dias} d`}</span>
  )
}
