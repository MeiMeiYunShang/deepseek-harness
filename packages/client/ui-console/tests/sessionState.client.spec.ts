import { describe, expect, it } from 'vitest'
import { sessionPhase, sessionPhaseLabel } from '../src/client/sessionState.ts'

const summary = { running: false, blank: false } as never

describe('sessionState', () => {
  it('derives the archived phase before every other signal', () => {
    expect(sessionPhase(summary, undefined, true)).toBe('archived')
    expect(sessionPhase(summary, 'question', true)).toBe('archived')
  })

  it('derives running before the pending-interaction signals', () => {
    expect(sessionPhase({ running: true } as never, 'question', false)).toBe('running')
    expect(sessionPhase({ running: true } as never, 'plan-review', false)).toBe('running')
  })

  it('maps a plan-review pending to planning and a question to pending', () => {
    expect(sessionPhase(summary, 'plan-review', false)).toBe('planning')
    expect(sessionPhase(summary, 'question', false)).toBe('pending')
  })

  it('defaults an idle session to available', () => {
    expect(sessionPhase(summary, undefined, false)).toBe('available')
    expect(sessionPhase(summary, 'irrelevant', false)).toBe('available')
  })

  it('labels every phase with a dictionary key', () => {
    expect(sessionPhaseLabel('running')).toBe('sessionStatusRunning')
    expect(sessionPhaseLabel('planning')).toBe('sessionStatusPlanning')
    expect(sessionPhaseLabel('pending')).toBe('sessionStatusPending')
    expect(sessionPhaseLabel('waiting')).toBe('sessionStatusWaiting')
    expect(sessionPhaseLabel('archived')).toBe('sessionStatusArchived')
    expect(sessionPhaseLabel('available')).toBe('sessionStatusAvailable')
  })
})
