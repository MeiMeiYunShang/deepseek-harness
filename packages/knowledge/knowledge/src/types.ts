/**
 * Pure types of the knowledge domain: entry, group, category, and filter
 * definitions. Free of host-side service imports so the `./types` sub-export
 * serves both host and client consumers with zero content duplication.
 *
 * @module @deepseek-ai/dsh-knowledge/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Unique identifier for a knowledge entry. */
export type KnowledgeEntryId = Branded<'KnowledgeEntryId'>

/**
 * Brand a raw string as a {@link KnowledgeEntryId}.
 * @param id - candidate entry id.
 * @returns the branded entry id.
 */
export function KnowledgeEntryId(id: string): KnowledgeEntryId {
  return id as KnowledgeEntryId
}

/** Unique identifier for a knowledge group. */
export type KnowledgeGroupId = Branded<'KnowledgeGroupId'>

/**
 * Brand a raw string as a {@link KnowledgeGroupId}.
 * @param id - candidate group id.
 * @returns the branded group id.
 */
export function KnowledgeGroupId(id: string): KnowledgeGroupId {
  return id as KnowledgeGroupId
}

/**
 * Knowledge entry categories. Each category captures a distinct kind of
 * reusable experience an agent may extract from a session.
 */
export type KnowledgeCategory =
  | 'architecture'
  | 'debugging'
  | 'performance'
  | 'pattern'
  | 'configuration'
  | 'api'
  | 'workflow'
  | 'general'

/** All valid knowledge categories as a runtime array. */
export const KNOWLEDGE_CATEGORIES: readonly KnowledgeCategory[] = [
  'architecture',
  'debugging',
  'performance',
  'pattern',
  'configuration',
  'api',
  'workflow',
  'general',
] as const

/** A single knowledge entry extracted from a session or saved manually. */
export interface KnowledgeEntry {
  /** Unique entry identifier. */
  readonly id: KnowledgeEntryId
  /** Short descriptive title. */
  readonly title: string
  /** Full knowledge content. */
  readonly content: string
  /** Classification category. */
  readonly category: KnowledgeCategory
  /** Free-form tags for cross-cutting discovery. */
  readonly tags: readonly string[]
  /** Group this entry belongs to, if any. */
  readonly groupId?: KnowledgeGroupId
  /** Session that produced this entry, if auto-summarized. */
  readonly sourceSessionId?: string
  /** Creation timestamp (Unix epoch ms). */
  readonly createdAt: number
  /** Last update timestamp (Unix epoch ms). */
  readonly updatedAt: number
}

/** A named group of knowledge entries. */
export interface KnowledgeGroup {
  /** Unique group identifier. */
  readonly id: KnowledgeGroupId
  /** Human-readable group name. */
  readonly name: string
  /** Short description of the group's scope. */
  readonly description: string
  /** Entry ids belonging to this group. */
  readonly entryIds: readonly KnowledgeEntryId[]
}

/** Filter criteria for listing knowledge entries. */
export interface KnowledgeEntryFilter {
  /** Match entries whose title or content contains any query term. */
  readonly query?: string
  /** Restrict to a specific category. */
  readonly category?: KnowledgeCategory
  /** Restrict to a specific group. */
  readonly groupId?: KnowledgeGroupId
  /** Match entries carrying any of these tags. */
  readonly tags?: readonly string[]
  /** Maximum number of entries to return. */
  readonly limit?: number
}

/** Input for creating a new knowledge entry (id and timestamps assigned by the store). */
export interface KnowledgeEntryInput {
  /** Short descriptive title. */
  readonly title: string
  /** Full knowledge content. */
  readonly content: string
  /** Classification category. */
  readonly category: KnowledgeCategory
  /** Free-form tags. */
  readonly tags?: readonly string[]
  /** Group to assign this entry to. */
  readonly groupId?: KnowledgeGroupId
  /** Session that produced this entry. */
  readonly sourceSessionId?: string
}

/** Input for creating a new knowledge group (id assigned by the store). */
export interface KnowledgeGroupInput {
  /** Human-readable group name. */
  readonly name: string
  /** Short description of the group's scope. */
  readonly description: string
}
