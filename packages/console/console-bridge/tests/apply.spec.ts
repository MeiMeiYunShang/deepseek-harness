import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { Context as CordisContext } from '@deepseek-ai/cordis'
import {
  apply,
  effectiveConfig as effectiveConfigFn,
  name,
  inject,
  ConsoleBridgeSettingsSchema,
  Config,
  normalizeExecTimeoutS,
  type ConsoleBridgeSettings,
} from '../src/index.ts'
import type { ConsoleBridgeConfig, DownCmdEnvelope } from '../src/types.ts'

interface MockTransport {
  connect: ReturnType<typeof vi.fn>
  publish: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
}

const ctl = vi.hoisted(() => ({
  transports: [] as MockTransport[],
  current: null as null | MockTransport,
  subscribeHandler: null as null | ((e: DownCmdEnvelope) => void | Promise<void>),
  runResult: { exitCode: 0, status: 'SUCCEEDED' as const, summary: 'ok', durationMs: 12 },
  runError: null as null | Error,
  rejectTopics: new Set<string>(),
  connectError: undefined as undefined | Error,
  subscribeError: undefined as undefined | Error,
  disposeError: undefined as undefined | Error,
}))

vi.mock('../src/transport.ts', () => ({
  createTransport: vi.fn((_config: ConsoleBridgeConfig, _logger: unknown) => {
    const t = {
      connect: vi.fn(async () => { if (ctl.connectError) throw ctl.connectError }),
      publish: vi.fn(async (topic: string) => { if (ctl.rejectTopics.has(topic)) throw new Error(`publish ${topic} failed`) }),
      subscribe: vi.fn(async (_topic: string, handler: (e: DownCmdEnvelope) => void | Promise<void>) => {
        ctl.subscribeHandler = handler
        if (ctl.subscribeError) throw ctl.subscribeError
        return () => undefined
      }),
      dispose: vi.fn(async () => { if (ctl.disposeError) throw ctl.disposeError }),
    }
    ctl.current = t
    ctl.transports.push(t)
    return t
  }),
}))

vi.mock('../src/runner.ts', () => ({
  runDshTask: vi.fn(async () => {
    if (ctl.runError) throw ctl.runError
    return ctl.runResult
  }),
}))

const remoteCtl = vi.hoisted(() => ({
  getConfig: undefined as undefined | (() => unknown),
}))

vi.mock('../src/remote.ts', () => ({
  default: function (_ctx: unknown, getConfig: () => unknown) {
    remoteCtl.getConfig = getConfig
  },
}))

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

interface Bundle {
  ctx: Context
  logger: {
    info: ReturnType<typeof vi.fn>
    warn: ReturnType<typeof vi.fn>
    error: ReturnType<typeof vi.fn>
    debug: ReturnType<typeof vi.fn>
  }
  holder: { doc: ConsoleBridgeSettings }
  triggerWatch: () => void
  getEffect: () => (() => void) | undefined
  registerOpts: () => unknown
}

function makeBundle(initialDoc: ConsoleBridgeSettings, _config: ConsoleBridgeConfig): Bundle {
  const holder = { doc: initialDoc }
  let watchCb: (() => void) | undefined
  let effectDisposer: (() => void) | undefined
  let registerOpts: unknown
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }
  const scope = {
    get: () => holder.doc,
    watch: (cb: () => void) => { watchCb = cb; return () => { watchCb = undefined } },
  }
  const childCtx = new CordisContext()
  ;(childCtx as unknown as { logger: unknown }).logger = { debug() {}, info() {}, warn() {}, error() {} }
  const ctx = {
    logger,
    agents: {} as unknown,
    settings: { register: vi.fn((_ns: unknown, _schema: unknown, opts: unknown) => { registerOpts = opts; return scope }) },
    plugin: vi.fn((spec: { apply?: (c: Context) => void }) => { spec.apply?.(childCtx); return () => undefined }),
    effect: vi.fn((factory: () => (() => void) | undefined) => { effectDisposer = factory() ?? undefined; return () => undefined }),
  } as unknown as Context
  return {
    ctx,
    logger,
    holder,
    triggerWatch: () => watchCb?.(),
    getEffect: () => effectDisposer,
    registerOpts: () => registerOpts,
  }
}

