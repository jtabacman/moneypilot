/**
 * El catálogo de plantillas: el nivel 1 del report builder, y el 70% del uso.
 *
 * Cada plantilla se titula con la pregunta textual que responde, no con el
 * nombre del reporte. "Costo total por propiedad" obliga a traducir; "¿cuánto
 * me cuesta realmente la casa de Madrid?" se reconoce de un vistazo, que es la
 * diferencia entre una lista que se lee y una que se ignora.
 *
 * Las cinco primeras son las de B3 y van en su orden. El resto completa el
 * catálogo del día 1 hasta 18.
 *
 * Cada plantilla declara su `estado`, y ahí está la única decisión de diseño
 * que importa de este fichero: una plantilla que no se puede ejecutar todavía
 * **no lleva un enlace muerto ni se esconde**. Se enseña, con el motivo
 * escrito. La regla del producto es que el hueco se declara — y una lista de
 * reportes que insinúa dieciocho y entrega cuatro es exactamente la clase de
 * promesa que este cliente ya se comió en otro producto.
 */

import type { SelectedDimension } from './ir'

/** Pantallas de la aplicación a las que puede apuntar una plantilla. */
export type PantallaHref = '/hoy' | '/mes' | '/estructura' | '/cierre' | '/cuentas' | '/dimensiones'

export type PlantillaEstado =
  /** Tiene su propia pantalla, construida y con datos reales. */
  | 'pantalla'
  /** Una pantalla responde parte de la pregunta; el reporte completo, no. */
  | 'parcial'
  /** Sólo se puede componer en el constructor: falta el motor de ejecución. */
  | 'constructor'

export interface PlantillaFiltro {
  readonly field: string
  readonly operator: string
  /** Valores fijos. Los que dependen del hogar los elige el usuario. */
  readonly values?: readonly string[]
}

/** El estado inicial que la plantilla deja cargado en el constructor. */
export interface Preset {
  readonly measure: string
  readonly dimensions: readonly SelectedDimension[]
  readonly range: string
  readonly compare: string
  readonly viz: string
  readonly filters?: readonly PlantillaFiltro[]
}

export interface Plantilla {
  readonly id: string
  /** R1…R5 para las cinco de B3. */
  readonly code?: string
  readonly question: string
  readonly why: string
  readonly consumer: string
  readonly estado: PlantillaEstado
  /** Qué falta exactamente. Obligatorio salvo cuando el estado es 'pantalla'. */
  readonly falta?: string
  readonly href?: PantallaHref
  readonly hrefLabel?: string
  readonly preset: Preset
}

