# Agent Note: 共享客户端费用原语

Status: implemented

[English](2026-09-23-shared-client-cost-primitives.md) | 中文

## Problem

两个客户端包为同一批 token 计价。控制台的任务统计卡片渲染整个会话的费用，聊天操作行渲染逐轮费用；两者都是把运营者的 `console-pricing` 价格表应用到提供方上报的计数上，因此都需要同一套计费规则——一个时段里四项互不重叠的计数如何映射到该时段的三档价格、一个桶属于哪条路由，以及价格表无法计价的路由渲染成什么。

一个功能插件无法把这套规则交给另一个功能插件。[packages/client/AGENTS.md](../../../../packages/client/AGENTS.md) 既禁止功能插件运行时 import 或再导出另一个功能插件的值，也禁止用 `dsh.client.external` 去取它们，因此第二个费用面最省事的做法就是复制。计费算术本身在聊天数字需要它时离开了 `ui-console`；而价格表采纳策略——每个费用的另一半——被写了两遍，每个功能包内各一份（[决策](../feature/2026-09-23-turn-cost-in-assistant-action-row.zh.md)）。

让这份复制变得危险的不是体积。两份策略副本的可执行代码逐字节相同，唯一差异是注释，而它们承载的那条规则恰恰是读者无法从渲染出的费用上核对的：没有价格行的路由是「无法计价」而不是「免费」；当多行同时命中同一个 provider 与 model 时无法区分，因为上报的桶不带 endpoint，因此两者都不能按零或按另一个 endpoint 的价格计费。丢掉这条规则的副本会把一个看起来合理的错误数字打印出来，而不是不显示费用；两个费用面各自的测试都发现不了，因为每个费用面只观测自己那份副本。最终是重复检测器报出了这一对：41 行、163 个 token 的 TypeScript 克隆。

## Decision

**`@deepseek-ai/dsh-client-ui-primitives` 是两个费用面共用的客户端费用代码的唯一归属。** 两个不含 Cordis、不含 React 的值模块承载它，并由该包索引在 React 原子组件旁边导出：[`src/pricing.ts`](../../../../packages/client/ui-primitives/src/pricing.ts) 承载按时段计费的算术，[`src/price-table.ts`](../../../../packages/client/ui-primitives/src/price-table.ts) 承载 `PriceTablePolicy`，即从 `console-pricing` settings namespace 采纳的运营者价格表。控制台费用数字与聊天轮次数字都从这里 import，两个功能包都不再保留本地副本。

归属只是决定的一半；这条规则还必须能被找到。[ui-primitives README](../../../../packages/client/ui-primitives/README.zh.md) 里有一行目录条目列出全部五个费用导出，还有一节计费算术说明「未定价 / 价格不唯一」规则，因此新增第三个费用面的作者只需读一个文件，而不必翻遍各个功能包。`packages/client/AGENTS.md` 把 `ui-primitives` 列为共享客户端运行时代码应归属的狭窄静态归属方之一，与 `client/store` 和浏览器安全的工具包并列。

这是对该包既有规则的一次延伸。第二个客户端包需要的控件住在 `ui-primitives`（[决策](2026-09-05-shared-client-control-primitives.zh.md)）；两个客户端包需要的值模块出于同样的理由住在那里。`ui-primitives` 是一个库而不是功能插件——零 Cordis、零 slot——因此 import 它并不是导出纪律所禁止的那种跨功能取值。

## Why ui-primitives

- **它已经是共享的模块身份。** shell 把 `@deepseek-ai/dsh-client-ui-primitives` 写进 `PLATFORM_MODULES`（[platform.ts](../../../../packages/client/web/src/platform.ts)），因此每个动态客户端 bundle 都能拿到它的同一份副本，既不需要 manifest 条目，也不需要 `dsh.client.external` 请求，更不需要声明模块图边。
- **它本来就拥有这套算术。** 把采纳策略提升到别处，会让同一个费用数字的两半分属两个归属方，并让共享算术接收的输入仍由各个消费方自行产出。
- **它的 README 是客户端作者的起点。** 组件目录是新增客户端代码的清单入口，而计费算术那一节与目录条目同处一个文件。

## Alternatives considered

**每个功能包各自保留一份策略副本。** 否决。这正是本次提升所结束的状态，而副本自己给出了理由：它们的可执行代码逐字节相同，不存在任何有意的差异需要保留，而确实不同的注释只是从各自读者的视角描述同一行为。重复门禁能报出完全相同的副本，却报不出只漂移了一行的副本，而后者才是这条规则真正的失效方式——两个费用面按两个版本的「无法计价路由」规则为同一批 token 渲染数字。

