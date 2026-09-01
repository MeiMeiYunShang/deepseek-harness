import { useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionProjectionMap } from '@deepseek-ai/dsh-session-projection/types'
// Type-only: pulls the sessionStats projection-key merge into SessionProjectionMap.
import type {} from '@deepseek-ai/dsh-session-stats/types'
// Type-only: pulls the sidebar SlotMap merge (the 'sidebar.footer.action' entry)
// and the ui-session GlobalStandardProps merge (useSessions).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { ChatFetcher } from './SmartQA.tsx'
import { SmartQA } from './SmartQA.tsx'
import { NS, type ConsoleKey } from './locales.ts'
import type { ConsoleStoreState, TimelineMode } from './consoleStore.ts'
import { timelineLabelKey, timelineTone, shortId } from './timelineText.ts'
import css from './console.module.css'

/** Selected model identity for the Smart Q&A panel. */
export interface ConsoleQaModel {
  /** Provider route id. */
  provider: string
  /** Model id. */
  model: string
}

/** Full props for the console button action. */
export type ConsoleButtonProps =
  PropsRuntime<'sidebar.footer.action'> & PropsLocale<typeof NS> & {
    /** Timeline + system-status store feed (live forwarded frames). */
    useConsole: SnapshotSelectorHook<ConsoleStoreState>
    /** Streams Smart Q&A completions over the `chat` Remote. */
    chat: ChatFetcher
    /** Default Smart Q&A model, or null when none is resolvable. */
    defaultModel: ConsoleQaModel | null
    /** Selects the timeline verbosity. */
    setTimelineMode: (mode: TimelineMode) => void
  }

/** Zeroed whole-log stats; every field folds from the completed projections. */
const ZERO_STATS: SessionProjectionMap['sessionStats'] = {
  turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0,
}

/** Sum whole-log turn/step counts and wall times across every session summary. */
function aggregateSessionStats(summaries: Readonly<Record<string, SessionSummary>>): SessionProjectionMap['sessionStats'] {
  const acc: SessionProjectionMap['sessionStats'] = { ...ZERO_STATS }
  for (const summary of Object.values(summaries)) {
    const stats = summary.projectionValues?.sessionStats
    if (stats === undefined) continue
    acc.turns += stats.turns
    acc.steps += stats.steps
    acc.llmMs += stats.llmMs
    acc.toolMs += stats.toolMs
  }
  return acc
}

/** Format a millisecond wall time as a compact human duration. */
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const totalSeconds = ms / 1000
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.round(totalSeconds % 60)
  return `${minutes}m${seconds.toString().padStart(2, '0')}s`
}

/** Format epoch milliseconds as HH:MM:SS. */
function formatTime(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** Map a metric value to a severity band; null means no data. */
function toneOf(value: number | null): 'na' | 'ok' | 'warn' | 'critical' {
  if (value === null) return 'na'
  if (value >= 85) return 'critical'
  if (value >= 60) return 'warn'
  return 'ok'
}

/** Accent color per severity band, as a CSS variable reference. */
const RING_COLOR: Record<'na' | 'ok' | 'warn' | 'critical', string> = {
  na: 'var(--dsw-alias-text-secondary)',
  ok: 'var(--dsw-alias-state-success-primary)',
  warn: 'var(--dsw-alias-state-warn-primary)',
  critical: 'var(--dsw-alias-state-error-primary)',
}

/** One system-metric gauge: an SVG ring with the value centered inside. */
function RingGauge({ label, naLabel, value }: { label: string; naLabel: string; value: number | null }) {
  const size = 56
  const stroke = 6
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const ratio = value === null ? 0 : Math.max(0, Math.min(100, value)) / 100
  const dash = `${ratio * circumference} ${circumference}`
  const color = RING_COLOR[toneOf(value)]
  return (
    <div className={css.ringItem}>
      <div className={css.ring}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`${label} ${value === null ? naLabel : `${value}%`}`}
        >
          <circle className={css.ringTrack} cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none" />
          <circle
            className={css.ringValue}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={dash}
            stroke={color}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <span className={css.ringText}>{value === null ? naLabel : `${value}%`}</span>
      </div>
      <span className={css.ringLabel}>{label}</span>
    </div>
  )
}

/** One timeline row: a tinted dot, the event label, and the timestamp. */
function TimelineRow({ entry, label, kind, time, t }: {
  entry: { sessionId: string }
  label: 'timelineActivity' | 'timelineStatus'
  kind: string
  time: string
  t: (key: ConsoleKey) => string
}): ReactNode {
  return (
    <div className={css.timelineItem}>
      <div className={clsx(css.timelineDot, css[`t-${timelineTone(kind)}`])} />
      <div className={css.timelineLine} />
      <div className={css.timelineMain}>
        <span className={css.timelineText}>{`${t('sessionPrefix')}${shortId(entry.sessionId)} ${t(label)}`}</span>
        <span className={css.timelineTime}>{time}</span>
      </div>
    </div>
  )
}

