# Host 指标

[English](host-metrics.md) | 中文

面向 Web 控制台的周期主机资源采样器。`packages/host/host-metrics` 插件按固定间隔读取 CPU 负载与内存占用，并将其作为转发的主机事件发出。它不拥有客户端 UI，也没有面向 agent 的工具面。

来源：[`packages/host/host-metrics/src/index.ts`](../../packages/host/host-metrics/src/index.ts)

## 事件

`host/metrics` 携带最新采样：CPU 平均负载、已用内存字节数与可选 GPU 负载。控制台工作台通过桥接监听这些事件，并在工具栏渲染资源条。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="host-events"></a>

### `host/*` events

<a id="hostmetrics--emit"></a>

#### `host/metrics` — emit

One sampled host resource snapshot, emitted on the configured interval.

```ts cordis-catalog
/**
 * One sampled host resource snapshot, emitted on the configured interval.
 * @param payload - the sampled CPU, memory, and best-effort GPU utilization.
 * @mode emit
 */
'host/metrics': (payload: HostMetrics) => void
```

Source: [`packages/host/host-metrics/src/types.ts`](../../packages/host/host-metrics/src/types.ts)
<!-- END GENERATED cordis-surface -->
