/**
 * La regla del país, con las tres ramas que deciden si se escribe un dato o se
 * deja vacío.
 *
 * La que importa de verdad es la del medio: **con dos países no se escribe
 * ninguno**. Elegir el primero sería lo cómodo, no daría error nunca, y
 * pondría cuentas de una filial extranjera bajo la jurisdicción equivocada en
 * cualquier informe que agrupe por país.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

const institucionPorId = vi.fn()
vi.mock('./client', () => ({ institucionPorId: (...args: unknown[]) => institucionPorId(...args) }))

const { CORREDOR, paisDeLaEntidad } = await import('./pais')

const ficha = (paises: readonly string[]) => ({
  institutionId: 'ins_68',
  nombre: 'BBVA · Banca Personal',
  paises: [...paises],
  productos: ['transactions'],
  oauth: false,
})

describe('el país de la entidad', () => {
  afterEach(() => {
    institucionPorId.mockReset()
  })

  it('lo escribe cuando la entidad opera en un solo país', async () => {
    institucionPorId.mockResolvedValue(ficha(['ES']))
    expect(await paisDeLaEntidad('ins_68')).toBe('ES')
    expect(institucionPorId).toHaveBeenCalledWith('ins_68', CORREDOR)
  })

  it('no elige uno cuando la entidad opera en varios', async () => {
    institucionPorId.mockResolvedValue(ficha(['ES', 'US', 'MX']))
    expect(await paisDeLaEntidad('ins_68')).toBeNull()
  })

  it('tampoco inventa nada cuando la ficha no trae países', async () => {
    institucionPorId.mockResolvedValue(ficha([]))
    expect(await paisDeLaEntidad('ins_68')).toBeNull()
  })

  it('si Plaid falla, se sigue sin país y sin romper la sincronización', async () => {
    // Es lo que separa un dato descriptivo de uno crítico: el país es bonito de
    // tener; los movimientos son la razón de la petición. Que lo primero tumbe
    // lo segundo sería la peor forma de fallar.
    institucionPorId.mockRejectedValue(new Error('INSTITUTION_NOT_FOUND'))
    await expect(paisDeLaEntidad('ins_68')).resolves.toBeNull()
  })

  it('no sale a la red sin identificador de institución', async () => {
    expect(await paisDeLaEntidad(null)).toBeNull()
    expect(await paisDeLaEntidad('   ')).toBeNull()
    expect(institucionPorId).not.toHaveBeenCalled()
  })
})
