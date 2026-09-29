/**
 * Pure projection of one Session event window into the conversation messages
 * the timeline card renders for the console's selected session. The unit is a
 * plain JSON-compatible value, so the apply closure can publish it through a
 * bare observable and the component can consume it without any event-window
 * knowledge.
 */

import type { SessionEventLikeEntry, SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ContentBlock, TokenUsage } from '@deepseek-ai/dsh-llm/types'
import type { SessionStatsTurnRoute } from '@deepseek-ai/dsh-session-stats/types'

/**
 * One reply's own provider-reported token accounting, as plain counts.
 *
 * The four counts are DISJOINT: `inputTokens` is the uncached (cache-miss)
 * prompt count alone, and cached prompt tokens are reported separately, so the
 * reply's total is all three prompt-side buckets plus `outputTokens` — never
 * `inputTokens + outputTokens`. A cache bucket the adapter did not report is
 * `0`, the same reading the `tokenUsage` and `sessionStats` projections give an
 * absent bucket.
 */
export interface TimelineUsage {
  /** Uncached prompt tokens; billed input also includes both cache buckets. */
  readonly inputTokens: number
  /** Output tokens, reasoning included. */
  readonly outputTokens: number
  /** Cache-read (cache-hit) prompt tokens. */
  readonly cacheReadTokens: number
  /** Cache-write prompt tokens. */
  readonly cacheWriteTokens: number
}

/** One conversation message rendered under a scoped timeline. */
export interface TimelineMessage {
  /** Stable React key and ordering identity: the source event's log sequence. */
  readonly key: number
  /** Who produced the message. */
  readonly role: 'user' | 'assistant'
  /** Visible text, in content-block order. */
  readonly text: string
  /** Event time in epoch milliseconds. */
  readonly time: number
  /** The reply's own token accounting; absent when the event carried none. */
  readonly usage?: TimelineUsage
  /**
   * The priceable buckets of the turn this reply closes, as the `sessionStats`
   * projection reports them. Present on exactly one reply per turn — the last
   * text-bearing reply of that turn — because a turn spans several steps and
   * only its closing reply may carry the turn's charge.
   */
  readonly turnCost?: readonly SessionStatsTurnRoute[]
}

/**
 * The reply's total token count: the three disjoint prompt-side buckets plus
 * output. Summing `inputTokens + outputTokens` would drop every cached prompt
 * token the provider billed.
 * @param usage - the reply's own counts.
 * @returns the reply's billed-prompt plus output token count.
 */
export function replyTokenTotal(usage: TimelineUsage): number {
  return usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens + usage.outputTokens
}

/**
 * Join one message's text blocks in content order. Reasoning, image, file, and
 * tool blocks carry model-facing state the card cannot render as text, so they
 * contribute nothing rather than a stand-in label.
 * @param content - the message's model-facing blocks.
 * @returns the concatenated text, or `''` when the message carries no text block.
 */
function textOf(content: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text' && block.text !== '') parts.push(block.text)
  }
  return parts.join('\n')
}

/**
 * The reply's own counts as plain numbers, with an unreported cache bucket read
 * as zero.
 * @param usage - the event's optional provider token accounting.
 * @returns the four disjoint counts.
 */
function usageOf(usage: TokenUsage): TimelineUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
  }
}

/**
 * One message from an event's identity, time, and content.
 * @param key - the event's log sequence, used as the message's stable identity.
 * @param role - who produced the message.
 * @param time - event time in epoch milliseconds.
 * @param content - the message's model-facing blocks.
 * @returns the message, or undefined when it carries no text to render.
 */
function messageOf(
  key: number,
  role: TimelineMessage['role'],
  time: number,
  content: readonly ContentBlock[],
): TimelineMessage | undefined {
  const text = textOf(content)
  return text === '' ? undefined : { key, role, text, time }
}

/**
 * Render one window entry as a conversation message.
 *
 * Only durable message events contribute: `user/message` whose `source.kind` is
 * `'user'` — the operator's own prompt — and `assistant/message`, the step's
 * assembled reply. Every other shape is skipped deliberately:
 *
 * - a `user/message` from any other source is injected context (skills, file
 *   notices, relayed subagent reports), and a right-aligned operator bubble
 *   would attribute the injection to the operator;
 * - `assistant/live-chunk` is a Client-only transient row for an attempt still
 *   streaming, which the session replaces with that attempt's durable
 *   `assistant/message` at settlement;
 * - `assistant/attempt` committed no surface message, so printing its streamed
 *   text as a reply would present model output the session never made
 *   model-visible;
 * - turn, step, request, tool, and system events carry no conversation text.
 * @param entry - one entry of the contiguous event window.
 * @returns the message, or undefined when the entry contributes none.
 */
