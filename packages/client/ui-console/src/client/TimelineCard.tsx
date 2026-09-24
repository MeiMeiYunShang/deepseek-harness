/**
 * Timeline card: a toolbar (the scope label + brief/all toggle), the event list
 * with collapsible details, and the bottom instruction composer.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { formatAmount, totalCost, type CostTotal, type ModelPrice } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TimelineEntry, TimelineMode } from './consoleStore.ts'
import { replyTokenTotal, type TimelineMessage } from './timelineMessages.ts'
import type { ConsoleKey } from './locales.ts'
import { FOLD_LIMIT, foldText, shortId, timelineLabelKey } from './timelineText.ts'
import { formatTime, formatTokens } from './format.ts'
import { CardHeader } from './CardHeader.tsx'
import css from './console.module.css'

/** One page of timeline rows; older events need another click. */
const TIMELINE_PAGE = 40

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
  t: (key: ConsoleKey, params?: Record<string, unknown>) => string
  /** Unfiltered timeline entries. */
  timeline: readonly TimelineEntry[]
  /** Selected verbosity. */
  timelineMode: TimelineMode
  /**
   * The console's selected session: the card renders its conversation and the
   * composer sends to it, while `undefined` lists every session's coarse rows
   * and leaves the composer disabled.
   */
  selectedSession: string | undefined
  /**
   * The selected session's conversation, in log order. The apply closure owns
   * the subscription behind it, so the card only renders what it is handed.
   */
  messages: readonly TimelineMessage[]
  /** The operator's model price table, for a reply's turn cost. */
  prices: readonly ModelPrice[]
  /** Resolve a session's display title for the scope label. */
  titleOf: (id: string) => string | undefined
  /** Set the verbosity. */
  setTimelineMode: (mode: TimelineMode) => void
  /** Send one instruction over the composer. */
  sendInstruction: (text: string) => Promise<unknown>
}

/** Dot tone for a timeline entry kind. */
export function rowTone(kind: string): RowTone {
  if (kind === 'status') return 'action'
  if (kind === 'history') return 'neutral'
  return 'info'
}

/** Props for the timeline list body. */
export interface TimelineListProps {
  t: (key: ConsoleKey, params?: Record<string, unknown>) => string
  timeline: readonly TimelineEntry[]
  detailOf: (entry: TimelineEntry) => TimelineDetail | undefined
}

