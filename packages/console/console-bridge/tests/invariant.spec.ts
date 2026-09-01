import { describe, expect, it, vi } from 'vitest'
import { apply, inject, name } from '../src/invariant.ts'

describe('console-bridge invariant companion', () => {
  it('exposes its companion name and injects the invariants service', () => {
    expect(name).toBe('console-bridge-invariant')
    expect(inject).toEqual(['invariants'])
  })

  it('registers a no-op invariant installer', async () => {
    let captured: (() => void) | undefined
    const register = vi.fn((_pkg: string, installer: () => void) => {
      captured = installer
      return () => undefined
    })
    const ctx = { invariants: { register } } as unknown as import('@deepseek-ai/cordis').Context
    const dispose = await apply(ctx)
    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-console-bridge', expect.any(Function))
    expect(typeof captured).toBe('function')
    expect(() => captured!()).not.toThrow()
    expect(typeof dispose).toBe('function')
  })
})
