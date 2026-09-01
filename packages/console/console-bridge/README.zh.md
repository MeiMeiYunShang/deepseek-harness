# dsh-console-bridge

[English](README.md) | 中文

将 DeepSeek Harness 任务桥接到外部**智能体控制台**（agent console），基于
"DSH 接入控制台 · 接口契约"。插件从控制台接收 `down/cmd` 命令，将每条作为 DSH 会话运行，并回报
终态 `up/result`（以及 `up/cmd/ack` 进度）。控制台负责分发、状态机与结果存储；本插件只负责 DSH 执行与协议信封。

## 做什么

- **下行（控制台 → DSH）：** 订阅 `v1/agent/{agentId}/down/cmd`。每条命令先发送 `ARRIVED`，
  剥除 `local-dsh` / `ds-harness` 路由前缀，再发送 `EXECUTING`，然后以全新 DSH 会话运行该提示词。
- **上行（DSH → 控制台）：** 终态成功或失败时发布 `v1/agent/{agentId}/up/result`，字段为
  `{ taskId: 'task-{cmdId}', cmdId, exitCode, summary, logUri, durationMs }`。`summary` 是聚合的已提交
  `assistant/message` 文本，截断到 1024 字符。
- **心跳（在线保活）：** 订阅后立即发布 `v1/agent/{agentId}/up/status`，之后按
  `statusIntervalMs`（默认 5000，夹取到 1000..60000）周期发布
  `payload: { status: 'online', cpuPercent: 0, memPercent: 0 }`。控制面在丢失三次心跳后判定终端离线，
  因此该频率可保持在线。

退出码遵循契约：`0` 成功，`1` 失败（或空/bridge 错误），`124` 如实超时（agent 被取消，绝不掩盖）。
`logUri` 留空；`durationMs` 为墙钟时间。

## 传输

| `transport` | 机制 | 主题 / URL |
| --- | --- | --- |
| `mqtt`（默认） | MQTT 代理，QoS 1 — 完全符合契约 | `v1/agent/{id}/down/cmd` 入；`.../up/cmd/ack`、`.../up/result` 出 |
| `http` | 无代理时轮询控制台 REST 接口 | `POST {consoleBaseUrl}{topic}` 出；`GET {consoleBaseUrl}{topic}?after={n}` 入 |

**控制台地址**是 `brokerUrl`（MQTT）或 `consoleBaseUrl`（HTTP）；**`agentId`** 标识本终端；**`token`** 是控制台鉴权令牌，
在每个 HTTP 上行/下行请求中作为 `Authorization: Bearer <token>` 发送（MQTT 鉴权使用 `mqttUsername`/`mqttPassword`）。

MQTT 客户端为惰性加载，因此 `http` 路径与单元测试都不需要 `mqtt` 包。

## 配置

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

`down/cmd.execTimeoutS` 夹取到 `1..600`（默认 `10`）；`local-dsh`/`ds-harness` 超时是如实的 `124`。

## Settings 页面

连接字段（`agentId`、`transport`、`brokerUrl`、`consoleBaseUrl`、`mqttUsername`、
`mqttPassword`、`token`）在配置 UI 中作为 **console-bridge** namespace 暴露。cordis 插件 config 构成 `base` 层，
页面只在其上覆盖，因此只存储操作者真正编辑过的内容。`mqttPassword` 与 `token` 是 schema 声明的密钥：
settings 服务会从所有 wire 视图中脱敏它们；空字段不写任何内容（因此保存其它字段不会清空已存密钥）。
标识与传输变更采用 `applies: 'restart'` — 桥接只有在重启后才以新连接重新接入。

## 扩展点

本插件是薄协议适配器。用替换 `runDshTask`（`runner.ts`）来更换执行后端 — 它只需要 `ctx.agents` 与 `session/event` 流。
用实现 `ConsoleTransport`（`transport.ts`）来更换传输。

## 模型体验

### 控制台命令转发

#### 模型看到什么

模型提示词没有任何变化：控制台命令文本（减去 DSH 前缀）原样作为一条 `user` 消息入队。桥接不添加任何系统散文、工具或审批。

#### Token 影响

每条命令运行在全新会话中，因此没有跨命令的 token 或前缀复用。token 成本恰为底层 agent-loop 处理同一提示词所需。

#### KV Cache 影响

桥接不发起自己的 provider 请求，因此不产生 KV-cache 条目，也不复用模型的 turn 前缀。

## 已知限制与延后工作

- **`SUCCEEDED`/`FAILED` 不通过 `up/cmd/ack` 发送** — 它们是终态，由 `up/result` 触发，与契约一致；桥接只发送 `ARRIVED` 与 `EXECUTING`。
- **除重连外没有 MQTT broker 韧性** — 当前传输在断连后不回放未确认的 `down/cmd`；需要 at-least-once 的控制台应保留未确认命令。
- **单一控制台标识** — 一个插件实例一个 `agentId`；分发到多个控制台 agent 需要多个实例。
- **`http` 传输只是轮询替代** — 不具备契约的 QoS 语义，仅用于无 broker 的开发，不适合生产。
- **Web 控制台工作台为延后项** — `console-bridge` 后端插件、其 settings namespace 与 settings 卡片的 `testConnection` 探测均已落地；浏览器控制台工作台（会话状态面板、时间线、待答交互卡片）随客户端工作台迁移一并落地。
