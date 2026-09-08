/**
 * Host Remote owner for the `knowledge` namespace: CRUD over `ctx.knowledge`
 * projected onto the wire for browser consumers.
 *
 * @module @deepseek-ai/dsh-api-knowledge-controller
 */

import { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import KnowledgeStore, { KnowledgeEntryId, KnowledgeGroupId, isKnowledgeCategory } from '@deepseek-ai/dsh-knowledge'
import type { KnowledgeCategory, KnowledgeEntry, KnowledgeGroup, KnowledgeEntryFilter } from '@deepseek-ai/dsh-knowledge'
import type {
  KnowledgeCreateInput,
  KnowledgeCreateValue,
  KnowledgeDeleteValue,
  KnowledgeEntryView,
  KnowledgeGetValue,
  KnowledgeGroupCreateInput,
  KnowledgeGroupCreateValue,
  KnowledgeGroupDeleteValue,
  KnowledgeGroupView,
  KnowledgeListRequest,
  KnowledgeListValue,
  KnowledgeUpdatePatch,
  KnowledgeUpdateValue,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `knowledge` Remote namespace. */
    knowledgeController: KnowledgeController
  }
}

/**
 * Host service backing the generated `ctx.remote.knowledge` namespace. Every
 * write validates its wire input at the boundary before touching the store, and
 * every store refusal is classified as a `knowledge/*` RemoteError.
 */
export class KnowledgeController extends TypertRemoteService {
  /** @param ctx - Host context carrying the knowledge store. */
  constructor(ctx: Context) {
    super(ctx, 'knowledgeController', { namespace: 'knowledge' })
  }

  /**
   * List knowledge entries and groups for a browser catalog.
   * @param filter - entry filter criteria.
   * @returns matching entries (newest first) and every group.
   */
  @Remote
  list(filter: KnowledgeListRequest): KnowledgeListValue {
    const knowledge = this.store()
    return {
      entries: knowledge.listEntries(entryFilterOf(filter)).map(entryView),
      groups: knowledge.listGroups().map(groupView),
    }
  }

  /**
   * Look up one knowledge entry.
   * @param id - entry identity.
   * @returns the requested entry.
   * @throws RemoteError `knowledge/not-found` when the id is unknown.
   */
  @Remote
  get(id: KnowledgeEntryId): KnowledgeGetValue {
    const entry = this.store().getEntry(id)
    if (entry === undefined) throw new RemoteError('knowledge/not-found', `knowledge entry "${id}" not found`, { id })
    return { entry: entryView(entry) }
  }

  /**
   * Create a knowledge entry.
   * @param input - entry content and metadata.
   * @returns the created entry.
   * @throws RemoteError `knowledge/invalid-input` or `knowledge/invalid-category`.
   */
  @Remote
  create(input: KnowledgeCreateInput): KnowledgeCreateValue {
    this.assertCategory(input.category)
    const knowledge = this.store()
    return { entry: entryView(knowledge.saveEntry({
      title: input.title,
      content: input.content,
      category: input.category,
      ...input.tags === undefined ? {} : { tags: input.tags },
      ...input.groupId === undefined ? {} : { groupId: input.groupId },
      ...input.sourceSessionId === undefined ? {} : { sourceSessionId: input.sourceSessionId },
    })) }
  }

  /**
   * Update a knowledge entry.
   * @param id - entry identity.
   * @param patch - fields to merge.
   * @returns the updated entry.
   * @throws RemoteError `knowledge/not-found` or `knowledge/invalid-category`.
   */
  @Remote
  update(id: KnowledgeEntryId, patch: KnowledgeUpdatePatch): KnowledgeUpdateValue {
    if (patch.category !== undefined) this.assertCategory(patch.category)
    const entry = this.store().updateEntry(id, patch)
    if (entry === undefined) throw new RemoteError('knowledge/not-found', `knowledge entry "${id}" not found`, { id })
    return { entry: entryView(entry) }
  }

  /**
   * Delete a knowledge entry.
   * @param id - entry identity.
   * @returns deletion confirmation (idempotent for an unknown id).
   */
  @Remote
  delete(id: KnowledgeEntryId): KnowledgeDeleteValue {
    this.store().deleteEntry(id)
    return { deleted: true }
  }

  /**
   * Create a knowledge group.
   * @param input - group name and description.
   * @returns the created group.
   * @throws RemoteError `knowledge/invalid-input` when the name is blank.
   */
  @Remote
  createGroup(input: KnowledgeGroupCreateInput): KnowledgeGroupCreateValue {
    if (typeof input.name !== 'string' || input.name.trim().length === 0) {
      throw new RemoteError('knowledge/invalid-input', 'knowledge group name must be a non-empty string', {})
    }
    return { group: groupView(this.store().createGroup(input)) }
  }

  /**
   * Delete a knowledge group, clearing entry membership.
   * @param id - group identity.
   * @returns deletion confirmation (idempotent for an unknown id).
   */
  @Remote
  deleteGroup(id: KnowledgeGroupId): KnowledgeGroupDeleteValue {
    this.store().deleteGroup(id)
    return { deleted: true }
  }

  /** Resolve the knowledge store or report its absence. */
  private store(): KnowledgeStore {
    const knowledge = this.ctx.get('knowledge')
    if (knowledge === undefined) {
      throw new RemoteError(
        'gateway/internal',
        'knowledge service is absent: this deployment does not mount a knowledge store in its composition',
        {},
      )
    }
    return knowledge
  }

  /** @throws RemoteError when the category is not one of `KNOWLEDGE_CATEGORIES`. */
  private assertCategory(category: KnowledgeCategory): void {
    if (!isKnowledgeCategory(category)) {
      throw new RemoteError('knowledge/invalid-category', `invalid knowledge category "${String(category)}"`, { category })
    }
  }
}

/** Project one store entry onto its wire view, field by field. */
function entryView(entry: KnowledgeEntry): KnowledgeEntryView {
  return {
    id: entry.id,
    title: entry.title,
    content: entry.content,
    category: entry.category,
    tags: [...entry.tags],
    ...entry.groupId === undefined ? {} : { groupId: entry.groupId },
    ...entry.sourceSessionId === undefined ? {} : { sourceSessionId: entry.sourceSessionId },
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}

/** Project one store group onto its wire view. */
function groupView(group: KnowledgeGroup): KnowledgeGroupView {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    entryIds: [...group.entryIds],
  }
}

/** Build a store filter from a wire request, omitting absent fields. */
function entryFilterOf(request: KnowledgeListRequest): KnowledgeEntryFilter {
  return {
    ...request.query === undefined ? {} : { query: request.query },
    ...request.category === undefined ? {} : { category: request.category },
    ...request.groupId === undefined ? {} : { groupId: request.groupId },
    ...request.tags === undefined ? {} : { tags: request.tags },
    ...request.limit === undefined ? {} : { limit: request.limit },
  }
}

export default KnowledgeController
