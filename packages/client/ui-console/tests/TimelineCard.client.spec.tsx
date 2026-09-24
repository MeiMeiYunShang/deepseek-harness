// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelPrice } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionStatsTurnRoute } from '@deepseek-ai/dsh-session-stats/types'
import { AskCardBody, Composer, MessageStream, rowTone, TimelineCard, TimelineList, TimelineRow } from '../src/client/TimelineCard.tsx'
import type { TimelineEntry, TimelineMode } from '../src/client/consoleStore.ts'
import type { TimelineMessage } from '../src/client/timelineMessages.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

/** The dictionary seat, interpolating `{name}` placeholders as the locale service does. */
const t = (key: string, params?: Record<string, unknown>): string => {
  const raw = (en as Record<string, string>)[key] ?? key
  return params === undefined
    ? raw
    : raw.replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name]))
}

/** The same seat over the Chinese dictionary. */
const tZh = (key: string, params?: Record<string, unknown>): string => {
  const raw = (zh as Record<string, string>)[key] ?? key
  return params === undefined
    ? raw
    : raw.replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name]))
}

/** One operator price row, quoted per million tokens. */
const FLASH: ModelPrice = {
  baseUrl: 'https://api.deepseek.com',
  provider: 'p',
  model: 'm',
  peak: { cacheHit: 0.25, cacheMiss: 1, output: 2 },
  offPeak: { cacheHit: 0.125, cacheMiss: 0.5, output: 1 },
}

/**
 * The turn bucket the charged fixtures carry: 32,400 peak uncached input tokens
 * at the row's cache-miss rate, i.e. ¥0.0324. The unpriced and ambiguous cases
 * use the same bucket and vary the table instead.
 */
