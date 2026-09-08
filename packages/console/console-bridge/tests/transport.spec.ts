import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createTransport } from '../src/transport.ts'
import type { ConsoleBridgeConfig } from '../src/types.ts'

interface MockMqttClient {
  handlers: Record<string, Array<(...a: unknown[]) => void>>
  on(event: string, cb: (...a: unknown[]) => void): MockMqttClient
  publish(_topic: string, _payload: string, _opts: unknown, cb: (e?: Error) => void): void
  subscribe(_topic: string, _opts: unknown, cb: (e?: Error) => void): void
  unsubscribe(topic: string): void
  end(_force: boolean, cb?: () => void): void
}

const mqttCtl = vi.hoisted(() => ({
  publishError: undefined as Error | undefined,
  subscribeError: undefined as Error | undefined,
  unsubThrow: false,
  client: undefined as MockMqttClient | undefined,
  publishCalls: 0,
  unsubCalls: [] as string[],
  endCalls: 0,
  emit(event: string, ...args: unknown[]) {
    const c = mqttCtl.client
    if (c) (c.handlers[event] ?? []).forEach((cb: (...a: unknown[]) => void) => { cb(...args) })
  },
}))

vi.mock('mqtt', () => {
  function makeClient() {
    const handlers: Record<string, Array<(...a: unknown[]) => void>> = {}
    const client: MockMqttClient = {
      on(event: string, cb: (...a: unknown[]) => void) {
        ;(handlers[event] ??= []).push(cb)
        return client
      },
      publish(_topic: string, _payload: string, _opts: unknown, cb: (e?: Error) => void) {
        mqttCtl.publishCalls += 1
        cb?.(mqttCtl.publishError)
      },
      subscribe(_topic: string, _opts: unknown, cb: (e?: Error) => void) {
        cb?.(mqttCtl.subscribeError)
      },
      unsubscribe(topic: string) {
        mqttCtl.unsubCalls.push(topic)
        if (mqttCtl.unsubThrow) throw new Error('unsub refused')
      },
      end(_force: boolean, cb?: () => void) {
        mqttCtl.endCalls += 1
        cb?.()
      },
      handlers,
    }
    mqttCtl.client = client
    return client
  }
  return { connect: () => makeClient() }
})

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

const logger = { debug() {}, info() {}, warn: vi.fn(), error() {} }
const mqttConfig = (over: Partial<ConsoleBridgeConfig> = {}): ConsoleBridgeConfig =>
  ({ transport: 'mqtt', ...over })

describe('createTransport', () => {
  it('returns an HttpTransport for transport "http"', async () => {
    const t = createTransport({ transport: 'http', consoleBaseUrl: 'http://x' }, logger)
    expect(typeof t.connect).toBe('function')
    expect(typeof t.publish).toBe('function')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })))
    await t.publish('v1/x', { a: 1 })
    expect((globalThis.fetch as unknown as Mock)).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('returns an MqttTransport for the default transport', () => {
    const t = createTransport(mqttConfig(), logger)
    expect(typeof t.connect).toBe('function')
    expect(typeof t.subscribe).toBe('function')
  })
})

