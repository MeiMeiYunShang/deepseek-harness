import { describe, expect, it } from 'vitest'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createConsoleStore, historyEntries } from '../src/client/consoleStore.ts'

/** One list row for the history projection. */
function summary(id: string, updatedAt: number, displayTitle = id): SessionSummary {
  return { id: id as SessionId, displayTitle, running: false, blank: false, updatedAt }
}

/** A session-list snapshot in host order. */
function list(rows: readonly SessionSummary[]): SessionListState {
  return {
    ids: rows.map(row => row.id),
    byId: Object.fromEntries(rows.map(row => [row.id, row])),
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

describe('createConsoleStore', () => {
  it('starts empty with a bounded timeline, showing every kind by default', () => {
    const store = createConsoleStore().create()
    // The console holds one scope, not two: `selectedSession` is the whole set
    // of state a grid click can move.
    expect(store.getSnapshot()).toEqual({
      open: false,
      timeline: [],
      seq: 0,
      systemStatus: null,
      timelineMode: 'all',
      sessionView: 'stats',
      selectedSession: undefined,
      layout: 'balanced',
      collapsed: {},
    })
  })

  it('tracks the workbench open state the sidebar trigger drives', () => {
    const store = createConsoleStore().create()
    expect(store.getSnapshot().open).toBe(false)

    store.actions.setOpen(true)
    expect(store.getSnapshot().open).toBe(true)

    store.actions.setOpen(false)
    expect(store.getSnapshot().open).toBe(false)
  })

  it('appends timeline entries with monotonically increasing ids', () => {
    const store = createConsoleStore().create()
    store.actions.pushTimeline({ sessionId: 's1', time: 100, kind: 'activity' })
    store.actions.pushTimeline({ sessionId: 's2', time: 200, kind: 'status' })
    const entries = store.getSnapshot().timeline
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ id: 1, sessionId: 's1', time: 100, kind: 'activity' })
    expect(entries[1]).toMatchObject({ id: 2, sessionId: 's2', time: 200, kind: 'status' })
  })

  it('caps the timeline window at 200 entries', () => {
    const store = createConsoleStore().create()
    for (let i = 0; i < 205; i += 1) {
      store.actions.pushTimeline({ sessionId: 's', time: i, kind: 'activity' })
    }
    const entries = store.getSnapshot().timeline
    expect(entries).toHaveLength(200)
    expect(entries[0]).toMatchObject({ id: 6, time: 5 })
    expect(entries.at(-1)).toMatchObject({ id: 205 })
  })

  it('updates the system sample and the view/timeline writers', () => {
    const store = createConsoleStore().create()
    store.actions.updateSystemStatus({ cpu: 42, memory: 61, gpu: null })
    expect(store.getSnapshot().systemStatus).toEqual({ cpu: 42, memory: 61, gpu: null })

    store.actions.setTimelineMode('all')
    expect(store.getSnapshot().timelineMode).toBe('all')
    store.actions.setTimelineMode('brief')
    expect(store.getSnapshot().timelineMode).toBe('brief')

    store.actions.setSessionView('grid')
    expect(store.getSnapshot().sessionView).toBe('grid')
    store.actions.setSessionView('stats')
    expect(store.getSnapshot().sessionView).toBe('stats')

    store.actions.setSelectedSession('s1')
    expect(store.getSnapshot().selectedSession).toBe('s1')
    store.actions.setSelectedSession(undefined)
    expect(store.getSnapshot().selectedSession).toBeUndefined()

    store.actions.setLayout('timeline')
    expect(store.getSnapshot().layout).toBe('timeline')
    store.actions.setLayout('compact')
    expect(store.getSnapshot().layout).toBe('compact')

    store.actions.toggleCollapsed('session')
    expect(store.getSnapshot().collapsed.session).toBe(true)
    store.actions.toggleCollapsed('session')
    expect(store.getSnapshot().collapsed.session).toBe(false)
  })
})

describe('historyEntries', () => {
  it('projects one history row per listed session, oldest update first, each with its display title', () => {
    expect(historyEntries(list([
      summary('newer', 300, 'Newer work'),
      summary('older', 100, 'Older work'),
    ]))).toEqual([
      { sessionId: 'older', time: 100, kind: 'history', title: 'Older work' },
      { sessionId: 'newer', time: 300, kind: 'history', title: 'Newer work' },
    ])
  })

  it('seeds nothing from an empty list', () => {
    expect(historyEntries(list([]))).toEqual([])
  })

  it('skips a listed id that carries no row', () => {
    const orphaned: SessionListState = {
      ...list([summary('listed', 100)]),
      ids: ['listed' as SessionId, 'gone' as SessionId],
    }
    expect(historyEntries(orphaned)).toEqual([{ sessionId: 'listed', time: 100, kind: 'history', title: 'listed' }])
  })
})
