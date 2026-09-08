/**
 * Knowledge picker store: the catalog snapshot and the multi-selection shared
 * by the hero chip and the composer toggler. The catalog is a read-only view of
 * the Host's knowledge store, fetched through the `knowledge` Remote; the
 * selection is client-side until the next prompt carries the ids.
 *
 * The store is declared as a factory (module-level handles are forbidden — a
 * plugin reload must not reuse a module-global instance). Inside `apply` the
 * factory is called once and the resulting instance rides the two registers'
 * injected `hooks` compartment, so both surfaces read and write the same
 * source regardless of their differing slot scopes.
 */

import {
  defineStore,
  type EngineStoreHandle,
  type ObservableSnapshot,
} from '@deepseek-ai/dsh-client-store'
import type { KnowledgeCategory, KnowledgeEntryId } from '@deepseek-ai/dsh-knowledge/types'

/** One entry projected for the picker list (content stays host-side). */
export interface KnowledgePickerEntry {
  readonly id: KnowledgeEntryId
  readonly title: string
  readonly category: KnowledgeCategory
  readonly tags: readonly string[]
}

/** Picker snapshot: catalog load state plus the staged selection. */
export interface KnowledgePickerState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  entries: readonly KnowledgePickerEntry[]
  selectedIds: readonly KnowledgeEntryId[]
}

/** The picker store's complete write set (built from the catalog and toggle). */
type KnowledgePickerActions = {
  startLoad: (draft: KnowledgePickerState) => void
  setCatalog: (draft: KnowledgePickerState, entries: readonly KnowledgePickerEntry[]) => void
  setFailed: (draft: KnowledgePickerState) => void
  toggle: (draft: KnowledgePickerState, id: KnowledgeEntryId) => void
  clear: (draft: KnowledgePickerState) => void
}

const INITIAL: KnowledgePickerState = { status: 'idle', entries: [], selectedIds: [] }

/**
 * Declare the picker store.
 * @returns a non-persisted store handle whose instance is owned by the plugin
 * closure (shared across the hero and composer registers).
 */
export function createKnowledgePickerStore(): EngineStoreHandle<KnowledgePickerState, KnowledgePickerActions> {
  return defineStore({
    init: () => INITIAL,
    actions: {
      startLoad(draft): void {
        draft.status = 'loading'
      },
      setCatalog(draft, entries): void {
        draft.entries = entries
        draft.status = 'ready'
      },
      setFailed(draft): void {
        draft.status = 'error'
        draft.entries = []
      },
      toggle(draft, id): void {
        draft.selectedIds = draft.selectedIds.includes(id)
          ? draft.selectedIds.filter(candidate => candidate !== id)
          : [...draft.selectedIds, id]
      },
      clear(draft): void {
        draft.selectedIds = []
      },
    },
  })
}

/** The injected bare source the renderer binds to `useKnowledgePicker`. */
export type KnowledgePickerSource = ObservableSnapshot<KnowledgePickerState>
