import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  apply, ConsoleBridgeSettingsSchema, ConsolePricingSettingsSchema, validateConsolePricing,
} from '../src/index.ts'
import type { ConsoleBridgeConfig } from '../src/types.ts'

function fakeContext(settings: unknown): Context {
  return {
    logger: { info() {}, warn() {}, error() {} },
    on: () => () => undefined,
    effect: () => () => undefined,
    plugin: () => () => undefined,
    settings,
  } as unknown as Context
}

describe('console-bridge settings registration', () => {
  it('registers the console settings namespaces and reads the effective config', () => {
    const registered = vi.fn((_ns: string, _schema: unknown, _opts: unknown): void => undefined)
    const scope = { get: () => ({ agentId: 'ui-agent', transport: 'http' as const }), watch: () => () => undefined }
    const settings = {
      register: (ns: unknown, schema: unknown, opts: unknown) => {
        registered(String(ns), schema, opts)
        return scope
      },
    }
    const config: ConsoleBridgeConfig = { agentId: 'cordis-agent', transport: 'mqtt', autoStart: false }
    apply(fakeContext(settings), config)
    expect(registered).toHaveBeenCalledTimes(2)
    expect(registered).toHaveBeenCalledWith(
      'console-bridge',
      ConsoleBridgeSettingsSchema,
      expect.objectContaining({ applies: 'restart' }),
    )
    expect(registered.mock.calls[1]?.[0]).toBe('console-pricing')
    expect(registered.mock.calls[1]?.[1]).toBe(ConsolePricingSettingsSchema)
    // Nothing in the composition supplies prices, so the namespace declares a
    // schema and the finiteness check only — no base layer, no restart.
    expect(registered.mock.calls[1]?.[2]).toEqual({ validate: validateConsolePricing })
  })
})
