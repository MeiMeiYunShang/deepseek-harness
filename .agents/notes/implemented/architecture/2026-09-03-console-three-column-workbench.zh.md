# Agent Note：全屏三栏控制台工作台

Status: implemented

[English](2026-09-03-console-three-column-workbench.md) | 中文

## 问题

迁移后的 ui-console 是一个两栏监控卡片，并使用自带的盒装 `Modal`。维护者控制台（按迁移来源）是一个真正的全屏工作台：三栏网格、带 stats/grid 切换的每会话状态网格、带指令编辑器的限定范围时间线、会话动词（重命名 / fork / 归档 / 新建 / 预设）、知识视图与 Smart Q&A。自带的 `Modal` 基本组件是一个居中卡片（最大 380px），因此无法承载 100vw × 100vh 面板。

## 决策

- 在 `Workbench.tsx` 中构建自定义全屏外壳（`role="dialog" aria-modal`，mask + panel + header），而非盒装基本组件 `Modal`；基本组件仍用于嵌套的重命名与新建会话对话框。
- 把工作台拆分为聚焦的纯函数与组件模块：`format.ts`、`sessionState.ts`、`timelineText.ts`（纯辅助），以及 `SessionStatusCard`、`TaskStatsCard`、`SystemStatusCard`、`TimelineCard`、`KnowledgeCard`、`ContextMenu`、`modals`（组件），由 `Workbench` 组合，`ConsoleButton` 打开。
- 丰富 store（`consoleStore`），在现有时间线之外加入 `sessionView`、`selectedSession` 与 `timelineScope`，并暴露有界的写面（`ConsoleStoreWrite`），使组件只触碰声明的动作。
- 经由在 `index.ts` 中基于 `ctx.sessions`（`open`/`fork`/`rename`，通过会话行为面/`prompt`）、`ctx.workspaces`（`archiveSession`、`create`）与 `ctx.remote.agentPresets`（`list`/`select`）构建的 `ConsoleServices` 面连接会话动词，并在服务边界解包 `RemoteResult`。
- 会话状态、任务统计、当前选择与网格来自标准 `useSessions`/`useSessionPendingInteraction`/`useWorkspaces` 钩子，经槽组合模型传入；宿主指标与时间线仍走转发到 apply 自有 store 的远程事件。
- 知识库没有后端接缝，因此 `KnowledgeCard` 渲染空/占位状态，并为未来 source 导出行类型。

## 考虑过的替代方案

- **保留盒装基本组件 `Modal`**——迁移来源是一个两栏监控卡片，而基本组件 `Modal` 是居中卡片，宽度上限 380px，因此无法承载 100vw × 100vh 的维护者工作台。
- **把基本组件 `Modal` 扩展为全屏变体**——会把控制台专属外观（三栏网格、会话动词、限定范围时间线）耦合进别处也使用的共享基本组件；工作台改为自行拥有外壳，并把基本组件留给嵌套的对话框。

## 后果

- 控制台是真实服务面之上的呈现层；当绑定或工作区缺失时会话动词会响亮失败。
- 三栏网格、亮/暗 token 纪律与减少动画感知的动效遵循仓库约定（无字面颜色、类型化 `--dsw-*` token）。
- 逐文件 100% 覆盖率门禁由 `tests/` 下的组件与流程 spec 满足。
