/**
 * Host-metrics event vocabulary for Remote forwarding. The `host/metrics`
 * event is declared here — not in the plugin body — so the Client assembly
 * (`@deepseek-ai/dsh-api-remotes/client`) can re-export this subpath and the
 * forwarded-event allowlist sees the payload instead of a second signature.
 */

/** One sampled host resource snapshot; all values are 0–100 percent (gpu nullable). */
export interface HostMetrics {
  /** CPU utilization percent (system load per core on Unix; this process's user+sys delta otherwise). */
  cpu: number
  /** Memory utilization percent (used / total). */
  memory: number
  /** GPU utilization percent, or `null` when no adapter is available. */
  gpu: number | null
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
