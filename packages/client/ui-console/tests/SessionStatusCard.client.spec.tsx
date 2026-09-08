// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cellPhase, GridCell, SessionStatusCard } from '../src/client/SessionStatusCard.tsx'
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

function renderCard(overrides: {
  byId?: Record<string, SessionSummary>
  current?: string
  sessionView?: 'stats' | 'grid'
  selected?: string
  archived?: readonly string[]
  pendingKindOf?: (id: string) => string | undefined
  setSessionView?: (view: 'stats' | 'grid') => void
  selectSession?: (id: string) => void
  onContextMenu?: (id: string, x: number, y: number) => void
  onNewSession?: () => void
  collapsed?: boolean
  onToggleCollapse?: () => void
} = {}) {
  const setSessionView = overrides.setSessionView ?? vi.fn()
  const selectSession = overrides.selectSession ?? vi.fn()
  const onContextMenu = overrides.onContextMenu ?? vi.fn()
  const onNewSession = overrides.onNewSession ?? vi.fn()
  const onToggleCollapse = overrides.onToggleCollapse ?? vi.fn()
  render(<SessionStatusCard
    t={t}
    byId={overrides.byId ?? { s1: session('s1', { running: true }), s2: session('s2', { completed: true }) }}
    current={overrides.current}
    sessionView={overrides.sessionView ?? 'stats'}
    selected={overrides.selected}
    isArchived={id => (overrides.archived ?? []).includes(id)}
    pendingKindOf={overrides.pendingKindOf ?? (() => undefined)}
    setSessionView={setSessionView}
    selectSession={selectSession}
    onContextMenu={onContextMenu}
    onNewSession={onNewSession}
    collapsed={overrides.collapsed ?? false}
    onToggleCollapse={onToggleCollapse}
  />)
  return { setSessionView, selectSession, onContextMenu, onNewSession, onToggleCollapse }
}

describe('cellPhase', () => {
  it('derives the tone and aria from the phase signals', () => {
    expect(cellPhase(session('s', { running: true }), 'question', false).tone).toBe('running')
    expect(cellPhase(session('s'), 'plan-review', false).tone).toBe('planning')
    expect(cellPhase(session('s'), 'question', false).tone).toBe('pending')
    const archived = cellPhase(session('s'), undefined, true)
    expect(archived.tone).toBe('archived')
  })
})

describe('GridCell', () => {
  it('renders a grid square with aria and selection state', () => {
    render(<GridCell summary={session('s', { title: 'Title' })} tone="running" aria={en['sessionStatus.running']} active selected onClick={() => {}} />)
    const cell = screen.getByRole('button', { name: `Title (${en['sessionStatus.running']})` })
    expect(cell.getAttribute('aria-pressed')).toBe('true')
  })

  it('fires the right-click context menu handler with coordinates', () => {
    const onContextMenu = vi.fn()
    render(<GridCell summary={session('s')} tone="available" aria={en['sessionStatus.available']} active={false} selected={false} onClick={() => {}} onContextMenu={onContextMenu} />)
    fireEvent.contextMenu(screen.getByRole('button'), { clientX: 10, clientY: 20 })
    expect(onContextMenu).toHaveBeenCalledWith(10, 20)
  })
})

describe('SessionStatusCard', () => {
  it('renders the stats view and switches to the grid view', () => {
    const { setSessionView } = renderCard()
    expect(screen.getByText(en.sessionStatus)).toBeTruthy()
    expect(screen.getAllByText('2', { exact: true }).length).toBeGreaterThanOrEqual(1)

    fireEvent.click(screen.getByRole('button', { name: en.sessionGridView }))
    expect(setSessionView).toHaveBeenCalledWith('grid')

    fireEvent.click(screen.getByRole('button', { name: en.sessionStatsView }))
    expect(setSessionView).toHaveBeenCalledWith('stats')
  })

  it('collapses and expands its body through the fold button', () => {
    const { onToggleCollapse } = renderCard({ collapsed: false })
    fireEvent.click(screen.getByRole('button', { name: en.collapse }))
    expect(onToggleCollapse).toHaveBeenCalled()
  })

  it('hides the counts body when collapsed', () => {
    renderCard({ collapsed: true })
    expect(screen.getByText(en.sessionStatus)).toBeTruthy()
    expect(screen.queryByText(en.sessionStatsView)).toBeNull()
  })

  it('renders the grid square view and selects a session', () => {
    const { selectSession } = renderCard({ sessionView: 'grid', byId: { s1: session('s1'), s2: session('s2') } })
    const cell = screen.getByRole('button', { name: /s1/ })
    fireEvent.click(cell)
    expect(selectSession).toHaveBeenCalledWith('s1')
  })

  it('opens the new-session action', () => {
    const { onNewSession } = renderCard()
    fireEvent.click(screen.getByRole('button', { name: en.newSession }))
    expect(onNewSession).toHaveBeenCalled()
  })

  it('shows the no-session hint in the grid view when empty', () => {
    renderCard({ sessionView: 'grid', byId: {} })
    expect(screen.getByText(en.noSession)).toBeTruthy()
  })

  it('counts archived sessions and the current row in the stats view', () => {
    renderCard({ byId: { s1: session('s1'), s2: session('s2') }, archived: ['s1'] })
    expect(screen.getAllByText('1', { exact: true }).length).toBeGreaterThanOrEqual(1)
  })

  it('counts sessions awaiting a pending interaction', () => {
    renderCard({ byId: { s1: session('s1'), s2: session('s2') }, pendingKindOf: id => (id === 's1' ? 'question' : undefined) })
    expect(screen.getAllByText('1', { exact: true }).length).toBeGreaterThanOrEqual(1)
  })
})
