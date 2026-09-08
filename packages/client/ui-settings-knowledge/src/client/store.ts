/**
 * Knowledge settings store: the catalog snapshot (entries + groups) plus its
 * load state. The Host stays the single fact source — every mutation is issued
 * through the `knowledge` Remote and the page re-renders from the next
 * refetch. Instance editor/detail state is component-local; this store carries
 * only the shared catalog facts.
 */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type {
  KnowledgeEntryView, KnowledgeGroupView,
} from '@deepseek-ai/dsh-api-remotes/client'

/** Page snapshot: catalog load state plus the entry and group catalog. */
export interface KnowledgeSettingsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  entries: readonly KnowledgeEntryView[]
  groups: readonly KnowledgeGroupView[]
}

/** The page store's complete write set. */
type KnowledgeSettingsActions = {
  beginLoad: (draft: KnowledgeSettingsState) => void
  setCatalog: (
    draft: KnowledgeSettingsState,
    entries: readonly KnowledgeEntryView[],
    groups: readonly KnowledgeGroupView[],
  ) => void
  setFailed: (draft: KnowledgeSettingsState, message: string) => void
}

const INITIAL: KnowledgeSettingsState = {
  status: 'idle',
  error: null,
  entries: [],
  groups: [],
}

/**
 * Declare the knowledge settings store.
 * @returns a non-persisted store handle whose instance is owned by the plugin
 * closure (shared with the section component through the store seat).
 */
export function createKnowledgeSettingsStore(): EngineStoreHandle<KnowledgeSettingsState, KnowledgeSettingsActions> {
  return defineStore({
    init: () => INITIAL,
    actions: {
      beginLoad(draft): void {
        draft.status = 'loading'
        draft.error = null
      },
      setCatalog(draft, entries, groups): void {
        draft.entries = entries
        draft.groups = groups
        draft.error = null
        draft.status = 'ready'
      },
      setFailed(draft, message): void {
        draft.error = message
        draft.entries = []
        draft.groups = []
        draft.status = 'error'
      },
    },
  })
}
