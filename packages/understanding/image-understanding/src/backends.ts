/**
 * Pluggable image-recognition backends: a free OpenAI-compatible vision API
 * (Zhipu GLM-4V-Flash), a local Ollama service, and the Windows system OCR
 * engine. Every backend returns the recognized text bounded by the caller's
 * configured character limit.
 * @module @deepseek-ai/dsh-image-understanding/backends
 */

import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'

/** One normalized recognition request. */
export interface RecognizeInput {
  /** Complete encoded raster bytes, normalized to PNG for engines that need it. */
  data: Uint8Array
  /** Media type of `data`. */
  mediaType: ImageMediaType
  /**
   * Per-call recognition instruction replacing the backend's configured
   * prompt; absent for the configured default. Pure OCR engines ignore it.
   */
  prompt?: string
}

/** Stable backend failure. */
export class ImageRecognitionError extends Error {
  override readonly name = 'ImageRecognitionError'
  /** Machine-routing code: `BACKEND_ERROR`, `TIMEOUT`, or `ATTACHMENT_READ_ERROR`. */
  readonly code: 'BACKEND_ERROR' | 'TIMEOUT' | 'ATTACHMENT_READ_ERROR'

  constructor(code: 'BACKEND_ERROR' | 'TIMEOUT' | 'ATTACHMENT_READ_ERROR', message: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
  }
}

/**
 * Whether one error is the caller's own cancellation.
 * @param error - the caught value to test.
 * @returns `true` when the error is a DOMAbortError.
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/**
 * Base64 data URL of one recognized image.
 * @param input - raw image bytes and media type.
 * @returns a `data:` URL suitable for embedding in vision-API requests.
 */
export function dataUrl(input: RecognizeInput): string {
  return `data:${input.mediaType};base64,${Buffer.from(input.data).toString('base64')}`
}

/**
 * Normalize any supported raster to PNG (the Windows OCR engine's safe input).
 * @param data - raw bytes of the source image.
 * @returns re-encoded PNG bytes.
 */
export async function normalizePng(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await sharp(data, { failOn: 'error' }).png().toBuffer())
}

/** Default recognition instruction shared by the API backends. */
export const DEFAULT_PROMPT =
  '请识别这张图片的内容。如果图片包含文字，请完整、逐字地输出所有文字内容（保持原语言与阅读顺序）；'
  + '如果图片没有文字，请用简洁的中文描述图片中的主要内容和场景。'
  + '直接输出识别结果，不要添加任何前缀、解释或额外说明。'

/** Default Zhipu (free GLM-4V-Flash) endpoint. */
export const DEFAULT_ZHIPU_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
/** Default Zhipu model id. */
export const DEFAULT_ZHIPU_MODEL = 'glm-4v-flash'
/** Default environment variable name for the Zhipu API key. */
export const DEFAULT_ZHIPU_API_KEY_ENV = 'ZHIPU_API_KEY'

/** Default Ollama endpoint. */
export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434'
/** Default Ollama model id (a multimodal model with OCR capability). */
export const DEFAULT_OLLAMA_MODEL = 'deepseek-ocr:3b'

/** One recognition call, bounded by its own timeout and the caller's signal. */
export interface RecognizeBackend {
  /**
   * Recognize one image.
   * @param input - normalized encoded bytes.
   * @param signal - combined caller-cancellation and timeout signal.
   * @returns the recognized text.
   * @throws ImageRecognitionError on backend or timeout failure.
   */
  recognize(input: RecognizeInput, signal: AbortSignal): Promise<string>
}

/** OpenAI-compatible chat-completions vision backend (Zhipu GLM-4V-Flash). */
export class ZhipuVisionBackend implements RecognizeBackend {
  /** @param options - endpoint, model, prompt, and credential reference. */
  constructor(private readonly options: {
    baseURL: string
    model: string
    prompt: string
    apiKey: () => Promise<string>
  }) {}

  async recognize(input: RecognizeInput, signal: AbortSignal): Promise<string> {
    let apiKey: string
    try {
      apiKey = await this.options.apiKey()
    } catch (error) {
      throw new ImageRecognitionError('BACKEND_ERROR', `Zhipu API key unavailable: ${String(error)}`, { cause: error })
    }
    const response = await fetch(this.options.baseURL, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.options.model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: input.prompt ?? this.options.prompt },
            { type: 'image_url', image_url: { url: dataUrl(input) } },
          ],
        }],
        stream: false,
      }),
    })
    if (response.status !== 200) {
      throw new ImageRecognitionError('BACKEND_ERROR', `Zhipu vision API answered ${response.status}`)
    }
    const payload = await response.json() as { choices?: readonly { message?: { content?: string } }[] }
    const content = payload.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.length === 0) {
      throw new ImageRecognitionError('BACKEND_ERROR', 'Zhipu vision API returned no text')
    }
    return content
  }
}

