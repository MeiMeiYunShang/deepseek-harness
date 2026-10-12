/**
 * Console workbench extension slots — the seats through which a plugin
 * distributed outside this repository adds UI to the task-statistics card
 * without editing it.
 *
 * `console.task-stats.action` is that card's header action area. A registrant
 * receives the route buckets the card aggregated for its scope and the price
 * table the card charged them with, which is enough to offer a correction to a
 * figure the card could not bill. The card holds no pricing meaning beyond the
 * two shares it hands down.
 *
 * TYPE HOME RATIONALE: the console's sidebar-footer entry declares and renders
 * this slot, and a plugin registering an extension already depends on this
 * package for the declaration. The types therefore live with their declarer.
 */

import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelPrice } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionStatsRoute } from '@deepseek-ai/dsh-session-stats/types'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Action area beside the task-statistics card's fold toggle, rendered while
     * the card renders. Without a registrant the area renders nothing.
     */
    'console.task-stats.action': { kind: 'list'; scope: 'root'; owner: TaskStatsActionOwnerProps }
  }
}

/** Owner share of one task-statistics action. */
export interface TaskStatsActionOwnerProps {
  /** The route buckets the card's scope reported, merged across its sessions. */
  routes: readonly SessionStatsRoute[]
  /** The operator's price table the card charged; an empty table leaves every route unpriced. */
  prices: readonly ModelPrice[]
}

/** The child-slot dispatch seat the renderer binds for the console entry. */
export type ConsoleRenderSlot = PropsRenderSlots<'console.task-stats.action'>['renderSlot']
