/**
 * Pure projection of one Session event window into the conversation messages
 * the timeline card renders for the console's selected session. The unit is a
 * plain JSON-compatible value, so the apply closure can publish it through a
 * bare observable and the component can consume it without any event-window
 * knowledge.
 */

import type { SessionEventLikeEntry, SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'

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
    return messageOf(event.seq, 'assistant', event.time, event.data.message.content)
  }
  return undefined
}

/**
 * Project a Session event window into renderable conversation messages.
 *
 * The window is the only source: it is partial by design (`hasMore`), and this
 * projection neither pages nor fetches.
 * @param window - the session's current contiguous event window.
 * @returns one entry per text-bearing durable message, in log order.
 */
export function deriveTimelineMessages(window: SessionEventWindow): readonly TimelineMessage[] {
  const messages: TimelineMessage[] = []
  for (const entry of window.entries) {
    const message = messageOfEntry(entry)
    if (message !== undefined) messages.push(message)
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
