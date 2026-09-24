---
description: "The console workbench for maintainers: a sidebar footer action that opens a fullscreen three-column monitoring modal (session status, task statistics, host metrics, activity timeline with an instruction composer, a knowledge-base view, and Smart Q&A)."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-console

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-client-ui-console` is the browser console workbench of the dsh web GUI. One sidebar footer action opens a fullscreen three-column modal: session status, task statistics, host metrics, a scoped timeline rendering the selected session's conversation with an instruction composer, a placeholder knowledge base, and Smart Q&A. Session state and verbs come from `ctx.sessions`, `ctx.workspaces`, and the `sessionStats` projection; host metrics arrive over the forwarded `host/metrics` event, the conversation is folded from the session's event feed, and the unscoped rows come from forwarded `api-session/*` events plus a one-time list backfill. Use it to watch and steer sessions without leaving the GUI.

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

- **Session status** — a stats/grid toggle. The stats view counts total, running, awaiting-input, completed, and archived sessions; the grid view tiles one status-colored square per session (green running, amber waiting, red planning/pending, brand-blue available, grey archived) with current/selection outlines and a right-click context menu for open, rename, fork, and archive. A left click sets the console's scope — the one session the task statistics, the timeline, and the instruction composer all follow — and an `All sessions` pill in the card header clears it.
- **Task statistics** — a scope line (the whole list or the selected session) plus running, turns, steps, LLM time, and tool-time counts from the `sessionStats` projection. It also shows what those tokens cost, priced from the operator's table over the sessions in scope.
- **System status** — CPU / memory / GPU ring gauges from the forwarded `host/metrics` event.
- **Timeline** — the selected session's own conversation, or the cross-session activity list while nothing is selected. Scoped, it renders each operator message as a right-aligned bubble and each assistant reply as left-aligned text above one metadata row carrying that reply's own timestamp; the apply closure subscribes to the session's event feed and publishes the folded messages, so the card holds no subscription itself. Only durable `user/message` events whose source is the operator and `assistant/message` replies render; a scoped session whose loaded window holds neither shows an empty hint. Unscoped, it lists one coarse row per forwarded `api-session/status` and `api-session/activity` event plus one backfilled `history` row per session the client already lists, ordered oldest update first so the newest session renders at the top; that backfill runs once, the first time the workbench opens on an empty timeline. The default all view renders every row, the status-only brief view is a toggle, and such a row collapses to the short session header and offers the expand toggle that reveals the session's human-facing title. The instruction composer at the card's foot sends to the selected session in both views.
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
- **One bucket names no endpoint** — the cost item charges exactly the sessions in scope, but a table that prices one model through two endpoints cannot be applied to a bucket that carries none, so that route is reported ambiguous rather than charged.
- **The unscoped timeline is a coarse activity mirror** — with no session scoped it renders forwarded `api-session/status` and `api-session/activity` rows plus one backfilled `history` row per known session, not the session event stream. Those rows are forwarded events and a list snapshot, so the backfill never repeats: it runs once, from the list the client holds at that moment.
- **The scoped timeline renders the loaded event window only** — the conversation is folded from the session's own event window, which the Session Controller fills with a partial tail plus whatever older pages it has fetched; the card neither fetches nor pages, so a long session shows the messages that window holds rather than all of them. Only durable operator `user/message` events and `assistant/message` replies carry renderable text: injected context, Client-only streaming rows, and attempts that committed no surface message are left out, and the assistant metadata row carries that reply's timestamp alone, because the console has no per-message token count or cost (cost is reported per session).
- **The knowledge base has no backend seam** — the card renders an empty/placeholder state and a row type is exported so a future source can feed it.
- **Pending interactions are a monitoring hint** — the console colors the session grid square by a pending question or plan review but does not answer them inline; answering belongs to the conversation composer.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
