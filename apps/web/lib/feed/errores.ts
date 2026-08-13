/**
 * El fallo de una sincronización, en un módulo propio y sin dependencias.
 *
 * Está solo acá y no dentro de `asentar.ts` para que las rutas que lo capturan
 * —que sólo quieren decidir si contestan 409 o 500— no arrastren consigo el
 * repositorio, el pipeline y el núcleo entero por un `instanceof`.
 *
 * Es un error de *nuestro* lado: la cuenta cambió de moneda, el enlace ya no
 * está, el libro no llegó al saldo que declara el banco. Lo que falla del lado
 * del proveedor viaja en su propio error (`FinapiError`, `PlaidError`), porque
 * lo que hay que hacer con cada uno es distinto: uno se reintenta, el otro no.
 */
export class SincronizacionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SincronizacionError'
  }
}
