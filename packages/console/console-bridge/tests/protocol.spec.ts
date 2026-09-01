import { describe, expect, it } from 'vitest'
import { normalizeExecTimeoutS, stripDshPrefix } from '../src/index.ts'
import type { ConsoleTransport } from '../src/transport.ts'
import type { DownCmdEnvelope } from '../src/types.ts'

class InMemoryTransport implements ConsoleTransport {
  private handlers = new Map<string, Array<(payload: DownCmdEnvelope) => void | Promise<void>>>()
  public published: Array<{ topic: string; payload: unknown }> = []

  async connect(): Promise<void> {
    /* no-op */
  }

  async publish(topic: string, payload: unknown): Promise<void> {
    this.published.push({ topic, payload })
  }

  async subscribe(
    topic: string,
    handler: (payload: DownCmdEnvelope) => void | Promise<void>,
  ): Promise<() => void> {
    const list = this.handlers.get(topic) ?? []
    list.push(handler)
    this.handlers.set(topic, list)
    return () => {
      this.handlers.set(
        topic,
        (this.handlers.get(topic) ?? []).filter(entry => entry !== handler),
      )
    }
  }

  async deliver(topic: string, payload: DownCmdEnvelope): Promise<void> {
    for (const handler of this.handlers.get(topic) ?? []) await handler(payload)
  }

  async dispose(): Promise<void> {
    /* no-op */
  }
}

describe('stripDshPrefix', () => {
  it('strips the local-dsh prefix', () => {
    expect(stripDshPrefix('local-dsh 11加22等于几')).toBe('11加22等于几')
  })

  it('strips the ds-harness prefix', () => {
    expect(stripDshPrefix('ds-harness do the thing')).toBe('do the thing')
  })

  it('returns bare text for non-DSH commands', () => {
    expect(stripDshPrefix('shell ls -la')).toBe('shell ls -la')
  })

  it('returns empty string for a prefix with no prompt', () => {
    expect(stripDshPrefix('local-dsh')).toBe('')
  })
})

describe('normalizeExecTimeoutS', () => {
  it('clamps below-range values to the default 10', () => {
    expect(normalizeExecTimeoutS(0)).toBe(10)
    expect(normalizeExecTimeoutS(-5)).toBe(10)
  })

  it('clamps above-range values to the default 10', () => {
    expect(normalizeExecTimeoutS(9999)).toBe(10)
  })

  it('accepts in-range values and floors fractions', () => {
    expect(normalizeExecTimeoutS(60)).toBe(60)
    expect(normalizeExecTimeoutS(60.9)).toBe(60)
  })

  it('falls back to the default for non-numeric input', () => {
    expect(normalizeExecTimeoutS('abc')).toBe(10)
    expect(normalizeExecTimeoutS(undefined)).toBe(10)
  })
})

describe('InMemoryTransport round-trip', () => {
  it('delivers published down/cmd to subscribers', async () => {
    const transport = new InMemoryTransport()
    const received: DownCmdEnvelope[] = []
    await transport.connect()
    const stop = await transport.subscribe('v1/agent/x/down/cmd', (payload) => {
      received.push(payload)
    })
    const envelope: DownCmdEnvelope = {
      id: 'cmd-1',
      seq: 1,
      ts: 0,
      agentId: 'x',
      type: 'cmd',
      payload: { cmdId: 'c1', command: 'local-dsh hi', execTimeoutS: 60, riskLevel: 'normal', priority: 'normal' },
    }
    await transport.deliver('v1/agent/x/down/cmd', envelope)
    expect(received).toHaveLength(1)
    expect(received[0]!.payload.cmdId).toBe('c1')

    stop()
    await transport.deliver('v1/agent/x/down/cmd', envelope)
    expect(received).toHaveLength(1)
  })
})