/**
 * Console button: a sidebar-footer trigger that opens a fullscreen console
 * modal with session status, task stats, system metrics, pending interactions,
 * and Smart Q&A.
 * @param props - runtime slot currency plus the injected store/chat faces.
 * @returns the trigger button and its modal overlay.
 */
export function ConsoleButton({
  t,
  useSessions,
  useSessionPendingInteraction,
  useConsole,
  chat,
  defaultModel,
  setTimelineMode,
}: ConsoleButtonProps) {
  const [open, setOpen] = useState(false)

  const byId = useSessions(value => value.byId)
  const pendingMap = useSessionPendingInteraction(value => value)
  const timeline = useConsole(value => value.timeline)
  const timelineMode = useConsole(value => value.timelineMode)
  const systemStatus = useConsole(value => value.systemStatus)

  const sessions = Object.values(byId)
  const running = sessions.filter(session => session.running).length
  const completed = sessions.filter(session => session.completed === true).length
  const stats = aggregateSessionStats(byId)

  const pendingRows = [...pendingMap.entries()]
    .map(([sessionId, interaction]) => ({ sessionId, kind: interaction.kind }))
    .filter(row => row.kind === 'question' || row.kind === 'plan-review')

  const visibleTimeline = timelineMode === 'all' ? timeline : timeline.filter(entry => entry.kind === 'status')

  return (
    <>
      <button
        type="button"
        className={css.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('trigger')}
        onClick={() => { setOpen(true) }}
      >
        <span className={css.triggerLabel}>{t('trigger')}</span>
      </button>
      {open && (
        <Modal
          open
          title={t('title')}
          closeLabel={t('close')}
          onClose={() => { setOpen(false) }}
        >
          <div className={css.consoleContent}>
            <div className={css.columns}>
              <div className={css.column}>
                <div className={css.card}>
                  <h3 className={css.cardTitle}>{t('sessionStatus')}</h3>
                  <div className={css.sessionCounts}>
                    <span className={css.countItem}>{t('sessionTotal')} <b>{sessions.length}</b></span>
                    <span className={css.countItem}>{t('sessionRunning')} <b>{running}</b></span>
                    <span className={css.countItem}>{t('sessionPending')} <b>{pendingRows.length}</b></span>
                    <span className={css.countItem}>{t('sessionCompleted')} <b>{completed}</b></span>
                  </div>
                </div>
                <div className={css.card}>
                  <h3 className={css.cardTitle}>{t('taskStats')}</h3>
                  <div className={css.sessionCounts}>
                    <span className={css.countItem}>{t('taskTurns')} <b>{stats.turns}</b></span>
                    <span className={css.countItem}>{t('taskSteps')} <b>{stats.steps}</b></span>
                    <span className={css.countItem}>{t('taskLlmMs')} <b>{formatDuration(stats.llmMs)}</b></span>
                    <span className={css.countItem}>{t('taskToolMs')} <b>{formatDuration(stats.toolMs)}</b></span>
                  </div>
                </div>
                <div className={css.card}>
                  <h3 className={css.cardTitle}>{t('systemStatus')}</h3>
                  <div className={css.systemStatus}>
                    <RingGauge label={t('cpu')} naLabel={t('na')} value={systemStatus === null ? null : Math.round(systemStatus.cpu)} />
                    <RingGauge label={t('ram')} naLabel={t('na')} value={systemStatus === null ? null : Math.round(systemStatus.memory)} />
                    <RingGauge label={t('gpu')} naLabel={t('na')} value={systemStatus?.gpu == null ? null : Math.round(systemStatus.gpu)} />
                  </div>
                </div>
                <div className={css.card}>
                  <h3 className={css.cardTitle}>{t('pendingInteractions')}</h3>
                  {pendingRows.length === 0
                    ? <span className={css.emptyHint}>{t('noPending')}</span>
                    : (
                      <ul className={css.pendingList}>
                        {pendingRows.map(row => (
                          <li key={row.sessionId} className={css.pendingItem}>
                            <span className={css.pendingText}>{t('pageSelection')} {shortId(row.sessionId)}</span>
                            <span className={clsx(css.pendingKind, row.kind === 'plan-review' && css.pendingKindPlan)}>
                              {row.kind === 'plan-review' ? t('pendingPlanReview') : t('pendingQuestion')}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                </div>
              </div>
              <div className={css.column}>
                <div className={css.card}>
                  <div className={css.timelineToolbar}>
                    <h3 className={css.cardTitle}>{t('timeline')}</h3>
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
                  </div>
                  <div className={css.timeline}>
                    {visibleTimeline.length === 0
                      ? <span className={css.emptyHint}>{t('timelineEmpty')}</span>
                      : [...visibleTimeline].reverse().map(entry => (
                        <TimelineRow
                          key={entry.id}
                          entry={entry}
                          label={timelineLabelKey(entry.kind)}
                          kind={entry.kind}
                          time={formatTime(entry.time)}
                          t={t}
                        />
                      ))}
                  </div>
                </div>
                <div className={`${css.card} ${css.smartQACard}`}>
                  <h3 className={css.cardTitle}>{t('smartQA')}</h3>
                  <SmartQA t={t} chat={chat} model={defaultModel} />
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

export default ConsoleButton
