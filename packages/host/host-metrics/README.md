# @deepseek-ai/dsh-host-metrics

English | [中文](README.zh.md)

Periodic host resource sampler for the Web console. The plugin reads CPU load
and memory footprint on a fixed interval and emits the result as the forwarded
host event `host/metrics`, which the Web console's system-status panel renders
live. GPU is best-effort and reported as `null` until a platform adapter
supplies a reading.

It is a host-side plugin: it owns no client UI and emits no agent-facing event.
The `host/metrics` event is forwarded to every connected host stream through the
shared Remote BFF allowlist, so the browser console can subscribe without a
dedicated channel.

## Model Experience

None, as the sampler emits a host telemetry event consumed only by the browser console system-status panel, and the metric never enters the model context or session log.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- GPU utilization is always `null`: Node exposes no cross-platform GPU reading, and no adapter is wired yet. The console renders N/A for `null`.
- CPU is system-load-normalized by core count on platforms that report load average, falling back to this process's user+system delta elsewhere; it is a coarse best-effort number, not a per-core breakdown.
- Memory is the whole-host used/total ratio, not the harness process's own working set.
