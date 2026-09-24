/** What the browser half registers and subscribes, and that it leaves with the fiber. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { SessionLiveEventEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEvent, SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { TestRemote, TestSessions, TestWorkspaces, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { ModelPrice } from '@deepseek-ai/dsh-client-ui-primitives'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-console/client'
import type { ConsoleServices } from '../src/client/services.ts'
import type { ConsoleStoreState, ConsoleStoreWrite } from '../src/client/consoleStore.ts'
import type { TimelineMessage } from '../src/client/timelineMessages.ts'

/** Stabilizer that lets TestSessions/TestWorkspaces write outside React act. */
const stabilize = async (fn: () => void): Promise<void> => {
  fn()
}

/** One operator price row, adopted by the console-pricing namespace under test. */
const FLASH: ModelPrice = {
  baseUrl: 'https://api.deepseek.com',
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  peak: { cacheHit: 0.25, cacheMiss: 1, output: 2 },
  offPeak: { cacheHit: 0.125, cacheMiss: 0.5, output: 1 },
}

async function bench(setting?: { smartQaModel?: string }, erroring = false) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('en')
  ctx.provide('locale', locale)
  const sessions = new TestSessions(stabilize, ctx)
  const workspaces = new TestWorkspaces(stabilize)
  ctx.provide('sessions', sessions)
  ctx.provide('workspaces', workspaces)
  const chat = vi.fn(async function* () { /* no chunks */ })
  const remoteResult = async <T>(value: T): Promise<{ ok: true; value: T }> => ({ ok: true, value })
  const remoteError = { message: 'boom' }
  const agentPresets = {
    list: vi.fn(async () => (erroring ? { ok: false, error: remoteError } : await remoteResult({ presets: [{ id: 'p1', name: 'Agent A', trust: 'system', isDefault: false }], authorable: false }))),
    select: vi.fn(async () => (erroring ? { ok: false, error: remoteError } : await remoteResult('ok'))),
  }
  const directoryPicker = { pick: vi.fn(async () => (erroring ? { ok: false, error: remoteError } : await remoteResult(null))) }
  const remote = new TestRemote(ctx, { llm: { chat, listProviders: vi.fn() }, agentPresets, directoryPicker })
  // The two settings scopes apply binds: the console-bridge section read once at
  // load for the Smart Q&A default model, and the console-pricing table adopted
  // from every section the Host accepts.
  const bridge = stubSettingsScope<{ smartQaModel?: string }>()
  if (setting !== undefined) bridge.publish({ status: 'ready', value: setting, revision: 1 })
  const pricing = stubSettingsScope<{ models?: ModelPrice[] }>()
  ctx.provide('settingsScope', {
    bind: ({ namespace }: { namespace: string }) => namespace === 'console-pricing' ? pricing.scope : bridge.scope,
  } as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, remote, sessions, workspaces, agentPresets, directoryPicker, chat, pricing }
}

function declareSidebar(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'sidebar.footer.action': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

/** The console sidebar action's registered inject face: store hook plus its write set. */
function consoleFace(slots: SlotRegistry): {
  hooks: {
    console: { getSnapshot: () => ConsoleStoreState }
    messages: { getSnapshot: () => readonly TimelineMessage[] }
  }
  store: ConsoleStoreWrite
} {
  return (slots.entries('sidebar.footer.action')[0]!.inject as unknown as () => {
    hooks: {
      console: { getSnapshot: () => ConsoleStoreState }
      messages: { getSnapshot: () => readonly TimelineMessage[] }
    }
    store: ConsoleStoreWrite
  })()
}

/** One operator prompt event. */
function promptEntry(seq: number, text: string): SessionLiveEventEntry {
  return {
    type: 'event',
    event: {
      seq,
      time: seq * 100,
      type: 'user/message',
      data: { id: `u${seq}`, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } },
    },
  } as unknown as SessionLiveEventEntry
}

