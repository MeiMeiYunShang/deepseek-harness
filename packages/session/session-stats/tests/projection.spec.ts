/**
 * The `sessionStats` projection unit: mounting the plugin beside the
 * projection registry serves whole-log counts and wall times folded from step
 * boundaries, chunks, tool pairs, and assembled messages; compositions
 * without the registry are unaffected; unmounting the plugin removes the key
 * (HMR safety). The two counting regressions pinned here are the reasons the
 * fold counts step boundaries instead of assistant messages: a cancelled step
 * never assembles a message but still counts, and a max-tokens usage-host
 * message (empty content) adds no extra step. Wall-time math and the off-peak
 * split run against the exported definition directly, where event times are
 * controlled; the plugin's window wiring runs against a real registry.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import * as SessionStatsPlugin from '@deepseek-ai/dsh-session-stats'
import { CONSOLE_PRICING_NAMESPACE, sessionStatsStateVersion } from '@deepseek-ai/dsh-session-stats/src/off-peak.ts'
import type { OffPeakWindow } from '@deepseek-ai/dsh-session-stats/src/off-peak.ts'
import { sessionStatsProjectionDefinition } from '@deepseek-ai/dsh-session-stats/src/projection.ts'
import type { SessionStatsBandTokens, SessionStatsProjection, SessionStatsRoute } from '@deepseek-ai/dsh-session-stats/types'

async function harness(withStatsPlugin: boolean): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  if (withStatsPlugin) await ctx.plugin(SessionStatsPlugin)
  return { ctx, session: ctx.sessions.create(SessionId('counted')) }
}

/** Close one step; returns the counted `step/end` seq. */
function closeStep(session: Session, turn: number, step: number): number {
  session.append('step/start', { turn, step })
  return session.append('step/end', { turn, step }).seq
}

/** Append the max-tokens usage-host shape: an assistant/message with empty content. */
function appendEmptyAssistantMessage(session: Session, turn: number, step: number): void {
  session.append('assistant/message', {
    stream: [],
    turn,
    step,
    message: createMessage({
      role: 'assistant',
      content: [],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    }),
  }, { surfaceOp: 'append' })
}

/** The all-zero projection value plus overrides, for exact fold expectations. */
function totals(overrides: Partial<SessionStatsProjection> = {}): SessionStatsProjection {
  return {
    turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0, inputTokens: 0,
    routes: [],
    ...overrides,
  }
}

