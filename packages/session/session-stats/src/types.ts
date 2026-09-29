/**
 * Pure types of the session-stats domain: the ONE home of the `sessionStats`
 * projection-key declaration, free of this package's host-side value imports
 * (cordis context, zod, the llm chunk predicate). Two namespace projections
 * serve it — `./types` for host consumers, `./client` for client aggregates —
 * with zero content duplication.
 *
 * @module @deepseek-ai/dsh-session-stats/types
 */

// Marks this file a module so the declaration below AUGMENTS the projection
// table instead of declaring an ambient module.
export {}

/**
 * Provider-reported tokens one model route served during one daily price band.
 *
 * A band is a complete set of the four counts the provider reports, because a
 * band's price applies to each of them separately.
 */
export interface SessionStatsBandTokens {
  /** Summed provider input tokens over the steps served in this band. */
  inputTokens: number
  /** Summed provider output tokens over the steps served in this band. */
  outputTokens: number
  /**
   * Summed provider cache-read (cache-hit) input tokens over the steps served
   * in this band, 0 for a step whose report omits the field or reports it
   * invalid. The cache-hit band alone, never the cache-miss count.
   */
  cacheReadTokens: number
  /**
   * Summed provider cache-write input tokens over the steps served in this
   * band, 0 for a step whose report omits the field or reports it invalid.
   */
  cacheWriteTokens: number
}

/**
 * Provider-reported tokens one model route served, split by the daily price
 * band each step was served in.
 *
 * One session can switch models mid-conversation, so a single token total
 * cannot be priced: each route carries its own rate. One session can also
 * cross an off-peak boundary, so a single total per route cannot be priced
 * either — each route carries one bucket per band, and a band is priced from
 * its own four counts.
 */
export interface SessionStatsRoute {
  /** Registered provider route that served the tokens. */
  provider: string
  /** Provider model id that served the tokens. */
  model: string
  /** Tokens served inside the peak price band. */
  peak: SessionStatsBandTokens
  /** Tokens served inside the off-peak window; every token when no window is configured. */
  offPeak: SessionStatsBandTokens
}

/**
 * Provider-reported tokens one model route served inside one turn, split by the
 * daily price band each reporting event was served in.
 *
 * A charge is never attributed from a guessed route, so per-turn accounting
 * needs the route of the turn it belongs to: {@link SessionStatsRoute} totals
 * say what the session spent on a route, never which turn spent it.
 */
export interface SessionStatsTurnRoute extends SessionStatsRoute {
  /** Host-assigned turn the tokens were served in. */
  turn: number
}

/**
 * Whole-log conversation figures, independent of how much history a client
 * has paged in. Counts and wall times all fold from the complete durable log;
 * every field is 0 until its first contributing event lands. Field names
 * mirror the client window fold so an assembly without this unit can fall
 * back to it wholesale.
 */
export interface SessionStatsProjection {
  /** Distinct turns carrying at least one closed step (`step/end`); rejected or empty turns are uncounted. */
  turns: number
  /** Closed steps (`step/end` events) — completed, failed, and cancelled steps alike. */
  steps: number
  /** Summed model wall time (`step/start` → `assistant/message`) over steps that assembled a message. */
  llmMs: number
  /** Summed tool wall time over `tool/call` → `tool/result` pairs matched by callId. */
  toolMs: number
  /** Summed first-token latency (`step/start` → first non-empty delta chunk) over `ttftSteps`. */
  ttftMs: number
  /** Steps carrying a recorded first token. */
  ttftSteps: number
  /** Summed decode wall time (first token → `assistant/message`) over steps that also report output tokens. */
  decodeMs: number
  /** Summed provider output tokens over the same decode-timed steps. */
  decodeTokens: number
  /** Summed provider input tokens over the same decode-timed steps. */
  inputTokens: number
  /** Provider-reported tokens per model route, in first-seen order. */
  routes: SessionStatsRoute[]
  /**
   * Provider-reported tokens per model route within each turn, in
   * `(turn, route)` first-seen order. One turn's buckets carry that turn's own
   * four counts and band split, so a consumer that prices one turn — the chat
   * action row's cost, unlike the console's whole-session figure — never
   * charges it at the rate or band of another turn.
   */
  turnRoutes: SessionStatsTurnRoute[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Whole-log turn/step counts and wall times; see {@link SessionStatsProjection}. */
    sessionStats: SessionStatsProjection
  }
}
