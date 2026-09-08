/**
 * Knowledge store service definition (`ctx.knowledge`).
 *
 * This package owns the Service Definition role of the knowledge capability
 * seam. It declares the in-memory store interface for CRUD operations on
 * knowledge entries and groups, and emits `knowledge/change` on mutations.
 * Concrete providers such as `@deepseek-ai/dsh-knowledge-file` decide where
 * entries are persisted; this service only owns the runtime registry and
 * notifies consumers of changes.
 *
 * @module @deepseek-ai/dsh-knowledge
 */

import { Context, Service } from '@deepseek-ai/cordis'
import {
  KnowledgeEntryId,
  KnowledgeGroupId,
  KNOWLEDGE_CATEGORIES,
} from './types.ts'
import type {
  KnowledgeCategory,
  KnowledgeEntry,
  KnowledgeEntryFilter,
  KnowledgeEntryInput,
  KnowledgeGroup,
  KnowledgeGroupInput,
} from './types.ts'

export * from './types.ts'

/** The set of valid categories for O(1) membership checks. */
const CATEGORY_SET = new Set<string>(KNOWLEDGE_CATEGORIES)

/**
 * Validate that a string is a known knowledge category.
 * @param category - candidate category.
 * @returns whether the category is valid.
 */
export function isKnowledgeCategory(category: string): category is KnowledgeCategory {
  return CATEGORY_SET.has(category)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledge: KnowledgeStore
  }

  interface Events {
    /**
     * A knowledge entry or group was created, updated, or deleted. This is an
     * unfiltered invalidation notification; consumers refetch the catalog for
     * their own filter. Listener failures are contained and cannot veto the
     * store mutation.
     * @mode emit
     */
    'knowledge/change'(): void
  }
}

/**
 * In-memory knowledge store. Providers attach a persistence backend by
 * listening to `knowledge/change` and hydrating entries on boot. The store
 * itself owns the runtime registry, id minting, and change notification.
 */
export class KnowledgeStore extends Service {
  private readonly entries = new Map<KnowledgeEntryId, KnowledgeEntry>()
  private readonly groups = new Map<KnowledgeGroupId, KnowledgeGroup>()
  private entryCounter = 0
  private groupCounter = 0

  constructor(ctx: Context) {
    super(ctx, 'knowledge')
  }

  // ── Entry operations ──────────────────────────────────────────────

  /**
   * List knowledge entries matching the optional filter. Results are sorted by
   * creation time descending (newest first). The filter's `query` matches
   * case-insensitively against title, content, and tags.
   * @param filter - optional filter criteria.
   * @returns matching entries in creation-time descending order.
   */
  listEntries(filter?: KnowledgeEntryFilter): KnowledgeEntry[] {
    let results = [...this.entries.values()]
    if (filter !== undefined) {
      results = applyFilter(results, filter)
    }
    results.sort((a, b) => b.createdAt - a.createdAt)
    return results
  }

  /**
   * Look up a single knowledge entry by id.
   * @param id - the entry id.
   * @returns the entry, or undefined when not found.
   */
  getEntry(id: KnowledgeEntryId): KnowledgeEntry | undefined {
    return this.entries.get(id)
  }

  /**
   * Create a new knowledge entry. The store assigns the id, createdAt, and
   * updatedAt timestamps. If a `groupId` is supplied, the group must exist and
   * the entry id is appended to its `entryIds`.
   * @param input - the entry content and metadata.
   * @returns the newly created entry.
   */
  saveEntry(input: KnowledgeEntryInput): KnowledgeEntry {
    validateEntryInput(input)
    const now = Date.now()
    const id = KnowledgeEntryId(`k_${++this.entryCounter}`)
    const entry: KnowledgeEntry = {
      id,
      title: input.title,
      content: input.content,
      category: input.category,
      tags: input.tags ? [...input.tags] : [],
      ...input.groupId !== undefined ? { groupId: input.groupId } : {},
      ...input.sourceSessionId !== undefined ? { sourceSessionId: input.sourceSessionId } : {},
      createdAt: now,
      updatedAt: now,
    }
    this.entries.set(id, entry)
    if (input.groupId !== undefined) {
      this.addEntryToGroup(input.groupId, id)
    }
    this.notifyChange()
    return entry
  }

