import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as Module from '@deepseek-ai/dsh-image-understanding/invariant'
const { inject, installInvariant, name } = Module

type Listener = (session: unknown, event: { type: string; data: Record<string, unknown> }) => void

/** Drive the invariant installer with a captured listener and a fail spy. */
function drive() {
  const listeners: Listener[] = []
  const ctx = { on: vi.fn((_evt: string, listener: Listener) => { listeners.push(listener) }) }
  const fail = vi.fn()
  void installInvariant(ctx as never, fail as never)
  return { emit: listeners[0]!, fail }
}

describe('image-understanding invariant companion', () => {
  it('declares its identity and services', () => {
    expect(name).toBe('image-understanding-invariant')
    expect(inject).toEqual(['invariants'])
  })

  it('reserves package ownership through the registry', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(Module).await()).resolves.toBeDefined()
  })

  it('tracks the failure-, restore-, and turn-boundary relation across one lifecycle', () => {
    const { emit, fail } = drive()
    const failure = (messageId: string) => ({ type: 'user/image-understanding-failed' as const, data: { messageId, failedIndexes: [1], reason: 'TIMEOUT', explanation: 'x' } })
    const splice = (target: 'next-turn' | 'next-step', messageId: string) => ({ type: 'agent/inbox/spliced' as const, data: { target, start: 0, inserted: [{ id: messageId }] as never } })
    const turnEnd = () => ({ type: 'turn/end' as const, data: { turn: 1, reason: 'completed' } })

    // Turn 1: a failure restored to next-turn before the boundary → no fail.
    emit({}, failure('m1'))
    emit({}, splice('next-turn', 'm1'))
    emit({}, turnEnd())
    expect(fail).not.toHaveBeenCalled()

    // Turn 2: a failure spliced into next-step stays pending → fails at the boundary.
    emit({}, failure('m2'))
    emit({}, splice('next-step', 'm2'))
    emit({}, turnEnd())
    expect(fail).toHaveBeenCalledTimes(1)

    // Turn 3: an unrelated event never touches the boundary.
    emit({}, { type: 'turn/start', data: { turn: 2 } })
    expect(fail).toHaveBeenCalledTimes(1)
  })
})
