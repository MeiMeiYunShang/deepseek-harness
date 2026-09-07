import { afterEach, afterAll, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { Context } from '@deepseek-ai/cordis'

vi.mock('node:child_process', async importOriginal => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: vi.fn(),
}))
import {
  boundText, dataUrl, DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL, DEFAULT_PROMPT,
  DEFAULT_ZHIPU_API_KEY_ENV, DEFAULT_ZHIPU_BASE_URL, DEFAULT_ZHIPU_MODEL,
  ImageRecognitionError, isAbortError, normalizePng, OllamaBackend, WindowsOcrBackend, ZhipuVisionBackend,
} from '../src/backends.ts'
import { resolveConfig } from '../src/index.ts'

afterEach(() => { vi.restoreAllMocks() })
afterAll(() => { vi.unstubAllGlobals() })

/** A minimal valid 1x1 PNG for sharp normalization. */
const PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
))

describe('boundText', () => {
  it('keeps text short enough and truncates long text with an ellipsis', () => {
    expect(boundText('hello', 10)).toBe('hello')
    expect(boundText('hello world', 5)).toBe('hello…')
  })
})

describe('dataUrl', () => {
  it('builds a base64 data URL over the media type', () => {
    expect(dataUrl({ data: PNG, mediaType: 'image/png' })).toMatch(/^data:image\/png;base64,/)
  })
})

describe('isAbortError', () => {
  it('matches DOMAbortError by name and rejects others', () => {
    expect(isAbortError(new Error('aborted'))).toBe(false)
    const abort = new DOMException('aborted', 'AbortError')
    expect(isAbortError(abort)).toBe(true)
  })
})

describe('normalizePng', () => {
  it('re-encodes a supported raster to PNG', async () => {
    const out = await normalizePng(PNG)
    expect(out.length).toBeGreaterThan(0)
  })
})

describe('ZhipuVisionBackend', () => {
  const input = { data: PNG, mediaType: 'image/png' as const }
  const base = {
    baseURL: DEFAULT_ZHIPU_BASE_URL, model: DEFAULT_ZHIPU_MODEL, prompt: DEFAULT_PROMPT,
    apiKey: () => Promise.resolve('key'),
  }
  const fetchMock = (response: { status: number; body: unknown }): void => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      status: response.status,
      json: async () => response.body,
    }) as unknown as Response))
  }

  it('posts and returns the content', async () => {
    fetchMock({ status: 200, body: { choices: [{ message: { content: 'text' } }] } })
    const text = await new ZhipuVisionBackend(base).recognize(input, new AbortController().signal)
    expect(text).toBe('text')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining(DEFAULT_ZHIPU_BASE_URL),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('throws a stable error on an unresolved API key', async () => {
    const backend = new ZhipuVisionBackend({ ...base, apiKey: () => Promise.reject(new Error('no key')) })
    await expect(backend.recognize(input, new AbortController().signal)).rejects.toThrow(/API key unavailable/)
  })

  it('throws a stable error on a non-200 response', async () => {
    fetchMock({ status: 429, body: {} })
    await expect(new ZhipuVisionBackend(base).recognize(input, new AbortController().signal)).rejects.toMatchObject({ code: 'BACKEND_ERROR' })
  })

  it('throws a stable error when the response carries no text', async () => {
    fetchMock({ status: 200, body: { choices: [{ message: { content: '' } }] } })
    await expect(new ZhipuVisionBackend(base).recognize(input, new AbortController().signal)).rejects.toMatchObject({ code: 'BACKEND_ERROR' })
  })
})

