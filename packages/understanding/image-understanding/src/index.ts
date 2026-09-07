/**
 * Image-understanding plugin: translates admitted image blocks into bounded
 * text before a text-only model request is derived, through a pluggable
 * recognition backend (free Zhipu vision API, local Ollama, or the Windows
 * system OCR engine).
 * @module @deepseek-ai/dsh-image-understanding
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import { contentHasImage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { AttachmentError, ImageToText } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import {
  boundText,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_PROMPT,
  DEFAULT_ZHIPU_API_KEY_ENV,
  DEFAULT_ZHIPU_BASE_URL,
  DEFAULT_ZHIPU_MODEL,
  ImageRecognitionError,
  isAbortError,
  normalizePng,
  OllamaBackend,
  RecognizeBackend,
  WindowsOcrBackend,
  ZhipuVisionBackend,
} from './backends.ts'
import type { RecognizeInput } from './backends.ts'
import type { ImageUnderstandingFailedEventData, ImageUnderstandingFailureReason } from './events.ts'

export type { ImageUnderstandingFailureReason } from './events.ts'
export type { ImageUnderstandingFailedEventData } from './events.ts'
export { ImageRecognitionError } from './backends.ts'

/** Default output cap for one recognized image. */
export const DEFAULT_MAX_TEXT_CHARS = 8000
/** Default per-image backend timeout. */
export const DEFAULT_TIMEOUT_MS = 30_000

/** Recognition backend selector. */
export type BackendKind = 'zhipu' | 'ollama' | 'windows'

/** Zhipu free-vision-API backend configuration. */
export interface ZhipuOptions {
  /** Environment-variable name holding the API key. */
  apiKeyEnv?: string
  /** OpenAI-compatible chat-completions endpoint. */
  baseURL?: string
  /** Vision model id. */
  model?: string
  /** Recognition instruction sent with the image. */
  prompt?: string
}

/** Local Ollama backend configuration. */
export interface OllamaOptions {
  /** Ollama server origin. */
  baseURL?: string
  /** Multimodal model id. */
  model?: string
  /** Recognition instruction sent with the image. */
  prompt?: string
}

/** Plugin configuration, validated by the same-named schemastery schema. */
export interface Config {
  /**
   * Recognition backend. Omission resolves by platform: Windows hosts default
   * to the keyless system OCR engine, other hosts to local Ollama. An explicit
   * `windows` selection on a non-Windows host fails at load (fail loud).
   */
  backend?: BackendKind
  /** Maximum characters of one recognized image's text (default 8000). */
  maxTextChars?: number
  /** Per-image backend timeout in milliseconds (default 30000). */
  timeoutMs?: number
  /** Zhipu free-vision-API settings. */
  zhipu?: ZhipuOptions
  /** Ollama settings. */
  ollama?: OllamaOptions
}

export const Config: z<Config> = z.object({
  backend: z.union(['zhipu', 'ollama', 'windows']),
  maxTextChars: z.number().step(1).min(1).default(DEFAULT_MAX_TEXT_CHARS),
  timeoutMs: z.number().step(1).min(1000).default(DEFAULT_TIMEOUT_MS),
  zhipu: z.object({
    apiKeyEnv: z.string().role('credential-ref'),
    baseURL: z.string(),
    model: z.string(),
    prompt: z.string(),
  }),
  ollama: z.object({
    baseURL: z.string(),
    model: z.string(),
    prompt: z.string(),
  }),
})

/** Resolved plugin options with the backend selected and every default applied. */
export interface ResolvedOptions {
  backend: RecognizeBackend
  maxTextChars: number
  timeoutMs: number
  /** Whether the backend needs PNG-normalized bytes (the Windows OCR engine). */
  normalizeToPng: boolean
}

/**
 * The one explicit resolve step: platform-defaulted backend selection and
 * fail-loud platform checks, so misconfiguration dies at load instead of at
 * the first image.
 * @param config - validated plugin configuration.
 * @param ctx - plugin context; Zhipu's API-key resolver reads the optional
 *   `credentials` seam from it per request.
 * @returns resolved backend and limits.
 */
