import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId, AttachmentError } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { apply } from '../src/index.ts'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

const PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
))
const imageRef = (): ImageAttachmentRef => ({
  attachmentId: AttachmentId('sha256:abc'),
  mediaType: 'image/png',
  bytes: PNG.byteLength,
  width: 1,
  height: 1,
  name: 'shot.png',
})

const imageMessage = (): UserMessage => createUserMessage({
  content: [
    { type: 'text', text: 'what is inside the red box?' },
    { type: 'image', attachment: imageRef() },
  ],
  source: { kind: 'user' },
})

/** A minimal attachment seam reading the PNG back. */
function attachmentsCtx(ctx: Context, opts: { fail?: boolean; attachmentError?: boolean; abort?: boolean } = {}): void {
  ctx.provide('attachments', {
    readImage: async () => {
      if (opts.attachmentError) throw new AttachmentError('gone', 'ATTACHMENT_READ_FAILED')
      if (opts.fail) throw new Error('read failed')
      if (opts.abort) { const err = new Error('aborted'); err.name = 'AbortError'; throw err }
      return { ref: imageRef(), data: PNG }
    },
  } as never)
}

function fakeAgent(options: { provider?: string; model?: string } = { provider: 'deepseek', model: 'text-model' }) {
  const append = vi.fn()
  const send = vi.fn()
  return {
    agent: { options, session: { append }, send } as unknown as Agent,
    append,
    send,
  }
}

const defaultDecision = async (messages: readonly UserMessage[]) => ({ kind: 'enter' as const, messages: [...messages] })

/** Boot the plugin and dispatch one pre-step. */
async function runPreStep({
  resolveModelInfo,
  failRead = false,
  abort = false,
  messages,
  step = 0,
  agentOptions,
}: {
  resolveModelInfo: () => Promise<{ inputModalities?: readonly string[] }>
  failRead?: boolean
  abort?: boolean
  messages: UserMessage[]
  step?: number
  agentOptions?: { provider?: string; model?: string }
}) {
  const ctx = new Context()
  attachmentsCtx(ctx, { fail: failRead, abort })
  ctx.provide('llm', { resolveModelInfo } as never)
  apply(ctx, { backend: 'ollama' } as never)
  const { agent, append, send } = fakeAgent(agentOptions)
  const result = await ctx.waterfall(
    'agent/pre-step',
    { agent, messages, turn: 1, step, signal: new AbortController().signal },
    () => defaultDecision(messages),
  )
  return { result, append, send }
}

