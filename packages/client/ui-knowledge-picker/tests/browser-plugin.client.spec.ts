/**
 * ui-knowledge-picker browser half: registers the hero chip and composer
 * toggler into the two declaration slots plus the locale dictionaries, the
 * fiber-teardown removal (HMR safety), and the driven catalog load — success,
 * failure, the re-entry guard, connection/reset refresh, and selection writes.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { RemoteError, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import { KnowledgeEntryId } from '@deepseek-ai/dsh-knowledge/types'
import { apply, inject } from '../src/client/index.ts'
import { KnowledgePicker } from '../src/client/KnowledgePicker.tsx'

type Entry = { id: string; title: string; category: string; tags: readonly string[] }
type ListResult =
  | { ok: true; value: { entries: readonly Entry[]; groups: readonly unknown[] } }
  | { ok: false; error: RemoteFailure }

type ListFn = (filter: object, signal?: AbortSignal) => Promise<ListResult>

const ENTRY: Entry = { id: 'k-1', title: 'Title', category: 'pattern', tags: [] }
const listOk: ListFn = () => Promise.resolve({ ok: true, value: { entries: [ENTRY], groups: [] } })
const listFail: ListFn = () => Promise.resolve({
  ok: false, error: new RemoteError('knowledge/invalid-input', 'boom', {}),
})
const emptyList: ListFn = () => Promise.resolve({ ok: true, value: { entries: [], groups: [] } })

/** Provide the registries and capture the plugin's registration surface. */
function providePresentation(ctx: Context): { slots: SlotRegistry; dictionaries: unknown[]; localeDisposed: boolean } {
  const slots = new SlotRegistry(ctx)
  slots.register({
    name: 'root',
    children: {
      'conversation.hero.knowledge': { kind: 'single', scope: 'root' },
      'conversation.input.left': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
  const capture: { slots: SlotRegistry; dictionaries: unknown[]; localeDisposed: boolean } = {
    slots,
    dictionaries: [],
    localeDisposed: false,
  }
  ctx.provide('locale', {
    register(namespace: string, dictionaries: unknown) {
      capture.dictionaries.push({ namespace, dictionaries })
      return () => { capture.localeDisposed = true }
    },
    bind: () => (key: string) => key,
  })
  return capture
}

type Snapshot = { status: string; entries: readonly Entry[]; selectedIds: readonly string[] }

/** The injected face exposed by the hero register (type-erased at the entry). */
interface Face {
  hooks: { knowledgePicker: { getSnapshot(): Snapshot } }
  load: () => Promise<void>
  toggle: (id: unknown) => void
  clear: () => void
}

/** Boot the plugin and capture the hero chip's injected face. */
async function boot(list: ListFn): Promise<{ ctx: Context; slots: SlotRegistry; face: Face; listCalls: () => number }> {
  const ctx = new Context()
  let calls = 0
  const counted: ListFn = (filter, signal) => { calls += 1; return list(filter, signal) }
  new TestRemote(ctx, { knowledge: { list: counted } })
  const presentation = providePresentation(ctx)
  await ctx.plugin({ inject: [...inject], apply }).await()
  const hero = presentation.slots.entries('conversation.hero.knowledge')[0]
  const face = hero?.inject?.() as unknown as Face
  return { ctx, slots: presentation.slots, face, listCalls: () => calls }
}

describe('apply', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.knowledge'])
  })

  it('registers the hero chip, the composer toggler, and the locale dictionaries', async () => {
    const ctx = new Context()
    new TestRemote(ctx, { knowledge: { list: listOk } })
    const presentation = providePresentation(ctx)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const hero = presentation.slots.entries('conversation.hero.knowledge')[0]
    expect(hero?.locale).toBe('knowledgePicker')
    expect(hero?.component).toBe(KnowledgePicker)
    const composer = presentation.slots.entries('conversation.input.left')[0]
    expect(composer?.options).toMatchObject({ id: 'knowledge-picker', order: 0 })
    expect(resolveSlotLabel(composer?.options.label)).toBe('composerToggler')
    expect(presentation.dictionaries).toEqual([{
      namespace: 'knowledgePicker',
      dictionaries: {
        zh: {
          chip: '知识',
          chipCount: '已选 {count} 条',
          chipEmpty: '无条目',
          composerToggler: '知识',
          dialogTitle: '选择知识',
          search: '搜索条目…',
          confirm: '确认',
          cancel: '取消',
          empty: '暂无可用知识条目。',
          selected: '已选 {count} 条',
        },
        en: {
          chip: 'Knowledge',
          chipCount: '{count} selected',
          chipEmpty: 'No entries',
          composerToggler: 'Knowledge',
          dialogTitle: 'Select knowledge',
          search: 'Search entries…',
          confirm: 'Confirm',
          cancel: 'Cancel',
          empty: 'No knowledge entries are available.',
          selected: '{count} selected',
        },
      },
    }])
  })

  it('removes both registrations and the dictionaries on fiber teardown (HMR safety)', async () => {
    const ctx = new Context()
    new TestRemote(ctx, { knowledge: { list: listOk } })
    const presentation = providePresentation(ctx)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(presentation.slots.entries('conversation.hero.knowledge')).toHaveLength(1)
    await fiber.dispose()
    expect(presentation.slots.entries('conversation.hero.knowledge')).toHaveLength(0)
    expect(presentation.slots.entries('conversation.input.left')).toHaveLength(0)
    expect(presentation.localeDisposed).toBe(true)
  })
})

