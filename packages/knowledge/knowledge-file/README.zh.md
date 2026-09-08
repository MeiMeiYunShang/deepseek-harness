---
description: "知识库的 JSON 文件持久化提供方：启动时把 ctx.knowledge 从可配置根目录填充，并把每次 knowledge/change 变量回写为每条目与分组各一个文件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-knowledge-file

[English](README.md) | 中文

## 概述

`dsh-knowledge-file` 是知识库的持久化提供方。它启动时把 `ctx.knowledge` 从可配置根目录（默认 `$DSH_HOME/knowledge/`）填充，随后监听 `knowledge/change` 并把每次变更写回。文件是每个条目一个 JSON 文档，位于 `<root>/entries/<id>.json`；每个分组一个 JSON 文档，位于 `<root>/groups/<id>.json`。

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

把 `knowledge-file` 配置为知识组合的一个插件，并提供 `root` 路径（绝对路径）。它作为 `knowledge/change` 监听器挂载，因此必须与 `ctx.knowledge` 一同运行（其 Cordis inject 为 `['knowledge']`）。无需其他配置。

### source 提供什么

激活时它会确保 `<root>/entries` 与 `<root>/groups` 存在，填充 store，并把 `knowledge/change` 的突发合并为一个 flush 循环，使重叠的变更不会丢失最终磁盘状态。一次 flush 重写完整 store，并移除 id 已不在注册表中的 JSON 文件。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

该提供方读取每个目录下的所有 `.json` 文件，并 `hydrate` 注册表，从最大的 `k_`/`g_` id 还原计数器。`scheduleFlush` 循环在变更于写入中途到达时置 `dirty` 标志，因此会针对最终状态再跑一次收尾比对。格式损坏或不可读的文件会被跳过（store 会在下次写入时重新生成）。陈旧文件的移除是尽力而为。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [knowledge](../knowledge/README.zh.md)——本提供方填充并持久化的 store。
- [tool-knowledge](../tool-knowledge/README.zh.md)——写入本提供方所保存条目的知识工具。

-----

<a id="model-experience"></a>
## 模型体验

### 知识条目的持久化

#### 模型看到的内容

本提供方在宿主侧，从不出现于模型请求。它使 `save_knowledge` 的结果跨重启保持持久；一旦 store 已写入，保存的条目便对后续 `knowledge_search` 调用可用。

#### Token 影响

零。不注入任何提示文本。

#### KV Cache 影响

无。本包绝不改写请求 token。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制是当前包约束。

- **每次 flush 全量重写**——每次 flush 写入所有条目与分组，因此大目录会付出全量重写而不是逐条打补丁。
- **损坏文件被静默丢弃**——格式损坏的 JSON 文件在填充时被跳过；没有修复或面向用户的恢复路径。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
