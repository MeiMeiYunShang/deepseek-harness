import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'

const fakeOs = vi.hoisted(() => ({
  loadavg: vi.fn(() => [0, 0, 0] as number[]),
  cpus: vi.fn(() => new Array(4).fill({})),
  totalmem: vi.fn(() => 16e9),
  freemem: vi.fn(() => 4e9),
}))

vi.mock('node:os', () => ({
  loadavg: fakeOs.loadavg,
  cpus: fakeOs.cpus,
  totalmem: fakeOs.totalmem,
  freemem: fakeOs.freemem,
}))

const { sampleCpu, sampleMemory, apply, name } = await import('../src/index.ts')
const { apply: invariantApply, name: invariantName, inject: invariantInject } = await import('../src/invariant.ts')

describe('@deepseek-ai/dsh-host-metrics', () => {
  beforeEach(() => vi.clearAllMocks())

  it('exposes the stable plugin name', () => {
    expect(name).toBe('host-metrics')
  })

  describe('sampleCpu', () => {
    it('normalizes load average by core count when load is reported', () => {
      fakeOs.loadavg.mockReturnValue([1.5, 0, 0])
      fakeOs.cpus.mockReturnValue(new Array(4).fill({}))
      expect(sampleCpu({ user: 0, system: 0 }, 0, { user: 1e6, system: 5e5 }, 1000)).toBe(37.5)
    })

    it('falls back to the process cpu delta when load is zero', () => {
      fakeOs.loadavg.mockReturnValue([0, 0, 0])
      fakeOs.cpus.mockReturnValue(new Array(4).fill({}))
      expect(sampleCpu({ user: 0, system: 0 }, 0, { user: 1e6, system: 5e5 }, 1000)).toBe(100)
    })

    it('treats an undefined load-average element as zero', () => {
      fakeOs.loadavg.mockReturnValue([undefined as unknown as number, 0, 0])
      fakeOs.cpus.mockReturnValue(new Array(4).fill({}))
      expect(sampleCpu({ user: 0, system: 0 }, 0, { user: 1e6, system: 5e5 }, 1000)).toBe(100)
    })

    it('uses one core when cpus() reports none', () => {
      fakeOs.loadavg.mockReturnValue([0, 0, 0])
      fakeOs.cpus.mockReturnValue([])
      expect(sampleCpu({ user: 0, system: 0 }, 0, { user: 1e6, system: 5e5 }, 1000)).toBe(100)
    })

    it('returns zero when the elapsed window is non-positive', () => {
      fakeOs.loadavg.mockReturnValue([0, 0, 0])
      fakeOs.cpus.mockReturnValue(new Array(4).fill({}))
      expect(sampleCpu({ user: 0, system: 0 }, 1000, { user: 0, system: 0 }, 1000)).toBe(0)
    })
  })

  describe('sampleMemory', () => {
    it('reports the used/total percent', () => {
      fakeOs.totalmem.mockReturnValue(16e9)
      fakeOs.freemem.mockReturnValue(4e9)
      expect(sampleMemory()).toBe(75)
    })

    it('returns zero when total memory is non-positive', () => {
      fakeOs.totalmem.mockReturnValue(0)
      fakeOs.freemem.mockReturnValue(0)
      expect(sampleMemory()).toBe(0)
    })
  })

  describe('apply', () => {
    it('emits host/metrics on the interval and stops after disposal', () => {
      vi.useFakeTimers()
      const emit = vi.fn()
      const effect = vi.fn((fn: () => () => void) => fn())
      const ctx = { emit, effect } as unknown as Context
      apply(ctx, { intervalMs: 500 })
      expect(emit).not.toHaveBeenCalled()
      vi.advanceTimersByTime(500)
      expect(emit).toHaveBeenCalledTimes(1)
      const [event, payload] = emit.mock.calls[0] as [string, { cpu: number; memory: number; gpu: null }]
      expect(event).toBe('host/metrics')
      expect(typeof payload.cpu).toBe('number')
      expect(typeof payload.memory).toBe('number')
      expect(payload.gpu).toBeNull()
      const disposer = effect.mock.results[0]?.value as (() => void) | undefined
      expect(typeof disposer).toBe('function')
      disposer?.()
      vi.advanceTimersByTime(500)
      expect(emit).toHaveBeenCalledTimes(1)
      vi.useRealTimers()
    })
  })

  describe('invariant companion', () => {
    it('registers the package invariant', async () => {
      const register = vi.fn((_name: string, install: () => void) => {
        install()
        return () => undefined
      })
      const ctx = { invariants: { register } } as unknown as Context
      const disposer = await invariantApply(ctx)
      expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-host-metrics', expect.any(Function))
      expect(typeof disposer).toBe('function')
      disposer()
    })

    it('exposes the companion name and injection', () => {
      expect(invariantName).toBe('host-metrics-invariant')
      expect(invariantInject).toEqual(['invariants'])
    })
  })
})
