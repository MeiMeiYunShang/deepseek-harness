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
  const running = { running: true, completed: false } as never
  const completed = { running: false, completed: true } as never
  const both = { running: true, completed: true } as never

  it('assigns each of the five buckets', () => {
    expect(sessionBucket(running, undefined, false)).toBe('running')
    expect(sessionBucket(summary, 'question', false)).toBe('pending')
    expect(sessionBucket(summary, 'plan-review', false)).toBe('pending')
    expect(sessionBucket(completed, undefined, false)).toBe('completed')
    expect(sessionBucket(summary, undefined, false)).toBe('available')
    expect(sessionBucket(summary, undefined, true)).toBe('archived')
  })

  it('buckets a session awaiting any pending interaction as awaiting input', () => {
    // Every kind a domain publishes awaits the operator, so the bucket reads
    // the kind's presence rather than an enumeration of kinds. `approval`
    // (`ui-approval`) is the kind a two-kind list left out; the last row of
    // each pair pins the predicate as presence alone.
    for (const pendingKind of ['question', 'plan-review', 'approval', 'a-kind-no-domain-publishes-yet']) {
      expect(sessionBucket(summary, pendingKind, false)).toBe('pending')
      expect(sessionBucket(completed, pendingKind, false)).toBe('pending')
    }
  })

  it('agrees with the awaiting-input count over the same rows', () => {
    // The statistics view counts `pendingKindOf(id) !== undefined` and the grid
    // tiles the `pending` bucket; a row set written either way must therefore
    // hold the same number for both.
    const kinds: readonly (string | undefined)[] = ['approval', 'question', 'plan-review', undefined]
    const counted = kinds.filter(pendingKind => pendingKind !== undefined).length
    const bucketed = kinds.filter(pendingKind => sessionBucket(summary, pendingKind, false) === 'pending').length
    expect(counted).toBe(3)
    expect(bucketed).toBe(counted)
  })

  it('never double-assigns: a session matching several buckets takes the earliest one', () => {
    for (const pendingKind of [undefined, 'question', 'plan-review', 'approval']) {
      expect(sessionBucket(both, pendingKind, true)).toBe('archived')
      expect(sessionBucket(both, pendingKind, false)).toBe('running')
      expect(sessionBucket(completed, pendingKind, false))
        .toBe(pendingKind === undefined ? 'completed' : 'pending')
      expect(sessionBucket(summary, pendingKind, false))
        .toBe(pendingKind === undefined ? 'available' : 'pending')
    }
  })

  it('is total: every combination of signals lands in exactly one listed bucket', () => {
    const reached = new Set<SessionBucket>()
    for (const archived of [false, true]) {
      for (const running of [false, true]) {
        for (const completed of [false, true]) {
          for (const pendingKind of [undefined, 'question', 'plan-review', 'approval']) {
            const bucket = sessionBucket({ running, completed } as never, pendingKind, archived)
            // One returned value per input, and always a bucket the filter lists.
            expect(SESSION_BUCKETS).toContain(bucket)
            reached.add(bucket)
          }
        }
      }
    }
    expect([...reached].sort()).toEqual([...SESSION_BUCKETS].sort())
  })

  it('labels every bucket with a dictionary key', () => {
    expect(SESSION_BUCKETS.map(sessionBucketLabel)).toEqual([
      'sessionRunning', 'sessionPending', 'sessionCompleted', 'sessionIdle', 'sessionArchived',
    ])
  })
})
