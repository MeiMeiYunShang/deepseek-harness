/**
 * Operator price table adopted from the `console-pricing` settings namespace,
 * shared by the console Task-statistics cost figure and the Chat Turn cost
 * figure.
 *
 * The table's owner is the `console-pricing` settings namespace, registered by
 * `dsh-console-bridge`; the namespace and its field are spelled locally, as
 * every cross-package setting these readers use is, because a client bundle
 * reaches another package through services, never through their values.
 *
 * `settingsScope.bind` starts the shared settings mirror's read and returns
 * before it settles, so the first snapshot after `bind` carries no value
 * (`ui-settings` publishes the section once `remote.settings.describe`
 * answers). The table is adopted from every accepted section instead of read
 * once: a one-shot read at bind time leaves every route unpriced for the life
 * of the page, whatever the operator recorded.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ModelPrice } from './pricing.ts'

/** The `console-pricing` settings namespace holding the operator's table. */
export const CONSOLE_PRICING_NAMESPACE = 'console-pricing'

/** The pricing namespace's fields these readers read. */
interface ConsolePricingSetting {
  /** The operator's recorded price table; absent until the first save. */
  models?: ModelPrice[]
}

/** The table an operator who recorded none has. */
const NO_PRICES: readonly ModelPrice[] = []

/** Live operator price table consumed by every client cost figure. */
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
