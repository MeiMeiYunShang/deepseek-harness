# Knowledge

English | [中文](knowledge.zh.md)

Persistent user-managed notes and groups owned by the `packages/knowledge/*` packages. Entries carry searchable text, tags, and an optional group; groups organize entries and can be assigned at write time. The file-backed provider keeps durable state; the controller exposes the service over the remote gateway for browser settings UI.

Sources: [`packages/knowledge/knowledge/src/index.ts`](../../packages/knowledge/knowledge/src/index.ts), [`packages/api/knowledge-controller/src/index.ts`](../../packages/api/knowledge-controller/src/index.ts), [`packages/knowledge/knowledge-file/src/index.ts`](../../packages/knowledge/knowledge-file/src/index.ts), [`packages/knowledge/tool-knowledge/src/index.ts`](../../packages/knowledge/tool-knowledge/src/index.ts)

## Durable records

`KnowledgeEntry` is the persisted note: `id`, `title`, `content`, `category`, optional `groupId`, `tags`, and timestamps. `KnowledgeGroup` collects entries under a `name`. The service folds create, update, delete, list, and group assignment; the file provider writes one entry per JSON file and a groups index, then emits `knowledge/change` so caches can invalidate.

## Tool surface

`dsh-tool-knowledge` exposes two model-callable tools: `knowledge/search` returns matching entries ranked by text relevance, and `knowledge/save` records a new entry. The tool reads the knowledge service, formats results as context, and appends a `knowledge/summary-llm-request` log event when it asks a model to summarize large content before storage.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxknowledge--knowledgestore"></a>

### `ctx.knowledge` — `KnowledgeStore`

In-memory knowledge store. Providers attach a persistence backend by listening to `knowledge/change` and hydrating entries on boot. The store itself owns the runtime registry, id minting, and change notification.

```ts cordis-catalog
/**
 * List knowledge entries matching the optional filter. Results are sorted by
 * creation time descending (newest first). The filter's `query` matches
 * case-insensitively against title, content, and tags.
 * @param filter - optional filter criteria.
 * @returns matching entries in creation-time descending order.
 */
listEntries(filter?: KnowledgeEntryFilter): KnowledgeEntry[]

/**
 * Look up a single knowledge entry by id.
 * @param id - the entry id.
 * @returns the entry, or undefined when not found.
 */
getEntry(id: KnowledgeEntryId): KnowledgeEntry | undefined

/**
 * Create a new knowledge entry. The store assigns the id, createdAt, and
 * updatedAt timestamps. If a `groupId` is supplied, the group must exist and
 * the entry id is appended to its `entryIds`.
 * @param input - the entry content and metadata.
 * @returns the newly created entry.
 */
saveEntry(input: KnowledgeEntryInput): KnowledgeEntry

/**
 * Update an existing knowledge entry. Only supplied fields are changed; the
 * `updatedAt` timestamp is refreshed. Returns the updated entry or undefined
 * when the id is not found.
 * @param id - the entry to update.
 * @param patch - partial fields to merge.
 * @returns the updated entry, or undefined when not found.
 */
updateEntry(id: KnowledgeEntryId, patch: Partial<Pick<KnowledgeEntryInput, 'title' | 'content' | 'category' | 'tags' | 'groupId'>>): KnowledgeEntry | undefined

/**
 * Delete a knowledge entry. Removes it from any group it belongs to.
 * @param id - the entry to delete.
 * @returns whether the entry existed and was removed.
 */
deleteEntry(id: KnowledgeEntryId): boolean

/**
 * List all knowledge groups.
 * @returns all groups in creation order.
 */
listGroups(): KnowledgeGroup[]

/**
 * Look up a single group by id.
 * @param id - the group id.
 * @returns the group, or undefined when not found.
 */
getGroup(id: KnowledgeGroupId): KnowledgeGroup | undefined

/**
 * Create a new knowledge group.
 * @param input - the group name and description.
 * @returns the newly created group.
 */
createGroup(input: KnowledgeGroupInput): KnowledgeGroup

/**
 * Delete a knowledge group. Entries belonging to the group have their
 * `groupId` cleared.
 * @param id - the group to delete.
 * @returns whether the group existed and was removed.
 */
deleteGroup(id: KnowledgeGroupId): boolean

/**
 * Assign an entry to a group. If the entry was in another group, it is
 * removed from that group first.
 * @param entryId - the entry to assign.
 * @param groupId - the target group.
 * @returns whether the assignment succeeded (both entry and group must exist).
 */
assignToGroup(entryId: KnowledgeEntryId, groupId: KnowledgeGroupId): boolean

/**
 * Replace the entire in-memory store with externally loaded data. Used by
 * providers during boot to hydrate from disk. Notifies change once.
 * @param entries - the full entry set.
 * @param groups - the full group set.
 */
hydrate(entries: readonly KnowledgeEntry[], groups: readonly KnowledgeGroup[]): void
```

