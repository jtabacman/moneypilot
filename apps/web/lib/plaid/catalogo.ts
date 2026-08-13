/**
 * Las entidades que se ofrecen para conectar en la demo.
 *
 * ── Por qué es una lista escrita a mano y no una búsqueda ───────────────────
 *
 * Con finAPI el catálogo se pide por la red porque sus bancos de prueba son
 * inventados y hay que descubrirlos. Acá el problema es el contrario: el
 * catálogo de Plaid tiene 10.097 instituciones en EE. UU. y 78 en España, y una
 * lista de diez mil bancos no es un selector, es un buscador — y un buscador
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
 * los movimientos que el sandbox genera detrás. Con finAPI la confusión era
 * imposible —los bancos se llamaban "FinAPI Test Bank"—; acá alguien puede leer
 * "BBVA · Plaid Current Account" en su lista de cuentas dentro de un mes y creer
 * que conectó su banco. Por eso el aviso de la pantalla insiste en esto y no
 * sólo en que el dinero no existe.
 *
 * Y hay un dato medido que decide el orden: **BBVA devuelve cuentas en euros**.
 * El banco de prueba clásico de Plaid (First Platypus) las da en dólares, lo
 * que en un producto cuyo corredor es España obliga a mirar un patrimonio en
 * una moneda que no es la del hogar. Con BBVA la demo se ve como se va a ver de
 * verdad: seis cuentas en EUR, corriente, ahorro, dos tarjetas y una hipoteca.
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
    nota: 'Seis cuentas en euros: corriente, ahorro, empresa, dos tarjetas y una hipoteca. Es la más parecida a lo que va a ver un hogar español.',
  },
  {
    id: 'ins_76',
    nombre: 'CaixaBank',
    pais: 'ES',
    moneda: 'EUR',
    real: true,
    nota: 'Entidad española real, autenticación OAuth. Mismas cuentas simuladas en euros.',
  },
  {
    id: 'ins_28',
    nombre: 'Santander · Personal',
    pais: 'US',
    moneda: 'USD',
    real: true,
    nota: 'La ficha estadounidense de Santander. Sirve para ver el corredor de EE. UU. con un nombre conocido.',
  },
  {
    id: 'ins_56',
    nombre: 'Chase',
    pais: 'US',
    moneda: 'USD',
    real: true,
    nota: 'El banco más grande de EE. UU., con OAuth. Cuentas simuladas en dólares.',
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
