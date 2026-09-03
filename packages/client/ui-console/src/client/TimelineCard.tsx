/**
 * Timeline card: a toolbar (scope pill + brief/all toggle), the event list with
 * collapsible details, and the bottom instruction composer.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { TimelineEntry, TimelineMode } from './consoleStore.ts'
import type { ConsoleKey } from './locales.ts'
import { FOLD_LIMIT, foldText, shortId, timelineLabelKey } from './timelineText.ts'
import { formatTime } from './format.ts'
import { CardHeader } from './CardHeader.tsx'
import css from './console.module.css'

/** A timeline row's decorative tone class suffix. */
export type RowTone = 'info' | 'action' | 'warn' | 'error' | 'neutral' | 'hollow'

/** One timeline row's optional detail payload (ask-question variants). */
export interface TimelineDetail {
  /** Question text. */
  readonly question: string
  /** Option labels. */
  readonly options: readonly string[]
  /** Whether the row is the interactive answer card. */
  readonly interactive: boolean
}

/** Props for the timeline card. */
export interface TimelineCardProps {
  /** Translator. */
  t: (key: ConsoleKey) => string
  /** Unfiltered timeline entries. */
  timeline: readonly TimelineEntry[]
  /** Selected verbosity. */
  timelineMode: TimelineMode
  /** Timeline scope: one session id, or undefined for the whole list. */
  scope: string | undefined
  /** The grid-selected session id (composer target), or undefined. */
  selected: string | undefined
  /** Set the verbosity. */
  setTimelineMode: (mode: TimelineMode) => void
  /** Clear the scope pill. */
  clearScope: () => void
  /** Send one instruction over the composer. */
  sendInstruction: (text: string) => Promise<unknown>
  /** Whether the card body is collapsed. */
  collapsed: boolean
  /** Toggle the collapsed state. */
  onToggleCollapse: () => void
}

/** Dot tone for a timeline entry kind. */
export function rowTone(kind: string): RowTone {
  return kind === 'status' ? 'action' : 'info'
}

/** Props for the timeline list body. */
export interface TimelineListProps {
  t: (key: ConsoleKey) => string
  timeline: readonly TimelineEntry[]
  scope: string | undefined
  detailOf: (entry: TimelineEntry) => TimelineDetail | undefined
}

/** The event list with per-row folding and optional ask-card detail. */
export function TimelineList({ t, timeline, scope, detailOf }: TimelineListProps) {
  const [expandedSeq, setExpandedSeq] = useState<number | null>(null)
  const scoped = scope === undefined ? [...timeline] : timeline.filter(entry => entry.sessionId === scope)
  if (scoped.length === 0) return <span className={css.emptyHint}>{t('timelineEmpty')}</span>
  const reversed = scoped.reverse()
  return (
    <>
      {reversed.map((entry, index) => {
        const label = t(timelineLabelKey(entry.kind))
        const detail = detailOf(entry)
        const fullText = `${t('sessionPrefix')} ${shortId(entry.sessionId)} ${label}`
        const isExpanded = expandedSeq === entry.id
        const text = isExpanded ? fullText : foldText(fullText, FOLD_LIMIT)
        const folding = fullText.length > FOLD_LIMIT
        const showToggle = folding || detail !== undefined
        return (
          <TimelineRow
            key={entry.id}
            time={formatTime(entry.time)}
            tone={rowTone(entry.kind)}
            last={index === reversed.length - 1}
            text={text}
            showToggle={showToggle}
            expanded={isExpanded}
            toggleText={isExpanded ? t('timelineCollapse') : t('timelineExpand')}
            onToggle={() => { setExpandedSeq(isExpanded ? null : entry.id) }}
          >
            {detail !== undefined && <AskCardBody detail={detail} t={t} />}
          </TimelineRow>
        )
      })}
    </>
  )
}

/** One timeline row (dot, rail, label, time, optional detail). */
export function TimelineRow({ time, tone, last, text, showToggle, expanded, toggleText, onToggle, children }: {
  /** HH:MM:SS timestamp. */
  time: string
  /** Decorative dot tone. */
  tone: RowTone
  /** Whether this is the last row (hides the rail). */
  last: boolean
  /** Row display text. */
  text: string
  /** Whether the fold/expand toggle is shown. */
  showToggle: boolean
  /** Whether the row is currently expanded. */
  expanded: boolean
  /** Toggle label. */
  toggleText: string
  /** Toggle the expanded state. */
  onToggle: () => void
  children?: ReactNode
}) {
  return (
    <div className={css.timelineItem}>
      <div className={clsx(css.timelineDot, css[`dot${tone.charAt(0).toUpperCase()}${tone.slice(1)}`])} />
      <div className={clsx(css.timelineLine, last && css.timelineLineLast)} />
      <div className={css.timelineMain}>
        <div className={css.timelineTextRow}>
          <span className={css.timelineText}>{text}</span>
          {showToggle && (
            <button
              type="button"
              className={css.timelineExpand}
              aria-expanded={expanded}
              onClick={onToggle}
            >
              {toggleText}
            </button>
          )}
        </div>
        <span className={css.timelineTime}>{time}</span>
      </div>
      {children !== undefined && <div className={css.timelineDetail}>{children}</div>}
    </div>
  )
}

