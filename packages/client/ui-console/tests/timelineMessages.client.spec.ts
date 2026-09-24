/** What the scoped timeline derives from a Session event window. */

import { describe, expect, it } from 'vitest'
import type { SessionEventLikeEntry, SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SessionStatsBandTokens, SessionStatsTurnRoute } from '@deepseek-ai/dsh-session-stats/types'
import { deriveTimelineMessages, replyTokenTotal, sameTimelineMessages } from '../src/client/timelineMessages.ts'
import type { TimelineUsage } from '../src/client/timelineMessages.ts'

/** One durable event-window entry. */
function at(seq: number, type: string, data: unknown, time = seq * 100): SessionEventLikeEntry {
  return { type: 'event', event: { seq, time, type, data } as SessionEvent }
}

/** One Client-only streaming row for an attempt that has not settled. */
function liveChunk(seq: number, text: string): SessionEventLikeEntry {
  return {
    type: 'transient',
    event: {
      type: 'assistant/live-chunk',
      seq,
      time: seq * 100,
      data: { attemptId: 'attempt-1', turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text } },
    },
  } as SessionEventLikeEntry
}

/** A user-role message event data payload. */
function userData(text: string, source: unknown = { kind: 'user' }): unknown {
  return { id: 'm1', role: 'user', content: [{ type: 'text', text }], source }
}

/** An assistant message event data payload, in one turn and step. */
function assistantData(text: string, usage?: unknown, turn = 1, step = 1): unknown {
  return {
    turn,
    step,
    message: { id: 'm2', role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'p', model: 'm' } },
    stream: [],
    ...(usage === undefined ? {} : { usage }),
  }
}

/** An assistant event payload that committed no text block. */
function reasoningData(turn = 1, step = 1): unknown {
  return {
    turn,
    step,
    message: { id: 'm3', role: 'assistant', content: [{ type: 'reasoning', text: 'thinking' }], source: { kind: 'model', provider: 'p', model: 'm' } },
    stream: [],
  }
}

/** One band of a route bucket, zeroed unless a test sets a count. */
const band = (counts: Partial<SessionStatsBandTokens> = {}): SessionStatsBandTokens => ({
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, ...counts,
})

/** One turn's route bucket, in the projection's own shape. */
const turnRoute = (turn: number, peak: Partial<SessionStatsBandTokens> = {}): SessionStatsTurnRoute =>
  ({ turn, provider: 'p', model: 'm', peak: band(peak), offPeak: band() })

/** An event window over the given entries. */
function window(entries: readonly SessionEventLikeEntry[], hasMore = false): SessionEventWindow {
  return { entries, hasMore, revision: 1, change: { kind: 'replace', entries } }
}

