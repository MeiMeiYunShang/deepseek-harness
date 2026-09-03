// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AskCardBody, Composer, rowTone, TimelineCard, TimelineList, TimelineRow } from '../src/client/TimelineCard.tsx'
import type { TimelineEntry } from '../src/client/consoleStore.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: string): string => (en as Record<string, string>)[key] ?? key

const entry = (id: number, sessionId: string, kind: 'activity' | 'status', time: number): TimelineEntry =>
  ({ id, sessionId, time, kind })

describe('rowTone', () => {
  it('maps status to action and everything else to info', () => {
    expect(rowTone('status')).toBe('action')
    expect(rowTone('activity')).toBe('info')
    expect(rowTone('other')).toBe('info')
  })
})

describe('TimelineCard', () => {
  it('renders a status-filtered timeline in brief mode and an expand toggle for long rows', () => {
    const longLabel = 'a'.repeat(80)
    render(<TimelineCard
      t={t}
      timeline={[
        entry(1, 's1', 'status', 1000),
        { id: 2, sessionId: 's2', time: 2000, kind: 'activity', detail: longLabel },
      ]}
      timelineMode="brief"
      scope={undefined}
      selected={undefined}
      setTimelineMode={() => {}}
      clearScope={() => {}}
      sendInstruction={vi.fn(async () => undefined)}
    />)
    expect(screen.getByText(new RegExp(`${en.sessionPrefix} s1`))).toBeTruthy()
    // the activity row is filtered out in brief mode.
    expect(screen.queryByText(new RegExp(`${en.sessionPrefix} s2`))).toBeNull()
  })

  it('switches to all mode and shows the scoped rows with a clear scope pill', () => {
    render(<TimelineCard
      t={t}
      timeline={[entry(1, 's1', 'status', 1000), entry(2, 's2', 'activity', 2000)]}
      timelineMode="all"
      scope="s1"
      selected={undefined}
      setTimelineMode={() => {}}
      clearScope={() => {}}
      sendInstruction={vi.fn(async () => undefined)}
    />)
    expect(screen.getByText(new RegExp(`${en.sessionPrefix} s1`))).toBeTruthy()
    expect(screen.queryByText(new RegExp(`${en.sessionPrefix} s2`))).toBeNull()
    expect(screen.getByRole('button', { name: en.timelineScopeAll })).toBeTruthy()
  })

  it('has the scope pill clear the scope and the brief toggle write the mode', () => {
    const setTimelineMode = vi.fn()
    const clearScope = vi.fn()
    render(<TimelineCard
      t={t}
      timeline={[entry(1, 's1', 'status', 1000)]}
      timelineMode="all"
      scope="s1"
      selected={undefined}
      setTimelineMode={setTimelineMode}
      clearScope={clearScope}
      sendInstruction={vi.fn(async () => undefined)}
    />)
    fireEvent.click(screen.getByRole('button', { name: en.timelineScopeAll }))
    expect(clearScope).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.timelineStatus }))
    expect(setTimelineMode).toHaveBeenCalledWith('brief')
  })

  it('renders the empty hint when scoped rows are absent', () => {
    render(<TimelineCard
      t={t}
      timeline={[]}
      timelineMode="all"
      scope={undefined}
      selected={undefined}
      setTimelineMode={() => {}}
      clearScope={() => {}}
      sendInstruction={vi.fn(async () => undefined)}
    />)
    expect(screen.getByText(en.timelineEmpty)).toBeTruthy()
  })
})

describe('TimelineRow', () => {
  it('toggles its expanded state from a long text', () => {
    render(<TimelineRow
      time="10:00:00"
      tone="info"
      last={false}
      text={folded('a'.repeat(60))}
      showToggle
      expanded={false}
      toggleText="Expand"
      onToggle={() => {}}
    />)
    expect(screen.getByRole('button', { name: 'Expand' })).toBeTruthy()
  })

  it('hides the rail on the last row', () => {
    render(<TimelineRow
      time="10:00:00"
      tone="info"
      last
      text="text"
      showToggle={false}
      expanded={false}
      toggleText="Expand"
      onToggle={() => {}}
    />)
    expect(screen.getByText('text')).toBeTruthy()
  })
})

describe('TimelineList', () => {
  it('toggles a detail row open and renders its ask-card detail', () => {
    render(<TimelineList
      t={t}
      timeline={[entry(1, 's1', 'status', 1000)]}
      scope={undefined}
      detailOf={() => ({ question: 'Continue?', options: ['Yes', 'No'], interactive: true })}
    />)
    fireEvent.click(screen.getByRole('button', { name: en.timelineExpand }))
    expect(screen.getByText('Continue?')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Yes/ })).toBeTruthy()
    expect(screen.getByText(en.askUserRecommend)).toBeTruthy()
    // collapsing the row back toggles the expanded state away.
    fireEvent.click(screen.getByRole('button', { name: en.timelineCollapse }))
    expect(screen.getByRole('button', { name: en.timelineExpand })).toBeTruthy()
  })
  it('renders the empty hint with no rows', () => {
    render(<TimelineList t={t} timeline={[]} scope={undefined} detailOf={() => undefined} />)
    expect(screen.getByText(en.timelineEmpty)).toBeTruthy()
  })

  it('renders a short row without a fold toggle or detail', () => {
    render(<TimelineList t={t} timeline={[entry(1, 's1', 'status', 1000)]} scope={undefined} detailOf={() => undefined} />)
    expect(screen.getByText(new RegExp(`${en.sessionPrefix} s1`))).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.timelineExpand })).toBeNull()
  })
})

describe('AskCardBody', () => {
  it('renders the read-only mirror when non-interactive', () => {
    render(<AskCardBody t={t} detail={{ question: 'Q', options: ['a'], interactive: false }} />)
    expect(screen.getByText('Q')).toBeTruthy()
    expect(screen.getByText('a')).toBeTruthy()
  })
})

describe('Composer', () => {
  it('disables the send button without a selected session', () => {
    render(<Composer t={t} selected={undefined} sendInstruction={vi.fn(async () => undefined)} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.disabled).toBe(true)
    expect(input.getAttribute('placeholder')).toBe(en.composerDisabled)
  })

  it('does not send while the draft is empty', async () => {
    const send = vi.fn(async () => undefined)
    render(<Composer t={t} selected="s1" sendInstruction={send} />)
    fireEvent.click(screen.getByRole('button', { name: en.send }))
    expect(send).not.toHaveBeenCalled()
  })

  it('sends an instruction and clears the draft on success', async () => {
    const send = vi.fn(async () => undefined)
    render(<Composer t={t} selected="s1" sendInstruction={send} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: en.send }))
    await waitFor(() => { expect(send).toHaveBeenCalledWith('hello') })
    await waitFor(() => { expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('') })
  })

  it('shows an alert on a failed send', async () => {
    const send = vi.fn(async () => { throw new Error('boom') })
    render(<Composer t={t} selected="s1" sendInstruction={send} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: en.send }))
    await waitFor(() =>{  expect(screen.getByRole('alert')).toBeTruthy() })
  })
})

function folded(text: string): string {
  return text.length <= 48 ? text : `${text.slice(0, 48)}…`
}