/** The ask-question detail body: read-only mirror or the interactive card. */
export function AskCardBody({ detail, t }: { detail: TimelineDetail; t: (key: ConsoleKey) => string }) {
  if (!detail.interactive) {
    return (
      <div className={css.readonlyMirror}>
        <p className={css.askCardTitle}>{detail.question}</p>
        <ul className={css.optionList}>
          {detail.options.map(option => <li key={option}>{option}</li>)}
        </ul>
      </div>
    )
  }
  return (
    <div className={css.askCard}>
      <h4 className={css.askCardTitle}>{detail.question}</h4>
      <div className={css.optionList}>
        {detail.options.map((option, index) => (
          <button key={option} type="button" className={css.optionButton}>
            {option}
            {index === 0 && <span className={css.recommendBadge}>{t('askUserRecommend')}</span>}
          </button>
        ))}
      </div>
      <input
        type="text"
        className={css.selfInput}
        placeholder={t('askUserSelfInput')}
        aria-label={t('askUserSelfInput')}
      />
      <div className={css.askPager}>
        <span className={css.askPagerInfo}>1 / {Math.max(1, detail.options.length)}</span>
      </div>
      <div className={css.askActions}>
        <button type="button" className={css.secondaryButton}>{t('askUserSkip')}</button>
        <button type="button" className={css.sendButton}>{t('askUserSubmit')}</button>
      </div>
    </div>
  )
}

/** Props for the instruction composer. */
export interface ComposerProps {
  t: (key: ConsoleKey) => string
  selected: string | undefined
  sendInstruction: (text: string) => Promise<unknown>
}

/** Instruction composer: a disabled-aware input plus a send action. */
export function Composer({ t, selected, sendInstruction }: ComposerProps) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const disabled = selected === undefined || draft.trim() === '' || busy

  async function submit(): Promise<void> {
    /* v8 ignore next -- the disabled button cannot fire the handler, so the
     * guard only protects the async re-entry path the UI never reaches. */
    if (disabled) return
    const text = draft.trim()
    setBusy(true)
    setError(null)
    try {
      await sendInstruction(text)
      setDraft('')
    } catch {
      setError(t('composerError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={css.composer}>
      <div className={css.composerRow}>
        <input
          type="text"
          className={css.composerInput}
          placeholder={selected === undefined ? t('composerDisabled') : t('composerPlaceholder')}
          value={draft}
          disabled={selected === undefined}
          aria-disabled={selected === undefined}
          onChange={(event) => { setDraft(event.target.value) }}
        />
        <button
          type="button"
          className={css.sendButton}
          disabled={disabled}
          aria-disabled={disabled}
          onClick={() => { void submit() }}
        >
          {busy ? t('stop') : t('send')}
        </button>
      </div>
      {error !== null && <div className={css.composerError} role="alert">{error}</div>}
    </div>
  )
}

/** The timeline card: toolbar, list, and composer. */
export function TimelineCard(props: TimelineCardProps) {
  const { t, timeline, timelineMode, scope, selected, setTimelineMode, clearScope, sendInstruction, collapsed, onToggleCollapse } = props
  const byMode = timelineMode === 'all'
    ? timeline
    : timeline.filter(entry => entry.kind === 'status')
  return (
    <div className={clsx(css.card, collapsed && css.cardCollapsed)}>
      <CardHeader
        t={t}
        title={t('timeline')}
        collapsed={collapsed}
        onToggleCollapse={onToggleCollapse}
        actions={(
          <>
            <div className={css.timelineScope}>
              {scope !== undefined && (
                <button type="button" className={css.timelineScopePill} onClick={clearScope}>
                  {t('timelineScopeAll')}
                </button>
              )}
            </div>
            <div className={css.timelineMode} role="group" aria-label={t('timelineModeAria')}>
              <button
                type="button"
                className={clsx(css.modeButton, timelineMode === 'brief' && css.modeButtonActive)}
                aria-pressed={timelineMode === 'brief'}
                onClick={() => { setTimelineMode('brief') }}
              >
                {t('timelineStatus')}
              </button>
              <button
                type="button"
                className={clsx(css.modeButton, timelineMode === 'all' && css.modeButtonActive)}
                aria-pressed={timelineMode === 'all'}
                onClick={() => { setTimelineMode('all') }}
              >
                {t('timelineActivity')}
              </button>
            </div>
          </>
        )}
      />
      {!collapsed && (
        <>
          <div className={css.timeline}>
            <TimelineList t={t} timeline={byMode} scope={scope} detailOf={() => undefined} />
          </div>
          <Composer t={t} selected={selected} sendInstruction={sendInstruction} />
        </>
      )}
    </div>
  )
}
