// @vitest-environment jsdom

import { cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cellPhase, GridCell, SessionStatusCard } from '../src/client/SessionStatusCard.tsx'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { createConsoleStore } from '../src/client/consoleStore.ts'
import type { SessionBucket } from '../src/client/sessionState.ts'
import { en, zh } from '../src/client/locales.ts'
import type { ConsoleKey } from '../src/client/locales.ts'
import css from '../src/client/console.module.css'

afterEach(cleanup)

const t = (key: string): string => (en as Record<string, string>)[key] ?? key
const zhT = (key: ConsoleKey): string => zh[key]

/** Resolve one grid square's tone class, or fail loudly when the sheet lost it. */
function toneClass(suffix: string): string {
  const name = css[`gridCell${suffix}`]
  if (name === undefined) throw new Error(`gridCell${suffix} class missing from console.module.css`)
  return name
}

function session(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: id as SessionSummary['id'],
    displayTitle: id,
    running: false,
    retainedBy: {},
    blank: false,
    updatedAt: 0,
    ...overrides,
  }
}

/** One row per bucket, so a filter case reads as the squares the grid tiles. */
const FILTER_ROWS: Record<string, SessionSummary> = {
  sRunning: session('sRunning', { running: true }),
  sPending: session('sPending'),
  sCompleted: session('sCompleted'),
  sIdle: session('sIdle'),
  sArchived: session('sArchived'),
}

/** The pending interaction of the one awaiting-input row above. */
const PENDING_KIND = (id: string): string | undefined => (id === 'sPending' ? 'question' : undefined)

/** The status feed's unacknowledged-completion bit for the one completed row. */
const COMPLETED_OF = (id: string): boolean => id === 'sCompleted'

/** The archived id among those same rows. */
const ARCHIVED_IDS = ['sArchived']

/** The grid square for a session id, or null when the filter hides it. */
function squareOf(id: string): HTMLElement | null {
  return screen.queryByRole('button', { name: new RegExp(id) })
}

function renderCard(overrides: {
  byId?: Record<string, SessionSummary>
  current?: string
  sessionView?: 'stats' | 'grid'
  sessionBuckets?: readonly SessionBucket[]
  selected?: string
  archived?: readonly string[]
  pendingKindOf?: (id: string) => string | undefined
  completedOf?: (id: string) => boolean
  t?: (key: ConsoleKey) => string
  setSessionView?: (view: 'stats' | 'grid') => void
  toggleSessionBucket?: (bucket: SessionBucket) => void
  selectSession?: (id: string) => void
  clearScope?: () => void
  onContextMenu?: (id: string, x: number, y: number) => void
  onNewSession?: () => void
  collapsed?: boolean
  onToggleCollapse?: () => void
} = {}) {
  // The real store backs the default bucket selection and the default toggle, so
  // a filter click moves the same state the workbench's bound hook reads.
  const store = createConsoleStore().create()
  const setSessionView = overrides.setSessionView ?? vi.fn()
  const toggleSessionBucket = overrides.toggleSessionBucket ?? store.actions.toggleSessionBucket
  const selectSession = overrides.selectSession ?? vi.fn()
  const clearScope = overrides.clearScope ?? vi.fn()
  const onContextMenu = overrides.onContextMenu ?? vi.fn()
  const onNewSession = overrides.onNewSession ?? vi.fn()
  const onToggleCollapse = overrides.onToggleCollapse ?? vi.fn()
  const card = (sessionBuckets: readonly SessionBucket[]) => (
    <SessionStatusCard
      t={overrides.t ?? t}
      byId={overrides.byId ?? { s1: session('s1', { running: true }), s2: session('s2') }}
      current={overrides.current}
      sessionView={overrides.sessionView ?? 'stats'}
      sessionBuckets={sessionBuckets}
      selected={overrides.selected}
      isArchived={id => (overrides.archived ?? []).includes(id)}
      pendingKindOf={overrides.pendingKindOf ?? (() => undefined)}
      completedOf={overrides.completedOf ?? (() => false)}
      setSessionView={setSessionView}
      toggleSessionBucket={toggleSessionBucket}
      selectSession={selectSession}
      clearScope={clearScope}
      onContextMenu={onContextMenu}
      onNewSession={onNewSession}
      collapsed={overrides.collapsed ?? false}
      onToggleCollapse={onToggleCollapse}
    />
  )
  const view = render(card(overrides.sessionBuckets ?? store.getSnapshot().sessionBuckets))
  return {
    setSessionView, toggleSessionBucket, selectSession, clearScope, onContextMenu, onNewSession,
    onToggleCollapse, store,
    /** Re-render against the store's current selection, as the bound hook would. */
    rerender: () => { view.rerender(card(store.getSnapshot().sessionBuckets)) },
  }
}

