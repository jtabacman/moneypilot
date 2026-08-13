import Link from 'next/link'
import { Illustrative } from '../ui'

/**
 * La política de B6, escrita tal cual, y al lado lo que el motor hace hoy.
 *
 * Estos dos bloques no son una lectura de la base: son la especificación. Se
 * enseñan porque el titular necesita saber qué está comprando cuando invita a
 * su contador, y se marca sin ambigüedad cuál de las dos columnas es promesa
 * y cuál es comportamiento — que es la única forma honesta de enseñar una
 * política a medio implementar.
 */

interface FilaMatriz {
  readonly rol: string
  readonly alcance: string
  /** Ver, Filtrar, Exportar, Comentar, Editar, Aprobar, Invitar. */
  readonly acciones: readonly ('si' | 'no' | 'config')[]
}

const ACCIONES = ['Ver', 'Filtrar', 'Exportar', 'Comentar', 'Editar', 'Aprobar', 'Invitar'] as const

const MATRIZ: readonly FilaMatriz[] = [
  {
    rol: 'Titular',
    alcance: 'Todo',
    acciones: ['si', 'si', 'si', 'si', 'si', 'si', 'si'],
  },
  {
    rol: 'Pareja / co-titular',
    alcance: 'Todo menos las entidades marcadas privadas',
    acciones: ['si', 'si', 'si', 'si', 'si', 'si', 'no'],
  },
  {
    rol: 'Contador',
    alcance: 'Entidades asignadas · sin categorías sensibles · adjuntos fiscales sí',
    acciones: ['si', 'si', 'si', 'si', 'config', 'no', 'no'],
  },
  {
    rol: 'Asistente',
    alcance: 'Dimensiones asignadas · importes visibles, saldos ocultos',
    acciones: ['si', 'si', 'no', 'si', 'config', 'no', 'no'],
  },
  {
    rol: 'Asesor',
    alcance: 'Sólo patrimonio agregado y estructura · sin transacciones',
    acciones: ['si', 'si', 'si', 'si', 'no', 'no', 'no'],
  },
  {
    rol: 'Invitado por enlace',
    alcance: 'Un reporte exacto, congelado',
    acciones: ['si', 'no', 'config', 'no', 'no', 'no', 'no'],
  },
]

function Marca({ valor }: { valor: 'si' | 'no' | 'config' }) {
  if (valor === 'si') return <span className="pos">si</span>
  if (valor === 'config') return <span className="faint">Δ</span>
  return <span className="faint">—</span>
}

