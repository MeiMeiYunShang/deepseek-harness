/**
 * Console workbench plugin, browser half: contributes one sidebar footer action
 * that opens a fullscreen console modal. Session status and task stats come
 * from the standard `useSessions` feed; the timeline and host metrics are fed
 * from the forwarded `api-session/*` and `host/metrics` events into a store the
 * apply closure owns, with the timeline backfilled from the session list on the
 * first open; the console's selected session contributes its own conversation
 * from that session's event feed; session verbs (rename/fork/archive/create)
 * and the workspace/preset options ride the real service faces; Smart Q&A
 * streams over `ctx.remote.llm.chat`.
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
import { CONSOLE_PRICING_NAMESPACE, PriceTablePolicy } from '@deepseek-ai/dsh-client-ui-primitives'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { ConsoleButton } from './ConsoleButton.tsx'
import { createConsoleStore, historyEntries } from './consoleStore.ts'
import type { ConsoleStoreWrite } from './consoleStore.ts'
import { deriveTimelineMessages, sameTimelineMessages } from './timelineMessages.ts'
import type { TimelineMessage } from './timelineMessages.ts'
import type { ChatFetcher } from './SmartQA.tsx'
import type { ConsoleServices, NewSessionDraft } from './services.ts'
import type { LlmChatRequest } from '@deepseek-ai/dsh-llm/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
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
 * and own the timeline store fed from the forwarded Remote events and
 * backfilled from the session list on the workbench's first open.
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
    setLayout: store.actions.setLayout,
    toggleCollapsed: store.actions.toggleCollapsed,
    setOpen: store.actions.setOpen,
  }

  // The timeline is a monitoring mirror: forward the coarse session activity
  // and running-state changes into a bounded store window, and follow the host
  // sampler into the status panel. All three stay subscribed for the life of
  // the page, so the window holds what happened before the workbench opened.
  ctx.effect(() => ctx.remote.$on('api-session/activity', (sessionId: string, updatedAt: number) => {
    store.actions.pushTimeline({ sessionId, time: updatedAt, kind: 'activity' })
  }), 'ui-console: session activity')
  ctx.effect(() => ctx.remote.$on('api-session/status', (sessionId: string, _running: boolean) => {
    store.actions.pushTimeline({ sessionId, time: Date.now(), kind: 'status' })
  }), 'ui-console: session status')
  ctx.effect(() => ctx.remote.$on('host/metrics', (metrics: { cpu: number; memory: number; gpu: number | null }) => {
    store.actions.updateSystemStatus({ cpu: metrics.cpu, memory: metrics.memory, gpu: metrics.gpu })
  }), 'ui-console: host metrics')

  // Forwarded events are rare and only accumulate from page load, so the
  // workbench would otherwise open on an empty timeline. The first open with an
  // empty timeline backfills one recorded row per session the client already
  // lists — no second fetch, and an empty list seeds nothing. Rows append in
  // insertion order while the list renders reversed, so a later backfill would
  // render older sessions as the newest events; the seed therefore runs once,
  // and never over a timeline that already holds a row.
  let historySeeded = false
  ctx.effect(() => store.subscribe(() => {
    const snapshot = store.getSnapshot()
    if (historySeeded || !snapshot.open || snapshot.timeline.length > 0) return
    const rows = historyEntries(ctx.sessions.list.getSnapshot())
    if (rows.length === 0) return
    historySeeded = true
    for (const row of rows) store.actions.pushTimeline(row)
  }), 'ui-console: timeline history seed')

  // The selected session's conversation, derived from its own event feed —
  // `SessionSnapshot` carries no messages. The apply closure owns the single
  // subscription, so the card renders plain data through its bound hook and
  // holds no subscription machinery of its own; a window revision that leaves
  // the rendered conversation unchanged publishes nothing.
  const messages = createSnapshotStore<readonly TimelineMessage[]>([])
  ctx.effect(() => {
    let scoped: string | undefined
    let stopFeed: (() => void) | undefined
    const publish = (next: readonly TimelineMessage[]): void => {
      if (!sameTimelineMessages(messages.getSnapshot(), next)) messages.set(next)
    }
    // Swapping the console's scope disposes the previous session's feed before
    // the new one is read, so exactly one feed is ever subscribed.
    const following = (): void => {
      const sessionId = store.getSnapshot().selectedSession
      if (sessionId === scoped) return
      scoped = sessionId
      stopFeed?.()
      stopFeed = undefined
      const feed = sessionId === undefined ? undefined : ctx.sessions.binding(sessionId as SessionId)?.eventSource
      if (feed === undefined) {
        publish([])
        return
      }
      publish(deriveTimelineMessages(feed.getSnapshot()))
      stopFeed = feed.subscribe(() => { publish(deriveTimelineMessages(feed.getSnapshot())) })
    }
    const stopStore = store.subscribe(following)
    following()
    return () => {
      stopStore()
      stopFeed?.()
    }
  }, 'ui-console: selected session conversation')

  // Resolve the Smart Q&A default model once at load from the console-bridge
  // setting (`provider/model`); an unset or malformed override leaves it null,
  // so the panel stays disabled until the operator configures a model.
  const settings = ctx.settingsScope.bind<ConsoleBridgeSmartQaSetting>({ namespace: 'console-bridge' })
  // The price table is adopted instead of read: the `console-pricing` namespace
  // answers after `bind` returns, so one synchronous read would leave the cost
  // figure unpriced for the life of the page.
  const priceTable = new PriceTablePolicy(
    ctx.settingsScope.bind({ namespace: CONSOLE_PRICING_NAMESPACE }),
  )
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
        hooks: { console: store.store, prices: priceTable.prices, messages },
        store: write,
        services,
        chat: ((request: LlmChatRequest, signal: AbortSignal) => ctx.remote.llm.chat(request, signal)) as ChatFetcher,
        defaultModel,
      }),
    }, ConsoleButton),
  )
}