describe('cellPhase', () => {
  it('derives the tone from the phase signals and the label as a dictionary key', () => {
    expect(cellPhase(session('s', { running: true }), 'question', false).tone).toBe('running')
    expect(cellPhase(session('s'), 'plan-review', false).tone).toBe('planning')
    expect(cellPhase(session('s'), 'question', false).tone).toBe('pending')
    const archived = cellPhase(session('s'), undefined, true)
    expect(archived.tone).toBe('archived')
    // The key is a derivation the card translates; it is never the text a
    // square announces.
    expect(archived.labelKey).toBe('sessionStatus.archived')
  })

  it('gives an approval wait the waiting tone and its own label key', () => {
    const approval = cellPhase(session('s'), 'approval', false)
    expect(approval.tone).toBe('waiting')
    expect(approval.labelKey).toBe('sessionStatus.waiting')
    // An archived approval is archived: the archival signal keeps its existing
    // precedence over every pending kind.
    expect(cellPhase(session('s'), 'approval', true).tone).toBe('archived')
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

  it('suppresses the browser menu on a right-click', () => {
    const onContextMenu = vi.fn()
    render(<GridCell summary={session('s')} tone="available" aria={en['sessionStatus.available']} active={false} selected={false} onClick={() => {}} onContextMenu={onContextMenu} />)
    const event = createEvent.contextMenu(screen.getByRole('button'), { clientX: 10, clientY: 20 })
    fireEvent(screen.getByRole('button'), event)
    // jsdom opens no native menu, so the suppression is read off the event.
    expect(event.defaultPrevented).toBe(true)
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

  it('renders the grid square view and scopes the console to the clicked session', () => {
    const { selectSession } = renderCard({ sessionView: 'grid', byId: { s1: session('s1'), s2: session('s2') } })
    const cell = screen.getByRole('button', { name: /s1/ })
    fireEvent.click(cell)
    expect(selectSession).toHaveBeenCalledWith('s1')
  })

  it('returns the scope to the whole list through the header pill', () => {
    const { clearScope } = renderCard({ sessionView: 'grid', selected: 's1' })
    fireEvent.click(screen.getByRole('button', { name: en.scopeAllSessions }))
    expect(clearScope).toHaveBeenCalled()
  })

  it('offers no scope pill while the whole list is in scope, holding its slot instead', () => {
    renderCard({ sessionView: 'grid' })
    expect(screen.queryByRole('button', { name: en.scopeAllSessions })).toBeNull()
    // The slot itself stays: a hidden label keeps the pill's width, so the
    // filter beside it does not move when a session becomes scoped.
    expect(screen.getByText(en.scopeAllSessions).getAttribute('aria-hidden')).toBe('true')
  })

  it('opens the new-session action', () => {
    const { onNewSession } = renderCard()
    fireEvent.click(screen.getByRole('button', { name: en.newSession }))
    expect(onNewSession).toHaveBeenCalled()
  })

  it('shows the no-session hint in the grid view when empty', () => {
    renderCard({ sessionView: 'grid', byId: {} })
    expect(screen.getByText(en.noSession)).toBeTruthy()
    expect(screen.queryByText(en.noSessionMatch)).toBeNull()
  })

  it('names a filtered-out grid instead of claiming there are no sessions', () => {
    renderCard({ sessionView: 'grid', sessionBuckets: [], byId: FILTER_ROWS, pendingKindOf: PENDING_KIND, completedOf: COMPLETED_OF, archived: ARCHIVED_IDS })
    expect(screen.getByText(en.noSessionMatch)).toBeTruthy()
    expect(screen.queryByText(en.noSession)).toBeNull()
  })

  it('counts archived sessions and the current row in the stats view', () => {
    renderCard({ byId: { s1: session('s1'), s2: session('s2') }, archived: ['s1'] })
    expect(screen.getAllByText('1', { exact: true }).length).toBeGreaterThanOrEqual(1)
  })

  it('counts sessions awaiting a pending interaction', () => {
    renderCard({ byId: { s1: session('s1'), s2: session('s2') }, pendingKindOf: id => (id === 's1' ? 'question' : undefined) })
    expect(screen.getAllByText('1', { exact: true }).length).toBeGreaterThanOrEqual(1)
  })

  it('counts every session in the stats view whatever the filter hides', () => {
    renderCard({ sessionBuckets: [], byId: FILTER_ROWS, pendingKindOf: PENDING_KIND, completedOf: COMPLETED_OF, archived: ARCHIVED_IDS })
    // No bucket is selected at all, and the tiles still count the whole list:
    // the filter narrows the grid squares, never the statistics.
    expect(screen.getByText('5', { exact: true })).toBeTruthy()
    expect(screen.getAllByText('1', { exact: true })).toHaveLength(4)
  })
})

describe('SessionStatusCard grid filter', () => {
  const grid = (overrides: Parameters<typeof renderCard>[0] = {}) => renderCard({
    sessionView: 'grid', byId: FILTER_ROWS, pendingKindOf: PENDING_KIND, completedOf: COMPLETED_OF, archived: ARCHIVED_IDS, ...overrides,
  })

  const openFilter = () => { fireEvent.click(screen.getByRole('button', { name: en.sessionFilter })) }

  it('opens on running, awaiting-input and idle squares, leaving completed and archived out', () => {
    grid()
    expect(squareOf('sRunning')).toBeTruthy()
    expect(squareOf('sPending')).toBeTruthy()
    expect(squareOf('sIdle')).toBeTruthy()
    expect(squareOf('sCompleted')).toBeNull()
    expect(squareOf('sArchived')).toBeNull()
  })

  it('offers the filter in the grid view alone', () => {
    renderCard({ sessionView: 'stats' })
    expect(screen.queryByRole('button', { name: en.sessionFilter })).toBeNull()
  })

  it('opens and closes its list from the trigger, announcing the expanded state', () => {
    grid()
    const trigger = screen.getByRole('button', { name: en.sessionFilter })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)

    openFilter()
    expect(screen.getByRole('button', { name: en.sessionFilter }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByRole('menuitem').map(entry => entry.textContent)).toEqual([
      en.sessionRunning, en.sessionPending, en.sessionCompleted, en.sessionIdle, en.sessionArchived,
    ])

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
    expect(screen.getByRole('button', { name: en.sessionFilter }).getAttribute('aria-expanded')).toBe('false')
  })

  it('closes its list on an outside click', () => {
    grid()
    openFilter()
    expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0)

    fireEvent.pointerDown(document.body)
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
  })

  it('toggles the bucket the clicked row names', () => {
    const { toggleSessionBucket } = grid({ toggleSessionBucket: vi.fn() })
    openFilter()
    fireEvent.click(screen.getByRole('menuitem', { name: en.sessionArchived }))
    expect(toggleSessionBucket).toHaveBeenCalledWith('archived')
  })

  it('shows and hides a bucket\'s squares as the operator toggles it', () => {
    const { rerender } = grid()

    openFilter()
    fireEvent.click(screen.getByRole('menuitem', { name: en.sessionCompleted }))
    rerender()
    expect(squareOf('sCompleted')).toBeTruthy()
    expect(squareOf('sRunning')).toBeTruthy()

    // The list stays open across a toggle, so the next tick lands on it too.
    fireEvent.click(screen.getByRole('menuitem', { name: en.sessionRunning }))
    rerender()
    expect(squareOf('sRunning')).toBeNull()
    expect(squareOf('sCompleted')).toBeTruthy()
  })

  it('hides archived squares until the archived bucket is ticked', () => {
    const { rerender } = grid()
    expect(squareOf('sArchived')).toBeNull()

    openFilter()
    fireEvent.click(screen.getByRole('menuitem', { name: en.sessionArchived }))
    rerender()
    expect(squareOf('sArchived')).toBeTruthy()
    // Ticking the bucket in shows the square; it does not re-bucket the session,
    // whose square still carries the archived phase the grid draws.
    expect(squareOf('sArchived')?.getAttribute('aria-label')).toBe(`sArchived (${en['sessionStatus.archived']})`)
  })

  it('announces a square\'s phase in the operator\'s language, never the dictionary key', () => {
    grid({ sessionBuckets: ['archived'], t: zhT })
    expect(squareOf('sArchived')?.getAttribute('aria-label')).toBe(`sArchived (${zh['sessionStatus.archived']})`)
  })

  it('leaves the scope click and the context menu on a square the filter shows', () => {
    const selectSession = vi.fn()
    const onContextMenu = vi.fn()
    grid({ selectSession, onContextMenu })

    fireEvent.click(squareOf('sIdle') as HTMLElement)
    expect(selectSession).toHaveBeenCalledWith('sIdle')

    fireEvent.contextMenu(squareOf('sPending') as HTMLElement, { clientX: 3, clientY: 4 })
    expect(onContextMenu).toHaveBeenCalledWith('sPending', 3, 4)
  })
})

describe('SessionStatusCard awaiting-input parity', () => {
  /** One row per pending kind a domain publishes, plus one holding none. */
  const PARITY_ROWS: Record<string, SessionSummary> = {
    sApproval: session('sApproval'),
    sQuestion: session('sQuestion'),
    sPlan: session('sPlan'),
    sIdle: session('sIdle'),
  }
  const PARITY_KINDS: Record<string, string | undefined> = {
    sApproval: 'approval',
    sQuestion: 'question',
    sPlan: 'plan-review',
    sIdle: undefined,
  }
  const pendingKindOf = (id: string): string | undefined => PARITY_KINDS[id]

  it('tiles exactly the sessions the awaiting-input count counts', () => {
    renderCard({ byId: PARITY_ROWS, pendingKindOf })
    // The statistics view's awaiting-input tile over these rows. The count sits
    // in the item's own number slot, ahead of its label.
    const counted = screen.getByText(en.sessionPending).previousElementSibling?.textContent
    expect(counted).toBe('3')
    cleanup()

    // The same rows, tiled by that one bucket alone: the approval row — the
    // kind a two-kind enumeration dropped — is one of the squares.
    renderCard({ sessionView: 'grid', sessionBuckets: ['pending'], byId: PARITY_ROWS, pendingKindOf })
    const tiled = within(screen.getByLabelText(en.sessionGridAria)).getAllByRole('button')
    expect(tiled).toHaveLength(Number(counted))
    // Each square announces its own phase, translated: `sessionPhase` gives
    // every kind its own phase, so the approval row reads as waiting and the
    // question and plan-review rows keep the phases they had.
    expect(tiled.map(cell => cell.getAttribute('aria-label'))).toEqual([
      `sApproval (${en['sessionStatus.waiting']})`,
      `sQuestion (${en['sessionStatus.pending']})`,
      `sPlan (${en['sessionStatus.planning']})`,
    ])
  })

  it('draws the approval square in the waiting tone, beside the tones of the other kinds', () => {
    renderCard({ sessionView: 'grid', sessionBuckets: ['pending'], byId: PARITY_ROWS, pendingKindOf })
    // The bucket decides whether the square renders; the phase decides how it
    // is drawn. A square the awaiting-input bucket tiles must not keep the
    // available tone it carried while the approval kind had no phase arm.
    expect(squareOf('sApproval')?.classList.contains(toneClass('Waiting'))).toBe(true)
    expect(squareOf('sApproval')?.classList.contains(toneClass('Available'))).toBe(false)
    expect(squareOf('sQuestion')?.classList.contains(toneClass('Pending'))).toBe(true)
    expect(squareOf('sPlan')?.classList.contains(toneClass('Planning'))).toBe(true)
  })

  it('announces an approval wait in the operator\'s own language', () => {
    // The announcement is pinned, not read back out of the dictionary: a screen
    // reader must hear what is being waited on, in the vocabulary `ui-approval`
    // itself uses, so a copy change back to a bare phase word fails here.
    for (const [translate, announcement] of [[t, 'Waiting for approval'], [zhT, '等待审批']] as const) {
      renderCard({
        sessionView: 'grid', sessionBuckets: ['pending'], byId: PARITY_ROWS, pendingKindOf, t: translate,
      })
      expect(squareOf('sApproval')?.getAttribute('aria-label')).toBe(`sApproval (${announcement})`)
      cleanup()
    }
  })
})