describe('deriveTimelineMessages', () => {
  it('derives the operator prompt and the assistant reply in log order', () => {
    const messages = deriveTimelineMessages(window([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'user/message', userData('Repair the composer')),
      at(3, 'step/start', { turn: 1, step: 1 }),
      at(4, 'assistant/message', assistantData('Done, the composer sends again.')),
      at(5, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]))

    expect(messages).toEqual([
      { key: 2, role: 'user', text: 'Repair the composer', time: 200 },
      { key: 4, role: 'assistant', text: 'Done, the composer sends again.', time: 400 },
    ])
  })

  it('attributes each message to its own producer', () => {
    const messages = deriveTimelineMessages(window([
      at(1, 'user/message', userData('question')),
      at(2, 'assistant/message', assistantData('answer')),
    ]))

    // The operator's prompt never becomes an assistant block, and the reply
    // never becomes an operator bubble.
    expect(messages.filter(message => message.role === 'user').map(message => message.text)).toEqual(['question'])
    expect(messages.filter(message => message.role === 'assistant').map(message => message.text)).toEqual(['answer'])
  })

  it('joins a message text blocks in content order', () => {
    const messages = deriveTimelineMessages(window([
      at(1, 'user/message', {
        id: 'm1',
        role: 'user',
        content: [{ type: 'text', text: 'first' }, { type: 'reasoning', text: 'ignored' }, { type: 'text', text: 'second' }],
        source: { kind: 'user' },
      }),
    ]))

    expect(messages.map(message => message.text)).toEqual(['first\nsecond'])
  })

  it('skips injected context carried by the user message event type', () => {
    const messages = deriveTimelineMessages(window([
      at(1, 'user/message', userData('workspace instructions', { kind: 'plugin', plugin: 'agent-instructions' })),
      at(2, 'user/message', userData('a relayed subagent report', { kind: 'plugin', plugin: 'subagent', form: 'relay' })),
    ]))

    expect(messages).toEqual([])
  })

  it('skips a streaming row and an attempt that committed no surface message', () => {
    const messages = deriveTimelineMessages(window([
      liveChunk(1, 'partial text'),
      at(2, 'assistant/attempt', { turn: 1, step: 1, stream: [{ type: 'text-chunks', time0: 100, index: 0, dt: [0], texts: ['retried away'] }] }),
    ]))

    expect(messages).toEqual([])
  })

  it('skips a message that carries no text block', () => {
    const messages = deriveTimelineMessages(window([
      at(1, 'user/message', { id: 'm1', role: 'user', content: [], source: { kind: 'user' } }),
      at(2, 'user/message', {
        id: 'm2',
        role: 'user',
        content: [{ type: 'file', attachment: { attachmentId: 'a1', name: 'notes.md', bytes: 10 } }],
        source: { kind: 'user' },
      }),
      at(3, 'assistant/message', {
        turn: 1,
        step: 1,
        message: { id: 'm3', role: 'assistant', content: [{ type: 'reasoning', text: 'thinking' }], source: { kind: 'model', provider: 'p', model: 'm' } },
        stream: [],
      }),
      at(4, 'user/message', { id: 'm4', role: 'user', content: [{ type: 'text', text: '' }], source: { kind: 'user' } }),
    ]))

    expect(messages).toEqual([])
  })

  it('derives nothing from a window holding no message event', () => {
    expect(deriveTimelineMessages(window([at(1, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{}' })]))).toEqual([])
    expect(deriveTimelineMessages(window([]))).toEqual([])
  })

  it('folds the reply own disjoint token counts, reading an unreported cache bucket as zero', () => {
    const messages = deriveTimelineMessages(window([
      at(1, 'assistant/message', assistantData('answered', {
        inputTokens: 1_000, outputTokens: 200, cacheReadTokens: 15_000, cacheWriteTokens: 4,
      })),
      at(2, 'assistant/message', assistantData('answered again', { inputTokens: 10, outputTokens: 5 })),
    ]))

    expect(messages[0]!.usage).toEqual({
      inputTokens: 1_000, outputTokens: 200, cacheReadTokens: 15_000, cacheWriteTokens: 4,
    })
    // The adapter reported no cache buckets, so both read as zero rather than
    // dropping the reply's usage altogether.
    expect(messages[1]!.usage).toEqual({
      inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0,
    })
  })

  it('sums a reply total from all three prompt buckets plus output, never from input plus output', () => {
    const usage: TimelineUsage = {
      inputTokens: 1_000, outputTokens: 200, cacheReadTokens: 15_000, cacheWriteTokens: 0,
    }

    // 1,000 uncached + 15,000 cache-read + 200 output. Summing only
    // inputTokens and outputTokens would report 1,200.
    expect(replyTokenTotal(usage)).toBe(16_200)
    expect(replyTokenTotal({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(0)
  })

  it('carries no usage for a reply whose event reported none', () => {
    const messages = deriveTimelineMessages(window([
      at(1, 'assistant/message', assistantData('answered')),
      at(2, 'user/message', userData('and again')),
    ]))

    expect(messages[0]!.usage).toBeUndefined()
    expect(messages[1]!.usage).toBeUndefined()
  })

  it('charges a turn to its closing reply alone', () => {
    const messages = deriveTimelineMessages(
      window([
        at(1, 'assistant/message', assistantData('first step', undefined, 1, 1)),
        at(2, 'assistant/message', assistantData('second step', undefined, 1, 2)),
        at(3, 'assistant/message', assistantData('the next turn', undefined, 2, 1)),
      ]),
      [turnRoute(1, { inputTokens: 32_400 }), turnRoute(2, { inputTokens: 7 })],
    )

    // One turn's charge, on the reply that closes it: the earlier reply of the
    // same turn carries none.
    expect(messages[0]!.turnCost).toBeUndefined()
    expect(messages[1]!.turnCost).toEqual([turnRoute(1, { inputTokens: 32_400 })])
    expect(messages[2]!.turnCost).toEqual([turnRoute(2, { inputTokens: 7 })])
  })

  it('keeps every route bucket a single turn accrued', () => {
    const messages = deriveTimelineMessages(
      window([at(1, 'assistant/message', assistantData('answered', undefined, 1, 1))]),
      [
        turnRoute(1, { inputTokens: 1 }),
        { ...turnRoute(1, { outputTokens: 2 }), provider: 'other', model: 'other-model' },
        turnRoute(2, { inputTokens: 3 }),
      ],
    )

    // A turn that switched models keeps one bucket per route, and a turn with no
    // reply in the window contributes nothing.
    expect(messages[0]!.turnCost).toEqual([
      turnRoute(1, { inputTokens: 1 }),
      { ...turnRoute(1, { outputTokens: 2 }), provider: 'other', model: 'other-model' },
    ])
  })

  it('closes a turn on its last reply that rendered text', () => {
    const messages = deriveTimelineMessages(
      window([
        at(1, 'assistant/message', assistantData('the visible answer', undefined, 1, 1)),
        at(2, 'assistant/message', reasoningData(1, 2)),
      ]),
      [turnRoute(1, { inputTokens: 5 })],
    )

    // The turn's last event carries no text, so it renders nothing; the charge
    // stays on the last reply the card shows, as the chat's turn tail does.
    expect(messages).toHaveLength(1)
    expect(messages[0]!.turnCost).toEqual([turnRoute(1, { inputTokens: 5 })])
  })

  it('leaves a reply without a turn charge when the projection reported no turn buckets', () => {
    const messages = deriveTimelineMessages(window([
      at(1, 'assistant/message', assistantData('answered', { inputTokens: 1, outputTokens: 1 })),
    ]))

    expect(messages[0]!.turnCost).toBeUndefined()
  })
})

describe('sameTimelineMessages', () => {
  const list = [{ key: 2, role: 'user' as const, text: 'hello', time: 200 }]

  it('reports two independently built lists with the same rendering as equal', () => {
    expect(sameTimelineMessages(list, [{ key: 2, role: 'user', text: 'hello', time: 200 }])).toBe(true)
    expect(sameTimelineMessages([], [])).toBe(true)
  })

  it('reports any field difference and any length difference as unequal', () => {
    expect(sameTimelineMessages(list, [{ ...list[0]!, key: 3 }])).toBe(false)
    expect(sameTimelineMessages(list, [{ ...list[0]!, role: 'assistant' }])).toBe(false)
    expect(sameTimelineMessages(list, [{ ...list[0]!, text: 'goodbye' }])).toBe(false)
    expect(sameTimelineMessages(list, [{ ...list[0]!, time: 900 }])).toBe(false)
    expect(sameTimelineMessages(list, [])).toBe(false)
  })
})
