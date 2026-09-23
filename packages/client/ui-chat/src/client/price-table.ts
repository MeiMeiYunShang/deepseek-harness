/**
 * Operator price table for the Turn cost figure.
 *
 * The table's owner is the `console-pricing` settings namespace, registered by
 * `dsh-console-bridge`; the field is spelled locally (like ui-console does),
 * because a client bundle reaches other packages through services, never
 * through their values. The namespace arrives asynchronously, so the table is
 * adopted on every accepted section rather than read once: the first snapshot
 * after `bind` carries no value, and a one-shot read would leave every Turn
 * unpriced for the life of the page.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelPrice } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'

/** The `console-pricing` settings namespace holding the operator's table. */
export const CONSOLE_PRICING_NAMESPACE = 'console-pricing'

/** The pricing namespace's fields this plugin reads. */
interface ConsolePricingSetting {
  /** The operator's recorded price table; absent until the first save. */
  models?: ModelPrice[]
}

/** The table an operator who recorded none has. */
const NO_PRICES: readonly ModelPrice[] = []

/** Live operator price table consumed by the Chat Turn cost figure. */
export class PriceTablePolicy {
  /** Reactive current table; empty until the Host serves a section. */
  readonly prices: SnapshotStore<readonly ModelPrice[]> = createSnapshotStore<readonly ModelPrice[]>(NO_PRICES)

  /** @param host - the `console-pricing` settings scope. */
  constructor(private readonly host: SettingsScope<ConsolePricingSetting>) {
    host.subscribe(() => { this.adopt() })
    this.adopt()
  }

  /**
   * Adopt the latest accepted section. Before the first one the empty table
   * stands, and a section that records no table replaces the previous one with
   * the empty table: an operator who cleared the prices is not still charged
   * the ones they removed.
   */
  private adopt(): void {
    const section = this.host.getSnapshot().value
    if (section === undefined) return
    const models = section.models ?? NO_PRICES
    if (this.prices.getSnapshot() === models) return
    this.prices.set(models)
  }
}
