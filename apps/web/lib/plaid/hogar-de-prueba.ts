/**
 * El hogar de prueba que se conecta desde el sandbox de Plaid.
 *
 * Plaid, con su usuario por defecto, devuelve movimientos suyos: `Uber`,
 * `United Airlines`, `INTRST PYMNT`. Sirven para probar la fontanería y no
 * sirven para nada más — conectás «Banco Santander» y ves la vida de un
 * americano inventado.
 *
 * El sandbox admite un **usuario a medida**: se le pasa la configuración de
 * las cuentas y los movimientos, y Plaid los devuelve como si vinieran del
 * banco, **pasándolos igual por su motor de enriquecimiento**. Eso es lo que
 * lo hace valioso: los descriptores son españoles y de verdad, y la categoría
 * que Plaid les pone es la que le pondría a un cliente real.
 *
 * ── Un solo hogar, tres bancos ──────────────────────────────────────────────
 *
 * Los tres perfiles son de la MISMA familia, no tres demos sueltas. Eso
 * importa por una razón concreta: hay traspasos entre sus propias cuentas, y
 * las dos patas de un traspaso interno no son gasto ni ingreso. Es la señal
 * más segura del motor de clasificación y la que más distorsiona los totales
 * cuando falta, así que la demo tiene que contenerla.
 *
 * ── Los límites, dichos ─────────────────────────────────────────────────────
 *
 * **90 días.** El sandbox descarta lo que sea más viejo, se pida lo que se
 * pida en `days_requested` — comprobado. Los 24 meses que promete el producto
 * entran por fichero, que es justamente el tier Archivo.
 *
 * **Los importes son inventados por nosotros; las categorías no.** Ésa es toda
 * la gracia: el motor de Plaid no sabe que esto es una prueba.
 */

/** El corte. Todo cae dentro de la ventana que el sandbox conserva. */
const HOY = '2026-08-13'

/* ── Aritmética de fechas sobre texto ──────────────────────────────────────
 *
 * Sin `Date`: `new Date('2026-08-13')` se interpreta como UTC y en un huso al
 * oeste devuelve el día 12. Es la misma regla que en el resto del núcleo.
 */

function diasDesdeCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y
  const era = Math.floor(yy / 400)
  const yoe = yy - era * 400
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

