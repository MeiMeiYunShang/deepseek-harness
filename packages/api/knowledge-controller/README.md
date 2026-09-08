---
description: "Typert Remote owner for the knowledge namespace: projects ctx.knowledge CRUD onto the wire for browser consumers, validating every write at the boundary."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-knowledge-controller

English | [中文](README.zh.md)

## Summary

`dsh-api-knowledge-controller` is the Host Remote owner of the `knowledge` Typert namespace. It projects the `ctx.knowledge` store onto the wire for browser consumers: `list`, `get`, `create`, `update`, `delete`, `createGroup`, and `deleteGroup`. Every write validates its wire input at the boundary before touching the store, and store refusals are classified as `knowledge/*` `RemoteError`s.

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

Browser consumers reach the namespace through `ctx.remote.knowledge` (mounted by the api-remotes client assembly). The `./types` subpath carries the browser-safe request/value vocabulary (`KnowledgeEntryView`, `KnowledgeGroupView`, `KnowledgeCreateInput`, `KnowledgeUpdatePatch`, `KnowledgeListRequest`, and the branded id types). This package is a Host-side controller: it is mounted on the Host, never imported into a bundle as runtime.

### What the source offers

`list(filter)` returns entries (newest first) and every group; `create`/`update`/`delete` mutate entries; `createGroup`/`deleteGroup` mutate groups. A blank group name, an invalid category, or an unknown id map to `knowledge/invalid-input`, `knowledge/invalid-category`, or `knowledge/not-found`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The controller extends `TypertRemoteService` and annotates each method with `@Remote`; the wire schema is inferred from the method signatures (no `@typert` tags). It resolves the store through `ctx.get('knowledge')`, throwing `gateway/internal` when a composition mounts the controller without a knowledge store. `entryView`/`groupView` project store rows field by field, omitting absent optional fields. The method parameters carry no defaults, so a client always passes an explicit filter object (e.g. `list({})`).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [knowledge](../../knowledge/knowledge/README.md) — the store this controller projects onto the wire.
- [api-remotes](../../api/remotes/README.md) — the client assembly that mounts the generated namespace onto `ctx.remote`.
- [ui-settings-knowledge](../../client/ui-settings-knowledge/README.md) — the primary browser consumer of these methods.

-----

<a id="model-experience"></a>
## Model Experience

### Knowledge catalog over the wire

#### What the model sees

The controller is Host-side and adds nothing to a model request. It is the transport behind the user-visible knowledge picker and settings page; the model reaches knowledge only through `knowledge_search`/`save_knowledge` (see `dsh-tool-knowledge`).

#### Token effect

Zero. No prompt text arrives from this controller.

#### KV Cache effect

None. This package never edits request tokens.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits are current package constraints.

- **Reads are a full catalog projection** — `list` returns entries and groups in one call; there is no paging beyond the store filter's `limit`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
