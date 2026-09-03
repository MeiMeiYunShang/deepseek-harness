// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-session-stats/types'
import { aggregateSessionStats, TaskStatsCard } from '../src/client/TaskStatsCard.tsx'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: string): string => (en as Record<string, string>)[key] ?? key

function session(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: id as SessionSummary['id'],
    displayTitle: id,
    running: false,
    blank: false,
    updatedAt: 0,
    ...overrides,
  }
}

const STATS = { turns: 3, steps: 5, llmMs: 1200, toolMs: 90_000, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 }

describe('TaskStatsCard', () => {
  it('sums counts and timings across the whole list', () => {
    render(<TaskStatsCard t={t} byId={{
      s1: session('s1', { running: true, projectionValues: { sessionStats: STATS } }),
      s2: session('s2', { projectionValues: { sessionStats: { ...STATS, turns: 2, steps: 1, llmMs: 100, toolMs: 200 } } }),
    }} scope={undefined} titleOf={() => undefined} collapsed={false} onToggleCollapse={() => {}} />)
    expect(screen.getByText('5')).toBeTruthy() // turns 3+2
    expect(screen.getByText('6')).toBeTruthy() // steps 5+1
    expect(screen.getByText('1.3s')).toBeTruthy() // llm
    expect(screen.getByText('1m30s')).toBeTruthy() // tool
    expect(screen.getByText('1')).toBeTruthy() // running count
    expect(screen.getByText(new RegExp(en.taskAllSessions))).toBeTruthy()
  })

  it('scopes to a single session and renders the all-sessions label fallback', () => {
    render(<TaskStatsCard t={t} byId={{
      s1: session('s1', { running: true, projectionValues: { sessionStats: STATS } }),
      s2: session('s2', { projectionValues: { sessionStats: { ...STATS, turns: 99 } } }),
    }} scope="s1" titleOf={() => 'Selected'} collapsed={false} onToggleCollapse={() => {}} />)
    expect(screen.getByText('3')).toBeTruthy() // only s1 turns
    expect(screen.getByText('1')).toBeTruthy() // running count
    // scope line
    expect(screen.getByText(new RegExp(en.taskScope))).toBeTruthy()
    expect(screen.getByText(/Selected/)).toBeTruthy()
  })

  it('falls back to the all-sessions label when the scoped title is unknown', () => {
    render(<TaskStatsCard t={t} byId={{
      s1: session('s1', { running: false, projectionValues: { sessionStats: STATS } }),
    }} scope="s1" titleOf={() => undefined} collapsed={false} onToggleCollapse={() => {}} />)
    expect(screen.getByText(new RegExp(en.taskAllSessions))).toBeTruthy()
    // the scoped session is not running, so the running count is 0.
    expect(screen.getByText('0')).toBeTruthy()
  })

  it('aggregate ignores sessions without a stats projection', () => {
    const stats = aggregateSessionStats({
      s1: session('s1', { projectionValues: { sessionStats: STATS } }),
      s2: session('s2'),
    }, undefined)
    expect(stats.turns).toBe(3)
  })

  it('aggregate filters to the scope id', () => {
    const stats = aggregateSessionStats({
      s1: session('s1', { projectionValues: { sessionStats: STATS } }),
      s2: session('s2', { projectionValues: { sessionStats: { ...STATS, turns: 50 } } }),
    }, 's1')
    expect(stats.turns).toBe(3)
  })

  it('hides the counts when collapsed', () => {
    render(<TaskStatsCard t={t} byId={{ s1: session('s1', { projectionValues: { sessionStats: STATS } }) }} scope="s1" titleOf={() => 'Selected'} collapsed onToggleCollapse={() => {}} />)
    expect(screen.getByText(en.taskStats)).toBeTruthy()
    expect(screen.queryByText('3')).toBeNull()
  })
})
