---
description: "Knowledge store service definition (ctx.knowledge): the in-memory CRUD registry over knowledge entries and groups, with a change notification consumers and persistence providers depend on."
kind: "package-reference"
---

# @deepseek-ai/dsh-knowledge

English | [中文](README.zh.md)

## Summary

`dsh-knowledge` owns the Service Definition role of the knowledge capability seam: the `ctx.knowledge` service declaring the in-memory registry for knowledge entries and groups. It mints branded ids, validates inputs and categories, and emits `knowledge/change` on every mutation. Concrete providers such as `dsh-knowledge-file` attach persistence by hydrating the store on boot and writing mutations back; this package owns the runtime registry, the type vocabulary, and change notification only.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

A consumer reads and writes the knowledge catalog exclusively through `ctx.knowledge`: `listEntries(filter)` (matched case-insensitively against title, content, and tags, newest first), `getEntry`, `saveEntry`, `updateEntry`, `deleteEntry`, `listGroups`, `getGroup`, `createGroup`, `deleteGroup`, `assignToGroup`, and `hydrate`. The `knowledge/types` subpath carries the browser-safe entry/group/category/filter vocabulary.

### What the store offers

Entries have a category from `KNOWLEDGE_CATEGORIES`, free-form tags, an optional group, and an optional originating session. Groups carry a name, description, and the ordered entry ids they contain. Ids are branded (`KnowledgeEntryId`/`KnowledgeGroupId`); the store assigns `createdAt`/`updatedAt` and appends an entry id to its group's `entryIds`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The store is a plain `Service` owning two `Map`s (entries, groups) plus monotonic counters. Mutations validate input at the boundary, apply the change, and emit the unfiltered `knowledge/change` invalidation notification with per-listener containment (a throwing listener cannot veto the mutation). `updateEntry` only merges supplied fields and refreshes `updatedAt`; `deleteGroup` clears each member's `groupId`. `hydrate` replaces the whole registry and reprobes the counters from the highest `k_`/`g_` id, so a persistence provider can rehydrate without losing id monotonicity.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [knowledge-file](../knowledge-file/README.md) — the JSON-file persistence provider hydrating this store.
- [tool-knowledge](../tool-knowledge/README.md) — the model-facing `knowledge_search`/`save_knowledge` tools and system-prompt injection.
- [knowledge-controller](../../api/knowledge-controller/README.md) — the `knowledge` Remote owner the web client reads.

-----

<a id="model-experience"></a>
## Model Experience

### Entries reached through the knowledge tools

#### What the model sees

The store itself is host-side and never appears in a model request. The model reaches entries through the `knowledge_search` tool (returns title, content, category, tags) and records entries through `save_knowledge`; both are implemented in `dsh-tool-knowledge`. This package supplies the in-memory registry those tools read and write.

#### Token effect

Zero. This package never injects prompt text; system-prompt injection and token budgeting live in `dsh-tool-knowledge`.

#### KV Cache effect

None. This package never edits request tokens.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits are current package constraints.

- **Change notification is unfiltered** — consumers refetch the whole catalog for their own filter; there is no per-entry event payload.
- **In-memory only by default** — without a persistence provider the catalog is lost on process restart.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