export const PLANTILLAS: readonly Plantilla[] = [
  {
    id: 'cierre-mensual',
    code: 'R1',
    question: '¿Está cerrado el mes y puedo mandárselo sin que me lo devuelvan?',
    why: 'Reconciliación por cuenta, resultado por categoría, excepciones y anexo. Es el entregable por el que hoy se pagan entre 300 y 5.000 al mes, con dos a seis semanas de rezago.',
    consumer: 'contador · lo aprueba el titular',
    estado: 'pantalla',
    falta:
      'Los cinco bloques están en pantalla. Lo que no existe todavía es el paquete descargable —PDF, XLSX con fórmulas y tablas reales, CSV crudo y ZIP de adjuntos— ni el envío programado el día 5.',
    href: '/cierre',
    hrefLabel: 'Abrir el cierre',
    preset: {
      measure: 'gasto_neto',
      dimensions: [
        { field: 'categoria', level: 'leaf' },
        { field: 'fecha', grain: 'month' },
      ],
      range: 'previous_month',
      compare: 'previous_period',
      viz: 'table',
    },
  },
  {
    id: 'costo-propiedad',
    code: 'R2',
    question: '¿Cuánto me cuesta realmente la casa de Madrid, todo incluido?',
    why: 'Obra, servicios, personal, impuestos y seguros de una propiedad, con el año anterior al lado y el Pareto de proveedores. Ninguna plataforma del sector modela la dimensión propiedad.',
    consumer: 'titular · asesor',
    estado: 'parcial',
    falta:
      'El gasto por propiedad del mes en curso está en Este mes. Falta el desglose por área a lo largo del tiempo, la comparación con el mismo período del año anterior y el Pareto de proveedores.',
    href: '/mes',
    hrefLabel: 'Ver el mes en curso',
    preset: {
      measure: 'gasto_neto',
      dimensions: [
        { field: 'propiedad', level: 'area' },
        { field: 'fecha', grain: 'month' },
      ],
      range: 'last_12_months',
      compare: 'same_period_last_year',
      viz: 'stacked_bar',
      filters: [{ field: 'propiedad', operator: 'one_of' }],
    },
  },
  {
    id: 'liquidez-13-semanas',
    code: 'R3',
    question: '¿Me alcanza? ¿En qué cuenta y en qué moneda va a faltar, y cuándo?',
    why: 'Un carril por moneda, sin consolidar: el problema de liquidez es por moneda. Ingresos irregulares contra obligaciones fijas grandes, que hoy se resuelve en un Excel a mano.',
    consumer: 'titular',
    estado: 'parcial',
    falta:
      'La liquidez por moneda y la proyección de las obligaciones ya detectadas están en Hoy, pero ese carril sólo puede bajar: el motor de recurrentes mira el lado del pago y los ingresos no entran. Falta el carril de ingresos esperados, la banda de incertidumbre y la tabla de eventos editable en línea, que es donde el usuario mete lo que los datos no saben.',
    href: '/hoy',
    hrefLabel: 'Ver la liquidez y la proyección',
    preset: {
      measure: 'saldo_proyectado',
      dimensions: [{ field: 'fecha', grain: 'week' }, { field: 'cuenta' }],
      range: 'next_13_weeks',
      compare: 'none',
      viz: 'projection',
    },
  },
  {
    id: 'patrimonio-atribucion',
    code: 'R4',
    question:
      'Mi patrimonio subió. ¿Cuánto fue aporte, cuánto gasto, cuánto mercado y cuánto tipo de cambio?',
    why: 'El waterfall de seis barras con la de efecto FX clickeable. Es el hueco verificado del producto más caro del mercado: Kubera consolida a moneda base pero no desglosa el impacto cambiario.',
    consumer: 'titular · asesor (lectura)',
    estado: 'pantalla',
    href: '/estructura',
    hrefLabel: 'Abrir estructura',
    preset: {
      measure: 'variacion_patrimonio',
      dimensions: [{ field: 'entidad' }],
      range: 'year_to_date',
      compare: 'previous_period',
      viz: 'waterfall',
    },
  },
  {
    id: 'recurrentes-fugas',
    code: 'R5',
    question: '¿Qué me están cobrando todos los meses, qué subió y qué no se cobró?',
    why: 'Con 25 cuentas y 6 tarjetas nadie tiene el inventario. Es el hallazgo de mayor retorno percibido en la primera semana de uso.',
    consumer: 'titular · pareja',
    estado: 'parcial',
    falta:
      'Las obligaciones mensualizadas están en Estructura. Falta la tabla por serie con importe mediano, delta, sparkline y estado (activo, subió, no cobró, huérfano), que es lo que convierte el inventario en una acción.',
    href: '/estructura',
    hrefLabel: 'Ver las obligaciones',
    preset: {
      measure: 'obligacion_recurrente',
      dimensions: [{ field: 'comercio' }],
      range: 'last_12_months',
      compare: 'previous_period',
      viz: 'table',
    },
  },

  /* ── El resto del catálogo del día 1 ───────────────────────────────────── */

  {
    id: 'mes-contra-mes',
    question: '¿En qué se fue el mes y cómo viene contra el anterior?',
    why: 'La pregunta de cabecera del titular y de la pareja, con el mix por categoría en el tiempo.',
    consumer: 'titular · pareja',
    estado: 'pantalla',
    href: '/mes',
    hrefLabel: 'Abrir el mes',
    preset: {
      measure: 'gasto_neto',
      dimensions: [
        { field: 'categoria', level: 'root' },
        { field: 'fecha', grain: 'month' },
      ],
      range: 'last_3_months',
      compare: 'previous_period',
      viz: 'stacked_bar',
    },
  },
  {
    id: 'gasto-por-entidad',
    question: '¿Qué gastó cada entidad legal y qué le toca pagar a la sociedad?',
    why: 'Separar lo personal de lo societario es la mitad del trabajo que hoy hace la gestoría a mano cada trimestre.',
    consumer: 'titular · contador',
    estado: 'constructor',
    falta: 'El motor de ejecución genérico. La atribución por entidad ya está en los datos.',
    preset: {
      measure: 'gasto_neto',
      dimensions: [{ field: 'entidad' }, { field: 'fecha', grain: 'month' }],
      range: 'last_12_months',
      compare: 'same_period_last_year',
      viz: 'stacked_bar',
    },
  },
  {
    id: 'rentabilidad-alquiler',
    question: '¿El piso de Lisboa se paga solo: alquileres menos costes?',
    why: 'Flujo neto por propiedad. No es rentabilidad de inversión ni proyección de retorno: es lo que entró menos lo que salió.',
    consumer: 'titular · asesor',
    estado: 'constructor',
    falta: 'El motor de ejecución genérico.',
    preset: {
      measure: 'flujo_neto',
      dimensions: [
        { field: 'propiedad', level: 'propiedad' },
        { field: 'fecha', grain: 'month' },
      ],
      range: 'last_12_months',
      compare: 'same_period_last_year',
      viz: 'time_series',
    },
  },
  {
    id: 'coste-por-persona',
    question: '¿Cuánto cuesta cada persona, incluidas las que trabajan en casa?',
    why: 'Colegios, personal doméstico, seguros y ayudas familiares repartidos por persona, con los splits ponderados ya aplicados.',
    consumer: 'titular · pareja',
    estado: 'constructor',
    falta: 'El motor de ejecución genérico.',
    preset: {
      measure: 'gasto_neto',
      dimensions: [{ field: 'persona' }, { field: 'fecha', grain: 'quarter' }],
      range: 'last_12_months',
      compare: 'same_period_last_year',
      viz: 'table',
    },
  },
  {
    id: 'presupuesto-obra',
    question: '¿Cuánto llevo gastado en la reforma y cuánto queda del presupuesto?',
    why: 'Presupuesto contra real por proyecto, que es lo primero que mira quien administra una obra.',
    consumer: 'titular · asistente',
    estado: 'constructor',
    falta:
      'No hay presupuestos en el modelo de datos: la barra de objetivo todavía no tiene contra qué compararse.',
    preset: {
      measure: 'gasto_bruto',
      dimensions: [{ field: 'proyecto' }],
      range: 'last_12_months',
      compare: 'budget',
      viz: 'bullet',
    },
  },
  {
    id: 'impuestos-por-pais',
    question: '¿Cuánto pago de impuestos en cada país y cuándo toca el siguiente?',
    why: 'Tres países y dos monedas: el calendario fiscal es el sitio donde una familia con estructura pierde dinero por despiste.',
    consumer: 'titular · contador',
    estado: 'constructor',
    falta: 'El motor de ejecución genérico y el calendario de vencimientos.',
    preset: {
      measure: 'gasto_neto',
      dimensions: [{ field: 'pais' }, { field: 'fecha', grain: 'quarter' }],
      range: 'last_12_months',
      compare: 'same_period_last_year',
      viz: 'table',
      filters: [{ field: 'categoria', operator: 'one_of' }],
    },
  },
  {
    id: 'pareto-proveedores',
    question: '¿Qué proveedores concentran mi gasto?',
    why: '"El 20% de tus proveedores es el 63% del gasto" es barato de calcular y accionable el mismo día.',
    consumer: 'titular · asistente',
    estado: 'parcial',
    falta:
      'El top de comercios del mes en curso está en Este mes. Falta la ventana de doce meses y el acumulado por proveedor.',
    href: '/mes',
    hrefLabel: 'Ver el top del mes',
    preset: {
      measure: 'gasto_neto',
      dimensions: [{ field: 'comercio' }],
      range: 'last_12_months',
      compare: 'none',
      viz: 'pareto',
    },
  },
  {
    id: 'comisiones-bancarias',
    question: '¿Cuánto me cobran los bancos por tener el dinero donde lo tengo?',
    why: 'Comisiones de mantenimiento, de cambio y de transferencia por institución. Se paga sin mirarlo porque nunca aparece junto.',
    consumer: 'titular',
    estado: 'constructor',
    falta: 'El motor de ejecución genérico.',
    preset: {
      measure: 'gasto_neto',
      dimensions: [{ field: 'institucion' }, { field: 'fecha', grain: 'month' }],
      range: 'last_12_months',
      compare: 'previous_period',
      viz: 'table',
      filters: [{ field: 'categoria', operator: 'one_of' }],
    },
  },
  {
    id: 'patrimonio-por-moneda',
    question: '¿Cuánto de mi patrimonio está en cada moneda?',
    why: 'La exposición cambiaria vista como stock, que es la que después explica la barra de FX del waterfall.',
    consumer: 'titular · asesor',
    estado: 'parcial',
    falta:
      'La distribución por moneda está en Estructura. Falta poder verla mes a mes y abrir cada moneda hasta la cuenta.',
    href: '/estructura',
    hrefLabel: 'Ver la distribución',
    preset: {
      measure: 'patrimonio_neto',
      dimensions: [{ field: 'moneda' }],
      range: 'year_to_date',
      compare: 'previous_period',
      viz: 'table',
    },
  },
  {
    id: 'ingresos-alquiler',
    question: '¿Cuánto entra por alquileres y con qué regularidad?',
    why: 'Ingreso por propiedad y mes: la otra mitad de la pregunta de liquidez cuando la renta es irregular.',
    consumer: 'titular',
    estado: 'constructor',
    falta: 'El motor de ejecución genérico.',
    preset: {
      measure: 'ingreso',
      dimensions: [
        { field: 'propiedad', level: 'propiedad' },
        { field: 'fecha', grain: 'month' },
      ],
      range: 'last_12_months',
      compare: 'same_period_last_year',
      viz: 'time_series',
    },
  },
  {
    id: 'gasto-viaje',
    question: '¿Qué me costó el viaje, todo incluido?',
    why: 'Vuelos, hotel, comidas y la tarjeta en moneda extranjera, en una sola cifra y con el detalle detrás.',
    consumer: 'titular · pareja',
    estado: 'constructor',
    falta:
      'El motor de ejecución genérico, y la dimensión Viaje, que hay que crear en cada hogar que la quiera usar.',
    preset: {
      measure: 'gasto_neto',
      dimensions: [{ field: 'viaje' }, { field: 'categoria', level: 'root' }],
      range: 'last_12_months',
      compare: 'none',
      viz: 'table',
    },
  },
  {
    id: 'efectivo-sin-justificar',
    question: '¿Qué salió en efectivo y no tiene un papel detrás?',
    why: 'Lo que el contador va a preguntar en el cierre, encontrado antes de que lo pregunte.',
    consumer: 'contador · asistente',
    estado: 'constructor',
    falta: 'El motor de ejecución genérico y los adjuntos, que todavía no se vinculan al asiento.',
    preset: {
      measure: 'gasto_neto',
      dimensions: [{ field: 'fecha', grain: 'month' }, { field: 'cuenta' }],
      range: 'last_3_months',
      compare: 'none',
      viz: 'table',
      filters: [{ field: 'adjunto', operator: 'one_of', values: ['sin_adjunto'] }],
    },
  },
  {
    id: 'cambios-post-cierre',
    question: '¿Qué cambió desde el cierre que ya le mandé al contador?',
    why: 'Movimientos cargados a mano o corregidos después de la fecha de cierre. Es el anexo que evita que el mes se reabra.',
    consumer: 'contador · titular',
    estado: 'constructor',
    falta: 'El motor de ejecución genérico y el registro de cierres emitidos.',
    preset: {
      measure: 'n_transacciones',
      dimensions: [{ field: 'fecha', grain: 'month' }, { field: 'cuenta' }],
      range: 'last_3_months',
      compare: 'none',
      viz: 'table',
      filters: [{ field: 'origen', operator: 'one_of', values: ['manual'] }],
    },
  },
]

export function plantilla(id: string): Plantilla | undefined {
  return PLANTILLAS.find((p) => p.id === id)
}

/** Las cinco de B3, que van primero y con su código. */
export const CINCO: readonly Plantilla[] = PLANTILLAS.filter((p) => p.code !== undefined)
export const RESTO: readonly Plantilla[] = PLANTILLAS.filter((p) => p.code === undefined)
