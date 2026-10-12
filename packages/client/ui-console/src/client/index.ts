/**
 * Console workbench plugin, browser half: contributes one sidebar footer action
 * that opens a fullscreen console modal. Session status and task stats come
 * from the standard `useSessions` feed; the timeline and host metrics are fed
 * from the forwarded `api-session/*` and `host/metrics` events into a store the
 * apply closure owns, with the timeline backfilled from the session list on the
 * first open; the console's selected session contributes its own conversation
 * from that session's event feed, with each reply's own token counts and its
 * turn's charge read from the same session's `sessionStats` projection; the
 * card's composer drives that same session's input machine, so one draft and
 * one submission path serve the console and the chat; session verbs
 * (rename/fork/archive/create) and the workspace/preset options ride the real
 * service faces; Smart Q&A streams over `ctx.remote.llm.chat`.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the slot registry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the sidebar SlotMap merge (the 'sidebar.footer.action' entry).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the Conversation Context merge (ctx.conversation) and the
// per-session input machine contract the console composer drives, plus the
// draft-attachment intake types the composer projection resolves through the
// conversation owner.
import type {
  IConversation, SessionInput,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the configForms Context merge so the console-bridge setting can be read.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the uiWorkspace Context merge (session navigation).
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls this package's SlotMap merge (the task-statistics action seat).
import type {} from './slot-contract.ts'
import { CONSOLE_PRICING_NAMESPACE, PriceTablePolicy } from '@deepseek-ai/dsh-client-ui-primitives'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { ConsoleButton } from './ConsoleButton.tsx'
import type { ConsoleInjectFace } from './ConsoleButton.tsx'
import {
  sameComposerState, UNBOUND_COMPOSER,
} from './composer.ts'
import type { ConsoleComposerActions, ConsoleComposerState } from './composer.ts'
import type { DraftFileUploads } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { createConsoleStore, historyEntries } from './consoleStore.ts'
import type { ConsoleStoreWrite } from './consoleStore.ts'
import { deriveTimelineMessages, sameTimelineMessages } from './timelineMessages.ts'
import type { TimelineMessage } from './timelineMessages.ts'
import type { ChatFetcher } from './SmartQA.tsx'
import type { ConsoleServices, NewSessionDraft } from './services.ts'
import type { LlmChatRequest } from '@deepseek-ai/dsh-llm/types'
import type { SessionFace, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionStatsProjection } from '@deepseek-ai/dsh-session-stats/types'
import { en, zh, type ConsoleKey, NS } from './locales.ts'
import { createComposerCandidates } from './candidates.ts'
import type { ComposerCandidateSource } from './candidates.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Console workbench copy. */
    console: ConsoleKey
  }
}

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** The console workbench composer holds one reference to the session whose
     * session-scope permission and model seats it renders. */
    console: unknown
  }
}

export type { ConsoleRenderSlot, TaskStatsActionOwnerProps } from './slot-contract.ts'

/** The console-bridge fields the Smart Q&A panel reads; spelled locally to avoid depending on the settings-plugins package. */
interface ConsoleBridgeSmartQaSetting {
  /** Model override for the console Smart Q&A panel (`provider/model`). */
  smartQaModel?: string
}

/**
 * Required services for locale, sidebar slot, sessions/workspaces/navigation,
 * settings, and Remote (command/skill/file-reference candidate catalogs).
 */
export const inject = [
  'slots', 'locale', 'remote', 'sessions', 'workspaces', 'uiWorkspace', 'configForms',
  'remote.commands', 'remote.skills', 'remote.fileReferences',
]

