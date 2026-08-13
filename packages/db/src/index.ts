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
  withUserScope,
} from './client.js'
export type { ClientConfig, TlsOptions } from './connection.js'
export { ConnectionStringError, SUPABASE_ROOT_CA_2021, toClientConfig } from './connection.js'

// ── Repositorio ─────────────────────────────────────────────────────────────
// Toda función recibe un TenantClient que ya viene con el hogar fijado. No hay
// forma de llamarlas sin declarar de quién son los datos que se piden.

export type {
  ApplyAllOptions,
  ApplyAllResult,
  ApplyRuleOptions,
  ApplyRuleResult,
  ClassifyResult,
  DimensionAssignment,
  MatchKind,
  OmitReason,
  OmittedMovement,
  PreviewOptions,
  ReclassifyInput,
  RuleDimensionInput,
  RuleDimensionRow,
  RuleInput,
  RuleMatch,
  RulePatch,
  RulePreview,
  RuleRow,
  SetDimensionsInput,
  SetDimensionsResult,
  UncategorizedMerchant,
  UncategorizedResult,
} from './repo/classify.js'
export {
  applyAllRules,
  applyRule,
  ClassifyError,
  createRule,
  deleteRule,
  listRules,
  previewRule,
  reclassify,
  setDimensions,
  uncategorized,
  updateRule,
} from './repo/classify.js'
export type {
  EnsureLedgerAccountInput,
  EnsureLedgerAccountResult,
  FeedAccountRow,
  FeedConnectionRow,
  FeedProvider,
  FeedUserRow,
  RecordConnectionInput,
  SaveFeedUserInput,
  UpdateConnectionInput,
} from './repo/feed.js'
export {
  deleteFeedUser,
  ensureLedgerAccount,
  FeedRepoError,
  listConnections,
  listFeedAccounts,
  markFeedAccountSynced,
  readConnection,
  readFeedUser,
  recordConnection,
  saveFeedUser,
  updateConnection,
} from './repo/feed.js'
export type {
  BookTransactionInput,
  DeclaredBalanceInput,
  ImportBatchRow,
  ImportBatchStatus,
  NeedsReviewTransaction,
  PersistableTransaction,
  PersistImportInput,
  PersistImportResult,
  UpdateBookedTransactionInput,
  UpdateBookedTransactionResult,
  UpdatedField,
} from './repo/import.js'
export {
  bookTransaction,
  listImportBatches,
  persistImport,
  revertImport,
  updateBookedTransaction,
} from './repo/import.js'
export type {
  DimensionSummary,
  DimensionValueSummary,
  NetWorthAttribution,
  NetWorthPoint,
  RecurringRow,
  RecurringState,
  ReviewRow,
  ReviewState,
  SpendByCategoryMonthRow,
  SpendByDimensionRow,
  TopMerchantRow,
} from './repo/read-analysis.js'
export {
  dimensionsWithValues,
  netWorthAttribution,
  netWorthSeries,
  recurring,
  reviewQueue,
  spendByCategoryMonth,
  spendByDimension,
  topMerchants,
} from './repo/read-analysis.js'
export type {
  AccountBalance,
  AccountKind,
  CategoryNode,
  DataSource,
  LiquidityLane,
  MovementFilter,
  MovementPage,
  MovementRow,
  PeriodTotals,
  ReconciliationRow,
  ReconciliationStatus,
  Ymd,
} from './repo/read-ledger.js'
export {
  accountBalances,
  categoryTree,
  liquidityByCurrency,
  movements,
  reconciliation,
  totals,
} from './repo/read-ledger.js'
export type { SeedOptions, SeedResult } from './repo/seed.js'
export { hasDemoData, removeDemoData, seedDemoHousehold } from './repo/seed.js'

/*
 * El corredor de migraciones NO se reexporta acá a propósito.
 *
 * Lee el directorio de SQL del disco, y cualquier bundler que siga este
 * índice intenta resolver ese directorio como si fuera un módulo y falla el
 * build de la web — que ni siquiera migra nada. Vive en '@moneypilot/db/migrate'
 * y lo usan sólo la CLI y los tests, que corren en Node de verdad.
 */