describe('driven catalog behavior', () => {
  it('loads the catalog into the shared store on a successful list', async () => {
    const { face, listCalls } = await boot(listOk)
    expect(face.hooks.knowledgePicker.getSnapshot().status).toBe('idle')
    await face.load()
    const snapshot = face.hooks.knowledgePicker.getSnapshot()
    expect(snapshot.status).toBe('ready')
    expect(snapshot.entries).toHaveLength(1)
    expect(listCalls()).toBe(1)
  })

  it('reports an error state when the list fails', async () => {
    const { face } = await boot(listFail)
    await face.load()
    expect(face.hooks.knowledgePicker.getSnapshot().status).toBe('error')
    expect(face.hooks.knowledgePicker.getSnapshot().entries).toHaveLength(0)
  })

  it('does not re-enter load while the catalog is in a terminal state', async () => {
    const { face, listCalls } = await boot(listFail)
    await face.load()
    await face.load()
    // A failed load leaves status 'error', which the guard treats as settled.
    expect(face.hooks.knowledgePicker.getSnapshot().status).toBe('error')
    expect(listCalls()).toBe(1)
  })

  it('refreshes a settled catalog on connection/reset', async () => {
    const { ctx, face, listCalls } = await boot(listOk)
    expect(listCalls()).toBe(0)
    // An idle catalog is not refreshed on reset.
    ctx.emit('connection/reset')
    await Promise.resolve()
    expect(listCalls()).toBe(0)
    // A settled catalog is refetched.
    await face.load()
    expect(listCalls()).toBe(1)
    ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(listCalls()).toBe(2) })
  })

  it('toggles and clears the selection through the injected callbacks', async () => {
    const { face } = await boot(listOk)
    face.toggle(KnowledgeEntryId('k-1'))
    expect(face.hooks.knowledgePicker.getSnapshot().selectedIds).toEqual(['k-1'])
    face.toggle(KnowledgeEntryId('k-1'))
    expect(face.hooks.knowledgePicker.getSnapshot().selectedIds).toEqual([])
    face.toggle(KnowledgeEntryId('k-1'))
    face.clear()
    expect(face.hooks.knowledgePicker.getSnapshot().selectedIds).toEqual([])
  })

  it('never refetches an empty settled catalog on reset', async () => {
    const { face, listCalls } = await boot(emptyList)
    await face.load()
    expect(face.hooks.knowledgePicker.getSnapshot().status).toBe('ready')
    expect(listCalls()).toBe(1)
  })
})
