/**
 * The `sessionStats` projection unit: a pure fold of step boundaries, stream
 * embedded streams, tool pairs, and assembled assistant messages into whole-log counts
 * and wall times.
 *
 * `step/end` — not `assistant/message` — is the counted step event because it
 * is the step lifecycle authority: the loop appends exactly one per entered
 * step, in a `finally`, so completed, failed, cancelled, and max-tokens steps
 * all land one. Counting assembled assistant messages instead would overcount
 * max-tokens usage-host messages (empty content, excluded from the surface)
 * and undercount cancelled steps (aborted before the message assembles).
 *
 * The wall-time folds mirror the client window fold field by field
 * (`deriveStats` in dsh-client-ui-conversation, that fold's whole-window
 * fallback role): model time is `step/start` → `assistant/message`, first
 * token is the first non-empty delta chunk and survives an in-step
 * `llm/retry`, decode spans first token → assembled message on steps that
 * also report output tokens, and tool time pairs `tool/call` → `tool/result`
 * by callId. A cancelled step assembles no message, so its partial stream
 * time stays uncounted in every time figure — matching the window, which
 * renders it as an untimed interrupted node.
 *
 * Token counts additionally split by the daily price band the reporting
 * event's own time falls in, so one session can be priced across an off-peak
 * boundary; `./off-peak.ts` owns the window and the decision. The buckets
 * carry the turn as well as the route, so a consumer that prices one turn
 * takes that turn's own counts and bands.
 *
 * @module @deepseek-ai/dsh-session-stats/projection
 */

import { z } from 'zod'
import { assistantStreamFirstTokenTime } from '@deepseek-ai/dsh-llm'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionStatsBandTokens, SessionStatsRoute, SessionStatsTurnRoute } from './types.ts'
import { priceBandOf, sessionStatsStateVersion, type OffPeakWindow, type PriceBand } from './off-peak.ts'


/** Accumulated whole-log figures (the view is exactly these totals). */
interface SessionStatsTotals {
  /** Distinct turns with at least one closed step so far. */
  turns: number
  /** Closed steps so far. */
  steps: number
  /** Summed model wall time over message-assembling steps, ms. */
  llmMs: number
  /** Summed matched tool call→result wall time, ms. */
  toolMs: number
  /** Summed first-token latency over `ttftSteps`, ms. */
  ttftMs: number
  /** Steps carrying a recorded first token. */
  ttftSteps: number
  /** Summed decode wall time over usage-reporting steps, ms. */
  decodeMs: number
  /** Summed provider output tokens over the same steps. */
  decodeTokens: number
  /** Summed provider input tokens over the same steps. */
  inputTokens: number
  /** Provider-reported tokens per model route, in first-seen order. */
  routes: SessionStatsRoute[]
  /** Provider-reported tokens per `(turn, model route)`, in first-seen order. */
  turnRoutes: SessionStatsTurnRoute[]
}

/**
 * Fold state: the totals plus the in-flight boundaries they accrue from.
 * Turn numbers are host-assigned and monotonic per session, so a single
 * `lastTurn` slot decides "first closed step of a new turn"; the state is
 * plain JSON per the unit contract (persisted-cache precondition).
 */
interface SessionStatsState extends SessionStatsTotals {
  /** Turn of the last counted `step/end`; null before the first. */
  lastTurn: number | null
  /** The open step's boundary facts; null outside a step or after its message assembled. */
  openStep: { turn: number; step: number; startTime: number; firstTokenTime: number | null } | null
  /** Dispatch times of tool calls whose result has not landed, by callId. */
  pendingCalls: Record<string, number>
  /**
   * The route every request since the last `request/header` uses. The header is
   * logged only when it changes, so the fold carries it forward into steps that
   * logged none.
   */
  route: { provider: string; model: string } | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    sessionStats: SessionStatsState
  }
}

const bandTokensSchema = z.object({
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  cacheReadTokens: z.number().nonnegative(),
  cacheWriteTokens: z.number().nonnegative(),
})

const routeSchema = z.object({
  provider: z.string(),
  model: z.string(),
  peak: bandTokensSchema,
  offPeak: bandTokensSchema,
})

const turnRouteSchema = routeSchema.extend({ turn: z.number().int().nonnegative() })

const sessionStatsSchema = z.object({
  turns: z.number().int().nonnegative(),
  steps: z.number().int().nonnegative(),
  llmMs: z.number().nonnegative(),
  toolMs: z.number().nonnegative(),
  ttftMs: z.number().nonnegative(),
  ttftSteps: z.number().int().nonnegative(),
  decodeMs: z.number().nonnegative(),
  decodeTokens: z.number().nonnegative(),
  inputTokens: z.number().nonnegative(),
  routes: z.array(routeSchema),
  turnRoutes: z.array(turnRouteSchema),
}).strict()

/**
 * The fold state's shape (totals plus in-flight boundaries), validated on
 * persisted-cache rows after their `ver` gate — the unit's input boundary.
 * The view is a strict subset of the state, so this schema extends
 * `sessionStatsSchema` (the wire output boundary) with the boundary fields.
 */
