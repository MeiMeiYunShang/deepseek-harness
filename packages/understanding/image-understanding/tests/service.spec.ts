import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId, AttachmentError } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import { ImageUnderstandingService } from '../src/index.ts'
import type { ResolvedOptions } from '../src/index.ts'
import { ImageRecognitionError } from '../src/backends.ts'
import type { RecognizeInput } from '../src/backends.ts'

const PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
))

const ref = (name = 'shot.png'): ImageAttachmentRef => ({
  attachmentId: AttachmentId('sha256:abc'),
  mediaType: 'image/png',
  bytes: PNG.byteLength,
  width: 1,
  height: 1,
  name,
})

const stored: StoredImageAttachment = { ref: ref(), data: PNG }

const options = (backends: Partial<ResolvedOptions> = {}): ResolvedOptions => ({
  backend: { recognize: vi.fn(async () => 'ok') } as unknown as ResolvedOptions['backend'],
  maxTextChars: 100,
  timeoutMs: 1000,
  normalizeToPng: false,
  ...backends,
})

function ctxWithAttachments(readImage: (r: ImageAttachmentRef, s?: AbortSignal) => Promise<StoredImageAttachment>) {
  const ctx = new Context()
  ctx.provide('attachments', { readImage } as never)
  return ctx
}

describe('ImageUnderstandingService', () => {
  it('recognizes and bounds the backend output', async () => {
    const service = new ImageUnderstandingService(
      ctxWithAttachments(async () => stored),
      options({ backend: { recognize: vi.fn(async () => 'a'.repeat(200)) } } as never),
    )
    const text = await service.describe(ref())
    expect(text).toMatch(/^a{100}…$/)
  })

  it('caches identical ref+prompt so the backend runs once', async () => {
    const recognize = vi.fn(async () => 'text')
    const service = new ImageUnderstandingService(
      ctxWithAttachments(async () => stored),
      options({ backend: { recognize } } as never),
    )
    await service.describe(ref())
    await service.describe(ref())
    expect(recognize).toHaveBeenCalledTimes(1)
  })

  it('keys the cache by prompt so a differing instruction re-recognizes', async () => {
    const recognize = vi.fn(async () => 'text')
    const service = new ImageUnderstandingService(
      ctxWithAttachments(async () => stored),
      options({ backend: { recognize } } as never),
    )
    await service.describe(ref(), undefined, 'question one')
    await service.describe(ref(), undefined, 'question two')
    expect(recognize).toHaveBeenCalledTimes(2)
  })

  it('normalizes the raster to PNG when the backend requires it', async () => {
    const backend = { recognize: vi.fn(async (_i: RecognizeInput) => 'text') }
    const service = new ImageUnderstandingService(
      ctxWithAttachments(async () => stored),
      { backend, maxTextChars: 100, timeoutMs: 1000, normalizeToPng: true } as never,
    )
    await service.describe(ref())
    const input = backend.recognize.mock.calls[0]![0] as RecognizeInput
    expect(input.mediaType).toBe('image/png')
  })

  it('maps an attachment read failure to the stable ATTACHMENT_READ_ERROR code', async () => {
    const service = new ImageUnderstandingService(
      ctxWithAttachments(async () => { throw new AttachmentError('gone', 'ATTACHMENT_READ_FAILED') }),
      options(),
    )
    await expect(service.describe(ref())).rejects.toMatchObject({ code: 'ATTACHMENT_READ_ERROR' })
  })

  it('classifies a timeout as TIMEOUT and wraps a transport failure as BACKEND_ERROR', async () => {
    const timeout = new ImageUnderstandingService(ctxWithAttachments(async () => stored), options({
      backend: { recognize: async () => { throw new DOMException('t', 'TimeoutError') } } as never,
    }))
    await expect(timeout.describe(ref())).rejects.toMatchObject({ code: 'TIMEOUT' })

    const transport = new ImageUnderstandingService(ctxWithAttachments(async () => stored), options({
      backend: { recognize: async () => { throw new Error('boom') } } as never,
    }))
    await expect(transport.describe(ref())).rejects.toMatchObject({ code: 'BACKEND_ERROR' })
  })

  it('propagates caller cancellation as an AbortError', async () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    const service = new ImageUnderstandingService(ctxWithAttachments(async () => stored), options({
      backend: { recognize: async () => { throw abort } } as never,
    }))
    await expect(service.describe(ref())).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('propagates an ImageRecognitionError unchanged', async () => {
    const service = new ImageUnderstandingService(ctxWithAttachments(async () => stored), options({
      backend: { recognize: async () => { throw new ImageRecognitionError('TIMEOUT', 'x') } } as never,
    }))
    await expect(service.describe(ref())).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('reports that it accepts input', () => {
    const service = new ImageUnderstandingService(ctxWithAttachments(async () => stored), options())
    expect(service.acceptsInput()).toBe(true)
  })

  it('replaces its resolved options after a settings change', async () => {
    const service = new ImageUnderstandingService(ctxWithAttachments(async () => stored), options())
    const backend = { recognize: vi.fn(async () => 'other') }
    service.setOptions({ backend: backend as never, maxTextChars: 50, timeoutMs: 500, normalizeToPng: false })
    const text = await service.describe(ref())
    expect(text).toBe('other')
    expect(backend.recognize).toHaveBeenCalledTimes(1)
  })
})
