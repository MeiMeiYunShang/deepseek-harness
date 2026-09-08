---
description: "dsh Web 客户端的知识目录设置页：带搜索与分类/分组过滤的列表、内联 create/update、删除、分组面板与条目详情，全部由 knowledge Remote 支撑。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-knowledge

[English](README.md) | 中文

## 概述

`dsh-client-ui-settings-knowledge` 为 Web Settings 添加 Knowledge 页。该页列出知识条目，支持搜索、分类与分组过滤，并提供内联 create/update、带确认的删除、分组面板（新建/删除）与条目详情。每个变更都经由 `knowledge` Remote，成功后页面从宿主重新读取目录，因此宿主保持唯一事实源。

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

打开设置 → Knowledge。页面显示条目目录与分组面板。用工具栏搜索或按分类/分组过滤；`New entry` 打开内联编辑器。行的编辑/删除动作会打开预填的同一编辑器或删除确认框。

### source 提供什么

页面读取 `ctx.remote.knowledge.list({})`，并调用 `create`/`update`/`delete`/`createGroup`/`deleteGroup`；每次写操作都会重新拉取目录。store 发布目录快照；组件把编辑器、过滤与详情状态保持在本地。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

目录通过 `createKnowledgeSettingsStore()`（工厂函数）声明，并作为 `settings.section` 条目的 store 座位注册；组件通过 `useStore` 读取。注入面提供 mutation 回调，它们闭包于框架交给注入工厂的动作集，并在每次成功时重新拉取目录。`connection/reset` 会刷新已落定的目录。

### 注册

插件通过 `ctx.slots.inject` 注册一条 `settings.section` 条目，带 `id: 'knowledge'`、`order: 30` 与 `nav` 标签。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下页面覆盖宿主知识库与设置外壳。

- [knowledge](../../knowledge/knowledge/README.zh.md)——宿主知识库服务（`ctx.knowledge`）。
- [knowledge-controller](../../api/knowledge-controller/README.zh.md)——每次变更背后的 `knowledge` Remote 拥有者。
- [ui-settings](../ui-settings/README.zh.md)——拥有 `settings.section` 槽的外壳。

-----

<a id="model-experience"></a>
## 模型体验

### 知识目录管理

#### 模型看到的内容

设置页不向任何模型请求添加内容。变更经由 `ctx.remote.knowledge.create`/`update`/`delete`；它是用户可见的管理面，目录文本不改变模型收到的内容。

#### Token 影响

无。每次读取与写入都是用户可见的管理操作，零模型 token。

#### KV Cache 影响

无。本包绝不改写请求 token。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制是当前包约束。

- **编辑是 create 与 update 共用的单个内联编辑器**——编辑器开着时打开另一条会替换草稿；不支持多行编辑。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
