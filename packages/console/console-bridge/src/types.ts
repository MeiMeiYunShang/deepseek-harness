/** Plugin configuration for the console bridge. */
export interface ConsoleBridgeConfig {
  /** This DSH terminal's agent id reported to the console (e.g. `local-dsh-native-01`). */
  agentId?: string
  /**
   * Uplink/downlink transport. `mqtt` follows the contract exactly (topics
   * `v1/agent/{id}/down/cmd`, `.../up/cmd/ack`, `.../up/result`). `http` polls a
   * console REST surface when no MQTT broker is available.
   */
  transport: 'mqtt' | 'http'
  /** MQTT broker URL (e.g. `mqtt://127.0.0.1:1883`); required when `transport: 'mqtt'`. */
  brokerUrl?: string
  /** Console base URL for the `http` transport (e.g. `http://controlplane:8080`). */
  consoleBaseUrl?: string
  /** Console auth token; sent as `Authorization: Bearer <token>` on HTTP uplink/downlink. */
  token?: string
  mqttUsername?: string
  mqttPassword?: string
  /** Provider route for created agents. */
  provider?: string
  /** Model name for created agents. */
  model?: string
  /** Working directory for created sessions. */
  cwd?: string
  /** Default task timeout in seconds (1..600); a `down/cmd` may override per command. */
  execTimeoutS?: number
  /** HTTP polling interval in milliseconds for the `http` transport. */
  pollIntervalMs?: number
  /** Heartbeat period in milliseconds (1000..60000; default 5000) publishing `up/status`. */
  statusIntervalMs?: number
  /** Subscribe to console commands on boot. */
  autoStart?: boolean
  /**
   * User-facing bridge switch surfaced in the Web settings UI. The cordis
   * `autoStart` value seeds the default; a user toggle in the settings document
   * overrides it. The host reads the effective value to decide whether to
   * subscribe on boot.
   */
  enabled?: boolean
}

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
