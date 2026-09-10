# Agent Note: Mount dedicated Connection RPC channels from the Connection service

Status: implemented

[English](2026-09-11-connection-channel-carrier-neutral-mount.md) | 中文

## Problem

`ctx.connection.rpc.handle(channel, handler)` 通过调用方上下文挂载其物理 HTTP 路由：`register` 执行 `owner.effect(() => owner.webServer.register(route))`，其中 `owner` 是读取 `ctx.connection` 的上下文。仅当调用方 fiber 的 `inject` 声明了 `webServer`，或某个祖先 fiber 的 store 中存在 `webServer` 时，Cordis 才能解析 `ctx.webServer`。像 `mcpsec-manager` 这样只注入 `connection`、`loader` 与 `tools` 的兄弟调用方，在 profile 启动时以 `cannot get property "webServer" without inject` 失败。因此专用通道路径与包的载体中立 RPC 注册表相矛盾，也与 [Electron 桌面打包说明](../architecture/2026-08-25-electron-desktop-packaging-and-updates.zh.md)中 Connection 无需 `webServer` 即可提供其注册表的声明相矛盾。host spec 未能发现该问题，因为它的假 `connection` 服务用 spy 替换了 `rpc.handle`。

## Decision

`HostConnectionService` 拥有专用通道注册表与 Web 载体。`rpc.handle` 在调用方 effect 下记录每个通道路由；`bindWebServer(webServer)` 在 Web 载体挂载时挂载每个已注册通道，并挂载此后注册的通道；在解绑时卸载物理路由但保留逻辑注册。Connection 插件在其既有的 `ctx.inject(['webServer'], ...)` 作用域内、与 `/api` 挂载并列调用 `bindWebServer`。调用方现在只需 `connection`。

重复检测移入服务（`connection: duplicate route for RPC channel "<channel>"`），因此保持同步，且与是否挂载了载体无关。从不提供 `webServer` 的载体中立组合会保留逻辑通道注册而不产生物理路由。

## Alternatives considered

**将 `webServer` 加入 `mcpsec-manager` 的 `inject`。** 未采用：这会让每个专用通道调用方都了解 Connection 的传输依赖，并且在缺少 `webServer` 的 shell 自有载体下，调用方 fiber 会永远停留在 PENDING。

**保留 `owner.webServer` 并记录注入要求。** 未采用，理由同样是这种隐藏耦合。Connection 已拥有挂载 `/api` 的 `webServer` 注入作用域；物理路由是 Connection 的职责，而非调用方的职责。

## Consequences

专用通道遵循与精确 Fetch 注册表相同的载体中立模型：后者将路由存储在服务中，并由 Connection 自有的 `/api` 处理器分派。Web 组合负责附加物理路由；从不提供 `webServer` 的 shell 自有载体保留逻辑注册。

[connection host spec](../../../../packages/client/connection/tests/node-half.host.spec.ts) 新增了一个回归用例：由一个兄弟插件提供 `webServer`，并由一个作用域内没有 `webServer` 的调用方注册通道。
