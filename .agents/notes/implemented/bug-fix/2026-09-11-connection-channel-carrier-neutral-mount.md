# Agent Note: Mount dedicated Connection RPC channels from the Connection service

Status: implemented

English | [中文](2026-09-11-connection-channel-carrier-neutral-mount.zh.md)

## Problem

`ctx.connection.rpc.handle(channel, handler)` mounted its physical HTTP route through the caller's context: `register` ran `owner.effect(() => owner.webServer.register(route))`, where `owner` is the context that read `ctx.connection`. Cordis resolves `ctx.webServer` only when `webServer` is declared in the caller fiber's `inject` or present in an ancestor fiber's store. A sibling caller such as `mcpsec-manager`, which injects `connection`, `loader`, and `tools` but not `webServer`, failed profile boot with `cannot get property "webServer" without inject`. The dedicated-channel path therefore contradicted the package's carrier-neutral RPC registry and the claim in the [Electron desktop packaging note](../architecture/2026-08-25-electron-desktop-packaging-and-updates.md) that Connection provides its registries without requiring `webServer`. The host spec missed it because its fake `connection` service replaced `rpc.handle` with a spy.

## Decision

`HostConnectionService` owns the dedicated-channel registry and the Web carrier. `rpc.handle` records each channel route under the caller's effect; `bindWebServer(webServer)` mounts every registered channel when a Web carrier attaches, mounts channels registered later, and on detach unmounts the physical routes while keeping the logical registrations. The connection plugin calls `bindWebServer` inside its existing `ctx.inject(['webServer'], ...)` scope, beside the `/api` mount. A caller now needs only `connection`.

Duplicate detection moved into the service (`connection: duplicate route for RPC channel "<channel>"`), so it stays synchronous and independent of whether a carrier is attached. A carrier-neutral composition that never provides `webServer` keeps the logical channel registrations with no physical route.

## Alternatives considered

**Add `webServer` to `mcpsec-manager`'s `inject`.** Rejected: it makes every dedicated-channel caller know Connection's transport dependency, and a shell-owned carrier without `webServer` would leave the caller fiber PENDING forever.

**Keep `owner.webServer` and document the inject requirement.** Rejected for the same hidden coupling. Connection already owns the `webServer` inject scope that mounts `/api`; the physical route is Connection's concern, not the caller's.

## Consequences

Dedicated channels follow the same carrier-neutral model as the exact Fetch registry, which stores routes in the service and lets the Connection-owned `/api` handler dispatch them. Web compositions attach the physical routes; shell-owned carriers that never provide `webServer` keep the logical registrations.

The [connection host spec](../../../../packages/client/connection/tests/node-half.host.spec.ts) adds a regression case that provides `webServer` from a sibling plugin and registers a channel from a caller without `webServer` in scope.
