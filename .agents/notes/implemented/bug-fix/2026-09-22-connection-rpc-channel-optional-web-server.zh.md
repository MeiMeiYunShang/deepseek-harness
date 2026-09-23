# Agent Note: 由可选的 Web server 提供专用 RPC channel

Status: implemented

[English](2026-09-22-connection-rpc-channel-optional-web-server.md) | 中文

## Problem

`HostConnectionService.register()` 用 `owner.webServer.register(route)` 挂载专用 channel，经 Cordis property proxy 读取 `webServer`。该 proxy 只在读取方 fiber 于 `inject` 中声明该服务时才解析它，而 `@deepseek-ai/dsh-client-connection` 刻意不再声明：该插件在没有 Web server 的情况下提供与载体无关的 RPC 与 Fetch 注册表，并通过内层 `ctx.inject(['webServer'], …)` 挂载自身的 HTTP 路由——这正是[桌面打包 Agent Note](../architecture/2026-08-25-electron-desktop-packaging-and-updates.zh.md)记录的决策。因此每次 `rpc.handle()` 调用都在其调用方 apply 期间失败，报 `cannot get property "webServer" without inject`。在 Web 组合中，该失败表现为 `@deepseek-ai/dsh-mcpsec-manager` 加载失败，而 Loader 的 fail-loud 启动把这一行放大为整个进程停摆。

## Decision

`register()` 在每次注册时读取该可选服务——在调用方持有的 effect 内执行 `this.ctx.get('webServer')`——并把路由挂到该读取返回的值上。没有挂载 Web server 的组合会让这次注册明确失败，报 `connection: RPC channel "<channel>" needs a mounted webServer`，同时点出 channel 与缺失的服务。channel 生命周期不变：路由仍注册于 `owner.effect(...)` 内，因此随注册方 fiber 以及 `handle()` 返回的 disposer 一同消失。该读取是[审批 seam Agent Note](../feature/2026-07-06-approval-seam.zh.md)确立的机会性消费模式，其严格形式只在提供方 fiber 处于活跃状态时返回服务——这正是让 channel 不会留在正在卸载的 Web server 上的原因。

## Alternatives considered

**在插件的 `inject` 中声明 `webServer`。** 这是该包在载体无关改动之前的状态，且无需其他改动即可让 proxy 读取合法。否决原因：声明的 `inject` 会阻塞 fiber——在没有 Web server 的 shell-owned 载体中，`connection` 会一直待定而不 provide，只需要 RPC 与 Fetch 注册表的消费方将永远看不到 `ctx.connection`。

**通过 `ctx.inject(['webServer'], …)` 派生 ctx 挂载路由。** 这同样让读取合法，并且会在服务被替换时自动重新挂载路由。否决原因：`ctx.inject` 的回调在微任务上激活——`Fiber._reload()` 以 `await Promise.resolve()` 开头——于是 `handle()` 会在路由存在之前返回，也不再能同步报告重复注册。调用方注册 channel 后会立即依赖路由生效，而[聚焦测试](../../../../packages/client/connection/tests/node-half.host.spec.ts)同时钉住了「立即注册」与「重复即同步抛错」。

**要求调用方注入 `webServer` 并经由自己的 ctx 注册。** 路由注册是本服务契约的一部分，而 `rpc.handle` 当前的消费方都是 Web-only 功能包，自身并不持有 Web server 依赖。强加该依赖会把 Web 载体假设扩散到每个 channel owner，而且 `register()` 仍无法描述它需要什么。

## Consequences

专用 channel 恢复同步注册，重复 channel 依旧经 `handle()` 暴露 Web server 自身的 `duplicate route` 错误。没有 Web 载体的组合继续正常加载该插件并保持其注册表可用；只有要求提供 channel 的调用方才失败，且失败信息点明缺失的服务而非 proxy 错误。在 channel 注册之后才挂载的 Web server 不会被接上——该 channel 需要重新注册——当前没有任何组合这样做，因为 Web server 是一个在消费方激活之前就挂载的 host 行。[聚焦测试](../../../../packages/client/connection/tests/node-half.host.spec.ts)覆盖了可服务的专用 channel 与无 Web 载体时的拒绝。