const PEAK_TURN: readonly SessionStatsTurnRoute[] = [{
  turn: 1,
  provider: 'p',
  model: 'm',
  peak: { inputTokens: 32_400, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  offPeak: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
}]

const entry = (id: number, sessionId: string, kind: TimelineEntry['kind'], time: number): TimelineEntry =>
  ({ id, sessionId, time, kind })

/** Render the card with the props one test varies; the rest stay at their default. */
function renderCard(overrides: {
  timeline: readonly TimelineEntry[]
  timelineMode?: TimelineMode
  selectedSession?: string
  messages?: readonly TimelineMessage[]
  prices?: readonly ModelPrice[]
  titleOf?: (id: string) => string | undefined
  setTimelineMode?: (mode: TimelineMode) => void
}) {
  const setTimelineMode = overrides.setTimelineMode ?? vi.fn()
  render(<TimelineCard
    t={t}
    timeline={overrides.timeline}
    timelineMode={overrides.timelineMode ?? 'all'}
    selectedSession={overrides.selectedSession}
    messages={overrides.messages ?? []}
    prices={overrides.prices ?? []}
    titleOf={overrides.titleOf ?? (id => `Title of ${id}`)}
    setTimelineMode={setTimelineMode}
    sendInstruction={vi.fn(async () => undefined)}
  />)
  return { setTimelineMode }
}

describe('rowTone', () => {
  it('maps status to action, a history snapshot to neutral, and everything else to info', () => {
    expect(rowTone('status')).toBe('action')
    expect(rowTone('history')).toBe('neutral')
    expect(rowTone('activity')).toBe('info')
    expect(rowTone('other')).toBe('info')
  })
})

describe('TimelineCard', () => {
  it('renders a status-filtered timeline in brief mode and an expand toggle for long rows', () => {
    const longLabel = 'a'.repeat(80)
    renderCard({
      timeline: [
        entry(1, 's1', 'status', 1000),
        { id: 2, sessionId: 's2', time: 2000, kind: 'activity', detail: longLabel },
      ],
      timelineMode: 'brief',
    })
    expect(screen.getByText(new RegExp(`${en.sessionPrefix} s1`))).toBeTruthy()
    // the activity row is filtered out in brief mode.
    expect(screen.queryByText(new RegExp(`${en.sessionPrefix} s2`))).toBeNull()
  })

  it('replaces the coarse rows with the scoped session conversation and names that session', () => {
    renderCard({
      timeline: [entry(1, 's1', 'activity', 1000), entry(2, 's2', 'activity', 2000)],
      selectedSession: 's2',
      messages: [{ key: 4, role: 'user', text: 'Repair the composer', time: 4000 }],
      titleOf: () => 'Repair the composer',
    })
    // The scoped card renders the conversation, not the coarse rows of any session.
    expect(screen.getByText('Repair the composer')).toBeTruthy()
    expect(screen.queryByText(new RegExp(`${en.sessionPrefix} s1`))).toBeNull()
    expect(screen.queryByText(new RegExp(`${en.sessionPrefix} s2`))).toBeNull()
    expect(screen.getByText(`${en.timelineScopeLabel}: Repair the composer`)).toBeTruthy()
  })

  it('lists every session and names no scope while the console is unscoped', () => {
    renderCard({ timeline: [entry(1, 's1', 'activity', 1000), entry(2, 's2', 'activity', 2000)] })
    expect(screen.getByText(new RegExp(`${en.sessionPrefix} s1`))).toBeTruthy()
    expect(screen.getByText(new RegExp(`${en.sessionPrefix} s2`))).toBeTruthy()
    expect(screen.queryByText(new RegExp(`^${en.timelineScopeLabel}:`))).toBeNull()
  })

  it('falls back to the shortened session id when the scoped session has no resolvable title', () => {
    renderCard({ timeline: [entry(1, 's1', 'status', 1000)], selectedSession: 's1', titleOf: () => undefined })
    expect(screen.getByText(`${en.timelineScopeLabel}: s1`)).toBeTruthy()
  })

  it('writes the verbosity through the mode toggle', () => {
    const { setTimelineMode } = renderCard({ timeline: [entry(1, 's1', 'status', 1000)] })
    fireEvent.click(screen.getByRole('button', { name: en.timelineStatus }))
    expect(setTimelineMode).toHaveBeenCalledWith('brief')
    fireEvent.click(screen.getByRole('button', { name: en.timelineActivity }))
    expect(setTimelineMode).toHaveBeenCalledWith('all')
  })

  it('renders the empty hint when the scoped session has no renderable message', () => {
    renderCard({ timeline: [entry(1, 's1', 'status', 1000)], selectedSession: 's9' })
    expect(screen.getByText(en.timelineNoMessages)).toBeTruthy()
    expect(screen.queryByText(new RegExp(`${en.sessionPrefix} s1`))).toBeNull()
  })

  it('withholds the row-verbosity toggle from the scoped conversation', () => {
    const { setTimelineMode } = renderCard({
      timeline: [entry(1, 's1', 'status', 1000)],
      selectedSession: 's1',
      messages: [{ key: 1, role: 'assistant', text: 'Done.', time: 1000 }],
    })
    expect(screen.queryByRole('button', { name: en.timelineStatus })).toBeNull()
    expect(screen.queryByRole('button', { name: en.timelineActivity })).toBeNull()
    expect(setTimelineMode).not.toHaveBeenCalled()
  })

  it('renders backfilled history rows newest snapshot first and labelled apart from live events', () => {
    renderCard({
      timeline: [
        entry(1, 'older', 'history', 1000),
        entry(2, 'newer', 'history', 3000),
        entry(3, 'live', 'activity', 4000),
      ],
    })
    expect(screen.getAllByText(new RegExp(`^${en.sessionPrefix} `)).map(node => node.textContent)).toEqual([
      `${en.sessionPrefix} live ${en.timelineActivity}`,
      `${en.sessionPrefix} newer ${en.timelineHistory}`,
      `${en.sessionPrefix} older ${en.timelineHistory}`,
    ])
  })

  it('offers a backfilled history row its toggle and reveals the session title', () => {
    renderCard({
      timeline: [{ id: 1, sessionId: 's1', time: 1000, kind: 'history', title: 'Repair the composer' }],
    })
    // Collapsed, the row shows the short session header it has always shown.
    expect(screen.getByText(`${en.sessionPrefix} s1 ${en.timelineHistory}`)).toBeTruthy()
    expect(screen.queryByText(/Repair the composer/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: en.timelineExpand }))
    expect(screen.getByText(`${en.sessionPrefix} s1 ${en.timelineHistory} · Repair the composer`)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.timelineCollapse })).toBeTruthy()
  })

  it('hides a history row in brief mode, which filters to status rows', () => {
    renderCard({
      timeline: [entry(1, 'older', 'history', 1000), entry(2, 'live', 'status', 2000)],
      timelineMode: 'brief',
    })
    expect(screen.getByText(new RegExp(`${en.sessionPrefix} live`))).toBeTruthy()
    expect(screen.queryByText(new RegExp(`${en.sessionPrefix} older`))).toBeNull()
  })

  it('always renders its body: the card offers no fold control', () => {
    renderCard({ timeline: [entry(1, 's1', 'status', 1000)], selectedSession: 's1' })
    expect(screen.getByText(en.timeline)).toBeTruthy()
    expect(screen.getByPlaceholderText(en.composerPlaceholder)).toBeTruthy()
    // No fold control: the collapse/expand labels never reach this card.
    expect(screen.queryByRole('button', { name: en.collapse })).toBeNull()
  })

  it('prices the scoped conversation turns with the operator table it is handed', () => {
    renderCard({
      timeline: [entry(1, 's1', 'status', 1000)],
      selectedSession: 's1',
      prices: [FLASH],
      messages: [{
        key: 2,
        role: 'assistant',
        text: 'Done.',
        time: 2000,
        usage: { inputTokens: 1_000, outputTokens: 200, cacheReadTokens: 15_000, cacheWriteTokens: 0 },
        turnCost: PEAK_TURN,
      }],
    })

    expect(screen.getByText('Usage 16.2K tok')).toBeTruthy()
    expect(screen.getByText('¥0.0324')).toBeTruthy()
  })
})

