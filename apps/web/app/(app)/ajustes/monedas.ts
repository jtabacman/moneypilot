/**
 * Las monedas que el formateador sabe escribir con su símbolo.
 *
 * Vive en su propio módulo porque la lista la necesitan las dos mitades: el
 * `select` del formulario y la validación de la acción de servidor. Un
 * desplegable y una validación que se copian por separado se desincronizan, y
 * el resultado es un campo que la pantalla ofrece y el servidor rechaza.
 *
 * Que la lista sea corta es deliberado: la moneda de reporte de un hogar cuyo
 * símbolo no sabemos pintar se leería como texto crudo en cada importe de la
 * aplicación.
 */
export interface Moneda {
  readonly codigo: string
  readonly nombre: string
}

export const MONEDAS: readonly Moneda[] = [
  { codigo: 'EUR', nombre: 'Euro' },
  { codigo: 'USD', nombre: 'Dólar estadounidense' },
  { codigo: 'GBP', nombre: 'Libra esterlina' },
  { codigo: 'CHF', nombre: 'Franco suizo' },
  { codigo: 'ARS', nombre: 'Peso argentino' },
  { codigo: 'MXN', nombre: 'Peso mexicano' },
]

export function esMonedaConocida(codigo: string): boolean {
  return MONEDAS.some((moneda) => moneda.codigo === codigo)
}
