/**
 * El plan de cuentas con el que arranca un hogar nuevo.
 *
 * ── Qué es un nodo ──────────────────────────────────────────────────────────
 *
 * Cada nodo es **una cuenta** de `kind` 'expense' o 'income': en este esquema
 * no hay tabla de categorías, la jerarquía la lleva `account.parent_id` (ver
 * 001_schema.sql). Por eso el nodo trae `tipo`: `kind` no admite nulos en la
 * base, así que cada nodo tiene que poder convertirse en una fila sin que el
 * llamador tenga que arrastrar el contexto del padre.
 *
 * ── Por qué este árbol y no una taxonomía de consumo ────────────────────────
 *
 * La tentación es copiar la taxonomía de un agregador: sale gratis y tiene
 * cuarenta categorías de compras. Sería el eje equivocado. A este cliente no le
 * hace falta separar "electrónica" de "juguetería"; le hace falta saber qué
 * cuesta cada propiedad, qué pasa por la sociedad y qué gasta cada persona — y
 * eso **no es una categoría, es una dimensión**, que es otro eje y ya existe
 * (`dimension` / `posting_dimension`).
 *
 * De ahí la forma del árbol: el consumo del día a día se queda deliberadamente
 * plano —siete hojas, sin subdividir— y lo que crece es lo que una taxonomía de
 * consumo no tiene: comunidad de propietarios, IBI, personal doméstico con su
 * Seguridad Social, honorarios profesionales, gastos que sólo existen dentro de
 * una sociedad, e impuestos que en una familia con patrimonio son varios y
 * distintos.
 *
 * El corolario práctico, que conviene tener a mano antes de añadir nodos:
 * **'Vivienda' es la naturaleza del gasto, no la casa.** Cuál de las tres casas
 * es lo dice la dimensión 'propiedad'. Crear "Casa Madrid" y "Casa Sotogrande"
 * como categorías multiplicaría el árbol por el número de propiedades y haría
 * imposible la pregunta "cuánto pagamos de comunidad en total". Lo mismo vale
 * para la sociedad y para cada persona.
 *
 * ── La restricción que manda sobre los nombres ──────────────────────────────
 *
 * `account_name_unique` es `(tenant_id, name)`: el nombre es único **en todo el
 * hogar**, no dentro de su rama. Por eso los seguros se llaman 'Seguro de
 * hogar' y 'Seguro de salud' en vez de 'Hogar' y 'Salud' colgando de 'Seguros':
 * 'Salud' ya es una raíz, y el insert fallaría al crear el hogar. Hay un test
 * que lo comprueba, porque el fallo aparecería en el alta del cliente y no acá.
 */

/** Gasto o ingreso. Es `account.kind` restringido a lo que puede ser categoría. */
export type TipoDeCategoria = 'expense' | 'income'

/**
 * Camino desde la raíz, con los nombres tal cual. 'Vivienda > Suministros > Agua'.
 *
 * Es lo que usa la tabla de correspondencia del proveedor para señalar una
 * categoría sin depender de un uuid, que no existe hasta que el hogar se crea.
 */
export type RutaDeCategoria = string

/**
 * No es una elección nueva: es el formato que ya emite `CategoryNode.path` en
 * `read-ledger.ts` —el CTE recursivo concatena con `' > '`— y que la aplicación
 * web ya enseña. Inventar acá un separador distinto obligaría a traducir entre
 * los dos en cada frontera, que es donde se pierden las rutas.
 *
 * Ningún nombre del árbol contiene '>'; hay un test que lo comprueba al
 * comprobar que toda ruta de la tabla resuelve.
 */
export const SEPARADOR_DE_RUTA = ' > '

export interface NodoDeCategoria {
  readonly nombre: string
  readonly tipo: TipoDeCategoria
  readonly hijos?: readonly NodoDeCategoria[]
}