describe('HttpTransport', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('connect is a no-op and publish POSTs with a leading slash and token header', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const t = createTransport({ transport: 'http', consoleBaseUrl: 'http://host', token: 'tok' }, logger)
    await t.connect()
    await t.publish('v1/agent/a/up/result', { x: 1 })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://host/v1/agent/a/up/result',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer tok' }) as unknown as Record<string, string>,
      }),
    )
  })

  it('publish throws when the uplink POST is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })))
    const t = createTransport({ transport: 'http' }, logger)
    await expect(t.publish('v1/a', {})).rejects.toThrow('uplink POST')
  })

  it('polls GET, delivers items, and stops on dispose', async () => {
    const received: unknown[] = []
    const env = { id: 'c', seq: 1, ts: 0, agentId: 'a', type: 'cmd' as const, payload: { cmdId: 'c1', command: 'hi', execTimeoutS: 60, riskLevel: 'normal', priority: 'normal' } }
    let first = true
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (first) {
        first = false
        return { ok: true, json: async () => ({ items: [env] }) }
      }
      return { ok: true, json: async () => ({ items: [] }) }
    }))
    const t = createTransport({ transport: 'http', consoleBaseUrl: 'http://h', pollIntervalMs: 100 }, logger)
    const stop = await t.subscribe('v1/a/down/cmd', (p) => { received.push(p) })
    await vi.advanceTimersByTimeAsync(1)
    expect(received).toHaveLength(1)
    stop()
    await vi.advanceTimersByTimeAsync(500)
  })

  it('skips when the poll response is not ok and warns on poll error', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })
      .mockRejectedValueOnce(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)
    const t = createTransport({ transport: 'http', pollIntervalMs: 100 }, logger)
    const stop = await t.subscribe('v1/a/down/cmd', () => undefined)
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(200)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('poll failed'))
    stop()
    await vi.advanceTimersByTimeAsync(200)
  })

  it('dispose stops the poll loop', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ items: [] }) })))
    const t = createTransport({ transport: 'http', pollIntervalMs: 100 }, logger)
    const stop = await t.subscribe('v1/a/down/cmd', () => undefined)
    await t.dispose()
    stop()
    await vi.advanceTimersByTimeAsync(300)
  })

  it('publishes a topic that already carries a leading slash', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const t = createTransport({ transport: 'http' }, logger)
    await t.connect()
    await t.publish('/v1/agent/a/up/result', { x: 1 })
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8080/v1/agent/a/up/result', expect.anything())
    vi.unstubAllGlobals()
  })

  it('skips a poll response that has no items array', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })))
    const t = createTransport({ transport: 'http', pollIntervalMs: 100 }, logger)
    const stop = await t.subscribe('v1/a/down/cmd', () => undefined)
    await vi.advanceTimersByTimeAsync(1)
    stop()
    await vi.advanceTimersByTimeAsync(200)
  })

  it('warns when a polled handler throws and falls back to the default interval', async () => {
    const env = { id: 'c', seq: 1, ts: 0, agentId: 'a', type: 'cmd' as const, payload: { cmdId: 'c1', command: 'hi', execTimeoutS: 60, riskLevel: 'normal', priority: 'normal' } }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ items: [env] }) })))
    const t = createTransport({ transport: 'http' }, logger)
    const stop = await t.subscribe('v1/a/down/cmd', () => { throw new Error('boom') })
    await vi.advanceTimersByTimeAsync(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('handler failed'))
    stop()
    await vi.advanceTimersByTimeAsync(50)
  })
})

