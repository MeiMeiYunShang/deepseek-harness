// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
// Type-only: pulls the sessionStats projection-key merge used in the fixtures below.
import type {} from '@deepseek-ai/dsh-session-stats/types'
import { ConsoleButton } from '../src/client/ConsoleButton.tsx'
import type { ConsoleButtonProps, ConsoleQaModel } from '../src/client/ConsoleButton.tsx'
import type { ConsoleStoreState } from '../src/client/consoleStore.ts'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: string): string => (en as Record<string, string>)[key] ?? key

function session(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: id as SessionSummary['id'],
    displayTitle: id,
    running: false,
    blank: false,
    updatedAt: 0,
    ...overrides,
  }
}

function renderConsole(overrides: {
  byId?: Record<string, SessionSummary>
  current?: SessionSummary['id']
  store?: ConsoleStoreState
  defaultModel?: ConsoleQaModel | null
  pending?: Map<string, unknown>
} = {}) {
  const store = createSnapshotStore<ConsoleStoreState>(overrides.store ?? {
    timeline: [{ id: 1, sessionId: 's1', time: 1000, kind: 'status' }],
    seq: 1,
    systemStatus: { cpu: 42, memory: 61, gpu: null },
    timelineMode: 'brief',
  })
  const chat = vi.fn(async function* () { /* no chunks */ })
  const setTimelineMode = vi.fn()
  const props = {
    wide: true,
    t,
    useSessions: (selector: (value: {
      byId: Record<string, SessionSummary>
      current: SessionSummary['id'] | undefined
    }) => unknown) => selector({
      byId: overrides.byId ?? { s1: session('s1', { running: true }), s2: session('s2', { completed: true }) },
      current: overrides.current,
    }),
    useSessionPendingInteraction: (selector: (value: Map<string, unknown>) => unknown) => selector(overrides.pending ?? new Map([
      ['s1', { key: 'q1', kind: 'question', sessionId: 's1' }],
    ])),
    useConsole: bindSnapshotSelector(store),
    chat,
    defaultModel: overrides.defaultModel ?? null,
    setTimelineMode,
  } as unknown as ConsoleButtonProps
  render(<ConsoleButton {...props} />)
  return { store, chat, setTimelineMode }
}

describe('ConsoleButton', () => {
  it('renders a trigger that opens the console modal', () => {
    renderConsole()
    expect(screen.getByRole('button', { name: en.trigger })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en.trigger }))

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.title })).toBeTruthy()
  })

  it('summarizes session counts and task statistics in the open modal', () => {
    renderConsole({
      byId: {
        s1: session('s1', { running: true }),
        s2: session('s2', {
          completed: true,
          projectionValues: {
            sessionStats: { turns: 3, steps: 5, llmMs: 1200, toolMs: 800, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 },
          },
        }),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: en.trigger }))

    expect(screen.getAllByText('1', { exact: true }).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('5')).toBeTruthy()
    expect(screen.getByText('1.2s')).toBeTruthy()
    expect(screen.getByText('800ms')).toBeTruthy()
  })

  it('lists pending interactions and renders the host metrics gauges', () => {
    renderConsole()
    fireEvent.click(screen.getByRole('button', { name: en.trigger }))

    expect(screen.getByText(en.pendingQuestion)).toBeTruthy()
    expect(screen.getByText('42%')).toBeTruthy()
    expect(screen.getAllByText('N/A', { exact: true }).length).toBeGreaterThanOrEqual(1)
  })

  it('renders the bounded activity timeline and switches its verbosity', () => {
    const { setTimelineMode } = renderConsole({
      store: {
        timeline: [
          { id: 1, sessionId: 's1', time: 1000, kind: 'status' },
          { id: 2, sessionId: 's2', time: 2000, kind: 'activity' },
        ],
        seq: 2,
        systemStatus: null,
        timelineMode: 'brief',
      },
    })
    fireEvent.click(screen.getByRole('button', { name: en.trigger }))

    // brief mode shows the status row only (the activity row is filtered).
    expect(screen.getByText(new RegExp(`${en.sessionPrefix}s1`))).toBeTruthy()
    expect(screen.queryByText(new RegExp(`${en.sessionPrefix}s2`))).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: en.timelineActivity }))
    expect(setTimelineMode).toHaveBeenCalledWith('all')
  })

  it('does not show the modal until the trigger is clicked', () => {
    renderConsole()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('leaves the modal with the fiber lifecycle untouched', async () => {
    renderConsole()
    fireEvent.click(screen.getByRole('button', { name: en.trigger }))

    await act(async () => { fireEvent.click(screen.getByLabelText(en.close)) })

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders zero and minute-level durations, the critical band, and a null-less mobile gauge', () => {
    renderConsole({
      byId: {
        s1: session('s1', {
          running: true,
          projectionValues: {
            sessionStats: { turns: 0, steps: 0, llmMs: 0, toolMs: 90_000, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 },
          },
        }),
      },
      store: {
        timeline: [],
        seq: 0,
        systemStatus: { cpu: 90, memory: 30, gpu: 12 },
        timelineMode: 'brief',
      },
    })
    fireEvent.click(screen.getByRole('button', { name: en.trigger }))

    expect(screen.getByText('0s')).toBeTruthy()
    expect(screen.getByText('1m30s')).toBeTruthy()
    // A non-null GPU renders a live percentage rather than N/A.
    expect(screen.getByText('12%')).toBeTruthy()
    expect(screen.getByText(en.timelineEmpty)).toBeTruthy()
  })

  it('lists a plan-review pending interaction and drops non-matching kinds', () => {
    const { setTimelineMode } = renderConsole({
      store: { timeline: [{ id: 1, sessionId: 's1', time: 1000, kind: 'status' }], seq: 1, systemStatus: null, timelineMode: 'all' },
      pending: new Map<string, unknown>([
        ['s1', { key: 'q1', kind: 'question', sessionId: 's1' }],
        ['s2', { key: 'p1', kind: 'plan-review', sessionId: 's2' }],
        ['s3', { key: 'x1', kind: 'irrelevant', sessionId: 's3' }],
      ]),
    })
    fireEvent.click(screen.getByRole('button', { name: en.trigger }))

    expect(screen.getByText(en.pendingPlanReview)).toBeTruthy()
    expect(screen.getByText(en.pendingQuestion)).toBeTruthy()
    expect(setTimelineMode).not.toHaveBeenCalled()
  })

  it('shows the no-pending hint and switches the timeline to brief', () => {
    const { setTimelineMode } = renderConsole({
      store: { timeline: [], seq: 0, systemStatus: null, timelineMode: 'all' },
      pending: new Map(),
    })
    fireEvent.click(screen.getByRole('button', { name: en.trigger }))

    expect(screen.getByText(en.noPending)).toBeTruthy()
    expect(screen.getByText(en.timelineEmpty)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.timelineStatus }))
    expect(setTimelineMode).toHaveBeenCalledWith('brief')
  })
})