export const ARBOL_POR_DEFECTO: readonly NodoDeCategoria[] = [
  // ── Lo que cuesta tener las casas ─────────────────────────────────────────
  // El bloque más grande, y es lo correcto para este cliente: aquí es donde
  // aparecen los conceptos que ninguna taxonomía de consumo trae.
  {
    nombre: 'Vivienda',
    tipo: 'expense',
    hijos: [
      { nombre: 'Hipoteca', tipo: 'expense' },
      { nombre: 'Alquiler', tipo: 'expense' },
      { nombre: 'Comunidad de propietarios', tipo: 'expense' },
      // El IBI vive con la casa y no con los impuestos: es un coste de tener
      // esa propiedad, y quien pregunta "cuánto me cuesta Madrid al año" lo
      // quiere dentro. Los impuestos de la persona y de la sociedad están en su
      // propia raíz porque no se atribuyen a un inmueble.
      { nombre: 'IBI y tasas municipales', tipo: 'expense' },
      {
        nombre: 'Suministros',
        tipo: 'expense',
        hijos: [
          { nombre: 'Luz y gas', tipo: 'expense' },
          { nombre: 'Agua', tipo: 'expense' },
          { nombre: 'Internet y telefonía', tipo: 'expense' },
          { nombre: 'Basuras y saneamiento', tipo: 'expense' },
        ],
      },
      // Obra y mantenimiento separados porque son dinero de distinta clase: la
      // reforma es inversión que sube el valor del inmueble y suele tener
      // tratamiento fiscal propio; cambiar una caldera es gasto del año.
      { nombre: 'Obras y reformas', tipo: 'expense' },
      { nombre: 'Mantenimiento y reparaciones', tipo: 'expense' },
      { nombre: 'Mobiliario y equipamiento', tipo: 'expense' },
      { nombre: 'Seguridad y alarma', tipo: 'expense' },
    ],
  },

  // ── Personal doméstico ────────────────────────────────────────────────────
  // Raíz propia y no un hijo de 'Vivienda' porque no es un gasto de la casa:
  // es una relación laboral con nómina y cotización, y el hogar es el
  // empleador. Separar salario de Seguridad Social no es un capricho de
  // contable: son dos pagos a dos destinatarios distintos y en fechas
  // distintas, y juntarlos impide cuadrar ninguno de los dos.
  {
    nombre: 'Personal doméstico',
    tipo: 'expense',
    hijos: [
      { nombre: 'Salarios del personal', tipo: 'expense' },
      { nombre: 'Seguridad Social del personal', tipo: 'expense' },
    ],
  },

  // ── El día a día ──────────────────────────────────────────────────────────
  // Plano a propósito. Subdividir 'Compras generales' en electrónica, hogar y
  // juguetería daría diez categorías más y cero decisiones nuevas; el detalle
  // que sí cambia decisiones —de quién fue la compra— lo lleva la dimensión.
  {
    nombre: 'Día a día',
    tipo: 'expense',
    hijos: [
      { nombre: 'Supermercado', tipo: 'expense' },
      { nombre: 'Restaurantes y bares', tipo: 'expense' },
      { nombre: 'Compras generales', tipo: 'expense' },
      { nombre: 'Ropa y calzado', tipo: 'expense' },
      { nombre: 'Cuidado personal', tipo: 'expense' },
      { nombre: 'Mascotas', tipo: 'expense' },
      { nombre: 'Regalos y donativos', tipo: 'expense' },
    ],
  },

  {
    nombre: 'Salud',
    tipo: 'expense',
    hijos: [
      { nombre: 'Médicos y clínicas', tipo: 'expense' },
      { nombre: 'Dentista', tipo: 'expense' },
      { nombre: 'Farmacia', tipo: 'expense' },
    ],
  },

  {
    nombre: 'Educación',
    tipo: 'expense',
    hijos: [
      { nombre: 'Colegio y universidad', tipo: 'expense' },
      { nombre: 'Guardería y cuidado de menores', tipo: 'expense' },
      { nombre: 'Clases y actividades', tipo: 'expense' },
    ],
  },

  {
    nombre: 'Ocio y cultura',
    tipo: 'expense',
    hijos: [
      { nombre: 'Espectáculos y cultura', tipo: 'expense' },
      { nombre: 'Suscripciones y streaming', tipo: 'expense' },
      // Aparte de streaming a propósito: Adobe, un gestor de contraseñas o un
      // almacenamiento en la nube son herramienta, no ocio, y sumarlos con
      // Netflix en un mismo total hace que «cuánto me cuesta el
      // entretenimiento» conteste otra cosa. Cuelga de aquí y no de
      // 'Sociedad > Oficina' porque la mayoría de estas suscripciones las paga
      // la persona y no la sociedad — y cuando las paga la sociedad, eso lo
      // dice la dimensión entidad, que es el otro eje.
      { nombre: 'Software y herramientas', tipo: 'expense' },
      { nombre: 'Libros y prensa', tipo: 'expense' },
      { nombre: 'Deporte y gimnasio', tipo: 'expense' },
    ],
  },

  // ── Moverse ───────────────────────────────────────────────────────────────
  // 'Transporte' es el día a día (el coche, el metro, el taxi) y 'Viajes' es
  // salir de casa. La frontera importa porque son dos preguntas distintas del
  // cliente: el coste corriente de moverse no se compara con lo que costó
  // agosto.
  {
    nombre: 'Transporte',
    tipo: 'expense',
    hijos: [
      { nombre: 'Combustible', tipo: 'expense' },
      { nombre: 'Mantenimiento y taller', tipo: 'expense' },
      { nombre: 'Peajes y aparcamiento', tipo: 'expense' },
      { nombre: 'Transporte público', tipo: 'expense' },
      { nombre: 'Taxis y VTC', tipo: 'expense' },
      { nombre: 'Alquiler y renting', tipo: 'expense' },
    ],
  },

  {
    nombre: 'Viajes',
    tipo: 'expense',
    hijos: [
      { nombre: 'Vuelos', tipo: 'expense' },
      { nombre: 'Alojamiento', tipo: 'expense' },
      { nombre: 'Otros gastos de viaje', tipo: 'expense' },
    ],
  },

  // ── Seguros ───────────────────────────────────────────────────────────────
  // Juntos y no repartidos (el del coche dentro de 'Transporte', el del piso
  // dentro de 'Vivienda') porque "cuánto pagamos de seguros" es una pregunta
  // que este cliente hace y que hay que poder contestar con un número. A qué
  // casa o a qué sociedad corresponde cada póliza lo dice la dimensión.
  {
    nombre: 'Seguros',
    tipo: 'expense',
    hijos: [
      { nombre: 'Seguro de hogar', tipo: 'expense' },
      { nombre: 'Seguro de vehículos', tipo: 'expense' },
      { nombre: 'Seguro de salud', tipo: 'expense' },
      { nombre: 'Seguro de vida', tipo: 'expense' },
      { nombre: 'Responsabilidad civil', tipo: 'expense' },
    ],
  },

  // ── Honorarios profesionales ──────────────────────────────────────────────
  // Una familia con estructura paga asesor, abogado y notario todos los años, y
  // esos honorarios se reparten entre las personas y las sociedades de formas
  // que hay que poder justificar. En una taxonomía de consumo esto es, con
  // suerte, "servicios".
  {
    nombre: 'Honorarios profesionales',
    tipo: 'expense',
    hijos: [
      { nombre: 'Asesoría fiscal y contable', tipo: 'expense' },
      { nombre: 'Abogados', tipo: 'expense' },
      { nombre: 'Notaría y registro', tipo: 'expense' },
      { nombre: 'Arquitectura e ingeniería', tipo: 'expense' },
    ],
  },

  // ── Sociedad ──────────────────────────────────────────────────────────────
  // Sólo lo que NO existe fuera de una sociedad. La luz de la oficina, el
  // seguro de responsabilidad civil o los honorarios del asesor van en su
  // categoría por naturaleza y se atribuyen a la sociedad **por dimensión**:
  // duplicar el árbol entero bajo esta raíz sería exactamente el eje
  // equivocado, y dejaría el gasto de la sociedad fuera de cualquier
  // comparación con el del hogar.
  {
    nombre: 'Sociedad',
    tipo: 'expense',
    hijos: [
      { nombre: 'Constitución y registro mercantil', tipo: 'expense' },
      { nombre: 'Tasas y licencias', tipo: 'expense' },
      { nombre: 'Nóminas y Seguridad Social', tipo: 'expense' },
      { nombre: 'Oficina', tipo: 'expense' },
    ],
  },

  // ── Impuestos ─────────────────────────────────────────────────────────────
  // Cuatro y no uno porque en una familia con patrimonio son cuatro
  // liquidaciones distintas, con calendarios distintos y contribuyentes
  // distintos. Sucesiones y donaciones aparece poco y cuesta mucho: no tenerlo
  // preparado significa que el año que toca se clasifica a mano.
  {
    nombre: 'Impuestos',
    tipo: 'expense',
    hijos: [
      { nombre: 'IRPF', tipo: 'expense' },
      { nombre: 'Impuesto de sociedades', tipo: 'expense' },
      { nombre: 'Impuesto sobre el patrimonio', tipo: 'expense' },
      { nombre: 'Sucesiones y donaciones', tipo: 'expense' },
    ],
  },

  {
    nombre: 'Gastos financieros',
    tipo: 'expense',
    hijos: [
      { nombre: 'Comisiones bancarias', tipo: 'expense' },
      { nombre: 'Intereses de préstamos', tipo: 'expense' },
    ],
  },

  // ── Ingresos ──────────────────────────────────────────────────────────────
  // Alquileres y dividendos separados de la nómina porque para este cliente son
  // la parte que crece y la que se planifica; meterlos en "otros ingresos" —que
  // es donde los deja la taxonomía de cualquier agregador— es perder de vista
  // justamente el patrimonio.
  {
    nombre: 'Ingresos',
    tipo: 'income',
    hijos: [
      { nombre: 'Nóminas y salarios', tipo: 'income' },
      { nombre: 'Honorarios y facturación', tipo: 'income' },
      { nombre: 'Alquileres', tipo: 'income' },
      { nombre: 'Dividendos y distribuciones', tipo: 'income' },
      { nombre: 'Intereses y cupones', tipo: 'income' },
      { nombre: 'Pensiones', tipo: 'income' },
      { nombre: 'Devoluciones de impuestos', tipo: 'income' },
      { nombre: 'Otros ingresos', tipo: 'income' },
    ],
  },

  // ── Las dos bolsas del importador ─────────────────────────────────────────
  // Estos dos nombres son literales del código, no etiquetas: `import.ts` los
  // usa como contrapartida cuando no hay categoría (SUSPENSE_OUTFLOW_NAME y
  // SUSPENSE_INFLOW_NAME) y `classify.ts` los reconoce **por nombre** para
  // saber qué está sin clasificar. Renombrarlos acá no rompe ningún tipo:
  // rompe, en silencio, la lista de trabajo pendiente del cliente.
  //
  // Son dos porque el signo decide la clase de cuenta: un cobro sin categorizar
  // no es un gasto negativo, es un ingreso.
  //
  // Van en el árbol para que existan desde el minuto cero con la moneda base
  // del hogar. Si no, las crea el primer importe que caiga, que es lo mismo
  // pero con una cuenta apareciendo sola en el plan de cuentas.
  { nombre: 'Sin categorizar', tipo: 'expense' },
  { nombre: 'Ingresos sin categorizar', tipo: 'income' },
]

