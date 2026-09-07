/** MCP security settings store: load state and the shared catalog + stats window. */

import { describe, expect, it } from 'vitest'
import type { ServerView, StatsData } from '../src/client/types.ts'
import { createMcpSecStore } from '../src/client/store.ts'

const server: ServerView = {
  id: 'e1', serverName: 'gh', transport: 'streamable-http', url: 'https://api.github.com',
  command: undefined, args: [], cwd: undefined, envCount: 1, headersCount: 0,
  toolCallTimeoutMs: undefined, failOnStartupError: false, scope: 'read-only',
  toolRules: {}, tools: ['get_issue'], disabled: false, fiberPhase: 'active',
}

const stats: StatsData = {
  threshold: 50, windowMs: 600000,
  servers: [{ server: 'gh', calls: 1, failures: 0, blocked: 0, authErrors: 0, credArgs: 0, maxKB: 0, avgDurMs: 5, spike: false, score: 10, reasons: [] }],
  alerts: [{ server: 'gh', score: 60, reasons: ['cred'] }],
}

describe('mcpsec settings store', () => {
  it('starts idle with an empty catalog and default stats', () => {
    const instance = createMcpSecStore().create()
    expect(instance.getSnapshot()).toEqual({
      status: 'idle', error: null, servers: [], stats: { threshold: 50, windowMs: 0, servers: [], alerts: [] },
    })
  })

  it('marks a load in progress only from a non-ready status', () => {
    const instance = createMcpSecStore().create()
    instance.actions.beginLoad()
    expect(instance.getSnapshot().status).toBe('loading')
    expect(instance.getSnapshot().error).toBeNull()
    // A background refresh on a ready store keeps the ready status (no flicker).
    instance.actions.setData([server], stats)
    instance.actions.beginLoad()
    expect(instance.getSnapshot().status).toBe('ready')
  })

  it('publishes the fetched catalog and stats window', () => {
    const instance = createMcpSecStore().create()
    instance.actions.setData([server], stats)
    const snapshot = instance.getSnapshot()
    expect(snapshot.status).toBe('ready')
    expect(snapshot.servers).toEqual([server])
    expect(snapshot.stats.alerts).toEqual(stats.alerts)
  })

  it('reports a failed load as an error with the message', () => {
    const instance = createMcpSecStore().create()
    instance.actions.beginLoad()
    instance.actions.setFailed('boom')
    const snapshot = instance.getSnapshot()
    expect(snapshot.status).toBe('error')
    expect(snapshot.error).toBe('boom')
  })

  it('gives every instance a fresh state', () => {
    const first = createMcpSecStore().create()
    const second = createMcpSecStore().create()
    first.actions.setData([server], stats)
    expect(second.getSnapshot().servers).toHaveLength(0)
  })
})
