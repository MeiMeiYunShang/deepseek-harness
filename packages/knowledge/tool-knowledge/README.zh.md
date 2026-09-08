---
description: "面向模型的知识消费者：knowledge_search 与 save_knowledge 工具、按 token 预算分配的知识上下文段，以及会话处置或归档时可选的知识自动摘要。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-knowledge

[English](README.md) | 中文

## 概述

`dsh-tool-knowledge` 是面向模型的知识消费者。它在 `ctx.tools` 上注册两个工具——`knowledge_search`（查询知识库）与 `save_knowledge`（记录可复用经验）——向系统提示注入按 token 预算分配的知识摘要，并在会话被处置或归档时可选地把会话自动摘要为新的知识条目。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把 `tool-knowledge` 与知识库一同挂载。`knowledge_search` 工具接受 `query` 以及可选的 `category`/`groupId`/`tags`/`limit`；`save_knowledge` 接受 `title`、`content`、`category`、可选的 `tags`/`groupId`，并在存在时会话时把条目链接到来源会话。`Config` 启用 `autoSummarize`（默认 true）、`maxSummaryEntries`（5）、`promptBudgetTokens`（500）、`defaultGroupIds`（空 = 最近条目）与 `summarizeModel`（空 = 复用会话的最后请求模型）。

### source 提供什么

系统提示新增 `<knowledge_context>` 段（注册在 `TOOL_KNOWLEDGE` 段序下），列出不超过 token 预算的条目元数据。自动摘要在会话被处置/归档时通过一次 LLM 调用提取至多 `maxSummaryEntries` 条可复用条目，并对同时触发归档与释放的会话去重。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

工具直接调用 `ctx.knowledge.listEntries` 与 `saveEntry`。提示段按粗略字符预算（`promptBudgetTokens * 4`）为每条目构建一行元数据摘要，来源为配置的默认分组或最近 20 条。自动摘要用中文重建提示词，要求模型返回 `{ title, content, category, tags }` 的 JSON 数组，并解析响应里的第一个 JSON 数组；格式错误的响应则得到空结果。摘要 LLM 调用是 fire-and-forget 副作用：失败与无内容的静默会话都只记录日志，从不浮出表面。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [knowledge](../knowledge/README.zh.md)——工具读写所依赖的 store。
- [knowledge-file](../knowledge-file/README.zh.md)——使保存条目持久化的提供方。
- [system-prompt](../../core/system-prompt/README.zh.md)——本消费者注册进段序的拥有者。

-----

<a id="model-experience"></a>
## 模型体验

### knowledge_search 与 save_knowledge

#### 模型看到的内容

系统提示新增 `<knowledge_context>`，列出不超过配置 token 预算的条目元数据（分组或最近条目），并附有指示：在行动前先调用 `knowledge_search` 获取完整内容。`knowledge_search` 返回匹配条目（标题、内容、分类、标签）与总数；`save_knowledge` 返回创建的 id 与标题。注入的上下文是知识条目元数据的固定摘要，而非完整语料。

#### Token 影响

提示段在每次响应构建时最多增加 `promptBudgetTokens` 个 token。`knowledge_search` 把返回的条目作为工具结果加入；`save_knowledge` 加入其小型确认。自动摘要为每个被处置/归档的会话消耗一次摘要调用的 token。

#### KV Cache 影响

仅追加：注入的知识段跟随可复用历史前缀；本包绝不改写较早的请求 token。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制是当前包约束。

- **摘要使用粗略字符预算**——`promptBudgetTokens * 4` 是估算，不是模型的真实分词器。
- **自动摘要失败是静默的**——失败或空摘要的 LLM 调用只记录日志并返回；没有重试或面向用户的恢复。
- **摘要助手调用尚未写入会话日志**——见 Web 表面迁移 Agent Note；模型可见的摘要请求需要 `request/header` 与 assistant 分块会话事件（推迟到后续）。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
