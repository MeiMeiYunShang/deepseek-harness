# Host metrics

English | [中文](host-metrics.zh.md)

Periodic host resource sampler for the Web console. The `packages/host/host-metrics` plugin reads CPU load and memory use at a fixed interval and emits them as forwarded host events. It owns no client UI and no agent-facing tool surface.

Source: [`packages/host/host-metrics/src/index.ts`](../../packages/host/host-metrics/src/index.ts)

## Event

`host/metrics` carries the latest sample: CPU load average, memory bytes used, and optional GPU load. The console workbench listens to these events through the bridge and renders a resource strip in the toolbar.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