export function resolveConfig(config: Config, ctx: Context): ResolvedOptions {
  const backend = config.backend ?? (process.platform === 'win32' ? 'windows' : 'ollama')
  if (backend === 'windows' && process.platform !== 'win32') {
    throw new Error('image-understanding: the `windows` OCR backend requires a Windows host')
  }
  const maxTextChars = config.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let selected: RecognizeBackend
  switch (backend) {
    case 'zhipu': {
      const apiKeyEnv = config.zhipu?.apiKeyEnv ?? DEFAULT_ZHIPU_API_KEY_ENV
      const ref: CredentialRef = credentialRef(apiKeyEnv)
      selected = new ZhipuVisionBackend({
        baseURL: config.zhipu?.baseURL ?? DEFAULT_ZHIPU_BASE_URL,
        model: config.zhipu?.model ?? DEFAULT_ZHIPU_MODEL,
        prompt: config.zhipu?.prompt ?? DEFAULT_PROMPT,
        apiKey: () => resolveApiKey(ctx, ref, apiKeyEnv),
      })
      break
    }
    case 'ollama':
      selected = new OllamaBackend({
        baseURL: config.ollama?.baseURL ?? DEFAULT_OLLAMA_BASE_URL,
        model: config.ollama?.model ?? DEFAULT_OLLAMA_MODEL,
        prompt: config.ollama?.prompt ?? DEFAULT_PROMPT,
      })
      break
    case 'windows':
      selected = new WindowsOcrBackend()
      break
  }
  return {
    backend: selected,
    maxTextChars,
    timeoutMs,
    normalizeToPng: backend === 'windows',
  }
}

/**
 * Resolve the optional `credentials` seam for one API-key environment
 * reference; without the seam (or on a miss) the launching environment is the
 * whole credential plane, mirroring the DeepSeek adapter's resolution.
 * @param ctx - context carrying the optional seam.
 * @param ref - environment-variable credential reference.
 * @param envName - raw environment-variable name for the ambient fallback.
 * @returns the resolved key.
 */
async function resolveApiKey(ctx: Context, ref: CredentialRef, envName: string): Promise<string> {
  const credentials = ctx.get('credentials') as
    | { resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> }
    | undefined
  if (credentials !== undefined) {
    const hit = await credentials.resolve(ref)
    if (hit !== undefined && hit.value.length > 0) return hit.value
  }
  const ambient = process.env[envName]
  if (ambient !== undefined && ambient.length > 0) return ambient
  throw new Error(`no API key for ${JSON.stringify(ref)}; set the environment variable and store it through the credentials service`)
}

/** The `ctx.imageToText` implementation this plugin provides. */
export class ImageUnderstandingService extends ImageToText {
  /** Content-addressed recognition cache: identical bytes never re-recognize in one process. */
  private readonly cache = new Map<string, string>()

  /**
   * @param ctx - plugin context; the Service constructor registers the seam.
   * @param options - resolved backend and limits.
   */
  constructor(ctx: Context, private options: ResolvedOptions) {
    super(ctx)
  }

  /**
   * Replace the resolved backend and limits after a settings change.
   * @param options - the newly resolved backend and limits.
   */
  setOptions(options: ResolvedOptions): void {
    this.options = options
  }

  override acceptsInput(): boolean {
    return true
  }

