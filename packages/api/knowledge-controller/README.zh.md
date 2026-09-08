---
description: "knowledge 命名空间的 Typert Remote 拥有者：把 ctx.knowledge 的 CRUD 投影到 wire 上供浏览器消费，并在边界处校验每次写操作。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-knowledge-controller

[English](README.md) | 中文

## 概述

`dsh-api-knowledge-controller` 是 `knowledge` Typert 命名空间的 Host Remote 拥有者。它把 `ctx.knowledge` store 投影到 wire 上供浏览器消费：`list`、`get`、`create`、`update`、`delete`、`createGroup` 与 `deleteGroup`。每次写操作在触碰 store 之前先于边界处校验 wire 输入，store 的拒绝被归类为 `knowledge/*` 的 `RemoteError`。

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

浏览器消费者通过 `ctx.remote.knowledge` 访问该命名空间（由 api-remotes 客户端装配挂载）。`./types` 子路径携带浏览器安全的请求/值词汇（`KnowledgeEntryView`、`KnowledgeGroupView`、`KnowledgeCreateInput`、`KnowledgeUpdatePatch`、`KnowledgeListRequest` 与品牌 id 类型）。本包是 Host 侧控制器：它在 Host 上挂载，绝不作为运行时导入进 bundle。

### source 提供什么

`list(filter)` 返回条目（最新在前）与所有分组；`create`/`update`/`delete` 变更条目；`createGroup`/`deleteGroup` 变更分组。空白分组名、非法分类或未知 id 分别映射为 `knowledge/invalid-input`、`knowledge/invalid-category` 或 `knowledge/not-found`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

控制器继承 `TypertRemoteService` 并为每个方法标注 `@Remote`；wire schema 从方法签名推断（无 `@typert` 标签）。它通过 `ctx.get('knowledge')` 解析 store，在组合挂载了控制器却没有知识 store 时抛出 `gateway/internal`。`entryView`/`groupView` 逐字段投影 store 行，并省略缺失的可选字段。方法参数不带默认值，因此客户端总是显式传入过滤对象（如 `list({})`）。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [knowledge](../../knowledge/knowledge/README.zh.md)——本控制器投影到 wire 的 store。
- [api-remotes](../../api/remotes/README.zh.md)——把生成的命名空间挂载到 `ctx.remote` 的客户端装配。
- [ui-settings-knowledge](../../client/ui-settings-knowledge/README.zh.md)——这些方法的主要浏览器消费者。

-----

<a id="model-experience"></a>
## 模型体验

### 经由 wire 的知识目录

#### 模型看到的内容

控制器在 Host 侧，不向模型请求添加内容。它是用户可见知识 picker 与设置页背后的传输；模型只通过 `knowledge_search`/`save_knowledge` 访问知识（见 `dsh-tool-knowledge`）。

#### Token 影响

零。本控制器不产生任何提示文本。

#### KV Cache 影响

无。本包绝不改写请求 token。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制是当前包约束。

- **读取是整个目录的投影**——`list` 一次返回条目与分组；除 store 过滤的 `limit` 外没有分页。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
