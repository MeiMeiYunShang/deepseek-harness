// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-session-stats/types'
import { Workbench } from '../src/client/Workbench.tsx'
import type { ConsoleStoreState } from '../src/client/consoleStore.ts'
import type { ConsoleServices } from '../src/client/services.ts'
import type { TimelineMessage } from '../src/client/timelineMessages.ts'
import { formatTime } from '../src/client/format.ts'
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

function services(double: Partial<ConsoleServices> = {}): ConsoleServices {
  return {
    open: vi.fn(),
    rename: vi.fn(async (_id: string, title: string) => title),
    fork: vi.fn(async () => undefined),
    archive: vi.fn(async () => undefined),
    create: vi.fn(async () => 'new' as never),
    selectPreset: vi.fn(async () => undefined),
    sendInstruction: vi.fn(async () => undefined),
    pickDirectory: vi.fn(async () => null),
    listPresets: vi.fn(async () => [{ id: 'p1', name: 'Agent A' }]),
    ...double,
  }
}

const baseStore = (): ConsoleStoreState => ({
  open: false,
  timeline: [
    { id: 1, sessionId: 's1', time: 1000, kind: 'status' },
    { id: 2, sessionId: 's2', time: 2000, kind: 'status' },
  ],
  seq: 2,
  systemStatus: { cpu: 42, memory: 61, gpu: null },
  timelineMode: 'brief',
  sessionView: 'stats',
  selectedSession: 's1',
  layout: 'balanced',
  collapsed: {},
})

function renderWorkbench(overrides: {
  store?: ConsoleStoreState
  services?: Partial<ConsoleServices>
  byId?: Record<string, SessionSummary>
  archived?: readonly string[]
  workspaces?: readonly { id: string; label: string }[]
  titleOf?: (id: string) => string | undefined
  messages?: readonly TimelineMessage[]
  onClose?: () => void
} = {}) {
  const snap = createSnapshotStore<ConsoleStoreState>(overrides.store ?? baseStore())
  const store = {
    setTimelineMode: vi.fn(),
    setSessionView: vi.fn(),
    // The console holds one scope, so a grid square and the all-sessions pill
    // move the same snapshot value every card reads.
    setSelectedSession: vi.fn((sessionId: string | undefined) => { snap.update((draft) => { draft.selectedSession = sessionId }) }),
    setLayout: vi.fn(),
    toggleCollapsed: vi.fn(),
    setOpen: vi.fn(),
  }
  const srv = services(overrides.services)
  // One row set: the cards and the title resolver read the same sessions.
  const byId = overrides.byId ?? { s1: session('s1', { running: true }), s2: session('s2', { completed: true }) }
  const view = render(<Workbench
    t={t}
    onClose={overrides.onClose ?? (() => {})}
    byId={byId}
    current="s1"
    archived={new Set(overrides.archived ?? [])}
    titleOf={overrides.titleOf ?? (id => byId[id]?.displayTitle)}
    pendingKindOf={() => undefined}
    workspaces={overrides.workspaces ?? [{ id: 'w1', label: 'Workspace' }]}
    useConsole={bindSnapshotSelector(snap)}
    store={store}
    services={srv}
    chat={vi.fn(async function* () { /* no chunks */ })}
    defaultModel={null}
    prices={[]}
    messages={overrides.messages ?? []}
  />)
  return { container: view.container, snap, store, srv }
}

