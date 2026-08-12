/**
 * Identificadores. UUIDv7 en vez de v4: son ordenables por tiempo, lo que da
 * localidad de índice en Postgres y hace que un `ORDER BY id` sea estable.
 */

import { uuidv7 } from 'uuidv7'

export type TenantId = string & { readonly __brand: 'TenantId' }
export type AccountId = string & { readonly __brand: 'AccountId' }
export type EntryId = string & { readonly __brand: 'EntryId' }
export type PostingId = string & { readonly __brand: 'PostingId' }
export type ImportBatchId = string & { readonly __brand: 'ImportBatchId' }
export type DimensionId = string & { readonly __brand: 'DimensionId' }
export type DimensionValueId = string & { readonly __brand: 'DimensionValueId' }

export const newTenantId = (): TenantId => uuidv7() as TenantId
export const newAccountId = (): AccountId => uuidv7() as AccountId
export const newEntryId = (): EntryId => uuidv7() as EntryId
export const newPostingId = (): PostingId => uuidv7() as PostingId
export const newImportBatchId = (): ImportBatchId => uuidv7() as ImportBatchId
export const newDimensionId = (): DimensionId => uuidv7() as DimensionId
export const newDimensionValueId = (): DimensionValueId => uuidv7() as DimensionValueId
