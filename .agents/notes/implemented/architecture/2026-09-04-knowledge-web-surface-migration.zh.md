# Agent Note：基于 `knowledge` Remote 的 Web 知识表面

Status: implemented

[English](2026-09-04-knowledge-web-surface-migration.md) | 中文

## 问题

Knowledge 能力以三个宿主包（`dsh-knowledge`、`dsh-knowledge-file`、`dsh-tool-knowledge`）加上一个 Typert 拥有者（`dsh-api-knowledge-controller`）进入 harness，但 Web 客户端还没有暂存或管理该目录的表面。

## 决策

新增两个浏览器客户端包，它们消费生成的 `ctx.remote.knowledge` 命名空间，经由 api-remotes facade 读取 `knowledge` Remote：

- `dsh-client-ui-knowledge-picker`——空白会话 Hero（`conversation.hero.knowledge`，single）上的多选 chip，以及编辑器工具栏中的 toggler（`conversation.input.left`，`id: 'knowledge-picker'`、`order: 0`）。一个 `createKnowledgePickerStore()` 实例通过两个注册点的注入 `hooks` 通道暴露，因此尽管槽作用域不同（Hero 为 root 作用域，编辑器为 session 作用域），两个条目也是同一个选择。
- `dsh-client-ui-settings-knowledge`——一条 `settings.section` 条目（`id: 'knowledge'`、`order: 30`）。它读取 `knowledge.list`，并调用 `create`/`update`/`delete`/`createGroup`/`deleteGroup`，每次写操作后重新拉取目录（宿主保持唯一事实源）。目录是声明的 store；编辑器/过滤/详情状态是组件级局部状态。

两个包都遵循客户端约束：组件永远不接触 `ctx`，所有数据经 props 共享或注入的 `hooks` 通道到达，产品文案是类型化 locale 字典，注册通过 `ctx.slots.inject` 路由以等待 ui-conversation / ui-settings 的声明。

## 考虑过的替代方案

- **复用经 inject 传递的共享控制器类**（如 `ui-agent-preset` 对其 seat 的做法）——可行，但 picker 需要按客户端约定采用工厂驱动的 store，因此 `defineStore` + 在 `apply` 中一次 `.create()` 并把 source 放进 `hooks` 通道更加贴近。
- **在 picker 注册点声明 store**——不可行：声明的 store 按作用域键控实例，因此 root 作用域的 Hero 与 session 作用域的编辑器会得到两个实例，而不是一个共享选择。

## 后果

- picker 目录只读；设置页是写入方。
- picker 选择目前仅在客户端保存：还没有任何代码把它投影到后续提示词。这是已记录的 Known Limitation（延期工作）。
- image-understanding 与 mcpsec-manager 的迁移仍是独立的后续阶段。
