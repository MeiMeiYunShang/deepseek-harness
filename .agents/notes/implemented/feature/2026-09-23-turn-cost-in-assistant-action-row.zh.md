# Agent Note: 助手操作行中的逐轮费用

Status: implemented

[English](2026-09-23-turn-cost-in-assistant-action-row.md) | 中文

## Problem

助手的操作行此前只显示某一轮的 token 数（`用量 16.2K tok`）与墙钟时间（`用时 1秒`），不显示这一轮花了多少钱，而控制台卡片给整个会话计价。费用等于把运营者的 `console-pricing` 价格表应用到提供方上报的 token 上，而这两半按轮都无法拿到：

- 唯一按时段拆分的路由桶是 `sessionStats.routes`，它是整个会话口径的。用它给某一轮计价，会把别的轮次花掉的 token 算到这一轮头上。
- 这一轮自己的记账 —— `dsh-token-meter` 的 `deriveTurnTokenUsage`，也就是用量胶囊的数据来源 —— 带有该轮的四项 token 计数，并在每次尝试都可归属时带有 `(provider, model)` 路由。它不带价格时段。
- 时段由 `sessionStats` 折叠按每个上报事件自身的时间、对照运营者的低谷窗口判定（`packages/session/session-stats/src/off-peak.ts`）。窗口位于宿主设置中，由注册方读取并闭包进折叠，还被并进单元的 `stateVersion`；客户端自行判定时段就是复制这一判定，可能与投影不一致，而用减法反推缓存未命中数则是在编造提供方从未上报的数字。

因此计费需要同时拿到按轮的 token、按轮的路由归属，以及投影的时段判定，而既有值没有同时携带这三者。

## Decision

`sessionStats` 新增 `turnRoutes`：与 `routes` 相同的、按价格时段分组的四项提供方计数，但除路由外还按花费它们的轮次分桶。两个维度都经由同一个 `accrueInto` helper、在同一个 `assistant/message` 处累加，因此逐轮桶在构造上就是对会话级桶的划分，某一轮的费用不可能由别的轮次的 token 拼出。折叠的状态版本升到 6，因为序列化状态多了一个字段。

聊天轮次数字用 `totalCost` 给这些桶计价，完全不接触时段、路由或会话总量。运营者的价格表在每次接受设置区块时从 `console-pricing` 采纳（`PriceTablePolicy`），而不是在加载时只读一次：客户端设置镜像异步应答，因此 `bind` 之后的第一份快照不带值，只读一次会让整个页面生命周期内每一轮都显示未定价。

计费规则本身从 `packages/client/ui-console/src/client/pricing.ts` 移到 `dsh-client-ui-primitives`。客户端插件不得伸手拿另一个功能插件的值，而把这套算术复制进 `ui-chat`，会让两个费用面各有一份「无法计价路由」规则实现，而它们要为同一批 token 作答。

投影未把该轮 token 归属到任何路由时，该数字不显示任何内容；其余情况显示金额、`未定价` 或 `价格不唯一` —— 把控制台卡片的处理方式延伸到这一行。

## Alternatives considered

### 用 `deriveTurnTokenUsage` 计价，并由客户端判定时段

否决：这会把低谷窗口搬进浏览器。窗口是宿主设置值，读取它的折叠在变更时会重新注册并使持久行失效，而时段判定的第二份实现会与「控制台据以计价的桶」悄悄不一致。

### 用会话级 `routes` 桶给该轮计价

否决：中途换过模型或跨过低谷边界的会话有多个桶，且无法说明哪些属于这一轮。这正是控制台自己的 seam note 已经为扁平 token 总量否决掉的错误计费。

### 用会话当前模型猜路由

否决：猜测会以事实的形式展示错误费用。投影无法归属路由的轮次不显示数字。

### 为逐轮桶新增一个投影键

否决：时段判定与 `request/header` 的路由继承都已经住在 `sessionStats` 折叠里。第二个单元会复制这两者，并可能与同一批 token 的会话数字不一致。

### 在 `ui-chat` 里复制计费算术

否决：控制台与操作行将各自持有「未定价 / 价格不唯一」规则的一份实现，而去重门禁的存在正是因为这种分歧是无声的。

## Consequences

- 各轮费用之和等于控制台显示的会话费用，因为这些桶是划分关系。
- 费用跟随投影的桶累计，即每个步骤计一条已组装消息。失败后被重试的那次尝试会进入用量胶囊的尝试级总量，却不进入费用；该限制已记录在投影包与聊天包的 README 中。
- `turnRoutes` 随会话增长（每个轮次与路由各一桶），按整值规则在每次推送与会话列表中都完整携带，正如 `turnOutline` 已为其预览所做的那样。
- `dsh-client-ui-primitives` 现在在 React 原子组件之外也承载共享计费算术；该模块是纯值模块，不含 React 也不含 Cordis。
- 聊天价格表是响应式的，因此操作行会跟上运营者的修改；控制台卡片仍在加载时只读一次。

## Testing

- `packages/session/session-stats/tests/projection.spec.ts` 折叠合成事件，断言中途换模型、同一轮的两个步骤、某一轮跨低谷边界、会话桶的划分关系，以及没有路由 header 的步骤等情形下的逐轮桶。
- `packages/client/ui-primitives/tests/pricing.client.spec.ts` 原样覆盖迁移过来的算术。
- `packages/client/ui-chat/tests/turn-cost-figure.client.spec.tsx` 以构造 props 渲染该数字，覆盖金额、不足一个单位、未定价、价格不唯一、别的轮次与无桶等情形；`price-table-policy.client.spec.ts` 覆盖采纳、重复发布与清空；`chat-view.client.spec.tsx` 断言费用渲染在尾部行的用量与用时数字之后。
