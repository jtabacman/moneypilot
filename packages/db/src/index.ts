export type {
  Db,
  DbConfig,
  TenantClient,
  TenantScopeOptions,
} from './client.js'
export {
  assumeAppRole,
  bypassesRls,
  createPool,
  DEFAULT_APP_ROLE,
  TenantScopeError,
  withoutTenantScope,
  withTenant,
} from './client.js'
export type { ClientConfig, TlsOptions } from './connection.js'
export { ConnectionStringError, SUPABASE_ROOT_CA_2021, toClientConfig } from './connection.js'

/*
 * El corredor de migraciones NO se reexporta acá a propósito.
 *
 * Lee el directorio de SQL del disco, y cualquier bundler que siga este
 * índice intenta resolver ese directorio como si fuera un módulo y falla el
 * build de la web — que ni siquiera migra nada. Vive en '@moneypilot/db/migrate'
 * y lo usan sólo la CLI y los tests, que corren en Node de verdad.
 */
