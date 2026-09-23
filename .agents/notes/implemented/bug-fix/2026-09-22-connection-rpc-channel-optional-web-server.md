# Agent Note: Serve dedicated RPC channels from the optional Web server

Status: implemented

English | [中文](2026-09-22-connection-rpc-channel-optional-web-server.zh.md)

## Problem

`HostConnectionService.register()` mounted a dedicated channel with `owner.webServer.register(route)`, reading `webServer` through the Cordis property proxy. That proxy resolves a service only when the reading fiber declares it in `inject`, and `@deepseek-ai/dsh-client-connection` deliberately no longer declares it: the plugin provides its carrier-neutral RPC and Fetch registries without a Web server and attaches its own HTTP routes through an inner `ctx.inject(['webServer'], …)`, the decision the [desktop packaging Agent Note](../architecture/2026-08-25-electron-desktop-packaging-and-updates.md) records. Every `rpc.handle()` call therefore failed while its caller was applying, with `cannot get property "webServer" without inject`. In the Web profile the failure surfaced as `@deepseek-ai/dsh-mcpsec-manager` failing to load, and the Loader's fail-loud boot turned that one row into a stopped process.

## Decision

`register()` reads the optional service per registration — `this.ctx.get('webServer')` inside the caller-owned effect — and mounts the route on the value that read returns. A composition with no mounted Web server fails that registration loudly with `connection: RPC channel "<channel>" needs a mounted webServer`, naming both the channel and the missing service. Channel lifetime is unchanged: the route is still registered inside `owner.effect(...)`, so it disappears with the registering fiber and with the disposer `handle()` returns. The read is the opportunistic-consumption pattern the [approval seam Agent Note](../feature/2026-07-06-approval-seam.md) established, and its strict form returns a provider only while the providing fiber is active — which is what keeps a channel off a Web server that is unloading.

## Alternatives considered

**Declare `webServer` in the plugin's `inject`.** This is the state the package had before the carrier-neutral change, and it makes the proxy read legal with no other edit. It loses because a declared `inject` gates the fiber: in a shell-owned carrier with no Web server, `connection` would park instead of providing, and consumers that need only the RPC and Fetch registries would never see `ctx.connection`.

**Mount the route through a `ctx.inject(['webServer'], …)` derived context.** This also makes the read legal, and it re-mounts the route automatically when the service is replaced. It loses because `ctx.inject` activates its callback on a microtask — `Fiber._reload()` opens with `await Promise.resolve()` — so `handle()` would return before its route exists and could no longer report a duplicate synchronously. Callers register a channel and immediately rely on the route being live, and [the focused spec](../../../../packages/client/connection/tests/node-half.host.spec.ts) pins both the immediate registration and the synchronous duplicate throw.

**Require the caller to inject `webServer` and register through its own context.** The route's registration is part of this service's contract, and the current consumers of `rpc.handle` are Web-only feature packages that hold no Web-server dependency of their own. Requiring one would spread a Web-carrier assumption into every channel owner and still leave `register()` unable to describe what it needs.

## Consequences

Dedicated channels register synchronously again, and a duplicate channel still surfaces the Web server's own `duplicate route` error through `handle()`. A composition with no Web carrier keeps loading the plugin and keeps its registries usable; only a caller asking for a served channel fails, and it fails with the missing service named rather than a proxy error. A Web server mounted after a channel was registered is not picked up — that channel would need re-registration — which no current composition does, because the Web server is a host row that mounts before its consumers activate. [The focused spec](../../../../packages/client/connection/tests/node-half.host.spec.ts) covers a served dedicated channel and the refusal with no Web carrier mounted.
