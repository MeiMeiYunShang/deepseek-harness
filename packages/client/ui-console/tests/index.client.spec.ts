/** What the browser half registers and subscribes, and that it leaves with the fiber. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-console/client'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('en')
  ctx.provide('locale', locale)
  const chat = vi.fn(async function* () { /* no chunks */ })
  const remote = new TestRemote(ctx, { llm: { chat, listProviders: vi.fn() } })
  // The console-bridge settings scope: apply reads smartQaModel once at load.
  ctx.provide('settingsScope', {
    bind: () => ({ getSnapshot: () => ({ value: undefined }) }),
  })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, remote }
}

function declareSidebar(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'sidebar.footer.action': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-console apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'settingsScope'])
  })

  it('registers one sidebar footer action and the console dictionary', async () => {
    const { ctx, slots } = await bench()
    declareSidebar(slots)

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const entry = slots.entries('sidebar.footer.action')[0]!
    expect(entry.options).toMatchObject({ id: 'console', order: 40 })
    expect(resolveSlotLabel(entry.options.label)).toBe('Console')
    // The injected face exposes the store selector, the chat fetcher, the
    // default model, and the timeline-mode writer.
    const face = (entry.inject as unknown as () => {
      hooks: { console: { getSnapshot: () => unknown; subscribe: unknown } }
      chat: unknown
      defaultModel: unknown
      setTimelineMode: unknown
    })()
    expect(typeof face.hooks.console.getSnapshot).toBe('function')
    expect(typeof face.hooks.console.subscribe).toBe('function')
    expect(typeof face.chat).toBe('function')
    expect(face.defaultModel).toBeNull()
    expect(typeof face.setTimelineMode).toBe('function')

    await fiber.dispose()
    expect(slots.entries('sidebar.footer.action')).toHaveLength(0)
  })

  it('subscribes the store to forwarded session and host-metrics events', async () => {
    const { ctx, slots, remote } = await bench()
    declareSidebar(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    // Forwarding must reach apply's subscribers without leaking a throw.
    remote.emit('api-session/activity', ['s1', 1000])
    remote.emit('api-session/status', ['s1', true])
    remote.emit('host/metrics', [{ cpu: 10, memory: 20, gpu: null }])
    await Promise.resolve()

    await fiber.dispose()
    expect(slots.entries('sidebar.footer.action')).toHaveLength(0)
  })
})
