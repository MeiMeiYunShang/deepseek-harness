# dsh-console-bridge

English | [中文](README.zh.md)

Bridge DeepSeek Harness tasks to an external **智能体控制台** (agent console) over the
"DSH 接入控制台 · 接口契约" (the console contract document supplied alongside this work). The plugin
accepts `down/cmd` commands from the console, runs each as a DSH session, and reports a
terminal `up/result` (plus `up/cmd/ack` progress) back. The console owns dispatch, status
machine, and result storage; this plugin owns only DSH execution and the protocol envelope.

## What it does

- **Downlink (console → DSH):** subscribes to `v1/agent/{agentId}/down/cmd`. On each command it
  sends `ARRIVED`, strips the `local-dsh` / `ds-harness` routing prefix, sends `EXECUTING`, then
  runs the prompt as a fresh DSH session.
- **Uplink (DSH → console):** on terminal success or failure publishes
  `v1/agent/{agentId}/up/result` with `{ taskId: 'task-{cmdId}', cmdId, exitCode, summary, logUri, durationMs }`.
  `summary` is the aggregated committed `assistant/message` text, truncated to 1024 chars.
- **Heartbeat (online presence):** after subscribing, publishes `v1/agent/{agentId}/up/status`
  immediately and then every `statusIntervalMs` (default 5000, clamped 1000..60000) with
  `payload: { status: 'online', cpuPercent: 0, memPercent: 0 }`. The control plane marks a
  terminal offline after three missed heartbeats, so this cadence keeps the agent online.

Exit codes follow the contract: `0` success, `1` failure (or empty/bridge error), `124` honest
timeout (the agent is cancelled, never masked). `logUri` is left empty; `durationMs` is wall-clock.

## Transport

| `transport` | Mechanism | Topic / URL |
| --- | --- | --- |
| `mqtt` (default) | MQTT broker, QoS 1 — exactly the contract | `v1/agent/{id}/down/cmd` in; `.../up/cmd/ack`, `.../up/result` out |
| `http` | Poll a console REST surface when no broker exists | `POST {consoleBaseUrl}{topic}` out; `GET {consoleBaseUrl}{topic}?after={n}` in |

The **console address** is `brokerUrl` (MQTT) or `consoleBaseUrl` (HTTP); **`agentId`** identifies
this terminal to the console; **`token`** is the console auth token, sent as
`Authorization: Bearer <token>` on every HTTP uplink and downlink request (MQTT auth uses
`mqttUsername`/`mqttPassword`).

The MQTT client is loaded lazily, so the `http` path and the unit tests never require the
`mqtt` package.

## Configuration

```yaml
plugins:
  console-bridge:
    agentId: local-dsh-native-01   # this terminal's identity reported to the console
    transport: mqtt                # mqtt | http
    brokerUrl: mqtt://127.0.0.1:1883   # console address (mqtt broker)
    mqttUsername: ''
    mqttPassword: ''           # MQTT broker password; stored as a secret (never echoed to the UI)
    # http transport:
    consoleBaseUrl: http://controlplane:8080   # console address (REST base URL)
    token: ''                      # console auth token; sent as `Authorization: Bearer <token>`
    pollIntervalMs: 2000
    statusIntervalMs: 5000        # heartbeat period for the online `up/status` presence signal
    # DSH task execution:
    provider: ''
    model: ''
    cwd: ''
    execTimeoutS: 10               # default; down/cmd overrides (clamped 1..600)
    autoStart: true
```

`down/cmd.execTimeoutS` is clamped to `1..600` (default `10`); `local-dsh`/`ds-harness` timeouts
are honest `124`s.

## Settings page

The connection fields (`agentId`, `transport`, `brokerUrl`, `consoleBaseUrl`, `mqttUsername`,
`mqttPassword`, `token`) are exposed as a **console-bridge** namespace in the configuration UI.
The cordis plugin config forms the `base` layer that the page overrides, so the page only stores what an
operator edits. `mqttPassword` and `token` are schema-declared secrets: the settings service redacts
them from every wire view, a blank field writes nothing (so saving other fields never wipes a stored
secret). Identity and transport changes `applies: 'restart'` — the bridge reconnects with the new
connection only after a restart.

## Extension points

The plugin is a thin protocol adapter. Swap the execution backend by replacing `runDshTask`
(`runner.ts`) — it only needs `ctx.agents` and the `session/event` feed. Swap the transport by
implementing `ConsoleTransport` (`transport.ts`).

## Model Experience

### Console command relay

#### What the model sees

Nothing changes in the model's prompt: the console command text (minus its DSH prefix) is queued verbatim as a `user` message. The bridge adds no system prose, tools, or approvals of its own.

#### Token effect

Each command runs in its own fresh session, so there is no cross-command token or prefix reuse. Token cost is exactly what the underlying agent-loop would spend on the same prompt.

#### KV Cache effect

The bridge adds no provider request of its own, so it creates no KV-cache entries and nothing reuses the model's turn prefix.

## Known Limitations and Deferred Work

- **`SUCCEEDED`/`FAILED` are not sent via `up/cmd/ack`** — they are terminal states triggered by
  `up/result`, matching the contract; the bridge sends only `ARRIVED` and `EXECUTING` acks.
- **No MQTT broker resilience beyond reconnect** — the current transport does not replay
  unacknowledged `down/cmd` after a disconnect; a console that needs at-least-once should retain
  unconfirmed commands.
- **Single console identity** — one `agentId` per plugin instance; fan-out to multiple console
  agents requires multiple instances.
- **`http` transport is a polling stand-in** — it does not carry the contract's QoS semantics and
  is meant for broker-less development, not production.
- **The Web console workbench is deferred** — the `console-bridge` backend plugin, its settings
  namespace, and the settings card's `testConnection` probe are landed; the browser console workbench
  (session status panel, timeline, pending-interaction cards) ships with the client workbench migration.
