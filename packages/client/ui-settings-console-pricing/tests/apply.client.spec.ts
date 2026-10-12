/** What the browser half registers, when, and that it all leaves with the fiber. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { RemoteError, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject, NS } from '../src/client/index.ts'
import type { ConsolePricingCardFace } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

/** One Host view of a served namespace. */
function view(ns: string, revision = 0) {
  return { ns, schema: {}, value: {}, applies: 'live', secrets: [], revision }
}

/** @param served - namespaces the Host describes; omitted answers a failed read. */
async function bench(served?: string[]) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const describeSettings = vi.fn(() => Promise.resolve(served === undefined
    ? { ok: false, error: new RemoteError('gateway/internal', 'no provider', {}) }
    : { ok: true, value: { writable: true, hasDocument: true, namespaces: served.map(ns => view(ns)) } }))
  const remote = new TestRemote(ctx, { settings: { describe: describeSettings } })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, describeSettings, remote }
}

/** The Plugins page's item slot and the console's task-statistics action seat, as their owners declare them. */
function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'plugins.item': { kind: 'list', scope: 'root' },
      'console.task-stats.action': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

describe('ui-settings-console-pricing apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'configForms'])
  })

  it('registers the page and the console entry while the Host serves the namespace, titled in the active locale', async () => {
    const { ctx, slots } = await bench(['console-bridge', 'shell'])
    declareRoot(slots)

    await ctx.plugin({ inject: [...inject], apply }).await()

    await vi.waitFor(() => { expect(slots.entries('plugins.item')).toHaveLength(1) })
    const entry = slots.entries('plugins.item')[0]!
    expect(entry.options).toMatchObject({ id: 'console-pricing', order: 50 })
    expect(resolveSlotLabel(entry.options.label)).toBe('模型价格')
    expect(entry.locale).toBe(NS)
    const face = (entry.inject as () => Pick<ConsolePricingCardFace, 'hooks'>)()
    expect(Object.keys(face.hooks)).toEqual(['consolePricingCard'])

    const action = slots.entries('console.task-stats.action')[0]!
    expect(action.options).toMatchObject({ id: 'console-pricing' })
    expect(action.locale).toBe(NS)
    // The dialog stages its own table, so its face is a second controller's.
    expect((action.inject as () => Pick<ConsolePricingCardFace, 'hooks'>)().hooks)
      .not.toBe(face.hooks)
  })

  it('registers nothing while the namespace is not served, and withdraws both surfaces when the Host stops serving it', async () => {
    const { ctx, slots, describeSettings, remote } = await bench(['shell'])
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(describeSettings).toHaveBeenCalled() })
    expect(slots.entries('plugins.item')).toHaveLength(0)
    expect(slots.entries('console.task-stats.action')).toHaveLength(0)

    describeSettings.mockResolvedValue({
      ok: true, value: { writable: true, hasDocument: true, namespaces: [view('console-bridge', 1)] },
    })
    remote.emit('settings/document-updated', ['console-bridge', 1])
    await vi.waitFor(() => { expect(slots.entries('plugins.item')).toHaveLength(1) })
    await vi.waitFor(() => { expect(slots.entries('console.task-stats.action')).toHaveLength(1) })

    describeSettings.mockResolvedValue({ ok: true, value: { writable: true, hasDocument: true, namespaces: [] } })
    remote.emit('settings/document-updated', ['console-bridge', 2])
    await vi.waitFor(() => { expect(slots.entries('plugins.item')).toHaveLength(0) })
    await vi.waitFor(() => { expect(slots.entries('console.task-stats.action')).toHaveLength(0) })
  })

  it('collapses the page and the console entry on teardown', async () => {
    const { ctx, slots } = await bench(['console-bridge'])
    declareRoot(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await vi.waitFor(() => { expect(slots.entries('plugins.item')).toHaveLength(1) })
    expect(slots.entries('console.task-stats.action')).toHaveLength(1)

    await fiber.dispose()

    expect(slots.entries('plugins.item')).toHaveLength(0)
    expect(slots.entries('console.task-stats.action')).toHaveLength(0)
  })
})
