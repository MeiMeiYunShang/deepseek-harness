/**
 * Function plugin registering the `sessionStats` projection unit: whole-log
 * turn/step counts and LLM/tool/first-token/decode wall times served through
 * the session-projection seam (registry snapshot, change feed, and every
 * projection carrier), so clients render full-session figures that paging and
 * compaction cannot change. The plugin owns only the fold; delivery is the
 * seam's.
 *
 * The plugin also owns the one thing the fold cannot reach: the off-peak
 * window that splits each route's tokens into price bands. A projection unit's
 * `init`/`apply` receive only state and the next event, so the window is read
 * here, where `ctx.settings` is reachable, and closed over the registered unit.
 *
 * @module @deepseek-ai/dsh-session-stats
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { CONSOLE_PRICING_NAMESPACE, offPeakWindowOf, sessionStatsStateVersion } from './off-peak.ts'
import { sessionStatsProjectionDefinition } from './projection.ts'

export type * from './types.ts'

/** Cordis plugin name. */
export const name = 'session-stats'
/** The projection registry is the plugin's whole purpose; without it the fiber stays pending. */
export const inject = ['sessionProjections']

/**
 * Register the `sessionStats` unit for the off-peak window currently in
 * effect, replacing the previous registration when that window changed.
 *
 * The window's owner is a different plugin (dsh-console-bridge registers the
 * `console-pricing` namespace), and the Loader activates rows of one
 * composition concurrently, so this plugin may well mount before that
 * namespace exists. Every install therefore re-reads the section, and two
 * triggers re-run it: a new session, which detects a namespace that appeared
 * after this plugin mounted, and a settings commit on the namespace, which
 * carries an operator's edit. Re-registering is what makes a changed window
 * take effect: the registry drops the previous unit's cells, so live sessions
 * refold under the new window, and the new unit's window-derived
 * `stateVersion` makes every cached row folded under the old window unusable.
 * @param ctx - registrant context carrying the projection registry.
 */
export function apply(ctx: Context): void {
  let installedVersion: number | undefined
  let unregister: (() => void) | undefined
  const install = (): void => {
    const window = offPeakWindowOf(ctx.get('settings')?.get(CONSOLE_PRICING_NAMESPACE))
    const version = sessionStatsStateVersion(window)
    if (version === installedVersion) return
    unregister?.()
    installedVersion = version
    unregister = ctx.sessionProjections.register(sessionStatsProjectionDefinition(window))
  }
  install()
  ctx.on('session/created', install)
  ctx.on('settings/updated', (ns) => {
    if (ns === CONSOLE_PRICING_NAMESPACE) install()
  })
}
