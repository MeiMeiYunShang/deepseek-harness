---
description: "后端协议适配器：接收智能体控制台命令，将每条作为 DSH 会话运行，并通过 MQTT 或 HTTP 向控制台回报终态结果与心跳。"
kind: "package-reference"
---

# dsh-console-bridge

[English](README.md) | 中文

## 概述

将 DeepSeek Harness 任务桥接到外部**智能体控制台**（agent console），基于 "DSH 接入控制台 · 接口契约"。插件从控制台接收 `down/cmd` 命令，将每条作为 DSH 会话运行，并回报终态 `up/result`（以及 `up/cmd/ack` 进度）。控制台负责分发、状态机与结果存储；本插件只负责 DSH 执行与协议信封。

## 目录

- [功能](#what-it-does)
- [传输](#transport)
- [配置](#configuration)
- [Settings 页面](#settings-page)
- [扩展点](#extension-points)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

-----

<a id="what-it-does"></a>
## 功能

- **下行（控制台 → DSH）：** 订阅 `v1/agent/{agentId}/down/cmd`。每条命令先发送 `ARRIVED`，剥除 `local-dsh` / `ds-harness` 路由前缀，再发送 `EXECUTING`，然后以全新 DSH 会话运行该提示词。
- **上行（DSH → 控制台）：** 终态成功或失败时发布 `v1/agent/{agentId}/up/result`，字段为 `{ taskId: 'task-{cmdId}', cmdId, exitCode, summary, logUri, durationMs }`。`summary` 是聚合的已提交 `assistant/message` 文本，截断到 1024 字符。
- **心跳（在线保活）：** 订阅后立即发布 `v1/agent/{agentId}/up/status`，之后按 `statusIntervalMs`（默认 5000，夹取到 1000..60000）周期发布 `payload: { status: 'online', cpuPercent: 0, memPercent: 0 }`。控制面在丢失三次心跳后判定终端离线，因此该频率可保持在线。

退出码遵循契约：`0` 成功，`1` 失败（或空/bridge 错误），`124` 如实超时（agent 被取消，绝不掩盖）。`logUri` 留空；`durationMs` 为墙钟时间。

-----

<a id="transport"></a>
## 传输

| `transport` | 机制 | 主题 / URL |
| --- | --- | --- |
| `mqtt`（默认） | MQTT 代理，QoS 1 — 完全符合契约 | `v1/agent/{id}/down/cmd` 入；`.../up/cmd/ack`、`.../up/result` 出 |
| `http` | 无代理时轮询控制台 REST 接口 | `POST {consoleBaseUrl}{topic}` 出；`GET {consoleBaseUrl}{topic}?after={n}` 入 |

**控制台地址**是 `brokerUrl`（MQTT）或 `consoleBaseUrl`（HTTP）；**`agentId`** 标识本终端；**`token`** 是控制台鉴权令牌，在每个 HTTP 上行/下行请求中作为 `Authorization: Bearer <token>` 发送（MQTT 鉴权使用 `mqttUsername`/`mqttPassword`）。

MQTT 客户端为惰性加载，因此 `http` 路径与单元测试都不需要 `mqtt` 包。

-----

<a id="configuration"></a>
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

-----

<a id="settings-page"></a>
## Settings 页面

本插件拥有两个 settings namespace，而注册 namespace 正是让插件页为其渲染卡片的前提。卡片本身由客户端包提供；本插件提供每张卡片所绑定的 Host 半边。

**`console-bridge`** — 连接字段（`agentId`、`transport`、`brokerUrl`、`consoleBaseUrl`、`mqttUsername`、`mqttPassword`、`token`）在配置 UI 中作为 **console-bridge** namespace 暴露。cordis 插件 config 构成 `base` 层，页面只在其上覆盖，因此只存储操作者真正编辑过的内容。`mqttPassword` 与 `token` 是 schema 声明的密钥：settings 服务会从所有 wire 视图中脱敏它们；空字段不写任何内容（因此保存其它字段不会清空已存密钥）。标识与传输变更采用 `applies: 'restart'` — 桥接只有在重启后才以新连接重新接入。

**`console-pricing`** — 操作者的价格表，每个 `(baseUrl, provider, model)` 路由一行，另加每天把会话 token 拆分为价格时段的低谷窗口。每一行带 `peak` 与 `offPeak` 两组、每组三个以每百万 token 的货币单位计价的价格：`cacheHit` 用于缓存读取的输入，`cacheMiss` 用于未缓存的输入，`output` 用于输出。缓存写入没有自己的价格 —— 按 `cacheMiss` 计费。组合配置不提供任何价格（它们是操作者数据，而非连接配置），因此该 namespace 不声明 `base` 层，已存储的 settings 文档是它唯一的来源。每一行都必须写明三个标识字段与全部六个价格，且价格必须有限且非负；`models` 键缺失与空数组都表示"未记录价格"，均为合法。已存储的价格表若不合规会被响亮拒绝而非静默修补 —— schemastery 无法表达"有限"，因此注册时附加了 owner 检查，并指明被拒绝的行、时段与价格。价格修改即时生效。

```yaml
console-pricing:
  models:
    - baseUrl: https://api.deepseek.com
      provider: deepseek-official
      model: deepseek-v4-flash
      peak:
        cacheHit: 0.1
        cacheMiss: 0.5
        output: 1.5
      offPeak:
        cacheHit: 0.05
        cacheMiss: 0.25
        output: 0.75
  offPeak:
    # Quote both times: YAML reads an unquoted 22:30 as the number 1350.
    start: "22:30"
    end: "06:15"
    timezone: Asia/Kolkata
```

`offPeak` 可选，缺失表示每个小时都按高峰价计费。该窗口是 `[start, end)`，取某个 IANA `timezone` 的**本地墙钟**时间；当 `end` 不晚于 `start` 时窗口跨过午夜（因此 `22:30`–`06:15` 一条即可覆盖整夜）。两个时间都必须是 24 小时制的 `HH:MM`，时区必须是运行时 `Intl` 能解析的时区；任一违规都拒绝该写入（也拒绝加载手工编辑过的文档），并指明被拒绝的值 —— 因为计费读不出的窗口会把每个 token 都静默地按高峰价计费。会话 token 记账读取该窗口，并在折叠时依据上报 token 的那个事件决定每个请求的时段，绝不在展示时依据当时的时钟。

-----

<a id="extension-points"></a>
## 扩展点

本插件是薄协议适配器。用替换 `runDshTask`（`runner.ts`）来更换执行后端 — 它只需要 `ctx.agents` 与 `session/event` 流。用实现 `ConsoleTransport`（`transport.ts`）来更换传输。

-----

<a id="model-experience"></a>
## 模型体验

### 控制台命令转发

#### 模型看到什么

模型提示词没有任何变化：控制台命令文本（减去 DSH 前缀）原样作为一条 `user` 消息入队。桥接不添加任何系统散文、工具或审批。

#### Token 影响

每条命令运行在全新会话中，因此没有跨命令的 token 或前缀复用。token 成本恰为底层 agent-loop 处理同一提示词所需。

#### KV Cache 影响

桥接不发起自己的 provider 请求，因此不产生 KV-cache 条目，也不复用模型的 turn 前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **`SUCCEEDED`/`FAILED` 不通过 `up/cmd/ack` 发送** — 它们是终态，由 `up/result` 触发，与契约一致；桥接只发送 `ARRIVED` 与 `EXECUTING`。
- **除重连外没有 MQTT broker 韧性** — 当前传输在断连后不回放未确认的 `down/cmd`；需要 at-least-once 的控制台应保留未确认命令。
- **单一控制台标识** — 一个插件实例一个 `agentId`；分发到多个控制台 agent 需要多个实例。
- **`http` 传输只是轮询替代** — 不具备契约的 QoS 语义，仅用于无 broker 的开发，不适合生产。
- **Web 控制台工作台为延后项** — `console-bridge` 后端插件、其 settings namespace 与 settings 卡片的 `testConnection` 探测均已落地；浏览器控制台工作台（会话状态面板、时间线、待答交互卡片）随客户端工作台迁移一并落地。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 —— 点击展开</summary>

无。

</details>
