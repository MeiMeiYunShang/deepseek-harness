import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as Module from '@deepseek-ai/dsh-mcpsec-manager/invariant'

describe('mcpsec-manager invariant companion', () => {
  it('declares its identity and services', () => {
    expect(Module.name).toBe('mcpsec-manager-invariant')
    expect(Module.inject).toEqual(['invariants'])
  })

  it('reserves package ownership with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(Module).await()).resolves.toBeDefined()
  })
})
