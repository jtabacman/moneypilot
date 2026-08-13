import Link from 'next/link'

/**
 * El enlace al registro de una fila de la cola de revisión.
 *
 * Vive acá y no dentro de cada página porque /hoy enseña un adelanto de la
 * misma cola: dos copias del mismo enlace se desincronizan, y la que se quede
 * atrás va a llevar a una lista donde el movimiento no aparece.
 *
 * Se degrada en dos pasos. Con el id de la cuenta, filtra por cuenta y por el
 * día del asiento. Sin él —porque el nombre está repetido o la fila no trae
 * cuenta— filtra sólo por el día. Sin fecha no hay filtro que valga y no se
 * ofrece enlace: mandar a la lista entera no es un drill-down, es un desvío.
 *
 * `transferencias=1` siempre: el filtro por defecto de /movimientos esconde
 * las patas de traspaso, y justamente los ítems de tipo
 * `transferencia_sugerida` son los que más falta hace poder abrir.
 */
export function EnRegistro({
  cuentas,
  accountName,
  bookedOn,
  children = 'Ver en el registro',
}: {
  cuentas: ReadonlyMap<string, string>
  accountName: string | null
  bookedOn: string | null
  children?: React.ReactNode
}) {
  if (bookedOn === null) {
    return (
      <span className="faint" title="El ítem no tiene asiento asociado: no hay nada que abrir.">
        —
      </span>
    )
  }

  const cuentaId = accountName === null ? undefined : cuentas.get(accountName)
  const query: Record<string, string> = {
    desde: bookedOn,
    hasta: bookedOn,
    transferencias: '1',
  }
  if (cuentaId !== undefined) query['cuenta'] = cuentaId

  return (
    <Link href={{ pathname: '/movimientos', query }} className="ghost">
      {children}
    </Link>
  )
}