/** Local Ollama multimodal chat backend. */
export class OllamaBackend implements RecognizeBackend {
  /** @param options - endpoint, model, and prompt. */
  constructor(private readonly options: {
    baseURL: string
    model: string
    prompt: string
  }) {}

  async recognize(input: RecognizeInput, signal: AbortSignal): Promise<string> {
    const response = await fetch(`${this.options.baseURL.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.options.model,
        messages: [{
          role: 'user',
          content: input.prompt ?? this.options.prompt,
          images: [Buffer.from(input.data).toString('base64')],
        }],
        stream: false,
      }),
    })
    if (response.status !== 200) {
      throw new ImageRecognitionError('BACKEND_ERROR', `Ollama answered ${response.status}`)
    }
    const payload = await response.json() as { message?: { content?: string } }
    const content = payload.message?.content
    if (typeof content !== 'string' || content.length === 0) {
      throw new ImageRecognitionError('BACKEND_ERROR', 'Ollama returned no text')
    }
    return content
  }
}

/**
 * Windows system OCR backend (`Windows.Media.Ocr`), offline and keyless.
 * The engine decodes from the user-profile languages; the harness only
 * guarantees the image itself was decodable.
 */
export class WindowsOcrBackend implements RecognizeBackend {
  /**
   * Windows OCR PowerShell driver. Loads the WinRT projection for StorageFile,
   * BitmapDecoder, and OcrEngine, awaits the async WinRT calls through the
   * generic `AsTask` bridge, recognizes the decoded bitmap, and prints the
   * result text on stdout. Joined from single-quoted lines so the PowerShell
   * `$` variables and backtick escapes survive the TS source verbatim.
   */
  private static readonly SCRIPT = [
    'param([string]$Path)',
    'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
    "$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]",
    'Function Await($WinRtTask, $ResultType) {',
    '  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)',
    '  $netTask = $asTask.Invoke($null, @($WinRtTask))',
    '  $netTask.Wait(-1) | Out-Null',
    '  $netTask.Result',
    '}',
    '[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime] | Out-Null',
    '[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null',
    '[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime] | Out-Null',
    '$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])',
    '$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])',
    '$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])',
    '$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])',
    '$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()',
    "if ($null -eq $engine) { Write-Error 'OCR engine unavailable for the user profile languages'; exit 1 }",
    '$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])',
    'Write-Output $result.Text',
  ].join('\n')

  async recognize(input: RecognizeInput, signal: AbortSignal): Promise<string> {
    if (process.platform !== 'win32') {
      throw new ImageRecognitionError('BACKEND_ERROR', 'Windows OCR requires a Windows host')
    }
    const dir = await mkdtemp(join(tmpdir(), 'dsh-ocr-'))
    const imagePath = join(dir, 'input.png')
    const scriptPath = join(dir, 'ocr.ps1')
    try {
      await Promise.all([
        writeFile(imagePath, input.data),
        writeFile(scriptPath, WindowsOcrBackend.SCRIPT),
      ])
      return await new Promise<string>((resolve, reject) => {
        const child = spawn(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, imagePath],
          { windowsHide: true },
        )
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
        child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
        const onAbort = (): void => {
          child.kill()
          reject(new ImageRecognitionError('TIMEOUT', 'Windows OCR cancelled or timed out'))
        }
        signal.addEventListener('abort', onAbort, { once: true })
        child.on('error', (error) => {
          signal.removeEventListener('abort', onAbort)
          reject(new ImageRecognitionError('BACKEND_ERROR', `Windows OCR failed to start: ${String(error)}`))
        })
        child.on('close', (code) => {
          signal.removeEventListener('abort', onAbort)
          if (code !== 0) {
            reject(new ImageRecognitionError('BACKEND_ERROR', `Windows OCR failed (${code}): ${stderr.trim()}`))
            return
          }
          const text = stdout.trim()
          if (text.length === 0) {
            reject(new ImageRecognitionError('BACKEND_ERROR', 'Windows OCR returned no text'))
            return
          }
          resolve(text)
        })
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
}

/**
 * Bound one backend's output to the configured character limit.
 * @param text - raw backend output.
 * @param maxChars - maximum allowed characters before truncation.
 * @returns the original text when short enough, otherwise truncated with an ellipsis.
 */
export function boundText(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`
}
