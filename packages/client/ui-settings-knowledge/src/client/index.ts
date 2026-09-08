/**
 * Knowledge settings plugin, browser half: registers the Knowledge page into
 * Web Settings. All CRUD issues through the `knowledge` Remote; the Host stays
 * the single fact source and the page re-reads the catalog after each write.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import { KnowledgeSection, type KnowledgeSectionInjected } from './KnowledgeSection.tsx'
import { createKnowledgeSettingsStore } from './store.ts'
import { en, NS, zh, type KnowledgeSettingsKey } from './locales.ts'

export type { KnowledgeSectionInjected, KnowledgeSectionProps } from './KnowledgeSection.tsx'
export type { KnowledgeSettingsState } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Knowledge settings page copy. */
    knowledgeSettings: KnowledgeSettingsKey
  }
}

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.knowledge']

/**
 * Register the Knowledge section once the `settings.section` declaration is on
 * the ledger, wire its store to the Remote.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-knowledge: dictionaries')

  const store = createKnowledgeSettingsStore()
  // The inject factory hands the framework-created instance's actions here; a
  // mutation callback uses them to publish the next catalog. `loaded` marks a
  // settled catalog so a reconnect can refresh it without a first stale load.
  let bound: BoundActions<typeof store> | undefined
  let loaded = false
  let fetching = false

  const load = async (): Promise<void> => {
    if (fetching) return
    fetching = true
    bound?.beginLoad()
    try {
      const result = await ctx.remote.knowledge.list({})
      if (!result.ok) {
        bound?.setFailed(`${result.error.code}: ${result.error.message}`)
        return
      }
      loaded = true
      bound?.setCatalog(result.value.entries, result.value.groups)
    } finally {
      fetching = false
    }
  }

  // Refresh a settled catalog on reconnect: the previous host's entries differ.
  ctx.on('connection/reset', () => {
    if (loaded) void load()
  })

  const injected = (actions: BoundActions<typeof store>): KnowledgeSectionInjected => {
    bound = actions
    return {
      load: async () => { await load() },
      create: async (input) => {
        const result = await ctx.remote.knowledge.create(input)
        if (!result.ok) throw new Error(result.error.message)
        await load()
      },
      update: async (id, patch) => {
        const result = await ctx.remote.knowledge.update(id, patch)
        if (!result.ok) throw new Error(result.error.message)
        await load()
      },
      remove: async (id) => {
        const result = await ctx.remote.knowledge.delete(id)
        if (!result.ok) throw new Error(result.error.message)
        await load()
      },
      createGroup: async (input) => {
        const result = await ctx.remote.knowledge.createGroup(input)
        if (!result.ok) throw new Error(result.error.message)
        await load()
      },
      deleteGroup: async (id) => {
        const result = await ctx.remote.knowledge.deleteGroup(id)
        if (!result.ok) throw new Error(result.error.message)
        await load()
      },
    }
  }

  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'knowledge',
    order: 30,
    label: () => t('nav'),
    locale: NS,
    store,
    inject: injected,
  }, KnowledgeSection))
}
