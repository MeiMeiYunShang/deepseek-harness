/**
 * MCP security manager plugin, browser half: registers the "MCP 安全" settings
 * section plus a frame-wide risk-alert toast. All host communication goes over
 * the loopback-only `/mcpsec` Connection RPC channel; secret values never reach
 * the page. The Host stays the single fact source and the page re-reads the
 * `list` + `stats` snapshot after every write and on a refresh timer.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConnectionRpcResult, ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import { createMcpSecStore } from './store.ts'
import type { NpmPackage, ServerView, StatsData } from './types.ts'
import { en, NS, zh, type McpSecLocaleKey } from './locales.ts'
import { McpSecSection, type McpSecSectionInjected } from './McpSecSection.tsx'
import { McpSecAlert } from './McpSecAlert.tsx'

export type { McpSecSectionInjected, McpSecSectionProps } from './McpSecSection.tsx'
export type { McpSecAlertProps } from './McpSecAlert.tsx'
export type { McpSecState } from './store.ts'
export type { AlertEntry, NpmPackage, ServerView, StatsData, StatsRow } from './types.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The MCP security settings page copy. */
    mcpsec: McpSecLocaleKey
  }
}

/** Package-private RPC channel (loopback-only; the host half owns it). */
const RPC_CHANNEL = '/mcpsec'

/** Refresh interval for the server list and stats window (ms). */
const REFRESH_MS = 8000

/** Required services: the slot registry, locale, and connection RPC. */
export const inject = ['slots', 'locale', 'connection']

/**
 * Register the MCP security section and the risk overlay once their slot
 * declarations are on the ledger, and wire their shared store to `/mcpsec`.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'mcpsec-manager: dictionaries')
  const t = ctx.locale.bind(NS)

  const connection = ctx.get('connection') as ConnectionHandle
  const store = createMcpSecStore()
  let bound: BoundActions<typeof store> | undefined
  let fetching = false

  /** Call one `/mcpsec` endpoint. */
  async function call(endpoint: string, payload: unknown = null): Promise<ConnectionRpcResult<unknown>> {
    return connection.rpc.call(RPC_CHANNEL, endpoint, payload)
  }

  /** Shape a failed `list`/`stats` result into a store error message. */
  function failureText(results: readonly ConnectionRpcResult<unknown>[]): string {
    for (const result of results) {
      if (!result.ok) return result.error.message
    }
    /* v8 ignore next -- the caller only passes results with at least one !ok, so the loop always returns */
    return t('unknownError')
  }

  async function refresh(): Promise<void> {
    if (fetching || bound === undefined) return
    fetching = true
    bound.beginLoad()
    try {
      const [list, stats] = await Promise.all([call('list'), call('stats')])
      if (!list.ok || !stats.ok) {
        bound.setFailed(failureText([list, stats]))
        return
      }
      const servers = (list.value as { servers: ServerView[] }).servers
      bound.setData(servers, stats.value as StatsData)
    } finally {
      fetching = false
    }
  }

  // Live refresh while the plugin is mounted so the risk toast stays current.
  ctx.effect(() => {
    const timer = setInterval(() => { void refresh() }, REFRESH_MS)
    return () => { clearInterval(timer) }
  }, 'mcpsec-manager: refresh timer')

  const injected = (actions: BoundActions<typeof store>): McpSecSectionInjected => {
    bound = actions
    return {
      refresh: async () => { await refresh() },
      add: async (input) => {
        const result = await call('add', input)
        if (!result.ok) throw new Error(result.error.message)
        await refresh()
      },
      remove: async (id) => {
        const result = await call('remove', { id })
        if (!result.ok) throw new Error(result.error.message)
        await refresh()
      },
      setEnabled: async (id, enabled) => {
        const result = await call('setEnabled', { id, enabled })
        if (!result.ok) throw new Error(result.error.message)
        await refresh()
      },
      setScope: async (id, scope, toolRules, mergeRules) => {
        const result = await call('setScope', {
          id, scope,
          ...toolRules === undefined ? {} : { toolRules },
          ...mergeRules === undefined ? {} : { mergeRules },
        })
        if (!result.ok) throw new Error(result.error.message)
        await refresh()
      },
      edit: async (id, patch) => {
        const result = await call('edit', { id, ...patch })
        if (!result.ok) throw new Error(result.error.message)
        await refresh()
      },
      setThreshold: async (threshold) => {
        const result = await call('setThreshold', { threshold })
        if (!result.ok) throw new Error(result.error.message)
        await refresh()
      },
      clearStats: async () => {
        const result = await call('clearStats')
        if (!result.ok) throw new Error(result.error.message)
        await refresh()
      },
      npmSearch: async (query) => {
        const result = await call('npmSearch', { query, limit: 20 })
        if (!result.ok) throw new Error(result.error.message)
        return (result.value as { packages: NpmPackage[] }).packages
      },
    }
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'mcp-security',
    order: 17,
    label: () => t('nav'),
    locale: NS,
    store,
    inject: injected,
  }, McpSecSection))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'mcpsec-alert',
    order: 1000,
    locale: NS,
    store,
  }, McpSecAlert))
}
