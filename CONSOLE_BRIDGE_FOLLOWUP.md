# Console-bridge follow-up: `chat` Remote + ui-console workbench

Working handoff for the last remaining piece of the console-bridge migration into this
repo (target `packages/` live under `@deepseek-ai/dsh-*`, `feature-agent` branch). The
backend plugin, `host-metrics`, the `testConnection` remote, and the settings card are
already landed and verified. This file records precisely what the follow-up must do and
the mapping points found so a fresh session can start directly.

## Verified status of what already landed (do not redo)

- `packages/console/console-bridge/` — full backend plugin: `down/cmd` → runner → transport
  → `up/result` + heartbeat, `testConnection` Typert Remote (wire `./typert` + `./remote`
  generated), settings namespace `console-bridge`, 72 tests, host+client typecheck green.
- `packages/host/host-metrics/` — host sampler emitting `host/metrics`, 11 tests, wired into
  `tsconfig.host.json` + web-app bundle + host group README.
- `packages/client/ui-settings-plugins/src/client/ConsoleBridgeCard.{tsx,module.css}` +
  `console-bridge-card-controller.ts` — settings card registered into the
  `settings.plugin.item` keyed slot (`key: 'console-bridge'`), using
  `ctx.settingsScope.bind({ namespace: 'console-bridge' })` +
  `ctx.remote.consoleBridge.testConnection`. 121 ui-settings tests. `ValueField` gained a
  `password` variant; locales added.
- Bundle rows: `packages/bundle/base/cordis.patch.yml` (console-bridge loaded with
  `config: { enabled: false }`), `packages/bundle/web-app/cordis.patch.yml`
  (host-metrics + console-bridge), their `package.json` deps.

## The one coupling that shapes the follow-up

The source `packages/host/apiproxy/src/api/llm.ts` was the old apiproxy RPC contract. Its
`providers` / `models` / `discoverModels` **already exist** in the target as `LlmRuntime`
Typert Remote methods (`listProviders`, `listConfigurableProviders`, `@Remote('discoverModels')`
in `packages/llm/llm/src/index.ts`). The only genuinely new method is **`chat`** — a
streaming one-shot completion that mirrors the target host waterfall
`LlmRuntime.stream(options): AsyncIterable<StreamChunk>`.

The **sole consumer** of `chat` is the not-yet-migrated ui-console workbench's `SmartQA`
panel. `console-bridge` runs its tasks host-side via `runDshTask` (`ctx.agents`), so it
does not use `chat`. Therefore the `chat` Remote and the workbench must land together so the
consumer can be verified end-to-end.

## Module map (target files/`paths` to touch)

### A. Core LLM — add the streaming `chat` Remote (host half)

- `packages/llm/llm/src/index.ts` — `LlmRuntime extends TypertRemoteService { super(ctx,'llm') }`.
  Add a new `@Remote({ mode: 'stream' })` method (suggested name `chat`) on `LlmRuntime`:
  - Request wire type (public export): `{ provider, model, messages, system?, temperature?,
    maxTokens?, stop?, reasoningEffort? }`.
  - `messages` are the target `Message[]` (see mapping below).
  - Body: build `GenerateOptions` (`provider, model, messages, system, temperature,
    maxTokens, stop, reasoningEffort, signal?`) and `yield* this.stream(options)`.
  - Return `AsyncIterable<StreamChunk>` — reuse the existing public `StreamChunk` type so NO
    chunk re-mapping is needed client-side. (If a narrower wire shape is wanted, define a
    reduced chunk union and translate `StreamChunk` → it.)
