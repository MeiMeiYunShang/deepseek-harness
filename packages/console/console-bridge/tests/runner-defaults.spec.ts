import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { runDshTask, type TaskOutcome } from '../src/runner.ts'

interface Fixture {
  ctx: Context
  agents: AgentRegistry
  onFollowup: () => void
  emit(event: object): void
  lastAgentOptions: Record<string, unknown> | undefined
}

function makeFixture(ctxGet?: (key: string) => unknown): Fixture {
  const listeners: Array<(session: { header: { id: string } }, event: object) => void> = []
  let idleResolve: () => void = () => undefined
  const idlePromise: Promise<void> = new Promise((resolve) => { idleResolve = resolve })
  let lastSessionId = ''
  let lastAgentOptions: Record<string, unknown> | undefined
  const emit = (event: object): void => {
    for (const listener of listeners) listener({ header: { id: lastSessionId } }, event)
    if ((event as { type?: string }).type === 'turn/end') idleResolve()
  }
  const fixture: Fixture = {
    ctx: {
      logger: { info() {}, warn() {}, error() {} },
      get: (key: string) => ctxGet?.(key),
      on(event: string, handler: (session: { header: { id: string } }, e: object) => void) {
        if (event === 'session/event') {
          listeners.push(handler)
          return () => undefined
        }
        return () => undefined
      },
    } as unknown as Context,
    agents: {
      async create(options: { sessionId: string; agentOptions: Record<string, unknown> }) {
        lastSessionId = options.sessionId
        lastAgentOptions = options.agentOptions
        const session = { header: { id: options.sessionId } }
        return {
          agent: {
            session,
            followup() { fixture.onFollowup() },
            whenIdle: () => idlePromise,
            cancel: () => { idleResolve() },
          },
          dispose: async () => undefined,
        }
      },
    } as unknown as AgentRegistry,
    onFollowup: () => undefined,
    emit,
    get lastAgentOptions() { return lastAgentOptions },
  }
  return fixture
}

const assistantEvent = (text: string) => ({
  type: 'assistant/message',
  data: { message: { content: [{ type: 'text', text }] } },
})
const turnEndEvent = (kind: string, error?: string) => ({
  type: 'turn/end',
  data: { reason: kind === 'error' ? { kind, error: { message: error ?? 'boom' } } : { kind } },
})

describe('runDshTask agent option resolution', () => {
  it('uses the explicit provider/model when both are pinned', async () => {
    const fixture = makeFixture()
    fixture.onFollowup = () => {
      fixture.emit(assistantEvent('ok'))
      fixture.emit(turnEndEvent('completed'))
    }
    await runDshTask(fixture.ctx, fixture.agents, { prompt: 'hi', timeoutMs: 5000, provider: 'p', model: 'm' })
    expect(fixture.lastAgentOptions).toEqual({ provider: 'p', model: 'm' })
  })

  it('falls back to the deployment default model selection', async () => {
    const fixture = makeFixture(() => ({
      currentSelection: () => ({ provider: 'def-p', model: 'def-m' }),
    }))
    fixture.onFollowup = () => {
      fixture.emit(assistantEvent('ok'))
      fixture.emit(turnEndEvent('completed'))
    }
    await runDshTask(fixture.ctx, fixture.agents, { prompt: 'hi', timeoutMs: 5000 })
    expect(fixture.lastAgentOptions).toEqual({ provider: 'def-p', model: 'def-m' })
  })

  it('returns explicit options when no default selection is available', async () => {
    const fixture = makeFixture(() => undefined)
    fixture.onFollowup = () => {
      fixture.emit(assistantEvent('ok'))
      fixture.emit(turnEndEvent('completed'))
    }
    const outcome: TaskOutcome = await runDshTask(fixture.ctx, fixture.agents, { prompt: 'hi', timeoutMs: 5000 })
    expect(outcome.exitCode).toBe(0)
    expect(fixture.lastAgentOptions).toEqual({})
  })

  it('returns explicit options when the default selection is empty', async () => {
    const fixture = makeFixture(() => ({ currentSelection: () => ({ provider: '', model: '' }) }))
    fixture.onFollowup = () => {
      fixture.emit(assistantEvent('ok'))
      fixture.emit(turnEndEvent('completed'))
    }
    await runDshTask(fixture.ctx, fixture.agents, { prompt: 'hi', timeoutMs: 5000 })
    expect(fixture.lastAgentOptions).toEqual({})
  })
})

describe('runDshTask error summaries', () => {
  it('uses assistant text when the error turn carries an empty message', async () => {
    const fixture = makeFixture()
    fixture.onFollowup = () => {
      fixture.emit(assistantEvent('partial'))
      fixture.emit(turnEndEvent('error', ''))
    }
    const outcome = await runDshTask(fixture.ctx, fixture.agents, { prompt: 'boom', timeoutMs: 5000 })
    expect(outcome.exitCode).toBe(1)
    expect(outcome.summary).toBe('partial')
  })

  it('falls back to a no-output marker when the error turn has no text', async () => {
    const fixture = makeFixture()
    fixture.onFollowup = () => {
      fixture.emit(turnEndEvent('error', ''))
    }
    const outcome = await runDshTask(fixture.ctx, fixture.agents, { prompt: 'boom', timeoutMs: 5000 })
    expect(outcome.summary).toBe('[failed] no assistant output')
  })

  it('keeps assistant text on a timeout instead of the timeout marker', async () => {
    const fixture = makeFixture()
    fixture.onFollowup = () => {
      fixture.emit(assistantEvent('slow-but-text'))
    }
    const outcome = await runDshTask(fixture.ctx, fixture.agents, { prompt: 'slow', timeoutMs: 30 })
    expect(outcome.exitCode).toBe(124)
    expect(outcome.summary).toBe('slow-but-text')
  })
})
