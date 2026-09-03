// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SmartQA } from '../src/client/SmartQA.tsx'
import type { ChatFetcher } from '../src/client/SmartQA.tsx'
import { en } from '../src/client/locales.ts'
import type { LlmChatChunk } from '@deepseek-ai/dsh-llm/types'

afterEach(cleanup)

const t = (key: string): string => (en as Record<string, string>)[key] ?? key

function fetcher(chunks: LlmChatChunk[]): { chat: ChatFetcher; mock: ReturnType<typeof vi.fn> } {
  const impl: ChatFetcher = async function* () {
    for (const chunk of chunks) yield chunk
  }
  const mock = vi.fn(impl) as unknown as ChatFetcher & ReturnType<typeof vi.fn>
  return { chat: mock, mock }
}

describe('SmartQA flow guards', () => {
  it('ignores a send while the draft is empty', async () => {
    const { chat, mock } = fetcher([{ type: 'text-delta', index: 0, text: 'x' }])
    render(<SmartQA t={t} chat={chat} model={{ provider: 'p', model: 'm' }} />)
    fireEvent.click(screen.getByRole('button', { name: en.send }))
    expect(mock).not.toHaveBeenCalled()
  })

  it('ignores a send without a model even when a draft is present', async () => {
    const { chat, mock } = fetcher([{ type: 'text-delta', index: 0, text: 'x' }])
    render(<SmartQA t={t} chat={chat} model={null} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'hi' } })
    fireEvent.click(screen.getByRole('button', { name: en.send }))
    expect(mock).not.toHaveBeenCalled()
  })

  it('sends a follow-up that includes the prior assistant text', async () => {
    const { chat, mock } = fetcher([
      { type: 'text-delta', index: 0, text: 'first' },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    render(<SmartQA t={t} chat={chat} model={{ provider: 'p', model: 'm' }} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'hello' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.send })) })
    fireEvent.change(input, { target: { value: 'again' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.send })) })
    expect(mock).toHaveBeenCalledTimes(2)
    const second = mock.mock.calls[1]?.[0] as { messages: readonly { role: string; content: readonly { text: string }[] }[] }
    expect(second.messages.some(message => message.content.some(block => block.text === 'first'))).toBe(true)
  })

  it('surfaces a thrown fetcher error (non-AbortError)', async () => {
    const chat: ChatFetcher = async function* () {
      throw new Error('network')
      yield { type: 'text-delta', index: 0, text: 'x' } as never
    }
    render(<SmartQA t={t} chat={chat} model={{ provider: 'p', model: 'm' }} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'hi' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.send })) })
    expect(screen.getByText('network')).toBeTruthy()
  })

  it('does not surface an AbortError as a message', async () => {
    const chat: ChatFetcher = async function* () {
      const error = new Error('aborted')
      error.name = 'AbortError'
      throw error
      yield { type: 'text-delta', index: 0, text: 'x' } as never
    }
    render(<SmartQA t={t} chat={chat} model={{ provider: 'p', model: 'm' }} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'hi' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.send })) })
    expect(screen.queryByText('aborted')).toBeNull()
  })

  it('sends on Enter without the shift key', async () => {
    const { chat, mock } = fetcher([{ type: 'finish', reason: { kind: 'stop' } }])
    render(<SmartQA t={t} chat={chat} model={{ provider: 'p', model: 'm' }} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'hi' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false })
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('leaves the draft intact on shift+Enter', async () => {
    const { chat, mock } = fetcher([{ type: 'finish', reason: { kind: 'stop' } }])
    render(<SmartQA t={t} chat={chat} model={{ provider: 'p', model: 'm' }} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'hi' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(mock).not.toHaveBeenCalled()
    expect(input.value).toBe('hi')
  })
})
