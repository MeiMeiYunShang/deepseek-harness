/**
 * Knowledge picker plugin, browser half: registers the multi-select chip on
 * the blank-session Hero and the same picker as a composer-tool-row toggler,
 * both reading one client-side store exposed through the injected `hooks`
 * compartment. The catalog is fetched through the `knowledge` Remote (Host
 * stays the single fact source); the selection is client-side and travels with
 * the next session prompt.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { KnowledgeEntryId } from '@deepseek-ai/dsh-knowledge/types'
import { KnowledgePicker, type KnowledgePickerInjected } from './KnowledgePicker.tsx'
import { createKnowledgePickerStore } from './store.ts'
import { en, NS, zh, type KnowledgePickerKey } from './locales.ts'

export type { KnowledgePickerInjected, KnowledgePickerProps } from './KnowledgePicker.tsx'
export type { KnowledgePickerEntry, KnowledgePickerState } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The knowledge picker copy. */
    knowledgePicker: KnowledgePickerKey
  }
}

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'remote.knowledge']

/**
 * Mount the knowledge picker chips and their shared selection store.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-knowledge-picker: dictionaries')

  // One instance shared by both registers: the hero and composer chips are one
  // selection, not two. `instance.store` is the bare source the renderer binds
  // to `useKnowledgePicker`.
  const instance = createKnowledgePickerStore().create()
  const load = async (): Promise<void> => {
    const status = instance.store.getSnapshot().status
    if (status !== 'idle' && status !== 'ready') return
    instance.actions.startLoad()
    const result = await ctx.remote.knowledge.list({})
    if (!result.ok) {
      instance.actions.setFailed()
      return
    }
    instance.actions.setCatalog(
      result.value.entries.map(entry => ({
        id: entry.id,
        title: entry.title,
        category: entry.category,
        tags: entry.tags,
      })),
    )
  }

  const injected = (): KnowledgePickerInjected => ({
    hooks: { knowledgePicker: instance.store },
    load,
    toggle: (id: KnowledgeEntryId) => { instance.actions.toggle(id) },
    clear: () => { instance.actions.clear() },
  })

  // Refresh a settled catalog on reconnect: the previous host's entries differ.
  ctx.on('connection/reset', () => {
    if (instance.store.getSnapshot().status === 'ready') void load()
  })

  ctx.slots.inject('conversation.hero.knowledge', () => ctx.slots.register({
    name: 'conversation.hero.knowledge',
    locale: NS,
    inject: injected,
  }, KnowledgePicker))

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'knowledge-picker',
    order: 0,
    label: () => ctx.locale.bind(NS)('composerToggler'),
    locale: NS,
    inject: injected,
  }, KnowledgePicker))
}
