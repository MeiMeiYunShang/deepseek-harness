---
description: "The console workbench for maintainers: a sidebar footer action that opens a fullscreen monitoring modal (session status, task stats, host metrics, activity timeline, and Smart Q&A)."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-console

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-client-ui-console` is the browser console workbench of the dsh web GUI. It contributes one sidebar footer action that opens a fullscreen monitoring modal: session status and cumulative task statistics come from the standard `ctx.sessions` feed and the `sessionStats` projection; pending `ask_user_question` interactions come from `ctx.uiSession.pendingInteractions`; host resource metrics come from the forwarded `host/metrics` event; the activity timeline comes from the forwarded `api-session/*` events; and the Smart Q&A panel streams one-shot completions over `ctx.remote.llm.chat`.

## Known Limitations and Deferred Work

- **Smart Q&A requires a configured model** — the panel reads the model override from the `console-bridge` settings namespace (`smartQaModel`, `provider/model`). With no override it stays disabled; there is no client-side model catalog remote to fall back to.
- **The timeline is a coarse mirror** — it renders forwarded `api-session/activity` and `api-session/status` events as labels, not the full session event stream. Session-scoped event-window detail is intentionally left to the conversation surface.
- **Pending interactions are a monitoring view** — the console names which sessions hold a pending question or plan review but does not answer them inline; answering belongs to the conversation composer.
