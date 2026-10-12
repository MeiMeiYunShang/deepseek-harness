import { describe, expect, it } from 'vitest'
import {
  SESSION_BUCKETS, sessionBucket, sessionBucketLabel, sessionPhase, sessionPhaseLabel,
} from '../src/client/sessionState.ts'
import type { SessionBucket } from '../src/client/sessionState.ts'

const summary = { running: false, blank: false } as never

describe('sessionState', () => {
  it('derives the archived phase before every other signal', () => {
    expect(sessionPhase(summary, undefined, true)).toBe('archived')
    expect(sessionPhase(summary, 'question', true)).toBe('archived')
    expect(sessionPhase(summary, 'approval', true)).toBe('archived')
  })

  it('derives running before the pending-interaction signals', () => {
    expect(sessionPhase({ running: true } as never, 'question', false)).toBe('running')
    expect(sessionPhase({ running: true } as never, 'plan-review', false)).toBe('running')
    expect(sessionPhase({ running: true } as never, 'approval', false)).toBe('running')
  })

  it('maps a plan-review pending to planning and a question to pending', () => {
    expect(sessionPhase(summary, 'plan-review', false)).toBe('planning')
    expect(sessionPhase(summary, 'question', false)).toBe('pending')
  })

  it('maps the approval kind to the waiting phase the union reserved for it', () => {
    // Without this arm an approval wait draws the available tone inside the
    // awaiting-input bucket the grid tiles it by.
    expect(sessionPhase(summary, 'approval', false)).toBe('waiting')
  })

  it('gives every pending kind its own phase and leaves the rest available', () => {
    const phases = ['plan-review', 'question', 'approval', 'a-kind-no-domain-publishes-yet']
      .map(pendingKind => sessionPhase(summary, pendingKind, false))
    expect(phases).toEqual(['planning', 'pending', 'waiting', 'available'])
  })

  it('defaults an idle session to available', () => {
    expect(sessionPhase(summary, undefined, false)).toBe('available')
    expect(sessionPhase(summary, 'irrelevant', false)).toBe('available')
  })

  it('labels every phase with a dictionary key', () => {
    expect(sessionPhaseLabel('running')).toBe('sessionStatus.running')
    expect(sessionPhaseLabel('planning')).toBe('sessionStatus.planning')
    expect(sessionPhaseLabel('pending')).toBe('sessionStatus.pending')
    expect(sessionPhaseLabel('waiting')).toBe('sessionStatus.waiting')
    expect(sessionPhaseLabel('archived')).toBe('sessionStatus.archived')
    expect(sessionPhaseLabel('available')).toBe('sessionStatus.available')
  })
})

describe('sessionBucket', () => {
  const running = { running: true, blank: false } as never
  const idle = { running: false, blank: false } as never

  it('assigns each of the four buckets', () => {
    expect(sessionBucket(running, undefined, false)).toBe('running')
    expect(sessionBucket(idle, 'question', false)).toBe('pending')
    expect(sessionBucket(idle, 'plan-review', false)).toBe('pending')
    expect(sessionBucket(idle, undefined, false)).toBe('available')
    expect(sessionBucket(idle, undefined, true)).toBe('archived')
  })

  it('buckets a session awaiting any pending interaction as awaiting input', () => {
    // Every kind a domain publishes awaits the operator, so the bucket reads
    // the kind's presence rather than an enumeration of kinds. `approval`
    // (`ui-approval`) is the kind a two-kind list left out, and the last entry
    // is one no domain publishes yet; both still land in the bucket.
    for (const pendingKind of ['question', 'plan-review', 'approval', 'a-kind-no-domain-publishes-yet']) {
      expect(sessionBucket(idle, pendingKind, false)).toBe('pending')
    }
    expect(sessionBucket(idle, undefined, false)).toBe('available')
  })

  it('agrees with the awaiting-input count over the same rows', () => {
    // The statistics view counts `pendingKindOf(id) !== undefined` and the grid
    // tiles the `pending` bucket; a row set written either way must therefore
    // hold the same number for both.
    const kinds: readonly (string | undefined)[] = ['approval', 'question', 'plan-review', undefined]
    const counted = kinds.filter(pendingKind => pendingKind !== undefined).length
    const bucketed = kinds.filter(pendingKind => sessionBucket(idle, pendingKind, false) === 'pending').length
    expect(counted).toBe(3)
    expect(bucketed).toBe(counted)
  })

  it('never double-assigns: a session matching several buckets takes the earliest one', () => {
    for (const pendingKind of [undefined, 'question', 'plan-review', 'approval']) {
      expect(sessionBucket(running, pendingKind, true)).toBe('archived')
      expect(sessionBucket(running, pendingKind, false)).toBe('running')
      expect(sessionBucket(idle, pendingKind, true)).toBe('archived')
      expect(sessionBucket(idle, pendingKind, false))
        .toBe(pendingKind === undefined ? 'available' : 'pending')
    }
  })

  it('is total: every combination of signals lands in exactly one listed bucket', () => {
    const reached = new Set<SessionBucket>()
    for (const archived of [false, true]) {
      for (const runningState of [false, true]) {
        for (const pendingKind of [undefined, 'question', 'plan-review', 'approval']) {
          const bucket = sessionBucket({ running: runningState, blank: false } as never, pendingKind, archived)
          // One returned value per input, and always a bucket the filter lists.
          expect(SESSION_BUCKETS).toContain(bucket)
          reached.add(bucket)
        }
      }
    }
    expect([...reached].sort()).toEqual([...SESSION_BUCKETS].sort())
  })

  it('labels every bucket with a dictionary key', () => {
    expect(SESSION_BUCKETS.map(sessionBucketLabel)).toEqual([
      'sessionRunning', 'sessionPending', 'sessionIdle', 'sessionArchived',
    ])
  })
})
