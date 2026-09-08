---
description: "Consumer-side knowledge tools and system-prompt injection: the model-facing knowledge_search and save_knowledge tools, a token-budgeted knowledge context section, and optional auto-summarization on session disposal or archive."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-knowledge

English | [中文](README.zh.md)

## Summary

`dsh-tool-knowledge` is the model-facing Knowledge consumer. It registers two tools on `ctx.tools` — `knowledge_search` (query the knowledge base) and `save_knowledge` (record reusable experience) — injects a token-budgeted knowledge summary into the system prompt, and optionally auto-summarizes a session into new entries when it is disposed or archived.

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

Mount `tool-knowledge` beside the knowledge store. The `knowledge_search` tool takes a `query` plus optional `category`/`groupId`/`tags`/`limit`; `save_knowledge` takes `title`, `content`, `category`, optional `tags`/`groupId`, and links the entry to the originating session when one exists. `Config` enables `autoSummarize` (default true), `maxSummaryEntries` (5), `promptBudgetTokens` (500), `defaultGroupIds` (empty = most recent entries), and `summarizeModel` (empty = reuse the session's last request model).

### What the source offers

The system prompt gains a `<knowledge_context>` section (registered under the `TOOL_KNOWLEDGE` section order) listing up to the token budget of entry metadata. Auto-summarize extracts up to `maxSummaryEntries` reusable entries from a disposed/archived session via an LLM call, deduplicating a session that fires both archive and disposal.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The tools call `ctx.knowledge.listEntries` and `saveEntry` directly. The prompt section builds a line-per-entry metadata summary under a rough character budget (`promptBudgetTokens * 4`), from either the configured default groups or the 20 most recent entries. Auto-summarize rebuilds the prompt in Chinese, asks the model for a JSON array of `{ title, content, category, tags }`, and parses the first JSON array in the response; a malformed response yields nothing. The summarization LLM call is a fire-and-forget side effect: failures and silent no-content sessions are logged, never surfaced.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [knowledge](../knowledge/README.md) — the store the tools read and write.
- [knowledge-file](../knowledge-file/README.md) — the persistence provider making saved entries durable.
- [system-prompt](../../core/system-prompt/README.md) — the section-order owner this consumer registers into.

-----

<a id="model-experience"></a>
## Model Experience

### knowledge_search and save_knowledge

#### What the model sees

The system prompt adds a `<knowledge_context>` listing up to the configured token budget of entry metadata (grouped or most recent), with an instruction to call `knowledge_search` for full content before acting. `knowledge_search` returns matching entries (title, content, category, tags) and a total; `save_knowledge` returns the created id and title. The injected context is a fixed summary of knowledge-entry metadata, not the full corpus.

#### Token effect

The prompt section adds up to `promptBudgetTokens` tokens per response build. `knowledge_search` adds its returned entries as tool results; `save_knowledge` adds its small confirmation. Auto-summarize consumes tokens for one summarization call per disposed/archived session.

#### KV Cache effect

Append-only: the injected knowledge section follows the reusable history prefix; this package never edits earlier request tokens.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits are current package constraints.

- **The summary uses a rough character budget** — the `promptBudgetTokens * 4` heuristic estimates tokens, not the model's real tokenizer.
- **Auto-summarize failure is silent** — a failed or empty-summary LLM call logs and returns; there is no retry or user-facing recovery.
- **The summarization assistant call is not yet session-logged** — see the web surface migration Agent Note; the model-visible summarization request needs a `request/header` and assistant-chunk session events (deferred to a follow-up).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
