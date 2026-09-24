/** What the scoped timeline derives from a Session event window. */

import { describe, expect, it } from 'vitest'
import type { SessionEventLikeEntry, SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { deriveTimelineMessages, sameTimelineMessages } from '../src/client/timelineMessages.ts'

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

/** An assistant message event data payload. */
function assistantData(text: string): unknown {
  return {
    turn: 1,
    step: 1,
    message: { id: 'm2', role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'p', model: 'm' } },
    stream: [],
  }
}

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