describe('MqttTransport', () => {
  beforeEach(() => {
    mqttCtl.publishError = undefined
    mqttCtl.subscribeError = undefined
    mqttCtl.unsubThrow = false
    mqttCtl.client = undefined
    mqttCtl.publishCalls = 0
    mqttCtl.unsubCalls = []
    mqttCtl.endCalls = 0
  })

  it('connect resolves on the broker connect event (with credentials)', async () => {
    const t = createTransport(mqttConfig({ mqttUsername: 'u', mqttPassword: 'p' }), logger)
    const p = t.connect()
    await flush()
    mqttCtl.emit('connect')
    await p
    expect(mqttCtl.client).toBeDefined()
  })

  it('connect resolves without credentials', async () => {
    const t = createTransport(mqttConfig(), logger)
    const p = t.connect()
    await flush()
    mqttCtl.emit('connect')
    await p
  })

  it('connect rejects on the broker error event', async () => {
    const t = createTransport(mqttConfig(), logger)
    const p = t.connect()
    await flush()
    mqttCtl.emit('error', new Error('auth failed'))
    await expect(p).rejects.toThrow('auth failed')
  })

  it('connect rejects when the broker closes before CONNACK', async () => {
    const t = createTransport(mqttConfig(), logger)
    const p = t.connect()
    await flush()
    mqttCtl.emit('close')
    await expect(p).rejects.toThrow('closed before CONNACK')
  })

  it('publish before connect throws', async () => {
    const t = createTransport(mqttConfig(), logger)
    await expect(t.publish('v1/a', {})).rejects.toThrow('not connected')
  })

  it('publish resolves through the client', async () => {
    const t = createTransport(mqttConfig(), logger)
    const p = t.connect()
    await flush()
    mqttCtl.emit('connect')
    await p
    await t.publish('v1/a', { b: 1 })
    expect(mqttCtl.publishCalls).toBeGreaterThan(0)
  })

  it('publish rejects when the client reports an error', async () => {
    const t = createTransport(mqttConfig(), logger)
    const p = t.connect()
    await flush()
    mqttCtl.emit('connect')
    await p
    mqttCtl.publishError = new Error('pub failed')
    await expect(t.publish('v1/a', {})).rejects.toThrow('pub failed')
  })

  it('subscribe before connect throws', async () => {
    const t = createTransport(mqttConfig(), logger)
    await expect(t.subscribe('v1/a', () => undefined)).rejects.toThrow('not connected')
  })

  it('subscribe rejects when the broker reports a subscription error', async () => {
    const t = createTransport(mqttConfig(), logger)
    const p = t.connect()
    await flush()
    mqttCtl.emit('connect')
    await p
    mqttCtl.subscribeError = new Error('sub failed')
    await expect(t.subscribe('v1/a', () => undefined)).rejects.toThrow('sub failed')
  })

  it('subscribe delivers matching messages and ignores other topics', async () => {
    const t = createTransport(mqttConfig(), logger)
    const p = t.connect()
    await flush()
    mqttCtl.emit('connect')
    await p
    const handler = vi.fn()
    const stop = await t.subscribe('v1/a/down/cmd', handler)
    mqttCtl.emit('message', 'v1/a/down/cmd', Buffer.from(JSON.stringify({ cmdId: 'c1' })))
    await flush()
    expect(handler).toHaveBeenCalledTimes(1)
    mqttCtl.emit('message', 'v1/other', Buffer.from('{}'))
    await flush()
    expect(handler).toHaveBeenCalledTimes(1)
    stop()
  })

  it('subscribe warns when the delivered handler throws', async () => {
    const t = createTransport(mqttConfig(), logger)
    const p = t.connect()
    await flush()
    mqttCtl.emit('connect')
    await p
    const stop = await t.subscribe('v1/a/down/cmd', async () => { throw new Error('handler boom') })
    mqttCtl.emit('message', 'v1/a/down/cmd', Buffer.from(JSON.stringify({ cmdId: 'c1' })))
    await flush()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('handler failed'))
    stop()
  })

  it('subscribe disposer unsubscribes', async () => {
    const t = createTransport(mqttConfig(), logger)
    const p = t.connect()
    await flush()
    mqttCtl.emit('connect')
    await p
    const stop = await t.subscribe('v1/a/down/cmd', () => undefined)
    stop()
    expect(mqttCtl.unsubCalls).toContain('v1/a/down/cmd')
  })

  it('subscribe disposer swallows an unsubscribe error', async () => {
    const t = createTransport(mqttConfig(), logger)
    const p = t.connect()
    await flush()
    mqttCtl.emit('connect')
    await p
    mqttCtl.unsubThrow = true
    const stop = await t.subscribe('v1/a/down/cmd', () => undefined)
    expect(() => { stop() }).not.toThrow()
  })

  it('dispose before connect is a no-op', async () => {
    const t = createTransport(mqttConfig(), logger)
    await expect(t.dispose()).resolves.toBeUndefined()
  })

  it('dispose ends the client', async () => {
    const t = createTransport(mqttConfig(), logger)
    const p = t.connect()
    await flush()
    mqttCtl.emit('connect')
    await p
    await t.dispose()
    expect(mqttCtl.endCalls).toBeGreaterThan(0)
  })
})
