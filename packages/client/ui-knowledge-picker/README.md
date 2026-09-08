---
description: "Knowledge multi-select picker for the dsh web client: a chip on the blank-session Hero and a composer-tool-row toggler sharing one client-side selection, catalogued through the knowledge Remote."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-knowledge-picker

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-knowledge-picker` lets a user stage known knowledge entries before a session starts: a chip on the blank-session Hero and the same picker as a composer-tool-row toggler open one multi-select dialog. The catalog is a read-only projection of the Host knowledge store fetched through the `knowledge` Remote; the selection is client-side and intended to travel with the next session prompt.

The Hero chip and the composer toggler are one component registered into two slots, so the selection is literally one state: the `conversation.hero.knowledge` single slot and the `conversation.input.left` list slot share a single store instance exposed through the injected `hooks` compartment. The composer entry carries a slot label (`composerToggler`).

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

Click the Knowledge chip on the blank-session screen or the composer toolbar to open the picker, then check the entries to stage. The chip shows the staged count; an empty catalog shows `No entries`. The dialog search filters by title, category, and tag.

### What the source offers

The catalog comes from `ctx.remote.knowledge.list({})`; a failed call folds into an error store state and the chip shows no entries. The selection persists client-side for the session lifetime.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The store is declared through `createKnowledgePickerStore()` (a factory, so a plugin reload cannot reuse a module-global instance). Inside `apply` the factory is called once, and the resulting instance's source rides the injected `hooks` compartment of both register sites, so the two entries read and write one selection regardless of their differing slot scopes (Hero is root-scope, the composer is session-scope).

### Registration

The `/client` exports are the plugin body (`apply`/`inject`) only; the `KnowledgePicker` component is internal to the registration effect. The Hero chip registers into `conversation.hero.knowledge`; the composer toggler registers into `conversation.input.left` with `id: 'knowledge-picker'`, `order: 0`, and a `composerToggler` label. Both use `ctx.slots.inject`, so they wait on the ui-conversation declarations.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the Host knowledge store and the conversation shell seats.

- [knowledge](../../knowledge/knowledge/README.md) — the Host knowledge store service (`ctx.knowledge`).
- [knowledge-controller](../../api/knowledge-controller/README.md) — the `knowledge` Remote owner the picker reads.
- [ui-conversation](../ui-conversation/README.md) — the shell declaring the Hero and composer slots.

-----

<a id="model-experience"></a>
## Model Experience

### Staged knowledge selection

#### What the model sees

The picker itself adds nothing to any model request. The catalog is fetched through `ctx.remote.knowledge.list({})`; the selection is client-side state, and this package does not inject it into a prompt, so the model sees no change from the picker. (How a staged selection is projected onto a subsequent prompt is deferred; see Known Limitations.)

#### Token effect

None. The catalog fetch, menu browse, and staged selection add zero model tokens.

#### KV Cache effect

None. This package never edits request tokens.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits are current package constraints.

- **The staged selection does not reach the model** — the store holds the chosen ids client-side, but no prompt construction consumes them yet. Wiring a staged selection into the next session prompt is deferred.
- **Catalog load failure is silent** — a failed `knowledge.list` folds into an error store state and the chip shows no entries; the failure is not surfaced to the user as a retry affordance.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
