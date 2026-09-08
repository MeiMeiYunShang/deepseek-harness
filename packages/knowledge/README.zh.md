---
description: "知识能力家族：进程内知识库、JSON 文件持久化提供方、面向模型的搜索/保存工具与系统提示注入，以及面向 Web 客户端的 knowledge Remote 拥有者。"
kind: "package-group"
---

# knowledge/ — 知识能力家族

[English](README.md) | 中文

## 概述

知识组把可复用经验存储为编目的条目与分组。`knowledge` 包拥有 Service Definition（`ctx.knowledge`）：一个进程内 CRUD 注册表，生成 id、校验分类，并在每次变更时发出 `knowledge/change`。`knowledge-file` 附加 JSON 文件持久化，启动时从配置根目录填充 store，并把每次变更写回为每个条目与分组各一个文件。`tool-knowledge` 是面向模型的消费者：`knowledge_search` 与 `save_knowledge` 工具、按 token 预算分配的系统提示段，以及可选的会话自动摘要。`api/knowledge-controller` 把 store 作为 `knowledge` Typert 命名空间投影到 wire 供 Web 客户端使用。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx key |
|---|---|---|
| [`knowledge`](knowledge/README.zh.md) | 定义进程内 store：条目、分组、分类、过滤与变更通知 | `ctx.knowledge` |
| [`knowledge-file`](knowledge-file/README.zh.md) | 把条目与分组各作为一个 JSON 文件持久化到可配置根目录 | 监听 `knowledge/change` |
| [`tool-knowledge`](tool-knowledge/README.zh.md) | 注册 `knowledge_search`/`save_knowledge`、注入知识上下文段，并自动摘要会话 | 注册 `ctx.tools` |
| [`api/knowledge-controller`](../api/knowledge-controller/README.zh.md) | 把 store 作为 `knowledge` Remote 命名空间投影到 wire | `ctx.remote.knowledge` |

部署至少挂载 store 与一个持久化提供方；面向模型的消费者与 Web 控制器是增量的。不持久化而启用 `tool-knowledge` 会让目录保持进程内。

-----

<a id="related-documentation"></a>
## 相关文档

- [system-prompt 子系统](../../docs/subsystems/system-prompt.zh.md)——面向模型消费者所注册的段序拥有者。
- [Slots 参考（Web 客户端）](../../docs/subsystems/slots.zh.md)——Web 客户端表面如何组合。

<a id="dev-note"></a>
## 开发备注

无。