function civilDesdeDias(z: number): string {
  const zz = z + 719468
  const era = Math.floor(zz / 146097)
  const doe = zz - era * 146097
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  )
  const y = yoe + era * 400
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp + (mp < 10 ? 3 : -9)
  const anio = m <= 2 ? y + 1 : y
  return `${String(anio).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function menosDias(iso: string, dias: number): string {
  const [y, m, d] = iso.split('-').map((p) => Number.parseInt(p, 10))
  return civilDesdeDias(diasDesdeCivil(y ?? 2026, m ?? 1, d ?? 1) - dias)
}

/* ── La forma que pide Plaid ───────────────────────────────────────────────── */

export interface MovimientoDePrueba {
  readonly date_transacted: string
  readonly date_posted: string
  /** Positivo = sale dinero. Es el convenio de Plaid, no el nuestro. */
  readonly amount: number
  readonly currency: string
  readonly description: string
}

export interface CuentaDePrueba {
  readonly type: 'depository' | 'credit'
  readonly subtype: string
  readonly starting_balance: number
  readonly currency: string
  readonly meta: { name: string; official_name: string; limit: number }
  readonly numbers: { account: string; ach_routing: string }
  readonly transactions: MovimientoDePrueba[]
}

export interface HogarDePrueba {
  readonly override_accounts: CuentaDePrueba[]
}

/* ── Generadores ───────────────────────────────────────────────────────────── */

const mov = (
  haceDias: number,
  importe: number,
  descripcion: string,
  moneda = 'EUR',
): MovimientoDePrueba => {
  const fecha = menosDias(HOY, haceDias)
  return {
    date_transacted: fecha,
    date_posted: fecha,
    amount: importe,
    currency: moneda,
    description: descripcion,
  }
}

/**
 * Una serie que se repite cada mes, con el importe fijo o variando un poco.
 *
 * La variación no es adorno: el detector de recurrentes sólo avisa de subidas
 * sobre series de importe **fijo**, así que la demo necesita las dos clases
 * para que esa distinción se vea. La luz varía; el colegio no.
 */
function mensual(
  descripcion: string,
  importe: number,
  diaDelMes: number,
  opciones: { variacion?: number; moneda?: string; meses?: number } = {},
): MovimientoDePrueba[] {
  const salida: MovimientoDePrueba[] = []
  const meses = opciones.meses ?? 3
  for (let i = 0; i < meses; i += 1) {
    const haceDias = i * 30 + ((28 - diaDelMes + 30) % 30)
    if (haceDias > 88) continue
    // Determinista: la misma llamada da siempre lo mismo. Nada de Math.random,
    // que haría que dos conexiones del mismo banco no se pudieran comparar.
    const desvio = opciones.variacion === undefined ? 0 : ((i * 7919) % 200) / 100 - 1
    const conDesvio = Math.round((importe + desvio * (opciones.variacion ?? 0)) * 100) / 100
    salida.push(mov(haceDias, conDesvio, descripcion, opciones.moneda))
  }
  return salida
}

/* ── Los tres bancos ───────────────────────────────────────────────────────── */

/**
 * BBVA: la cuenta del día a día. Nómina, hipoteca, suministros y colegio.
 *
 * Es la que sostiene la historia: si el motor no reconoce Iberdrola y
 * Movistar acá, no reconoce nada.
 */
const BBVA: HogarDePrueba = {
  override_accounts: [
    {
      type: 'depository',
      subtype: 'checking',
      starting_balance: 14820.44,
      currency: 'EUR',
      meta: {
        name: 'Cuenta Corriente',
        official_name: 'BBVA Cuenta Online Sin Comisiones',
        limit: 0,
      },
      numbers: { account: '1111222233334444', ach_routing: '011401533' },
      transactions: [
        // Ingreso. En el convenio de Plaid, negativo es dinero que entra.
        ...mensual('NOMINA ABONO EMPRESA IRIARTE PATRIMONIAL SL', -4850.0, 27),
        ...mensual('RECIBO PRESTAMO HIPOTECARIO 0182 CUOTA MENSUAL', 1284.6, 1),
        ...mensual('RECIBO IBERDROLA CLIENTES SAU LUZ', 101.01, 8, { variacion: 18 }),
        // Movistar sube la cuota en el último recibo, de 68,90 a 79,90.
        //
        // Es el caso que dispara la alerta de subida, y va a mano porque
        // `mensual` da series de importe estable. La alerta sólo mira series de
        // importe **fijo** —una factura de luz que varía cada mes no puede
        // avisar de nada—, así que la subida tiene que ocurrir sobre una que lo
        // sea. Es, además, la clase de cargo que se cuela sin que nadie lo
        // note: once euros al mes, todos los meses, para siempre.
        mov(46 + 30, 68.9, 'ADEUDO SEPA MOVISTAR TELEFONICA DE ESPANA'),
        mov(46, 68.9, 'ADEUDO SEPA MOVISTAR TELEFONICA DE ESPANA'),
        mov(16, 79.9, 'ADEUDO SEPA MOVISTAR TELEFONICA DE ESPANA'),
        ...mensual('RECIBO CANAL DE ISABEL II AGUA', 42.15, 15, { variacion: 9 }),
        ...mensual('CUOTA COLEGIO ESTUDIO SL MENSUALIDAD', 890.0, 5),
        ...mensual('TRANSFERENCIA COMUNIDAD PROPIETARIOS C/ SERRANO', 145.0, 3),
        mov(74, 386.22, 'RECIBO IBI AYUNTAMIENTO DE MADRID EJERCICIO 2026'),
        mov(41, 210.0, 'TGSS RECIBO AUTONOMOS REGIMEN ESPECIAL'),
        mov(18, 1240.5, 'AEAT MODELO 130 PAGO FRACCIONADO IRPF'),
        // Traspaso a su propia cuenta de CaixaBank. La otra pata está allá.
        mov(30, 1500.0, 'TRANSFERENCIA A CUENTA PROPIA CAIXABANK'),
        mov(60, 1500.0, 'TRANSFERENCIA A CUENTA PROPIA CAIXABANK'),
        mov(9, 60.0, 'BIZUM A FAVOR DE MARIA GARCIA CONCEPTO CENA'),
        mov(23, -45.0, 'BIZUM DE JAVIER MARTIN'),
        mov(52, 120.0, 'REINTEGRO CAJERO 4B OFICINA 0182'),
      ],
    },
  ],
}

/**
 * CaixaBank: la casa y el coche. Cuenta más tarjeta.
 *
 * La tarjeta es importante para la demo porque es una cuenta de **pasivo**:
 * su saldo es deuda, y comprobar que no se suma al patrimonio es justo el
 * error que el mapeador tuvo que corregir.
 */
const CAIXABANK: HogarDePrueba = {
  override_accounts: [
    {
      type: 'depository',
      subtype: 'checking',
      starting_balance: 6240.9,
      currency: 'EUR',
      meta: { name: 'Cuenta Casa Madrid', official_name: 'CaixaBank Cuenta Corriente', limit: 0 },
      numbers: { account: '2222333344445555', ach_routing: '011401533' },
      transactions: [
        ...mensual('RECIBO MAPFRE ESPANA SEGURO HOGAR POLIZA', 96.4, 10),
        ...mensual('RECIBO ALARMA SECURITAS DIRECT', 49.9, 20),
        ...mensual('NOMINA EMPLEADA HOGAR ALTA SEG SOCIAL', 1120.0, 28),
        mov(30, -1500.0, 'TRANSFERENCIA DESDE CUENTA PROPIA BBVA'),
        mov(60, -1500.0, 'TRANSFERENCIA DESDE CUENTA PROPIA BBVA'),
        mov(64, 3400.0, 'PAGO REFORMA COCINA CERTIFICACION OBRA 1'),
        mov(22, 2850.0, 'PAGO REFORMA COCINA CERTIFICACION OBRA 2'),
        mov(47, 180.0, 'HONORARIOS GESTORIA FISCAL Y CONTABLE'),
      ],
    },
    {
      type: 'credit',
      subtype: 'credit card',
      starting_balance: 1284.55,
      currency: 'EUR',
      meta: { name: 'Tarjeta Mastercard', official_name: 'CaixaBank Mastercard Oro', limit: 6000 },
      numbers: { account: '3333444455556666', ach_routing: '011401533' },
      transactions: [
        mov(2, 87.32, 'COMPRA TARJ 5432 MERCADONA MADRID SERRANO'),
        mov(6, 112.45, 'COMPRA TARJ 5432 CARREFOUR EXPRESS ALCALA'),
        mov(11, 64.2, 'COMPRA TARJ 5432 REPSOL E.S. 12345 MADRID'),
        mov(14, 230.0, 'PAGO EN EL CORTE INGLES SA CASTELLANA'),
        mov(19, 78.5, 'RENFE VIAJEROS BILLETE AVE MADRID BARCELONA'),
        mov(25, 42.8, 'COMPRA TARJ 5432 MERCADONA MADRID SERRANO'),
        mov(28, 58.9, 'RESTAURANTE CASA LUCIO MADRID'),
        mov(35, 96.0, 'COMPRA TARJ 5432 GALP ENERGIA ESPANA'),
        mov(49, 156.7, 'COMPRA TARJ 5432 IKEA IBERICA SA'),
        mov(56, 34.5, 'FARMACIA CENTRAL MADRID'),
        mov(70, 210.4, 'COMPRA TARJ 5432 DECATHLON ESPANA'),
        // Netflix se cobró dos meses y dejó de cobrarse: el último cargo fue
        // hace 32 días y el siguiente tendría que haber llegado ya. Es el caso
        // que dispara la alerta de «dejó de cobrarse», y está puesto a mano
        // porque una serie que se corta no la genera `mensual`.
        //
        // El espaciado tiene que ser de 30 días de verdad. Con huecos de 11 y
        // 19 el detector concluye «cada 15 días», que es cierto sobre los datos
        // y falso sobre el mundo: la demo enseñaría una alerta bien calculada
        // sobre una periodicidad que ninguna suscripción tiene.
        mov(32, 12.99, 'NETFLIX INTERNATIONAL BV REF 8812'),
        mov(62, 12.99, 'NETFLIX INTERNATIONAL BV REF 9903'),
      ],
    },
  ],
}

/**
 * Chase: el lado estadounidense, en dólares.
 *
 * Está para que el hogar sea multi-moneda de verdad. Y con eso los
 * consolidados van a declarar movimientos fuera del total, porque el motor de
 * tipo de cambio todavía no existe — que es exactamente lo que debe pasar y
 * lo que hay que ver en pantalla.
 */
const CHASE: HogarDePrueba = {
  override_accounts: [
    {
      type: 'depository',
      subtype: 'checking',
      starting_balance: 18450.12,
      currency: 'USD',
      meta: { name: 'Checking Miami', official_name: 'Chase Total Checking', limit: 0 },
      numbers: { account: '4444555566667777', ach_routing: '021000021' },
      transactions: [
        ...mensual('HOA ASSOCIATION BRICKELL CONDO DUES', 420.0, 1, { moneda: 'USD' }),
        ...mensual('FPL FLORIDA POWER LIGHT UTILITY', 138.4, 9, { variacion: 22, moneda: 'USD' }),
        ...mensual('CITIZENS PROPERTY INSURANCE PREMIUM', 310.0, 14, { moneda: 'USD' }),
        mov(7, 62.18, 'PUBLIX SUPER MARKET #0231 MIAMI FL', 'USD'),
        mov(16, 24.5, 'UBER TRIP HELP.UBER.COM', 'USD'),
        mov(21, 189.99, 'AMZN MKTP US*2M3TT0LO3', 'USD'),
        mov(29, 45.0, 'SHELL OIL 12345678 MIAMI FL', 'USD'),
        mov(38, -3200.0, 'RENTAL INCOME BRICKELL UNIT 1204', 'USD'),
        mov(51, 96.75, 'HOME DEPOT #6543 MIAMI FL', 'USD'),
        mov(68, -3200.0, 'RENTAL INCOME BRICKELL UNIT 1204', 'USD'),
      ],
    },
  ],
}

/* ── Índice ────────────────────────────────────────────────────────────────── */

/**
 * Qué hogar de prueba le corresponde a cada institución.
 *
 * Las que no están acá se conectan con el usuario por defecto de Plaid, que
 * devuelve sus datos genéricos. No es un fallo: sirve para comparar el
 * comportamiento del motor con descriptores que no escribimos nosotros.
 */
const POR_INSTITUCION: Readonly<Record<string, HogarDePrueba>> = {
  ins_68: BBVA,
  ins_76: CAIXABANK,
  ins_56: CHASE,
}

export function hogarDePrueba(institutionId: string): HogarDePrueba | undefined {
  return POR_INSTITUCION[institutionId]
}

/** Para la pantalla: cuántos movimientos y cuentas trae cada uno. */
export function resumenDelHogar(
  institutionId: string,
): { cuentas: number; movimientos: number } | undefined {
  const hogar = POR_INSTITUCION[institutionId]
  if (hogar === undefined) return undefined
  return {
    cuentas: hogar.override_accounts.length,
    movimientos: hogar.override_accounts.reduce((n, c) => n + c.transactions.length, 0),
  }
}
