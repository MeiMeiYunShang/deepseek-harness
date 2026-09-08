---
description: "MCP 安全管理器：对 MCP 服务器的权限范围与逐工具规则、读写执行门、逐调用用量评分与告警，以及 npm 包搜索——经由回环 Connection RPC 通道。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-mcpsec-manager

[English](README.md) | 中文

## 概述

`dsh-mcpsec-manager` 为 MCP（`@deepseek-ai/dsh-mcp-client`）服务器提供安全。它管理服务器 loader 行（添加/启用/移除），附着权限范围与逐工具规则，并通过 `tools/pre-execute` waterfall 拦截每次 `mcp__<server>__*` 工具调用——`read-only` 范围在分派前拒绝可写工具（未知能力=write，fail closed）；并从 `tools/result` 记录每次调用，在 10 分钟滑窗内为每个服务器打分，达到阈值时告警。浏览器半部分经回环 Connection RPC 通道 `/mcpsec` 与它交互；机密值绝不离开主机。

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

把 `mcpsec-manager` 与 loader、tools 与一个主机 Connection RPC 注册表一同挂载。它是 profile-bundle 插件（跨重启存活），注册 `/mcpsec` RPC 通道；浏览器表面驱动 `list`/`add`/`remove`/`setEnabled`/`setScope`/`stats`/`setThreshold`/`clearStats`/`npmSearch`。工具分类是启发式（读/写 token；未知=write），并通过范围与逐工具规则双重覆盖。

### source 提供什么

门把只读/屏蔽服务器上的可写调用变成分派前的 `{ kind: 'deny', reason }` 决策；统计观察器为每个服务器打分，并在达到阈值时上报。npm 搜索直接查询 npm registry 搜索 API。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

插件注册一个 `tools/pre-execute` 监听器：解析工具名（`mcp__server__tool`），从其 loader `mcpSecurity` 配置解析服务器策略，并在规则/范围下拒绝。`tools/result` 观察每次已结算的 MCP 调用，记录失败/鉴权错误/凭据载荷/字节/耗时事实，`computeStats` 把滑窗折算为每服务器得分（凭据参数、鉴权错误率、失败率、被拦截次数、调用突增、载荷、耗时）。loader CRUD handler 校验输入并调用 `ctx.loader.create/update/remove`。RPC 通道经 `ctx.connection.rpc.handle('/mcpsec', handler)` 注册，仅回环。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [dsh-tools](../../core/tools/README.zh.md)——`tools/pre-execute`/`tools/result` 事件与 `PreToolDecision`。
- [dsh-mcp-client](../mcp-client/README.zh.md)——本插件所管理 loader 行的 MCP 服务器桥。
- [dsh-client-connection](../../client/connection/README.zh.md)——该通道所依托的回环 Connection RPC 注册表。

-----

<a id="model-experience"></a>
## 模型体验

### 在锁定服务器上拒绝可写工具

#### 模型看到的内容

当模型请求被安全策略拒绝的 MCP 工具时，该工具在分派前被拦截，请求解析为 `{ kind: 'deny', reason }` 决策；模型收到拒绝而非工具结果，因此无法执行策略所禁止的调用。被允许的调用，模型看到正常工具结果。

#### Token 影响

拒绝回复是简短状态；模型只为实际分派的调用付出工具调用成本。本插件不添加任何提示文本。

#### KV Cache 影响

无。门与统计观察器绝不改写请求 token。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制是当前包约束。

- **工具分类是启发式**——按工具名做读/写 token 匹配；未知能力视为 write（fail closed），因此一个名称不常见的真正只读工具可能在只读范围被拒。
- **告警评分是启发式窗口**——评分分量（凭据参数、鉴权比例、失败率、突增、载荷、耗时）仅由单一告警阈值配置；没有逐服务器调优。
- **浏览器设置表面尚未迁移到当前 web-client 约定**——宿主门与 RPC 通道已就位，但设置页与外层 toast 是后续项。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

- `editServer`（旧实现的单一编辑端点）尚未移植；范围/规则经 `setScope` 修改，而服务器标识编辑已延期。

</details>
