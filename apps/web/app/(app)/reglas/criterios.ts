/**
 * Los criterios de una regla, tal como viajan por la pantalla.
 *
 * Tres cosas los leen y las tres tienen que leer lo mismo:
 *
 *  1. **La query string**, que es de donde sale la vista previa. El estado de
 *     esta pantalla es la URL, igual que en /movimientos: así el «esta regla
 *     afecta a 342 movimientos» se puede pegar en un correo, que es
 *     literalmente lo que hace un contador cuando propone una regla.
 *  2. **El FormData** de la acción que guarda.
 *  3. **Una regla ya guardada**, cuando se abre para editarla.
 *
 * De ahí `firmaDe`: la vista previa se calcula sobre unos criterios y el
 * usuario aplica sobre otros si tocó un campo sin volver a previsualizar. La
 * firma es lo que convierte esa discrepancia en una pregunta en vez de en una
 * pasada de categorización que nadie miró.
 *
 * Ni un `Number` con decimales en todo el módulo: los importes se parsean a
 * bigint de unidades mínimas sobre el texto, dígito a dígito.
 */

import type { MatchKind, RuleDimensionInput, RuleMatch, RuleRow } from '@moneypilot/db'
import { minorUnits } from '@/lib/format'

/* ── Forma ───────────────────────────────────────────────────────────────── */

/**
 * Cómo se acota el importe.
 *
 * El rango de la regla se compara **con signo** contra la pata bancaria: un
 * cargo de 45,20 es −4520. Traducir «gastos de entre 10 y 100 €» a ese rango es
 * trabajo de esta pantalla y no de la regla —lo dice la migración 006—, porque
 * nadie escribe «de −100 a −10» y quien lo intenta lo escribe al revés.
 */
export type Direccion = 'cualquiera' | 'cargos' | 'abonos'

export interface DimensionElegida {
  readonly dimensionId: string
  readonly valueId: string
  /** Porcentaje tal como lo escribió el usuario. Vacío es el 100%. */
  readonly peso: string
}

export interface Criterios {
  readonly nombre: string
  readonly tipo: MatchKind
  readonly texto: string
  readonly cuentaId: string | null
  readonly direccion: Direccion
  /** Importe en valor absoluto, como texto. El signo lo pone `direccion`. */
  readonly min: string
  readonly max: string
  readonly categoriaId: string | null
  readonly dimensiones: readonly DimensionElegida[]
  readonly prioridad: number
  readonly activa: boolean
  /** No es un campo de la regla: es cómo se aplica. Ver `firmaDe`. */
  readonly soloSinCategorizar: boolean
}

export const DEFECTO: Criterios = {
  nombre: '',
  tipo: 'contiene',
  texto: '',
  cuentaId: null,
  direccion: 'cualquiera',
  min: '',
  max: '',
  categoriaId: null,
  dimensiones: [],
  prioridad: 0,
  activa: true,
  // Marcada por defecto: aplicar encima de lo que alguien ya categorizó a mano
  // le borra el trabajo, y en una pasada de dos mil movimientos eso no se nota
  // hasta que ya pasó.
  soloSinCategorizar: true,
}

const TIPOS: readonly MatchKind[] = ['contiene', 'empieza', 'exacto', 'regex']

