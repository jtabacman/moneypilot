/**
 * Las entidades que se ofrecen para conectar en la demo.
 *
 * ── Por qué es una lista escrita a mano y no una búsqueda ───────────────────
 *
 * El catálogo de Plaid tiene 10.097 instituciones en EE. UU. y 78 en España, y
 * una lista de diez mil bancos no es un selector, es un buscador — y un buscador
 * para elegir un banco de prueba es trabajo que no le sirve a nadie.
 *
 * Así que se eligen unas pocas y se dice de dónde salieron. Los identificadores
 * están comprobados contra el sandbox: para cada uno se pidió
 * `/institutions/search` y después `/sandbox/public_token/create`, y los seis
 * contestaron 200. Si alguno dejara de existir, `buscarInstituciones` sigue en
 * el cliente para encontrar su reemplazo por nombre.
 *
 * ── Los bancos son reales y eso confunde más, no menos ──────────────────────
 *
 * BBVA, CaixaBank, Santander y Chase de esta lista **son las entidades de
 * verdad**, con su identificador de producción. Lo simulado son las cuentas y
 * los movimientos que hay detrás. Alguien puede leer "BBVA · Banca Personal"
 * en su lista de cuentas dentro de un mes y creer que conectó su banco; por eso
 * el aviso de la pantalla insiste en esto y no sólo en que el dinero no existe.
 *
 * ── Tres de ellas traen un hogar escrito por nosotros ───────────────────────
 *
 * BBVA, CaixaBank y Chase se conectan con el usuario a medida de
 * `hogar-de-prueba.ts`: cuentas y movimientos españoles, de un único hogar, con
 * traspasos entre sus propias cuentas. Las otras tres se conectan con el usuario
 * por defecto de Plaid, que devuelve datos suyos —estadounidenses y genéricos—.
 * Eso no es un hueco: es el grupo de control contra descriptores que no
 * escribimos nosotros, y es donde se ve qué hace el motor con lo desconocido.
 */

export interface InstitucionDePrueba {
  /** El identificador de Plaid. `ins_68`, `ins_109508`. */
  readonly id: string
  readonly nombre: string
  /** ISO 3166-1 alfa-2. Lo que separa "esto es de tu país" de lo que no. */
  readonly pais: string
  /** La moneda en la que el sandbox devuelve sus cuentas. Medido, no supuesto. */
  readonly moneda: string
  /** true si la entidad es la de verdad y no un banco inventado para probar. */
  readonly real: boolean
  /** Qué se ve al conectarla. Una frase, para que elegir no sea adivinar. */
  readonly nota: string
}

export const INSTITUCIONES_DE_PRUEBA: readonly InstitucionDePrueba[] = [
  {
    id: 'ins_68',
    nombre: 'BBVA · Banca Personal',
    pais: 'ES',
    moneda: 'EUR',
    real: true,
    nota: 'La cuenta del día a día: nómina, hipoteca, Iberdrola, Movistar, colegio, IBI y el IRPF trimestral. 29 movimientos en euros.',
  },
  {
    id: 'ins_76',
    nombre: 'CaixaBank',
    pais: 'ES',
    moneda: 'EUR',
    real: true,
    nota: 'La casa y la tarjeta: seguros, alarma, empleada de hogar, la reforma de la cocina y 13 compras con Mastercard. 27 movimientos en euros, en dos cuentas.',
  },
  {
    id: 'ins_28',
    nombre: 'Santander · Personal',
    pais: 'US',
    moneda: 'USD',
    real: true,
    nota: 'La ficha estadounidense de Santander, con los datos de ejemplo de Plaid. Grupo de control: descriptores que no escribimos nosotros.',
  },
  {
    id: 'ins_56',
    nombre: 'Chase',
    pais: 'US',
    moneda: 'USD',
    real: true,
    nota: 'La pata estadounidense del mismo hogar: el piso de Miami, con su alquiler cobrado, la comunidad y los suministros. 16 movimientos en dólares.',
  },
  {
    id: 'ins_109508',
    nombre: 'First Platypus Bank (banco de prueba)',
    pais: 'US',
    moneda: 'USD',
    real: false,
    nota: 'El banco de prueba clásico de Plaid: doce cuentas, 48 movimientos y 16 correcciones en la carga inicial. Es el corpus con el que se midió todo esto.',
  },
  {
    id: 'ins_109509',
    nombre: 'First Gingham Credit Union (banco de prueba)',
    pais: 'US',
    moneda: 'USD',
    real: false,
    nota: 'Otro banco de prueba, para tener dos conexiones a la vez y comprobar que cada una lleva su propio cursor.',
  },
]

/** El de arriba de la lista. Es el que se conecta si nadie elige nada. */
export const INSTITUCION_POR_DEFECTO = INSTITUCIONES_DE_PRUEBA[0]?.id ?? 'ins_68'

/**
 * Los identificadores de Plaid son `ins_` y dígitos. Se valida antes de salir a
 * la red porque el valor llega de un formulario, y un `institution_id` con
 * forma rara sólo puede acabar en un 400 que no explica nada.
 */
export const ID_DE_INSTITUCION = /^ins_[0-9A-Za-z]{1,32}$/

export function institucionDePrueba(id: string): InstitucionDePrueba | null {
  return INSTITUCIONES_DE_PRUEBA.find((banco) => banco.id === id) ?? null
}
