import { describe, expect, it } from 'vitest'
import {
  costOf, formatAmount, priceOf, totalCost,
  type BandTokens, type ModelPrice, type RouteTokens,
} from '../src/pricing.ts'

const TABLE: readonly ModelPrice[] = [
  {
    baseUrl: 'https://api.deepseek.com',
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    peak: { cacheHit: 0.25, cacheMiss: 1, output: 2 },
    offPeak: { cacheHit: 0.125, cacheMiss: 0.5, output: 1 },
  },
  {
    baseUrl: 'https://proxy.example.com',
    provider: 'zhipu',
    model: 'glm-4v-flash',
    peak: { cacheHit: 0, cacheMiss: 0.5, output: 0 },
    offPeak: { cacheHit: 0, cacheMiss: 0.5, output: 0 },
  },
]

/** Two rows that differ only by endpoint: one model reached through two of them. */
const SPLIT_ENDPOINTS: readonly ModelPrice[] = [
  TABLE[0]!,
  { ...TABLE[0]!, baseUrl: 'https://proxy.example.com' },
]

const band = (counts: Partial<BandTokens> = {}): BandTokens => ({
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, ...counts,
})

const tokens = (
  provider: string,
  model: string,
  peak: Partial<BandTokens> = {},
  offPeak: Partial<BandTokens> = {},
): RouteTokens => ({ provider, model, peak: band(peak), offPeak: band(offPeak) })

describe('priceOf', () => {
  it('matches on both the provider and the model, never one alone', () => {
    expect(priceOf(TABLE, { provider: 'deepseek-official', model: 'deepseek-v4-flash' }))
      .toEqual({ kind: 'priced', price: TABLE[0] })
    expect(priceOf(TABLE, { provider: 'deepseek-official', model: 'deepseek-v4-pro' })).toEqual({ kind: 'unpriced' })
    expect(priceOf(TABLE, { provider: 'other', model: 'deepseek-v4-flash' })).toEqual({ kind: 'unpriced' })
  })

  it('reports an unlisted route rather than inventing a price', () => {
    expect(priceOf([], { provider: 'p', model: 'm' })).toEqual({ kind: 'unpriced' })
  })

  it('prices the pair when exactly one row carries it, whichever endpoint it names', () => {
    // A reported bucket carries no endpoint, so a row's own endpoint is not part
    // of the match: one row for the pair still prices it.
    expect(priceOf(SPLIT_ENDPOINTS.slice(0, 1), { provider: 'deepseek-official', model: 'deepseek-v4-flash' }))
      .toEqual({ kind: 'priced', price: TABLE[0] })
  })

  it('reports the pair as ambiguous when several rows carry it', () => {
    expect(priceOf(SPLIT_ENDPOINTS, { provider: 'deepseek-official', model: 'deepseek-v4-flash' }))
      .toEqual({ kind: 'ambiguous' })
  })
})

describe('costOf', () => {
  it('charges each band at its own rates', () => {
    const price = TABLE[0]!
    // Peak: 1M cache reads at 0.25 + 1M uncached input at 1 + 1M cache writes at
    // 1 + 1M output at 2 = 4.25. Off-peak, the same four counts at half: 2.125.
    expect(costOf(price, tokens('deepseek-official', 'deepseek-v4-flash',
      { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 },
      { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 },
    ))).toBe(6.375)
  })

  it('charges cache writes at the cache-miss rate, not the cache-hit rate', () => {
    // 1M cache-write tokens alone: 1 at the miss rate, not 0.25 at the hit rate.
    expect(costOf(TABLE[0]!, tokens('deepseek-official', 'deepseek-v4-flash', { cacheWriteTokens: 1_000_000 })))
      .toBe(1)
  })

  it('charges nothing for a zero-rate side', () => {
    // The off-peak output rate is zero, so its 1M output tokens cost nothing;
    // both bands' 1M uncached input at 0.5 makes the rest.
    expect(costOf(TABLE[1]!, tokens('zhipu', 'glm-4v-flash', { inputTokens: 1_000_000 }, { inputTokens: 1_000_000, outputTokens: 1_000_000 })))
      .toBe(1)
  })

  it('keeps sub-unit charges exact', () => {
    expect(costOf(TABLE[0]!, tokens('deepseek-official', 'deepseek-v4-flash', { inputTokens: 1_000 })))
      .toBe(0.001)
  })
})

describe('totalCost', () => {
  it('sums priced routes and names the unpriced ones', () => {
    const result = totalCost(TABLE, [
      tokens('deepseek-official', 'deepseek-v4-flash', { inputTokens: 1_000_000 }),
      tokens('zhipu', 'glm-4v-flash', {}, { outputTokens: 1_000_000 }),
      tokens('local', 'llama', { inputTokens: 5_000 }, { outputTokens: 5_000 }),
    ])
    expect(result.amount).toBe(1)
    expect(result.unpriced).toEqual(['local/llama'])
    expect(result.ambiguous).toEqual([])
  })

  it('reports an empty table as entirely unpriced rather than free', () => {
    const result = totalCost([], [tokens('p', 'm', { inputTokens: 10 }, { outputTokens: 10 })])
    expect(result.amount).toBe(0)
    expect(result.unpriced).toEqual(['p/m'])
    expect(result.ambiguous).toEqual([])
  })

  it('charges a zero-rated route nothing without calling it unpriced', () => {
    const free: readonly ModelPrice[] = [
      { ...TABLE[1]!, peak: { cacheHit: 0, cacheMiss: 0, output: 0 }, offPeak: { cacheHit: 0, cacheMiss: 0, output: 0 } },
    ]
    const result = totalCost(free, [tokens('zhipu', 'glm-4v-flash', { inputTokens: 1_000_000 }, { outputTokens: 1_000_000 })])
    expect(result).toEqual({ amount: 0, unpriced: [], ambiguous: [] })
  })

  it('reports a route several rows price as ambiguous, charging none of them', () => {
    const result = totalCost(SPLIT_ENDPOINTS, [
      tokens('deepseek-official', 'deepseek-v4-flash', { inputTokens: 1_000_000 }),
      tokens('local', 'llama'),
    ])
    expect(result).toEqual({ amount: 0, unpriced: ['local/llama'], ambiguous: ['deepseek-official/deepseek-v4-flash'] })
  })

  it('returns a zero total with nothing to price', () => {
    expect(totalCost(TABLE, [])).toEqual({ amount: 0, unpriced: [], ambiguous: [] })
  })
})

describe('formatAmount', () => {
  it('keeps two decimals at or above one unit and four below it', () => {
    expect(formatAmount(2)).toBe('2.00')
    expect(formatAmount(0.5)).toBe('0.5000')
  })
})