/** Un nodo con su sitio en el árbol ya resuelto. */
export interface CategoriaAplanada {
  readonly ruta: RutaDeCategoria
  readonly nombre: string
  readonly tipo: TipoDeCategoria
  /** null en las raíces. Es `account.parent_id` antes de tener ids. */
  readonly rutaDelPadre: RutaDeCategoria | null
  /** 0 en las raíces. */
  readonly profundidad: number
}

/**
 * El árbol en orden de creación: un padre siempre sale antes que sus hijos.
 *
 * Ese orden es el contrato útil: quien crea el hogar recorre la lista una vez
 * insertando, y cuando llega a un hijo el `parent_id` que necesita ya existe.
 * Sin él haría falta una segunda pasada o una inserción recursiva.
 *
 * Toma el árbol por parámetro —con el nuestro por defecto— porque el día que un
 * hogar tenga el suyo propio, la resolución de rutas tiene que valer igual.
 */
export function aplanarArbol(
  arbol: readonly NodoDeCategoria[] = ARBOL_POR_DEFECTO,
): readonly CategoriaAplanada[] {
  const salida: CategoriaAplanada[] = []
  const recorrer = (nodos: readonly NodoDeCategoria[], padre: RutaDeCategoria | null): void => {
    for (const nodo of nodos) {
      const ruta = padre === null ? nodo.nombre : `${padre}${SEPARADOR_DE_RUTA}${nodo.nombre}`
      salida.push({
        ruta,
        nombre: nodo.nombre,
        tipo: nodo.tipo,
        rutaDelPadre: padre,
        profundidad: padre === null ? 0 : ruta.split(SEPARADOR_DE_RUTA).length - 1,
      })
      recorrer(nodo.hijos ?? [], ruta)
    }
  }
  recorrer(arbol, null)
  return salida
}

/**
 * Resuelve una ruta contra un árbol. `undefined` si no existe.
 *
 * Devolver `undefined` en vez de lanzar es deliberado y es la misma regla que
 * gobierna la tabla de correspondencias: si el hogar reorganizó su plan de
 * cuentas y la ruta ya no está, lo correcto es no clasificar. Una excepción
 * acá pararía una importación entera por una categoría que alguien renombró.
 */
export function buscarPorRuta(
  ruta: RutaDeCategoria,
  arbol: readonly NodoDeCategoria[] = ARBOL_POR_DEFECTO,
): NodoDeCategoria | undefined {
  let nivel: readonly NodoDeCategoria[] = arbol
  let encontrado: NodoDeCategoria | undefined
  for (const nombre of ruta.split(SEPARADOR_DE_RUTA)) {
    encontrado = nivel.find((nodo) => nodo.nombre === nombre)
    if (encontrado === undefined) return undefined
    nivel = encontrado.hijos ?? []
  }
  return encontrado
}
