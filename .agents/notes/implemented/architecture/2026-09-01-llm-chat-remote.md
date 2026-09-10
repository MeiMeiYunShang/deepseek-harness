# Agent Note: LlmRuntime streaming `chat` Remote for one-shot completions

Status: implemented

English | [中文](2026-09-01-llm-chat-remote.zh.md)

## Problem

The console workbench's Smart Q&A panel needs a one-shot streaming completion on the web client. The host waterfall `LlmRuntime.stream(options)` already services every provider call, but it is not reachable over Typert Remote: the `llm` namespace exposes only `listProviders`, `listConfigurableProviders`, and `discoverModels`. The old apiproxy HTTP/SSE `LlmApi.chat` route (provider/model/messages to SSE chunks) is the one missing surface the new panel consumes, and it must land with the panel so the consumer can be verified end to end.

## Decision

`LlmRuntime` gains one `@Remote({ mode: 'stream' })` method named `chat`:

```ts ignore-check
@Remote({ mode: 'stream' })
async * chat(request: LlmChatRequest, signal: AbortSignal): AsyncIterable<LlmChatChunk>
```

`chat` maps the wire `LlmChatRequest` into a `GenerateOptions` and delegates to `LlmRuntime.stream`, so adapter resolution, the `llm/stream` waterfall, call-config validation, and replay handling all still apply. Mapping:

- role `user` to `createUserMessage({ content, source: { kind: 'user' } })`
- role `assistant` to `createAssistantMessage({ content, source: { provider, model } })`, its provenance naming the request's provider/model
- role `system` to `GenerateOptions.system`; the request's own `system` field wins
- the controls (`temperature`, `maxTokens`, `stop`, `reasoningEffort`) and the carrier's `signal` pass through unchanged

The wire result is the reduced `LlmChatChunk` union — `text-delta`, `reasoning-delta`, `usage`, and the terminal `finish` — produced by projecting `StreamChunk` at the boundary (`block-start`/`block-end`/`tool-call-delta` are dropped; a merge-extensible adapter finish reason degrades to a terminal `error`). This is the JSON-safe subset the generator can serialize.

## Alternatives considered

### Reuse the public `StreamChunk` directly

Discarded. `StreamChunk` embeds `ContentBlock` and `FinishReason`, both merge-extensible (`ContentBlockMap`/`FinishReasonMap` augmented by plugins). The Typert generator rejects a Remote boundary containing unconstrained unknown data, so shipping `AsyncIterable<StreamChunk>` fails `build:lib:host`. The reduced union is the generator-legal projection; the panel renders text deltas and the terminal finish only.

### Add a block adapter translating `ContentBlock` to the wire

Discarded. The only consumer sends text blocks, and a faithful `ContentBlock`-to-wire mapping would keep the generator blocked on the same merge-extensible types unless it also defined a second vocabulary — the reduced union already is that vocabulary, with no unused adapter surface.

## Consequences

- The web client can stream a completion via `ctx.remote.llm.chat(request)` without importing the merge-extensible ContentBlock vocabulary.
- A provider-specific finish reason the core does not know surfaces as a terminal `error` with code `UNKNOWN` and the reason in the message text.
- `block-start`/`block-end`/`tool-call-delta` and image/reasoning blocks are not representable over the wire; the console panel is deliberately text-only.
