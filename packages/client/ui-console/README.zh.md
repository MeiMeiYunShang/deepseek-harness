---
description: "面向维护者的控制台工作台：一个侧栏底部操作，打开全屏监控弹窗（会话状态、任务统计、主机指标、活动时间线与智能问答）。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-console

[English](README.md) | 中文

## Summary

`@deepseek-ai/dsh-client-ui-console` 是 dsh web GUI 的浏览器控制台工作台。它贡献一个侧栏底部操作，打开全屏监控弹窗：会话状态与累计任务统计来自标准的 `ctx.sessions` 数据流与 `sessionStats` 投影；待处理的 `ask_user_question` 交互来自 `ctx.uiSession.pendingInteractions`；主机资源指标来自转发的 `host/metrics` 事件；活动时间线来自转发的 `api-session/*` 事件；智能问答面板通过 `ctx.remote.llm.chat` 流式完成一次性补全。

## Known Limitations and Deferred Work

- **智能问答需要已配置的模型** —— 面板从 `console-bridge` 设置命名空间读取模型覆盖（`smartQaModel`，形如 `provider/model`）。未设置时保持禁用；没有客户端模型目录 Remote 可回退。
- **时间线是粗略镜像** —— 它把转发的 `api-session/activity` 与 `api-session/status` 事件渲染为标签，而非完整的会话事件流。会话级事件窗口的细节有意留给对话界面。
- **待处理交互是监控视图** —— 控制台标识哪些会话有待处理的提问或计划审阅，但不在内联回答；回答属于对话编辑器。
