---
description: "JSON file persistence provider for the knowledge store: hydrates ctx.knowledge from a configurable root on boot and writes every knowledge/change mutation back as one file per entry and group."
kind: "package-reference"
---

# @deepseek-ai/dsh-knowledge-file

English | [中文](README.zh.md)

## Summary

`dsh-knowledge-file` is the persistence provider for the knowledge store. It hydrates `ctx.knowledge` from a configurable root directory (default `$DSH_HOME/knowledge/`) on boot, then listens for `knowledge/change` and writes each mutation back. Files are one JSON document per entry, under `<root>/entries/<id>.json`, and one JSON document per group under `<root>/groups/<id>.json`.

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

Configure `knowledge-file` as a plugin of the knowledge composition with a `root` path (absolute). It attaches as a `knowledge/change` listener, so it must run beside `ctx.knowledge` (its Cordis inject is `['knowledge']`). No other configuration is required.

### What the source offers

On activate it ensures `<root>/entries` and `<root>/groups`, hydrates the store, and coalesces bursts of `knowledge/change` into one flush loop so overlapping mutations never drop the final disk state. A flush rewrites the full store and removes JSON files whose id no longer exists in the registry.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The provider reads every `.json` file in each directory and `hydrate`s the registry, reproducing id counters from the highest `k_`/`g_` id. The `scheduleFlush` loop keeps a `dirty` flag set when a change lands mid-write, so a final reconciliation pass runs against the last state. A malformed or unreadable file is skipped (the store recreates it on the next write). Stale file removal is best-effort.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [knowledge](../knowledge/README.md) — the store this provider hydrates and persists.
- [tool-knowledge](../tool-knowledge/README.md) — the knowledge tools that write the entries this provider saves.

-----

<a id="model-experience"></a>
## Model Experience

### Persistence of knowledge entries

#### What the model sees

This provider is host-side and never appears in a model request. It makes `save_knowledge` results durable across restarts; a saved entry becomes available to later `knowledge_search` calls once the store writes it.

#### Token effect

Zero. No prompt text is injected.

#### KV Cache effect

None. This package never edits request tokens.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits are current package constraints.

- **Full rewrite per flush** — each flush writes every entry and group, so large catalogs pay a full rewrite instead of a per-change patch.
- **Corrupt files are silently dropped** — a malformed JSON file is skipped on hydrate; there is no repair or user-facing recovery path.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
