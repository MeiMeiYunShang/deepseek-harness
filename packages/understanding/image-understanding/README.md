---
description: "Image-to-text translation for text-only models: a pluggable recognition backend (free Zhipu vision API, local Ollama, Windows system OCR) rewrites image blocks to bounded text at agent/pre-step, with passthrough for native vision routes and failure restoration."
kind: "package-reference"
---

# @deepseek-ai/dsh-image-understanding

English | [中文](README.zh.md)

## Summary

`dsh-image-understanding` lets a text-only model act on an admitted prompt that carries images. At `agent/pre-step` it checks whether the agent's composition route is image-capable; for a text-only route it runs each image through a chosen recognition backend and replaces the image block with bounded recognized text. A native vision route passes through untouched. When recognition fails, the plugin restores every claimed message to the `next-turn` inbox and appends a durable `user/image-understanding-failed` notification, so the prompt stays pending for the user rather than silently degrading.

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

Mount `image-understanding` beside the knowledge image path and the `llm` service. Configure a `backend` (`zhipu` | `ollama` | `windows`), `maxTextChars`, `timeoutMs`, and backend-specific `zhipu`/`ollama` settings. The backend defaults by platform: Windows to the keyless system OCR, other hosts to local Ollama.

### What the source offers

The plugin provides the `ctx.imageToText` seam (an `ImageToText` implementation) and registers the `agent/pre-step` hook. A per-call `prompt` from the message's own text becomes the vision instruction for the backend's API variants; a blank instruction uses the configured default. Results are bounded by `maxTextChars`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package owns the `ImageToText` Service Definition role (declared in `dsh-attachment`): `describe(ref, signal, prompt)` returns bounded text for one durable image. Backends live in `backends.ts` — a Zhipu OpenAI-compatible chat-completions call, an Ollama `/api/chat`, and a PowerShell `Windows.Media.Ocr` driver (whose input is PNG-normalized via `sharp`). `resolveConfig` is the one explicit resolve step: platform-defaulted backend selection plus a fail-loud check that rejects `windows` on a non-Windows host. `ImageUnderstandingService` caches by content-address + prompt and classifies timeout / attachment-read / transport failures into stable codes.

### Registration

`apply` registers the service seam and the `agent/pre-step` hook. The hook resolves the composition route via `agent.options.provider/model` and `ctx.llm.resolveModelInfo(...).inputModalities`; a route that includes `image` is passed to `next()`. Otherwise the hook translates images and, on any failure, re-queues and emits the durable failure event.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-attachment](../../attachment/attachment/README.md) — the durable image store and the `ImageToText` seam.
- [dsh-llm](../../llm/llm/README.md) — `contentHasImage`, `resolveModelInfo`, and the text-only image projection fallback.
- [dsh-session](../../core/session/README.md) — the `user/image-understanding-failed` and `knowledge/summary-llm-request` log events.

-----

<a id="model-experience"></a>
## Model Experience

### Image prompts projected to text for a text-only route

#### What the model sees

For a text-only route, each image block is replaced by a bounded `[图片N 识别内容]\n<text>` text block, where the text comes from `ctx.imageToText.describe(...)`. The message's own user text (e.g. "what is inside the red box?") becomes the vision instruction for the API backends, so the vision model answers the user's question rather than running a fixed OCR instruction. For an image-capable route the plugin is a no-op: `next()` is called and the model receives the image unchanged.

#### Token effect

The recognized text is appended to the user content at the request's cost; the image bytes themselves are not sent for a text-only route. The configured `maxTextChars` bounds each replacement.

#### KV Cache effect

The recognized text is a replacement inside the prompt, so it is part of the request tokens; this plugin never edits earlier history.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits are current package constraints.

- **The backends need a reachable Zhipu/Ollama endpoint or a Windows OCR engine** — the free vision API and the local Ollama service are out of the harness's control; when unavailable the plugin degrades to the failure-restore path.
- **The Windows OCR engine is untested on a non-Windows lane** — its spawn driver is validated by a mocked child process; the real engine's language availability depends on the user profile.
- **The route check reads the agent composition, not a per-turn model selection** — a per-turn override that differs from `agent.options` cannot be read at this boundary; an unresolvable or ambiguous route is translated conservatively (the built-in text-only projection covers the residual case).
- **The settings card is deferred** — the old host settings namespace (`installSettingsSection`) does not exist in the current repo, so backend/limits are configured via cordis.yml, not a Web Settings section.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
