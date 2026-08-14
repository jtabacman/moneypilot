import { describe, expect, it } from 'vitest'
import { ARBOL_POR_DEFECTO, aplanarArbol, buscarPorRuta, type NodoDeCategoria } from './arbol.js'
import {
  CORRESPONDENCIAS_POR_PROVEEDOR,
  type CorrespondenciaDeCategoria,
  mapearCategoriaDeProveedor,
} from './correspondencia.js'
import { CATEGORIAS_DETALLADAS_DE_PLAID, CORRESPONDENCIAS_DE_PLAID } from './plaid.js'

const APLANADO = aplanarArbol()

describe('mapearCategoriaDeProveedor', () => {
  it('traduce la categoría del proveedor a una ruta nuestra', () => {
    expect(mapearCategoriaDeProveedor('plaid', 'GENERAL_SERVICES_INSURANCE')).toEqual({
      ruta: 'Seguros',
      confianza: 'alta',
    })
  })

  it('devuelve undefined cuando no hay equivalencia, en vez de aproximar', () => {
    // GENERAL_SERVICES_OTHER_GENERAL_SERVICES existe en la taxonomía de Plaid y
    // no está en la tabla a propósito: cabe en tres categorías nuestras. Que la
    // función devuelva undefined es lo que mantiene el movimiento en la cola de
    // revisión en vez de inventarle un destino.
    expect(
      mapearCategoriaDeProveedor('plaid', 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES'),
    ).toBeUndefined()
    expect(mapearCategoriaDeProveedor('plaid', 'CATEGORIA_QUE_NO_EXISTE')).toBeUndefined()
  })

  it('no traduce el `primary`, que es un encabezado y no una categoría', () => {
    // Si esto empezara a devolver algo, cada compra en unos grandes almacenes y
    // cada libro caerían en la misma cuenta por igual.
    expect(mapearCategoriaDeProveedor('plaid', 'GENERAL_MERCHANDISE')).toBeUndefined()
    expect(mapearCategoriaDeProveedor('plaid', 'TRANSPORTATION')).toBeUndefined()
  })

  it('tolera espacios y minúsculas porque el valor puede venir de `raw`', () => {
    // En el feed la categoría llega del JSON; en un movimiento ya persistido
    // llega de una columna de texto que pasó por el aplanador. Las dos rutas
    // tienen que dar lo mismo.
    expect(mapearCategoriaDeProveedor('plaid', '  transportation_gas ')).toEqual(
      mapearCategoriaDeProveedor('plaid', 'TRANSPORTATION_GAS'),
    )
  })

  it('es determinista: la misma entrada da exactamente el mismo objeto', () => {
    // El producto promete poder contestar "¿por qué esta categoría?". Si dos
    // llamadas iguales pudieran diferir, la respuesta de ayer no explicaría el
    // asiento de ayer.
    const primera = mapearCategoriaDeProveedor('plaid', 'TRAVEL_FLIGHTS')
    const segunda = mapearCategoriaDeProveedor('plaid', 'TRAVEL_FLIGHTS')
    expect(primera).toEqual({ ruta: 'Viajes > Vuelos', confianza: 'alta' })
    expect(segunda).toBe(primera)
  })
})

describe('la tabla de Plaid', () => {
  it('sólo usa claves que existen en la taxonomía oficial', () => {
    // Una clave mal escrita no falla: no coincide nunca y la traducción se
    // pierde en silencio para siempre. Es el fallo más caro de esta tabla y el
    // único que no se nota mirando la pantalla.
    const oficiales = new Set(CATEGORIAS_DETALLADAS_DE_PLAID)
    const inventadas = [...CORRESPONDENCIAS_DE_PLAID.keys()].filter((c) => !oficiales.has(c))
    expect(inventadas).toEqual([])
  })

  it('apunta siempre a una ruta que existe en el árbol', () => {
    // Lo mismo por el otro lado: una ruta con un nombre viejo no clasifica
    // nada. Renombrar un nodo del árbol tiene que romper acá y no en el alta
    // del cliente.
    const rotas = [...CORRESPONDENCIAS_DE_PLAID.values()]
      .map((c) => c.ruta)
      .filter((ruta) => buscarPorRuta(ruta) === undefined)
    expect(rotas).toEqual([])
  })

  it('no manda un gasto a una cuenta de ingreso ni al revés', () => {
    // El signo del asiento no lo decide la categoría, así que este error no
    // rompe el balance: sólo hace que un gasto reste de los ingresos del mes.
    // Cuadra, y está mal.
    const cruzadas: string[] = []
    for (const [categoria, correspondencia] of CORRESPONDENCIAS_DE_PLAID) {
      const nodo = buscarPorRuta(correspondencia.ruta)
      const esperado = categoria.startsWith('INCOME_') ? 'income' : 'expense'
      if (nodo?.tipo !== esperado) cruzadas.push(categoria)
    }
    expect(cruzadas).toEqual([])
  })

  it('deja sin traducir los traspasos entre cuentas propias', () => {
    // Medido contra el corpus: un traspaso a tu propia cuenta no es una compra.
    // Estos movimientos los resuelve el emparejador de transferencias con la
    // señal estructural, y ponerles categoría de gasto duplicaría el gasto del
    // hogar en el informe.
    const traspasos = CATEGORIAS_DETALLADAS_DE_PLAID.filter(
      (c) => c.startsWith('TRANSFER_IN_') || c.startsWith('TRANSFER_OUT_'),
    )
    expect(traspasos).toHaveLength(11)
    for (const categoria of traspasos) {
      expect(mapearCategoriaDeProveedor('plaid', categoria)).toBeUndefined()
    }
  })

  it('deja sin traducir la liquidación de la tarjeta', () => {
    // El caso que más caro sale: si la liquidación mensual entrara como gasto,
    // el consumo de la tarjeta se contaría dos veces —en cada compra y en el
    // pago— y el total del año saldría casi al doble.
    expect(mapearCategoriaDeProveedor('plaid', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT')).toBeUndefined()
  })

  it('deja sin traducir la amortización de deuda, que no es gasto', () => {
    // Devolver principal baja la deuda: es balance, no gasto del año. Plaid no
    // separa principal de intereses, así que la única respuesta honesta es no
    // clasificar. La hipoteca es la excepción documentada.
    for (const categoria of [
      'LOAN_PAYMENTS_CAR_PAYMENT',
      'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT',
      'LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT',
      'LOAN_PAYMENTS_OTHER_PAYMENT',
    ]) {
      expect(mapearCategoriaDeProveedor('plaid', categoria)).toBeUndefined()
    }
  })

  it('nunca manda nada a las bolsas del importador', () => {
    // Clasificar en 'Sin categorizar' es un no-op que además borra la
    // diferencia entre "nadie lo miró" y "lo miramos y no supimos": la cola de
    // trabajo pendiente dejaría de distinguirlas.
    const bolsas = new Set(['Sin categorizar', 'Ingresos sin categorizar'])
    for (const { ruta } of CORRESPONDENCIAS_DE_PLAID.values()) {
      expect(bolsas.has(ruta)).toBe(false)
    }
  })

  it("no traduce 'OTHER_OTHER', que Plaid emite y no documenta", () => {
    // Medido contra el sandbox: un Bizum recibido vuelve con esta categoría,
    // que no está en el CSV oficial. Significa "no lo sé", y traducir un "no lo
    // sé" a una categoría del hogar es inventar la respuesta que el proveedor
    // no dio. El test está para que nadie la añada creyendo que es un olvido.
    expect(CATEGORIAS_DETALLADAS_DE_PLAID).not.toContain('OTHER_OTHER')
    expect(mapearCategoriaDeProveedor('plaid', 'OTHER_OTHER')).toBeUndefined()
  })

  it('cubre 85 de las 104 categorías y deja 19 huecos deliberados', () => {
    // El número no es un objetivo, es un testigo: si alguien añade veinte
    // entradas para que la demo se vea mejor, este test lo cuenta en voz alta.
    expect(CATEGORIAS_DETALLADAS_DE_PLAID).toHaveLength(104)
    expect(CORRESPONDENCIAS_DE_PLAID.size).toBe(85)
  })

  it('está registrada bajo su proveedor', () => {
    expect(CORRESPONDENCIAS_POR_PROVEEDOR.plaid).toBe(CORRESPONDENCIAS_DE_PLAID)
  })
})

describe('ARBOL_POR_DEFECTO', () => {
  it('no repite ningún nombre en todo el árbol', () => {
    // `account_name_unique` es (tenant_id, name): el nombre es único en el
    // hogar entero, no dentro de su rama. Dos nodos con el mismo nombre no
    // fallan acá, fallan al insertar el segundo mientras se crea el hogar del
    // cliente.
    const nombres = APLANADO.map((c) => c.nombre)
    const repetidos = nombres.filter((nombre, i) => nombres.indexOf(nombre) !== i)
    expect(repetidos).toEqual([])
  })

  it('no mezcla gasto e ingreso dentro de una rama', () => {
    // Una subcategoría de ingreso colgando de un gasto haría que el rollup del
    // padre sumara cosas de signo contrario.
    const porRuta = new Map(APLANADO.map((c) => [c.ruta, c]))
    for (const categoria of APLANADO) {
      if (categoria.rutaDelPadre === null) continue
      expect(porRuta.get(categoria.rutaDelPadre)?.tipo).toBe(categoria.tipo)
    }
  })

  it('trae las bolsas del importador con el nombre exacto que espera el código', () => {
    // Estos dos literales están duplicados en import.ts (SUSPENSE_*_NAME) y en
    // classify.ts (esSinCategorizar), que los reconoce por nombre porque nada
    // marca a una cuenta como bolsa. Cambiar el nombre acá rompe la cola de
    // trabajo pendiente sin que falle ningún tipo.
    const raices = ARBOL_POR_DEFECTO.map((n) => n.nombre)
    expect(raices).toContain('Sin categorizar')
    expect(raices).toContain('Ingresos sin categorizar')
  })

  it('tiene lo que una taxonomía de consumo no tiene', () => {
    // El encargo entero: este plan de cuentas es para una familia con
    // estructura, no una lista de rubros de tienda. Si alguien poda estos
    // nodos, el producto deja de servir para el cliente que lo paga.
    const rutas = new Set(APLANADO.map((c) => c.ruta))
    for (const ruta of [
      'Vivienda > Comunidad de propietarios',
      'Vivienda > IBI y tasas municipales',
      'Personal doméstico > Salarios del personal',
      'Personal doméstico > Seguridad Social del personal',
      'Sociedad > Constitución y registro mercantil',
      'Sociedad > Nóminas y Seguridad Social',
      'Honorarios profesionales > Asesoría fiscal y contable',
      'Honorarios profesionales > Notaría y registro',
      'Impuestos > Impuesto sobre el patrimonio',
      'Impuestos > Impuesto de sociedades',
    ]) {
      expect(rutas.has(ruta)).toBe(true)
    }
  })

  it('no crea una categoría por propiedad ni por sociedad', () => {
    // Cuál de las casas o cuál de las sociedades es una DIMENSIÓN, que es otro
    // eje y ya existe. Meterlo en el árbol lo multiplicaría por el número de
    // propiedades e impediría preguntar "cuánto pagamos de comunidad en total".
    for (const { nombre } of APLANADO) {
      expect(nombre).not.toMatch(/\b(Madrid|Sotogrande|Marbella|SL|S\.L\.|SA|S\.A\.)\b/)
    }
  })
})

describe('aplanarArbol', () => {
  it('devuelve cada padre antes que sus hijos', () => {
    // Es el contrato que hace que crear el hogar sea un solo recorrido: cuando
    // llega el hijo, el parent_id que necesita ya se insertó.
    const vistas = new Set<string>()
    for (const categoria of APLANADO) {
      if (categoria.rutaDelPadre !== null) expect(vistas.has(categoria.rutaDelPadre)).toBe(true)
      vistas.add(categoria.ruta)
    }
  })

  it('compone la ruta con el separador y calcula la profundidad', () => {
    const agua = APLANADO.find((c) => c.nombre === 'Agua')
    expect(agua).toEqual({
      ruta: 'Vivienda > Suministros > Agua',
      nombre: 'Agua',
      tipo: 'expense',
      rutaDelPadre: 'Vivienda > Suministros',
      profundidad: 2,
    })
  })

  it('sirve para cualquier árbol, no sólo para el nuestro', () => {
    // El día que un hogar tenga su propio plan de cuentas, resolver rutas tiene
    // que seguir valiendo.
    const propio: readonly NodoDeCategoria[] = [
      { nombre: 'Finca', tipo: 'expense', hijos: [{ nombre: 'Ganado', tipo: 'expense' }] },
    ]
    expect(aplanarArbol(propio).map((c) => c.ruta)).toEqual(['Finca', 'Finca > Ganado'])
    expect(buscarPorRuta('Finca > Ganado', propio)?.nombre).toBe('Ganado')
  })
})

describe('buscarPorRuta', () => {
  it('resuelve una ruta completa y no una parcial', () => {
    expect(buscarPorRuta('Vivienda > Suministros > Luz y gas')?.tipo).toBe('expense')
    // 'Luz y gas' existe, pero no cuelga de la raíz: una ruta es un camino, no
    // una búsqueda por nombre. Si aceptara el nombre suelto, dos categorías
    // homónimas en ramas distintas serían indistinguibles.
    expect(buscarPorRuta('Luz y gas')).toBeUndefined()
  })

  it('devuelve undefined en vez de lanzar cuando la ruta no existe', () => {
    // Una excepción acá pararía la importación entera porque alguien renombró
    // una categoría. Lo correcto es no clasificar ese movimiento.
    expect(buscarPorRuta('Vivienda > Piscina')).toBeUndefined()
    expect(buscarPorRuta('')).toBeUndefined()
  })
})

describe('el contrato entre la tabla y el árbol', () => {
  it('cada correspondencia tiene una confianza declarada de las dos que hay', () => {
    // No existe 'baja' a propósito: por debajo de media no hay entrada. Si
    // apareciera un tercer nivel, el motor que hoy decide "aplico las altas y
    // propongo las medias" empezaría a ignorar entradas sin avisar.
    const niveles = new Set([...CORRESPONDENCIAS_DE_PLAID.values()].map((c) => c.confianza))
    expect([...niveles].sort()).toEqual(['alta', 'media'])
  })

  it('las de confianza alta apuntan a una hoja o a un padre defendible', () => {
    // Una traducción de confianza alta que apunte a una raíz enorme como
    // 'Vivienda' no es alta: es un cajón. Se permite el padre sólo donde la
    // familia entera significa lo mismo ('Seguros').
    const altasEnRaiz = [...CORRESPONDENCIAS_DE_PLAID.entries()]
      .filter(([, c]) => c.confianza === 'alta')
      .map(([, c]) => c.ruta)
      .filter((ruta) => !ruta.includes('>'))
    expect(altasEnRaiz).toEqual(['Seguros'])
  })

  it('no hay correspondencias huérfanas de proveedor', () => {
    const tablas: readonly ReadonlyMap<string, CorrespondenciaDeCategoria>[] = Object.values(
      CORRESPONDENCIAS_POR_PROVEEDOR,
    )
    for (const tabla of tablas) expect(tabla.size).toBeGreaterThan(0)
  })
})