  /**
   * Update an existing knowledge entry. Only supplied fields are changed; the
   * `updatedAt` timestamp is refreshed. Returns the updated entry or undefined
   * when the id is not found.
   * @param id - the entry to update.
   * @param patch - partial fields to merge.
   * @returns the updated entry, or undefined when not found.
   */
  updateEntry(id: KnowledgeEntryId, patch: Partial<Pick<KnowledgeEntryInput, 'title' | 'content' | 'category' | 'tags' | 'groupId'>>): KnowledgeEntry | undefined {
    const existing = this.entries.get(id)
    if (existing === undefined) return undefined
    if (patch.category !== undefined && !isKnowledgeCategory(patch.category)) {
      throw new Error(`invalid knowledge category "${String(patch.category)}"`)
    }
    const updated: KnowledgeEntry = {
      ...existing,
      ...patch.title !== undefined ? { title: patch.title } : {},
      ...patch.content !== undefined ? { content: patch.content } : {},
      ...patch.category !== undefined ? { category: patch.category } : {},
      ...patch.tags !== undefined ? { tags: [...patch.tags] } : {},
      ...patch.groupId !== undefined ? { groupId: patch.groupId } : {},
      updatedAt: Date.now(),
    }
    this.entries.set(id, updated)
    this.notifyChange()
    return updated
  }

  /**
   * Delete a knowledge entry. Removes it from any group it belongs to.
   * @param id - the entry to delete.
   * @returns whether the entry existed and was removed.
   */
  deleteEntry(id: KnowledgeEntryId): boolean {
    const entry = this.entries.get(id)
    if (entry === undefined) return false
    if (entry.groupId !== undefined) {
      this.removeEntryFromGroup(entry.groupId, id)
    }
    this.entries.delete(id)
    this.notifyChange()
    return true
  }

  // ── Group operations ──────────────────────────────────────────────

  /**
   * List all knowledge groups.
   * @returns all groups in creation order.
   */
  listGroups(): KnowledgeGroup[] {
    return [...this.groups.values()]
  }

  /**
   * Look up a single group by id.
   * @param id - the group id.
   * @returns the group, or undefined when not found.
   */
  getGroup(id: KnowledgeGroupId): KnowledgeGroup | undefined {
    return this.groups.get(id)
  }

  /**
   * Create a new knowledge group.
   * @param input - the group name and description.
   * @returns the newly created group.
   */
  createGroup(input: KnowledgeGroupInput): KnowledgeGroup {
    validateGroupInput(input)
    const id = KnowledgeGroupId(`g_${++this.groupCounter}`)
    const group: KnowledgeGroup = {
      id,
      name: input.name,
      description: input.description,
      entryIds: [],
    }
    this.groups.set(id, group)
    this.notifyChange()
    return group
  }

  /**
   * Delete a knowledge group. Entries belonging to the group have their
   * `groupId` cleared.
   * @param id - the group to delete.
   * @returns whether the group existed and was removed.
   */
  deleteGroup(id: KnowledgeGroupId): boolean {
    const group = this.groups.get(id)
    if (group === undefined) return false
    for (const entryId of group.entryIds) {
      const entry = this.entries.get(entryId)
      if (entry !== undefined) {
        const { groupId: _removed, ...rest } = entry
        this.entries.set(entryId, { ...rest, updatedAt: Date.now() })
      }
    }
    this.groups.delete(id)
    this.notifyChange()
    return true
  }

  /**
   * Assign an entry to a group. If the entry was in another group, it is
   * removed from that group first.
   * @param entryId - the entry to assign.
   * @param groupId - the target group.
   * @returns whether the assignment succeeded (both entry and group must exist).
   */
  assignToGroup(entryId: KnowledgeEntryId, groupId: KnowledgeGroupId): boolean {
    const entry = this.entries.get(entryId)
    const group = this.groups.get(groupId)
    if (entry === undefined || group === undefined) return false
    if (entry.groupId !== undefined && entry.groupId !== groupId) {
      this.removeEntryFromGroup(entry.groupId, entryId)
    }
    this.entries.set(entryId, { ...entry, groupId: groupId, updatedAt: Date.now() })
    if (!group.entryIds.includes(entryId)) {
      const updatedGroup: KnowledgeGroup = { ...group, entryIds: [...group.entryIds, entryId] }
      this.groups.set(groupId, updatedGroup)
    }
    this.notifyChange()
    return true
  }

  // ── Bulk hydration (for providers) ────────────────────────────────

