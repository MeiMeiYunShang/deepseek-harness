// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SmartQA } from '../src/client/SmartQA.tsx'
import type { ChatFetcher } from '../src/client/SmartQA.tsx'
import type { LlmChatChunk } from '@deepseek-ai/dsh-llm/types'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: string): string => (en as Record<string, string>)[key] ?? key

/** A chat fetcher plus its call mock, so a spec can drive and assert it. */
function fetcher(chunks: LlmChatChunk[]): { chat: ChatFetcher; mock: ReturnType<typeof vi.fn> } {
  const impl: ChatFetcher = async function* (_request, _signal) {
    for (const chunk of chunks) yield chunk
  }
  const mock = vi.fn(impl) as unknown as ChatFetcher & ReturnType<typeof vi.fn>
  return { chat: mock, mock }
}

describe('SmartQA', () => {
  it('shows the empty line and disables sending without a model', () => {
    render(<SmartQA t={t} chat={fetcher([]).chat} model={null} />)

    expect(screen.getByText(en.qaEmpty)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.send })).toHaveProperty('disabled', true)
  })

  it('streams a completion into the assistant message and clears the draft', async () => {
    const { chat, mock } = fetcher([
      { type: 'text-delta', index: 0, text: 'hello' },
      { type: 'text-delta', index: 0, text: ' world' },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    render(<SmartQA t={t} chat={chat} model={{ provider: 'p', model: 'm' }} />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hi' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.send })) })

    expect(screen.queryByText('hi')).toBeTruthy()
    expect(screen.queryByText('hello world')).toBeTruthy()
    expect((screen.getByRole('textbox') as unknown as HTMLInputElement).value).toBe('')
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('surfaces a terminal error finish', async () => {
    const { chat } = fetcher([
      { type: 'finish', reason: { kind: 'error', failure: { message: 'boom', code: 'SERVER' } } },
    ])
    render(<SmartQA t={t} chat={chat} model={{ provider: 'p', model: 'm' }} />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hi' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.send })) })

    expect(screen.getByText('boom')).toBeTruthy()
  })

  it('stops an in-flight request when the stop button is clicked', async () => {
    const aborted = vi.fn()
    const impl: ChatFetcher = async function* (_request, signal) {
      signal.addEventListener('abort', aborted)
      yield { type: 'text-delta', index: 0, text: 'part' }
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () =>{  resolve() }) })
    }
    const chat = vi.fn(impl) as unknown as ChatFetcher & ReturnType<typeof vi.fn>
    render(<SmartQA t={t} chat={chat} model={{ provider: 'p', model: 'm' }} />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hi' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.send })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.stop })) })

    expect(aborted).toHaveBeenCalled()
    expect(screen.getByText('part')).toBeTruthy()
  })
})
