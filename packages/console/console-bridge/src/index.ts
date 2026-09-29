/**
 * Bridge DeepSeek Harness tasks to an external agent console over the
 * "DSH 接入控制台" contract: accept `down/cmd` commands from the console, run
 * each as a DSH session, and report `up/cmd/ack` (ARRIVED → EXECUTING) plus a
 * terminal `up/result` back. The console owns dispatch, status, and result
 * storage; this plugin owns only the DSH execution and the protocol envelope.
 *
 * @module @deepseek-ai/dsh-console-bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'

import {
  type ConsoleBridgeConfig,
  type DownCmdEnvelope,
  type UpCmdAckPayload,
  type UpResultPayload,
  type UpStatusPayload,
} from './types.ts'
import { createTransport, type ConsoleTransport } from './transport.ts'
import { runDshTask } from './runner.ts'
import ConsoleBridgeRemote from './remote.ts'

export const name = 'console-bridge'
/** The bridge creates and owns agents and registers the console's settings namespaces. */
export const inject = ['agents', 'settings']

/** User-editable console-connection settings, surfaced as a settings tab. */
export interface ConsoleBridgeSettings {
  /** This terminal's identity reported to the console; empty until the operator sets it in the card. */
  agentId?: string
  transport: 'mqtt' | 'http'
  brokerUrl?: string
  consoleBaseUrl?: string
  /** Console auth token; stored/rendered as a secret. */
  token?: string
  /** MQTT broker login (mqtt transport). */
  mqttUsername?: string
  /** MQTT broker password (mqtt transport); stored/rendered as a secret. */
  mqttPassword?: string
  /** Whether the bridge subscribes to console commands after a settings restart. */
  enabled: boolean
}

/** One price band's rates, in currency units per million tokens. */
export interface ConsolePricingBandPrice {
  /** Price of one million cache-read (cache-hit) input tokens. */
  cacheHit: number
  /**
   * Price of one million uncached input tokens, and of one million cache-write
   * input tokens: a cache write is charged at the miss rate.
   */
  cacheMiss: number
  /** Price of one million output tokens. */
  output: number
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
  baseUrl: string
  /** Provider id of the route, exactly as the model catalog spells it. */
  provider: string
  /** Model id of the route, exactly as the model catalog spells it. */
  model: string
  /** Rates charged for the tokens served inside the peak band. */
  peak: ConsolePricingBandPrice
  /** Rates charged for the tokens served inside the off-peak window. */
  offPeak: ConsolePricingBandPrice
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

/** The operator's price table, as stored in the `console-pricing` settings namespace. */
export interface ConsolePricingSettings {
  /** The recorded price table; absent until an operator saves one. */
  models?: ConsolePricingRow[]
  /**
   * The daily off-peak window, which is what splits each route's tokens into
   * price bands. Absent means every hour is charged at the peak price.
   */
  offPeak?: ConsolePricingOffPeak
}

/**
 * Schema for the `console-pricing` settings namespace: the price table the
 * console cost view charges each `(baseUrl, provider, model)` route against. An
 * absent `models` and an empty one both mean "no prices recorded" and are valid
 * — a route with no row is reported as unpriced, which is not the same fact as
 * a free model. An absent `offPeak` is likewise valid and means "peak only".
 */
export const ConsolePricingSettingsSchema = z.object({
  models: z.array(z.object({
    baseUrl: z.string().required(),
    provider: z.string().required(),
    model: z.string().required(),
    peak: z.object({
      cacheHit: z.number().min(0).required(),
      cacheMiss: z.number().min(0).required(),
      output: z.number().min(0).required(),
    }),
    offPeak: z.object({
      cacheHit: z.number().min(0).required(),
      cacheMiss: z.number().min(0).required(),
      output: z.number().min(0).required(),
    }),
  })).required(false),
  // An object schema resolves an absent value from its own `{}` default, which
  // would then demand every field from a window the operator never declared.
  // Absent has to stay absent — it means "peak only", not "an unreadable
  // window" — and schemastery types `default` as the declared object type, so
  // the one value that is not one takes the cast.
  offPeak: z.object({
    start: z.string().required(),
    end: z.string().required(),
    timezone: z.string().required(),
  }).default(undefined as unknown as ConsolePricingOffPeak),
})

/** `HH:MM` on a 24-hour clock, 00:00 through 23:59. */
const OFF_PEAK_TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/

/**
 * Whether `Intl` resolves a value as a time zone. The zone database is the
 * runtime's, so this asks it rather than carrying a list of names that would
 * drift from the zones the fold can actually resolve.
 * @param timezone - the declared zone name.
 * @returns whether the runtime accepts the name.
 */
function isResolvableTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    // An unresolvable zone is the only failure here: the options object is a
    // literal, so nothing else in this statement can throw.
    return false
  }
}

/** The two bands every price row carries, in the order the check reports them. */
const PRICE_BANDS = ['peak', 'offPeak'] as const

/** The three rates every band carries, in the order the check reports them. */
const PRICE_RATES = ['cacheHit', 'cacheMiss', 'output'] as const

/**
 * Reject a price section no charge could be computed from.
 *
 * A schemastery range check compares a value against `min`/`max`, which a
 * non-finite value slips past: `NaN` is neither less nor greater than any
 * bound, and `Infinity` never exceeds its own. The settings service already
 * refuses non-finite numbers on its write path, but an operator editing the
 * settings document by hand can still store one, and an infinite or `NaN`
 * charge would otherwise reach the cost view silently.
 *
 * The off-peak window is checked here for the same reason: its two times are
 * wall-clock strings and its zone is resolved by the runtime, so neither is
 * expressible in the schema, and a window the fold cannot read would silently
 * charge every token at the peak price.
 * @param value - the resolved `console-pricing` section.
 * @throws {TypeError} when a row carries a non-finite rate, or the off-peak window is not a usable `HH:MM` time and IANA zone.
 */
export function validateConsolePricing(value: ConsolePricingSettings): void {
  for (const [index, row] of (value.models ?? []).entries()) {
    for (const band of PRICE_BANDS) {
      for (const rate of PRICE_RATES) {
        if (!Number.isFinite(row[band][rate])) {
          throw new TypeError(`console-pricing: models[${index}].${band}.${rate} is not a finite number`)
        }
      }
    }
  }
  const offPeak = value.offPeak
  if (offPeak === undefined) return
  if (!OFF_PEAK_TIME.test(offPeak.start)) {
    throw new TypeError(`console-pricing: offPeak.start is not an HH:MM time: ${JSON.stringify(offPeak.start)}`)
  }
  if (!OFF_PEAK_TIME.test(offPeak.end)) {
    throw new TypeError(`console-pricing: offPeak.end is not an HH:MM time: ${JSON.stringify(offPeak.end)}`)
  }
  if (!isResolvableTimeZone(offPeak.timezone)) {
    throw new TypeError(`console-pricing: offPeak.timezone is not an IANA time zone: ${JSON.stringify(offPeak.timezone)}`)
  }
}

/** Schema for the `console-bridge` settings namespace rendered in the config UI. */
export const ConsoleBridgeSettingsSchema = z.object({
  agentId: z.string().required(false),
  transport: z.union(['mqtt', 'http']).default('mqtt'),
  brokerUrl: z.string().required(false),
  consoleBaseUrl: z.string().required(false),
  token: z.string().role('secret').required(false),
  mqttUsername: z.string().required(false),
  mqttPassword: z.string().role('secret').required(false),
  enabled: z.boolean().default(false),
})

/** Plugin config: console identity, transport, and per-task agent/model selection. */
export const Config: z<ConsoleBridgeConfig> = z.object({
  agentId: z.string(),
  transport: z.union(['mqtt', 'http']).default('mqtt'),
  brokerUrl: z.string().required(false),
  consoleBaseUrl: z.string().required(false),
  token: z.string().role('secret').required(false),
  mqttUsername: z.string().required(false),
  mqttPassword: z.string().role('secret').required(false),
  provider: z.string().required(false),
  model: z.string().required(false),
  cwd: z.string().required(false),
  execTimeoutS: z.number().default(10),
  pollIntervalMs: z.number().default(2000),
  statusIntervalMs: z.number().default(5000),
  autoStart: z.boolean().default(true),
  enabled: z.boolean().default(false),
})

/** Cordis config as the settings `base` layer, so the UI overrides only what it sets. */
function settingsBase(config: ConsoleBridgeConfig): Partial<ConsoleBridgeSettings> {
  const base: Partial<ConsoleBridgeSettings> = {
    transport: config.transport,
    enabled: config.enabled ?? config.autoStart ?? false,
  }
  if (config.agentId) base.agentId = config.agentId
  if (config.brokerUrl) base.brokerUrl = config.brokerUrl
  if (config.consoleBaseUrl) base.consoleBaseUrl = config.consoleBaseUrl
  if (config.token) base.token = config.token
  if (config.mqttUsername) base.mqttUsername = config.mqttUsername
  if (config.mqttPassword) base.mqttPassword = config.mqttPassword
  return base
}

/**
 * Merge the settings document over cordis config, treating empty strings as unset.
 * @param config - cordis composition config, the settings `base` layer.
 * @param doc - the stored `console-bridge` settings document the operator edited.
 * @returns the effective config to run the bridge with.
 */
