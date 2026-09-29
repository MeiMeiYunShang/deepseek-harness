// Cost of one completed Turn in the assistant action row: the operator's
// price table applied to that Turn's own provider-reported tokens.
//
// The buckets come from the `sessionStats` projection, which decided each
// reporting event's price band from that event's own time against the
// operator's off-peak window; this component never re-derives a band, never
// reconstructs a cache-miss count by subtracting, and never prices a turn
// against another turn's or the session's tokens.

import { useMemo } from 'react'
import { formatAmount, totalCost, type ModelPrice, type RouteTokens } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: merges the sessionStats key into SessionProjectionMap for useProjection.
import type {} from '@deepseek-ai/dsh-session-stats/client'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import css from './TurnCostFigure.module.css'

export interface TurnCostFigureProps {
  /** Turn whose own route buckets this figure prices. */
  turn: number
  /** The operator's model price table; an empty table leaves every route unpriced. */
  prices: readonly ModelPrice[]
  /** Session projection read seat, threaded down from the owning view. */
  useProjection: UseProjection
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

/**
 * Turn-cost figure for the assistant action row.
 *
 * A Turn whose tokens the projection never attributed to a route shows nothing:
 * an unpriceable charge is not a zero charge, and a guessed route would bill
 * the operator for tokens another model served. A route the operator's table
 * cannot price at all — or prices twice over — names that reason instead of
 * showing a figure that silently omits those tokens, the same treatment the
 * console cost item uses.
 * @param props - Turn identity, operator price table, projection seat, locale seat.
 * @returns The charge, its reason, or null when the Turn has no priced buckets.
 */
export function TurnCostFigure({ turn, prices, useProjection, t }: TurnCostFigureProps) {
  // Selected by reference: the projection republishes the bucket array only
  // when a step accrues, so an unrelated state change leaves this row alone.
  const turnRoutes = useProjection('sessionStats', value => value?.turnRoutes)
  const routes = useMemo<readonly RouteTokens[]>(
    () => turnRoutes?.filter(bucket => bucket.turn === turn) ?? [],
    [turnRoutes, turn],
  )
  if (routes.length === 0) return null
  const cost = totalCost(prices, routes)
  const text = cost.ambiguous.length > 0
    ? t('message.turnCost.ambiguous')
    : cost.unpriced.length > 0
      ? t('message.turnCost.unpriced')
      : t('message.turnCost.amount', { amount: formatAmount(cost.amount) })
  return <span className={css.figure}>{text}</span>
}
