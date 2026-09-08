/**
 * Browser-safe request, value, and error vocabulary for the `knowledge` Remote
 * namespace this package owns. Ids are the knowledge store's branded ids, which
 * serialize as plain strings on the wire.
 */

import type { KnowledgeCategory, KnowledgeEntryId, KnowledgeGroupId } from '@deepseek-ai/dsh-knowledge/types'

export type { KnowledgeCategory, KnowledgeEntryId, KnowledgeGroupId } from '@deepseek-ai/dsh-knowledge/types'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The request named an unknown knowledge entry or group. */
    'knowledge/not-found': { readonly id: string }
    /** The request carried an invalid knowledge category. */
    'knowledge/invalid-category': { readonly category: string }
    /** The request carried an empty or malformed knowledge field. */
    'knowledge/invalid-input': object
  }
}

/** One knowledge entry projected for browser consumers. */
export interface KnowledgeEntryView {
  readonly id: KnowledgeEntryId
  readonly title: string
  readonly content: string
  readonly category: KnowledgeCategory
  readonly tags: readonly string[]
  readonly groupId?: KnowledgeGroupId
  readonly sourceSessionId?: string
  readonly createdAt: number
  readonly updatedAt: number
}

/** One knowledge group projected for browser consumers. */
export interface KnowledgeGroupView {
  readonly id: KnowledgeGroupId
  readonly name: string
  readonly description: string
  readonly entryIds: readonly KnowledgeEntryId[]
}

/** Filter criteria for listing knowledge entries. */
export interface KnowledgeListRequest {
  readonly query?: string
  readonly category?: KnowledgeCategory
  readonly groupId?: KnowledgeGroupId
  readonly tags?: readonly string[]
  readonly limit?: number
}

/** Catalog of knowledge entries and groups. */
export interface KnowledgeListValue {
  readonly entries: readonly KnowledgeEntryView[]
  readonly groups: readonly KnowledgeGroupView[]
}

/** One knowledge entry lookup result. */
export interface KnowledgeGetValue {
  readonly entry: KnowledgeEntryView
}

/** Input for creating a knowledge entry. */
export interface KnowledgeCreateInput {
  readonly title: string
  readonly content: string
  readonly category: KnowledgeCategory
  readonly tags?: readonly string[]
  readonly groupId?: KnowledgeGroupId
  readonly sourceSessionId?: string
}

/** Created knowledge entry. */
export interface KnowledgeCreateValue {
  readonly entry: KnowledgeEntryView
}

/** Partial fields for updating a knowledge entry. */
export interface KnowledgeUpdatePatch {
  readonly title?: string
  readonly content?: string
  readonly category?: KnowledgeCategory
  readonly tags?: readonly string[]
  readonly groupId?: KnowledgeGroupId
}

/** Updated knowledge entry. */
export interface KnowledgeUpdateValue {
  readonly entry: KnowledgeEntryView
}

/** Receipt after one knowledge entry is deleted. */
export interface KnowledgeDeleteValue {
  readonly deleted: true
}

/** Input for creating a knowledge group. */
export interface KnowledgeGroupCreateInput {
  readonly name: string
  readonly description: string
}

/** Created knowledge group. */
export interface KnowledgeGroupCreateValue {
  readonly group: KnowledgeGroupView
}

/** Receipt after one knowledge group is deleted. */
export interface KnowledgeGroupDeleteValue {
  readonly deleted: true
}
