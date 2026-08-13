/**
 * El menú de la aplicación, en un solo sitio.
 *
 * El orden no es arbitrario: sigue la secuencia real de trabajo de este
 * cliente, que no es la de una app de finanzas personales.
 *
 *   1. **Preguntas** — los cuatro tableros de B5. Es donde se entra cada día,
 *      y cada uno tiene un destinatario distinto: Hoy y Este mes son del
 *      titular, Estructura la comparte con el asesor, Cierre es del contador.
 *   2. **Datos** — el registro. Movimientos es el destino de todo drill-down,
 *      así que tiene que estar siempre a un click desde cualquier número.
 *   3. **Tu estructura** — propiedades, entidades, personas y proyectos. Es
 *      el diferencial del producto y por eso es una sección, no un ajuste
 *      enterrado: sin esto, "cuánto me cuesta la casa de Madrid" no existe.
 *   4. **Gobierno** — quién ve qué, con qué caducidad y con qué registro.
 *
 * Reportes va en "Preguntas" y no en una sección propia porque un reporte
 * guardado es un tablero que te armaste vos; separarlos obliga al usuario a
 * saber en qué categoría metió su propia pregunta.
 */

export interface NavItem {
  readonly href: string
  readonly label: string
  /** Una línea que explica para qué sirve. Sale en el título de la página. */
  readonly blurb: string
  /** Rol mínimo que lo ve. `null` = todos los roles del hogar. */
  readonly roles?: readonly string[]
}

export interface NavGroup {
  readonly title: string
  readonly items: readonly NavItem[]
}

export const NAV: readonly NavGroup[] = [
  {
    title: 'Preguntas',
    items: [
      {
        href: '/hoy',
        label: 'Hoy',
        blurb: 'Liquidez por moneda, lo que viene y lo que necesita tu criterio.',
      },
      {
        href: '/mes',
        label: 'Este mes',
        blurb: 'En qué se fue el mes, contra el anterior y contra tu promedio.',
      },
      {
        href: '/estructura',
        label: 'Estructura',
        blurb: 'Patrimonio, de dónde vino la variación y cuánto fue tipo de cambio.',
      },
      {
        href: '/cierre',
        label: 'Cierre',
        blurb: 'El estado del mes y el paquete que se le manda al contador.',
        roles: ['titular', 'pareja', 'contador'],
      },
      {
        href: '/reportes',
        label: 'Reportes',
        blurb: 'Plantillas, tus reportes guardados y el constructor.',
      },
    ],
  },
  {
    title: 'Datos',
    items: [
      {
        href: '/movimientos',
        label: 'Movimientos',
        blurb: 'El registro completo. Todo número de la aplicación termina acá.',
      },
      {
        href: '/importar',
        label: 'Importar',
        blurb: 'Subí extractos y mirá el informe de reconciliación antes de guardar.',
        roles: ['titular', 'pareja', 'contador'],
      },
      {
        href: '/revisar',
        label: 'Revisar',
        blurb: 'Lo que el motor no se anima a decidir solo.',
      },
    ],
  },
  {
    title: 'Tu estructura',
    items: [
      {
        href: '/cuentas',
        label: 'Cuentas',
        blurb: 'Bancos, tarjetas y efectivo, con su moneda y su país.',
      },
      {
        href: '/dimensiones',
        label: 'Dimensiones',
        blurb: 'Propiedades, sociedades, personas y proyectos, como los nombrás vos.',
      },
    ],
  },
  {
    title: 'Gobierno',
    items: [
      {
        href: '/accesos',
        label: 'Accesos',
        blurb: 'Quién entra, a qué, hasta cuándo, y qué se llevó.',
        roles: ['titular', 'pareja'],
      },
      {
        href: '/ajustes',
        label: 'Ajustes',
        blurb: 'Hogar, moneda de reporte y política de tipo de cambio.',
      },
    ],
  },
]

const BY_HREF = new Map<string, NavItem>(
  NAV.flatMap((group) => group.items).map((item) => [item.href, item]),
)

export function navItem(href: string): NavItem | undefined {
  return BY_HREF.get(href)
}

/** Filtra el menú por rol. Un rol desconocido ve sólo lo que no exige rol. */
export function navFor(role: string): NavGroup[] {
  return NAV.map((group) => ({
    title: group.title,
    items: group.items.filter((item) => item.roles === undefined || item.roles.includes(role)),
  })).filter((group) => group.items.length > 0)
}
