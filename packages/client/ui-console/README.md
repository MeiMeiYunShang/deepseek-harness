---
description: "The console workbench for maintainers: a sidebar footer action that opens a fullscreen three-column monitoring modal (session status, task statistics, host metrics, activity timeline with an instruction composer, a knowledge-base view, and Smart Q&A)."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-console

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-client-ui-console` is the browser console workbench of the dsh web GUI. It contributes one sidebar footer action that opens a fullscreen three-column monitoring modal: session status, task statistics, host resource metrics, a scoped activity timeline with an instruction composer, a placeholder knowledge base, and Smart Q&A. Session state and verbs come from `ctx.sessions`, `ctx.workspaces`, and the `sessionStats` projection; host metrics and timeline entries arrive over forwarded `host/metrics` and `api-session/*` events. Use it to watch and steer sessions without leaving the web GUI.

## Table of Contents

- [Understand the implementation](#understand-the-implementation)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The modal is a custom `role="dialog"` panel, not the boxed primitive `Modal`, laid out as three columns:

- **Session status** — a stats/grid toggle. The stats view counts total, running, awaiting-input, completed, and archived sessions; the grid view tiles one status-colored square per session (green running, amber waiting, red planning/pending, brand-blue available, grey archived) with current/selection outlines and a right-click context menu for rename, fork, and archive.
- **Task statistics** — a scope line (the whole list or the selected session) plus running, turns, steps, LLM time, and tool-time counts from the `sessionStats` projection. Over the whole list it also shows what those tokens cost, priced from the operator's table.
- **System status** — CPU / memory / GPU ring gauges from the forwarded `host/metrics` event.
- **Timeline** — a coarse activity list in brief or all verbosity, scoped to one session or the whole list, with collapsible ask-question details, plus an instruction composer that sends a prompt to the selected session.
- **Knowledge base** — a source list that currently renders an empty/placeholder state (no backend seam exists yet).
- **Smart Q&A** — streams one-shot completions over `ctx.remote.llm.chat`.

Each card has a fold toggle in its title row that collapses the body to the title bar, and a column-layout switcher in the header (Balanced / Focus / Compact) changes the grid's column proportions on wide viewports. On low-resolution screens the grid reflows responsively (three columns → two-plus-one → a single stacked column) regardless of the selected preset.

Pending interactions surface through the grid phase colors from `ctx.uiSession.pendingInteractions`; session verbs (open, rename, fork, archive, create, preset select, send instruction) ride the `ctx.sessions`, `ctx.workspaces`, and `ctx.remote.agentPresets` faces. A "new session" modal collects a workspace, an optional agent preset, and a first instruction.

### Cost accounting

The cost item is priced from the `console-pricing` settings namespace through `PriceTablePolicy` in `dsh-client-ui-primitives`, which adopts the table from every section the Host accepts: the namespace answers after the plugin mounts, so the table reaches the card whenever it arrives, and a later edit reprices the figure. `totalCost` in the same package owns the arithmetic, and it charges each band from that band's own four token counts — cache reads at the row's cache-hit rate, uncached input and cache writes at its cache-miss rate, and output at its output rate — because the `sessionStats` projection already decided each reporting event's band from that event's own time against the operator's off-peak window. The card never re-derives a band and never reconstructs a cache-miss count by subtracting the cache bands from the billed input.

A price row is keyed by `(baseUrl, provider, model)`, while a reported bucket carries only `provider` and `model`. A bucket is therefore priced only when exactly one row names that pair: no row reports it as unpriced, and several rows that differ only by endpoint report it as ambiguous, because neither endpoint's rate can be charged for tokens the bucket does not attribute to one. Both leave the figure unreported rather than charged at zero or at a guess.

</details>

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Smart Q&A requires a configured model** — the panel reads the model override from the `console-bridge` settings namespace (`smartQaModel`, `provider/model`). With no override it stays disabled; there is no client-side model catalog remote to fall back to.
- **Cost is a whole-list figure, and one bucket names no endpoint** — the item is rendered only with the all-sessions scope, and a table that prices one model through two endpoints cannot be applied to a bucket that carries none, so that route is reported ambiguous rather than charged.
- **The timeline is a coarse mirror** — it renders forwarded `api-session/activity` and `api-session/status` events as labels, not the full session event stream. Session-scoped event-window detail is intentionally left to the conversation surface.
- **The knowledge base has no backend seam** — the card renders an empty/placeholder state and a row type is exported so a future source can feed it.
- **Pending interactions are a monitoring hint** — the console colors the session grid square by a pending question or plan review but does not answer them inline; answering belongs to the conversation composer.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
