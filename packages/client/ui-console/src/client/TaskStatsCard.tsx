/** Task-statistics card: a scope line plus counted run/turn/step/timing blocks. */

import type { ReactNode } from 'react'
import clsx from 'clsx'
import { formatAmount, totalCost, type ModelPrice } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatsBandTokens, SessionStatsRoute } from '@deepseek-ai/dsh-session-stats/types'
// Type-only: pulls the sessionStats projection-key merge into SessionProjectionMap.
import type {} from '@deepseek-ai/dsh-session-stats/types'
import type { ConsoleKey } from './locales.ts'
import { formatDuration } from './format.ts'
import { CardHeader } from './CardHeader.tsx'
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

/**
 * Add one reported band's four counts into an accumulating band.
 * @param target - the band being accumulated.
 * @param source - the band to add into it.
 */
function addBand(target: SessionStatsBandTokens, source: SessionStatsBandTokens): void {
  target.inputTokens += source.inputTokens
  target.outputTokens += source.outputTokens
  target.cacheReadTokens += source.cacheReadTokens
  target.cacheWriteTokens += source.cacheWriteTokens
}

/** Sum whole-log turn/step counts, wall times, and per-route tokens across the scoped summaries. */
export function aggregateSessionStats(
  summaries: Readonly<Record<string, SessionSummary>>,
  scope: string | undefined,
): { turns: number; steps: number; llmMs: number; toolMs: number; routes: SessionStatsRoute[] } {
  const acc = { turns: 0, steps: 0, llmMs: 0, toolMs: 0, routes: [] as SessionStatsRoute[] }
  // One bucket per route across every scoped session: two sessions on the same
  // model bill as that model, not as two entries.
  const byRoute = new Map<string, SessionStatsRoute>()
  for (const [id, summary] of Object.entries(summaries)) {
    if (scope !== undefined && id !== scope) continue
    const stats = summary.projectionValues?.sessionStats
    if (stats === undefined) continue
    acc.turns += stats.turns
    acc.steps += stats.steps
    acc.llmMs += stats.llmMs
    acc.toolMs += stats.toolMs
    // A host that predates the route buckets — or a persisted projection row
    // still at the older state version — streams a value without `routes`.
    // This is the wire/durable boundary, so the absence is read as "no buckets"
    // rather than crashing the card.
    // oxlint-disable-next-line no-unnecessary-condition
    for (const route of stats.routes ?? []) {
      const key = `${route.provider}\u0000${route.model}`
      const seen = byRoute.get(key)
      if (seen === undefined) {
        // Both bands are copied rather than aliased: every count is added into
        // the accumulator's own bands, and the reported ones are live data.
        byRoute.set(key, {
          provider: route.provider,
          model: route.model,
          peak: { ...route.peak },
          offPeak: { ...route.offPeak },
        })
        continue
      }
      addBand(seen.peak, route.peak)
      addBand(seen.offPeak, route.offPeak)
    }
  }
  acc.routes = [...byRoute.values()]
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
  /** The operator's model price table; an empty table leaves every route unpriced. */
  prices: readonly ModelPrice[]
  /** Whether the card body is collapsed. */
  collapsed: boolean
  /** Toggle the collapsed state. */
  onToggleCollapse: () => void
}

/** Task-statistics card over the scoped rows. */
export function TaskStatsCard({ t, byId, scope, titleOf, prices, collapsed, onToggleCollapse }: TaskStatsCardProps) {
  const scopeLabel = scope === undefined
    ? t('taskAllSessions')
    : titleOf(scope) ?? t('taskAllSessions')
  const running = scope === undefined
    ? Object.values(byId).filter(summary => summary.running).length
    : (byId[scope]?.running === true ? 1 : 0)
  const stats = aggregateSessionStats(byId, scope)
  // Cost is priced from the scoped routes alone: aggregateSessionStats skips
  // every session outside the scope and accumulates only its own buckets, so a
  // scoped figure is that session's charge, not a share of a shared table.
  const cost = totalCost(prices, stats.routes)
  // A bucket carries no endpoint, so a route the table cannot price at all — or
  // prices twice over — leaves the whole figure untrustworthy. The item then
  // names the reason instead of showing a number that omits those routes.
  const costNote = cost.ambiguous.length === 0 && cost.unpriced.length === 0
    ? undefined
    : cost.ambiguous.length > 0 ? t('taskCostAmbiguous') : t('taskCostUnpriced')
  return (
    <div className={clsx(css.card, css.cardAuto, collapsed && css.cardCollapsed)}>
      <CardHeader t={t} title={t('taskStats')} collapsed={collapsed} onToggleCollapse={onToggleCollapse} />
      {!collapsed && (
        <>
          <span className={css.taskScope}>{t('taskScope')}: {scopeLabel}</span>
          <div className={css.taskStats}>
            <StatItem tone="Running" label={t('taskRunning')}>{String(running)}</StatItem>
            <StatItem tone="Current" label={t('taskTurns')}>{String(stats.turns)}</StatItem>
            <StatItem tone="Running" label={t('taskSteps')}>{String(stats.steps)}</StatItem>
            <StatItem tone="Waiting" label={t('taskLlmMs')}>{formatDuration(stats.llmMs)}</StatItem>
            <StatItem tone="Pending" label={t('taskToolMs')}>{formatDuration(stats.toolMs)}</StatItem>
            <StatItem tone={costNote === undefined ? 'Running' : 'Waiting'} label={t('taskCost')}>
              {costNote ?? formatAmount(cost.amount)}
            </StatItem>
          </div>
        </>
      )}
    </div>
  )
}