export const ETIQUETA_TIPO: Readonly<Record<MatchKind, string>> = {
  contiene: 'contiene',
  empieza: 'empieza por',
  exacto: 'es exactamente',
  regex: 'expresión regular',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/* ── De dónde vienen los campos ──────────────────────────────────────────── */

export interface Campos {
  /** El valor de un campo, ya recortado, o null si no vino. */
  readonly uno: (nombre: string) => string | null
  /**
   * Si esto viene de un formulario enviado.
   *
   * Sin el dato no hay forma de distinguir «casilla desmarcada» —que no manda
   * nada— de «pantalla recién abierta», y la regla nueva llegaría siempre
   * desactivada y pisando el trabajo hecho a mano.
   */
  readonly enviado: boolean
}

export type QueryParams = Record<string, string | string[] | undefined>

export function camposDeQuery(params: QueryParams): Campos {
  return {
    uno: (nombre) => {
      const valor = params[nombre]
      const bruto = Array.isArray(valor) ? valor[0] : valor
      return bruto === undefined ? null : bruto.trim()
    },
    enviado: params['enviado'] !== undefined,
  }
}

export function camposDeForm(form: FormData): Campos {
  return {
    uno: (nombre) => {
      const valor = form.get(nombre)
      return typeof valor === 'string' ? valor.trim() : null
    },
    enviado: true,
  }
}

/* ── Leer ────────────────────────────────────────────────────────────────── */

/**
 * Los criterios que pide la pantalla, campo a campo, sobre una base.
 *
 * La base es `DEFECTO` en una regla nueva y la regla guardada cuando se está
 * editando. Un campo que no llegó conserva el de la base: así `?texto=NETFLIX`
 * —que es como se entra desde /movimientos— rellena el descriptor sin borrar
 * todo lo demás.
 */
export function leerCriterios(
  campos: Campos,
  opts: { base?: Criterios | undefined; dimensionIds: readonly string[] },
): Criterios {
  const base = opts.base ?? DEFECTO

  const tipoBruto = campos.uno('tipo')
  const tipo = TIPOS.find((candidato) => candidato === tipoBruto) ?? base.tipo

  const direccionBruta = campos.uno('direccion')
  const direccion: Direccion =
    direccionBruta === 'cargos' || direccionBruta === 'abonos' || direccionBruta === 'cualquiera'
      ? direccionBruta
      : base.direccion

  const prioridadBruta = campos.uno('prioridad')
  const prioridad =
    prioridadBruta === null || prioridadBruta === ''
      ? base.prioridad
      : Number.parseInt(prioridadBruta, 10)

  return {
    nombre: campos.uno('nombre') ?? base.nombre,
    tipo,
    texto: campos.uno('texto') ?? base.texto,
    cuentaId: id(campos.uno('cuenta'), base.cuentaId),
    direccion,
    min: campos.uno('min') ?? base.min,
    max: campos.uno('max') ?? base.max,
    categoriaId: id(campos.uno('categoria'), base.categoriaId),
    dimensiones: leerDimensiones(campos, opts.dimensionIds, base.dimensiones),
    prioridad: Number.isFinite(prioridad) ? prioridad : base.prioridad,
    activa: casilla(campos, 'activa', base.activa),
    soloSinCategorizar: casilla(campos, 'solo', base.soloSinCategorizar),
  }
}

/** Un uuid del formulario. Vacío significa «ninguno» y tiene que pisar la base. */
function id(valor: string | null, base: string | null): string | null {
  if (valor === null) return base
  return UUID.test(valor) ? valor : null
}

function casilla(campos: Campos, nombre: string, base: boolean): boolean {
  if (!campos.enviado) return base
  return campos.uno(nombre) !== null
}

function leerDimensiones(
  campos: Campos,
  dimensionIds: readonly string[],
  base: readonly DimensionElegida[],
): DimensionElegida[] {
  const previas = new Map(base.map((dim) => [dim.dimensionId, dim]))
  const out: DimensionElegida[] = []

  for (const dimensionId of dimensionIds) {
    const valor = campos.uno(`dim.${dimensionId}`)
    if (valor === null) {
      const previa = previas.get(dimensionId)
      if (previa !== undefined) out.push(previa)
      continue
    }
    if (!UUID.test(valor)) continue
    const peso = campos.uno(`peso.${dimensionId}`) ?? previas.get(dimensionId)?.peso ?? ''
    out.push({ dimensionId, valueId: valor, peso })
  }

  return out
}

/* ── Firma ───────────────────────────────────────────────────────────────── */

/**
 * Qué criterios producen ESTE impacto.
 *
 * Entra todo lo que decide a qué movimientos toca la regla y qué les hace,
 * incluido `soloSinCategorizar`. Quedan fuera el nombre, la prioridad y si está
 * activa: cambiarlos no cambia lo que enseñó la vista previa, y obligar a
 * previsualizar de nuevo por corregir una errata en el nombre entrena a la
 * gente a pulsar sin mirar, que es el hábito que esta pantalla existe para
 * evitar.
 */
export function firmaDe(c: Criterios): string {
  const dimensiones = [...c.dimensiones]
    .sort((a, b) => a.dimensionId.localeCompare(b.dimensionId))
    .map((dim) => `${dim.dimensionId}:${dim.valueId}:${dim.peso}`)
    .join(',')

  return [
    c.tipo,
    c.texto,
    c.cuentaId ?? '',
    c.direccion,
    c.min,
    c.max,
    c.categoriaId ?? '',
    dimensiones,
    c.soloSinCategorizar ? 'solo' : 'todos',
  ].join('|')
}

/* ── Volver a la URL ─────────────────────────────────────────────────────── */

/**
 * La query string canónica de unos criterios.
 *
 * `enviado` va siempre: es lo que le dice a `leerCriterios` que las casillas
 * que faltan están desmarcadas de verdad.
 */
export function aQuery(c: Criterios): Record<string, string> {
  const q: Record<string, string> = { enviado: '1', tipo: c.tipo }
  if (c.nombre !== '') q['nombre'] = c.nombre
  if (c.texto !== '') q['texto'] = c.texto
  if (c.cuentaId !== null) q['cuenta'] = c.cuentaId
  if (c.direccion !== 'cualquiera') q['direccion'] = c.direccion
  if (c.min !== '') q['min'] = c.min
  if (c.max !== '') q['max'] = c.max
  if (c.categoriaId !== null) q['categoria'] = c.categoriaId
  for (const dim of c.dimensiones) {
    q[`dim.${dim.dimensionId}`] = dim.valueId
    if (dim.peso !== '') q[`peso.${dim.dimensionId}`] = dim.peso
  }
  if (c.prioridad !== 0) q['prioridad'] = String(c.prioridad)
  if (c.activa) q['activa'] = '1'
  if (c.soloSinCategorizar) q['solo'] = '1'
  return q
}

/* ── Importes ────────────────────────────────────────────────────────────── */

export type Importe =
  | { readonly estado: 'vacio' }
  | { readonly estado: 'ok'; readonly valor: bigint }
  | { readonly estado: 'error'; readonly motivo: string }

/**
 * «1234,56» → 123456n, con los decimales de la moneda.
 *
 * A mano y sobre el texto, sin `parseFloat`: convertir a coma flotante para
 * «sólo leer un importe» reintroduce el error de redondeo justo en el borde
 * donde el usuario escribe el número. El separador de miles se rechaza en vez
 * de adivinarse — «1.234» es mil doscientos treinta y cuatro en España y uno
 * coma dos tres cuatro en medio mundo, y equivocarse acota la regla a un
 * importe mil veces menor sin que nada avise.
 */
export function aUnidadesMinimas(texto: string, digits: number): Importe {
  const limpio = texto.trim()
  if (limpio === '') return { estado: 'vacio' }

  if (/[-−+]/.test(limpio)) {
    return {
      estado: 'error',
      motivo:
        'Escribí el importe sin signo: si querés que la regla mire sólo los cargos, elegilo ' +
        'arriba en «Importe». El signo lo pone la pantalla.',
    }
  }

  const partes = /^(\d+)(?:[.,](\d+))?$/.exec(limpio)
  if (partes === null) {
    return {
      estado: 'error',
      motivo: `«${limpio}» no es un importe. Va en cifras, con coma decimal y sin separador de miles: 1234,56`,
    }
  }

  const entera = partes[1] ?? '0'
  const decimal = partes[2] ?? ''
  if (decimal.length > digits) {
    return {
      estado: 'error',
      motivo:
        digits === 0
          ? 'Esta moneda no tiene decimales: escribí el importe entero.'
          : `Esta moneda tiene ${digits} decimales y escribiste ${decimal.length}.`,
    }
  }

  return { estado: 'ok', valor: BigInt(entera + decimal.padEnd(digits, '0')) }
}

/**
 * El camino de vuelta, y tiene que ser exacto: lo que sale de acá se pinta en
 * el campo del formulario y vuelve a entrar por `aUnidadesMinimas` cuando se
 * guarda. Por eso no lleva separador de miles, que ese parser rechaza.
 */
export function aTexto(valor: bigint, digits: number, recortar = false): string {
  const abs = valor < 0n ? -valor : valor
  if (digits === 0) return abs.toString()
  const escala = 10n ** BigInt(digits)
  const entera = (abs / escala).toString()
  let decimal = (abs % escala).toString().padStart(digits, '0')
  if (recortar) decimal = decimal.replace(/0+$/, '')
  return decimal === '' ? entera : `${entera},${decimal}`
}

/** Partes por millón: el 100% son 1.000.000, y así el 60% no pierde nada. */
const PPM_DIGITS = 4
export const PPM_COMPLETO = 1_000_000

export function porcentajeAPpm(texto: string): Importe {
  return aUnidadesMinimas(texto, PPM_DIGITS)
}

export function ppmAPorcentaje(ppm: number): string {
  return aTexto(BigInt(ppm), PPM_DIGITS, true)
}

/* ── De criterios a lo que entiende el repositorio ───────────────────────── */

export type Traduccion<T> =
  | { readonly ok: true; readonly valor: T }
  | { readonly ok: false; readonly error: string }

/**
 * Los decimales contra los que se lee el importe escrito.
 *
 * Si la regla se limita a una cuenta, los de esa cuenta; si no, los de la
 * moneda de reporte. No hay una respuesta mejor: el rango se compara contra el
 * importe en la moneda de CADA cuenta, así que una regla sin cuenta y con
 * rango compara euros contra dólares. La pantalla lo dice al lado del campo en
 * vez de esconderlo.
 */
export function decimalesDe(monedaDeCuenta: string | null, monedaBase: string): number {
  return minorUnits(monedaDeCuenta ?? monedaBase)
}

/** Lo que hace falta para saber a qué movimientos alcanza la regla. */
export function aBusqueda(c: Criterios, digits: number): Traduccion<RuleMatch> {
  const desde = aUnidadesMinimas(c.min, digits)
  if (desde.estado === 'error') return { ok: false, error: desde.motivo }
  const hasta = aUnidadesMinimas(c.max, digits)
  if (hasta.estado === 'error') return { ok: false, error: hasta.motivo }

  const a = desde.estado === 'ok' ? desde.valor : null
  const b = hasta.estado === 'ok' ? hasta.valor : null
  if (a !== null && b !== null && a > b) {
    return {
      ok: false,
      error: 'El importe «desde» es mayor que el «hasta». Están en valor absoluto: de 10 a 100.',
    }
  }

  if (c.direccion === 'cualquiera' && (a !== null || b !== null)) {
    return {
      ok: false,
      error:
        'Para acotar el importe elegí primero si son cargos o abonos: el rango se compara con ' +
        'signo contra tu extracto, y un cargo de 45,20 vale −45,20, que no está «entre 10 y 100».',
    }
  }

  // El signo lo pone la dirección, y el cero acota el lado que no se pidió:
  // «cargos» sin tope inferior es todo lo que sea <= 0.
  const minAmount =
    c.direccion === 'cargos'
      ? b === null
        ? null
        : -b
      : c.direccion === 'abonos'
        ? (a ?? 0n)
        : null
  const maxAmount =
    c.direccion === 'cargos' ? (a === null ? 0n : -a) : c.direccion === 'abonos' ? b : null

  return {
    ok: true,
    valor: {
      matchKind: c.tipo,
      matchValue: c.texto,
      accountId: c.cuentaId,
      minAmount,
      maxAmount,
    },
  }
}

/**
 * Con qué texto arranca una regla creada desde la lista de lo que falta.
 *
 * El descriptor agrupado viene normalizado —sin tildes, sin signos, sin las
 * referencias que cambian en cada cargo— y por eso es mejor semilla: «NETFLIX»
 * agarra los trece cargos y no uno. Pero esa misma normalización hace que a
 * veces **no exista** en el texto del banco: «REPSOL ESTACION SERVICIO» no está
 * dentro de «Repsol estación de servicio», y la regla que sale de ahí no
 * coincidiría con nada.
 *
 * Así que se comprueba antes, con la misma insensibilidad a mayúsculas que usa
 * la búsqueda, y si el descriptor limpio no está en el original se arranca con
 * el original. El formulario ofrece el otro texto de todas formas, y la vista
 * previa dice la verdad sobre cualquiera de los dos.
 */
export function semillaDeDescriptor(descripcion: string, ejemplo: string): string {
  return ejemplo.toLowerCase().includes(descripcion.toLowerCase()) ? descripcion : ejemplo
}

export function aDimensiones(
  c: Criterios,
  etiquetas: ReadonlyMap<string, string>,
): Traduccion<RuleDimensionInput[]> {
  const out: RuleDimensionInput[] = []
  for (const dim of c.dimensiones) {
    const nombre = etiquetas.get(dim.dimensionId) ?? 'esa dimensión'
    const peso = porcentajeAPpm(dim.peso)
    if (peso.estado === 'error') {
      return { ok: false, error: `El reparto de ${nombre}: ${peso.motivo}` }
    }
    if (peso.estado === 'vacio') {
      out.push({ dimensionId: dim.dimensionId, dimensionValueId: dim.valueId })
      continue
    }
    if (peso.valor <= 0n || peso.valor > BigInt(PPM_COMPLETO)) {
      return {
        ok: false,
        error: `El reparto de ${nombre} tiene que ser un porcentaje mayor que cero y hasta 100.`,
      }
    }
    out.push({
      dimensionId: dim.dimensionId,
      dimensionValueId: dim.valueId,
      weightPpm: Number(peso.valor),
    })
  }
  return { ok: true, valor: out }
}

/* ── De una regla guardada a los criterios de la pantalla ────────────────── */

export interface DesdeRegla {
  readonly criterios: Criterios
  /**
   * El rango guardado cruza el cero (o es un cero exacto) y el formulario no
   * lo sabe escribir. No se corrige solo: se avisa, porque guardar lo
   * reemplazaría por lo que diga la pantalla.
   */
  readonly rangoIlegible: boolean
}

export function criteriosDeRegla(regla: RuleRow, digits: number): DesdeRegla {
  const min = regla.minAmount
  const max = regla.maxAmount
  let direccion: Direccion = 'cualquiera'
  let desde = ''
  let hasta = ''
  let rangoIlegible = false

  // El rango se guarda con signo y acá se deshace la traducción que hizo
  // `aBusqueda`. Un cargo «de 10 a 100» está guardado como min −10.000 y max
  // −1.000: el «desde» del formulario es el de MENOR magnitud, que es el max.
  if (min === null && max === null) {
    direccion = 'cualquiera'
  } else if (max !== null && max <= 0n && (min === null || min < 0n)) {
    direccion = 'cargos'
    desde = max === 0n ? '' : aTexto(max, digits)
    hasta = min === null ? '' : aTexto(min, digits)
  } else if (min !== null && min >= 0n && (max === null || max > 0n)) {
    direccion = 'abonos'
    desde = min === 0n ? '' : aTexto(min, digits)
    hasta = max === null ? '' : aTexto(max, digits)
  } else {
    rangoIlegible = true
  }

  return {
    criterios: {
      nombre: regla.name,
      tipo: regla.matchKind,
      texto: regla.matchValue,
      cuentaId: regla.accountId,
      direccion,
      min: desde,
      max: hasta,
      categoriaId: regla.categoryId,
      dimensiones: regla.dimensions.map((dim) => ({
        dimensionId: dim.dimensionId,
        valueId: dim.valueId,
        peso: dim.weightPpm === PPM_COMPLETO ? '' : ppmAPorcentaje(dim.weightPpm),
      })),
      prioridad: regla.priority,
      activa: regla.enabled,
      soloSinCategorizar: DEFECTO.soloSinCategorizar,
    },
    rangoIlegible,
  }
}

/* ── El enlace al registro ───────────────────────────────────────────────── */

export interface EnlaceRegistro {
  readonly destino: { pathname: string; query: Record<string, string> }
  /**
   * El filtro de /movimientos no dice exactamente lo mismo que la regla. Se
   * enlaza igual —llegar cerca es útil— pero se declara: dos listas parecidas
   * con recuentos distintos y sin explicación es peor que no enlazar.
   */
  readonly motivo: string | null
}

/**
 * El filtro de /movimientos equivalente a la regla.
 *
 * El buscador de esa pantalla es un «contiene» sin más: no sabe de anclajes, ni
 * de expresiones regulares, ni de rangos de importe. Cuando la regla usa algo
 * de eso, el enlace lleva a un conjunto más ancho y lo dice.
 */
export function enlaceAMovimientos(regla: {
  matchKind: MatchKind
  matchValue: string
  accountId: string | null
  minAmount: bigint | null
  maxAmount: bigint | null
}): EnlaceRegistro {
  const query: Record<string, string> = {}
  if (regla.matchKind !== 'regex' && regla.matchValue !== '') query['q'] = regla.matchValue
  if (regla.accountId !== null) query['cuenta'] = regla.accountId

  const razones: string[] = []
  if (regla.matchKind === 'regex') {
    razones.push('el buscador del registro no entiende expresiones regulares')
  } else if (regla.matchKind !== 'contiene') {
    razones.push(
      `busca el texto en cualquier posición y la regla exige que ${ETIQUETA_TIPO[regla.matchKind]}`,
    )
  }
  if (regla.minAmount !== null || regla.maxAmount !== null) {
    razones.push('el rango de importe de la regla no se puede poner como filtro')
  }

  return {
    destino: { pathname: '/movimientos', query },
    motivo: razones.length === 0 ? null : `Trae de más porque ${razones.join(' y ')}.`,
  }
}
