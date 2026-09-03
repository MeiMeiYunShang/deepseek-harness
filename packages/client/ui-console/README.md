---
description: "The console workbench for maintainers: a sidebar footer action that opens a fullscreen three-column monitoring modal (session status, task statistics, host metrics, activity timeline with an instruction composer, a knowledge-base view, and Smart Q&A)."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-console

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-client-ui-console` is the browser console workbench of the dsh web GUI. It contributes one sidebar footer action that opens a true fullscreen modal (a custom `role="dialog"` panel, not the boxed primitive `Modal`) laid out as three columns:

- **Session status** — a stats/grid toggle. The stats view counts total, running, awaiting-input, completed, and archived sessions; the grid view tiles one status-colored square per session (green running, amber waiting, red planning/pending, brand-blue available, grey archived) with current/selection outlines and a right-click context menu for rename, fork, and archive.
- **Task statistics** — a scope line (the whole list or the selected session) plus running, turns, steps, LLM time, and tool-time counts from the `sessionStats` projection.
- **System status** — CPU / memory / GPU ring gauges from the forwarded `host/metrics` event.
- **Timeline** — a coarse activity list in brief or all verbosity, scoped to one session or the whole list, with collapsible ask-question details, plus an instruction composer that sends a prompt to the selected session.
- **Knowledge base** — a source list that currently renders an empty/placeholder state (no backend seam exists yet).
- **Smart Q&A** — streams one-shot completions over `ctx.remote.llm.chat`.

Each card has a fold toggle in its title row that collapses the body to the title bar, and a column-layout switcher in the header (Balanced / Focus / Compact) changes the grid's column proportions on wide viewports. On low-resolution screens the grid reflows responsively (three columns → two-plus-one → a single stacked column) regardless of the selected preset.

Session status, cumulative task statistics, and the current selection come from the standard `ctx.sessions` feed and the `sessionStats` projection; pending interactions surface through the grid phase colors from `ctx.uiSession.pendingInteractions`; host resource metrics and the activity timeline come from the forwarded `host/metrics` and `api-session/*` events; and session verbs (open, rename, fork, archive, create, preset select, send instruction) ride the `ctx.sessions`, `ctx.workspaces`, and `ctx.remote.agentPresets` faces. A "new session" modal collects a workspace, an optional agent preset, and a first instruction.

## Known Limitations and Deferred Work

- **Smart Q&A requires a configured model** — the panel reads the model override from the `console-bridge` settings namespace (`smartQaModel`, `provider/model`). With no override it stays disabled; there is no client-side model catalog remote to fall back to.
- **The timeline is a coarse mirror** — it renders forwarded `api-session/activity` and `api-session/status` events as labels, not the full session event stream. Session-scoped event-window detail is intentionally left to the conversation surface.
- **The knowledge base has no backend seam** — the card renders an empty/placeholder state and a row type is exported so a future source can feed it.
- **Pending interactions are a monitoring hint** — the console colors the session grid square by a pending question or plan review but does not answer them inline; answering belongs to the conversation composer.
