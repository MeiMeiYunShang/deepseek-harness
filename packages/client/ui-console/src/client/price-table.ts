/**
 * Operator price table for the console Task-statistics cost figure.
 *
 * The table's owner is the `console-pricing` settings namespace, registered by
 * `dsh-console-bridge`; the namespace and its field are spelled locally, as
 * every cross-package setting the console reads is, because a client bundle
 * reaches another package through services, never through its values.
 *
 * `settingsScope.bind` starts the shared settings mirror's read and returns
 * before it settles, so the first snapshot after `bind` carries no value
 * (`ui-settings` publishes the section once `remote.settings.describe`
 * answers). The table is adopted from every accepted section instead of read
 * once: a one-shot read at bind time leaves every route unpriced for the life
 * of the page, whatever the operator recorded.
 *
 * The Chat Turn cost figure adopts the same namespace through its own copy of
 * this policy, because a client package cannot take another's values. The
 * shared home for both is `dsh-client-ui-primitives`, next to the charge rules
 * this table feeds; promoting it there changes both readers together.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelPrice } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'

/** The `console-pricing` settings namespace holding the operator's table. */
export const CONSOLE_PRICING_NAMESPACE = 'console-pricing'

/** The pricing namespace's fields the console reads. */
interface ConsolePricingSetting {
  /** The operator's recorded price table; absent until the first save. */
  models?: ModelPrice[]
}

/** The table an operator who recorded none has. */
const NO_PRICES: readonly ModelPrice[] = []

/** Live operator price table consumed by the console cost figure. */
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