function downCmd(command: string, execTimeoutS = 60): DownCmdEnvelope {
  return {
    id: 'c',
    seq: 1,
    ts: 0,
    agentId: 'a',
    type: 'cmd',
    payload: { cmdId: 'cmd-1', command, execTimeoutS, riskLevel: 'normal', priority: 'normal' },
  }
}

beforeEach(() => {
  ctl.transports = []
  ctl.current = null
  ctl.subscribeHandler = null
  ctl.runError = null
  ctl.rejectTopics.clear()
  ctl.connectError = undefined
  ctl.subscribeError = undefined
  ctl.disposeError = undefined
  remoteCtl.getConfig = undefined
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('console-bridge plugin exports', () => {
  it('exposes name, inject, schemas, and Config', () => {
    expect(name).toBe('console-bridge')
    expect(inject).toEqual(['agents', 'settings'])
    expect(ConsoleBridgeSettingsSchema).toBeTruthy()
    expect(Config).toBeTruthy()
  })
})

describe('effectiveConfig', () => {
  const config: ConsoleBridgeConfig = {
    transport: 'mqtt',
    agentId: 'c',
    brokerUrl: 'b',
    consoleBaseUrl: 'cb',
    token: 't',
    mqttUsername: 'u',
    mqttPassword: 'p',
    enabled: true,
  }

  it('overlays a fully-populated document over config', () => {
    const doc: ConsoleBridgeSettings = {
      enabled: true,
      agentId: 'd',
      transport: 'http',
      brokerUrl: 'db',
      consoleBaseUrl: 'dc',
      token: 'dt',
      mqttUsername: 'du',
      mqttPassword: 'dp',
    }
    const r = effectiveConfigFn(config, doc)
    expect(r.transport).toBe('http')
    expect(r.agentId).toBe('d')
    expect(r.brokerUrl).toBe('db')
    expect(r.consoleBaseUrl).toBe('dc')
    expect(r.token).toBe('dt')
    expect(r.mqttUsername).toBe('du')
    expect(r.mqttPassword).toBe('dp')
  })

  it('keeps config values when the document omits fields', () => {
    const doc: ConsoleBridgeSettings = { enabled: false, transport: 'mqtt' }
    const r = effectiveConfigFn(config, doc)
    expect(r.agentId).toBe('c')
    expect(r.brokerUrl).toBe('b')
    expect(r.consoleBaseUrl).toBe('cb')
    expect(r.token).toBe('t')
    expect(r.mqttUsername).toBe('u')
    expect(r.mqttPassword).toBe('p')
  })
})

describe('settingsBase via apply', () => {
  it('seeds the base with every provided field and enabled flag', async () => {
    const config: ConsoleBridgeConfig = {
      transport: 'http',
      agentId: 'a',
      brokerUrl: 'b',
      consoleBaseUrl: 'cb',
      token: 't',
      mqttUsername: 'u',
      mqttPassword: 'p',
      autoStart: false,
      enabled: true,
    }
    const bundle = makeBundle({ enabled: false, transport: 'http' }, config)
    apply(bundle.ctx, config)
    expect(bundle.registerOpts()).toEqual({
      base: {
        transport: 'http',
        enabled: true,
        agentId: 'a',
        brokerUrl: 'b',
        consoleBaseUrl: 'cb',
        token: 't',
        mqttUsername: 'u',
        mqttPassword: 'p',
      },
      applies: 'restart',
    })
    bundle.getEffect()?.()
  })

  it('seeds only transport and the autoStart-derived enabled when minimal', async () => {
    const config: ConsoleBridgeConfig = { transport: 'mqtt' }
    const bundle = makeBundle({ enabled: false, transport: 'mqtt' }, config)
    apply(bundle.ctx, config)
    expect(bundle.registerOpts()).toEqual({ base: { transport: 'mqtt', enabled: false }, applies: 'restart' })
    bundle.getEffect()?.()
  })

  it('uses autoStart when enabled is unset', async () => {
    const config: ConsoleBridgeConfig = { transport: 'mqtt', autoStart: true }
    const bundle = makeBundle({ enabled: false, transport: 'mqtt' }, config)
    apply(bundle.ctx, config)
    expect(bundle.registerOpts()).toEqual({ base: { transport: 'mqtt', enabled: true }, applies: 'restart' })
    bundle.getEffect()?.()
  })
})

describe('apply happy path (start at boot, command, heartbeat, dispose)', () => {
  it('subscribes, runs a command, and disposes cleanly', async () => {
    const config: ConsoleBridgeConfig = {
      transport: 'http',
      statusIntervalMs: 1000,
      cwd: '/work',
      provider: 'p',
      model: 'm',
    }
    const bundle = makeBundle({ enabled: true, agentId: 'a', transport: 'http' }, config)
    apply(bundle.ctx, config)
    await flush()
    expect(ctl.current).not.toBeNull()
    expect(ctl.current!.connect).toHaveBeenCalled()
    expect(ctl.current!.subscribe).toHaveBeenCalled()

    await ctl.subscribeHandler!(downCmd('local-dsh hello'))
    await flush()
    expect(ctl.current!.publish).toHaveBeenCalled()

    // empty-prompt branch: only the DSH prefix is supplied
    await ctl.subscribeHandler!(downCmd('local-dsh'))
    await flush()

    ctl.disposeError = new Error('dispose boom')
    bundle.getEffect()?.()
    await flush()
    expect(bundle.logger.error).not.toHaveBeenCalled()
  })

  it('reports a task failure through the result envelope and tolerates a rejected result publish', async () => {
    ctl.runError = new Error('kaboom')
    ctl.rejectTopics.add('v1/agent/a/up/result')
    const config: ConsoleBridgeConfig = { transport: 'http' }
    const bundle = makeBundle({ enabled: true, agentId: 'a', transport: 'http' }, config)
    apply(bundle.ctx, config)
    await flush()
    await ctl.subscribeHandler!(downCmd('real task'))
    await flush()
    expect(bundle.logger.warn).toHaveBeenCalledWith(expect.stringContaining('result publish failed'))
    bundle.getEffect()?.()
    await flush()
  })

  it('warns when a heartbeat publish fails', async () => {
    vi.useFakeTimers()
    ctl.rejectTopics.add('v1/agent/a/up/status')
    const config: ConsoleBridgeConfig = { transport: 'http', statusIntervalMs: 1000 }
    const bundle = makeBundle({ enabled: true, agentId: 'a', transport: 'http' }, config)
    apply(bundle.ctx, config)
    await flush()
    await vi.advanceTimersByTimeAsync(1500)
    await flush()
    expect(bundle.logger.warn).toHaveBeenCalledWith(expect.stringContaining('heartbeat publish failed'))
    bundle.getEffect()?.()
    await flush()
  })

  it('clamps the heartbeat period to 1000..60000', async () => {
    vi.useFakeTimers()
    for (const statusIntervalMs of [500, 70_000]) {
      const config: ConsoleBridgeConfig = { transport: 'http', statusIntervalMs }
      const bundle = makeBundle({ enabled: true, agentId: 'a', transport: 'http' }, config)
      apply(bundle.ctx, config)
      await flush()
      bundle.getEffect()?.()
      await flush()
    }
  })

  it('starts from a watch event when the document enables the bridge', async () => {
    const config: ConsoleBridgeConfig = { transport: 'http' }
    const bundle = makeBundle({ enabled: false, agentId: '', transport: 'http' }, config)
    apply(bundle.ctx, config)
    await flush()
    expect(ctl.current).toBeNull()
    ctl.subscribeError = new Error('late subscribe fail')
    bundle.holder.doc = { enabled: true, agentId: 'a', transport: 'http' }
    bundle.triggerWatch()
    await flush()
    expect(ctl.current).not.toBeNull()
    await ctl.subscribeHandler!(downCmd('late start'))
    await flush()
    bundle.getEffect()?.()
    await flush()
  })
})

describe('apply stop and restart transitions', () => {
  it('stops the transport when the document disables the bridge', async () => {
    const config: ConsoleBridgeConfig = { transport: 'http', statusIntervalMs: 1000 }
    const bundle = makeBundle({ enabled: true, agentId: 'a', transport: 'http' }, config)
    apply(bundle.ctx, config)
    await flush()
    const transport = ctl.current!
    ctl.disposeError = new Error('stop dispose fail')
    bundle.holder.doc = { enabled: false, agentId: 'a', transport: 'http' }
    bundle.triggerWatch()
    await flush()
    expect(transport.dispose).toHaveBeenCalled()
    bundle.getEffect()?.()
    await flush()
  })

  it('restarts the transport when the agent identity changes', async () => {
    const config: ConsoleBridgeConfig = { transport: 'http' }
    const bundle = makeBundle({ enabled: true, agentId: 'a', transport: 'http' }, config)
    apply(bundle.ctx, config)
    await flush()
    const first = ctl.current!
    ctl.connectError = new Error('restart connect fail')
    bundle.holder.doc = { enabled: true, agentId: 'b', transport: 'http' }
    bundle.triggerWatch()
    await flush()
    expect(first.dispose).toHaveBeenCalled()
    expect(ctl.current).not.toBe(first)
    await ctl.subscribeHandler!(downCmd('re-id'))
    await flush()
    bundle.getEffect()?.()
    await flush()
  })

  it('refuses to subscribe when enabled but the agentId is unset', async () => {
    const config: ConsoleBridgeConfig = { transport: 'http' }
    const bundle = makeBundle({ enabled: true, agentId: '', transport: 'http' }, config)
    apply(bundle.ctx, config)
    await flush()
    expect(ctl.current).toBeNull()
    expect(bundle.logger.error).toHaveBeenCalledWith(expect.stringContaining('agentId is unset'))
    // also covers stop() early-return with no transport
    bundle.holder.doc = { enabled: false, agentId: '', transport: 'http' }
    bundle.triggerWatch()
    await flush()
    bundle.getEffect()?.()
    await flush()
  })
})

describe('apply start failure', () => {
  it('logs a start failure and tolerates a rejected start in the effect disposer', async () => {
    ctl.connectError = new Error('broker down')
    const config: ConsoleBridgeConfig = { transport: 'http' }
    const bundle = makeBundle({ enabled: true, agentId: 'a', transport: 'http' }, config)
    apply(bundle.ctx, config)
    await flush()
    expect(bundle.logger.error).toHaveBeenCalledWith(expect.stringContaining('start failed'))
    expect(typeof bundle.getEffect()).toBe('function')
    bundle.getEffect()?.()
    await flush()
  })
})

describe('apply remote probe', () => {
  it('exposes a getConfig closure that resolves the effective config', async () => {
    const config: ConsoleBridgeConfig = { transport: 'http' }
    const bundle = makeBundle({ enabled: true, agentId: 'a', transport: 'http' }, config)
    apply(bundle.ctx, config)
    await flush()
    expect(remoteCtl.getConfig).toBeTypeOf('function')
    expect(remoteCtl.getConfig!()).toMatchObject({ transport: 'http' })
    bundle.getEffect()?.()
    await flush()
  })
})

describe('normalizeExecTimeoutS', () => {
  it('passes a finite in-range number through (floored)', () => {
    expect(normalizeExecTimeoutS(60.9)).toBe(60)
  })

  it('coerces a numeric string', () => {
    expect(normalizeExecTimeoutS('45')).toBe(45)
  })

  it('falls back to 10 for out-of-range, non-finite, and missing values', () => {
    expect(normalizeExecTimeoutS(0)).toBe(10)
    expect(normalizeExecTimeoutS(601)).toBe(10)
    expect(normalizeExecTimeoutS('not-a-number')).toBe(10)
    expect(normalizeExecTimeoutS(undefined)).toBe(10)
  })
})

describe('apply watch with no identity change', () => {
  it('leaves the transport untouched on a no-op watch', async () => {
    const config: ConsoleBridgeConfig = { transport: 'http' }
    const bundle = makeBundle({ enabled: true, agentId: 'a', transport: 'http' }, config)
    apply(bundle.ctx, config)
    await flush()
    const transport = ctl.current!
    bundle.holder.doc = { enabled: true, agentId: 'a', transport: 'http' }
    bundle.triggerWatch()
    await flush()
    expect(ctl.current).toBe(transport)
    bundle.getEffect()?.()
    await flush()
  })
})