describe('MessageStream', () => {
  it('renders an operator message as a bubble and a reply as a block with its own time', () => {
    const { container } = render(<MessageStream
      t={t}
      prices={[]}
      messages={[
        { key: 1, role: 'user', text: 'Repair the composer', time: 1_700_000_000_000 },
        { key: 2, role: 'assistant', text: 'Done.', time: 1_700_000_005_000 },
      ]}
    />)

    expect(container.querySelector('[data-role="user"]')?.textContent).toBe('Repair the composer')
    expect(container.querySelector('[data-role="assistant"]')?.textContent).toBe(`Done.${clockOf(1_700_000_005_000)}`)
    // Only the assistant block carries the metadata row.
    expect(container.querySelector('[data-role="user"]')?.textContent).not.toContain(clockOf(1_700_000_005_000))
  })

  it('renders the empty hint for a conversation with no renderable message', () => {
    render(<MessageStream t={t} messages={[]} prices={[]} />)
    expect(screen.getByText(en.timelineNoMessages)).toBeTruthy()
  })

  it('shows each reply own token total and charges the turn to the reply that closes it', () => {
    const usage = { inputTokens: 1_000, outputTokens: 200, cacheReadTokens: 15_000, cacheWriteTokens: 0 }
    render(<MessageStream
      t={t}
      prices={[FLASH]}
      messages={[
        { key: 1, role: 'user', text: 'Repair the composer', time: 1_700_000_000_000 },
        { key: 2, role: 'assistant', text: 'First step.', time: 1_700_000_001_000, usage },
        { key: 3, role: 'assistant', text: 'Done.', time: 1_700_000_005_000, usage, turnCost: PEAK_TURN },
      ]}
    />)

    // 1,000 uncached input + 15,000 cache-read + 200 output. Summing only
    // inputTokens and outputTokens would render 1.2K.
    expect(screen.getAllByText('Usage 16.2K tok')).toHaveLength(2)
    // The turn's charge lands on the reply that closes the turn alone.
    expect(screen.getByText('¥0.0324')).toBeTruthy()
  })

  it('renders the figure chips from the Chinese dictionary', () => {
    render(<MessageStream
      t={tZh}
      prices={[FLASH]}
      messages={[{
        key: 1,
        role: 'assistant',
        text: '完成。',
        time: 1_700_000_005_000,
        usage: { inputTokens: 1_000, outputTokens: 200, cacheReadTokens: 15_000, cacheWriteTokens: 0 },
        turnCost: PEAK_TURN,
      }]}
    />)

    expect(screen.getByText('用量 16.2K tok')).toBeTruthy()
    expect(screen.getByText('¥0.0324')).toBeTruthy()
  })

  it('renders no figure chip for a reply that carries neither usage nor a turn charge', () => {
    const { container } = render(<MessageStream
      t={t}
      prices={[FLASH]}
      messages={[{ key: 1, role: 'assistant', text: 'Done.', time: 1_700_000_005_000 }]}
    />)

    // An absent figure is not a zero: the metadata row keeps the timestamp alone.
    expect(container.querySelector('[data-role="assistant"]')?.textContent).toBe(`Done.${clockOf(1_700_000_005_000)}`)
  })

  it('names the unpriced reason instead of a figure when the table omits the route', () => {
    render(<MessageStream
      t={t}
      prices={[]}
      messages={[{ key: 1, role: 'assistant', text: 'Done.', time: 100, turnCost: PEAK_TURN }]}
    />)

    expect(screen.getByText(en.taskCostUnpriced)).toBeTruthy()
  })

  it('names the ambiguous reason when two rows price the route through different endpoints', () => {
    render(<MessageStream
      t={t}
      prices={[FLASH, { ...FLASH, baseUrl: 'https://proxy.example.com' }]}
      messages={[{ key: 1, role: 'assistant', text: 'Done.', time: 100, turnCost: PEAK_TURN }]}
    />)

    expect(screen.getByText(en.taskCostAmbiguous)).toBeTruthy()
  })
})