- `packages/llm/llm/src/message.ts` / `types.ts` — mapping reference:
  - `Message` requires `source`. Build messages:
    - role `user` → `createUserMessage({ content, source: { kind: 'user' } })`.
    - role `system` → also a user-source message (the target models `system` via
      `GenerateOptions.system`, so drop any `system`-role message and set `GenerateOptions.system`
      instead). If the request already carries `system`, prefer that.
    - role `assistant` → `createAssistantMessage({ content, source: { provider, model } })`
      (provenance must name the request's `provider`/`model`).
  - `content` is `ContentBlock[]` (`packages/llm/llm/src/types.ts`, `ContentBlockMap`, merge-union
    `ContentBlockType`). Map the wire text blocks to `{ type: 'text', text }`. For a proxy,
    restrict to text blocks (no tools/images) unless a block adapter is added.
  - `LlmRuntime.stream` is `abstract ... stream(options): AsyncIterable<StreamChunk>`; expose it
    through the remote, do not bypass adapter resolution.
  - Core-package change ⇒ read `docs/architecture.md`, update it and the `dsh-llm` README +
    JSDoc in the same change; add an Agent Note (non-trivial).

### B. Wire mount + client typing

- The `llm` remote namespace is already mounted in
  `packages/api/remotes/src/client/index.ts` (`import llmRemote from '@deepseek-ai/dsh-llm/remote'`
  + `export type {} from '@deepseek-ai/dsh-llm/remote'`). Adding `chat` to `LlmRuntime` regenerates
  `dsh-llm/lib/typert.remote-client.d.ts` (workspace typert generator), which flows the `chat`
  signature into `ctx.remote.llm.chat(...)`. Verify the generated client type exposes the stream.
- The existing `@deepseek-ai/dsh-llm` entry already has `./typert` / `./remote` exports — no
  `package.json` change needed unless a new wire subpath is added.

### C. Workbench — new client plugin `packages/client/ui-console/` (create, mirror ui-settings-plugins)

Follow `packages/client/AGENTS.md` "New plugin package checklist" (verified against the target):
- Skeleton: `package.json` (`@deepseek-ai/dsh-client-ui-console`, exports `.`/`./invariant`/`./client`
  + `./src/*` + `./package.json`, `dsh.client` manifest, `files`), `tsconfig.json`
  (extends `tsconfig.base.client.json`, references each dep + `runtime-diagnostics/invariants`),
  `tsdown.config.ts` (`clientBundle(id, ['lib/types/index.js','lib/types/invariant.js'])`),
  `src/index.ts` (empty node-half `apply(): void`), `src/invariant.ts` (real reason),
  `src/css-modules.d.ts`, README.md + README.zh.md + README.i18n.yaml.
- Three registration surfaces (all required): `tsconfig.client.json` aggregate reference; a
  `dsh.client` row in `packages/bundle/web-app/cordis.patch.yml`; a
  `packages/bundle/web-app/package.json` dependency.
- Source to port (read the source branch `feat/console-bridge-web-settings` → these live under
  the repo's `packages/client/ui-console/`): `ConsoleButton.tsx`, `SmartQA.tsx`,
  `consoleStore.ts`, `timelineText.ts`, `locales.ts`, `css-modules.d.ts`, `index.ts`,
  `invariant.ts`, `tsdown.config.ts`, README + tests.

### D. Workbench host services (the target equivalents to bind against)

Read `packages/client/AGENTS.md` and these seams before writing:
- Session list / status / current: `ctx.sessions` (`packages/api/session-controller/src/client/contract/sessions.ts`,
  `ctx.sessions.list` `ObservableSnapshot<SessionListState>` with `{ ids, byId, current, phase, ... }`;
  `SessionSummary` has `running`, `completed?`, `blank`, `updatedAt`, `displayTitle`).
- Subscribe to live events: `ctx.sessions.binding(id).eventSource` (`SessionEventWindow`) and
  `ctx.remote.$on('api-session/added'|'removed'|'status'|'activity'|'error', ...)` (remote-events).
- Pending `ask_user_question`: `ctx.uiSession.pendingInteractions`
  (`ReadonlyMap<SessionId, SessionPendingInteraction>`, standard hook `useSessionPendingInteraction`).
- Cumulative task stats: `sessionStats` projection
  (`SessionSummary.projectionValues.sessionStats` / `useProjection`).
- Sidebar footer action: `ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
  name:'sidebar.footer.action', id:'console', order:40, label:() => t('console'), locale:NS }, ConsoleSidebarButton))`.
- Fullscreen modal primitive: `Modal` from `@deepseek-ai/dsh-client-ui-primitives`.
- `SmartQA` consumes the `chat` remote: `ctx.remote.llm.chat(request)` →
  `AsyncIterable<StreamChunk>` (render the returned chunks into the panel).

### E. `host/metrics` client subscription (the status panel)

- The sampler emits `host/metrics` host-side, but it is NOT in the forward allowlist yet. To let
  the console status panel subscribe, add `host/metrics` to
  `packages/api/remotes/src/remote-events.ts` `API_REMOTE_FORWARDED_EVENTS` AND merge it into
  `TypertRemoteEventSelection` (declare
  `declare module '@deepseek-ai/dsh-typert-protocol' { interface TypertRemoteEventSelection extends Record<'host/metrics', true> {} }`
  in `packages/host/host-metrics/src/index.ts`), then add `@deepseek-ai/dsh-typert-protocol` to
  host-metrics deps. The client subscribes via `ctx.remote.$on('host/metrics', m => ...)`.

## Mapping points (source → target)

| Source (old apiproxy / ui-console) | Target equivalent |
| --- | --- |
| `LlmApi.providers/models/discoverModels` | already `LlmRuntime` `listProviders` / `listConfigurableProviders` / `discoverModels` |
| `LlmApi.chat` (SSE) | new `LlmRuntime` `@Remote({ mode:'stream' }) chat` yielding `StreamChunk` |
| `LlmChatMessage.role+content` | target `Message[]` via `createUserMessage`/`createAssistantMessage` + `GenerateOptions.messages`; `system` → `GenerateOptions.system` |
| `LlmChatChunk` | reuse target `StreamChunk` (or map to a reduced wire union) |
| api-proxy HTTP/SSE channels | Typert Remote RPC/stream over `/api/*` (no HTTP `/llm` route) |
| ui-console session views | `ctx.sessions` (list/binding/eventSource), `ctx.remote.$on('api-session/*')` |
| ask_user_question cards | `ctx.uiSession.pendingInteractions` + `useSessionPendingInteraction` |
| cumulative task stats | `sessionStats` projection |
| Console footer button | `sidebar.footer.action` slot |
| fullscreen modal | `Modal` from `dsh-client-ui-primitives` (or `shell.overlay` list) |
| SmartQA one-shot completions | `ctx.remote.llm.chat(request)` |

## Verification ladder for the follow-up

1. Core LLM `chat`: `pnpm run build:lib:host` (regenerates `dsh-llm/lib/typert.*`), a focused
   host unit test for the `chat` method (fake adapter via `ctx.llm`), `pnpm run verify-export-jsdoc`.
2. `pnpm exec vitest run packages/client/ui-console/tests` — port the 8 source workbench specs
   (they are the source's; adapt to target test-runtime + `bindSnapshotSelector`/`createSnapshotStore`
   harness as `section.client.spec.tsx` does). Client src is under the per-file 100% coverage gate —
   write tests for every new `.tsx`/`.ts`.
3. `pnpm run build:lib:client` (client aggregate typecheck) and `tsc -b tsconfig.client.json`.
4. `pnpm run test:gui` (client suites + host GUI packages).
5. `DSH_SNAPSHOT=replay pnpm run test:web` for any change to assembled browser/session output.
6. Gates: `verify-package-invariants`, `verify-package-dependencies`, `verify-package-paths`,
   `verify-export-jsdoc`, `verify-package-readme-model-experience`,
   `verify-package-readme-limitations`, `verify-translation-pairing`, `verify-md-links`,
   `verify-client-ui-i18n`, `verify-client-domain-graph` (note: the target currently has 3
   pre-existing `skeleton→input` domain violations unrelated to this work).
7. `verify-doc-refs` / `verify-doc-budgets` if docs touched (core `dsh-llm` change ⇒ yes).
8. Add an Agent Note with the PR (repo rule for non-trivial changes).

## New-session handoff prompt

Paste the following into a fresh opencode session rooted at
`C:\Users\25772\Desktop\AI\deepseek-harness` on branch `feature-agent`:
