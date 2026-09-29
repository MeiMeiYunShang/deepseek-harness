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
import type {} from '@deepseek-ai/dsh-settings'

import {
  type ConsoleBridgeConfig,
  type ConsolePricingOffPeak,
  type ConsolePricingRow,
  type DownCmdEnvelope,
  type PlainResolvedConfig,
  type UpCmdAckPayload,
  type UpResultPayload,
  type UpStatusPayload,
} from './types.ts'

export type { ConsolePricingBandPrice, ConsolePricingOffPeak, ConsolePricingRow } from './types.ts'

import { createTransport, type ConsoleTransport } from './transport.ts'
import { runDshTask } from './runner.ts'
import ConsoleBridgeRemote from './remote.ts'

export const name = 'console-bridge'
/** The bridge creates and owns agents. */
export const inject = ['agents']

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

/** The operator's price table, as stored in the `console-bridge` settings namespace. */
export interface ConsolePricingSettings {
  /** The recorded price table; absent until an operator saves one. */
  models?: readonly ConsolePricingRow[]
  /**
   * The daily off-peak window, which is what splits each route's tokens into
   * price bands. Absent means every hour is charged at the peak price.
   */
  offPeak?: ConsolePricingOffPeak
}

/**
 * Schema for the price-table fields the `console-bridge` entry records: the
 * table the console cost view charges each `(baseUrl, provider, model)` route
 * against and the window that splits tokens into bands. An absent `models` and
 * an empty one both mean "no prices recorded" and are valid — a route with no
 * row is reported as unpriced, which is not the same fact as a free model. An
 * absent `offPeak` is likewise valid and means "peak only".
 */
const ConsolePricingModelsSchema = z.array(z.object({
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
})).required(false)

// An object schema resolves an absent value from its own `{}` default, which
// would then demand every field from a window the operator never declared.
// Absent has to stay absent — it means "peak only", not "an unreadable
// window" — and schemastery types `default` as the declared object type, so
// the one value that is not one takes the cast.
const ConsolePricingOffPeakSchema = z.object({
  start: z.string().required(),
  end: z.string().required(),
  timezone: z.string().required(),
}).default(undefined as unknown as ConsolePricingOffPeak)

