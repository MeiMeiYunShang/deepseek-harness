---
description: "Package map for the agent console integration: the command bridge that runs console-directed tasks as DSH sessions and reports results back."
kind: "package-group"
---

# console/ — agent console integration

English | [中文](README.zh.md)

## Summary

The `console/` group bridges DeepSeek Harness to an external agent console over the DSH console contract. The bridge accepts `down/cmd` commands from the console, runs each as a DSH session, and reports `up/cmd/ack` plus the terminal `up/result` back to the console. The browser-side workbench lives in [`packages/client/ui-console`](../client/ui-console/README.md), and the composed application is booted through [`apps/cli`](../../apps/cli/README.md).

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [`console-bridge/`](console-bridge/README.md) | Accept `down/cmd` commands, run each as a DSH session, and report `up/cmd/ack` + terminal `up/result` back to the console. |

-----

<a id="related-documentation"></a>
## Related documentation

- [Console bridge package](console-bridge/README.md) — the backend protocol adapter that runs console commands as DSH sessions.
- [Host metrics subsystem](../../docs/subsystems/host-metrics.md) — telemetry surfaced by the console workbench.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
