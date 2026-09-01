# Agent Note: 控制台工作台落到目标 seam 上

Status: implemented

[English](2026-09-01-ui-console-workbench-seams.md) | 中文

## Problem

console-bridge 迁移需要一个浏览器工作台，而旧的 apiproxy 界面已不再支持它。源码 `ui-console` 消费的是 apiproxy mux 流与 HTTP/SSE `LlmApi.chat`，这两者在目标上都不存在：会话状态位于 `ctx.sessions`，主机事件走 Remote 转发允许清单，补全则通过 `LlmRuntime` 的 `chat` Remote。工作台必须按这些 seam 重写，否则新的 `chat` Remote 的唯一消费方就没有端到端消费方。

## Decision

`packages/client/ui-console` 是一个浏览器插件，贡献一个 `sidebar.footer.action` 槽位（`id: 'console'`，`order: 40`），打开全屏 `Modal`。所有值都来自文档化的目标 seam：

| 关注点 | Seam |
| --- | --- |
| 会话列表 / 状态 / 当前 | 基于 `ctx.sessions.list` 的 `useSessions` |
| 转发的会话活动 | `ctx.remote.$on('api-session/activity' \| 'status')` |
| 主机资源指标 | `ctx.remote.$on('host/metrics')` |
| 待处理的 `ask_user_question` / `plan-review` | 基于 `ctx.uiSession.pendingInteractions` 的 `useSessionPendingInteraction` |
| 累计任务统计 | `SessionSummary.projectionValues` 上的 `sessionStats` 投影 |
| 侧栏底部操作 | `ctx.slots.inject('sidebar.footer.action', …)` |
| 全屏遮罩 | `dsh-client-ui-primitives` 的 `Modal` |
| 智能问答补全 | `ctx.remote.llm.chat(request)` -> `AsyncIterable<LlmChatChunk>` |

store 由 `apply` 中转发来的 `api-session/*` 与 `host/metrics` 事件供给，并通过 register 的 `hooks` 命名空间暴露给组件（renderer 绑定出 `useConsole`），因此没有跨包值导入越过客户端打包纯度门。注册是标准的三面（`tsconfig.client.json`、web-app `cordis.patch.yml` 的 `dsh.client` 行、web-app 依赖），外加源码启动解析器需要的手写 `tsconfig.base.json` `paths` 别名。

## Alternatives considered

### 完整移植源码工作台，包括其对话框与内联回答卡片

已拒绝。源码对话框（带工作区/预设的新建会话、重命名/派生/归档右键菜单、内联编写器）调用的目标 API 无法干净映射（`api.sessions.prompt`、`api.agentPresets.*`、`api.workspace.*` 并非今日存在的 `ctx.sessions` 与 Remote 界面），而内联 `ask_user_question` 回答卡片需要具体的 `PendingQuestion` 呈现类，它位于 `ui-user-questions` —— 这是客户端打包纯度门禁止的跨功能运行期值导入。因此工作台做成了监控镜像：它标识哪些会话有待处理提问或计划审阅，但回答属于对话编辑器。

### 通过渲染出的 inject 值把 store 暴露给组件

已拒绝。在 `apply` 中手工构造选择器钩子需要 `bindSnapshotSelector`，它位于 `ui-renderer` 且不是被许可的跨包值导入（打包纯度门会拒绝）。合法路径是 register 的 `hooks` 命名空间，由 renderer 在绑定点绑定为 `use<Name>` 选择器钩子。

## Consequences

- 控制台是监控镜像，而非完整的对话界面：待处理交互只列出、不回答；时间线是对转发 `api-session/*` 事件的粗略标签，而非完整会话事件窗口。
- 在配置 `console-bridge.smartQaModel`（形如 `provider/model`）之前，智能问答保持禁用；没有客户端模型目录 Remote 可用来种子一个默认值。
- `ctx.remote.llm.chat` 由控制台的智能问答面板端到端覆盖（wire 形态见 `chat` Remote 的 Agent Note）。
