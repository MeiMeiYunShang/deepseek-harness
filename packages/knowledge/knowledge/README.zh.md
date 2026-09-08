---
description: "知识库服务定义（ctx.knowledge）：知识与分组的进程内 CRUD 注册表，以及消费者与持久化提供方所依赖的变更通知。"
kind: "package-reference"
---

# @deepseek-ai/dsh-knowledge

[English](README.md) | 中文

## 概述

`dsh-knowledge` 拥有知识能力接缝的 Service Definition 角色：`ctx.knowledge` 服务，声明知识与分组的进程内注册表。它生成带品牌标识的 id、校验输入与分类，并在每次变更时发出 `knowledge/change`。诸如 `dsh-knowledge-file` 之类的具体提供方通过启动时填充 store 并回写变更来附加持久化；本包只拥有运行时注册表、类型词汇与变更通知。

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

消费者完全通过 `ctx.knowledge` 读写知识目录：`listEntries(filter)`（对标题、内容与标签做不区分大小写匹配，最新在前）、`getEntry`、`saveEntry`、`updateEntry`、`deleteEntry`、`listGroups`、`getGroup`、`createGroup`、`deleteGroup`、`assignToGroup` 与 `hydrate`。`knowledge/types` 子路径携带浏览器安全的条目/分组/分类/过滤词汇。

### store 提供什么

条目拥有 `KNOWLEDGE_CATEGORIES` 中的分类、自由标签、可选分组与可选来源会话。分组携带名称、描述与所含条目 id 的有序列表。id 是品牌类型（`KnowledgeEntryId`/`KnowledgeGroupId`）；store 指定 `createdAt`/`updatedAt`，并把条目 id 追加到其分组的 `entryIds`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

store 是一个普通 `Service`，拥有两个 `Map`（entries、groups）与单调计数器。变更在边界处校验输入、应用改动，并发出无过滤的 `knowledge/change` 失效通知，且对每个监听器进行隔离（抛错的监听器不能否决该变更）。`updateEntry` 只合并提供的字段并刷新 `updatedAt`；`deleteGroup` 清除每个成员的 `groupId`。`hydrate` 整体替换注册表，并从最大的 `k_`/`g_` id 重新推算计数器，因此持久化提供方可以重新填充而不破坏 id 单调性。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [knowledge-file](../knowledge-file/README.zh.md)——填充本 store 的 JSON 文件持久化提供方。
- [tool-knowledge](../tool-knowledge/README.zh.md)——面向模型的 `knowledge_search`/`save_knowledge` 工具与系统提示注入。
- [knowledge-controller](../../api/knowledge-controller/README.zh.md)——Web 客户端所读取的 `knowledge` Remote 拥有者。

-----

<a id="model-experience"></a>
## 模型体验

### 经由知识工具访问的条目

#### 模型看到的内容

store 本身在宿主侧，从不出现于模型请求。模型通过 `knowledge_search` 工具访问条目（返回标题、内容、分类、标签），并通过 `save_knowledge` 记录条目；两者均在 `dsh-tool-knowledge` 中实现。本包提供这些工具读写的进程内注册表。

#### Token 影响

零。本包绝不注入提示文本；系统提示注入与 token 预算在 `dsh-tool-knowledge` 中。

#### KV Cache 影响

无。本包绝不改写请求 token。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制是当前包约束。

- **变更通知无过滤**——消费者为自己的过滤条件重新拉取整个目录；没有逐条事件载荷。
- **默认仅驻留内存**——没有持久化提供方时，目录在进程重启后丢失。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
