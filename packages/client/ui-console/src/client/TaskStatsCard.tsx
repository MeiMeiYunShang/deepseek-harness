/** Task-statistics card: a scope line plus counted run/turn/step/timing blocks. */

import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the sessionStats projection-key merge into SessionProjectionMap.
import type {} from '@deepseek-ai/dsh-session-stats/types'
import type { ConsoleKey } from './locales.ts'
import { formatDuration } from './format.ts'
import css from './console.module.css'

/** One counted block: a leading status bar, the figure, and a label. */
function StatItem({ tone, label, children }: {
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

/** Sum whole-log turn/step counts and wall times across the scoped summaries. */
export function aggregateSessionStats(
  summaries: Readonly<Record<string, SessionSummary>>,
  scope: string | undefined,
): { turns: number; steps: number; llmMs: number; toolMs: number } {
  const acc = { turns: 0, steps: 0, llmMs: 0, toolMs: 0 }
  for (const [id, summary] of Object.entries(summaries)) {
    if (scope !== undefined && id !== scope) continue
    const stats = summary.projectionValues?.sessionStats
    if (stats === undefined) continue
    acc.turns += stats.turns
    acc.steps += stats.steps
    acc.llmMs += stats.llmMs
    acc.toolMs += stats.toolMs
  }
  return acc
}

/** Props for the task-stats card. */
export interface TaskStatsCardProps {
  /** Translator. */
  t: (key: ConsoleKey) => string
  /** Live session rows. */
  byId: Record<string, SessionSummary>
  /** Scope: the selected session id, or undefined for the whole list. */
  scope: string | undefined
  /** Resolve a session's display title for the scope line. */
  titleOf: (id: string) => string | undefined
}

/** Task-statistics card over the scoped rows. */
export function TaskStatsCard({ t, byId, scope, titleOf }: TaskStatsCardProps) {
  const scopeLabel = scope === undefined
    ? t('taskAllSessions')
    : titleOf(scope) ?? t('taskAllSessions')
  const running = scope === undefined
    ? Object.values(byId).filter(summary => summary.running).length
    : (byId[scope]?.running === true ? 1 : 0)
  const stats = aggregateSessionStats(byId, scope)
  return (
    <div className={css.card}>
      <h3 className={css.cardTitle}>{t('taskStats')}</h3>
      <span className={css.taskScope}>{t('taskScope')}: {scopeLabel}</span>
      <div className={css.taskStats}>
        <StatItem tone="Running" label={t('taskRunning')}>{String(running)}</StatItem>
        <StatItem tone="Current" label={t('taskTurns')}>{String(stats.turns)}</StatItem>
        <StatItem tone="Running" label={t('taskSteps')}>{String(stats.steps)}</StatItem>
        <StatItem tone="Waiting" label={t('taskLlmMs')}>{formatDuration(stats.llmMs)}</StatItem>
        <StatItem tone="Pending" label={t('taskToolMs')}>{formatDuration(stats.toolMs)}</StatItem>
      </div>
    </div>
  )
}