export function effectiveConfig(config: ConsoleBridgeConfig, doc: ConsoleBridgeSettings): ConsoleBridgeConfig {
  return {
    ...config,
    ...(doc.agentId ? { agentId: doc.agentId } : {}),
    transport: doc.transport,
    enabled: doc.enabled,
    ...(doc.brokerUrl ? { brokerUrl: doc.brokerUrl } : {}),
    ...(doc.consoleBaseUrl ? { consoleBaseUrl: doc.consoleBaseUrl } : {}),
    ...(doc.token ? { token: doc.token } : {}),
    ...(doc.mqttUsername ? { mqttUsername: doc.mqttUsername } : {}),
    ...(doc.mqttPassword ? { mqttPassword: doc.mqttPassword } : {}),
  }
}

/** DSH command prefixes the console may prepend; stripped before execution. */
const DSH_PREFIXES = ['local-dsh', 'ds-harness'] as const

/**
 * Remove a leading DSH routing prefix, returning the bare prompt.
 * @param command - raw console command text, possibly prefixed with a routing token.
 * @returns the bare prompt with any routing prefix stripped.
 */
export function stripDshPrefix(command: string): string {
  const text = command.trim()
  for (const prefix of DSH_PREFIXES) {
    if (text === prefix) return ''
    if (text.startsWith(`${prefix} `)) return text.slice(prefix.length + 1).trim()
  }
  return text
}

/**
 * Clamp a per-command timeout to the contract's valid 1..600 range; default 10s.
 * @param raw - the timeout value as received from the console (string or number).
 * @returns the clamped timeout in seconds.
 */
export function normalizeExecTimeoutS(raw: unknown): number {
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(value) || value < 1 || value > 600) return 10
  return Math.floor(value)
}

/**
 * Mount the console bridge.
 * @param ctx - Cordis context carrying the agent factory and session events.
 * @param config - console identity, transport, and agent/model selection.
 */
