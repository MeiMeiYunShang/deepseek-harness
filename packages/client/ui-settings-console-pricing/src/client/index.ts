/**
 * The model price table, browser half: what each
 * `(baseUrl, provider, model)` route costs per million tokens, out of the
 * `console-bridge` namespace the console bridge registers. While the Host
 * serves that namespace the page registers into the Plugins page's
 * `plugins.item` slot and the console's task-statistics card gains its
 * `console.task-stats.action` entry, so a deployment without the console bridge
 * shows no trace of either — and a deployment that stops this plugin loses the
 * entry with it.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.configForms Context merge. Cross-plugin collaboration
// goes through the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the Plugins page's SlotMap merge (the 'plugins.item' entry).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
// Type-only: the console's SlotMap merge (the 'console.task-stats.action' seat).
import type {} from '@deepseek-ai/dsh-client-ui-console/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// The namespace the price table lives in, spelled once for every client cost
// figure: ui-primitives is the shared static owner of that fact.
import { CONSOLE_PRICING_NAMESPACE } from '@deepseek-ai/dsh-client-ui-primitives'
import { ConsolePricingCard } from './ConsolePricingCard.tsx'
import { ConsolePricingEntry } from './ConsolePricingEntry.tsx'
import { ConsolePricingCardController } from './console-pricing-card-controller.ts'
import type { ConsolePricingSettings } from './console-pricing-card-controller.ts'
import { en, zh, type ConsolePricingLocaleKey } from './locales.ts'

export type { ConsolePricingCardProps } from './ConsolePricingCard.tsx'
export type { ConsolePricingEntryProps } from './ConsolePricingEntry.tsx'
export type {
  ConsolePricingCardFace, ConsolePricingCardState, ConsolePricingSettings,
} from './console-pricing-card-controller.ts'
export type { ConsolePricingLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Model price table page copy. */
    'settings.consolePricing': ConsolePricingLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.consolePricing'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'configForms']

/**
 * Mount the model price table page and the console entry while the Host serves
 * the namespace they edit.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-console-pricing: dictionaries')
  const pricing = ctx.configForms.get<ConsolePricingSettings>(CONSOLE_PRICING_NAMESPACE)
  const card = new ConsolePricingCardController(pricing)
  // The console dialog stages its own table, so closing that dialog discards
  // only what the dialog staged and leaves the page's draft where it is.
  const entryCard = new ConsolePricingCardController(pricing)
  ctx.effect(() => () => { card.dispose(); entryCard.dispose() }, 'ui-settings-console-pricing: form subscriptions')
  ctx.effect(() => ctx.configForms.whileServed([CONSOLE_PRICING_NAMESPACE], () => {
    const page = ctx.slots.inject('plugins.item', () => ctx.slots.register({
      name: 'plugins.item', id: 'console-pricing', order: 50, label: () => t('title'), locale: NS, inject: () => card.inject(),
    }, ConsolePricingCard))
    const taskAction = ctx.slots.inject('console.task-stats.action', () => ctx.slots.register({
      name: 'console.task-stats.action', id: 'console-pricing', order: 10, locale: NS, inject: () => entryCard.inject(),
    }, ConsolePricingEntry))
    return () => { page(); taskAction() }
  }), 'ui-settings-console-pricing: page')
}