function messageOfEntry(entry: SessionEventLikeEntry): TimelineMessage | undefined {
  const event = entry.event
  if (event.type === 'user/message') {
    if (event.data.source.kind !== 'user') return undefined
    return messageOf(event.seq, 'user', event.time, event.data.content)
  }
  if (event.type === 'assistant/message') {
    const message = messageOf(event.seq, 'assistant', event.time, event.data.message.content)
    if (message === undefined || event.data.usage === undefined) return message
    return { ...message, usage: usageOf(event.data.usage) }
  }
  return undefined
}

/**
 * The log sequence of each turn's closing reply: the LAST text-bearing
 * assistant message the window holds for that turn.
 *
 * This is the rule the chat's turn tail applies before it prices a turn
 * (`finalized.findLast(hasText)`): one turn spans several steps, so its charge
 * belongs to the single reply that closes it. The window is the contiguous tail
 * of the log, so the last reply it holds for a turn is the turn's last reply.
 * @param window - the session's current contiguous event window.
 * @returns one closing sequence per turn that rendered a reply.
 */
function closingReplySeqs(window: SessionEventWindow): Map<number, number> {
  const closing = new Map<number, number>()
  for (const entry of window.entries) {
    const event = entry.event
    if (event.type !== 'assistant/message' || textOf(event.data.message.content) === '') continue
    closing.set(event.data.turn, event.seq)
  }
  return closing
}

/**
 * The buckets to render per closing reply, keyed by that reply's log sequence.
 * @param window - the session's current contiguous event window.
 * @param turnRoutes - the session's per-turn route buckets, in projection order.
 * @returns the buckets of every turn whose closing reply the window holds.
 */
function turnCostByReply(
  window: SessionEventWindow,
  turnRoutes: readonly SessionStatsTurnRoute[],
): Map<number, readonly SessionStatsTurnRoute[]> {
  const bucketsByTurn = new Map<number, SessionStatsTurnRoute[]>()
  for (const bucket of turnRoutes) {
    const buckets = bucketsByTurn.get(bucket.turn)
    if (buckets === undefined) bucketsByTurn.set(bucket.turn, [bucket])
    else buckets.push(bucket)
  }
  const byReply = new Map<number, readonly SessionStatsTurnRoute[]>()
  for (const [turn, seq] of closingReplySeqs(window)) {
    const buckets = bucketsByTurn.get(turn)
    if (buckets !== undefined) byReply.set(seq, buckets)
  }
  return byReply
}

/**
 * Project a Session event window into renderable conversation messages.
 *
 * The window is the only source of messages: it is partial by design
 * (`hasMore`), and this projection neither pages nor fetches.
 * @param window - the session's current contiguous event window.
 * @param turnRoutes - the session's per-turn route buckets from the
 * `sessionStats` projection; empty when no projection value is available.
 * @returns one entry per text-bearing durable message, in log order.
 */
export function deriveTimelineMessages(
  window: SessionEventWindow,
  turnRoutes: readonly SessionStatsTurnRoute[] = [],
): readonly TimelineMessage[] {
  const costByReply = turnCostByReply(window, turnRoutes)
  const messages: TimelineMessage[] = []
  for (const entry of window.entries) {
    const message = messageOfEntry(entry)
    if (message === undefined) continue
    const turnCost = costByReply.get(message.key)
    messages.push(turnCost === undefined ? message : { ...message, turnCost })
  }
  return messages
}

/**
 * Compare two derived lists by rendered content. A published observable source
 * keeps one snapshot reference until the fact it carries moves, and a later
 * window revision usually leaves the conversation unchanged (a tool call, a
 * step boundary, a live chunk), so the owner skips that publication. Both
 * lists are plain JSON-compatible values built by {@link deriveTimelineMessages}
 * with the same field order, so their serialized form is their rendering.
 * @param left - the currently published list.
 * @param right - a freshly derived list.
 * @returns whether both lists render identically.
 */
export function sameTimelineMessages(
  left: readonly TimelineMessage[],
  right: readonly TimelineMessage[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
