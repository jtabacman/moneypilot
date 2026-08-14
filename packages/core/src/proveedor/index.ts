/**
 * La capa del proveedor: su taxonomía traducida a la nuestra, y el plan de
 * cuentas con el que arranca un hogar.
 *
 * El re-export de `arbol.js` va nombre por nombre y no con `export *` por un
 * motivo concreto: `RutaDeCategoria` está definida también en
 * `../diccionario/tipos.ts`, y dos `export *` con el mismo nombre en el barril
 * de `@moneypilot/core` es un error de compilación (TS2308), no una
 * ambigüedad silenciosa. Las dos definiciones son el mismo `string` con el
 * mismo formato —el de `CategoryNode.path`, "Casa > Servicios > Luz"—, así que
 * el arreglo de verdad es que quede una sola cuando las dos capas se junten;
 * mientras tanto, la capa del proveedor cede el nombre y no rompe la build de
 * nadie. Quien importe el tipo desde acá lo tiene en `./arbol.js`.
 */

export {
  ARBOL_POR_DEFECTO,
  aplanarArbol,
  buscarPorRuta,
  type CategoriaAplanada,
  type NodoDeCategoria,
  SEPARADOR_DE_RUTA,
  type TipoDeCategoria,
} from './arbol.js'
export * from './correspondencia.js'
export * from './plaid.js'