  /**
   * Recognize one durable image and return its bounded text description.
   *
   * A per-call `prompt` replaces the configured default instruction: the user's
   * question beside the image is answered by the vision model itself, rather
   * than by a fixed OCR instruction. The cache is keyed by prompt too, since
   * different instructions produce different analyses of the same bytes.
   * @param ref - durable reference from the session log.
   * @param signal - optional cancellation; implementations must settle
   *   promptly after it aborts.
   * @param prompt - per-call recognition instruction; the configured default
   *   when absent or blank.
   * @returns the recognized text, bounded to the implementation's configured
   *   output limit.
   * @throws a stable-code error the caller can surface when the backend
   *   cannot recognize the image.
   */
  override async describe(ref: ImageAttachmentRef, signal?: AbortSignal, prompt?: string): Promise<string> {
    const instruction = prompt?.trim() ?? ''
    const key = `${String(ref.attachmentId)}|${instruction}`
    const cached = this.cache.get(key)
    if (cached !== undefined) return cached
    const combined = signal === undefined
      ? AbortSignal.timeout(this.options.timeoutMs)
      : AbortSignal.any([signal, AbortSignal.timeout(this.options.timeoutMs)])
    const stored = await this.readStored(ref, combined)
    const input = this.options.normalizeToPng
      ? { data: await normalizePng(stored.data), mediaType: 'image/png' as const }
      : { data: stored.data, mediaType: stored.ref.mediaType }
    const text = boundText(await this.recognize(input, combined, instruction), this.options.maxTextChars)
    this.cache.set(key, text)
    return text
  }

  /** Read the durable bytes, mapping attachment failures to the stable code. */
  private async readStored(ref: ImageAttachmentRef, signal: AbortSignal): Promise<StoredImageAttachment> {
    try {
      return await this.ctx.attachments.readImage(ref, signal)
    } catch (error) {
      if (error instanceof AttachmentError) {
        throw new ImageRecognitionError('ATTACHMENT_READ_ERROR', error.message, { cause: error })
      }
      throw error
    }
  }

  /** Run the backend, classifying timeout and transport failures. */
  private async recognize(input: RecognizeInput, signal: AbortSignal, prompt: string): Promise<string> {
    try {
      return await this.options.backend.recognize({ ...input, ...prompt.length > 0 ? { prompt } : {} }, signal)
    } catch (error) {
      if (isAbortError(error)) throw error
      if (error instanceof ImageRecognitionError) throw error
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new ImageRecognitionError('TIMEOUT', '图片识别超时，请重试或移除图片', { cause: error })
      }
      throw new ImageRecognitionError('BACKEND_ERROR', '图片识别失败（后端错误），请检查配置或移除图片', { cause: error })
    }
  }
}

/** Map one recognition failure to its stable reason and user-facing message. */
function failureFacts(error: unknown): { reason: ImageUnderstandingFailureReason; message: string } {
  if (error instanceof ImageRecognitionError) {
    switch (error.code) {
      case 'TIMEOUT': return { reason: 'TIMEOUT', message: '图片识别超时，请重试或移除图片' }
      case 'ATTACHMENT_READ_ERROR': return { reason: 'ATTACHMENT_READ_ERROR', message: '图片读取失败，请重新上传图片' }
      /* v8 ignore next -- ImageRecognitionError.code is a closed union, so no other code reaches the default */
      default: return { reason: 'BACKEND_ERROR', message: '图片识别失败（后端错误），请检查配置或移除图片' }
    }
  }
  return { reason: 'BACKEND_ERROR', message: '图片识别失败（后端错误），请检查配置或移除图片' }
}

/** Translate one message's image blocks into text blocks, preserving its text. */
function translateContent(
  message: UserMessage,
  texts: ReadonlyMap<number, string>,
): UserMessage {
  let imageCount = 0
  const content = message.content.map((block) => {
    if (block.type !== 'image') return block
    imageCount += 1
    /* v8 ignore next -- only fully-recognized messages reach translateContent, so every image block has text */
    const text = texts.get(imageCount) ?? ''
    return { type: 'text' as const, text: `[图片${imageCount} 识别内容]\n${text}` }
  })
  return { ...message, content }
}

/** The 1-based image positions of one message's image blocks. */
function imageIndexesOf(message: UserMessage): number[] {
  const indexes: number[] = []
  let index = 0
  for (const block of message.content) {
    if (block.type === 'image') {
      index += 1
      indexes.push(index)
    }
  }
  return indexes
}

