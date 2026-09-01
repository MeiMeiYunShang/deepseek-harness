import type { ConsoleBridgeConfig, DownCmdEnvelope } from './types.ts'

/** Bidirectional transport between the bridge and the console. */
export interface ConsoleTransport {
  /** Open the underlying connection (MQTT connect / HTTP no-op). */
  connect(): Promise<void>
  /** Publish an uplink envelope to a topic. */
  publish(topic: string, payload: unknown): Promise<void>
  /** Subscribe to a downlink topic; the returned disposer stops delivery. */
  subscribe(topic: string, handler: (payload: DownCmdEnvelope) => void | Promise<void>): Promise<() => void>
  /** Close the connection. */
  dispose(): Promise<void>
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function withLeadingSlash(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

/** MQTT transport following the contract's topic envelope exactly. */
class MqttTransport implements ConsoleTransport {
  private client: import('mqtt').MqttClient | undefined

  constructor(
    private readonly config: ConsoleBridgeConfig,
    private readonly logger: { warn(message: string): void },
  ) {}

  /** The connected MQTT client, asserting the connect handshake already succeeded. */
  private get mqtt(): import('mqtt').MqttClient {
    if (this.client === undefined) throw new Error('mqtt transport not connected')
    return this.client
  }

  async connect(): Promise<void> {
    const mqtt = await import('mqtt')
    const opts: { username?: string; password?: string; reconnectPeriod?: number; connectTimeout?: number } = {}
    if (this.config.mqttUsername !== undefined) opts.username = this.config.mqttUsername
    if (this.config.mqttPassword !== undefined) opts.password = this.config.mqttPassword
    // Fail the connect instead of silently entering mqtt.js's indefinite
    // reconnect loop: a broker that rejects the credentials (or the connection)
    // would otherwise keep the promise pending with no log and no way to fall
    // back. The host reports `connect` failures via `start().catch`.
    opts.reconnectPeriod = 0
    opts.connectTimeout = 10_000
    this.client = mqtt.connect(this.config.brokerUrl ?? 'mqtt://127.0.0.1:1883', opts)
    // The promise settles on the first `connect`, `error`, or `close`; with
    // `reconnectPeriod: 0` the client performs no further connect attempt, so
    // whichever of the three fires first is final. A broker denial surfaces
    // either as `error` or a `close` right after the rejected CONNACK. A broker
    // that never answers at all is cut off by the MQTT connect timeout, which
    // mqtt.js reports through `error` as well.
    await new Promise<void>((resolve, reject) => {
      this.mqtt.on('connect', () => resolve())
      this.mqtt.on('error', (error: Error) => reject(error))
      // mqtt.js emits `close` on the live client (TypedEventEmitter's typed
      // overload omits it), so register it through the untyped emitter.
      ;(this.mqtt as unknown as NodeJS.EventEmitter).on('close', () =>
        reject(new Error('mqtt connection closed before CONNACK')))
    })
  }

  async publish(topic: string, payload: unknown): Promise<void> {
    if (this.client === undefined) throw new Error('mqtt transport not connected')
    await new Promise<void>((resolve, reject) => {
      this.mqtt.publish(topic, JSON.stringify(payload), { qos: 1 }, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  async subscribe(
    topic: string,
    handler: (payload: DownCmdEnvelope) => void | Promise<void>,
  ): Promise<() => void> {
    if (this.client === undefined) throw new Error('mqtt transport not connected')
    await new Promise<void>((resolve, reject) => {
      this.mqtt.subscribe(topic, { qos: 1 }, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
    this.mqtt.on('message', (t: string, message: Buffer) => {
      if (t !== topic) return
      void Promise.resolve(handler(JSON.parse(message.toString()) as DownCmdEnvelope)).catch((error: unknown) => {
        this.logger.warn(`console-bridge: down/cmd handler failed: ${String(error)}`)
      })
    })
    return () => {
      try {
        this.client?.unsubscribe(topic)
      } catch {
        /* best-effort */
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.client === undefined) return
    await new Promise<void>(resolve => this.mqtt.end(true, () => resolve()))
  }
}

/**
 * HTTP polling transport for environments without an MQTT broker. Uplink
 * publishes via `POST {base}{topic}`; downlink polls `GET {base}{topic}?after={n}`
 * and treats each returned item as a `down/cmd` envelope.
 */
class HttpTransport implements ConsoleTransport {
  private cursor = 0
  private stopped = false

  constructor(
    private readonly config: ConsoleBridgeConfig,
    private readonly logger: { warn(message: string): void },
  ) {}

  /** Build request headers, attaching the console bearer token when configured. */
  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (this.config.token !== undefined && this.config.token.length > 0) {
      headers['authorization'] = `Bearer ${this.config.token}`
    }
    return headers
  }

  async connect(): Promise<void> {
    /* HTTP needs no connection handshake. */
  }

  async publish(topic: string, payload: unknown): Promise<void> {
    const base = this.config.consoleBaseUrl ?? 'http://127.0.0.1:8080'
    const url = `${base}${withLeadingSlash(topic)}`
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(`console-bridge: uplink POST ${url} failed (${res.status})`)
  }

  async subscribe(
    topic: string,
    handler: (payload: DownCmdEnvelope) => void | Promise<void>,
  ): Promise<() => void> {
    const base = this.config.consoleBaseUrl ?? 'http://127.0.0.1:8080'
    const url = `${base}${withLeadingSlash(topic)}`
    void (async () => {
      while (!this.stopped) {
        try {
          const res = await fetch(`${url}?after=${this.cursor}`, { method: 'GET', headers: this.headers() })
          if (res.ok) {
            const body = await res.json() as { items?: DownCmdEnvelope[] }
            for (const item of body.items ?? []) {
              this.cursor += 1
              try {
                await handler(item)
              } catch (error: unknown) {
                this.logger.warn(`console-bridge: down/cmd handler failed: ${String(error)}`)
              }
            }
          }
        } catch (error: unknown) {
          this.logger.warn(`console-bridge: down/cmd poll failed: ${String(error)}`)
        }
        await delay(this.config.pollIntervalMs ?? 2000)
      }
    })()
    return () => {
      this.stopped = true
    }
  }

  async dispose(): Promise<void> {
    this.stopped = true
  }
}

/**
 * Build the configured transport.
 * @param config - console bridge configuration selecting the transport kind.
 * @param logger - sink for transport warnings (e.g. missing broker packages).
 * @returns the configured transport (HTTP or MQTT).
 */
export function createTransport(
  config: ConsoleBridgeConfig,
  logger: { warn(message: string): void },
): ConsoleTransport {
  if (config.transport === 'http') return new HttpTransport(config, logger)
  return new MqttTransport(config, logger)
}
