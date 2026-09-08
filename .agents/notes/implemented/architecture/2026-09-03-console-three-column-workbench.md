# Agent Note: Fullscreen three-column console workbench

Status: implemented

English | [中文](2026-09-03-console-three-column-workbench.zh.md)

## Problem

The migrated ui-console was a two-column monitoring card with a stock boxed `Modal`. The maintainer console (per the migration source) is a true fullscreen workbench: a three-column grid, a per-session status grid with a stats/grid toggle, scoped timeline with an instruction composer, session verbs (rename / fork / archive / create / preset), a knowledge view, and Smart Q&A. The stock primitive `Modal` is a centered card (max 380px), so it cannot host the 100vw x 100vh panel.

## Decision

- Build a custom fullscreen shell in `Workbench.tsx` (`role="dialog" aria-modal`, mask + panel + header) rather than the boxed primitive `Modal`; the primitive remains for the nested rename and new-session dialogs.
- Split the workbench into focused pure and component modules: `format.ts`, `sessionState.ts`, `timelineText.ts` (pure helpers), and `SessionStatusCard`, `TaskStatsCard`, `SystemStatusCard`, `TimelineCard`, `KnowledgeCard`, `ContextMenu`, `modals` (components), composed by `Workbench` and opened by `ConsoleButton`.
- Enrich the store (`consoleStore`) with `sessionView`, `selectedSession`, and `timelineScope` alongside the existing timeline feed, and expose a bounded write face (`ConsoleStoreWrite`) so components only touch declared actions.
- Wire session verbs through a `ConsoleServices` face built in `index.ts` over `ctx.sessions` (`open`/`fork`/`rename` via the session behavior face/`prompt`), `ctx.workspaces` (`archiveSession`, `create`), and `ctx.remote.agentPresets` (`list`/`select`), unwrapping `RemoteResult` at the service boundary.
- Session status, task stats, current selection, and the grid come from the standard `useSessions`/`useSessionPendingInteraction`/`useWorkspaces` hooks passed through the slot composition model; the host-metrics and timeline feeds stay on forwarded remote events into the apply-owned store.
- The knowledge base has no backend seam, so `KnowledgeCard` renders an empty/placeholder state and exports a row type for a future source.

## Alternatives considered

- **Keep the boxed primitive `Modal`** — the migration source was a two-column monitoring card, and the primitive `Modal` is a centered card capped at 380px wide, so it cannot host the 100vw × 100vh maintainer workbench.
- **Extend the primitive `Modal` to a fullscreen variant** — would couple console-specific chrome (three-column grid, session verbs, scoped timeline) into a shared primitive used elsewhere; the workbench owns its own shell instead and keeps the primitive for the nested dialogs.

## Consequences

- The console is a presentation layer over real service faces; session verbs fail loudly when a binding or workspace is absent.
- The three-column grid, dark/light token discipline, and reduced-motion-aware animations follow repo conventions (no literal colors, typed `--dsw-*` tokens).
- The per-file 100% coverage gate is satisfied by the component and flow specs under `tests/`.
