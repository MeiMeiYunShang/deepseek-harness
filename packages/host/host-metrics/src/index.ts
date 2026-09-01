/**
 * @deepseek-ai/dsh-host-metrics — periodic host resource sampler.
 *
 * Samples CPU load and memory footprint on a fixed interval and emits the
 * result as a forwarded host event (`host/metrics`) that the Web console
 * system-status panel renders. GPU is best-effort: Node exposes no
 * cross-platform GPU reading, so the sampler reports `null` until a platform
 * adapter supplies a value — the console shows N/A for `null`.
 * @module @deepseek-ai/dsh-host-metrics
 */

import { cpus, loadavg, totalmem, freemem } from 'node:os'
import { cpuUsage } from 'node:process'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** One sampled host resource snapshot; all values are 0–100 percent (gpu nullable). */
export interface HostMetrics {
  /** CPU utilization percent. System load normalized by core count on Unix; this process's user+sys delta otherwise. */
  cpu: number
  /** Memory utilization percent (used / total). */
  memory: number
  /** GPU utilization percent, or `null` when no adapter is available. */
  gpu: number | null
}

/** Stable Cordis plugin name. */
export const name = 'host-metrics'

/** No host service is required before sampling; the plugin only emits. */
export const inject: string[] = []

/** Plugin config: the sampling cadence. */
export interface Config {
  /** Milliseconds between samples. */
  intervalMs: number
}

export const Config: z<Config> = z.object({
  intervalMs: z.number().default(2000),
})

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/**
 * Compute CPU utilization percent from two process-cpu snapshots.
 * @param last - previous `process.cpuUsage()` reading.
 * @param lastTime - previous sample epoch milliseconds.
 * @param now - current `process.cpuUsage()` reading.
 * @param nowTime - current sample epoch milliseconds.
 * @returns utilization percent in [0, 100].
 */
export function sampleCpu(
  last: { user: number; system: number },
  lastTime: number,
  now: { user: number; system: number },
  nowTime: number,
): number {
  const load = loadavg()[0] ?? 0
  const cores = cpus().length || 1
  if (load > 0) return clamp((load / cores) * 100, 0, 100)
  const elapsedUs = (nowTime - lastTime) * 1000
  if (elapsedUs <= 0) return 0
  const usedUs = (now.user - last.user) + (now.system - last.system)
  return clamp((usedUs / elapsedUs) * 100, 0, 100)
}

/**
 * Compute memory utilization percent from total and free memory.
 * @returns utilization percent in [0, 100], or 0 when total memory is non-positive.
 */
export function sampleMemory(): number {
  const total = totalmem()
  if (total <= 0) return 0
  return clamp(((total - freemem()) / total) * 100, 0, 100)
}

/**
 * Sample host resources and emit `host/metrics` on a fixed interval.
 * @param ctx - plugin context carrying the event emitter.
 * @param config - validated {@link Config}.
 * @returns void; the interval is cleared by the registered effect disposer on fiber disposal.
 */
export function apply(ctx: Context, config: Config): void {
  let last = cpuUsage()
  let lastTime = Date.now()
  const timer = setInterval(() => {
    const now = cpuUsage()
    const nowTime = Date.now()
    const payload: HostMetrics = {
      cpu: sampleCpu(last, lastTime, now, nowTime),
      memory: sampleMemory(),
      gpu: null,
    }
    last = now
    lastTime = nowTime
    ctx.emit('host/metrics', payload)
  }, config.intervalMs)
  ctx.effect(() => () => clearInterval(timer), 'host-metrics: sampler')
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * One sampled host resource snapshot, emitted on the configured interval.
     * @param payload - the sampled CPU, memory, and best-effort GPU utilization.
     * @mode emit
     */
    'host/metrics': (payload: HostMetrics) => void
  }
}