export function apply(ctx: Context, config: ConsoleBridgeConfig): void {
  const logger = ctx.logger
  const agents: AgentRegistry = ctx.agents
  const settings: SettingsProvider = ctx.settings
  // Register the connection settings page; cordis config forms the base layer
  // the UI overrides. Address/identity changes require a restart.
  const scope = settings.register('console-bridge', ConsoleBridgeSettingsSchema, {
    base: settingsBase(config),
    applies: 'restart',
  })
  // The price table this console's cost view charges against. Nothing in the
  // composition supplies prices — they are operator data rather than
  // connection configuration — so the namespace is registered with its schema
  // and the resolved value comes from the settings document alone. Registering
  // is what makes the namespace appear in `settings.describe()`, and therefore
  // what makes the console pricing card render at all.
  settings.register('console-pricing', ConsolePricingSettingsSchema, {
    validate: validateConsolePricing,
  })
  let effective = effectiveConfig(config, scope.get())
  // Expose a Web Remote so the settings card can probe the connection without
  // subscribing to commands. The probe resolves the connection config from the
  // current stored document, not a client echo: secret fields never ride a
  // client response, so only the host can read them back for the transport.
  ctx.plugin({
    name: 'console-bridge.remote',
    apply: (child) => {
      new ConsoleBridgeRemote(child, () => effectiveConfig(config, scope.get()))
    },
  })
  let seq = 0
  let transport: ConsoleTransport | undefined
  let unsubscribe: (() => void) | undefined
  let statusTimer: NodeJS.Timeout | undefined
  let closed = false
  let startPromise: Promise<void> = Promise.resolve()

  const agentIdOf = (cfg: ConsoleBridgeConfig): string => cfg.agentId ?? ''

  /** The live transport, asserting the bridge already connected. */
  const requireTransport = (): ConsoleTransport => {
    if (transport === undefined) throw new Error('console-bridge transport not connected')
    return transport
  }

  const buildEnvelope = (type: 'cmdAck' | 'result' | 'status', payload: unknown) => ({
    id: `${type}-${randomUUID()}`,
    seq: ++seq,
    ts: Date.now(),
    agentId: agentIdOf(effective),
    type,
    payload,
  })

  const publishAck = (cmdId: string, status: UpCmdAckPayload['status']): Promise<void> => {
    const topic = `v1/agent/${agentIdOf(effective)}/up/cmd/ack`
    return requireTransport().publish(topic, buildEnvelope('cmdAck', { cmdId, status } satisfies UpCmdAckPayload))
  }

  const publishResult = (result: UpResultPayload): Promise<void> => {
    const topic = `v1/agent/${agentIdOf(effective)}/up/result`
    return requireTransport().publish(topic, buildEnvelope('result', result)).catch((error: unknown) => {
      logger.warn(`console-bridge: result publish failed: ${String(error)}`)
    })
  }

  const publishStatus = (): Promise<void> => {
    const topic = `v1/agent/${agentIdOf(effective)}/up/status`
    const payload: UpStatusPayload = { status: 'online', cpuPercent: 0, memPercent: 0 }
    return requireTransport().publish(topic, buildEnvelope('status', payload))
  }

  const handleCommand = async (env: DownCmdEnvelope): Promise<void> => {
    const cmdId = env.payload.cmdId
    try {
      await publishAck(cmdId, 'ARRIVED')
      const prompt = stripDshPrefix(env.payload.command)
      const timeoutS = normalizeExecTimeoutS(env.payload.execTimeoutS)
      await publishAck(cmdId, 'EXECUTING')
      let outcome
      if (prompt.length === 0) {
        outcome = { exitCode: 1, status: 'FAILED', summary: '[empty command] no prompt after DSH prefix', durationMs: 0 }
      } else {
        outcome = await runDshTask(ctx, agents, {
          prompt,
          ...(effective.cwd !== undefined ? { cwd: effective.cwd } : {}),
          ...(effective.provider !== undefined ? { provider: effective.provider } : {}),
          ...(effective.model !== undefined ? { model: effective.model } : {}),
          timeoutMs: timeoutS * 1000,
        })
      }
      await publishResult({
        taskId: `task-${cmdId}`,
        cmdId,
        exitCode: outcome.exitCode,
        summary: outcome.summary,
        logUri: '',
        durationMs: outcome.durationMs,
      })
    } catch (error: unknown) {
      logger.warn(`console-bridge: task ${cmdId} failed: ${String(error)}`)
      await publishResult({
        taskId: `task-${cmdId}`,
        cmdId,
        exitCode: 1,
        summary: `[bridge-error] ${String(error)}`,
        logUri: '',
        durationMs: 0,
      })
    }
  }

  const stop = async (): Promise<void> => {
    if (statusTimer !== undefined) { clearInterval(statusTimer); statusTimer = undefined }
    if (transport === undefined) return
    unsubscribe?.()
    unsubscribe = undefined
    await transport.dispose().catch(() => undefined)
    transport = undefined
  }

  const startHeartbeat = (): void => {
    // The console marks a terminal offline after three missed heartbeat
    // periods, so publish `up/status` on the configured cadence and once
    // immediately on subscribe to bring it online without waiting a full cycle.
    const period = Math.min(60_000, Math.max(1_000, effective.statusIntervalMs ?? 5_000))
    /* v8 ignore next -- only reached after a successful subscribe, so `transport`
       is always set and `closed` is always false at this call site. */
    if (transport === undefined || closed) return
    const beat = (): void => {
      void publishStatus()
        .catch((error: unknown) => {
          logger.warn(`console-bridge: heartbeat publish failed: ${String(error)}`)
        })
    }
    beat()
    statusTimer = setInterval(beat, period)
  }

  const start = async (): Promise<void> => {
    /* v8 ignore next -- `transport`/`closed` are defensive guards. `start` is only
       re-entered after `stop()` (which clears `transport`) or after the `effect`
       disposer (which sets `closed`); no wired call site reaches a truthy operand. */
    if (transport !== undefined || closed || !effective.enabled) return
    if (agentIdOf(effective).length === 0) {
      logger.error('console-bridge: enabled but agentId is unset; not subscribing')
      return
    }
    transport = createTransport(effective, logger)
    await transport.connect()
    const topic = `v1/agent/${agentIdOf(effective)}/down/cmd`
    unsubscribe = await transport.subscribe(topic, payload => handleCommand(payload))
    logger.info(`console-bridge: subscribed to ${topic} (transport=${effective.transport})`)
    startHeartbeat()
  }

  // Arm the bridge from the CURRENT stored document, not the value captured at
  // apply time. The settings file loads asynchronously after plugin apply, so a
  // one-shot `if (effective.enabled) start()` could miss a document that only
  // becomes available later. `scope.watch` re-evaluates on every committed
  // change; an identity/address change restarts the transport (restart semantics).
  startPromise = start().catch((error: unknown) => {
    logger.error(`console-bridge: start failed: ${String(error)}`)
  })
  const offWatch = scope.watch(() => {
    const next = effectiveConfig(config, scope.get())
    const identityChanged = next.agentId !== effective.agentId
    const wasStarted = transport !== undefined || unsubscribe !== undefined
    effective = next
    if (!effective.enabled || agentIdOf(effective).length === 0) {
      void stop()
      return
    }
    if (wasStarted && identityChanged) {
      void stop().then(() => startPromise = start().catch((error: unknown) => {
        logger.error(`console-bridge: start failed: ${String(error)}`)
      }))
    } else if (!wasStarted) {
      startPromise = start().catch((error: unknown) => {
        logger.error(`console-bridge: start failed: ${String(error)}`)
      })
    }
  })

  ctx.effect(() => async () => {
    closed = true
    offWatch()
    if (statusTimer !== undefined) clearInterval(statusTimer)
    await startPromise
    unsubscribe?.()
    await transport?.dispose().catch(() => undefined)
  }, 'console-bridge')
}
