export type { Db, DbConfig, TenantClient, TenantScopeOptions } from './client.js'
export {
  assumeAppRole,
  bypassesRls,
  createPool,
  DEFAULT_APP_ROLE,
  TenantScopeError,
  withoutTenantScope,
  withTenant,
} from './client.js'
export type { MigrateResult } from './migrate.js'
export { migrate } from './migrate.js'
