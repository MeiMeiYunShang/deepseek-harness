/**
 * Web-facing Remote for the console bridge. The single `testConnection` method
 * builds a throwaway transport from the connection details the settings card
 * sends and verifies it can connect, without subscribing to commands or
 * dispatching any task. The Web settings card calls it so an operator can
 * confirm their connection details before enabling the bridge.
 *
 * @module @deepseek-ai/dsh-console-bridge/remote
 */

import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { ConsoleBridgeConfig, ConsoleBridgeTestRequest, ConsoleBridgeTestResult } from './types.ts'
import { createTransport } from './transport.ts'

/**
 * Host half of the console-bridge Web Remote.
 * @extends TypertRemoteService - binds the `consoleBridge` Remote namespace.
 */
export default class ConsoleBridgeRemote extends TypertRemoteService {
  private readonly getConfig: () => ConsoleBridgeConfig

  /**
   * @param ctx - Cordis context.
   * @param getConfig - resolves the current stored `console-bridge` connection
   * config; the host owns the document, so this includes secret values a
   * client response never carries back.
   */
  constructor(ctx: Context, getConfig: () => ConsoleBridgeConfig) {
    super(ctx, 'consoleBridge')
    this.getConfig = getConfig
  }

  /**
   * Probe the console connection stored in the settings document. The stored
   * config is authoritative — secret fields (`mqttPassword`, `token`) never
   * ride a client response, so the card's request supplies only the non-secret
   * overrides. Tries a real connect for `mqtt`, and a reachability `GET` for
   * `http`; never subscribes or dispatches.
   * @param input - non-secret connection details the card sends.
   * @returns whether the console was reachable and a detail message.
   */
  @Remote('testConnection')
  async testConnection(input: ConsoleBridgeTestRequest): Promise<ConsoleBridgeTestResult> {
    const config: ConsoleBridgeConfig = {
      ...this.getConfig(),
      agentId: input.agentId,
      transport: input.transport,
      ...(input.brokerUrl ? { brokerUrl: input.brokerUrl } : {}),
      ...(input.consoleBaseUrl ? { consoleBaseUrl: input.consoleBaseUrl } : {}),
      ...(input.mqttUsername ? { mqttUsername: input.mqttUsername } : {}),
    }
    const logger = this.ctx.logger
    const transport = createTransport(config, logger)
    try {
      if (config.transport === 'http') {
        const base = config.consoleBaseUrl ?? 'http://127.0.0.1:8080'
        const res = await fetch(base, {
          method: 'GET',
          headers: config.token ? { authorization: `Bearer ${config.token}` } : {},
        })
        return { ok: true, message: `reachable (${res.status})` }
      }
      await transport.connect()
      await transport.dispose()
      return { ok: true, message: 'broker connected' }
    } catch (error: unknown) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }
}
