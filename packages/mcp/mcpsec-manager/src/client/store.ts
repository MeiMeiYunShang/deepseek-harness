/**
 * MCP security settings store: the server catalog and the usage-stats window
 * shared by the settings section and the risk-alert overlay. The Host stays the
 * single fact source — every mutation is issued through the `/mcpsec` RPC
 * channel and the store re-reads the next `list` + `stats` snapshot. The
 * add/edit form drafts and the dismiss-toast signature are component-local;
 * this store carries only the shared catalog facts.
 */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { ServerView, StatsData } from './types.ts'

/** Page snapshot: catalog load state, the server list, and the stats window. */
export interface McpSecState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  servers: readonly ServerView[]
  stats: StatsData
}

const EMPTY_STATS: StatsData = {
  threshold: 50,
  windowMs: 0,
  servers: [],
  alerts: [],
}

/** The page store's complete write set. */
type McpSecActions = {
  beginLoad: (draft: McpSecState) => void
  setData: (draft: McpSecState, servers: readonly ServerView[], stats: StatsData) => void
  setFailed: (draft: McpSecState, message: string) => void
}

const INITIAL: McpSecState = {
  status: 'idle',
  error: null,
  servers: [],
  stats: EMPTY_STATS,
}

/**
 * Declare the MCP security settings store.
 * @returns a non-persisted store handle whose instance is owned by the plugin
 * closure (shared with the section and the overlay through the store seat).
 */
export function createMcpSecStore(): EngineStoreHandle<McpSecState, McpSecActions> {
  return defineStore({
    init: () => INITIAL,
    actions: {
      beginLoad(draft): void {
        if (draft.status === 'ready') return
        draft.status = 'loading'
        draft.error = null
      },
      setData(draft, servers, stats): void {
        draft.servers = servers
        draft.stats = stats
        draft.error = null
        draft.status = 'ready'
      },
      setFailed(draft, message): void {
        draft.error = message
        draft.status = 'error'
      },
    },
  })
}
