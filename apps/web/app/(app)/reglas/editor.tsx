/**
 * El editor de una regla: el formulario, y debajo lo que haría si se aplicara.
 *
 * Lo comparten /reglas/nueva y /reglas/[id] porque crear y editar son la misma
 * pantalla con distinto punto de partida. Lo único que cambia es de dónde salen
 * los criterios de base —de cero o de la regla guardada— y a qué URL vuelve la
 * vista previa.
 *
 * El estado vive en la query string, igual que en /movimientos: así el enlace
 * de «esta regla afecta a 342 movimientos» se puede pegar en un correo, que es
 * exactamente lo que hace un contador cuando propone una regla y no puede
 * escribirla.
 */

import {
  type AccountBalance,
  accountBalances,
  categoryTree,
  dimensionsWithValues,
  type RuleRow,
  type TenantClient,
} from '@moneypilot/db'
import type { Session } from '@/lib/session'
import {
  aBusqueda,
  type Criterios,
  camposDeQuery,
  criteriosDeRegla,
  DEFECTO,
  decimalesDe,
  leerCriterios,
  PPM_COMPLETO,
  porcentajeAPpm,
  type QueryParams,
} from './criterios'
import { FormularioRegla, type Opciones } from './form'
import { calcularImpacto, type ResultadoImpacto } from './impacto'
import { type Atribucion, PanelImpacto } from './piezas'

export interface DatosEditor {
  readonly criterios: Criterios
  readonly opciones: Opciones
  /** `null` cuando todavía no hay texto que buscar: no hay nada que contar. */
  readonly resultado: ResultadoImpacto | null
  readonly destino: { categoria: string | null; dimensiones: readonly Atribucion[] }
  /** El rango guardado no se puede escribir en este formulario. Ver criterios.ts. */
  readonly rangoIlegible: boolean
}

/**
 * Lee la pantalla entera: opciones, criterios efectivos e impacto.
 *
 * El impacto se calcula acá, en el servidor, con los criterios que están en la
 * URL. No hay ningún camino por el que la vista previa y lo que se guarda
 * salgan de sitios distintos: la acción vuelve a leer los mismos campos con la
 * misma función y compara firmas antes de escribir.
 */
export async function prepararEditor(
  client: TenantClient,
  session: Session,
  params: QueryParams,
  regla: RuleRow | null,
): Promise<DatosEditor> {
  // En serie: las tres van por el mismo cliente —una transacción, una
  // conexión—, así que pg las encola igual. Promise.all daba paralelismo
  // aparente y un aviso de query concurrente sobre un cliente ocupado, que en
  // pg@9 será un error.
  const cuentas = await accountBalances(client)
  const categorias = await categoryTree(client)
  const dimensiones = await dimensionsWithValues(client)

  const monedaDe = (accountId: string | null): string | null =>
    accountId === null
      ? null
      : (cuentas.find((cuenta) => cuenta.id === accountId)?.currency ?? null)

  const desdeRegla =
    regla === null
      ? null
      : criteriosDeRegla(regla, decimalesDe(monedaDe(regla.accountId), session.baseCurrency))

  const criterios = leerCriterios(camposDeQuery(params), {
    base: desdeRegla?.criterios ?? DEFECTO,
    dimensionIds: dimensiones.map((dimension) => dimension.id),
  })

  return {
    criterios,
    opciones: opcionesDe(cuentas, categorias, dimensiones, session.baseCurrency),
    resultado: await calcularResultado(client, criterios, monedaDe, session.baseCurrency),
    destino: {
      categoria: categorias.find((c) => c.id === criterios.categoriaId)?.path ?? null,
      dimensiones: criterios.dimensiones.flatMap<Atribucion>((elegida) => {
        const dimension = dimensiones.find((d) => d.id === elegida.dimensionId)
        const valor = dimension?.values.find((v) => v.id === elegida.valueId)
        if (dimension === undefined || valor === undefined) return []
        // Un porcentaje a medio escribir no puede romper la vista previa: se
        // enseña el 100%, que es lo que hará la regla si se deja vacío, y de
        // los pesos inválidos se ocupa la acción al guardar, con su mensaje.
        const peso = elegida.peso === '' ? null : porcentajeAPpm(elegida.peso)
        return [
          {
            label: dimension.label,
            value: valor.label,
            weightPpm: peso !== null && peso.estado === 'ok' ? Number(peso.valor) : PPM_COMPLETO,
          },
        ]
      }),
    },
    rangoIlegible: desdeRegla?.rangoIlegible ?? false,
  }
}

function opcionesDe(
  cuentas: readonly AccountBalance[],
  categorias: Awaited<ReturnType<typeof categoryTree>>,
  dimensiones: Awaited<ReturnType<typeof dimensionsWithValues>>,
  monedaBase: string,
): Opciones {
  return {
    cuentas: cuentas
      .filter((cuenta) => cuenta.kind === 'asset' || cuenta.kind === 'liability')
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      .map((cuenta) => ({ id: cuenta.id, nombre: cuenta.name, moneda: cuenta.currency })),
    categorias: categorias.map((categoria) => ({
      id: categoria.id,
      path: categoria.path,
      kind: categoria.kind,
    })),
    dimensiones: dimensiones.map((dimension) => ({
      id: dimension.id,
      label: dimension.label,
      valores: dimension.values.map((valor) => ({
        id: valor.id,
        label: valor.label,
        archivado: valor.archivedAt !== null,
      })),
    })),
    monedaBase,
  }
}

async function calcularResultado(
  client: TenantClient,
  criterios: Criterios,
  monedaDe: (accountId: string | null) => string | null,
  monedaBase: string,
): Promise<ResultadoImpacto | null> {
  // Sin texto no hay regla: un patrón vacío coincidiría con el libro entero, y
  // el repositorio se niega a evaluarlo. Acá se contesta antes, con una
  // explicación en vez de un error.
  if (criterios.texto === '') return null

  const busqueda = aBusqueda(criterios, decimalesDe(monedaDe(criterios.cuentaId), monedaBase))
  if (!busqueda.ok) return { estado: 'error', motivo: busqueda.error }

  return calcularImpacto(client, busqueda.valor, criterios.soloSinCategorizar)
}

/**
 * El formulario con el impacto dentro.
 *
 * La vista previa va como `children` para que quede **entre** los campos y los
 * botones de guardar: el orden en la página es el orden en que queremos que se
 * decida, y un botón de aplicar por encima del impacto invita a pulsarlo sin
 * haberlo leído.
 */
export function Editor({
  datos,
  reglaId,
  ejemplo,
}: {
  datos: DatosEditor
  reglaId: string | null
  ejemplo: string | null
}) {
  return (
    <FormularioRegla
      criterios={datos.criterios}
      opciones={datos.opciones}
      reglaId={reglaId}
      ejemplo={ejemplo}
    >
      <PanelImpacto
        resultado={datos.resultado}
        soloSinCategorizar={datos.criterios.soloSinCategorizar}
        destino={datos.destino}
      />
    </FormularioRegla>
  )
}
