---
description: "面向维护者的控制台工作台：一个侧栏底部操作，打开全屏三列监控弹窗（会话状态、任务统计、主机指标、带指令输入框的活动时间线、知识库视图与智能问答）。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-console

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-client-ui-console` 是 dsh web GUI 的浏览器控制台工作台。它贡献一个侧栏底部操作，打开全屏三列监控弹窗：会话状态、任务统计、主机资源指标、带指令输入框的作用域活动时间线、占位知识库与智能问答。会话状态与动词来自 `ctx.sessions`、`ctx.workspaces` 与 `sessionStats` 投影；主机指标与时间线条目来自转发的 `host/metrics` 与 `api-session/*` 事件。用它即可在不离开 web GUI 的情况下观察并操控会话。

## 目录

- [理解实现](#understand-the-implementation)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 —— 点击展开</summary>

弹窗是自定义的 `role="dialog"` 面板，而非盒式原始 `Modal`，以三列排布：

- **会话状态** —— 统计/网格视图切换。统计视图计数总数、运行中、等待输入、已完成与已归档；网格视图为每个会话铺一块状态色方块（绿色运行中、琥珀等待、红色规划/等待输入、品牌蓝可用、灰色已归档），带当前/选中描边与右键菜单（重命名、Fork、归档）。
- **任务统计** —— 作用域行（整个列表或选中会话）加来自 `sessionStats` 投影的运行中、轮数、步骤数、LLM 耗时与工具耗时计数。
- **系统状态** —— 来自转发 `host/metrics` 事件的 CPU / 内存 / GPU 环形仪表。
- **时间线** —— 简要/全部两种粒度的粗略活动列表，可限定到单个会话或整个列表，带可折叠的提问详情，另有向选中会话发送指令的输入框。
- **知识库** —— 来源列表，当前渲染空/占位状态（尚无后端 seam）。
- **智能问答** —— 通过 `ctx.remote.llm.chat` 流式完成一次性补全。

每张卡在标题行都有折叠开关，把卡片主体收起到仅剩标题栏；顶部的列布局切换（均衡 / 聚焦 / 紧凑）在宽屏下改变网格列比例。在低分辨率屏幕上网格按响应式重排（三列 → 二加一 → 单列堆叠），不受所选预设影响。

待处理交互通过 `ctx.uiSession.pendingInteractions` 的网格相位着色呈现；会话动词（打开、重命名、Fork、归档、新建、预设选择、发送指令）经由 `ctx.sessions`、`ctx.workspaces` 与 `ctx.remote.agentPresets` 面。一个「新建会话」弹窗收集工作区、可选的代理预设与首条指令。

</details>

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **智能问答需要已配置的模型** —— 面板从 `console-bridge` 设置命名空间读取模型覆盖（`smartQaModel`，形如 `provider/model`）。未设置时保持禁用；没有客户端模型目录 Remote 可回退。
- **时间线是粗略镜像** —— 它把转发的 `api-session/activity` 与 `api-session/status` 事件渲染为标签，而非完整的会话事件流。会话级事件窗口的细节有意留给对话界面。
- **知识库没有后端 seam** —— 卡片渲染空/占位状态，并导出行类型供未来来源填充。
- **待处理交互是监控提示** —— 控制台以会话网格方块颜色标识待处理的提问或计划审阅，但不在内联回答；回答属于对话编辑器。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者工作上下文 —— 点击展开</summary>

无。

</details>
