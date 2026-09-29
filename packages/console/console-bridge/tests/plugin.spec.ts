import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  apply, ConsoleBridgeSettingsSchema, ConsolePricingSettingsSchema, validateConsolePricing,
} from '../src/index.ts'
import { makeConfig } from './config.ts'

/**
 * Build a context that records every service and lifecycle registration the
 * plugin makes. `settings` stands in for the Host service the entry no longer
 * registers with, so the spec can prove it is never consulted.
 * @returns the context and the registration spies.
 */
function fakeContext(): {
  ctx: Context
  plugin: ReturnType<typeof vi.fn>
  effect: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  register: ReturnType<typeof vi.fn>
} {
  const plugin = vi.fn(() => () => undefined)
  const effect = vi.fn(() => () => undefined)
  const on = vi.fn(() => () => undefined)
  const register = vi.fn()
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    agents: {},
    on,
    effect,
    plugin,
    settings: { register },
  } as unknown as Context
  return { ctx, plugin, effect, on, register }
}

describe('console-bridge entry config', () => {
  it('mounts from the volatile entry config and registers no settings namespace', () => {
    const { ctx, plugin, effect, on, register } = fakeContext()
    const config = makeConfig({ transport: 'http', agentId: 'cordis-agent', autoStart: false })
    apply(ctx, config)

    // The `console-bridge` and `console-pricing` settings namespaces were
    // removed: every editable field is a live Config reference instead, so the
    // entry must never reach for the settings service.
    expect(register).not.toHaveBeenCalled()
    // The only sub-plugin is the Web Remote; the settings listener and the
    // teardown effect are the plugin's other registrations.
    expect(plugin).toHaveBeenCalledOnce()
    expect(plugin.mock.calls[0]?.[0]).toMatchObject({ name: 'console-bridge.remote' })
    expect(on).toHaveBeenCalledWith('settings/document-updated', expect.any(Function))
    expect(effect).toHaveBeenCalledOnce()
  })

  it('still exports the config and price schemas for the settings form', () => {
    expect(ConsoleBridgeSettingsSchema).toBeTruthy()
    expect(ConsolePricingSettingsSchema).toBeTruthy()
    expect(validateConsolePricing).toBeTypeOf('function')
  })
})