/** The price-table fields as the console cost view and the `sessionStats` off-peak fold read them. */
export const ConsolePricingSettingsSchema = z.object({
  models: ConsolePricingModelsSchema,
  offPeak: ConsolePricingOffPeakSchema,
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
 * @param value - the resolved `console-bridge` price-table section.
 * @throws {TypeError} when a row carries a non-finite rate, or the off-peak window is not a usable `HH:MM` time and IANA zone.
 */
export function validateConsolePricing(value: {
  models?: readonly ConsolePricingRow[] | undefined
  offPeak?: ConsolePricingOffPeak | undefined
}): void {
  for (const [index, row] of (value.models ?? []).entries()) {
    for (const band of PRICE_BANDS) {
      for (const rate of PRICE_RATES) {
        if (!Number.isFinite(row[band][rate])) {
          throw new TypeError(`console-bridge: models[${index}].${band}.${rate} is not a finite number`)
        }
      }
    }
  }
  const offPeak = value.offPeak
  if (offPeak === undefined) return
  if (!OFF_PEAK_TIME.test(offPeak.start)) {
    throw new TypeError(`console-bridge: offPeak.start is not an HH:MM time: ${JSON.stringify(offPeak.start)}`)
  }
  if (!OFF_PEAK_TIME.test(offPeak.end)) {
    throw new TypeError(`console-bridge: offPeak.end is not an HH:MM time: ${JSON.stringify(offPeak.end)}`)
  }
  if (!isResolvableTimeZone(offPeak.timezone)) {
    throw new TypeError(`console-bridge: offPeak.timezone is not an IANA time zone: ${JSON.stringify(offPeak.timezone)}`)
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

/** Plugin config: console identity, transport, per-task agent/model selection, and the price table. */
export const Config = z.object({
  agentId: z.string().volatile(),
  transport: z.union(['mqtt', 'http']).default('mqtt').volatile(),
  brokerUrl: z.string().required(false).volatile(),
  consoleBaseUrl: z.string().required(false).volatile(),
  token: z.string().role('secret').required(false).volatile(),
  mqttUsername: z.string().required(false).volatile(),
  mqttPassword: z.string().role('secret').required(false).volatile(),
  provider: z.string().required(false).volatile(),
  model: z.string().required(false).volatile(),
  cwd: z.string().required(false).volatile(),
  execTimeoutS: z.number().default(10).volatile(),
  pollIntervalMs: z.number().default(2000).volatile(),
  statusIntervalMs: z.number().default(5000).volatile(),
  autoStart: z.boolean().default(true).volatile(),
  enabled: z.boolean().default(false).volatile(),
  models: ConsolePricingModelsSchema.volatile(),
  offPeak: ConsolePricingOffPeakSchema.volatile(),
})

/**
 * Read the current value of every live config reference.
 * @param config - the plugin config carrying live references.
 * @returns the ordinary values the bridge runs with.
 */
function readConfig(config: ConsoleBridgeConfig): PlainResolvedConfig {
  return {
    agentId: config.agentId.get(),
    transport: config.transport.get(),
    brokerUrl: config.brokerUrl.get(),
    consoleBaseUrl: config.consoleBaseUrl.get(),
    token: config.token.get(),
    mqttUsername: config.mqttUsername.get(),
    mqttPassword: config.mqttPassword.get(),
    provider: config.provider.get(),
    model: config.model.get(),
    cwd: config.cwd.get(),
    execTimeoutS: config.execTimeoutS.get(),
    pollIntervalMs: config.pollIntervalMs.get(),
    statusIntervalMs: config.statusIntervalMs.get(),
    autoStart: config.autoStart.get(),
    enabled: config.enabled.get(),
    models: config.models.get(),
    offPeak: config.offPeak.get(),
  }
}

/**
 * Merge the settings document over cordis config, treating empty strings as unset.
 * @param config - the ordinary cordis composition config, the settings `base` layer.
 * @param doc - the stored `console-bridge` settings document the operator edited.
 * @returns the effective config to run the bridge with.
 */
export function effectiveConfig(config: PlainResolvedConfig, doc: ConsoleBridgeSettings): PlainResolvedConfig {
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
 * @param config - console identity, transport, per-task agent/model selection, and the price table.
 */
export function apply(ctx: Context, config: ConsoleBridgeConfig): void {
  const logger = ctx.logger
  const agents: AgentRegistry = ctx.agents
  const initial = readConfig(config)
  // The schema expresses neither finiteness nor an `HH:MM`/IANA window, so the
  // resolved price table is checked here; a stored table no charge could be
  // computed from fails the mount loudly rather than silently pricing at zero.
  validateConsolePricing(initial)
  let effective = initial
  // Expose a Web Remote so the settings card can probe the connection without
  // subscribing to commands. The probe resolves the connection config from the
  // current live references, not a client echo: secret fields never ride a
  // client response, so only the host can read them back for the transport.
  ctx.plugin({
    name: 'console-bridge.remote',
    apply: (child) => {
      new ConsoleBridgeRemote(child, () => readConfig(config))
    },
  })
  let seq = 0
  let transport: ConsoleTransport | undefined
  let unsubscribe: (() => void) | undefined
  let statusTimer: NodeJS.Timeout | undefined
  let closed = false
  let startPromise: Promise<void> = Promise.resolve()

  const agentIdOf = (cfg: PlainResolvedConfig): string => cfg.agentId ?? ''

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
    const period = Math.min(60_000, Math.max(1_000, effective.statusIntervalMs))
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

  // Arm the bridge from the CURRENT live config, not the value captured at
  // apply time. The settings document loads asynchronously after plugin apply,
  // so a one-shot `if (effective.enabled) start()` could miss a document that
  // only becomes available later. A committed settings change re-evaluates; an
  // identity/address change restarts the transport (restart semantics).
  startPromise = start().catch((error: unknown) => {
    logger.error(`console-bridge: start failed: ${String(error)}`)
  })
  const reevaluate = (): void => {
    const next = readConfig(config)
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
  }
  const offSettings = ctx.on('settings/document-updated', (ns) => {
    if (String(ns) === name) reevaluate()
  })

  ctx.effect(() => async () => {
    closed = true
    offSettings()
    if (statusTimer !== undefined) clearInterval(statusTimer)
    await startPromise
    unsubscribe?.()
    await transport?.dispose().catch(() => undefined)
  }, 'console-bridge')
}