describe('agent/pre-step image understanding', () => {
  it('delegates to next() when no message carries an image', async () => {
    const next = vi.fn(() => Promise.resolve({ kind: 'enter' as const, messages: [] }))
    const ctx = new Context()
    apply(ctx, { backend: 'ollama' } as never)
    const { agent } = fakeAgent()
    await ctx.waterfall('agent/pre-step', { agent, messages: [], turn: 1, step: 0, signal: new AbortController().signal }, next)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('passes through for a vision-capable route', async () => {
    const { result, append } = await runPreStep({
      resolveModelInfo: async () => ({ inputModalities: ['image'] }),
      messages: [imageMessage()],
    })
    expect(result).toMatchObject({ kind: 'enter', messages: [expect.objectContaining({ id: expect.anything() })] })
    expect(append).not.toHaveBeenCalled()
  })

  it('translates image blocks for a text-only route and enters the step', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      status: 200,
      json: async () => ({ message: { content: 'recognized text' } }),
    }) as unknown as Response))
    const { result } = await runPreStep({
      resolveModelInfo: async () => ({ inputModalities: ['text'] }),
      messages: [imageMessage()],
    })
    expect(result).toMatchObject({ kind: 'enter' })
    const messages = (result as { messages: UserMessage[] }).messages
    expect(messages[0]!.content[1]!).toMatchObject({ type: 'text', text: expect.stringContaining('recognized text') })
  })

  it('restores the message and logs a failure event when recognition fails', async () => {
    const { result, append, send } = await runPreStep({
      resolveModelInfo: async () => ({ inputModalities: ['text'] }),
      failRead: true,
      messages: [imageMessage()],
      step: 0,
    })
    expect(append).toHaveBeenCalledWith('user/image-understanding-failed', expect.objectContaining({
      failedIndexes: [1],
      reason: 'BACKEND_ERROR',
    }))
    expect(send).toHaveBeenCalled()
    expect(result).toMatchObject({ kind: 'enter', messages: [] })
  })

  it('classifies an attachment read failure as ATTACHMENT_READ_ERROR', async () => {
    const ctx = new Context()
    attachmentsCtx(ctx, { attachmentError: true })
    ctx.provide('llm', { resolveModelInfo: async () => ({ inputModalities: ['text'] }) } as never)
    apply(ctx, { backend: 'ollama' } as never)
    const { agent, append } = fakeAgent()
    await ctx.waterfall('agent/pre-step', { agent, messages: [imageMessage()], turn: 1, step: 0, signal: new AbortController().signal }, () => Promise.resolve({ kind: 'enter' as const, messages: [] }))
    expect(append).toHaveBeenCalledWith('user/image-understanding-failed', expect.objectContaining({ reason: 'ATTACHMENT_READ_ERROR' }))
  })

  it('classifies a backend timeout as TIMEOUT', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('t', 'TimeoutError'))))
    const { result, append } = await runPreStep({
      resolveModelInfo: async () => ({ inputModalities: ['text'] }),
      messages: [imageMessage()],
    })
    expect(append).toHaveBeenCalledWith('user/image-understanding-failed', expect.objectContaining({ reason: 'TIMEOUT' }))
    expect(result).toMatchObject({ kind: 'enter', messages: [] })
  })

  it('passes non-image messages through unchanged', async () => {
    const textOnly = createUserMessage({ content: [{ type: 'text', text: 'plain text' }], source: { kind: 'user' } })
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, json: async () => ({ message: { content: 'ok' } }) }) as unknown as Response))
    const { result } = await runPreStep({
      resolveModelInfo: async () => ({ inputModalities: ['text'] }),
      messages: [textOnly, imageMessage()],
    })
    const messages = (result as { messages: UserMessage[] }).messages
    expect(messages[0]!.content[0]!).toMatchObject({ type: 'text', text: 'plain text' })
  })

  it('translates when the composition route is unresolved', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, json: async () => ({ message: { content: 'ok' } }) }) as unknown as Response))
    const { result } = await runPreStep({
      resolveModelInfo: async () => ({ inputModalities: ['text'] }),
      messages: [imageMessage()],
      agentOptions: {},
    })
    const messages = (result as { messages: UserMessage[] }).messages
    expect(messages[0]!.content[1]!).toMatchObject({ type: 'text', text: expect.stringContaining('ok') })
  })

  it('translates every image block of a multi-image message', async () => {
    const double = createUserMessage({
      content: [
        { type: 'image', attachment: imageRef() },
        { type: 'image', attachment: { ...imageRef(), attachmentId: AttachmentId('sha256:def') } },
      ],
      source: { kind: 'user' },
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, json: async () => ({ message: { content: 'ok' } }) }) as unknown as Response))
    const { result } = await runPreStep({
      resolveModelInfo: async () => ({ inputModalities: ['text'] }),
      messages: [double],
    })
    const messages = (result as { messages: UserMessage[] }).messages
    expect(messages[0]!.content).toHaveLength(2)
    expect((messages[0]!.content[0] as { text: string }).text).toContain('识别内容')
  })

  it('propagates caller cancellation as an AbortError', async () => {
    await expect(runPreStep({
      resolveModelInfo: async () => ({ inputModalities: ['text'] }),
      abort: true,
      messages: [imageMessage()],
    })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects the step when recognition fails outside the first step', async () => {
    const { result } = await runPreStep({
      resolveModelInfo: async () => ({ inputModalities: ['text'] }),
      failRead: true,
      messages: [imageMessage()],
      step: 1,
    })
    expect(result).toMatchObject({ kind: 'reject' })
  })
})
