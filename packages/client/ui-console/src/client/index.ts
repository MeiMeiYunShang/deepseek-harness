/**
 * Console workbench plugin, browser half: contributes one sidebar footer action
 * that opens a fullscreen console modal. Session status and task stats come
 * from the standard `useSessions` feed; the timeline and host metrics are fed
 * from the forwarded `api-session/*` and `host/metrics` events into a store the
 * apply closure owns; session verbs (rename/fork/archive/create) and the
 * workspace/preset options ride the real service faces; Smart Q&A streams over
 * `ctx.remote.llm.chat`.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the slot registry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the sidebar SlotMap merge (the 'sidebar.footer.action' entry).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the settingsScope Context merge so the console-bridge setting can be read.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { ConsoleButton } from './ConsoleButton.tsx'
import { createConsoleStore } from './consoleStore.ts'
import type { ConsoleStoreWrite } from './consoleStore.ts'
import type { ChatFetcher } from './SmartQA.tsx'
import type { ConsoleServices, NewSessionDraft } from './services.ts'
import type { LlmChatRequest } from '@deepseek-ai/dsh-llm/types'
import { en, zh, type ConsoleKey, NS } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Console workbench copy. */
    console: ConsoleKey
  }
}

/** The console-bridge fields the Smart Q&A panel reads; spelled locally to avoid depending on the settings-plugins package. */
interface ConsoleBridgeSmartQaSetting {
  /** Model override for the console Smart Q&A panel (`provider/model`). */
  smartQaModel?: string
}

/** Required services for locale, sidebar slot, sessions/workspaces, settings, and Remote. */
export const inject = ['slots', 'locale', 'remote', 'sessions', 'workspaces', 'settingsScope']

/**
 * Client plugin body: register the dictionaries and the sidebar footer action,
 * and own the timeline store fed from the forwarded Remote events.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-console: dictionaries')
  const t = ctx.locale.bind(NS)

  const store = createConsoleStore().create()
  const write: ConsoleStoreWrite = {
    setTimelineMode: store.actions.setTimelineMode,
    setSessionView: store.actions.setSessionView,
    setSelectedSession: store.actions.setSelectedSession,
    setTimelineScope: store.actions.setTimelineScope,
  }

  // The timeline is a monitoring mirror: forward the coarse session activity
  // and running-state changes into a bounded store window.
  ctx.effect(
    () => ctx.remote.$on('api-session/activity', (sessionId: string, updatedAt: number) => {
      store.actions.pushTimeline({ sessionId, time: updatedAt, kind: 'activity' })
    }),
    'ui-console: session activity',
  )
  ctx.effect(
    () => ctx.remote.$on('api-session/status', (sessionId: string, _running: boolean) => {
      store.actions.pushTimeline({ sessionId, time: Date.now(), kind: 'status' })
    }),
    'ui-console: session status',
  )
  // The status panel subscribes to the host sampler over the forwarded event.
  ctx.effect(
    () => ctx.remote.$on('host/metrics', (metrics: { cpu: number; memory: number; gpu: number | null }) => {
      store.actions.updateSystemStatus({ cpu: metrics.cpu, memory: metrics.memory, gpu: metrics.gpu })
    }),
    'ui-console: host metrics',
  )

  // Resolve the Smart Q&A default model once at load from the console-bridge
  // setting (`provider/model`); an unset or malformed override leaves it null,
  // so the panel stays disabled until the operator configures a model.
  const settings = ctx.settingsScope.bind<ConsoleBridgeSmartQaSetting>({ namespace: 'console-bridge' })
  const defaultModel = ((): { provider: string; model: string } | null => {
    const override = settings.getSnapshot().value?.smartQaModel?.trim()
    if (override === undefined || override.length === 0) return null
    const slash = override.indexOf('/')
    return slash >= 0
      ? { provider: override.slice(0, slash), model: override.slice(slash + 1) }
      : null
  })()

  const services: ConsoleServices = {
    open: (sessionId) => { ctx.sessions.open(sessionId) },
    rename: async (sessionId, title) => {
      const session = ctx.sessions.binding(sessionId)?.session
      if (session === undefined) throw new Error(`console: session ${sessionId} has no binding`)
      return await session.rename(title)
    },
    fork: async sessionId => ctx.sessions.fork({ sessionId, increaseTitle: true }),
    archive: async sessionId => ctx.workspaces.archiveSession(sessionId),
    create: async (draft: NewSessionDraft) => {
      if (draft.workspaceId === undefined) throw new Error('console: new-session requires a workspace')
      return await ctx.sessions.create({ workspaceId: draft.workspaceId as never })
    },
    selectPreset: async (sessionId, presetId) => {
      const result = await ctx.remote.agentPresets.select(sessionId, presetId)
      if (!result.ok) throw result.error
      return result.value
    },
    sendInstruction: async (sessionId, text) => {
      const session = ctx.sessions.binding(sessionId)?.session
      if (session === undefined) throw new Error(`console: session ${sessionId} has no binding`)
      return await session.prompt([{ type: 'text', text }], 'queue')
    },
    pickDirectory: async () => {
      const result = await ctx.remote.directoryPicker.pick(AbortSignal.timeout(30_000))
      if (!result.ok) throw result.error
      return result.value
    },
    listPresets: async () => {
      const result = await ctx.remote.agentPresets.list()
      if (!result.ok) throw result.error
      return result.value.presets.map(preset => ({ id: preset.id, name: preset.name }))
    },
  }

  ctx.slots.inject(
    'sidebar.footer.action',
    () => ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'console',
      order: 40,
      label: () => t('console'),
      locale: NS,
      inject: () => ({
        hooks: { console: store.store },
        store: write,
        services,
        chat: ((request: LlmChatRequest, signal: AbortSignal) => ctx.remote.llm.chat(request, signal)) as ChatFetcher,
        defaultModel,
      }),
    }, ConsoleButton),
  )
}