describe('sessionStats projection unit (registry drive)', () => {
  it('serves zero figures on the empty log', async () => {
    const { ctx, session } = await harness(true)
    expect(ctx.sessionProjections.snapshot(session).values.sessionStats).toEqual(totals())
  })

  it('counts distinct turns and closed steps and notifies the change feed with the causing seq', async () => {
    const { ctx, session } = await harness(true)
    const changes: { key: string; value: unknown; seq: number }[] = []
    ctx.sessionProjections.onChanged((_session, key, value, seq) => {
      changes.push({ key, value, seq })
    })
    session.append('turn/start', { turn: 1 })
    const firstSeq = closeStep(session, 1, 1)
    const secondSeq = closeStep(session, 1, 2)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('turn/start', { turn: 2 })
    const thirdSeq = closeStep(session, 2, 1)
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    // Boundary events that carry no figure change (turn/start, empty-prune
    // turn/end, user input) fold to the same reference and stay silent;
    // step/start opens a boundary (internal state) and step/end commits the
    // counts, so each closed step notifies twice with the step/end value last.
    const counted = changes.filter(change => (change.value as SessionStatsProjection).steps > 0
      || change.seq === firstSeq)
    expect(changes.every(change => change.key === 'sessionStats')).toBe(true)
    expect(counted.map(change => ({ seq: change.seq, value: change.value }))).toContainEqual(
      { seq: firstSeq, value: totals({ turns: 1, steps: 1 }) },
    )
    expect(changes.at(-1)).toEqual({ key: 'sessionStats', value: totals({ turns: 2, steps: 3 }), seq: thirdSeq })
    const snapshot = ctx.sessionProjections.snapshot(session)
    expect(snapshot.values.sessionStats).toEqual(totals({ turns: 2, steps: 3 }))
    expect(snapshot.asOfSeq).toBe(session.seq - 1)
    expect(changes.map(change => change.seq)).toContain(secondSeq)
  })

  it('does not count a rejected or empty turn that closes with no step', async () => {
    const { ctx, session } = await harness(true)
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'blocked' } })
    expect(ctx.sessionProjections.snapshot(session).values.sessionStats).toEqual(totals())
  })

  it('counts a cancelled step that closed without an assistant message', async () => {
    // Regression: an aborted stream never assembles assistant/message, but the
    // loop's finally still appends step/end — the step happened and counts.
    const { ctx, session } = await harness(true)
    session.append('turn/start', { turn: 1 })
    closeStep(session, 1, 1)
    session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'legacy' } } })
    expect(ctx.sessionProjections.snapshot(session).values.sessionStats)
      .toMatchObject({ turns: 1, steps: 1 })
  })

  it('adds no extra step for a max-tokens usage-host assistant message', async () => {
    // Regression: the empty-content assistant/message exists only to host
    // usage and is excluded from the surface; the step counts once, from its
    // step/end, while the message contributes only its model wall time.
    const { ctx, session } = await harness(true)
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    appendEmptyAssistantMessage(session, 1, 1)
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'max-tokens' } })
    expect(ctx.sessionProjections.snapshot(session).values.sessionStats)
      .toMatchObject({ turns: 1, steps: 1, ttftSteps: 0, decodeTokens: 0 })
  })

  it('folds steps already in the log when the plugin mounts late (lazy cell build)', async () => {
    const { ctx, session } = await harness(false)
    session.append('turn/start', { turn: 1 })
    closeStep(session, 1, 1)
    closeStep(session, 1, 2)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await ctx.plugin(SessionStatsPlugin)
    expect(ctx.sessionProjections.snapshot(session).values.sessionStats)
      .toMatchObject({ turns: 1, steps: 2 })
  })

  it('has no sessionStats key without the plugin, and drops it when the plugin unloads (HMR safety)', async () => {
    const { ctx, session } = await harness(false)
    expect('sessionStats' in ctx.sessionProjections.snapshot(session).values).toBe(false)
    const fiber = await ctx.plugin(SessionStatsPlugin)
    session.append('turn/start', { turn: 1 })
    closeStep(session, 1, 1)
    expect(ctx.sessionProjections.snapshot(session).values.sessionStats)
      .toMatchObject({ turns: 1, steps: 1 })
    await fiber.dispose()
    expect('sessionStats' in ctx.sessionProjections.snapshot(session).values).toBe(false)
  })
})

/** Build one synthetic committed event with a controlled timestamp. */
function at(time: number, type: string, data: unknown): SessionEvent {
  return { type, seq: time, time, data } as unknown as SessionEvent
}

function attemptAt(
  time: number,
  chunks: readonly { readonly time: number; readonly chunk: StreamChunk }[],
  turn = 1,
  step = 1,
): SessionEvent {
  return at(time, 'assistant/attempt', {
    turn,
    step,
    stream: chunks.map(member => ({ type: 'chunk', ...member })),
  })
}

/** Fold state of the unit under test. */
type FoldState = Parameters<ReturnType<typeof sessionStatsProjectionDefinition>['apply']>[0]

/**
 * Fold a synthetic event list through the definition and view the result.
 * @param events - the committed events, in seq order.
 * @param window - the off-peak window to fold under; omitted means peak-only.
 * @returns the served projection value.
 */
function fold(events: readonly SessionEvent[], window?: OffPeakWindow): SessionStatsProjection {
  const definition = sessionStatsProjectionDefinition(window)
  const state = events.reduce<FoldState>(
    (folded, event) => definition.apply(folded, event),
    definition.init(),
  )
  return definition.wire.view(state)
}

/**
 * Sum one band field over the routes, to state the bucket/totals invariant.
 * @param routes - the per-route buckets.
 * @param band - which price band to sum.
 * @param field - which token count to sum.
 * @returns the summed count.
 */
function bandSum(
  routes: readonly SessionStatsRoute[],
  band: 'peak' | 'offPeak',
  field: keyof SessionStatsBandTokens,
): number {
  return routes.reduce((total, route) => total + route[band][field], 0)
}

/** The all-zero band bucket, for the expectations that leave a band untouched. */
const ZERO_BAND: SessionStatsBandTokens = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

