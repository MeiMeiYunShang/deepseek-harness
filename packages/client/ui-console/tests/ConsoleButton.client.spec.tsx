// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
// Type-only: pulls the sessionStats projection-key merge used in the fixtures below.
import type {} from '@deepseek-ai/dsh-session-stats/types'
import { ConsoleButton } from '../src/client/ConsoleButton.tsx'
import type { ConsoleButtonProps, ConsoleQaModel } from '../src/client/ConsoleButton.tsx'
import type { ConsoleStoreState } from '../src/client/consoleStore.ts'
import type { ConsoleServices } from '../src/client/services.ts'
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

function makeStore(overrides: Partial<ConsoleStoreState> = {}): ConsoleStoreState {
  return {
    timeline: [{ id: 1, sessionId: 's1', time: 1000, kind: 'status' }],
    seq: 1,
    systemStatus: { cpu: 42, memory: 61, gpu: null },
    timelineMode: 'brief',
    sessionView: 'stats',
    selectedSession: undefined,
    timelineScope: undefined,
    layout: 'balanced',
    collapsed: {},
    ...overrides,
  }
}

function services(double: Partial<ConsoleServices> = {}): ConsoleServices {
  return {
    open: vi.fn(),
    rename: vi.fn(async () => undefined),
    fork: vi.fn(async () => undefined),
    archive: vi.fn(async () => undefined),
    create: vi.fn(async () => 'new' as never),
    selectPreset: vi.fn(async () => undefined),
    sendInstruction: vi.fn(async () => undefined),
    pickDirectory: vi.fn(async () => null),
    listPresets: vi.fn(async () => []),
    ...double,
  }
}

function renderConsole(overrides: {
  byId?: Record<string, SessionSummary>
  current?: SessionSummary['id']
  store?: ConsoleStoreState
  defaultModel?: ConsoleQaModel | null
  pending?: Map<string, unknown>
  archived?: readonly string[]
  workspaces?: readonly { id: string; label: string }[]
  services?: Partial<ConsoleServices>
  wide?: boolean
} = {}) {
  const snap = createSnapshotStore<ConsoleStoreState>(overrides.store ?? makeStore())
  const chat = vi.fn(async function* () { /* no chunks */ })
  const srv = overrides.services === undefined ? services() : services(overrides.services)
  const writers = {
    setTimelineMode: vi.fn(),
    setSessionView: vi.fn(),
    setSelectedSession: vi.fn(),
    setTimelineScope: vi.fn(),
    setLayout: vi.fn(),
    toggleCollapsed: vi.fn(),
  }
  const props = {
    wide: overrides.wide ?? true,
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
    useWorkspaces: (selector: (value: {
      items: readonly { workspaceId: string; title: string }[]
      archivedSessionIds: readonly string[]
    }) => unknown) => selector({
      items: (overrides.workspaces ?? [{ id: 'w1', label: 'Workspace' }]).map(option => ({ workspaceId: option.id, title: option.label })),
      archivedSessionIds: overrides.archived ?? [],
    }),
    useConsole: bindSnapshotSelector(snap),
    store: writers,
    services: srv,
    chat,
    defaultModel: overrides.defaultModel ?? null,
  } as unknown as ConsoleButtonProps
  render(<ConsoleButton {...props} />)
  return { snap, chat, srv, writers }
}

describe('ConsoleButton', () => {
  it('renders a trigger that opens the console modal', () => {
    renderConsole()
    expect(screen.getByRole('button', { name: en.trigger })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en.trigger }))

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.title })).toBeTruthy()
  })

  it('omits the trigger label in the compact ($wide) sidebar mode', () => {
    renderConsole({ wide: false })
    expect(screen.getByRole('button', { name: en.trigger })).toBeTruthy()
    expect(screen.queryByText(en.trigger, { selector: 'span' })).toBeNull()
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

  it('renders the host metrics gauges with a null-less N/A fallback', () => {
    renderConsole()
    fireEvent.click(screen.getByRole('button', { name: en.trigger }))

    expect(screen.getByText('42%')).toBeTruthy()
    expect(screen.getAllByText('N/A', { exact: true }).length).toBeGreaterThanOrEqual(1)
  })

  it('renders the bounded activity timeline and switches its verbosity', () => {
    const { writers } = renderConsole({
      store: makeStore({
        timeline: [
          { id: 1, sessionId: 's1', time: 1000, kind: 'status' },
          { id: 2, sessionId: 's2', time: 2000, kind: 'activity' },
        ],
        seq: 2,
        systemStatus: null,
        timelineMode: 'brief',
      }),
    })
    fireEvent.click(screen.getByRole('button', { name: en.trigger }))

    // brief mode shows the status row only (the activity row is filtered).
    expect(screen.getByText(new RegExp(`${en.sessionPrefix} s1`))).toBeTruthy()
    expect(screen.queryByText(new RegExp(`${en.sessionPrefix} s2`))).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: en.timelineActivity }))
    expect(writers.setTimelineMode).toHaveBeenCalledWith('all')
  })

  it('does not show the modal until the trigger is clicked', () => {
    renderConsole()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes the modal from the close button', async () => {
    renderConsole()
    fireEvent.click(screen.getByRole('button', { name: en.trigger }))

    await act(async () => { fireEvent.click(screen.getByLabelText(en.close)) })

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('resolves a session title through the workbench rename flow', async () => {
    renderConsole({
      byId: { s1: session('s1', { title: 'My Session' }), s2: session('s2', { completed: true }) },
      store: makeStore({ sessionView: 'grid', selectedSession: 's1' }),
    })
    fireEvent.click(screen.getByRole('button', { name: en.trigger }))
    const cell = screen.queryAllByRole('button').find(button => (button.getAttribute('aria-label') ?? '').includes('My Session'))
    expect(cell).toBeTruthy()
    if (cell !== undefined) fireEvent.contextMenu(cell, { clientX: 10, clientY: 20 })
    await waitFor(() =>{  expect(screen.getByRole('menu')).toBeTruthy() })
    fireEvent.click(screen.getByRole('menuitem', { name: /rename/i }))
    await waitFor(() =>{  expect(screen.getByRole('heading', { name: en.renameTitle })).toBeTruthy() })
    expect((screen.getByLabelText(en.renameInputAria) as unknown as HTMLInputElement).value).toBe('s1')
  })

  it('renders zero and minute-level durations and a live gpu gauge', () => {
    renderConsole({
      byId: {
        s1: session('s1', {
          running: true,
          projectionValues: {
            sessionStats: { turns: 0, steps: 0, llmMs: 0, toolMs: 90_000, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 },
          },
        }),
      },
      store: makeStore({
        timeline: [],
        seq: 0,
        systemStatus: { cpu: 90, memory: 30, gpu: 12 },
        timelineMode: 'brief',
      }),
    })
    fireEvent.click(screen.getByRole('button', { name: en.trigger }))

    expect(screen.getByText('0s')).toBeTruthy()
    expect(screen.getByText('1m30s')).toBeTruthy()
    expect(screen.getByText('12%')).toBeTruthy()
    expect(screen.getByText(en.timelineEmpty)).toBeTruthy()
  })
})
