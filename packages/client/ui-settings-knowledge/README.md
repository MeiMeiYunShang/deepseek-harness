---
description: "Knowledge catalog settings page for the dsh web client: a list with search and category/group filtering, inline create/update, delete, a groups panel, and an entry detail, all backed by the knowledge Remote."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-knowledge

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-settings-knowledge` adds a Knowledge page to Web Settings. The page lists knowledge entries with search plus category and group filtering, and supports inline create/update, delete with confirmation, a group panel (create/delete), and an entry detail disclosure. Every mutation goes through the `knowledge` Remote and the page re-reads the catalog from the Host on success, so the Host stays the single fact source.

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

Open Settings → Knowledge. The page shows the entry catalog and a groups panel. Use the toolbar to search or filter by category/group; `New entry` opens the inline editor. A row's edit/delete actions open the same editor prefilled or a delete confirmation.

### What the source offers

The section reads `ctx.remote.knowledge.list({})` and issues `create`/`update`/`delete`/`createGroup`/`deleteGroup`; each write refetches the catalog. The store publishes the catalog snapshot; the component keeps editor, filter, and detail state local.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The catalog is declared through `createKnowledgeSettingsStore()` (a factory) and registered with the `settings.section` entry as its store seat; the component reads it through `useStore`. The inject face supplies the mutation callbacks, which close over the action set the framework hands to the inject factory and refetch the catalog on each success. `connection/reset` refreshes a settled catalog.

### Registration

The plugin registers one `settings.section` entry with `id: 'knowledge'`, `order: 30`, and a `nav` label, via `ctx.slots.inject`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the Host knowledge store and the settings shell.

- [knowledge](../../knowledge/knowledge/README.md) — the Host knowledge store service (`ctx.knowledge`).
- [knowledge-controller](../../api/knowledge-controller/README.md) — the `knowledge` Remote owner behind every mutation.
- [ui-settings](../ui-settings/README.md) — the shell owning the `settings.section` slot.

-----

<a id="model-experience"></a>
## Model Experience

### Knowledge catalog management

#### What the model sees

The settings page adds nothing to any model request. Mutations issue `ctx.remote.knowledge.create`/`update`/`delete`; it is a user-visible management surface, and no catalog text changes what the model receives.

#### Token effect

None. Every read and write is a user-visible management operation with zero model tokens.

#### KV Cache effect

None. This package never edits request tokens.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits are current package constraints.

- **Edit is a single inline editor shared by create and update** — opening a second entry while an editor is open replaces the draft; there is no multi-row editing.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