  /**
   * Replace the entire in-memory store with externally loaded data. Used by
   * providers during boot to hydrate from disk. Notifies change once.
   * @param entries - the full entry set.
   * @param groups - the full group set.
   */
  hydrate(entries: readonly KnowledgeEntry[], groups: readonly KnowledgeGroup[]): void {
    this.entries.clear()
    this.groups.clear()
    let maxEntryNum = 0
    let maxGroupNum = 0
    for (const entry of entries) {
      this.entries.set(entry.id, entry)
      const num = extractCounter(entry.id, 'k_')
      if (num > maxEntryNum) maxEntryNum = num
    }
    for (const group of groups) {
      this.groups.set(group.id, group)
      const num = extractCounter(group.id, 'g_')
      if (num > maxGroupNum) maxGroupNum = num
    }
    this.entryCounter = maxEntryNum
    this.groupCounter = maxGroupNum
    this.notifyChange()
  }

  // ── Internals ─────────────────────────────────────────────────────

  /** Add an entry id to a group's entryIds list. */
  private addEntryToGroup(groupId: KnowledgeGroupId, entryId: KnowledgeEntryId): void {
    const group = this.groups.get(groupId)
    if (group === undefined) return
    if (!group.entryIds.includes(entryId)) {
      this.groups.set(groupId, { ...group, entryIds: [...group.entryIds, entryId] })
    }
  }

  /** Remove an entry id from a group's entryIds list. */
  private removeEntryFromGroup(groupId: KnowledgeGroupId, entryId: KnowledgeEntryId): void {
    const group = this.groups.get(groupId)
    if (group === undefined) return
    this.groups.set(groupId, { ...group, entryIds: group.entryIds.filter(id => id !== entryId) })
  }

  /** Notify knowledge-change observers with per-listener containment. */
  private notifyChange(): void {
    for (const callback of this.ctx.events.dispatch('emit', ['knowledge/change'])) {
      try {
        const returned: unknown = callback()
        void Promise.resolve(returned).catch((error: unknown) => {
          this.ctx.logger.warn(`knowledge/change listener rejected: ${String(error)}`)
        })
      } catch (error: unknown) {
        this.ctx.logger.warn(`knowledge/change listener threw: ${String(error)}`)
      }
    }
  }
}

/** Extract the numeric counter from a branded id like `k_42` or `g_7`. */
function extractCounter(id: string, prefix: string): number {
  if (!id.startsWith(prefix)) return 0
  const num = Number(id.slice(prefix.length))
  return Number.isFinite(num) ? num : 0
}

/** Validate entry input fields. */
function validateEntryInput(input: KnowledgeEntryInput): void {
  if (typeof input.title !== 'string' || input.title.trim().length === 0) {
    throw new Error('knowledge entry title must be a non-empty string')
  }
  if (typeof input.content !== 'string' || input.content.trim().length === 0) {
    throw new Error('knowledge entry content must be a non-empty string')
  }
  if (!isKnowledgeCategory(input.category)) {
    throw new Error(`invalid knowledge category "${String(input.category)}"`)
  }
}

/** Validate group input fields. */
function validateGroupInput(input: KnowledgeGroupInput): void {
  if (typeof input.name !== 'string' || input.name.trim().length === 0) {
    throw new Error('knowledge group name must be a non-empty string')
  }
  if (typeof input.description !== 'string') {
    throw new Error('knowledge group description must be a string')
  }
}

/** Apply a filter to an entry list. */
function applyFilter(entries: KnowledgeEntry[], filter: KnowledgeEntryFilter): KnowledgeEntry[] {
  let results = entries
  if (filter.query !== undefined) {
    const terms = filter.query.toLowerCase().split(/\s+/).filter(t => t.length > 0)
    if (terms.length > 0) {
      results = results.filter((entry) => {
        const haystack = `${entry.title} ${entry.content} ${entry.tags.join(' ')}`.toLowerCase()
        return terms.some(term => haystack.includes(term))
      })
    }
  }
  if (filter.category !== undefined) {
    results = results.filter(entry => entry.category === filter.category)
  }
  if (filter.groupId !== undefined) {
    results = results.filter(entry => entry.groupId === filter.groupId)
  }
  if (filter.tags !== undefined && filter.tags.length > 0) {
    const tagSet = new Set(filter.tags)
    results = results.filter(entry => entry.tags.some(tag => tagSet.has(tag)))
  }
  if (filter.limit !== undefined && filter.limit >= 0) {
    results = results.slice(0, filter.limit)
  }
  return results
}

export default KnowledgeStore
