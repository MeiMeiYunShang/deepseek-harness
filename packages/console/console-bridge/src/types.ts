import type { Volatile } from '@deepseek-ai/cordis'

/** Plugin configuration for the console bridge; every editable field is a live reference. */
export interface ConsoleBridgeConfig {
  /** This DSH terminal's agent id reported to the console (e.g. `local-dsh-native-01`). */
  agentId: Volatile<string | undefined>
  /**
   * Uplink/downlink transport. `mqtt` follows the contract exactly (topics
   * `v1/agent/{id}/down/cmd`, `.../up/cmd/ack`, `.../up/result`). `http` polls a
   * console REST surface when no MQTT broker is available.
   */
  transport: Volatile<'mqtt' | 'http'>
  /** MQTT broker URL (e.g. `mqtt://127.0.0.1:1883`); required when `transport: 'mqtt'`. */
  brokerUrl: Volatile<string | undefined>
  /** Console base URL for the `http` transport (e.g. `http://controlplane:8080`). */
  consoleBaseUrl: Volatile<string | undefined>
  /** Console auth token; sent as `Authorization: Bearer <token>` on HTTP uplink/downlink. */
  token: Volatile<string | undefined>
  /** MQTT broker username; used only with the `mqtt` transport. */
  mqttUsername: Volatile<string | undefined>
  /** MQTT broker password; used only with the `mqtt` transport. */
  mqttPassword: Volatile<string | undefined>
  /** Provider route for created agents. */
  provider: Volatile<string | undefined>
  /** Model name for created agents. */
  model: Volatile<string | undefined>
  /** Working directory for created sessions. */
  cwd: Volatile<string | undefined>
  /** Default task timeout in seconds (1..600); a `down/cmd` may override per command. */
  execTimeoutS: Volatile<number>
  /** HTTP polling interval in milliseconds for the `http` transport. */
  pollIntervalMs: Volatile<number>
  /** Heartbeat period in milliseconds (1000..60000; default 5000) publishing `up/status`. */
  statusIntervalMs: Volatile<number>
  /** Subscribe to console commands on boot. */
  autoStart: Volatile<boolean>
  /**
   * User-facing bridge switch surfaced in the Web settings UI. The cordis
   * `autoStart` value seeds the default; a user toggle in the settings document
   * overrides it. The host reads the effective value to decide whether to
   * subscribe on boot.
   */
  enabled: Volatile<boolean>
  /** The operator's recorded price table; absent until an operator saves one. */
  models: Volatile<readonly ConsolePricingRow[] | undefined>
  /**
   * The daily off-peak window, which is what splits each route's tokens into
   * price bands. Absent means every hour is charged at the peak price.
   */
  offPeak: Volatile<ConsolePricingOffPeak>
}

/** One price band's rates, in currency units per million tokens. */
export interface ConsolePricingBandPrice {
  /** Price of one million cache-read (cache-hit) input tokens. */
  readonly cacheHit: number
  /**
   * Price of one million uncached input tokens, and of one million cache-write
   * input tokens: a cache write is charged at the miss rate.
   */
  readonly cacheMiss: number
  /** Price of one million output tokens. */
  readonly output: number
}

/**
 * One model route's price, in currency units per million tokens.
 *
 * A route is keyed by `(baseUrl, provider, model)`: the same model reached
 * through two endpoints is two routes at two prices, and the accounting matches
 * reported tokens on the route the provider actually served.
 */
export interface ConsolePricingRow {
  /** Endpoint the route is reached through. */
  readonly baseUrl: string
  /** Provider id of the route, exactly as the model catalog spells it. */
  readonly provider: string
  /** Model id of the route, exactly as the model catalog spells it. */
  readonly model: string
  /** Rates charged for the tokens served inside the peak band. */
  readonly peak: ConsolePricingBandPrice
  /** Rates charged for the tokens served inside the off-peak window. */
  readonly offPeak: ConsolePricingBandPrice
}

/**
 * The daily off-peak window: `[start, end)` as local wall-clock times in one
 * IANA zone, wrapping past midnight when `end` is not later than `start`.
 */
export interface ConsolePricingOffPeak {
  /** Window start, `HH:MM` local to `timezone`; the window includes this minute. */
  start: string
  /** Window end, `HH:MM` local to `timezone`; the window excludes this minute. */
  end: string
  /** IANA zone the two wall-clock times are local to. */
  timezone: string
}

/** The ordinary value one live config reference currently holds. */
type Resolved<T> = T extends Volatile<infer U> ? U : never

/** Every console-bridge config field as the ordinary value read from its live reference. */
export type PlainResolvedConfig = { [K in keyof ConsoleBridgeConfig]: Resolved<ConsoleBridgeConfig[K]> }

/** `down/cmd` envelope published by the console to `v1/agent/{id}/down/cmd`. */
export interface DownCmdEnvelope {
  id: string
  seq: number
  ts: number
  agentId: string
  type: 'cmd'
  payload: {
    cmdId: string
    command: string
    execTimeoutS: number
    riskLevel: string
    priority: string
  }
}

/** `up/cmd/ack` payload (ARRIVED / EXECUTING only; terminal states come from `up/result`). */
export interface UpCmdAckPayload {
  cmdId: string
  status: 'ARRIVED' | 'EXECUTING'
}

/** `up/result` payload reported on terminal success/failure. */
export interface UpResultPayload {
  taskId: string
  cmdId: string
  exitCode: number
  summary: string
  logUri: string
  durationMs: number
}

/** `up/status` heartbeat payload marking this terminal online to the console. */
export interface UpStatusPayload {
  status: 'online'
  /** Best-effort CPU percent; 0 when the host reports none. */
  cpuPercent: number
  /** Best-effort memory percent; 0 when the host reports none. */
  memPercent: number
}

/** Inputs the Web settings card sends to probe a console connection. */
export interface ConsoleBridgeTestRequest {
  /** This terminal identity reported to the console. */
  agentId: string
  /** Uplink/downlink transport to probe. */
  transport: 'mqtt' | 'http'
  /** MQTT broker URL; required when `transport: 'mqtt'`. */
  brokerUrl?: string
  /** MQTT broker login; sent when the broker requires authentication. */
  mqttUsername?: string
  /** MQTT broker password; sent when the broker requires authentication. */
  mqttPassword?: string
  /** Console REST base URL; required when `transport: 'http'`. */
  consoleBaseUrl?: string
  /** Console auth token; sent as `Authorization: Bearer <token>` on HTTP. */
  token?: string
}

/** Result of a console connection probe. */
export interface ConsoleBridgeTestResult {
  /** Whether the probe reached the console. */
  ok: boolean
  /** Human-readable detail: the status for HTTP, or the transport error. */
  message: string
}
