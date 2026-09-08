---
description: "MCP security manager: permission scope and per-tool rules on MCP servers, a read-only/write execution gate, per-call usage scoring with alerts, and npm package search — over a loopback Connection RPC channel."
kind: "package-bundle"
---

# @deepseek-ai/dsh-mcpsec-manager

English | [中文](README.zh.md)

## Summary

`dsh-mcpsec-manager` secures MCP (`@deepseek-ai/dsh-mcp-client`) servers. It manages server loader rows (add / enable / remove), attaches a permission scope plus per-tool rules, gates every `mcp__<server>__*` tool call through the `tools/pre-execute` waterfall — a `read-only` scope denies write-classified tools before dispatch (unknown capability = write, fail closed) — and records per-call usage from `tools/result`, scoring each server over a 10-minute sliding window and raising alerts at a threshold. The browser half talks to it over a loopback-only Connection RPC channel `/mcpsec`; secret values never leave the host.

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

Mount `mcpsec-manager` beside the loader, tools, and a host connection RPC registry. It is a profile-bundle plugin (survives restarts) that registers the `/mcpsec` RPC channel; a browser surface drives `list`/`add`/`remove`/`setEnabled`/`setScope`/`stats`/`setThreshold`/`clearStats`/`npmSearch`. Tool classification is heuristic (read/write tokens; unknown = write) and override both by scope and by per-tool rules.

### What the source offers

The gate turns a write-capable call on a read-only/blocked server into a `{ kind: 'deny', reason }` pre-execute decision before dispatch; the stats observer scores each server and reports servers at or above the threshold. npm search queries the npm registry search API directly.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin registers a `tools/pre-execute` listener that parses the tool name (`mcp__server__tool`), resolves the server's policy from its loader `mcpSecurity` config, and denies under a rule/scope. `tools/result` observes every settled MCP call, recording failure/auth-error/credential-payload/byte/duration facts, and `computeStats` folds a sliding window into a per-server score (credential args, auth-error ratio, failure rate, blocked attempts, call spike, payload size, duration). Loader CRUD handlers validate input and call `ctx.loader.create/update/remove`. The RPC channel is registered over `ctx.connection.rpc.handle('/mcpsec', handler)`, loopback-only.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-tools](../../core/tools/README.md) — the `tools/pre-execute`/`tools/result` events and `PreToolDecision`.
- [dsh-mcp-client](../mcp-client/README.md) — the MCP server bridge whose loader rows this plugin manages.
- [dsh-client-connection](../../client/connection/README.md) — the loopback Connection RPC registry the channel rides.

-----

<a id="model-experience"></a>
## Model Experience

### Write-capable tool denial on a locked-down server

#### What the model sees

When a model asks an MCP tool that is denied by the security policy, the tool is blocked before dispatch and the request resolves to a `{ kind: 'deny', reason }` pre-execute decision; the model receives the denial rather than the tool's result, so it cannot act on a call the policy forbade. On an allowed call the model sees the normal tool result.

#### Token effect

The denial reply is a short status; the model pays the tool-call cost only for calls that actually dispatch. The plugin itself adds no prompt text.

#### KV Cache effect

None. The gate and stats observer never edit request tokens.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits are current package constraints.

- **Tool classification is heuristic** — read/write is token-matched per tool name; unknown capability is treated as write (fail closed), so a genuinely read-only tool an uncommon name may be denied on a read-only scope.
- **The alert scoring is a heuristic window** — score components (credential args, auth ratio, failure rate, spike, payload, duration) are configurable only by the single alert threshold; there is no per-server tuning.
- **The browser settings surface is not yet migrated to the current web-client conventions** — the host gate and RPC channel are in place, but the settings page and overlay toast are a follow-up.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

- `editServer` (the old implementation's single edit endpoint) is not yet ported; scope/rules are changed through `setScope` while server identity edits are deferred.

</details>
