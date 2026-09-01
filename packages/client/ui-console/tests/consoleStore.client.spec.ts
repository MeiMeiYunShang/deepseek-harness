import { describe, expect, it } from 'vitest'
import { createConsoleStore } from '../src/client/consoleStore.ts'

describe('createConsoleStore', () => {
  it('starts empty with a bounded timeline and no host sample', () => {
    const store = createConsoleStore().create()
    expect(store.getSnapshot()).toEqual({
      timeline: [],
      seq: 0,
      systemStatus: null,
      timelineMode: 'brief',
    })
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

  it('updates the system sample and the timeline mode', () => {
    const store = createConsoleStore().create()
    store.actions.updateSystemStatus({ cpu: 42, memory: 61, gpu: null })
    expect(store.getSnapshot().systemStatus).toEqual({ cpu: 42, memory: 61, gpu: null })

    store.actions.setTimelineMode('all')
    expect(store.getSnapshot().timelineMode).toBe('all')

    store.actions.setTimelineMode('brief')
    expect(store.getSnapshot().timelineMode).toBe('brief')
  })
})