const sessionStatsStateSchema = sessionStatsSchema.extend({
  lastTurn: z.number().int().nonnegative().nullable(),
  openStep: z.object({
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
    startTime: z.number().nonnegative(),
    firstTokenTime: z.number().nonnegative().nullable(),
  }).nullable(),
  pendingCalls: z.record(z.string(), z.number().nonnegative()),
  route: z.object({ provider: z.string(), model: z.string() }).nullable(),
})

/** A band bucket with nothing accrued into it yet. */
function emptyBand(): SessionStatsBandTokens {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
}

/** A route bucket's peak and off-peak counts, whatever else the bucket carries. */
interface BandedRoute {
  peak: SessionStatsBandTokens
  offPeak: SessionStatsBandTokens
}

/**
 * Add one step's token counts to the named band of the matching bucket,
 * appending a bucket built by `create` when none matches.
 *
 * The session-wide route buckets and the per-turn ones fold through this one
 * helper, so both carry exactly the same counts and bands: the per-turn
 * buckets partition the session-wide ones by turn, and their sums are equal by
 * construction. A session that switched models keeps one bucket per route, and
 * a session that crossed the off-peak boundary keeps one band per bucket, so
 * each band's tokens stay priced at that band's own rate.
 * @param buckets - the buckets accumulated so far.
 * @param matches - whether a bucket is the one this step accrues into.
 * @param create - builds the bucket to append when none matches.
 * @param band - the band this step's event time falls in.
 * @param tokens - this step's provider-reported counts.
 * @returns the buckets with this step folded in.
 */
function accrueInto<T extends BandedRoute>(
  buckets: readonly T[],
  matches: (bucket: T) => boolean,
  create: () => T,
  band: PriceBand,
  tokens: SessionStatsBandTokens,
): T[] {
  const index = buckets.findIndex(matches)
  const current = index < 0 ? create() : buckets[index] as T
  const accrued = band === 'peak'
    ? { ...current, peak: addTokens(current.peak, tokens) }
    : { ...current, offPeak: addTokens(current.offPeak, tokens) }
  if (index < 0) return [...buckets, accrued]
  const next = [...buckets]
  next[index] = accrued
  return next
}

/**
 * Sum two band buckets into a new one.
 * @param current - the band's counts so far.
 * @param added - the counts this step contributes.
 * @returns the summed band.
 */
function addTokens(current: SessionStatsBandTokens, added: SessionStatsBandTokens): SessionStatsBandTokens {
  return {
    inputTokens: current.inputTokens + added.inputTokens,
    outputTokens: current.outputTokens + added.outputTokens,
    cacheReadTokens: current.cacheReadTokens + added.cacheReadTokens,
    cacheWriteTokens: current.cacheWriteTokens + added.cacheWriteTokens,
  }
}

/** Provider usage fields this fold reads; each one is optional in the provider record. */
type UsageTokenField = 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'

/**
 * Provider-reported token count of one usage field, guarded the way the window
 * fold guards node usage.
 * @param usage - the assistant/message event's optional usage record.
 * @param field - which provider-reported count to read.
 * @returns the token count, or null when unreported or invalid.
 */
