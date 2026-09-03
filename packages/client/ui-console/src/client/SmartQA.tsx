import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { LlmChatChunk, LlmChatRequest } from '@deepseek-ai/dsh-llm/types'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import css from './console.module.css'

/** One rendered chat message in the Smart Q&A panel. */
interface ChatMessage {
  /** Stable render id. */
  id: number
  /** Author of the message. */
  role: 'user' | 'assistant'
  /** Rendered text content (assistant content streams in incrementally). */
  content: string
}

/** One-way completion channel the Smart Q&A panel streams over. */
export type ChatFetcher = (
  request: LlmChatRequest,
  signal: AbortSignal,
) => AsyncIterable<LlmChatChunk>

/** Full props for the Smart Q&A panel. */
export interface SmartQAProps {
  /** Namespace translator. */
  t: PropsLocale<typeof NS>['t']
  /** Streams one completion over the `chat` Remote. */
  chat: ChatFetcher
  /** Selected model identity; null disables sending. */
  model: { provider: string; model: string } | null
}

/**
 * Smart Q&A panel: streams the operator's question to `ctx.remote.llm.chat`
 * and renders the reply as it arrives.
 * @param props - translator, the chat fetcher, and the selected model.
 */
export function SmartQA({ t, chat, model }: SmartQAProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const nextId = useRef(0)

  useEffect(() => {
    const el = listRef.current
    /* v8 ignore next -- listRef is always attached when this effect runs (the list div renders unconditionally) */
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [messages])

  async function send(): Promise<void> {
    const text = draft.trim()
    /* v8 ignore next -- while busy the send button is replaced by Stop, so a
     * second send() call cannot reach this guard; it only protects the path
     * where model or draft changed mid-flight. */
    if (text === '' || busy || model === null) return
    const userMsg: ChatMessage = { id: nextId.current++, role: 'user', content: text }
    const assistantMsg: ChatMessage = { id: nextId.current++, role: 'assistant', content: '' }
    const request: LlmChatRequest = {
      provider: model.provider,
      model: model.model,
      messages: [
        ...messages.map(message => ({
          role: message.role,
          content: [{ type: 'text' as const, text: message.content }],
        })),
        { role: 'user', content: [{ type: 'text', text }] },
      ],
    }
    setMessages(previous => [...previous, userMsg, assistantMsg])
    setDraft('')
    setBusy(true)
    setError(null)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      for await (const chunk of chat(request, controller.signal)) {
        if (chunk.type === 'text-delta') {
          setMessages(previous => previous.map(message => message.id === assistantMsg.id
            ? { ...message, content: message.content + chunk.text }
            : message))
        } else if (chunk.type === 'finish' && chunk.reason.kind === 'error') {
          setError(chunk.reason.failure.message)
          break
        }
      }
    } catch (cause) {
      if (cause instanceof Error && cause.name !== 'AbortError') setError(cause.message)
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  function stop(): void {
    abortRef.current?.abort()
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  return (
    <div className={css.smartQA}>
      <div className={css.chatMessages} ref={listRef}>
        {messages.length === 0
          ? <span className={css.emptyHint}>{t('qaEmpty')}</span>
          : messages.map(message => (
            <div key={message.id} className={`${css.message} ${css[message.role]}`}>
              {message.content || (message.role === 'assistant' && busy ? t('qaThinking') : '')}
            </div>
          ))}
        {error !== null && <div className={css.qaError}>{error}</div>}
      </div>
      <div className={css.inputArea}>
        <input
          type="text"
          className={css.input}
          placeholder={t('inputPlaceholder')}
          value={draft}
          disabled={busy}
          onChange={(event) =>{  setDraft(event.target.value) }}
          onKeyDown={onKeyDown}
        />
        {busy
          ? <button type="button" className={css.sendButton} onClick={stop}>{t('stop')}</button>
          : (
            <button
              type="button"
              className={css.sendButton}
              disabled={draft.trim() === '' || model === null}
              onClick={() => void send()}
            >
              {t('send')}
            </button>
          )}
      </div>
    </div>
  )
}
