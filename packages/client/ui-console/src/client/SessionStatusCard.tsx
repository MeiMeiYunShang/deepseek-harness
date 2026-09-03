/**
 * Session-status card: a header with a stats/grid view toggle and a "new
 * session" action, then either the counted summary or the per-session grid.
 */

import type { ReactNode } from 'react'
import clsx from 'clsx'
import { IconPlusOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionView } from './consoleStore.ts'
import type { ConsoleKey } from './locales.ts'
import { sessionPhase, sessionPhaseLabel } from './sessionState.ts'
import css from './console.module.css'

/** A session-phase colored square in the grid view. */
export interface GridCellPhase {
  /** Phase class suffix. */
  tone: string
  /** aria description of the phase. */
  aria: string
}

/** Map a summary + interaction kind + archive context to the cell's decorative tone and aria. */
export function cellPhase(
  summary: SessionSummary,
  pendingKind: string | undefined,
  archived: boolean,
): GridCellPhase {
  const phase = sessionPhase(summary, pendingKind, archived)
  return { tone: phase, aria: sessionPhaseLabel(phase) }
}

/** Counted summary for the stats view: one labeled count block. */
function CountItem({ tone, label, children }: {
  tone: string
  label: string
  children: ReactNode
}) {
  return (
    <div className={clsx(css.countItem, css[`count${tone}`])}>
      <span className={css.countItemDot} />
      <span className={css.countItemNumber}>{children}</span>
      <span className={css.countItemLabel}>{label}</span>
    </div>
  )
}

/** One grid square for a session. */
export function GridCell({ summary, tone, aria, active, selected, onClick, onContextMenu }: {
  summary: SessionSummary
  /** Phase class suffix for the square color / animation. */
  tone: string
  /** Accessible description of the session status. */
  aria: string
  /** Whether this is the current session. */
  active: boolean
  /** Whether this session is the grid-selected one. */
  selected: boolean
  onClick: () => void
  onContextMenu?: (x: number, y: number) => void
}) {
  const title = summary.title ?? summary.displayTitle
  return (
    <button
      type="button"
      className={clsx(css.gridCell, css[`gridCell${tone.charAt(0).toUpperCase()}${tone.slice(1)}`],
        active && css.gridCellActive, selected && css.gridCellSelected)}
      aria-label={`${title} (${aria})`}
      aria-pressed={selected}
      title={title}
      onClick={onClick}
      onContextMenu={(event) => { onContextMenu?.(event.clientX, event.clientY) }}
    />
  )
}

/** Props for the session-status card. */
export interface SessionStatusCardProps {
  /** Translator. */
  t: (key: ConsoleKey) => string
  /** Live session rows. */
  byId: Record<string, SessionSummary>
  /** Current session id. */
  current: string | undefined
  /** The current stats/grid view. */
  sessionView: SessionView
  /** Grid-selected session id. */
  selected: string | undefined
  /** Whether a session id is archived. */
  isArchived: (id: string) => boolean
  /** The pending interaction kind for a session, if any. */
  pendingKindOf: (id: string) => string | undefined
  /** Switch the stats/grid view. */
  setSessionView: (view: SessionView) => void
  /** Grid-square click (select the session). */
  selectSession: (id: string) => void
  /** Grid-square right-click (open the context menu at x/y). */
  onContextMenu: (id: string, x: number, y: number) => void
  /** New-session action. */
  onNewSession: () => void
}

/** Session status card: the header row plus the selected view body. */
export function SessionStatusCard({
  t, byId, current, sessionView, selected, isArchived, pendingKindOf, setSessionView, selectSession, onContextMenu, onNewSession,
}: SessionStatusCardProps) {
  const sessions = Object.values(byId)
  const running = sessions.filter(session => session.running).length
  const completed = sessions.filter(session => session.completed === true).length
  const pending = sessions.filter(session => pendingKindOf(session.id) !== undefined).length

  return (
    <div className={css.card}>
      <div className={css.sessionCardHeader}>
        <h3 className={css.cardTitle}>{t('sessionStatus')}</h3>
        <button type="button" className={css.newSessionButton} onClick={onNewSession}>
          <IconPlusOutline16 size={14} />
          <span>{t('newSession')}</span>
        </button>
      </div>
      <div className={css.sessionViewToggle} role="group" aria-label={t('sessionViewToggleAria')}>
        <button
          type="button"
          className={clsx(css.modeButton, sessionView === 'stats' && css.modeButtonActive)}
          aria-pressed={sessionView === 'stats'}
          onClick={() => { setSessionView('stats') }}
        >
          {t('sessionStatsView')}
        </button>
        <button
          type="button"
          className={clsx(css.modeButton, sessionView === 'grid' && css.modeButtonActive)}
          aria-pressed={sessionView === 'grid'}
          onClick={() => { setSessionView('grid') }}
        >
          {t('sessionGridView')}
        </button>
      </div>
      {sessionView === 'stats'
        ? (
          <div className={css.countsBlock}>
            <CountItem tone="Current" label={t('sessionCurrent')}>{String(sessions.length)}</CountItem>
            <CountItem tone="Running" label={t('sessionRunning')}>{String(running)}</CountItem>
            <CountItem tone="Waiting" label={t('sessionPending')}>{String(pending)}</CountItem>
            <CountItem tone="Pending" label={t('sessionCompleted')}>{String(completed)}</CountItem>
            <CountItem tone="Waiting" label={t('sessionArchived')}>{String(sessions.filter(session => isArchived(session.id)).length)}</CountItem>
          </div>
        )
        : (
          <div className={css.sessionGrid} aria-label={t('sessionGridAria')}>
            {sessions.length === 0
              ? <span className={css.emptyHint}>{t('noSession')}</span>
              : sessions.map((session) => {
                const phase = cellPhase(session, pendingKindOf(session.id), isArchived(session.id))
                return (
                  <GridCell
                    key={session.id}
                    summary={session}
                    tone={phase.tone}
                    aria={phase.aria}
                    active={session.id === current}
                    selected={session.id === selected}
                    onClick={() => { selectSession(session.id) }}
                    onContextMenu={(x, y) => { onContextMenu(session.id, x, y) }}
                  />
                )
              })}
          </div>
        )}
    </div>
  )
}