/**
 * The user's text instruction carried beside the images in one message.
 *
 * This is the vision prompt: the vision model answers the user's question
 * (e.g. "what is inside the red box?") instead of running the configured OCR
 * instruction. Blank when the message carries only images, in which case the
 * backend falls back to its configured default prompt.
 * @param message - the user message whose text blocks form the instruction.
 * @returns the trimmed instruction, or an empty string.
 */
function instructionOf(message: UserMessage): string {
  return message.content
    .filter((block): block is Extract<UserMessage['content'][number], { type: 'text' }> => block.type === 'text')
    .map(block => block.text.trim())
    .filter(part => part.length > 0)
    .join('\n')
}

export const name = 'image-understanding'

/** Services this plugin reads: the model-catalog response and the durable image store. */
export const inject = ['llm', 'attachments']

/**
 * Install the plugin: register the `ctx.imageToText` seam and translate
 * admitted image messages for text-only models at `agent/pre-step`. Vision
 * models pass through untouched; on recognition failure the original messages
 * are restored to the `next-turn` inbox and a durable
 * `user/image-understanding-failed` notification is appended, so the prompt
 * stays pending for the user instead of silently degrading.
 * @param ctx - plugin context.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const service = new ImageUnderstandingService(ctx, resolveConfig(config, ctx))

  ctx.on('agent/pre-step', async ({ agent, messages, step, signal }, next): Promise<PreStepDecision> => {
    const imageMessages = messages.filter(message => contentHasImage(message.content))
    if (imageMessages.length === 0) return next()

    // Native vision routes pass through: the adapter resolves image blocks
    // itself, and translating would waste tokens and fidelity. The agent's
    // composition route is the standing answer (a per-turn model selection is
    // not readable at this boundary); an unresolvable route is translated
    // conservatively — the seam exists precisely because such a route may be
    // text-only.
    const provider = agent.options.provider
    const model = agent.options.model
    if (provider !== undefined && model !== undefined && provider !== '' && model !== '') {
      try {
        const info = await ctx.llm.resolveModelInfo(provider, model)
        if (info.inputModalities?.includes('image')) return await next()
      } catch {
        // Unresolvable route: translate (see above).
      }
    }

    let failed = false
    let lastFailure: unknown
    const rewritten: UserMessage[] = []
    for (const message of messages) {
      const indexes = imageIndexesOf(message)
      if (indexes.length === 0) {
        rewritten.push(message)
        continue
      }
      const texts = new Map<number, string>()
      const failedIndexes: number[] = []
      const instruction = instructionOf(message)
      for (const imageIndex of indexes) {
        let block: Extract<UserMessage['content'][number], { type: 'image' }> | undefined
        let seen = 0
        for (const candidate of message.content) {
          if (candidate.type !== 'image') continue
          seen += 1
          if (seen === imageIndex) {
            block = candidate
            break
          }
        }
        /* v8 ignore next -- imageIndexesOf counts the same image blocks this loop finds, so block is never undefined */
        if (block === undefined) continue
        try {
          texts.set(imageIndex, await service.describe(block.attachment, signal, instruction))
        } catch (error) {
          if (isAbortError(error) || signal.aborted) throw error
          failed = true
          lastFailure = error
          failedIndexes.push(imageIndex)
        }
      }
      if (failedIndexes.length > 0) {
        const { reason, message: explanation } = failureFacts(lastFailure)
        const data: ImageUnderstandingFailedEventData = {
          messageId: message.id,
          failedIndexes,
          reason,
          explanation,
        }
        agent.session.append('user/image-understanding-failed', data)
      } else {
        rewritten.push(translateContent(message, texts))
      }
    }

    if (!failed) {
      return { kind: 'enter', messages: rewritten }
    }

    // Recognition failed: restore EVERY claimed message to the pending queue
    // in original order and close the step without entering it, so the user
    // can edit, remove images from, or resend the prompt.
    for (const message of messages) {
      agent.send(message, 'next-turn', false)
    }
    return step === 0 ? { kind: 'enter', messages: [] } : { kind: 'reject' }
  })
}