/** One assembled assistant reply event. */
function replyEntry(seq: number, text: string): SessionLiveEventEntry {
  return {
    type: 'event',
    event: {
      seq,
      time: seq * 100,
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 1,
        message: { id: `a${seq}`, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'p', model: 'm' } },
        stream: [],
      },
    },
  } as unknown as SessionLiveEventEntry
}

describe('ui-console apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'sessions', 'workspaces', 'settingsScope'])
  })

  it('registers one sidebar footer action and the console dictionary', async () => {
    const { ctx, slots, pricing } = await bench()
    declareSidebar(slots)

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const entry = slots.entries('sidebar.footer.action')[0]!
    expect(entry.options).toMatchObject({ id: 'console', order: 40 })
    expect(resolveSlotLabel(entry.options.label)).toBe('Console')
    // The injected face exposes the store hook, the price table, the scoped
    // conversation, the service verb set, the chat fetcher, and the default model.
    const face = (entry.inject as unknown as () => {
      hooks: {
        console: { getSnapshot: () => unknown; subscribe: unknown }
        prices: { getSnapshot: () => readonly ModelPrice[] }
        messages: { getSnapshot: () => readonly TimelineMessage[]; subscribe: unknown }
      }
      store: unknown
      services: unknown
      chat: unknown
      defaultModel: unknown
    })()
    expect(typeof face.hooks.console.getSnapshot).toBe('function')
    expect(typeof face.hooks.console.subscribe).toBe('function')
    expect(typeof face.hooks.messages.getSnapshot).toBe('function')
    expect(typeof face.hooks.messages.subscribe).toBe('function')
    expect(face.hooks.messages.getSnapshot()).toEqual([])
    // The price table is served as a live source: the namespace answers after
    // bind, so the value a read at bind time would have found is empty.
    expect(face.hooks.prices.getSnapshot()).toEqual([])
    pricing.publish({ status: 'ready', value: { models: [FLASH] }, revision: 1 })
    expect(face.hooks.prices.getSnapshot()).toEqual([FLASH])
    expect(typeof face.store).toBe('object')
    expect(typeof face.services).toBe('object')
    expect(typeof face.chat).toBe('function')
    expect(face.defaultModel).toBeNull()

    await fiber.dispose()
    expect(slots.entries('sidebar.footer.action')).toHaveLength(0)
  })

  it('subscribes at apply time so forwarded events reach the store while the console is closed', async () => {
    const { ctx, slots, remote } = await bench()
    declareSidebar(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const face = (slots.entries('sidebar.footer.action')[0]!.inject as unknown as () => {
      hooks: { console: { getSnapshot: () => ConsoleStoreState } }
    })()
    expect(face.hooks.console.getSnapshot().open).toBe(false)

    // Forwarding must reach apply's subscribers without leaking a throw, and
    // must reach them whether or not the workbench is showing.
    remote.emit('api-session/activity', ['s1', 1000])
    remote.emit('api-session/status', ['s1', true])
    remote.emit('host/metrics', [{ cpu: 10, memory: 20, gpu: null }])

    const snapshot = face.hooks.console.getSnapshot()
    expect(snapshot.timeline).toMatchObject([
      { sessionId: 's1', time: 1000, kind: 'activity' },
      { sessionId: 's1', kind: 'status' },
    ])
    expect(snapshot.systemStatus).toEqual({ cpu: 10, memory: 20, gpu: null })

    // The subscriptions are effects of this fiber, so they leave with it.
    await fiber.dispose()
    expect(slots.entries('sidebar.footer.action')).toHaveLength(0)
    remote.emit('api-session/activity', ['s2', 2000])
    expect(face.hooks.console.getSnapshot().timeline).toHaveLength(2)
  })

  it('backfills one history row per known session when the workbench first opens', async () => {
    const { ctx, slots, sessions } = await bench()
    declareSidebar(slots)
    await sessions.add({ id: 's-newer', summary: { updatedAt: 300 } }, { current: false })
    await sessions.add({ id: 's-older', summary: { updatedAt: 100 } }, { current: false })
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const face = consoleFace(slots)

    face.store.setOpen(true)

    // Ascending insertion order, because the list renders the array reversed:
    // the last seeded row is the newest snapshot. Every seeded row carries the
    // summary's human-facing title, which is what the row reveals when opened.
    expect(face.hooks.console.getSnapshot().timeline.map(row => [row.sessionId, row.time, row.kind, row.title])).toEqual([
      ['s-older', 100, 'history', 's-older'],
      ['s-newer', 300, 'history', 's-newer'],
    ])
    await fiber.dispose()
  })

  it('does not backfill again when the workbench is reopened', async () => {
    const { ctx, slots, sessions } = await bench()
    declareSidebar(slots)
    await sessions.add({ id: 's1', summary: { updatedAt: 100 } }, { current: false })
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const face = consoleFace(slots)

    face.store.setOpen(true)
    face.store.setOpen(false)
    face.store.setOpen(true)

    expect(face.hooks.console.getSnapshot().timeline).toHaveLength(1)
    await fiber.dispose()
  })

  it('leaves a timeline that already holds a live row alone', async () => {
    const { ctx, slots, sessions, remote } = await bench()
    declareSidebar(slots)
    await sessions.add({ id: 's1', summary: { updatedAt: 100 } }, { current: false })
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const face = consoleFace(slots)

    remote.emit('api-session/activity', ['s1', 5000])
    face.store.setOpen(true)

    expect(face.hooks.console.getSnapshot().timeline.map(row => row.kind)).toEqual(['activity'])
    await fiber.dispose()
  })

  it('seeds nothing while the client holds no sessions', async () => {
    const { ctx, slots, remote } = await bench()
    declareSidebar(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const face = consoleFace(slots)

    face.store.setOpen(true)
    expect(face.hooks.console.getSnapshot().timeline).toEqual([])

    // A live row still lands, and never triggers a backfill over it.
    remote.emit('api-session/activity', ['s1', 1000])
    expect(face.hooks.console.getSnapshot().timeline.map(row => row.kind)).toEqual(['activity'])
    await fiber.dispose()
  })

  it('derives the scoped session conversation from that session event window and follows it', async () => {
    const { ctx, slots, sessions } = await bench()
    declareSidebar(slots)
    await sessions.add({ id: 's1', summary: { updatedAt: 100 }, events: [promptEntry(1, 'Repair the composer'), replyEntry(2, 'Done.')] }, { current: false })
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const face = consoleFace(slots)

    // Nothing is scoped, so the card has no conversation to render.
    expect(face.hooks.messages.getSnapshot()).toEqual([])

    face.store.setSelectedSession('s1')
    expect(face.hooks.messages.getSnapshot()).toEqual([
      { key: 1, role: 'user', text: 'Repair the composer', time: 100 },
      { key: 2, role: 'assistant', text: 'Done.', time: 200 },
    ])

    // The window is the live source: a later append reaches the published list.
    await sessions.appendEvent('s1', promptEntry(3, 'And the tests.'))
    expect(face.hooks.messages.getSnapshot().map(message => message.text))
      .toEqual(['Repair the composer', 'Done.', 'And the tests.'])

    await fiber.dispose()
  })

  it('swaps the conversation when the console scope changes, leaving no subscription behind', async () => {
    const { ctx, slots, sessions } = await bench()
    declareSidebar(slots)
    await sessions.add({ id: 's1', summary: { updatedAt: 100 }, events: [promptEntry(1, 'first session')] }, { current: false })
    await sessions.add({ id: 's2', summary: { updatedAt: 200 }, events: [promptEntry(1, 'second session')] }, { current: false })
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const face = consoleFace(slots)

    face.store.setSelectedSession('s1')
    expect(face.hooks.messages.getSnapshot().map(message => message.text)).toEqual(['first session'])

    face.store.setSelectedSession('s2')
    expect(face.hooks.messages.getSnapshot().map(message => message.text)).toEqual(['second session'])

    // s1 is no longer followed: a window revision there publishes nothing.
    await sessions.replaceEvents('s1', [promptEntry(1, 'first session'), replyEntry(2, 'stale reply')])
    expect(face.hooks.messages.getSnapshot().map(message => message.text)).toEqual(['second session'])

    // Clearing the scope empties the card without disturbing s2's own window.
    face.store.setSelectedSession(undefined)
    expect(face.hooks.messages.getSnapshot()).toEqual([])

    await fiber.dispose()
  })

  it('publishes no conversation for a selected session without a binding', async () => {
    const { ctx, slots, sessions } = await bench()
    declareSidebar(slots)
    await sessions.add({ id: 's1', summary: { updatedAt: 100 }, events: [promptEntry(1, 'scoped')] }, { current: false })
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const face = consoleFace(slots)

    face.store.setSelectedSession('s1')
    expect(face.hooks.messages.getSnapshot()).toHaveLength(1)

    face.store.setSelectedSession('missing')
    expect(face.hooks.messages.getSnapshot()).toEqual([])

    await fiber.dispose()
  })

  it('stops following the session event window when the fiber is disposed', async () => {
    const { ctx, slots, sessions } = await bench()
    declareSidebar(slots)
    await sessions.add({ id: 's1', summary: { updatedAt: 100 }, events: [promptEntry(1, 'scoped')] }, { current: false })
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const face = consoleFace(slots)

    face.store.setSelectedSession('s1')
    expect(face.hooks.messages.getSnapshot()).toHaveLength(1)

    await fiber.dispose()
    await sessions.replaceEvents('s1', [promptEntry(1, 'scoped'), replyEntry(2, 'after disposal')])
    expect(face.hooks.messages.getSnapshot().map(message => message.text)).toEqual(['scoped'])
  })

  it('leaves a published conversation untouched when the window revision changes nothing rendered', async () => {
    const { ctx, slots, sessions } = await bench()
    declareSidebar(slots)
    await sessions.add({ id: 's1', summary: { updatedAt: 100 }, events: [promptEntry(1, 'scoped')] }, { current: false })
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const face = consoleFace(slots)

    face.store.setSelectedSession('s1')
    const published = face.hooks.messages.getSnapshot()

    // A revision that carries no renderable message republishes nothing, so the
    // bound hook keeps one snapshot reference.
    await sessions.appendEvent('s1', {
      type: 'event',
      event: { seq: 2, time: 200, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } } as unknown as SessionEvent,
    })
    expect(face.hooks.messages.getSnapshot()).toBe(published)

    await fiber.dispose()
  })

  it('wires the remote-backed verbs over their namespaces', async () => {
    const { ctx, slots, agentPresets, directoryPicker } = await bench()
    declareSidebar(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const face = (slots.entries('sidebar.footer.action')[0]!.inject as unknown as () => {
      services: {
        listPresets: () => Promise<readonly { id: string; name: string | undefined }[]>
        pickDirectory: () => Promise<string | null>
      }
    })()
    const { services } = face

    await services.listPresets()
    expect(agentPresets.list).toHaveBeenCalled()

    await services.pickDirectory()
    expect(directoryPicker.pick).toHaveBeenCalled()

    await fiber.dispose()
    expect(slots.entries('sidebar.footer.action')).toHaveLength(0)
  })

  it('drives the session and workspace verbs through the service faces', async () => {
    const { ctx, slots, sessions, workspaces, agentPresets } = await bench()
    declareSidebar(slots)
    const rename = vi.fn(async (title: string) => ({ ok: true, value: { title, seq: 1 as SessionSeq } } as const))
    const prompt = vi.fn(async () => ({ ok: true, value: { accepted: true } } as const))
    const s1 = 's1' as SessionId
    const snew = 'snew' as SessionId
    await sessions.add({ id: s1, session: { rename, prompt }, summary: { running: false } })
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const { services } = (slots.entries('sidebar.footer.action')[0]!.inject as unknown as () => {
      services: ConsoleServices
    })()

    services.open(s1)
    expect(sessions.calls.some(call => call.method === 'open')).toBe(true)

    await services.rename(s1, 'Renamed')
    expect(rename).toHaveBeenCalledWith('Renamed')

    await services.fork(s1)
    expect(sessions.calls.some(call => call.method === 'fork')).toBe(true)

    await services.sendInstruction(s1, 'hello')
    expect(prompt).toHaveBeenCalledWith([{ type: 'text', text: 'hello' }], 'queue')

    await services.archive(s1)
    expect(workspaces.calls.some(call => call.method === 'archiveSession')).toBe(true)

    workspaces.stub('create', async input => ({ workspaceId: `ws-${input.path}` as never, title: input.path, path: input.path, sessionIds: [] } as never))
    const snewPrompt = vi.fn(async () => ({ ok: true, value: { accepted: true } } as const))
    await sessions.add({ id: snew, session: { prompt: snewPrompt }, summary: { running: false } })
    sessions.stubCreate(async () => snew)
    const created = await services.create({ workspaceId: 'w1', presetId: undefined, instruction: '' })
    expect(created).toBe(snew)

    await services.selectPreset(snew, 'p1')
    expect(agentPresets.select).toHaveBeenCalledWith(snew, 'p1')

    await services.sendInstruction(snew, 'again')
    expect(snewPrompt).toHaveBeenCalledTimes(1)

    await fiber.dispose()
    expect(slots.entries('sidebar.footer.action')).toHaveLength(0)
  })

  it('throws a loud error when a session has no binding', async () => {
    const { ctx, slots } = await bench()
    declareSidebar(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const { services } = (slots.entries('sidebar.footer.action')[0]!.inject as unknown as () => { services: ConsoleServices })()
    await expect(services.rename('missing' as SessionId, 'x')).rejects.toThrow(/no binding/)
    await expect(services.sendInstruction('missing' as SessionId, 'x')).rejects.toThrow(/no binding/)
    await expect(services.create({ workspaceId: undefined, presetId: undefined, instruction: '' })).rejects.toThrow(/requires a workspace/)
    await fiber.dispose()
  })

  it('resolves a slash-form smartQaModel default model and a malformed one to null', async () => {
    const { ctx, slots, chat } = await bench({ smartQaModel: 'deepseek/chat' })
    declareSidebar(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const face = (slots.entries('sidebar.footer.action')[0]!.inject as unknown as () => {
      defaultModel: { provider: string; model: string } | null
      chat: (request: unknown, signal: AbortSignal) => Promise<unknown>
    })()
    expect(face.defaultModel).toEqual({ provider: 'deepseek', model: 'chat' })
    // The chat fetcher delegates to ctx.remote.llm.chat.
    await face.chat({}, new AbortController().signal)
    expect(chat).toHaveBeenCalled()
    await fiber.dispose()

    const { ctx: ctx2, slots: slots2 } = await bench({ smartQaModel: 'no-slash' })
    declareSidebar(slots2)
    const fiber2 = ctx2.plugin({ inject: [...inject], apply })
    await fiber2.await()
    const face2 = (slots2.entries('sidebar.footer.action')[0]!.inject as unknown as () => { defaultModel: unknown })()
    expect(face2.defaultModel).toBeNull()
    await fiber2.dispose()
  })

  it('surfaces remote errors from listPresets, selectPreset, and pickDirectory', async () => {
    const { ctx, slots } = await bench(undefined, true)
    declareSidebar(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const { services } = (slots.entries('sidebar.footer.action')[0]!.inject as unknown as () => { services: ConsoleServices })()
    await expect(services.listPresets()).rejects.toMatchObject({ message: 'boom' })
    await expect(services.pickDirectory()).rejects.toMatchObject({ message: 'boom' })
    await expect(services.selectPreset('s1' as SessionId, 'p1')).rejects.toMatchObject({ message: 'boom' })
    await fiber.dispose()
  })
})