Source: [`packages/knowledge/knowledge/src/index.ts`](../../packages/knowledge/knowledge/src/index.ts)

<a id="ctxknowledgecontroller--knowledgecontroller"></a>

### `ctx.knowledgeController` — `KnowledgeController`

Host service backing the generated `ctx.remote.knowledge` namespace. Every write validates its wire input at the boundary before touching the store, and every store refusal is classified as a `knowledge/*` RemoteError.

```ts cordis-catalog
/**
 * List knowledge entries and groups for a browser catalog.
 * @param filter - entry filter criteria.
 * @returns matching entries (newest first) and every group.
 */
@Remote list(filter: KnowledgeListRequest): KnowledgeListValue

/**
 * Look up one knowledge entry.
 * @param id - entry identity.
 * @returns the requested entry.
 * @throws RemoteError `knowledge/not-found` when the id is unknown.
 */
@Remote get(id: KnowledgeEntryId): KnowledgeGetValue

/**
 * Create a knowledge entry.
 * @param input - entry content and metadata.
 * @returns the created entry.
 * @throws RemoteError `knowledge/invalid-input` or `knowledge/invalid-category`.
 */
@Remote create(input: KnowledgeCreateInput): KnowledgeCreateValue

/**
 * Update a knowledge entry.
 * @param id - entry identity.
 * @param patch - fields to merge.
 * @returns the updated entry.
 * @throws RemoteError `knowledge/not-found` or `knowledge/invalid-category`.
 */
@Remote update(id: KnowledgeEntryId, patch: KnowledgeUpdatePatch): KnowledgeUpdateValue

/**
 * Delete a knowledge entry.
 * @param id - entry identity.
 * @returns deletion confirmation (idempotent for an unknown id).
 */
@Remote delete(id: KnowledgeEntryId): KnowledgeDeleteValue

/**
 * Create a knowledge group.
 * @param input - group name and description.
 * @returns the created group.
 * @throws RemoteError `knowledge/invalid-input` when the name is blank.
 */
@Remote createGroup(input: KnowledgeGroupCreateInput): KnowledgeGroupCreateValue

/**
 * Delete a knowledge group, clearing entry membership.
 * @param id - group identity.
 * @returns deletion confirmation (idempotent for an unknown id).
 */
@Remote deleteGroup(id: KnowledgeGroupId): KnowledgeGroupDeleteValue
```

Source: [`packages/api/knowledge-controller/src/index.ts`](../../packages/api/knowledge-controller/src/index.ts)

<a id="knowledge-events"></a>

### `knowledge/*` events

<a id="knowledgechange--emit"></a>

#### `knowledge/change` — emit

A knowledge entry or group was created, updated, or deleted. This is an unfiltered invalidation notification; consumers refetch the catalog for their own filter. Listener failures are contained and cannot veto the store mutation.

```ts cordis-catalog
/**
 * A knowledge entry or group was created, updated, or deleted. This is an
 * unfiltered invalidation notification; consumers refetch the catalog for
 * their own filter. Listener failures are contained and cannot veto the
 * store mutation.
 * @mode emit
 */
'knowledge/change'(): void
```

Source: [`packages/knowledge/knowledge/src/index.ts`](../../packages/knowledge/knowledge/src/index.ts)
<!-- END GENERATED cordis-surface -->