**从 `ui-chat` 或 `ui-console` 的 `/client` 入口导出该策略。** 否决。功能插件不得运行时 import 或再导出另一个功能插件的值，而 `/client` 入口是包的公开浏览器 API，不是摆放共享 helper 的架子。依赖方向也会反过来：控制台的会话总费用会为了一套两个功能都不拥有的算术而依赖聊天功能包，下一个费用面还会再加一条边。

**为共享费用代码新建一个包。** 否决。两个模块都没有生命周期——没有服务、没有 slot、没有 effect——因此新建 `packages/client/*` 包要为两个纯模块付出完整的包骨架（manifest、`dsh.client` 行、bundle 注册、tsconfig 聚合条目、README、发布文件清单）。动态客户端 bundle 之后只能通过两种方式拿到它：在 shell 的模块表里新播下一个基线身份，或使用导出纪律只允许基础设施、传输与生成装配使用的 `dsh.client.external` 请求。而 `ui-primitives` 已经是那个基线身份，也已经持有这套算术。

**只共享算术、让策略保持复制。** 否决。这正是中间状态的做法，它留下了检测器已经报出的那一半。两份副本还在「副本在行为分叉之前唯一可能分叉的地方」分了叉：它们的头注释各自从本方读者视角描述这份策略，而控制台那份断言聊天数字是「通过它自己的一份策略副本」采纳同一 namespace，并点名 `ui-primitives` 是两个读者将共同迁往的归属。把它们分开，意味着此后对采纳的任何改动——清空规则、它读取的区块——都必须做两遍才能保持同步。

## Consequences

- 两个费用面不可能再为同一批 token 产生分歧：`priceOf`、`costOf` 与 `totalCost` 是同一份实现，因此「无法计价路由」规则只有一处需要修改，第三个费用面也是 import 同一批函数，而不是再写第三份规则。
- 计费没有任何变化。两份副本的可执行代码逐字节相同，两个读者 import 同一个模块，随代码一同迁移的测试钉住了同样的行为。
- **这个包里的改动只能经由 shell 产物到达浏览器。** `ui-primitives` 是静态链接库（[客户端 shell 分层决策](2026-08-15-client-shells-and-dynamic-packages.zh.md)）：它的 `lib/index.js` 由 Vite 宿主合并进 `apps/web/dist`，而不是作为 `lib/client.js` 插件行投递，因此一次修改需要先执行 `pnpm run build:lib:client`，再执行 `pnpm run build:web`，之后还需要刷新页面——静态链接库没有可供 HMR 计算哈希的插件行版本，因此它永远拿不到功能插件 bundle 那种免刷新重载。重建后的 dist 不需要重启服务器，因为 [frontend-static](../../../../packages/host/frontend-static/src/index.ts) 在每个请求中读取 `dist/index.html`。
- **开发期 watcher 覆盖这两个阶段，但任一阶段缺失时它静默失败。** `pnpm run dev:web` 既监视 shell 所链接的 client preset 库包——五个之中包含 `packages/client/ui-primitives`——也监视 `dsh.client` 插件包，而 shell 自己的 Vite watcher 会把 `lib/` 重新合并进 dist。它的各个阶段都在一次完整构建之上增量执行，且没有任何一个阶段会为缺失的产物树做引导，因此陈旧或缺失的阶段会展示上一份产物而不是失败，表现为「我的改动没生效」（[scripts/dev-web.ts](../../../../scripts/dev-web.ts)）。
- **在这里新增依赖边，要在同一次提交里记录 lockfile。** 本次提升给 `ui-primitives/package.json` 加了三条仅开发期的边——`dsh-client-store`、`dsh-client-test-runtime` 与 `dsh-client-ui-settings`——而 lockfile 是在另一次提交中补齐的，因为 frozen-lockfile 安装会拒绝 lockfile 未描述的 manifest。它们保持仅开发期，浏览器与类型关系本就如此。
- **全仓克隆门禁仍因其他代码而不通过。** `pnpm run duplication` 在提升前报出 9 个克隆，提升后为 8 个；被移除的那个就是这对策略副本。剩下 8 个在控制台费用工作开始之前的那次提交上就已报出，且没有一个属于本模块：两个 `ui-console` 卡片、`console-bridge/src/index.ts`，以及 `mcpsec-manager` 内的五个。本次改动不能主张克隆门禁为绿。

## Testing

`packages/client/ui-primitives/tests/pricing.client.spec.ts` 与 `packages/client/ui-primitives/tests/price-table.client.spec.ts` 在每文件覆盖率门禁内覆盖这两个模块。每个费用面保留自己的测试——`ui-chat` 中轮次数字的金额、未定价、价格不唯一与无桶等情形，以及控制台卡片在 `price-table-apply.client.spec.tsx` 中的采纳——因此共享规则与各费用面对其结果的渲染分别受到断言。控制台卡片的未定价路由渲染，也是[控制台工作台决策](2026-09-01-ui-console-workbench-seams.zh.md)所否决的「按零计费」。