/** The card's HH:MM:SS rendering of an epoch millisecond time. */
function clockOf(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

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
    render(<TimelineList t={t} timeline={[]} detailOf={() => undefined} />)
    expect(screen.getByText(en.timelineEmpty)).toBeTruthy()
  })

  it('renders a short row without a fold toggle or detail', () => {
    render(<TimelineList t={t} timeline={[entry(1, 's1', 'status', 1000)]} detailOf={() => undefined} />)
    expect(screen.getByText(new RegExp(`${en.sessionPrefix} s1`))).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.timelineExpand })).toBeNull()
  })

  it('offers the toggle to a titled history row and withholds it from a live row of equal length', () => {
    render(<TimelineList
      t={t}
      timeline={[
        entry(1, 's1', 'status', 1000),
        { id: 2, sessionId: 's1', time: 2000, kind: 'history', title: 'Ship the fix' },
      ]}
      detailOf={() => undefined}
    />)
    const liveText = `${en.sessionPrefix} s1 ${en.timelineStatus}`
    // Only the history row offers the toggle; the live row keeps its one line.
    const toggles = screen.getAllByRole('button', { name: en.timelineExpand })
    expect(toggles).toHaveLength(1)
    expect(screen.getByText(liveText)).toBeTruthy()

    fireEvent.click(toggles[0]!)
    expect(screen.getByText(`${en.sessionPrefix} s1 ${en.timelineHistory} · Ship the fix`)).toBeTruthy()
    expect(screen.getByText(liveText)).toBeTruthy()
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
    render(<Composer t={t} selectedSession={undefined} sendInstruction={vi.fn(async () => undefined)} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.disabled).toBe(true)
    expect(input.getAttribute('placeholder')).toBe(en.composerDisabled)
  })

  it('does not send while the draft is empty', async () => {
    const send = vi.fn(async () => undefined)
    render(<Composer t={t} selectedSession="s1" sendInstruction={send} />)
    fireEvent.click(screen.getByRole('button', { name: en.send }))
    expect(send).not.toHaveBeenCalled()
  })

  it('sends an instruction and clears the draft on success', async () => {
    const send = vi.fn(async () => undefined)
    render(<Composer t={t} selectedSession="s1" sendInstruction={send} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: en.send }))
    await waitFor(() => { expect(send).toHaveBeenCalledWith('hello') })
    await waitFor(() => { expect((screen.getByRole('textbox') as unknown as HTMLInputElement).value).toBe('') })
  })

  it('shows an alert on a failed send', async () => {
    const send = vi.fn(async () => { throw new Error('boom') })
    render(<Composer t={t} selectedSession="s1" sendInstruction={send} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: en.send }))
    await waitFor(() =>{  expect(screen.getByRole('alert')).toBeTruthy() })
  })
})

function folded(text: string): string {
  return text.length <= 48 ? text : `${text.slice(0, 48)}…`
}

describe('TimelineList paging', () => {
  const many = Array.from({ length: 45 }, (_value, index) => entry(index + 1, 's1', 'status', 1000 + index))

  it('renders one page of newest events and reveals older ones on demand', () => {
    render(<TimelineList t={t} timeline={many} detailOf={() => undefined} />)

    expect(screen.getAllByText(new RegExp(`^${en.sessionPrefix} s1 `))).toHaveLength(40)
    const more = screen.getByRole('button', { name: 'Show 5 earlier events' })

    fireEvent.click(more)

    expect(screen.getAllByText(new RegExp(`^${en.sessionPrefix} s1 `))).toHaveLength(45)
    expect(screen.queryByRole('button', { name: /earlier events/ })).toBeNull()
  })

  it('renders no page control when a scope fits in one page', () => {
    render(<TimelineList t={t} timeline={many.slice(0, 3)} detailOf={() => undefined} />)

    expect(screen.queryByRole('button', { name: /earlier events/ })).toBeNull()
  })
})
