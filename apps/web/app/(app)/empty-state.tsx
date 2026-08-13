import Link from 'next/link'
import { loadDemoData } from './demo-actions'
import { Empty } from './ui'

/**
 * Lo que ve alguien cuyo hogar todavía no tiene un solo movimiento.
 *
 * Es la misma pantalla en las doce secciones a propósito: la respuesta a
 * &laquo;esto está vacío&raquo; no depende de en qué página estés parado, y
 * doce variantes del mismo mensaje es doce sitios donde se desincroniza.
 */
export function NoData({ what }: { what: string }) {
  return (
    <div className="panel">
      <Empty
        title="Todavía no hay nada que mirar"
        action={
          <div className="row" style={{ justifyContent: 'center' }}>
            <form action={loadDemoData}>
              <button type="submit" className="primary">
                Cargar el hogar de ejemplo
              </button>
            </form>
            <Link href="/importar" className="btn">
              Importar un extracto
            </Link>
          </div>
        }
      >
        Para ver {what} hace falta que entren movimientos. Podés subir un extracto tuyo, o cargar el
        hogar de ejemplo: son datos de una familia inventada que se escriben de verdad en tu base,
        con sus asientos y su reconciliación, y se quitan de un click cuando quieras.
      </Empty>
    </div>
  )
}
