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
/** The bridge creates and owns agents and registers a console-connection settings page. */
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
  const agents = ctx.agents as AgentRegistry
  const settings = ctx.settings as SettingsProvider
  // Register the connection settings page; cordis config forms the base layer
  // the UI overrides. Address/identity changes require a restart.
  const scope = settings.register('console-bridge', ConsoleBridgeSettingsSchema, {
    base: settingsBase(config),
    applies: 'restart',
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
