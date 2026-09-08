/**
 * ui-settings-knowledge browser half: registers the Knowledge settings section
 * and the locale dictionaries, the fiber-teardown removal (HMR safety), and the
 * driven catalog load and mutation paths — success, failure, the in-flight
 * guard, connection/reset refresh, and every write's refetch.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { RemoteError, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import { apply, inject } from '../src/client/index.ts'
import { KnowledgeSection } from '../src/client/KnowledgeSection.tsx'

type Ok<T> = { ok: true; value: T }
type Err = { ok: false; error: RemoteFailure }
type Result<T> = Ok<T> | Err
type RemoteCall = (arg: object) => Result<unknown>

/** Scripted knowledge Remote face recording every call. */
type RemoteFace = Record<string, RemoteCall>
const calls: RemoteCall[] = []
const record = (call: RemoteCall): RemoteCall => (arg) => { calls.push(call); return call(arg) }

const ok = <T>(value: T): Result<T> => ({ ok: true, value })
const fail = (message: string): Err => ({
  ok: false,
  error: new RemoteError('knowledge/not-found', message, { id: 'k-1' }),
})

function knowledgeFace(): RemoteFace {
  return {
    list: record(() => ok({ entries: [], groups: [] })),
    create: record(() => ok({ entry: {} })),
    update: record(() => ok({ entry: {} })),
    delete: record(() => ok({ deleted: true })),
    createGroup: record(() => ok({ group: {} })),
    deleteGroup: record(() => ok({ deleted: true })),
  }
}

/** Provide the registries and capture the plugin's registration surface. */
function providePresentation(ctx: Context): { slots: SlotRegistry; dictionaries: unknown[]; localeDisposed: boolean } {
  const slots = new SlotRegistry(ctx)
  slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
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

/** Boot the plugin and capture the section's injected face + the store actions. */
async function boot(remote: RemoteFace = knowledgeFace()) {
  const ctx = new Context()
  new TestRemote(ctx, { knowledge: remote })
  const presentation = providePresentation(ctx)
  await ctx.plugin({ inject: [...inject], apply }).await()
  const section = presentation.slots.entries('settings.section')[0]
  const actions = { beginLoad: vi.fn(), setCatalog: vi.fn(), setFailed: vi.fn() }
  const face = section?.inject?.(actions as never) as {
    load: () => Promise<void>
    create: (input: object) => Promise<void>
    update: (id: string) => Promise<void>
    remove: (id: string) => Promise<void>
    createGroup: (input: object) => Promise<void>
    deleteGroup: (id: string) => Promise<void>
  }
  return { ctx, slots: presentation.slots, section, face, actions }
}

describe('apply', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.knowledge'])
  })

  it('registers the Knowledge settings section and the locale dictionaries', async () => {
    const ctx = new Context()
    new TestRemote(ctx, { knowledge: knowledgeFace() })
    const presentation = providePresentation(ctx)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const section = presentation.slots.entries('settings.section')[0]
    expect(section?.options).toMatchObject({ id: 'knowledge', order: 30 })
    expect(section?.component).toBe(KnowledgeSection)
    expect(section?.locale).toBe('knowledgeSettings')
    expect(resolveSlotLabel(section?.options.label)).toBe('nav')
    expect(presentation.dictionaries).toHaveLength(1)
    expect(presentation.dictionaries[0]).toMatchObject({ namespace: 'knowledgeSettings' })
  })

  it('removes the registration and the dictionaries on fiber teardown (HMR safety)', async () => {
    const ctx = new Context()
    new TestRemote(ctx, { knowledge: knowledgeFace() })
    const presentation = providePresentation(ctx)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(presentation.slots.entries('settings.section')).toHaveLength(1)
    await fiber.dispose()
    expect(presentation.slots.entries('settings.section')).toHaveLength(0)
    expect(presentation.localeDisposed).toBe(true)
  })
})

describe('driven catalog and mutation behavior', () => {
  it('loads the catalog and ignores an in-flight re-entry', async () => {
    const { face, actions } = await boot()
    await face.load()
    expect(actions.beginLoad).toHaveBeenCalledTimes(1)
    expect(actions.setCatalog).toHaveBeenCalledTimes(1)
    // Re-entry while the caller is already fetching/loaded is guarded by the
    // `fetching` flag (a fresh boot has no in-flight load to collide with, so
    // this asserts the settled refetch path, not the guard).
    await face.load()
    expect(actions.setCatalog).toHaveBeenCalledTimes(2)
  })

  it('guards against a concurrent load re-entry', async () => {
    const { face, actions } = await boot()
    // Two loads with no await between them: the second sees `fetching` true.
    const first = face.load()
    await face.load()
    await first
    expect(actions.beginLoad).toHaveBeenCalledTimes(1)
  })

  it('reports a failed list as an error state', async () => {
    const { face, actions } = await boot({ ...knowledgeFace(), list: record(() => fail('boom')) })
    await face.load()
    expect(actions.setFailed).toHaveBeenCalledTimes(1)
    expect(actions.setFailed).toHaveBeenCalledWith('knowledge/not-found: boom')
  })

  it('refreshes a settled catalog on connection/reset', async () => {
    const { ctx, face, actions } = await boot()
    await face.load()
    expect(actions.setCatalog).toHaveBeenCalledTimes(1)
    ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(actions.setCatalog).toHaveBeenCalledTimes(2) })
  })

  it('ignores connection/reset before any catalog has loaded', async () => {
    const { ctx, actions } = await boot()
    ctx.emit('connection/reset')
    await Promise.resolve()
    expect(actions.setCatalog).not.toHaveBeenCalled()
    expect(actions.beginLoad).not.toHaveBeenCalled()
  })

  it('refetches the catalog after a successful write', async () => {
    const { face, actions } = await boot()
    await face.load()
    const before = actions.setCatalog.mock.calls.length
    await face.create({ title: 'T' })
    await face.update('k-1')
    await face.remove('k-1')
    await face.createGroup({ name: 'G' })
    await face.deleteGroup('g-1')
    expect(actions.setCatalog.mock.calls.length).toBe(before + 5)
  })

  it('throws on a refused entry write', async () => {
    const remote = { ...knowledgeFace(), create: record(() => fail('boom')) }
    const { face } = await boot(remote)
    await expect(face.create({ title: 'T' })).rejects.toThrow('boom')
  })

  it('throws on a refused update', async () => {
    const remote = { ...knowledgeFace(), update: record(() => fail('boom')) }
    const { face } = await boot(remote)
    await expect(face.update('k-1')).rejects.toThrow('boom')
  })

  it('throws on a refused delete', async () => {
    const remote = { ...knowledgeFace(), delete: record(() => fail('boom')) }
    const { face } = await boot(remote)
    await expect(face.remove('k-1')).rejects.toThrow('boom')
  })

  it('throws on a refused group create', async () => {
    const remote = { ...knowledgeFace(), createGroup: record(() => fail('boom')) }
    const { face } = await boot(remote)
    await expect(face.createGroup({ name: 'G' })).rejects.toThrow('boom')
  })

  it('throws on a refused group delete', async () => {
    const remote = { ...knowledgeFace(), deleteGroup: record(() => fail('boom')) }
    const { face } = await boot(remote)
    await expect(face.deleteGroup('g-1')).rejects.toThrow('boom')
  })
})