function usageTokens(usage: unknown, field: UsageTokenField): number | null {
  if (typeof usage !== 'object' || usage === null) return null
  const value = (usage as Partial<Record<UsageTokenField, unknown>>)[field]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/** The `sessionStats` unit with its client view present, which is how the registry registers it. */
type SessionStatsUnit = ProjectionDefinition<'sessionStats', SessionStatsState> & {
  wire: NonNullable<ProjectionDefinition<'sessionStats', SessionStatsState>['wire']>
}

/**
 * Build the `sessionStats` unit for one resolved off-peak window (exported for
 * the unit spec). The window is a parameter rather than a module constant
 * because the unit contract hands `init`/`apply` only state and the next
 * event, so the registrant resolves the window and closes it over the fold.
 * @param window - the resolved off-peak window, or undefined for peak-only pricing.
 * @returns the unit to register on `ctx.sessionProjections`.
 */
export function sessionStatsProjectionDefinition(
  window: OffPeakWindow | undefined,
): SessionStatsUnit {
  const bandOf = priceBandOf(window)
  return {
    key: 'sessionStats',
    stateVersion: sessionStatsStateVersion(window),
    stateSchema: sessionStatsStateSchema,
    init: () => ({
      turns: 0,
      steps: 0,
      llmMs: 0,
      toolMs: 0,
      ttftMs: 0,
      ttftSteps: 0,
      decodeMs: 0,
      decodeTokens: 0,
      inputTokens: 0,
      routes: [],
      turnRoutes: [],
      lastTurn: null,
      openStep: null,
      pendingCalls: {},
      route: null,
    }),
    apply: (state, event) => {
      // Every uninteresting event returns the same reference (Object.is gates the change feed).
      switch (event.type) {
        case 'step/start':
          return {
            ...state,
            openStep: { turn: event.data.turn, step: event.data.step, startTime: event.time, firstTokenTime: null },
          }
        case 'assistant/attempt': {
          const open = state.openStep
          if (open === null || open.turn !== event.data.turn || open.step !== event.data.step) return state
          const first = assistantStreamFirstTokenTime(event.data.stream) ?? null
          if (open.firstTokenTime !== null || first === null) return state
          return { ...state, openStep: { ...open, firstTokenTime: first } }
        }
        case 'request/header': {
          const route = {
            provider: event.data.header.config.provider,
            model: event.data.header.config.model,
          }
          const current = state.route
          if (current !== null && current.provider === route.provider && current.model === route.model) return state
          return { ...state, route }
        }
        case 'assistant/message': {
          const open = state.openStep
          if (open === null || open.turn !== event.data.turn || open.step !== event.data.step) return state
          const firstToken = open.firstTokenTime ?? assistantStreamFirstTokenTime(event.data.stream) ?? null
          // One assembled message per step: closing the boundary means a
          // defensive duplicate cannot accrue twice.
          const next: SessionStatsState = {
            ...state,
            llmMs: state.llmMs + Math.max(0, event.time - open.startTime),
            openStep: null,
          }
          if (firstToken !== null) {
            next.ttftMs += Math.max(0, firstToken - open.startTime)
            next.ttftSteps += 1
            const outputTokens = usageTokens(event.data.usage, 'outputTokens')
            if (outputTokens !== null) {
              next.decodeMs += Math.max(0, event.time - firstToken)
              next.decodeTokens += outputTokens
              const inputTokens = usageTokens(event.data.usage, 'inputTokens')
              if (inputTokens !== null) {
                next.inputTokens += inputTokens
                // Bucket with the same both-sides guard as the totals above, so
                // the route buckets always sum to them. A cache band the report
                // omits or misreports contributes nothing rather than dropping
                // the step's input and output tokens from the bucket.
                const route = state.route
                if (route !== null) {
                  const tokens: SessionStatsBandTokens = {
                    inputTokens,
                    outputTokens,
                    cacheReadTokens: usageTokens(event.data.usage, 'cacheReadTokens') ?? 0,
                    cacheWriteTokens: usageTokens(event.data.usage, 'cacheWriteTokens') ?? 0,
                  }
                  const band = bandOf(event.time)
                  next.routes = accrueInto(
                    state.routes,
                    entry => entry.provider === route.provider && entry.model === route.model,
                    () => ({ ...route, peak: emptyBand(), offPeak: emptyBand() }),
                    band,
                    tokens,
                  )
                  next.turnRoutes = accrueInto(
                    state.turnRoutes,
                    entry => entry.turn === event.data.turn
                      && entry.provider === route.provider
                      && entry.model === route.model,
                    () => ({ turn: event.data.turn, ...route, peak: emptyBand(), offPeak: emptyBand() }),
                    band,
                    tokens,
                  )
                }
              }
            }
          }
          return next
        }
        case 'tool/call':
          return { ...state, pendingCalls: { ...state.pendingCalls, [event.data.callId]: event.time } }
        case 'tool/result': {
          // Own-key check: callId is provider-minted (model/tool JSON boundary),
          // so a prototype property name ('constructor', 'toString') on a result
          // with no recorded call must read as unmatched, not as an inherited
          // function that would poison toolMs with NaN.
          const callId = event.data.message.source.callId
          const dispatched = Object.hasOwn(state.pendingCalls, callId) ? state.pendingCalls[callId] : undefined
          if (dispatched === undefined) return state
          const pendingCalls = Object.fromEntries(
            Object.entries(state.pendingCalls).filter(([id]) => id !== callId),
          )
          return { ...state, toolMs: state.toolMs + Math.max(0, event.time - dispatched), pendingCalls }
        }
        case 'step/end':
          return {
            ...state,
            turns: state.lastTurn === event.data.turn ? state.turns : state.turns + 1,
            steps: state.steps + 1,
            lastTurn: event.data.turn,
            openStep: null,
          }
        case 'turn/end':
          // A call whose result never landed belongs to a cancelled or failed
          // turn; results always land within their turn, so drop the leftovers
          // instead of growing persisted state forever.
          return Object.keys(state.pendingCalls).length === 0 ? state : { ...state, pendingCalls: {} }
        default:
          return state
      }
    },
    wire: {
      viewSchema: sessionStatsSchema,
      view: state => ({
        turns: state.turns,
        steps: state.steps,
        llmMs: state.llmMs,
        toolMs: state.toolMs,
        ttftMs: state.ttftMs,
        ttftSteps: state.ttftSteps,
        decodeMs: state.decodeMs,
        decodeTokens: state.decodeTokens,
        inputTokens: state.inputTokens,
        routes: state.routes,
        turnRoutes: state.turnRoutes,
      }),
    },
  }
}