/**
 * One route's expected bucket: the peak band's tokens, with the off-peak band
 * zero unless a case states its own.
 * @param provider - registered provider route.
 * @param model - provider model id.
 * @param peak - the peak band's counts.
 * @param offPeak - the off-peak band's counts; omitted means all zero.
 * @returns the expected bucket.
 */
function routeBucket(
  provider: string,
  model: string,
  peak: Partial<SessionStatsBandTokens>,
  offPeak: Partial<SessionStatsBandTokens> = {},
): SessionStatsRoute {
  return { provider, model, peak: { ...ZERO_BAND, ...peak }, offPeak: { ...ZERO_BAND, ...offPeak } }
}

describe('sessionStats wall-time fold (controlled timestamps)', () => {
  const message = createMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'answer' }],
    source: { kind: 'model', provider: 'mock', model: 'mock' },
  })

  function messageAt(
    time: number,
    chunks: readonly { readonly time: number; readonly chunk: StreamChunk }[] = [],
    usage?: TokenUsage,
    turn = 1,
    step = 1,
  ): SessionEvent {
    return at(time, 'assistant/message', {
      turn,
      step,
      message,
      stream: chunks.map(member => ({ type: 'chunk', ...member })),
      ...usage === undefined ? {} : { usage },
    })
  }

  it('accrues model, first-token, and decode time from one fully recorded step', () => {
    expect(fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      messageAt(4_800, [{
        time: 1_800, chunk: { type: 'text-delta', index: 0, text: 'a' },
      }], { inputTokens: 10, outputTokens: 60 }),
      at(4_900, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({
      turns: 1, steps: 1, llmMs: 3_800, ttftMs: 800, ttftSteps: 1, decodeMs: 3_000, decodeTokens: 60,
      inputTokens: 10,
    }))
  })

  it('sums input tokens over the usage-reporting steps and skips a report that omits them', () => {
    expect(fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      messageAt(2_000, [{
        time: 1_400, chunk: { type: 'text-delta', index: 0, text: 'a' },
      }], { inputTokens: 10, outputTokens: 60 }),
      at(2_100, 'step/end', { turn: 1, step: 1 }),
      at(3_000, 'step/start', { turn: 1, step: 2 }),
      // A report carrying only output tokens still counts for decode; the
      // omitted input count contributes nothing.
      messageAt(4_000, [{
        time: 3_500, chunk: { type: 'text-delta', index: 0, text: 'b' },
      }], { outputTokens: 5 } as TokenUsage, 1, 2),
      at(4_100, 'step/end', { turn: 1, step: 2 }),
    ])).toEqual(totals({
      turns: 1, steps: 2, llmMs: 2_000, ttftMs: 900, ttftSteps: 2, decodeMs: 1_100, decodeTokens: 65,
      inputTokens: 10,
    }))
  })

  /** A `request/header` event naming the route the following steps use. */
  function headerAt(time: number, provider: string, model: string, reason = 'initial'): SessionEvent {
    return at(time, 'request/header', { header: { config: { provider, model } }, reason })
  }

  it('buckets tokens per model route, so a mid-session switch bills separately', () => {
    const { routes } = fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      headerAt(1_100, 'deepseek-official', 'deepseek-v4-flash'),
      messageAt(2_000, [{ time: 1_400, chunk: { type: 'text-delta', index: 0, text: 'a' } }], { inputTokens: 10, outputTokens: 60 }),
      at(2_100, 'step/end', { turn: 1, step: 1 }),
      at(3_000, 'step/start', { turn: 1, step: 2 }),
      headerAt(3_100, 'zhipu', 'glm-4v-flash', 'change'),
      messageAt(4_000, [{ time: 3_500, chunk: { type: 'text-delta', index: 0, text: 'b' } }], { inputTokens: 5, outputTokens: 20 }, 1, 2),
      at(4_100, 'step/end', { turn: 1, step: 2 }),
    ])
    expect(routes).toEqual([
      routeBucket('deepseek-official', 'deepseek-v4-flash', { inputTokens: 10, outputTokens: 60 }),
      routeBucket('zhipu', 'glm-4v-flash', { inputTokens: 5, outputTokens: 20 }),
    ])
  })

  it('sums both cache bands into the bucket of the route that served the step', () => {
    const { routes, inputTokens, decodeTokens } = fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      headerAt(1_100, 'deepseek-official', 'deepseek-v4-flash'),
      messageAt(2_000, [{ time: 1_400, chunk: { type: 'text-delta', index: 0, text: 'a' } }], {
        inputTokens: 10, outputTokens: 60, cacheReadTokens: 900, cacheWriteTokens: 40,
      }),
      at(2_100, 'step/end', { turn: 1, step: 1 }),
      at(3_000, 'step/start', { turn: 1, step: 2 }),
      messageAt(4_000, [{ time: 3_500, chunk: { type: 'text-delta', index: 0, text: 'b' } }], {
        inputTokens: 5, outputTokens: 20, cacheReadTokens: 100, cacheWriteTokens: 30,
      }, 1, 2),
      at(4_100, 'step/end', { turn: 1, step: 2 }),
    ])
    expect(routes).toEqual([
      routeBucket('deepseek-official', 'deepseek-v4-flash', {
        inputTokens: 15, outputTokens: 80, cacheReadTokens: 1_000, cacheWriteTokens: 70,
      }),
    ])
    expect(bandSum(routes, 'peak', 'inputTokens')).toBe(inputTokens)
    expect(bandSum(routes, 'peak', 'outputTokens')).toBe(decodeTokens)
  })

  it('buckets a report that omits both cache bands as zero cache tokens', () => {
    const { routes, inputTokens, decodeTokens } = fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      headerAt(1_100, 'deepseek-official', 'deepseek-v4-flash'),
      messageAt(2_000, [{ time: 1_400, chunk: { type: 'text-delta', index: 0, text: 'a' } }], { inputTokens: 10, outputTokens: 60 }),
      at(2_100, 'step/end', { turn: 1, step: 1 }),
      at(3_000, 'step/start', { turn: 1, step: 2 }),
      // The cache bands are optional in the provider record: a report carrying
      // neither contributes nothing and still buckets its input and output tokens.
      messageAt(4_000, [{ time: 3_500, chunk: { type: 'text-delta', index: 0, text: 'b' } }], { inputTokens: 5, outputTokens: 20 }, 1, 2),
      at(4_100, 'step/end', { turn: 1, step: 2 }),
    ])
    expect(routes).toEqual([
      routeBucket('deepseek-official', 'deepseek-v4-flash', { inputTokens: 15, outputTokens: 80 }),
    ])
    expect(bandSum(routes, 'peak', 'inputTokens')).toBe(inputTokens)
    expect(bandSum(routes, 'peak', 'outputTokens')).toBe(decodeTokens)
  })

  it('contributes no cache tokens for an invalid band and keeps the step in its bucket', () => {
    const { routes, inputTokens, decodeTokens } = fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      headerAt(1_100, 'deepseek-official', 'deepseek-v4-flash'),
      messageAt(2_000, [{ time: 1_400, chunk: { type: 'text-delta', index: 0, text: 'a' } }], {
        inputTokens: 10, outputTokens: 60, cacheReadTokens: -1, cacheWriteTokens: Number.NaN,
      }),
      at(2_100, 'step/end', { turn: 1, step: 1 }),
      at(3_000, 'step/start', { turn: 1, step: 2 }),
      // A misreported band is dropped on its own; the route keeps accruing from
      // the reports that follow.
      messageAt(4_000, [{ time: 3_500, chunk: { type: 'text-delta', index: 0, text: 'b' } }], {
        inputTokens: 5, outputTokens: 20, cacheReadTokens: 700, cacheWriteTokens: 30,
      }, 1, 2),
      at(4_100, 'step/end', { turn: 1, step: 2 }),
    ])
    expect(routes).toEqual([
      routeBucket('deepseek-official', 'deepseek-v4-flash', {
        inputTokens: 15, outputTokens: 80, cacheReadTokens: 700, cacheWriteTokens: 30,
      }),
    ])
    expect(bandSum(routes, 'peak', 'inputTokens')).toBe(inputTokens)
    expect(bandSum(routes, 'peak', 'outputTokens')).toBe(decodeTokens)
  })

  it('carries the route into steps that logged no header of their own', () => {
    const { routes, inputTokens, decodeTokens } = fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      headerAt(1_100, 'deepseek-official', 'deepseek-v4-flash'),
      messageAt(2_000, [{ time: 1_400, chunk: { type: 'text-delta', index: 0, text: 'a' } }], { inputTokens: 10, outputTokens: 60 }),
      at(2_100, 'step/end', { turn: 1, step: 1 }),
      at(3_000, 'step/start', { turn: 1, step: 2 }),
      // No header here: the header is logged only when it changes.
      messageAt(4_000, [{ time: 3_500, chunk: { type: 'text-delta', index: 0, text: 'b' } }], { inputTokens: 5, outputTokens: 20 }, 1, 2),
      at(4_100, 'step/end', { turn: 1, step: 2 }),
    ])
    expect(routes).toEqual([
      routeBucket('deepseek-official', 'deepseek-v4-flash', { inputTokens: 15, outputTokens: 80 }),
    ])
    // The buckets always sum to the flat totals.
    expect(inputTokens).toBe(15)
    expect(decodeTokens).toBe(80)
    expect(bandSum(routes, 'peak', 'inputTokens')).toBe(inputTokens)
    expect(bandSum(routes, 'peak', 'outputTokens')).toBe(decodeTokens)
  })

  it('ignores a repeated header that names the route already in effect', () => {
    expect(fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      headerAt(1_100, 'deepseek-official', 'deepseek-v4-flash'),
      at(1_200, 'request/header', { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }, reason: 'series' }),
    ]).routes).toEqual([])
  })

  it('keeps the first attempt token boundary across an in-step retry (window resetForRetry parity)', () => {
    expect(fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      attemptAt(1_100, [{
        time: 1_100, chunk: { type: 'text-delta', index: 0, text: '' },
      }]),
      attemptAt(2_000, [{
        time: 1_200, chunk: { type: 'reasoning-delta', index: 0, text: 'x' },
      }]),
      attemptAt(2_500, [{
        time: 1_500, chunk: { type: 'text-delta', index: 0, text: 'later' },
      }]),
      at(2_000, 'llm/retry', { turn: 1, step: 1 }),
      messageAt(5_000, [{
        time: 3_000, chunk: { type: 'text-delta', index: 0, text: 'y' },
      }]),
      at(5_100, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({ turns: 1, steps: 1, llmMs: 4_000, ttftMs: 200, ttftSteps: 1 }))
  })

  it('ignores empty deltas, non-token chunks, and chunks outside the open step', () => {
    expect(fold([
      // Attempt before any step/start: no open boundary.
      attemptAt(500, [{
        time: 500, chunk: { type: 'text-delta', index: 0, text: 'stray' },
      }]),
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      attemptAt(1_300, [{
        time: 1_300, chunk: { type: 'text-delta', index: 0, text: 'other' },
      }], 2, 9),
      messageAt(2_000, [
        { time: 1_100, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
        { time: 1_200, chunk: { type: 'text-delta', index: 0, text: '' } },
        { time: 1_400, chunk: { type: 'text-delta', index: 0, text: 'first' } },
      ]),
      at(2_100, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({ turns: 1, steps: 1, llmMs: 1_000, ttftMs: 400, ttftSteps: 1 }))
  })

  it('uses non-empty Tool-call names or arguments as the first token', () => {
    expect(fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      messageAt(2_000, [
        { time: 1_100, chunk: { type: 'tool-call-delta', index: 0, id: ToolCallId('call-1'), argumentsDelta: '' } },
        {
          time: 1_200,
          chunk: { type: 'tool-call-delta', index: 0, id: ToolCallId('call-1'), name: 'read', argumentsDelta: '' },
        },
      ]),
      at(2_100, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({ turns: 1, steps: 1, llmMs: 1_000, ttftMs: 200, ttftSteps: 1 }))

    expect(fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      messageAt(2_000, [{
        time: 1_300,
        chunk: { type: 'tool-call-delta', index: 0, id: ToolCallId('call-1'), argumentsDelta: '{' },
      }]),
      at(2_100, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({ turns: 1, steps: 1, llmMs: 1_000, ttftMs: 300, ttftSteps: 1 }))
  })

  it('leaves a cancelled step untimed: counted by step/end, no assembled message to accrue from', () => {
    expect(fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      attemptAt(1_500, [{
        time: 1_500, chunk: { type: 'text-delta', index: 0, text: 'partial' },
      }]),
      at(2_000, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({ turns: 1, steps: 1 }))
  })

  it('pairs tool wall time by callId, ignores orphan results, and prunes leftovers at turn/end', () => {
    const result = (callId: string): unknown =>
      ({ turn: 1, step: 1, message: { source: { kind: 'tool', callId } } })
    const paired = fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_100, 'tool/call', { turn: 1, step: 1, callId: 'a', name: 'read', arguments: '{}' }),
      at(1_200, 'tool/call', { turn: 1, step: 1, callId: 'b', name: 'read', arguments: '{}' }),
      // Out-of-order settlement pairs by id, not adjacency.
      at(4_200, 'tool/result', result('b')),
      at(1_600, 'tool/result', result('a')),
      at(5_000, 'tool/result', result('ghost')),
      at(5_100, 'step/end', { turn: 1, step: 1 }),
    ])
    expect(paired).toEqual(totals({ turns: 1, steps: 1, toolMs: 3_500 }))
    // An unresolved call is dropped at turn/end; a later result cannot pair.
    const pruned = fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_100, 'tool/call', { turn: 1, step: 1, callId: 'orphan', name: 'read', arguments: '{}' }),
      at(2_000, 'step/end', { turn: 1, step: 1 }),
      at(2_100, 'turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'legacy' } } }),
      at(9_000, 'tool/result', result('orphan')),
    ])
    expect(pruned).toEqual(totals({ turns: 1, steps: 1 }))
  })

  it('pairs only own pendingCalls keys: a prototype-name callId without a recorded call stays unmatched', () => {
    const result = (callId: string): unknown =>
      ({ turn: 1, step: 1, message: { source: { kind: 'tool', callId } } })
    // Crash recovery (TOOL_NOT_STARTED) emits results with no preceding
    // tool/call; a provider-minted callId colliding with an Object prototype
    // property must read as absent, not as an inherited function that would
    // fold toolMs to NaN and fail the value schema.
    expect(fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_500, 'tool/result', result('toString')),
      at(2_000, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({ turns: 1, steps: 1 }))
    // The same name pairs normally once its call is recorded.
    expect(fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_100, 'tool/call', { turn: 1, step: 1, callId: 'constructor', name: 'read', arguments: '{}' }),
      at(1_600, 'tool/result', result('constructor')),
      at(2_000, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({ turns: 1, steps: 1, toolMs: 500 }))
  })

  it('skips decode for an invalid usage report and ignores a duplicate assembled message', () => {
    const events = [
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      // A malformed provider report: guarded like the window fold guards node usage.
      messageAt(2_000, [{
        time: 1_400, chunk: { type: 'text-delta', index: 0, text: 'a' },
      }], { inputTokens: 1, outputTokens: -5 }),
    ]
    expect(fold([...events, at(2_100, 'step/end', { turn: 1, step: 1 })]))
      .toEqual(totals({ turns: 1, steps: 1, llmMs: 1_000, ttftMs: 400, ttftSteps: 1 }))
    // The first message closed the step boundary; a defensive duplicate finds
    // no open step and folds to the same reference.
    const definition = sessionStatsProjectionDefinition(undefined)
    const state = events.reduce<FoldState>(
      (folded, event) => definition.apply(folded, event),
      definition.init(),
    )
    expect(definition.apply(
      state,
      messageAt(2_050),
    )).toBe(state)
  })

  it('accrues nothing for unrelated events and clamps negative clock skew to zero', () => {
    const definition = sessionStatsProjectionDefinition(undefined)
    const state = definition.init()
    const untouched = definition.apply(state, at(1, 'user/message', { content: [] }))
    expect(untouched).toBe(state)
    expect(fold([
      at(2_000, 'step/start', { turn: 1, step: 1 }),
      messageAt(1_000),
      at(2_100, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({ turns: 1, steps: 1 }))
  })

  describe('price bands', () => {
    /** Epoch ms of one wall-clock hour on a fixed date, in the zone the case names. */
    const hour = (atHour: number, minute = 0): number => Date.UTC(2024, 0, 15, atHour, minute)

    /** The first non-empty delta chunk of a step whose message lands at `tokenTime`. */
    const firstToken = (tokenTime: number): { readonly time: number; readonly chunk: StreamChunk } =>
      ({ time: tokenTime, chunk: { type: 'text-delta', index: 0, text: 'a' } })

    /**
     * One complete step: its boundaries, the route header, and a usage report.
     * @param openedAt - epoch ms of the step's start boundary.
     * @param reportedAt - epoch ms of the assembled message, which is the time the band is read at.
     * @param usage - the provider-reported counts.
     * @param step - step number within turn 1.
     * @returns the step's events, in order.
     */
    function stepAt(openedAt: number, reportedAt: number, usage: TokenUsage, step: number): SessionEvent[] {
      return [
        at(openedAt, 'step/start', { turn: 1, step }),
        headerAt(openedAt, 'deepseek-official', 'deepseek-v4-flash'),
        messageAt(reportedAt, [firstToken(reportedAt)], usage, 1, step),
        at(reportedAt, 'step/end', { turn: 1, step }),
      ]
    }

    const nineToSix: OffPeakWindow = { start: '09:00', end: '18:00', timezone: 'UTC' }

    it('splits one route across the boundary by the event time of each step', () => {
      const { routes, inputTokens, decodeTokens } = fold([
        ...stepAt(hour(10), hour(10, 5), { inputTokens: 10, outputTokens: 60, cacheReadTokens: 900, cacheWriteTokens: 40 }, 1),
        ...stepAt(hour(20), hour(20, 5), { inputTokens: 5, outputTokens: 20, cacheReadTokens: 100, cacheWriteTokens: 30 }, 2),
      ], nineToSix)
      expect(routes).toEqual([
        routeBucket(
          'deepseek-official',
          'deepseek-v4-flash',
          { inputTokens: 5, outputTokens: 20, cacheReadTokens: 100, cacheWriteTokens: 30 },
          { inputTokens: 10, outputTokens: 60, cacheReadTokens: 900, cacheWriteTokens: 40 },
        ),
      ])
      // One route, two bands, and the bands still sum to the flat totals.
      expect(inputTokens).toBe(15)
      expect(decodeTokens).toBe(80)
      expect(bandSum(routes, 'peak', 'inputTokens') + bandSum(routes, 'offPeak', 'inputTokens')).toBe(inputTokens)
      expect(bandSum(routes, 'peak', 'outputTokens') + bandSum(routes, 'offPeak', 'outputTokens')).toBe(decodeTokens)
    })

    it('places a step exactly on each window edge: the start is inside, the end is not', () => {
      const { routes } = fold([
        ...stepAt(hour(8, 59), hour(9), { inputTokens: 1, outputTokens: 2 }, 1),
        ...stepAt(hour(17), hour(18), { inputTokens: 3, outputTokens: 4 }, 2),
      ], nineToSix)
      expect(routes).toEqual([
        routeBucket('deepseek-official', 'deepseek-v4-flash', { inputTokens: 3, outputTokens: 4 }, { inputTokens: 1, outputTokens: 2 }),
      ])
    })

    it('reads a window that wraps past midnight from both sides of the local day', () => {
      const { routes } = fold([
        ...stepAt(hour(23), hour(23, 30), { inputTokens: 1, outputTokens: 1 }, 1),
        ...stepAt(hour(5), hour(5, 30), { inputTokens: 2, outputTokens: 2 }, 2),
        ...stepAt(hour(12), hour(12, 30), { inputTokens: 4, outputTokens: 4 }, 3),
      ], { start: '22:00', end: '06:00', timezone: 'UTC' })
      expect(routes).toEqual([
        routeBucket('deepseek-official', 'deepseek-v4-flash', { inputTokens: 4, outputTokens: 4 }, { inputTokens: 3, outputTokens: 3 }),
      ])
    })

    it('reads the window in a zone whose offset is not a whole hour', () => {
      const { routes } = fold([
        // Asia/Kolkata is UTC+05:30, so 03:30 UTC is the 09:00 window start.
        ...stepAt(hour(3), hour(3, 30), { inputTokens: 1, outputTokens: 1 }, 1),
        ...stepAt(hour(12), hour(12, 30), { inputTokens: 2, outputTokens: 2 }, 2),
      ], { start: '09:00', end: '18:00', timezone: 'Asia/Kolkata' })
      expect(routes).toEqual([
        routeBucket('deepseek-official', 'deepseek-v4-flash', { inputTokens: 2, outputTokens: 2 }, { inputTokens: 1, outputTokens: 1 }),
      ])
    })

    it('keeps every token in the peak band when no window is configured', () => {
      const { routes } = fold([
        ...stepAt(hour(3), hour(3, 30), { inputTokens: 1, outputTokens: 1 }, 1),
      ])
      expect(routes).toEqual([
        routeBucket('deepseek-official', 'deepseek-v4-flash', { inputTokens: 1, outputTokens: 1 }),
      ])
    })
  })
})

describe('sessionStats off-peak window wiring', () => {
  /** The currently stored `console-pricing` section, as the stub settings service sees it. */
  let section: unknown

  /**
   * Boot the store, the registry, the plugin, and — unless `withSettings` is
   * false — a settings service holding {@link section}.
   * @param withSettings - whether the composition carries a settings service.
   * @param mount - whether to mount the plugin in the boot.
   * @returns the booted context.
   */
  async function boot(withSettings: boolean, mount = true): Promise<Context> {
    section = undefined
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    if (withSettings) {
      ctx.provide('settings', { get: () => section } as unknown as SettingsProvider)
    }
    if (mount) await ctx.plugin(SessionStatsPlugin)
    return ctx
  }

  /** The state version the live unit registered with, read through a checkpoint row. */
  function installedVersion(ctx: Context, session: Session): number {
    return ctx.sessionProjections.checkpoint(session).sessionStats?.ver as number
  }

  it('registers the unit when no settings service is composed', async () => {
    const ctx = await boot(false)
    const session = ctx.sessions.create(SessionId('headless'))
    expect(installedVersion(ctx, session)).toBe(sessionStatsStateVersion(undefined))
  })

  it('adopts the window that appears after this plugin mounted, and follows a change', async () => {
    const ctx = await boot(true)
    const session = ctx.sessions.create(SessionId('early'))
    // The window's owner (dsh-console-bridge) has not registered the namespace
    // yet: the unit is peak-only, and no window can borrow that row.
    expect(installedVersion(ctx, session)).toBe(sessionStatsStateVersion(undefined))

    const nineToSix: OffPeakWindow = { start: '09:00', end: '18:00', timezone: 'UTC' }
    section = { offPeak: nineToSix }
    // The next session is when the plugin notices: registration is re-read, the
    // previous unit's cells are dropped, and every fold refolds under the window.
    ctx.sessions.create(SessionId('late'))
    const windowed = installedVersion(ctx, session)
    expect(windowed).toBe(sessionStatsStateVersion(nineToSix))
    // A row folded under the peak-only unit is discarded rather than reused.
    expect(ctx.sessionProjections.restoreFloor({ sessionStats: { ver: sessionStatsStateVersion(undefined), seq: 3, val: {} } })).toBe(0)
    // A row folded under this window still seeds the fold from after its seq.
    expect(ctx.sessionProjections.restoreFloor({ sessionStats: { ver: windowed, seq: 3, val: {} } })).toBe(3)

    const night: OffPeakWindow = { start: '22:00', end: '06:00', timezone: 'Asia/Kolkata' }
    section = { offPeak: night }
    ctx.emit('settings/updated', CONSOLE_PRICING_NAMESPACE, section, section, 'update')
    const edited = installedVersion(ctx, session)
    expect(edited).toBe(sessionStatsStateVersion(night))
    expect(edited).not.toBe(windowed)

    // A commit on another namespace, and a re-read of the same section, both
    // leave the live unit in place: re-registering costs every live session a
    // refold, so only an actual change does it.
    ctx.emit('settings/updated', 'console-bridge', {}, {}, 'update')
    ctx.sessions.create(SessionId('unchanged'))
    expect(installedVersion(ctx, session)).toBe(edited)
  })

  it('drops the key when the plugin unloads after a window change (HMR safety)', async () => {
    const ctx = await boot(true, false)
    const fiber = await ctx.plugin(SessionStatsPlugin)
    // The window adopts a second, replacement registration; that one must ride
    // this fiber just like the first, or an unload would leave the key behind.
    section = { offPeak: { start: '09:00', end: '18:00', timezone: 'UTC' } }
    ctx.sessions.create(SessionId('windowed'))
    await fiber.dispose()
    expect(ctx.sessionProjections.checkpoint(ctx.sessions.create(SessionId('after'))).sessionStats).toBeUndefined()
  })
})