describe('OllamaBackend', () => {
  const input = { data: PNG, mediaType: 'image/png' as const }
  const base = { baseURL: DEFAULT_OLLAMA_BASE_URL, model: DEFAULT_OLLAMA_MODEL, prompt: DEFAULT_PROMPT }

  it('posts to /api/chat and returns the content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      status: 200,
      json: async () => ({ message: { content: 'text' } }),
    }) as unknown as Response))
    const text = await new OllamaBackend(base).recognize(input, new AbortController().signal)
    expect(text).toBe('text')
    expect(globalThis.fetch).toHaveBeenCalledWith(`${DEFAULT_OLLAMA_BASE_URL}/api/chat`, expect.objectContaining({ method: 'POST' }))
  })

  it('throws on a non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 500, json: async () => ({}) }) as unknown as Response))
    await expect(new OllamaBackend(base).recognize(input, new AbortController().signal)).rejects.toMatchObject({ code: 'BACKEND_ERROR' })
  })

  it('throws when the response carries empty content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, json: async () => ({ message: { content: '' } }) }) as unknown as Response))
    await expect(new OllamaBackend(base).recognize(input, new AbortController().signal)).rejects.toMatchObject({ code: 'BACKEND_ERROR' })
  })
})

describe('WindowsOcrBackend', () => {
  it('fails loud on a non-Windows host', async () => {
    const original = process.platform
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux' as NodeJS.Platform)
    await expect(new WindowsOcrBackend().recognize({ data: PNG, mediaType: 'image/png' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'BACKEND_ERROR' })
    void original
  })

  it('returns the OCR stdout on a successful child', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32' as NodeJS.Platform)
    const child = captureChild()
    const promise = new WindowsOcrBackend().recognize({ data: PNG, mediaType: 'image/png' }, new AbortController().signal)
    await spawned()
    child.stdout.emit('data', Buffer.from('recognized\n'))
    child.emit('close', 0)
    await expect(promise).resolves.toBe('recognized')
  })

  it('throws on a non-zero exit', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32' as NodeJS.Platform)
    const child = captureChild()
    const promise = new WindowsOcrBackend().recognize({ data: PNG, mediaType: 'image/png' }, new AbortController().signal)
    await spawned()
    child.stdout.emit('data', Buffer.from('x'))
    child.stderr.emit('data', Buffer.from('boom'))
    child.emit('close', 1)
    await expect(promise).rejects.toMatchObject({ code: 'BACKEND_ERROR' })
  })

  it('throws on empty stdout', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32' as NodeJS.Platform)
    const child = captureChild()
    const promise = new WindowsOcrBackend().recognize({ data: PNG, mediaType: 'image/png' }, new AbortController().signal)
    await spawned()
    child.emit('close', 0)
    await expect(promise).rejects.toMatchObject({ code: 'BACKEND_ERROR' })
  })

  it('rejects on a child spawn error', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32' as NodeJS.Platform)
    const child = captureChild()
    const promise = new WindowsOcrBackend().recognize({ data: PNG, mediaType: 'image/png' }, new AbortController().signal)
    await spawned()
    child.emit('error', new Error('no start'))
    await expect(promise).rejects.toMatchObject({ code: 'BACKEND_ERROR' })
  })

  it('rejects with a timeout when the caller aborts', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32' as NodeJS.Platform)
    const controller = new AbortController()
    captureChild()
    const promise = new WindowsOcrBackend().recognize({ data: PNG, mediaType: 'image/png' }, controller.signal)
    await spawned()
    controller.abort()
    await expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' })
  })
})

/** Resolve once the mocked spawn has been called and the child handlers attached. */
async function spawned(): Promise<void> {
  await vi.waitFor(() => { expect(spawn).toHaveBeenCalled() })
}

/** Capture a fresh controllable child returned by the mocked spawn. */
function captureChild(): {
  stdout: EventEmitter
  stderr: EventEmitter
  emit: (e: string, ...a: unknown[]) => void
  kill: ReturnType<typeof vi.fn>
} {
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  const handlers = new Map<string, (...a: unknown[]) => void>()
  const child = {
    stdout,
    stderr,
    kill: vi.fn(),
    on: (e: string, fn: (...a: unknown[]) => void) => { handlers.set(e, fn); return child },
    emit: (e: string, ...a: unknown[]) => { handlers.get(e)?.(...a); return true },
  }
  const spawnMock = spawn as unknown as ReturnType<typeof vi.fn>
  spawnMock.mockClear()
  spawnMock.mockReturnValue(child)
  return child
}