/** The cross-session event list with per-row folding, a newest-first page window, and optional ask-card detail. */
export function TimelineList({ t, timeline, detailOf }: TimelineListProps) {
  const [expandedSeq, setExpandedSeq] = useState<number | null>(null)
  const [visible, setVisible] = useState(TIMELINE_PAGE)
  if (timeline.length === 0) return <span className={css.emptyHint}>{t('timelineEmpty')}</span>
  // Newest first, but only one page in the DOM: the store keeps a 200-entry
  // window, and rendering all of it costs a row per event on every push.
  const reversed = [...timeline].reverse()
  const shown = reversed.slice(0, visible)
  const hidden = reversed.length - shown.length
  return (
    <>
      {shown.map((entry, index) => {
        const label = t(timelineLabelKey(entry.kind))
        const detail = detailOf(entry)
        const header = `${t('sessionPrefix')} ${shortId(entry.sessionId)} ${label}`
        // The collapsed line stays the session header; a row that carries a
        // title — the backfilled history row — reveals it on expansion.
        const fullText = entry.title === undefined ? header : `${header} · ${entry.title}`
        const isExpanded = expandedSeq === entry.id
        const text = isExpanded ? fullText : foldText(header, FOLD_LIMIT)
        const folding = header.length > FOLD_LIMIT
        const showToggle = folding || entry.title !== undefined || detail !== undefined
        return (
          <TimelineRow
            key={entry.id}
            time={formatTime(entry.time)}
            tone={rowTone(entry.kind)}
            last={index === shown.length - 1 && hidden === 0}
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
      {hidden > 0 && (
        <button
          type="button"
          className={css.timelineMore}
          onClick={() => { setVisible(count => count + TIMELINE_PAGE) }}
        >
          {t('timelineMore', { count: String(hidden) })}
        </button>
      )}
    </>
  )
}

/** Props for the scoped conversation stream. */
export interface MessageStreamProps {
  t: (key: ConsoleKey, params?: Record<string, unknown>) => string
  /** The selected session's conversation, in log order. */
  messages: readonly TimelineMessage[]
  /** The operator's model price table, for a reply's turn cost; an empty table leaves every route unpriced. */
  prices: readonly ModelPrice[]
}

/** The charge text for one priced turn, or the reason the table could not price it. */
function costText(cost: CostTotal, t: (key: ConsoleKey, params?: Record<string, unknown>) => string): string {
  if (cost.ambiguous.length > 0) return t('taskCostAmbiguous')
  if (cost.unpriced.length > 0) return t('taskCostUnpriced')
  return t('timelineCost', { amount: formatAmount(cost.amount) })
}

/**
 * The reply's own token total and, on the reply that closes its turn, that
 * turn's charge. A reply the event carried no usage for renders no usage chip,
 * and a turn whose buckets the projection never reported renders no cost chip:
 * an absent figure is not a zero.
 */
function MessageFigures({ message, prices, t }: {
  message: TimelineMessage
  prices: readonly ModelPrice[]
  t: (key: ConsoleKey, params?: Record<string, unknown>) => string
}) {
  const { usage, turnCost } = message
  return (
    <>
      {usage !== undefined && (
        <span className={css.messageMetaChip}>
          {t('timelineUsage', { count: t('timelineTokens', { count: formatTokens(replyTokenTotal(usage)) }) })}
        </span>
      )}
      {turnCost !== undefined && (
        <span className={css.messageMetaChip}>{costText(totalCost(prices, turnCost), t)}</span>
      )}
    </>
  )
}

/**
 * The scoped session's conversation: a right-aligned bubble per operator
 * message and left-aligned text per assistant reply, with the reply's own
 * timestamp and the figures that reply can source — its own token counts from
 * the `assistant/message` event, and the charge of the turn it closes.
 */
export function MessageStream({ t, messages, prices }: MessageStreamProps) {
  if (messages.length === 0) return <span className={css.emptyHint}>{t('timelineNoMessages')}</span>
  return (
    <div className={css.messageStream}>
      {messages.map(message => message.role === 'user'
        ? (
          <div key={message.key} className={css.messageUser} data-role="user">
            <p className={css.messageUserBubble}>{message.text}</p>
          </div>
        )
        : (
          <div key={message.key} className={css.messageAssistant} data-role="assistant">
            <p className={css.messageAssistantText}>{message.text}</p>
            <span className={css.messageMeta}>
              {formatTime(message.time)}
              <MessageFigures message={message} prices={prices} t={t} />
            </span>
          </div>
        ))}
    </div>
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
  t: (key: ConsoleKey, params?: Record<string, unknown>) => string
  /** The console's selected session, i.e. the instruction target; `undefined` disables the composer. */
  selectedSession: string | undefined
  sendInstruction: (text: string) => Promise<unknown>
}

/** Instruction composer: a disabled-aware input plus a send action. */
export function Composer({ t, selectedSession, sendInstruction }: ComposerProps) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const disabled = selectedSession === undefined || draft.trim() === '' || busy

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
          placeholder={selectedSession === undefined ? t('composerDisabled') : t('composerPlaceholder')}
          value={draft}
          disabled={selectedSession === undefined}
          aria-disabled={selectedSession === undefined}
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

/** The timeline card: toolbar, list, and composer. It is the middle column's
 * only card, so folding it would leave an empty column rather than free room;
 * it renders no fold control and is always expanded. */
export function TimelineCard(props: TimelineCardProps) {
  const { t, timeline, timelineMode, selectedSession, messages, prices, titleOf, setTimelineMode, sendInstruction } = props
  const scoped = selectedSession !== undefined
  const byMode = timelineMode === 'all'
    ? timeline
    : timeline.filter(entry => entry.kind === 'status')
  return (
    <div className={css.card}>
      <CardHeader
        t={t}
        title={t('timeline')}
        /* The scope the stream below belongs to, named where it is read.
           Clearing it is the session card header's single all-sessions pill. */
        afterTitle={scoped && (
          <span className={css.timelineScopeLabel}>
            {t('timelineScopeLabel')}: {titleOf(selectedSession) ?? shortId(selectedSession)}
          </span>
        )}
        /* The verbosity toggle filters the coarse rows, which only the unscoped
           view renders; a scoped card shows the conversation itself. */
        actions={!scoped && (
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
        )}
      />
      <div className={css.timeline}>
        {scoped
          ? <MessageStream t={t} messages={messages} prices={prices} />
          : <TimelineList t={t} timeline={byMode} detailOf={() => undefined} />}
      </div>
      <Composer t={t} selectedSession={selectedSession} sendInstruction={sendInstruction} />
    </div>
  )
}
