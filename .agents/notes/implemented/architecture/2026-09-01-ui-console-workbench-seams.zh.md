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
| 首次打开时的时间线回填 | `apply` 中对 `ctx.sessions.list.getSnapshot()` 的一次性读取 |
| 选中会话的对话 | `apply` 中由 `deriveTimelineMessages` 折叠的 `SessionBinding.eventSource` |
| 主机资源指标 | `ctx.remote.$on('host/metrics')` |
| 待处理的 `ask_user_question` / `plan-review` | 基于 `ctx.uiSession.pendingInteractions` 的 `useSessionPendingInteraction` |
| 累计任务统计 | `SessionSummary.projectionValues` 上的 `sessionStats` 投影 |
| 模型费用 | 按 `console-pricing` 设置表计价的 `sessionStats.routes`（逐路由 token） |
| 侧栏底部操作 | `ctx.slots.inject('sidebar.footer.action', …)` |
| 全屏遮罩 | `dsh-client-ui-primitives` 的 `Modal` |
| 智能问答补全 | `ctx.remote.llm.chat(request)` -> `AsyncIterable<LlmChatChunk>` |

store 由 `apply` 中转发来的 `api-session/*` 与 `host/metrics` 事件供给 —— 三个订阅在页面存续期内无条件安装 —— 并在工作台首次于空时间线上打开时，从 `ctx.sessions.list` 一次性回填。同一个闭包还持有控制台作用域的订阅：每次 `selectedSession` 变化时，它先释放上一个会话的 feed，再解析 `ctx.sessions.binding(sessionId).eventSource`，并发布 `deriveTimelineMessages` 从该窗口折叠出的消息，因此卡片自身不新增任何订阅机制。它通过 register 的 `hooks` 命名空间暴露给组件（renderer 绑定出 `useConsole`、`usePrices` 与 `useMessages`），因此没有跨包值导入越过客户端打包纯度门。注册是标准的三面（`tsconfig.client.json`、web-app `cordis.patch.yml` 的 `dsh.client` 行、web-app 依赖），外加源码启动解析器需要的手写 `tsconfig.base.json` `paths` 别名。

## Alternatives considered

### 完整移植源码工作台，包括其对话框与内联回答卡片

已拒绝。源码对话框（带工作区/预设的新建会话、重命名/派生/归档右键菜单、内联编写器）调用的目标 API 无法干净映射（`api.sessions.prompt`、`api.agentPresets.*`、`api.workspace.*` 并非今日存在的 `ctx.sessions` 与 Remote 界面），而内联 `ask_user_question` 回答卡片需要具体的 `PendingQuestion` 呈现类，它位于 `ui-user-questions` —— 这是客户端打包纯度门禁止的跨功能运行期值导入。因此工作台做成了监控镜像：它标识哪些会话有待处理提问或计划审阅，但回答属于对话编辑器。

### 通过渲染出的 inject 值把 store 暴露给组件

已拒绝。在 `apply` 中手工构造选择器钩子需要 `bindSnapshotSelector`，它位于 `ui-renderer` 且不是被许可的跨包值导入（打包纯度门会拒绝）。合法路径是 register 的 `hooks` 命名空间，由 renderer 在绑定点绑定为 `use<Name>` 选择器钩子。

### 把扁平 token 总量按会话当前模型计价

否决。一次会话可能中途换模型，而 `sessionStats` 每会话只报一个扁平 token 总量；按会话当下的模型给这个总量计价，会为每一步由其他路由服务的 token 多收或少收。因此投影折叠 `request/header`——它在步骤内记录，且只在头部变化时记录，所以折叠把路由向前携带——并按 `(provider, model)` 给 `assistant/message` 的用量分桶。

### 把未定价的路由显示为 0

否决。运营者配置的 `console-pricing` 表是唯一价格来源，表里没有的路由意味着费用未知，而不是免费；`totalCost` 把这类路由单独返回，卡片渲染「未定价」而不是数字。被表标价为零的路由仍然显示 0，因为那是一条已记录的事实。

## Consequences

- 费用在两种作用域下都渲染，且限定作用域时是精确值：`aggregateSessionStats` 会跳过作用域之外的每个会话，只累加该会话自己的 `sessionStats.routes` 桶，因此总额计的是这次对话自身的费用，而不是共享价格表中的份额。
- 一个会话方格一次手势只做一件事，工作台也只保留一个作用域。左键点击设置选中会话，这一个值同时驱动任务统计的作用域行与费用、时间线列出的行、以及指令输入框的目标；会话卡标题栏的「全部会话」pill 一次点击就把这三者都恢复到整个列表，而时间线通过在标题旁标出该会话来表明自己已被限定，不再自带第二个清除控件。右键菜单承载作用于该会话的动作：打开会切换应用当前会话，重命名、Fork、归档则修改它。打开是菜单项而不是点击，因为工作台是全屏的：一次切换应用会话的点击在面板关闭前没有任何可见效果。

- 控制台不是完整的对话界面 —— 待处理交互只列出、不回答 —— 它的唯一作用域驱动两种时间线视图。未限定范围时保留粗略镜像：转发的 `api-session/*` 行，加上首次打开时列表已持有的每个会话一行回填的 `history`。限定到某个会话时则渲染该会话自身的对话，由 `apply` 从该会话的事件窗口折叠而来，而该窗口由 Session Controller 填入部分尾部以及它已取回的更早分页；卡片只渲染窗口持有的内容，从不抓取。
- 在配置 `console-bridge.smartQaModel`（形如 `provider/model`）之前，智能问答保持禁用；没有客户端模型目录 Remote 可用来种子一个默认值。
- `ctx.remote.llm.chat` 由控制台的智能问答面板端到端覆盖（wire 形态见 `chat` Remote 的 Agent Note）。
