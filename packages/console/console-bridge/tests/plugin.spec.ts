import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply, ConsoleBridgeSettingsSchema } from '../src/index.ts'
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
  it('registers a console-bridge settings namespace and reads the effective config', () => {
    const registered = vi.fn()
    const scope = { get: () => ({ agentId: 'ui-agent', transport: 'http' as const }), watch: () => () => undefined }
    const settings = {
      register: (ns: unknown, schema: unknown, opts: unknown) => {
        registered(ns, schema, opts)
        return scope
      },
    }
    const config: ConsoleBridgeConfig = { agentId: 'cordis-agent', transport: 'mqtt', autoStart: false }
    apply(fakeContext(settings), config)
    expect(registered).toHaveBeenCalledTimes(1)
    expect(registered).toHaveBeenCalledWith(
      'console-bridge',
      ConsoleBridgeSettingsSchema,
      expect.objectContaining({ applies: 'restart' }),
    )
  })
})
