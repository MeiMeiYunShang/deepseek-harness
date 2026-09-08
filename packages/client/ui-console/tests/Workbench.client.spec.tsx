// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-session-stats/types'
import { Workbench } from '../src/client/Workbench.tsx'
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
  timeline: [{ id: 1, sessionId: 's1', time: 1000, kind: 'status' }],
  seq: 1,
  systemStatus: { cpu: 42, memory: 61, gpu: null },
  timelineMode: 'brief',
  sessionView: 'stats',
  selectedSession: 's1',
  timelineScope: undefined,
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
} = {}) {
  const snap = createSnapshotStore<ConsoleStoreState>(overrides.store ?? baseStore())
  const store = {
    setTimelineMode: vi.fn(),
    setSessionView: vi.fn(),
    setSelectedSession: vi.fn(),
    setTimelineScope: vi.fn(),
    setLayout: vi.fn(),
    toggleCollapsed: vi.fn(),
  }
  const srv = services(overrides.services)
  render(<Workbench
    t={t}
    onClose={() => {}}
    byId={overrides.byId ?? { s1: session('s1', { running: true }), s2: session('s2', { completed: true }) }}
    current="s1"
    archived={new Set(overrides.archived ?? [])}
    titleOf={overrides.titleOf ?? (id => (overrides.byId ?? { s1: session('s1') })[id]?.displayTitle)}
    pendingKindOf={() => undefined}
    workspaces={overrides.workspaces ?? [{ id: 'w1', label: 'Workspace' }]}
    useConsole={bindSnapshotSelector(snap)}
    store={store}
    services={srv}
    chat={vi.fn(async function* () { /* no chunks */ })}
    defaultModel={null}
  />)
  return { snap, store, srv }
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

  it('has a context-menu selection on an unknown action that only closes', async () => {
    const { store } = renderWorkbench({ store: { ...baseStore(), sessionView: 'grid' } })
    const cell = screen.queryAllByRole('button').find(button => (button.getAttribute('aria-label') ?? '').includes('s1'))
    if (cell !== undefined) fireEvent.contextMenu(cell, { clientX: 10, clientY: 20 })
    await waitFor(() =>{  expect(screen.getByRole('menu')).toBeTruthy() })
    fireEvent.click(screen.getAllByRole('menuitem')[0]!)
    await waitFor(() =>{  expect(store.setSessionView).not.toHaveBeenCalled() })
  })

  it('selects a grid session and sends an instruction through the composer', async () => {
    const { srv } = renderWorkbench({ store: { ...baseStore(), sessionView: 'grid' } })
    const cell = screen.queryAllByRole('button').find(button => (button.getAttribute('aria-label') ?? '').includes('s2'))
    if (cell !== undefined) fireEvent.click(cell)
    await waitFor(() =>{  expect(srv.open).toHaveBeenCalledWith('s2') })
    // composer input is the enabled textbox; SmartQA input is disabled (model null).
    const composer = screen.getByPlaceholderText(en.composerPlaceholder) as HTMLInputElement
    fireEvent.change(composer, { target: { value: 'instruct' } })
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getAllByRole('button', { name: en.send }).find(button => !(button as HTMLButtonElement).disabled)!)
    await waitFor(() =>{  expect(srv.sendInstruction).toHaveBeenCalledWith('s1', 'instruct') })
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
    const { store } = renderWorkbench()
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

  it('clears the timeline scope through the pill', () => {
    const { store } = renderWorkbench({ store: { ...baseStore(), timelineScope: 's1' } })
    fireEvent.click(screen.getByRole('button', { name: en.timelineScopeAll }))
    expect(store.setTimelineScope).toHaveBeenCalledWith(undefined)
  })
})
