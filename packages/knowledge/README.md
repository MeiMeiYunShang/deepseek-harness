---
description: "The knowledge capability family: an in-memory knowledge store, a JSON-file persistence provider, model-facing search/save tools with system-prompt injection, and the knowledge Remote owner for the web client."
kind: "package-group"
---

# knowledge/ — knowledge capability family

English | [中文](README.zh.md)

## Summary

The knowledge group stores reusable experience as cataloged entries and groups. The `knowledge` package owns the Service Definition (`ctx.knowledge`): an in-memory CRUD registry that mints ids, validates categories, and emits `knowledge/change` on every mutation. `knowledge-file` attaches JSON-file persistence, hydrating the store from a configured root on boot and writing every change back as one file per entry and group. `tool-knowledge` is the model-facing consumer: the `knowledge_search` and `save_knowledge` tools, a token-budgeted system-prompt section, and optional session auto-summarization. `api/knowledge-controller` projects the store onto the wire as the `knowledge` Typert namespace for the web client.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`knowledge`](knowledge/README.md) | Defines the in-memory store: entries, groups, categories, filters, and change notification | `ctx.knowledge` |
| [`knowledge-file`](knowledge-file/README.md) | Persists entries and groups as one JSON file each under a configurable root | listens on `knowledge/change` |
| [`tool-knowledge`](tool-knowledge/README.md) | Registers `knowledge_search`/`save_knowledge`, injects the knowledge context section, and auto-summarizes sessions | registers on `ctx.tools` |
| [`api/knowledge-controller`](../api/knowledge-controller/README.md) | Projects the store onto the wire as the `knowledge` Remote namespace | `ctx.remote.knowledge` |

A deployment mounts at least the store and a persistence provider; the model-facing consumer and the web controller are additive. Enabling `tool-knowledge` without a persistence provider keeps the catalog process-local.

-----

<a id="related-documentation"></a>
## Related documentation

- [system-prompt subsystem](../../docs/subsystems/system-prompt.md) — the section-order owner the model-facing consumer registers into.
- [Slots reference (web client)](../../docs/subsystems/slots.md) — how the web client surfaces are composed.

<a id="dev-note"></a>
## Dev Note

None.
