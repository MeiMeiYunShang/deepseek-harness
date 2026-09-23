// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionStatsProjection } from '@deepseek-ai/dsh-session-stats/types'
import { aggregateSessionStats, TaskStatsCard } from '../src/client/TaskStatsCard.tsx'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { BandTokens, ModelPrice } from '../src/client/pricing.ts'
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

/** Four token counts of one band, all zero unless a test sets them. */
const band = (counts: Partial<BandTokens> = {}): BandTokens => ({
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, ...counts,
})

const STATS = {
  turns: 3, steps: 5, llmMs: 1200, toolMs: 90_000,
  ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0, inputTokens: 0, routes: [],
}

const FLASH: ModelPrice = {
  baseUrl: 'https://api.deepseek.com',
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  peak: { cacheHit: 0.25, cacheMiss: 1, output: 2 },
  offPeak: { cacheHit: 0.125, cacheMiss: 0.5, output: 1 },
}

/** One route's reported buckets, in the projection's own shape. */
const route = (peak: Partial<BandTokens> = {}, offPeak: Partial<BandTokens> = {}) =>
  ({ provider: 'deepseek-official', model: 'deepseek-v4-flash', peak: band(peak), offPeak: band(offPeak) })

describe('TaskStatsCard', () => {
  it('sums counts and timings across the whole list', () => {
    render(<TaskStatsCard t={t} byId={{
      s1: session('s1', { running: true, projectionValues: { sessionStats: STATS } }),
      s2: session('s2', { projectionValues: { sessionStats: { ...STATS, turns: 2, steps: 1, llmMs: 100, toolMs: 200 } } }),
    }} scope={undefined} titleOf={() => undefined} prices={[]} collapsed={false} onToggleCollapse={() => {}} />)
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
    }} scope="s1" titleOf={() => 'Selected'} prices={[]} collapsed={false} onToggleCollapse={() => {}} />)
    expect(screen.getByText('3')).toBeTruthy() // only s1 turns
    expect(screen.getByText('1')).toBeTruthy() // running count
    // scope line
    expect(screen.getByText(new RegExp(en.taskScope))).toBeTruthy()
    expect(screen.getByText(/Selected/)).toBeTruthy()
  })

  it('falls back to the all-sessions label when the scoped title is unknown', () => {
    render(<TaskStatsCard t={t} byId={{
      s1: session('s1', { running: false, projectionValues: { sessionStats: STATS } }),
    }} scope="s1" titleOf={() => undefined} prices={[]} collapsed={false} onToggleCollapse={() => {}} />)
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

  it('aggregate reads a value without route buckets as no buckets', () => {
    // A host that predates the route buckets — or a persisted projection row at
    // an older state version — streams a value without `routes`; the absence is
    // a wire fact the declared type cannot express.
    const legacy = { ...STATS, routes: undefined } as unknown as SessionStatsProjection
    const stats = aggregateSessionStats({
      s1: session('s1', { projectionValues: { sessionStats: legacy } }),
    }, undefined)
    expect(stats.turns).toBe(3)
    expect(stats.routes).toEqual([])
  })

  it('aggregate merges every token count of both bands across sessions of one route', () => {
    const first = { ...STATS, routes: [route(
      { inputTokens: 10, outputTokens: 1, cacheReadTokens: 100, cacheWriteTokens: 1_000 },
      { inputTokens: 20, outputTokens: 2, cacheReadTokens: 200, cacheWriteTokens: 2_000 },
    )] }
    const second = { ...STATS, routes: [route(
      { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 },
      { inputTokens: 5, outputTokens: 6, cacheReadTokens: 7, cacheWriteTokens: 8 },
    )] }

    const stats = aggregateSessionStats({
      s1: session('s1', { projectionValues: { sessionStats: first } }),
      s2: session('s2', { projectionValues: { sessionStats: second } }),
    }, undefined)

    expect(stats.routes).toEqual([{
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      peak: band({ inputTokens: 11, outputTokens: 3, cacheReadTokens: 103, cacheWriteTokens: 1_004 }),
      offPeak: band({ inputTokens: 25, outputTokens: 8, cacheReadTokens: 207, cacheWriteTokens: 2_008 }),
    }])
    // The accumulator adds into its own bands: the reported ones stay as they were.
    expect(first.routes[0]!.peak).toEqual(band({ inputTokens: 10, outputTokens: 1, cacheReadTokens: 100, cacheWriteTokens: 1_000 }))
  })

  it('hides the counts when collapsed', () => {
    render(<TaskStatsCard t={t} byId={{ s1: session('s1', { projectionValues: { sessionStats: STATS } }) }} scope="s1" titleOf={() => 'Selected'} prices={[]} collapsed onToggleCollapse={() => {}} />)
    expect(screen.getByText(en.taskStats)).toBeTruthy()
    expect(screen.queryByText('3')).toBeNull()
  })

  it('shows the priced cost over the whole list and folds two sessions of one model together', () => {
    const routed = { ...STATS, routes: [route({ inputTokens: 1_000_000 })] }
    render(<TaskStatsCard
      t={t}
      byId={{
        s1: session('s1', { projectionValues: { sessionStats: routed } }),
        s2: session('s2', { projectionValues: { sessionStats: routed } }),
      }}
      scope={undefined}
      titleOf={() => undefined}
      prices={[FLASH]}
      collapsed={false}
      onToggleCollapse={() => {}}
    />)
    // Two sessions on the same route bill as that route: 2M uncached input at 1 each.
    expect(screen.getByText(en.taskCost)).toBeTruthy()
    expect(screen.getByText('2.00')).toBeTruthy()
  })

  it('charges the off-peak band at the off-peak rate', () => {
    render(<TaskStatsCard
      t={t}
      byId={{ s1: session('s1', { projectionValues: { sessionStats: {
        ...STATS,
        routes: [route({}, { inputTokens: 1_000_000 })],
      } } }) }}
      scope={undefined}
      titleOf={() => undefined}
      prices={[FLASH]}
      collapsed={false}
      onToggleCollapse={() => {}}
    />)
    // 1M off-peak uncached input at 0.5, not at the peak rate of 1.
    expect(screen.getByText('0.5000')).toBeTruthy()
  })

  it('marks the cost unpriced rather than zero when the table omits a route', () => {
    render(<TaskStatsCard
      t={t}
      byId={{ s1: session('s1', { projectionValues: { sessionStats: {
        ...STATS,
        routes: [{ provider: 'local', model: 'llama', peak: band({ inputTokens: 10 }), offPeak: band({ outputTokens: 10 }) }],
      } } }) }}
      scope={undefined}
      titleOf={() => undefined}
      prices={[]}
      collapsed={false}
      onToggleCollapse={() => {}}
    />)
    expect(screen.getByText(en.taskCostUnpriced)).toBeTruthy()
  })

  it('marks the cost ambiguous when two rows price the route through different endpoints', () => {
    render(<TaskStatsCard
      t={t}
      byId={{ s1: session('s1', { projectionValues: { sessionStats: {
        ...STATS,
        routes: [route({ inputTokens: 1_000_000 })],
      } } }) }}
      scope={undefined}
      titleOf={() => undefined}
      prices={[FLASH, { ...FLASH, baseUrl: 'https://proxy.example.com' }]}
      collapsed={false}
      onToggleCollapse={() => {}}
    />)
    // A bucket names no endpoint, so neither row's rate may be charged.
    expect(screen.getByText(en.taskCostAmbiguous)).toBeTruthy()
  })

  it('omits the cost item when the scope is a single session', () => {
    render(<TaskStatsCard
      t={t}
      byId={{ s1: session('s1', { projectionValues: { sessionStats: {
        ...STATS,
        routes: [route({ inputTokens: 1_000_000 })],
      } } }) }}
      scope="s1"
      titleOf={() => 'Selected'}
      prices={[FLASH]}
      collapsed={false}
      onToggleCollapse={() => {}}
    />)
    expect(screen.queryByText(en.taskCost)).toBeNull()
  })
})
