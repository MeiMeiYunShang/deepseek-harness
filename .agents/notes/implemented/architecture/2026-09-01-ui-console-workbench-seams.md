# Agent Note: console workbench onto the target seams

Status: implemented

English | [中文](2026-09-01-ui-console-workbench-seams.zh.md)

## Problem

The console-bridge migration needed a browser workbench the old apiproxy surface no longer supports. The source `ui-console` consumed an apiproxy mux stream and an HTTP/SSE `LlmApi.chat`, neither of which exists on the target: session state lives in `ctx.sessions`, host events cross the Remote forwarding allowlist, and completions go through the `LlmRuntime` `chat` Remote. The workbench had to be rebuilt against those seams, or the sole consumer of the new `chat` Remote would have no end-to-end consumer.

## Decision

`packages/client/ui-console` is a browser plugin contributing one `sidebar.footer.action` slot (`id: 'console'`, `order: 40`) that opens a fullscreen `Modal`. Every value arrives from a documented target seam:

| Concern | Seam |
| --- | --- |
| session list / status / current | `useSessions` over `ctx.sessions.list` |
| forwarded session activity | `ctx.remote.$on('api-session/activity' \| 'status')` |
| host resource metrics | `ctx.remote.$on('host/metrics')` |
| pending `ask_user_question` / `plan-review` | `useSessionPendingInteraction` over `ctx.uiSession.pendingInteractions` |
| cumulative task statistics | `sessionStats` projection on `SessionSummary.projectionValues` |
| model cost | `sessionStats.routes` (per-route tokens) priced against the `console-pricing` settings table |
| sidebar footer action | `ctx.slots.inject('sidebar.footer.action', …)` |
| fullscreen overlay | `Modal` from `dsh-client-ui-primitives` |
| Smart Q&A completions | `ctx.remote.llm.chat(request)` -> `AsyncIterable<LlmChatChunk>` |

The store is fed in `apply` by the forwarded `api-session/*` and `host/metrics` events and exposed to the component through the register `hooks` compartment (the renderer binds `useConsole`), so no cross-plugin value import crosses the client-bundle purity gate. Registration is the standard three surfaces (`tsconfig.client.json`, the `dsh.client` row in web-app `cordis.patch.yml`, and the web-app dependency) plus the hand-written `tsconfig.base.json` paths alias the source-launch resolver requires.

## Alternatives considered

### Port the full source workbench, including its dialogs and inline answer card

Rejected. The source dialogs (New Session with workspace/preset, rename/fork/archive context menu, inline composer) call target APIs that do not map cleanly (`api.sessions.prompt`, `api.agentPresets.*`, `api.workspace.*` are not the `ctx.sessions` and Remote surfaces that exist today), and the inline `ask_user_question` answer card needs the concrete `PendingQuestion` presentation class, which lives in `ui-user-questions` — a runtime cross-feature value import the client-bundle purity gate forbids. The workbench is therefore a monitoring mirror: it names which sessions hold a pending question or plan review, but answering belongs to the conversation composer.

### Expose the store to the component through a rendered inject value

Rejected. Handing the component a selector hook built in `apply` requires `bindSnapshotSelector`, which lives in `ui-renderer` and is not a sanctioned cross-package value import (the bundle purity gate rejects it). The sealed path is the register `hooks` compartment, which the renderer binds into `use<Name>` selector hooks at the binding site.

### Price the flat token totals at the session's current model

Rejected. One session can switch models mid-conversation, and `sessionStats` reports one flat token total per session; pricing that total at whichever model the session happens to be on over- or under-charges every step served by another route. The projection therefore folds `request/header` — logged inside its step, and only when the header changes, so the fold carries the route forward — and buckets `assistant/message` usage per `(provider, model)`.

### Show an unpriced route as zero

Rejected. The operator's `console-pricing` table is the only price source, so a route it does not list has an unknown charge, not a free one; `totalCost` returns those routes separately and the card renders the unpriced label instead of a figure. A route the table prices at zero still renders zero, because that is a recorded fact.

## Consequences

- Cost is a whole-list figure: the card renders it only in the all-sessions scope, because one session's share of a shared price table is not what scoping to a conversation asks for.
- The console is a monitoring mirror, not a full conversation surface: pending interactions are listed, not answered; the timeline is a coarse label over forwarded `api-session/*` events rather than the full session event window.
- Smart Q&A is disabled until the `console-bridge.smartQaModel` setting (`provider/model`) is configured; there is no client model-catalog remote to seed a default.
- `ctx.remote.llm.chat` is covered end to end by the console's Smart Q&A panel (see the `chat` Remote Agent Note for the wire shape).