/** A stable empty upload map so the composer projection keeps its reference when the scoped conversation exposes no upload store. */
const NO_UPLOADS: DraftFileUploads = {}

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
    toggleSessionBucket: store.actions.toggleSessionBucket,
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
  // `SessionSnapshot` carries no messages — plus the per-turn route buckets the
  // same session's `sessionStats` projection reports, which are the only source
  // of a reply's turn charge. The apply closure owns both subscriptions, so the
  // card renders plain data through its bound hook and holds no subscription
  // machinery of its own; a revision that leaves the rendered conversation
  // unchanged publishes nothing.
  const messages = createSnapshotStore<readonly TimelineMessage[]>([])
  ctx.effect(() => {
    let scoped: string | undefined
    let stopFeed: (() => void) | undefined
    let stopStats: (() => void) | undefined
    const publish = (next: readonly TimelineMessage[]): void => {
      if (!sameTimelineMessages(messages.getSnapshot(), next)) messages.set(next)
    }
    // Swapping the console's scope disposes the previous session's subscriptions
    // before the new session is read, so exactly one session is ever followed.
    const following = (): void => {
      const sessionId = store.getSnapshot().selectedSession
      if (sessionId === scoped) return
      scoped = sessionId
      stopFeed?.()
      stopStats?.()
      stopFeed = undefined
      stopStats = undefined
      const binding = sessionId === undefined ? undefined : ctx.sessions.binding(sessionId as SessionId)
      if (binding === undefined) {
        publish([])
        return
      }
      const stats = binding.session.projections.faceOf('sessionStats')
      const republish = (): void => {
        const projection = stats.getSnapshot() as SessionStatsProjection | undefined
        publish(deriveTimelineMessages(binding.eventSource.getSnapshot(), projection?.turnRoutes ?? []))
      }
      republish()
      stopFeed = binding.eventSource.subscribe(republish)
      stopStats = stats.subscribe(republish)
    }
    const stopStore = store.subscribe(following)
    following()
    return () => {
      stopStore()
      stopFeed?.()
      stopStats?.()
    }
  }, 'ui-console: selected session conversation')

  // The console composer drives the chat's own per-session input machine — the
  // one source of truth for the draft and the submission path — instead of
  // holding a draft of its own. Resolution goes through that session's Agent
  // scope: the machine is the `conversation` service read off the scope, and its
  // `input` registry answers the facade for that scope. The apply closure owns
  // the scope swap, the machine's published state, and that session's own prompt
  // failure, and republishes the narrow projection the card reads; the writers
  // below address whatever machine the swap last resolved.
  const composer = createSnapshotStore<ConsoleComposerState>(UNBOUND_COMPOSER)
  // A console-owned reference to the session whose composer is currently bound;
  // the session-scope permission and model seats bind through it under
  // SessionProvider. It exists only while an already-active binding is followed,
  // so browsing a session here never starts a fresh open of its own.
  const composerScope = createSnapshotStore<SessionReference | undefined>(undefined)
  let composerMachine: SessionInput | undefined
  // The scoped session's conversation owner face and id, captured by the
  // composer effect whenever a live machine is followed. The draft-attachment
  // intake (create/resolve/retry/release and the upload store) rides this face;
  // it is the same controller instance the chat composer drives, so the console
  // mints drafts the shared machine then owns.
  let composerConversation: IConversation | undefined
  let composerSessionId: SessionId | undefined
  const composerActions: ConsoleComposerActions = {
    setDraft: (text) => { composerMachine?.setDraft(text) },
    submit: () => { composerMachine?.submit() },
    addFiles: (files) => {
      const conversation = composerConversation
      const sessionId = composerSessionId
      if (composerMachine === undefined || conversation === undefined || sessionId === undefined) {
        return 'addFilesNoSession'
      }
      const created = conversation.createDrafts?.(sessionId, files)
      if (created === undefined || created.length === 0) return 'addFilesUnavailable'
      composerMachine.addAttachments(created.map(attachment => attachment.id))
      return null
    },
    removeAttachment: (id) => {
      // Drop the id from the shared machine first (so the projection stops
      // referencing it), then release the browser-owned object.
      if (composerMachine?.removeAttachment(id) === true) composerConversation?.releaseDraftAttachment?.(id)
    },
    retryUpload: (id) => {
      if (composerSessionId !== undefined) composerConversation?.retryFileUpload?.(composerSessionId, id)
    },
  }
  ctx.effect(() => {
    let scoped: string | undefined
    let machine: SessionInput | undefined
    let session: SessionFace | undefined
    let conversation: IConversation | undefined
    let reference: SessionReference | undefined
    let stopState: (() => void) | undefined
    let stopSession: (() => void) | undefined
    let stopUploads: (() => void) | undefined
    // Release the console's hold and drop the seat scope together, so a scope
    // swap or teardown leaves no dangling reference behind.
    const dropReference = (): void => {
      reference?.release()
      reference = undefined
      composerScope.set(undefined)
    }
    const publish = (): void => {
      if (machine === undefined || session === undefined || conversation === undefined) {
        if (!sameComposerState(composer.getSnapshot(), UNBOUND_COMPOSER)) composer.set(UNBOUND_COMPOSER)
        return
      }
      const state = machine.state.getSnapshot()
      const uploads = conversation.fileUploads?.getSnapshot() ?? NO_UPLOADS
      const attachments = conversation.resolveDraftAttachments?.(state.attachmentIds) ?? []
      // A file-kind draft blocks send until its upload reaches 'ready'; images
      // never enter the upload store, so they never gate. This mirrors the chat
      // composer's own pending-upload gate over the same machine state.
      const uploadsPending = attachments.some(attachment =>
        attachment.kind === 'file' && uploads[attachment.id]?.status !== 'ready')
      const next: ConsoleComposerState = {
        ready: true,
        draft: state.draft,
        // The machine reports a failed plain send through this object-layer
        // fact alone: its settlement carries no message, and the chat composer
        // announces the same field in its banner.
        failed: session.getSnapshot().promptError !== null,
        attachmentIds: state.attachmentIds,
        attachments,
        uploads,
        uploadsPending,
      }
      if (!sameComposerState(composer.getSnapshot(), next)) composer.set(next)
    }
    // Swapping the console's scope disposes the previous session's subscriptions
    // before the new machine is read, so exactly one session is ever followed.
    const following = (): void => {
      const sessionId = store.getSnapshot().selectedSession
      if (sessionId === scoped) return
      scoped = sessionId
      stopState?.()
      stopSession?.()
      stopUploads?.()
      stopState = undefined
      stopSession = undefined
      stopUploads = undefined
      machine = undefined
      session = undefined
      conversation = undefined
      composerConversation = undefined
      composerSessionId = undefined
      dropReference()
      const scope = sessionId === undefined ? undefined : ctx.sessions.scope(sessionId as SessionId)
      const binding = sessionId === undefined ? undefined : ctx.sessions.binding(sessionId as SessionId)
      const resolved = scope?.get('conversation')
      const input = resolved?.input
      if (scope === undefined || input === undefined || binding === undefined || resolved === undefined) {
        composerMachine = undefined
        publish()
        return
      }
      machine = input.for(scope)
      session = binding.session
      conversation = resolved
      composerMachine = machine
      composerConversation = resolved
      composerSessionId = sessionId as SessionId
      // The binding is already retained (that is why it is live); retain borrows
      // the same generation under the console source rather than opening a new
      // one, giving the session-scope seats a reference to bind through.
      reference = ctx.sessions.retain(sessionId as SessionId, { source: 'console' })
      composerScope.set(reference)
      stopState = machine.state.subscribe(publish)
      stopSession = session.subscribe(publish)
      stopUploads = conversation.fileUploads?.subscribe(publish)
      publish()
    }
    const stopStore = store.subscribe(following)
    following()
    return () => {
      stopStore()
      stopState?.()
      stopSession?.()
      stopUploads?.()
      composerMachine = undefined
      composerConversation = undefined
      composerSessionId = undefined
      dropReference()
    }
  }, 'ui-console: selected session composer')

  // The composer's `/` and `@` candidate catalogs, bound to the client Remote.
  // The renderer holds no context, so these fetchers are handed down and the
  // local menu calls them with the scoped session id and an abort signal.
  const candidates: ComposerCandidateSource = createComposerCandidates(ctx)

  // Resolve the Smart Q&A default model once at load from the console-bridge
  // setting (`provider/model`); an unset or malformed override leaves it null,
  // so the panel stays disabled until the operator configures a model.
  const settings = ctx.configForms.get<ConsoleBridgeSmartQaSetting>('console-bridge')
  // The price table is adopted instead of read: the `console-pricing` namespace
  // answers after `get` returns, so one synchronous read would leave the cost
  // figure unpriced for the life of the page.
  const priceTable = new PriceTablePolicy(
    ctx.configForms.get(CONSOLE_PRICING_NAMESPACE),
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
    open: (sessionId) => { ctx.uiWorkspace.openSession(sessionId) },
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
      inject: (): ConsoleInjectFace => ({
        hooks: { console: store.store, prices: priceTable.prices, messages, composer, composerScope },
        store: write,
        services,
        composerActions,
        candidates,
        chat: ((request: LlmChatRequest, signal: AbortSignal) => ctx.remote.llm.chat(request, signal)) as ChatFetcher,
        defaultModel,
      }),
      // Declaring is claiming: this entry is the only one that may render the
      // task-statistics action seat, and the seat exists exactly while it does.
      // The permission and model seats are session-scope, so declaring them here
      // also hands this entry a SessionProvider and a renderSlot bound to those
      // keys; the composer wraps its scoped session in that Provider to render
      // the chat composer's own controls without owning a second editor.
      children: {
        'console.task-stats.action': { kind: 'list', scope: 'root' },
        'console.input.permission': { kind: 'single', scope: 'session' },
        'console.input.model': { kind: 'single', scope: 'session' },
      },
    }, ConsoleButton),
  )
}
