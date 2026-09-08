---
description: "dsh Web 客户端的知识多选 picker：空白会话 Hero 上的 chip 与编辑器工具栏 toggler，共享同一个客户端选择，目录经由 knowledge Remote 读取。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-knowledge-picker

[English](README.md) | 中文

## 概述

`dsh-client-ui-knowledge-picker` 让用户在会话开始前暂存已知知识条目：空白会话 Hero 上的 chip 与编辑器工具栏中的同一个 picker 打开同一个多选对话框。目录是宿主知识库的只读投影，经由 `knowledge` Remote 拉取；选择保存在客户端，计划在下次会话提示词时随行。

Hero chip 与编辑器 toggler 是注册进两个槽的同一个组件，因此选择本质上是同一个状态：`conversation.hero.knowledge` 单槽与 `conversation.input.left` 列表槽通过注入的 `hooks` 通道共享同一个 store 实例。编辑器条目带有槽标签（`composerToggler`）。

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

点击空白会话屏幕或编辑器工具栏上的 Knowledge chip 打开 picker，勾选要暂存的条目。chip 显示已选数量；空目录显示 `No entries`。对话框搜索按标题、分类与标签过滤。

### source 提供什么

目录来自 `ctx.remote.knowledge.list({})`；调用失败会折叠成错误 store 状态，chip 不显示任何条目。选择在会话生命周期内保存在客户端。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

store 通过 `createKnowledgePickerStore()`（工厂函数）声明，这样插件重载不能复用模块级实例。在 `apply` 内工厂只调用一次，结果的 source 通过两个注册点的注入 `hooks` 通道共享，因此无论槽作用域如何（Hero 为 root 作用域，编辑器为 session 作用域），两个条目都读写同一个选择。

### 注册

`/client` 导出接口只有插件主体（`apply`/`inject`）；`KnowledgePicker` 组件是注册 effect 的内部实现。Hero chip 注册进 `conversation.hero.knowledge`；编辑器 toggler 注册进 `conversation.input.left`，带 `id: 'knowledge-picker'`、`order: 0` 与 `composerToggler` 标签。两者都用 `ctx.slots.inject`，等待 ui-conversation 的声明。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下页面覆盖宿主知识库与对话外壳座位。

- [knowledge](../../knowledge/knowledge/README.zh.md)——宿主知识库服务（`ctx.knowledge`）。
- [knowledge-controller](../../api/knowledge-controller/README.zh.md)——picker 所读取的 `knowledge` Remote 拥有者。
- [ui-conversation](../ui-conversation/README.zh.md)——声明 Hero 与编辑器槽的外壳。

-----

<a id="model-experience"></a>
## 模型体验

### 暂存的知识选择

#### 模型看到的内容

picker 本身不向任何模型请求添加内容。目录经由 `ctx.remote.knowledge.list({})` 拉取；选择是客户端状态，本包不将其注入提示词，因此模型看不到 picker 带来的任何变化。（暂存选择如何投影到后续提示词已推迟，见已知限制。）

#### Token 影响

无。目录拉取、菜单浏览与暂存选择不增加任何模型 token。

#### KV Cache 影响

无。本包绝不改写请求 token。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制是当前包约束。

- **暂存的选择尚未到达模型**——store 在客户端保存所选项 id，但还没有任何提示词构造消费它们。把暂存选择接入下一次会话提示词已推迟。
- **目录加载失败是静默的**——`knowledge.list` 失败会折叠成错误 store 状态，chip 不显示任何条目；失败不会以重试入口的形式呈现给用户。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