export function MatrizPermisos() {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Qué puede hacer cada rol</h2>
        <small>La política del producto</small>
      </div>

      <div className="panel-body">
        <Illustrative>
          Esta tabla es la política escrita, no una lectura del motor. Hoy la base aplica el
          aislamiento <b>entre hogares</b> y el menú se recorta por rol, pero el filtro por entidad,
          por categoría sensible y por dimensión —el predicado de alcance que se ensambla a cada
          consulta antes de compilar a SQL— todavía no está construido. Hasta que lo esté, invitar a
          alguien le da acceso al hogar entero, así que el alta la sigue haciendo el equipo.
        </Illustrative>
      </div>

      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Rol</th>
              <th>Alcance por defecto</th>
              {ACCIONES.map((accion) => (
                <th key={accion} className="r">
                  {accion}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MATRIZ.map((fila) => (
              <tr key={fila.rol}>
                <td>
                  <b>{fila.rol}</b>
                </td>
                <td className="small">{fila.alcance}</td>
                {fila.acciones.map((valor, indice) => (
                  <td key={ACCIONES[indice] ?? String(indice)} className="r">
                    <Marca valor={valor} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="notes">
        <h3>Cómo se lee</h3>
        <ul>
          <li>
            <code>Δ</code> es configurable y viene apagado.
          </li>
          <li>
            <b>Editar, para contador y asistente, significa proponer.</b> La propuesta genera un
            diff con su impacto y lo aprueba el titular. Nunca escritura directa sobre el libro.
          </li>
          <li>
            El rol de contador no consume asiento y no se cobra:{' '}
            <Link href="/precios">es canal, no cliente</Link>.
          </li>
        </ul>
      </div>
    </section>
  )
}

/* ── Casos borde ─────────────────────────────────────────────────────────── */

interface CasoBorde {
  readonly caso: string
  readonly regla: string
  /** Qué hace hoy el sistema. Sin adornos. */
  readonly hoy: string
  readonly estado: 'parcial' | 'falta'
}

const CASOS: readonly CasoBorde[] = [
  {
    caso: 'Revocación de contador',
    regla:
      'Kill switch: invalida la sesión, revoca los enlaces de reporte que emitió, cancela los ' +
      'envíos programados y te notifica qué se llevó, con el registro de exportaciones de los ' +
      'últimos 90 días.',
    hoy:
      'El botón Revocar escribe revoked_at y la sesión de esa persona deja de resolver a este ' +
      'hogar en su siguiente petición. Lo demás no existe: no hay tabla de sesiones, ni enlaces ' +
      'de reporte emitidos, ni registro de exportaciones que listar.',
    estado: 'parcial',
  },
  {
    caso: 'Ex-pareja co-titular',
    regla:
      'Un co-titular no se revoca unilateralmente. Se ejecuta una separación de hogar: corte a ' +
      'fecha, exportación completa para ambos y el histórico compartido congelado en solo ' +
      'lectura para los dos.',
    hoy:
      'La acción de revocar se niega explícitamente sobre un titular o una pareja. La ' +
      'separación de hogar no está construida, así que hoy el caso se resuelve hablando con ' +
      'nosotros.',
    estado: 'parcial',
  },
  {
    caso: 'Lo que el contador nunca ve',
    regla:
      'Las categorías con marca de sensible (salud, donaciones, legal, terapia) quedan fuera por ' +
      'defecto, pero el reporte declara el hueco: "47 movimientos ocultos por política, ' +
      'EUR 12.340". Ocultar en silencio rompe la reconciliación.',
    hoy:
      'No hay marca de sensible en el árbol de categorías, así que no hay nada que excluir ni ' +
      'hueco que declarar. La mecánica de declarar el hueco sí existe y se usa en cada total ' +
      'con movimientos sin convertir.',
    estado: 'falta',
  },
  {
    caso: 'Caducidad obligatoria',
    regla: 'Contador 90 días renovables, asesor 30, invitado por enlace 7 (máximo 30).',
    hoy:
      'La columna expires_at existe, la sesión la comprueba en cada acceso —quien caducó ve una ' +
      'pantalla que se lo explica, no un login roto— y el botón Renovar aplica la ventana del ' +
      'rol. Lo que falta es que el alta la imponga, porque el alta todavía no se hace desde acá.',
    estado: 'parcial',
  },
  {
    caso: 'Fallecimiento o inactividad',
    regla:
      'Entrega a los beneficiarios designados tras N días sin actividad, con doble confirmación.',
    hoy: 'No hay beneficiarios, ni reloj de inactividad, ni entrega. Nada de esto está construido.',
    estado: 'falta',
  },
  {
    caso: 'Registro visible',
    regla:
      'El titular ve quién vio qué y cuándo, filtrable. No es un control de seguridad: es ' +
      'gobernanza familiar, porque el miedo de este cliente es tanto el ex-cónyuge y el ' +
      'asistente como el intruso.',
    hoy: 'No hay tabla de registro de accesos. No se está guardando: no es que no se muestre.',
    estado: 'falta',
  },
]

export function CasosBorde() {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Los casos que definen si esto es serio</h2>
        <small>Regla y estado real</small>
      </div>

      <div className="panel-body">
        <Illustrative>
          Las tres columnas están escritas a mano en esta pantalla, no leídas del sistema. La regla
          sale de B6 y el «qué pasa hoy» se comprobó contra el código y contra la base al escribirla
          — pero nada acá se recalcula solo, así que el día que una de estas piezas se construya hay
          que venir a cambiar la fila.
        </Illustrative>
      </div>

      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Caso</th>
              <th>La regla</th>
              <th>Qué pasa hoy</th>
              <th className="r">Estado</th>
            </tr>
          </thead>
          <tbody>
            {CASOS.map((caso) => (
              <tr key={caso.caso}>
                <td>
                  <b>{caso.caso}</b>
                </td>
                <td className="small">{caso.regla}</td>
                <td className="small faint">{caso.hoy}</td>
                <td className="r">
                  <span className={caso.estado === 'parcial' ? 'status warn' : 'status none'}>
                    {caso.estado === 'parcial' ? 'a medias' : 'sin construir'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="verdict warn">
        <b>Cuatro de los seis casos no están construidos o lo están a medias.</b> Están en la
        pantalla igual porque el titular tiene derecho a saber qué protección tiene hoy y cuál está
        prometida — y porque una lista de casos borde que sólo enseña los resueltos no es una lista
        de casos borde.
      </div>
    </section>
  )
}