describe('resolveConfig', () => {
  it('defaults to Windows OCR on Windows and Ollama elsewhere', () => {
    const ctx = new Context()
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32' as NodeJS.Platform)
    expect(resolveConfig({}, ctx).normalizeToPng).toBe(true)
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux' as NodeJS.Platform)
    expect(resolveConfig({}, ctx).normalizeToPng).toBe(false)
  })

  it('fails loud when windows is selected on a non-Windows host', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux' as NodeJS.Platform)
    expect(() => resolveConfig({ backend: 'windows' }, new Context())).toThrow(/requires a Windows host/)
  })

  it('selects the zhipu backend with the configured key environment', () => {
    const ctx = new Context()
    const options = resolveConfig({ backend: 'zhipu', zhipu: { apiKeyEnv: DEFAULT_ZHIPU_API_KEY_ENV } }, ctx)
    expect(options.normalizeToPng).toBe(false)
    expect(options.backend).toBeInstanceOf(ZhipuVisionBackend)
  })

  it('applies configured limits and the Ollama endpoint', () => {
    const options = resolveConfig({ backend: 'ollama', maxTextChars: 100, timeoutMs: 5000 }, new Context())
    expect(options.maxTextChars).toBe(100)
    expect(options.timeoutMs).toBe(5000)
    expect(options.backend).toBeInstanceOf(OllamaBackend)
  })

  it('zhipu resolveConfig resolves the key through the credentials seam with a default env name', async () => {
    const ctx = new Context()
    ctx.provide('credentials', { resolve: async () => ({ value: 'secret', source: 'env' } as never) })
    const options = resolveConfig({ backend: 'zhipu' }, ctx)
    expect(options.backend).toBeInstanceOf(ZhipuVisionBackend)
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, json: async () => ({ choices: [{ message: { content: 'x' } }] }) }) as unknown as Response))
    const text = await options.backend.recognize({ data: PNG, mediaType: 'image/png' }, new AbortController().signal)
    expect(text).toBe('x')
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer secret' }),
    }))
  })

  it('zhipu falls back to the launching environment when the credentials seam is absent', async () => {
    const ctx = new Context()
    process.env.ZHIPU_API_KEY = 'env-key'
    const options = resolveConfig({ backend: 'zhipu' }, ctx)
    expect(() => options.backend).toBeDefined()
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, json: async () => ({ choices: [{ message: { content: 'y' } }] }) }) as unknown as Response))
    const text = await options.backend.recognize({ data: PNG, mediaType: 'image/png' }, new AbortController().signal)
    expect(text).toBe('y')
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer env-key' }),
    }))
    delete process.env.ZHIPU_API_KEY
  })

  it('zhipu ignores a blank credential value and falls through to the environment', async () => {
    const ctx = new Context()
    ctx.provide('credentials', { resolve: async () => ({ value: '', source: 'env' } as never) })
    process.env.ZHIPU_API_KEY = 'env-key'
    const options = resolveConfig({ backend: 'zhipu' }, ctx)
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, json: async () => ({ choices: [{ message: { content: 'z' } }] }) }) as unknown as Response))
    const text = await options.backend.recognize({ data: PNG, mediaType: 'image/png' }, new AbortController().signal)
    expect(text).toBe('z')
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer env-key' }),
    }))
    delete process.env.ZHIPU_API_KEY
  })

  it('zhipu throws a stable error when no API key resolves', async () => {
    const options = resolveConfig({ backend: 'zhipu' }, new Context())
    await expect(options.backend.recognize({ data: PNG, mediaType: 'image/png' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'BACKEND_ERROR' })
  })
})

describe('ImageRecognitionError', () => {
  it('carries a stable code', () => {
    const error = new ImageRecognitionError('TIMEOUT', 'timeout')
    expect(error.code).toBe('TIMEOUT')
    expect(error.name).toBe('ImageRecognitionError')
  })
})
