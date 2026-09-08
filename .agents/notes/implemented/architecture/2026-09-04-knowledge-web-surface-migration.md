# Agent Note: Web knowledge surface over the `knowledge` Remote

Status: implemented

English | [中文](2026-09-04-knowledge-web-surface-migration.zh.md)

## Problem

The Knowledge capability moved into the harness as three host packages (`dsh-knowledge`, `dsh-knowledge-file`, `dsh-tool-knowledge`) plus a Typert owner (`dsh-api-knowledge-controller`), but the web client had no surface to stage or manage that catalog.

## Decision

Add two browser client packages over the generated `ctx.remote.knowledge` namespace, consuming the `knowledge` Remote through the api-remotes facade:

- `dsh-client-ui-knowledge-picker` — a multi-select chip on the blank-session Hero (`conversation.hero.knowledge`, single) and a toggler in the composer tool row (`conversation.input.left`, `id: 'knowledge-picker'`, `order: 0`). One `createKnowledgePickerStore()` instance is exposed through both registers' injected `hooks` compartment, so the two entries are one selection despite their differing slot scopes (Hero is root-scope, the composer is session-scope).
- `dsh-client-ui-settings-knowledge` — a `settings.section` entry (`id: 'knowledge'`, `order: 30`). It reads `knowledge.list` and issues `create`/`update`/`delete`/`createGroup`/`deleteGroup`, refetching the catalog after each write (the Host stays the single fact source). The catalog is a declared store; editor/filter/detail state is component-local.

Both packages follow the client discipline: components never see `ctx`, all data arrives through the props shares or the injected `hooks` compartment, product copy is a typed locale dictionary, and registrations route through `ctx.slots.inject` so they wait on the ui-conversation / ui-settings declarations.

## Alternatives considered

- **Reuse a shared controller class passed through inject** (as `ui-agent-preset` does for its seat) — works, but the picker needed factory-driven stores per the client convention, so `defineStore` + one `.create()` in `apply` with the source in the `hooks` compartment was the closer fit.
- **Declare a store on the picker registers** — not possible: a declared store keys its instance by scope, so a root-scope Hero and a session-scope composer would get two instances instead of one shared selection.

## Consequences

- The picker catalog is read-only; the settings page is the writer.
- The picker selection is currently client-side only: nothing yet projects it onto a subsequent prompt. That is a documented Known Limitation (deferred work).
- The image-understanding and mcpsec-manager migrations remain separate follow-up stages.
