/**
 * mcpsec-manager browser half: registers the settings section and the risk
 * overlay, the locale dictionaries, the `/mcpsec` RPC wiring (list + stats
 * refresh, every mutation refetch, npm search), the fiber-teardown removal
 * (HMR safety), and the mutation-failure paths.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection/client'
import { apply, inject } from '../src/client/index.ts'
import { McpSecSection } from '../src/client/McpSecSection.tsx'
import { McpSecAlert } from '../src/client/McpSecAlert.tsx'

const ok = <T>(value: T): ConnectionRpcResult<T> => ({ ok: true, value })
const fail = (message: string): ConnectionRpcResult<unknown> => ({
  ok: false, error: { code: 'internal', message, details: {} },
})

type Result = ConnectionRpcResult<unknown>
type Route = (endpoint: string, payload: unknown) => Result

/** Provide the registries and capture the plugin's registration surface. */
function providePresentation(ctx: Context, route: Route): {
  slots: SlotRegistry
  dictionaries: unknown[]
  localeDisposed: boolean
  calls: Array<{ endpoint: string; payload: unknown }>
} {
  const slots = new SlotRegistry(ctx)
  slots.register({
    name: 'root',
    children: {
      'settings.section': { kind: 'list', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  const capture = {
    slots,
    dictionaries: [] as unknown[],
    localeDisposed: false,
    calls: [] as Array<{ endpoint: string; payload: unknown }>,
  }
  ctx.provide('locale', {
    register(namespace: string, dictionaries: unknown) {
      capture.dictionaries.push({ namespace, dictionaries })
      return () => { capture.localeDisposed = true }
    },
    bind: () => (key: string) => key,
  })
  const call = vi.fn(async (_channel: string, endpoint: string, payload: unknown): Promise<Result> => {
    capture.calls.push({ endpoint, payload })
    return route(endpoint, payload)
  })
  ctx.provide('connection', { rpc: { call } } as never)
  return capture
}

/** Boot the plugin and capture the section's injected face + the store actions. */
async function boot(route: Route = () => ok({ servers: [], threshold: 50, windowMs: 600000, alerts: [] })) {
  const ctx = new Context()
  const presentation = providePresentation(ctx, route)
  await ctx.plugin({ inject: [...inject], apply }).await()
  const section = presentation.slots.entries('settings.section')[0]
  const overlay = presentation.slots.entries('shell.overlay')[0]
  const actions = { beginLoad: vi.fn(), setData: vi.fn(), setFailed: vi.fn() }
  const face = section?.inject?.(actions as never) as {
    refresh: () => Promise<void>
    add: (input: object) => Promise<void>
    remove: (id: string) => Promise<void>
    setEnabled: (id: string, enabled: boolean) => Promise<void>
    setScope: (id: string, scope: string, rules?: Record<string, string>, merge?: boolean) => Promise<void>
    edit: (id: string, patch: object) => Promise<void>
    setThreshold: (n: number) => Promise<void>
    clearStats: () => Promise<void>
    npmSearch: (q: string) => Promise<unknown[]>
  }
  return { ctx, presentation, section, overlay, face, actions }
}

describe('apply', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection'])
  })

  it('registers the section, the overlay, and the locale dictionaries', async () => {
    const ctx = new Context()
    const presentation = providePresentation(ctx, () => ok({}))
    await ctx.plugin({ inject: [...inject], apply }).await()
    const section = presentation.slots.entries('settings.section')[0]
    const overlay = presentation.slots.entries('shell.overlay')[0]
    expect(section?.options).toMatchObject({ id: 'mcp-security', order: 17 })
    expect(section?.component).toBe(McpSecSection)
    expect(section?.locale).toBe('mcpsec')
    expect(resolveSlotLabel(section?.options.label)).toBe('nav')
    expect(overlay?.options).toMatchObject({ id: 'mcpsec-alert', order: 1000 })
    expect(overlay?.component).toBe(McpSecAlert)
    expect(presentation.dictionaries).toHaveLength(1)
    expect(presentation.dictionaries[0]).toMatchObject({ namespace: 'mcpsec' })
  })

  it('removes the registrations and the dictionaries on fiber teardown (HMR safety)', async () => {
    const ctx = new Context()
    const presentation = providePresentation(ctx, () => ok({}))
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(presentation.slots.entries('settings.section')).toHaveLength(1)
    expect(presentation.slots.entries('shell.overlay')).toHaveLength(1)
    await fiber.dispose()
    expect(presentation.slots.entries('settings.section')).toHaveLength(0)
    expect(presentation.slots.entries('shell.overlay')).toHaveLength(0)
    expect(presentation.localeDisposed).toBe(true)
  })
})

describe('driven /mcpsec behavior', () => {
  it('refreshes the catalog and stats window from list + stats', async () => {
    const route: Route = endpoint =>
      endpoint === 'list' ? ok({ servers: [{ id: 'e1' }] }) : ok({ threshold: 50, windowMs: 600000, servers: [], alerts: [] })
    const { face, actions } = await boot(route)
    await face.refresh()
    expect(actions.beginLoad).toHaveBeenCalledTimes(1)
    expect(actions.setData).toHaveBeenCalledTimes(1)
    expect(actions.setData).toHaveBeenCalledWith([{ id: 'e1' }], expect.objectContaining({ threshold: 50 }))
  })

  it('reports a failed list as an error state', async () => {
    const { face, actions } = await boot(() => fail('boom'))
    await face.refresh()
    expect(actions.setFailed).toHaveBeenCalledTimes(1)
    expect(actions.setFailed).toHaveBeenCalledWith('boom')
  })

  it('reports a failed stats window while the list succeeds', async () => {
    const route: Route = endpoint => endpoint === 'list' ? ok({ servers: [] }) : fail('stats boom')
    const { face, actions } = await boot(route)
    await face.refresh()
    expect(actions.setFailed).toHaveBeenCalledTimes(1)
    expect(actions.setFailed).toHaveBeenCalledWith('stats boom')
  })

  it('refetches after every mutation', async () => {
    const { face, presentation, actions } = await boot()
    await face.add({ serverName: 's' })
    await face.remove('e1')
    await face.setEnabled('e1', false)
    await face.setScope('e1', 'blocked')
    await face.edit('e1', { serverName: 'x' })
    await face.setThreshold(90)
    await face.clearStats()
    expect(presentation.calls.filter(c => c.endpoint !== 'list' && c.endpoint !== 'stats')).toHaveLength(7)
    expect(actions.setData.mock.calls.length).toBeGreaterThanOrEqual(7)
  })

  it('throws on every refused mutation', async () => {
    const deny: Route = endpoint =>
      endpoint === 'list' || endpoint === 'stats' ? ok({}) : fail('nope')
    const { face } = await boot(deny)
    await expect(face.add({ serverName: 's' })).rejects.toThrow('nope')
    await expect(face.remove('e1')).rejects.toThrow('nope')
    await expect(face.setEnabled('e1', false)).rejects.toThrow('nope')
    await expect(face.setScope('e1', 'blocked')).rejects.toThrow('nope')
    await expect(face.edit('e1', { serverName: 'x' })).rejects.toThrow('nope')
    await expect(face.setThreshold(90)).rejects.toThrow('nope')
    await expect(face.clearStats()).rejects.toThrow('nope')
  })

  it('returns npm search packages and throws on refusal', async () => {
    const okPkg: Route = endpoint =>
      endpoint === 'npmSearch' ? ok({ packages: [{ name: 'x' }] }) : ok({})
    const { face } = await boot(okPkg)
    await expect(face.npmSearch('foo')).resolves.toEqual([{ name: 'x' }])
    const { face: faceBroken } = await boot(() => fail('nope'))
    await expect(faceBroken.npmSearch('foo')).rejects.toThrow('nope')
  })

  it('guards against a concurrent refresh re-entry', async () => {
    const { face, actions } = await boot(() => ok({}))
    void face.refresh()
    await face.refresh()
    expect(actions.beginLoad).toHaveBeenCalledTimes(1)
    expect(actions.setFailed).not.toHaveBeenCalled()
  })

  it('treats the timer refresh as a no-op before the store is bound', async () => {
    vi.useFakeTimers()
    try {
      const ctx = new Context()
      const presentation = providePresentation(ctx, () => ok({}))
      await ctx.plugin({ inject: [...inject], apply }).await()
      vi.advanceTimersByTime(10000)
      expect(presentation.calls).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('covers the scope overload combinations', async () => {
    const { face, presentation } = await boot()
    await face.setScope('e1', 'read-only', { a: 'allow' }, true)
    await face.setScope('e1', 'blocked', { b: 'deny' })
    const scopeCalls = presentation.calls.filter(c => c.endpoint === 'setScope')
    expect(scopeCalls[0]?.payload).toEqual({ id: 'e1', scope: 'read-only', toolRules: { a: 'allow' }, mergeRules: true })
    expect(scopeCalls[1]?.payload).toEqual({ id: 'e1', scope: 'blocked', toolRules: { b: 'deny' } })
  })
})
