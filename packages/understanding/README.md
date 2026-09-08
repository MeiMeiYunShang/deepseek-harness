---
description: "The understanding capability family: image-to-text translation for text-only models, so a model without vision can still act on an admitted image prompt."
kind: "package-group"
---

# understanding/ — understanding capability family

English | [中文](README.zh.md)

## Summary

The understanding group bridges admitted images into text for text-only models. `image-understanding` provides the `ctx.imageToText` seam and translates image blocks at `agent/pre-step` through a pluggable recognition backend (free Zhipu vision API, local Ollama, Windows system OCR), trusting an image-capable route to receive images unchanged and restoring the prompt on failure. It depends on the durable image store (`dsh-attachment`) and the model-catalog response (`dsh-llm`).

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`image-understanding`](image-understanding/README.md) | Image-to-text translation for text-only routes; registers the `agent/pre-step` translation hook | provides `ctx.imageToText` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Attachment subsystem](../../docs/subsystems/attachment.md) — the durable normalized image store the seam reads.
- [Web client architecture](../../docs/subsystems/web-client.md) — the text-only image projection the model-facing path builds on.

<a id="dev-note"></a>
## Dev Note

None.
