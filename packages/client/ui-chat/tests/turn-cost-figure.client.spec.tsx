// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { ModelPrice } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatsTurnRoute } from '@deepseek-ai/dsh-session-stats/client'
import { TurnCostFigure } from '../src/client/chat/TurnCostFigure.tsx'
import { zh } from '../src/client/locale.ts'
import { en } from '../src/client/locale.ts'

afterEach(cleanup)

const t = makeTranslate(en, commonEn)

const TABLE: readonly ModelPrice[] = [{
  baseUrl: 'https://api.deepseek.com',
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  peak: { cacheHit: 0.25, cacheMiss: 1, output: 2 },
  offPeak: { cacheHit: 0.125, cacheMiss: 0.5, output: 1 },
}]

/** Two rows that differ only by endpoint: one model reached through two of them. */
const SPLIT_ENDPOINTS: readonly ModelPrice[] = [
  TABLE[0]!,
  { ...TABLE[0]!, baseUrl: 'https://proxy.example.com' },
]

const band = (counts: Partial<SessionStatsTurnRoute['peak']> = {}): SessionStatsTurnRoute['peak'] =>
  ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, ...counts })

const turnRoute = (
  turn: number,
  peak: Partial<SessionStatsTurnRoute['peak']> = {},
  offPeak: Partial<SessionStatsTurnRoute['peak']> = {},
): SessionStatsTurnRoute => ({
  turn,
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  peak: band(peak),
  offPeak: band(offPeak),
})

/** Projection seat serving one `sessionStats` value for the key this figure reads. */
function projections(value: unknown): UseProjection {
  return (key: string, selector?: (value: unknown) => unknown) => {
    const served = key === 'sessionStats' ? value : undefined
    return selector === undefined ? served : selector(served)
  }
}

describe('TurnCostFigure', () => {
  it('prices the Turn own buckets against the operator table', () => {
    // Peak 1M uncached input at 1 + off-peak 1M output at 1 = 2.
    const view = render(<TurnCostFigure
      turn={7}
      prices={TABLE}
      useProjection={projections({ turnRoutes: [
        turnRoute(7, { inputTokens: 1_000_000 }, { outputTokens: 1_000_000 }),
      ] })}
      t={t}
    />)
    expect(view.container.textContent).toBe('¥2.00')
  })

  it('keeps sub-unit charges readable instead of collapsing them to zero', () => {
    const view = render(<TurnCostFigure
      turn={1}
      prices={TABLE}
      useProjection={projections({ turnRoutes: [turnRoute(1, { inputTokens: 1_000 })] })}
      t={t}
    />)
    expect(view.container.textContent).toBe('¥0.0010')
  })

  it('prices only the Turn it belongs to', () => {
    const view = render(<TurnCostFigure
      turn={2}
      prices={TABLE}
      useProjection={projections({ turnRoutes: [
        turnRoute(1, { inputTokens: 1_000_000 }),
        turnRoute(2, { outputTokens: 1_000_000 }),
      ] })}
      t={t}
    />)
    // Turn 2's own 1M output at 2, never Turn 1's uncached input.
    expect(view.container.textContent).toBe('¥2.00')
  })

  it('reports a route the table does not list as unpriced rather than charging zero', () => {
    const view = render(<TurnCostFigure
      turn={1}
      prices={TABLE}
      useProjection={projections({ turnRoutes: [{
        ...turnRoute(1, { inputTokens: 1_000_000 }),
        provider: 'local',
        model: 'llama',
      }] })}
      t={t}
    />)
    expect(view.container.textContent).toBe('Unpriced')
  })

  it('reports an empty operator table as unpriced rather than free', () => {
    const view = render(<TurnCostFigure
      turn={1}
      prices={[]}
      useProjection={projections({ turnRoutes: [turnRoute(1, { inputTokens: 1_000_000 })] })}
      t={t}
    />)
    expect(view.container.textContent).toBe('Unpriced')
  })

  it('reports a route several rows price as ambiguous instead of picking an endpoint', () => {
    const view = render(<TurnCostFigure
      turn={1}
      prices={SPLIT_ENDPOINTS}
      useProjection={projections({ turnRoutes: [turnRoute(1, { inputTokens: 1_000_000 })] })}
      t={t}
    />)
    expect(view.container.textContent).toBe('Ambiguous price')
  })

  it('shows nothing for a Turn the projection attributed no route tokens to', () => {
    const absent = render(<TurnCostFigure turn={1} prices={TABLE} useProjection={projections(undefined)} t={t} />)
    expect(absent.container.textContent).toBe('')
    const other = render(<TurnCostFigure
      turn={3}
      prices={TABLE}
      useProjection={projections({ turnRoutes: [turnRoute(1, { inputTokens: 1_000_000 })] })}
      t={t}
    />)
    expect(other.container.textContent).toBe('')
    const empty = render(<TurnCostFigure
      turn={1}
      prices={TABLE}
      useProjection={projections({ turnRoutes: [] })}
      t={t}
    />)
    expect(empty.container.textContent).toBe('')
  })

  it('carries the currency symbol and both reason labels in the dictionary', () => {
    expect(makeTranslate(zh, commonEn)('message.turnCost.amount', { amount: '0.0010' })).toBe('¥0.0010')
    expect(makeTranslate(zh, commonEn)('message.turnCost.unpriced')).toBe('未定价')
    expect(makeTranslate(zh, commonEn)('message.turnCost.ambiguous')).toBe('价格不唯一')
  })
})
