import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { runDshTask, type TaskOutcome } from '../src/runner.ts'

interface Fixture {
  ctx: Context
  agents: AgentRegistry
  /** Drives session events; invoked from inside `followup`, after the runner registers its listener. */
  onFollowup: () => void
  /** Deliver a session event to the runner's listener. */
  emit(event: object): void
  /** Deliver a session event attributed to a specific session id. */
  emitAs(id: string, event: object): void
}

function makeFixture(): Fixture {
  const listeners: Array<(session: { header: { id: string } }, event: object) => void> = []
  let idleResolve: () => void = () => undefined
  const idlePromise: Promise<void> = new Promise((resolve) => {
    idleResolve = resolve
  })
  let lastSessionId = ''
  const emit = (event: object): void => {
    for (const listener of listeners) listener({ header: { id: lastSessionId } }, event)
    if ((event as { type?: string }).type === 'turn/end') idleResolve()
  }
  const emitAs = (id: string, event: object): void => {
    for (const listener of listeners) listener({ header: { id } }, event)
    if ((event as { type?: string }).type === 'turn/end') idleResolve()
  }
  const fixture: Fixture = {
    ctx: {
      logger: { info() {}, warn() {}, error() {} },
      get: () => undefined,
      on(event: string, handler: (session: { header: { id: string } }, e: object) => void) {
        if (event === 'session/event') {
          listeners.push(handler)
          return () => undefined
        }
        return () => undefined
      },
    } as unknown as Context,
    agents: {
      async create(options: { sessionId: string }) {
        lastSessionId = options.sessionId
        const session = { header: { id: options.sessionId } }
        return {
          agent: {
            session,
            followup() {
              fixture.onFollowup()
            },
            whenIdle: () => idlePromise,
            cancel: () => idleResolve(),
          },
          dispose: async () => undefined,
        }
      },
    } as unknown as AgentRegistry,
    onFollowup: () => undefined,
    emit,
    emitAs,
  }
  return fixture
}

const assistantEvent = (text: string) => ({
  type: 'assistant/message',
  data: { message: { content: [{ type: 'text', text }] } },
})

const turnEndEvent = (kind: string, error?: string) => ({
  type: 'turn/end',
  data: { reason: kind === 'error'
    ? { kind, error: { message: error ?? 'boom' } }
    : { kind } },
})

describe('runDshTask', () => {
  it('aggregates assistant text and reports success on a completed turn', async () => {
    const fixture = makeFixture()
    fixture.onFollowup = () => {
      fixture.emit(assistantEvent('11加22等于33。'))
      fixture.emit(turnEndEvent('completed'))
    }
    const outcome: TaskOutcome = await runDshTask(fixture.ctx, fixture.agents, {
      prompt: 'hi',
      timeoutMs: 5000,
    })
    expect(outcome.exitCode).toBe(0)
    expect(outcome.status).toBe('SUCCEEDED')
    expect(outcome.summary).toBe('11加22等于33。')
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('reports failure when the turn ends in error', async () => {
    const fixture = makeFixture()
    fixture.onFollowup = () => {
      fixture.emit(turnEndEvent('error'))
    }
    const outcome = await runDshTask(fixture.ctx, fixture.agents, { prompt: 'boom', timeoutMs: 5000 })
    expect(outcome.exitCode).toBe(1)
    expect(outcome.status).toBe('FAILED')
    expect(outcome.summary).toContain('boom')
  })

  it('honestly fails with exit code 124 on timeout', async () => {
    const fixture = makeFixture()
    fixture.onFollowup = () => undefined
    const outcome = await runDshTask(fixture.ctx, fixture.agents, { prompt: 'slow', timeoutMs: 30 })
    expect(outcome.exitCode).toBe(124)
    expect(outcome.status).toBe('FAILED')
    expect(outcome.summary).toContain('timeout')
  })

  it('truncates the summary to 1024 chars', async () => {
    const fixture = makeFixture()
    const longText = 'x'.repeat(2000)
    fixture.onFollowup = () => {
      fixture.emit(assistantEvent(longText))
      fixture.emit(turnEndEvent('completed'))
    }
    const outcome = await runDshTask(fixture.ctx, fixture.agents, { prompt: 'hi', timeoutMs: 5000 })
    expect(outcome.summary.length).toBe(1024)
  })

  it('ignores events from a different session', async () => {
    const fixture = makeFixture()
    fixture.onFollowup = () => {
      fixture.emitAs('other-session', assistantEvent('noise'))
      fixture.emit(assistantEvent('kept'))
      fixture.emit(turnEndEvent('completed'))
    }
    const outcome = await runDshTask(fixture.ctx, fixture.agents, { prompt: 'hi', timeoutMs: 5000 })
    expect(outcome.exitCode).toBe(0)
    expect(outcome.summary).toBe('kept')
  })

  it('collects only text blocks from a mixed assistant message', async () => {
    const fixture = makeFixture()
    fixture.onFollowup = () => {
      fixture.emit({
        type: 'assistant/message',
        data: { message: { content: [
          { type: 'tool_use', id: 'call_1', name: 'shell', input: { cmd: 'ls' } },
          { type: 'text', text: 'ran' },
          { type: 'image', source: { kind: 'base64', media_type: 'image/png', data: 'AAA' } },
        ] } },
      })
      fixture.emit(turnEndEvent('completed'))
    }
    const outcome = await runDshTask(fixture.ctx, fixture.agents, { prompt: 'hi', timeoutMs: 5000 })
    expect(outcome.summary).toBe('ran')
  })

  it('reports [no output] when a successful turn produced no assistant text', async () => {
    const fixture = makeFixture()
    fixture.onFollowup = () => {
      fixture.emit(turnEndEvent('completed'))
    }
    const outcome = await runDshTask(fixture.ctx, fixture.agents, { prompt: 'hi', timeoutMs: 5000 })
    expect(outcome.exitCode).toBe(0)
    expect(outcome.status).toBe('SUCCEEDED')
    expect(outcome.summary).toBe('[no output]')
  })
})