describe('Workbench', () => {
  it('renders the fullscreen panel, header, close button, and three columns', () => {
    renderWorkbench()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.title })).toBeTruthy()
    expect(screen.getByRole('button', { name: en.close })).toBeTruthy()
    expect(screen.getByText(en.sessionStatus)).toBeTruthy()
    expect(screen.getByText(en.timeline)).toBeTruthy()
    expect(screen.getByText(en.smartQA)).toBeTruthy()
    expect(screen.getByText(en.knowledge)).toBeTruthy()
  })

  it('submits a new-session draft from the modal', async () => {
    const { srv } = renderWorkbench()
    fireEvent.click(screen.getByRole('button', { name: en.newSession }))
    await waitFor(() =>{  expect(srv.listPresets).toHaveBeenCalled() })
    fireEvent.click(screen.getByRole('button', { name: 'Workspace' }))
    fireEvent.click(screen.getByRole('button', { name: 'Agent A' }))
    const textarea = screen.getByLabelText(en.instructionLabel) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'go' } })
    // The new-session modal is its own dialog; submit from within it.
    const modal = screen.getAllByRole('dialog').find(dialog => within(dialog).queryByLabelText(en.instructionLabel) !== null)!
    fireEvent.click(within(modal).getByRole('button', { name: en.send }))
    await waitFor(() =>{  expect(srv.create).toHaveBeenCalledWith({ workspaceId: 'w1', presetId: 'p1', instruction: 'go' }) })
    await waitFor(() =>{  expect(srv.selectPreset).toHaveBeenCalledWith('new', 'p1') })
    await waitFor(() =>{  expect(srv.sendInstruction).toHaveBeenCalledWith('new', 'go') })
  })

  it('submits a new session without a preset when none is chosen', async () => {
    const { srv } = renderWorkbench({ services: { listPresets: vi.fn(async () => []) } })
    fireEvent.click(screen.getByRole('button', { name: en.newSession }))
    await waitFor(() =>{  expect(screen.getByRole('heading', { name: en.newSessionTitle })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'Workspace' }))
    fireEvent.click(screen.getAllByRole('button', { name: en.send })[0]!)
    await waitFor(() =>{  expect(srv.selectPreset).not.toHaveBeenCalled() })
  })

  it('renames a session from the context menu', async () => {
    const { srv } = renderWorkbench({ store: { ...baseStore(), sessionView: 'grid' } })
    const cell = screen.queryAllByRole('button').find(button => (button.getAttribute('aria-label') ?? '').includes('s1'))
    expect(cell).toBeTruthy()
    if (cell !== undefined) fireEvent.contextMenu(cell, { clientX: 10, clientY: 20 })
    await waitFor(() =>{  expect(screen.getByRole('menu')).toBeTruthy() })
    fireEvent.click(screen.getByRole('menuitem', { name: /rename/i }))
    await waitFor(() =>{  expect(screen.getByRole('heading', { name: en.renameTitle })).toBeTruthy() })
    const input = screen.getByLabelText(en.renameInputAria) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: en.renameConfirm }))
    await waitFor(() =>{  expect(srv.rename).toHaveBeenCalledWith('s1', 'Renamed') })
  })

  it('dispatches fork and archive from the context menu', async () => {
    const { srv } = renderWorkbench({ store: { ...baseStore(), sessionView: 'grid' } })
    const cell = () => screen.queryAllByRole('button').find(button => (button.getAttribute('aria-label') ?? '').includes('s1'))
    if (cell() !== undefined) fireEvent.contextMenu(cell() as Element, { clientX: 10, clientY: 20 })
    await waitFor(() =>{  expect(screen.getByRole('menu')).toBeTruthy() })
    fireEvent.click(screen.getByRole('menuitem', { name: /fork/i }))
    await waitFor(() =>{  expect(srv.fork).toHaveBeenCalledWith('s1') })
    if (cell() !== undefined) fireEvent.contextMenu(cell() as Element, { clientX: 10, clientY: 20 })
    await waitFor(() =>{  expect(screen.getByRole('menu')).toBeTruthy() })
    fireEvent.click(screen.getByRole('menuitem', { name: /archive/i }))
    await waitFor(() =>{  expect(srv.archive).toHaveBeenCalledWith('s1') })
  })

  it('opens the right-clicked session from the first menu entry, closing the menu without scoping the console', async () => {
    const { srv, store } = renderWorkbench({ store: { ...baseStore(), sessionView: 'grid' } })
    const cell = screen.queryAllByRole('button').find(button => (button.getAttribute('aria-label') ?? '').includes('s2'))
    expect(cell).toBeTruthy()
    if (cell !== undefined) fireEvent.contextMenu(cell, { clientX: 10, clientY: 20 })
    await waitFor(() =>{  expect(screen.getByRole('menu')).toBeTruthy() })
    const entries = screen.getAllByRole('menuitem')
    expect(entries.map(entry => entry.textContent)).toEqual([en.open, en.rename, en.fork, en.archive])
    fireEvent.click(entries[0]!)
    await waitFor(() =>{  expect(srv.open).toHaveBeenCalledWith('s2') })
    await waitFor(() =>{  expect(screen.queryByRole('menu')).toBeNull() })
    expect(store.setSelectedSession).not.toHaveBeenCalled()
  })

  it('has a context-menu selection on an unknown action that only closes', async () => {
    const { store } = renderWorkbench({ store: { ...baseStore(), sessionView: 'grid' } })
    const cell = screen.queryAllByRole('button').find(button => (button.getAttribute('aria-label') ?? '').includes('s1'))
    if (cell !== undefined) fireEvent.contextMenu(cell, { clientX: 10, clientY: 20 })
    await waitFor(() =>{  expect(screen.getByRole('menu')).toBeTruthy() })
    fireEvent.click(screen.getAllByRole('menuitem')[0]!)
    await waitFor(() =>{  expect(store.setSessionView).not.toHaveBeenCalled() })
  })

  it('scopes the timeline and the composer to a grid session', async () => {
    const { store, srv } = renderWorkbench({ store: { ...baseStore(), sessionView: 'grid', selectedSession: undefined } })
    // Unscoped: every session's coarse rows are listed and the composer has no target.
    expect(screen.getByText(new RegExp(`${en.sessionPrefix} s1`))).toBeTruthy()
    expect(screen.getByText(new RegExp(`${en.sessionPrefix} s2`))).toBeTruthy()
    expect(screen.getByPlaceholderText(en.composerDisabled)).toBeTruthy()

    const cell = screen.queryAllByRole('button').find(button => (button.getAttribute('aria-label') ?? '').includes('s2'))
    if (cell !== undefined) fireEvent.click(cell)
    await waitFor(() =>{  expect(store.setSelectedSession).toHaveBeenCalledWith('s2') })

    // One click moves the one scope the timeline, the statistics card, and the
    // composer all read: the card now renders s2's conversation, so the coarse
    // rows leave and the scope label names it.
    expect(screen.queryByText(new RegExp(`${en.sessionPrefix} s1`))).toBeNull()
    expect(screen.queryByText(new RegExp(`${en.sessionPrefix} s2`))).toBeNull()
    expect(screen.getAllByText(`${en.timelineScopeLabel}: s2`)).toHaveLength(2)
    expect(screen.getByText(en.timelineNoMessages)).toBeTruthy()
    expect(screen.getAllByText(`${en.taskScope}: s2`)).toHaveLength(2)

    // composer input is the enabled textbox; SmartQA input is disabled (model null).
    const composer = screen.getByPlaceholderText(en.composerPlaceholder) as HTMLInputElement
    fireEvent.change(composer, { target: { value: 'instruct' } })
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getAllByRole('button', { name: en.send }).find(button => !(button as HTMLButtonElement).disabled)!)
    await waitFor(() =>{  expect(srv.sendInstruction).toHaveBeenCalledWith('s2', 'instruct') })
  })

  it('returns the timeline, the statistics line, and the composer to the whole list in one action', () => {
    const { store } = renderWorkbench({ store: { ...baseStore(), sessionView: 'grid', selectedSession: 's2' } })
    // Scoped: the timeline renders s2's conversation, and both it and the
    // statistics card name that session with the same scope label.
    expect(screen.queryByText(new RegExp(`${en.sessionPrefix} s1`))).toBeNull()
    expect(screen.queryByText(new RegExp(`${en.sessionPrefix} s2`))).toBeNull()
    expect(screen.getAllByText(`${en.timelineScopeLabel}: s2`)).toHaveLength(2)
    expect(screen.getAllByText(`${en.taskScope}: s2`)).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: en.scopeAllSessions }))

    expect(store.setSelectedSession).toHaveBeenCalledWith(undefined)
    expect(screen.getByText(new RegExp(`${en.sessionPrefix} s1`))).toBeTruthy()
    expect(screen.getByText(new RegExp(`${en.sessionPrefix} s2`))).toBeTruthy()
    // The timeline names no scope any more; only the statistics line carries one.
    expect(screen.getAllByText(new RegExp(`^${en.timelineScopeLabel}: `))).toHaveLength(1)
    expect(screen.getByText(`${en.taskScope}: ${en.taskAllSessions}`)).toBeTruthy()
    expect(screen.getByPlaceholderText(en.composerDisabled)).toBeTruthy()
  })

  it('renders the scoped session conversation as an operator bubble and an assistant block', () => {
    const { container } = renderWorkbench({
      messages: [
        { key: 1, role: 'user', text: 'Repair the composer', time: 1_000 },
        { key: 2, role: 'assistant', text: 'Done.', time: 2_000 },
      ],
    })

    expect(container.querySelector('[data-role="user"]')?.textContent).toBe('Repair the composer')
    // Only the assistant block carries the metadata row, and it is that
    // event's own time.
    expect(container.querySelector('[data-role="assistant"]')?.textContent).toBe(`Done.${formatTime(2_000)}`)
  })

  it('renames a session whose title cannot be resolved, falling back to the id', async () => {
    renderWorkbench({ store: { ...baseStore(), sessionView: 'grid' }, titleOf: () => undefined })
    const cell = screen.queryAllByRole('button').find(button => (button.getAttribute('aria-label') ?? '').includes('s1'))
    if (cell !== undefined) fireEvent.contextMenu(cell, { clientX: 10, clientY: 20 })
    await waitFor(() => { expect(screen.getByRole('menu')).toBeTruthy() })
    fireEvent.click(screen.getByRole('menuitem', { name: /rename/i }))
    await waitFor(() => { expect((screen.getByLabelText(en.renameInputAria) as unknown as HTMLInputElement).value).toBe('s1') })
  })

  it('creates a session with only a workspace (no preset, no instruction)', async () => {
    const { srv } = renderWorkbench({ services: { listPresets: vi.fn(async () => []) } })
    fireEvent.click(screen.getByRole('button', { name: en.newSession }))
    await waitFor(() =>{  expect(screen.getByRole('heading', { name: en.newSessionTitle })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'Workspace' }))
    const modal = screen.getAllByRole('dialog').find(dialog => within(dialog).queryByLabelText(en.instructionLabel) !== null)!
    fireEvent.click(within(modal).getByRole('button', { name: en.send }))
    await waitFor(() =>{  expect(srv.create).toHaveBeenCalledWith({ workspaceId: 'w1', presetId: undefined, instruction: '' }) })
    await waitFor(() =>{  expect(srv.selectPreset).not.toHaveBeenCalled() })
    await waitFor(() =>{  expect(srv.sendInstruction).not.toHaveBeenCalled() })
  })

  it('switches the session view and timeline mode through the store writers', () => {
    // The row-verbosity toggle belongs to the unscoped row list.
    const { store } = renderWorkbench({ store: { ...baseStore(), selectedSession: undefined } })
    fireEvent.click(screen.getByRole('button', { name: en.sessionGridView }))
    expect(store.setSessionView).toHaveBeenCalledWith('grid')
    fireEvent.click(screen.getByRole('button', { name: en.timelineActivity }))
    expect(store.setTimelineMode).toHaveBeenCalledWith('all')
  })

  it('switches the column layout preset through the header switcher', () => {
    const { store } = renderWorkbench()
    fireEvent.click(screen.getByRole('button', { name: en['layout.timeline'] }))
    expect(store.setLayout).toHaveBeenCalledWith('timeline')
    fireEvent.click(screen.getByRole('button', { name: en['layout.compact'] }))
    expect(store.setLayout).toHaveBeenCalledWith('compact')
    fireEvent.click(screen.getByRole('button', { name: en['layout.balanced'] }))
    expect(store.setLayout).toHaveBeenCalledWith('balanced')
  })

  it('collapses a card body through its fold button', () => {
    const { store } = renderWorkbench()
    fireEvent.click(screen.getAllByRole('button', { name: en.collapse })[0]!)
    expect(store.toggleCollapsed).toHaveBeenCalled()
  })

  it('closes the panel on Escape and ignores every other key', () => {
    const onClose = vi.fn()
    renderWorkbench({ onClose })
    fireEvent.keyDown(document, { key: 'a' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('folds the Smart Q&A body away with its own fold state', () => {
    renderWorkbench({ store: { ...baseStore(), collapsed: { qa: true } } })
    expect(screen.getByText(en.smartQA)).toBeTruthy()
    expect(screen.queryByPlaceholderText(en.inputPlaceholder)).toBeNull()
  })
})
