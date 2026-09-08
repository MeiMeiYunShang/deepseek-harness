/**
 * Knowledge picker: a chip button on the blank-session Hero and a toggler in
 * the composer tool row, both opening the same multi-select dialog. The
 * selection is staged client-side and travels with the next session prompt;
 * the catalog is a read-only projection of the Host knowledge store.
 *
 * One component serves both registers so the selection is literally one state
 * (the two entries share the injected store source). The composer entry adds
 * a slot label (`composerToggler`) and carries the `conversation.input.left`
 * owner props, neither of which this component reads.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { IconDatabaseOutline16, IconSearchOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { KnowledgeEntryId } from '@deepseek-ai/dsh-knowledge/types'
import type { KnowledgePickerEntry, KnowledgePickerSource, KnowledgePickerState } from './store.ts'
import { NS } from './locales.ts'
import css from './KnowledgePicker.module.css'

/** Registration-side business face for the knowledge picker. */
export interface KnowledgePickerInjected {
  /** Picker source bound by the renderer as useKnowledgePicker. */
  hooks: { readonly knowledgePicker: KnowledgePickerSource }
  /** Load the catalog when the control first renders. */
  load: () => Promise<void>
  /** Toggle one entry's selection. */
  toggle: (id: KnowledgeEntryId) => void
  /** Clear the current selection. */
  clear: () => void
}

/** Full component props assembled by the slot renderer. */
export type KnowledgePickerProps =
  PropsLocale<typeof NS>
  & InjectFace<KnowledgePickerInjected>

type Translate = KnowledgePickerProps['t']

/** Filter the catalog by whitespace-split, case-insensitive query terms. */
function filterEntries(entries: readonly KnowledgePickerEntry[], query: string): readonly KnowledgePickerEntry[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return entries
  return entries.filter((entry) => {
    const haystack = `${entry.title} ${entry.category} ${entry.tags.join(' ')}`.toLocaleLowerCase()
    return terms.some(term => haystack.includes(term))
  })
}

/** The shared multi-select dialog over the picker source. */
function PickerDialog({ state, toggle, confirm, onClose, t }: {
  readonly state: KnowledgePickerState
  readonly toggle: (id: KnowledgeEntryId) => void
  readonly confirm: () => void
  readonly onClose: () => void
  readonly t: Translate
}): ReactNode {
  const [query, setQuery] = useState('')
  const entries = filterEntries(state.entries, query)
  const selectedCount = state.selectedIds.length
  return (
    <Modal open onClose={onClose} title={t('dialogTitle')} headless>
      <div className={css.dialog}>
        <h3 className={css.dialogHeading}>{t('dialogTitle')}</h3>
        <label className={css.searchInput}>
          <IconSearchOutline16 aria-hidden="true" />
          <input
            type="text"
            placeholder={t('search')}
            aria-label={t('search')}
            value={query}
            onChange={(event) => { setQuery(event.currentTarget.value) }}
          />
        </label>
        <div className={css.entryList}>
          {entries.length === 0 ? <div className={css.empty}>{t('empty')}</div> : null}
          {entries.map(entry => (
            <label key={String(entry.id)} className={css.entryRow}>
              <input
                type="checkbox"
                className={css.entryCheckbox}
                checked={state.selectedIds.includes(entry.id)}
                onChange={() => { toggle(entry.id) }}
              />
              <span className={css.entryTitle}>{entry.title}</span>
              <span className={css.entryCategory}>{entry.category}</span>
            </label>
          ))}
        </div>
        <div className={css.dialogFooter}>
          <span className={css.selectedCount}>{t('selected', { count: String(selectedCount) })}</span>
          <div className={css.dialogFooterActions}>
            <button type="button" className={css.actionButton} onClick={onClose}>
              {t('cancel')}
            </button>
            <button type="button" className={css.chip} onClick={confirm}>
              {t('confirm')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

/**
 * Render the knowledge picker chip: the closed state is the hero chip / composer
 * toggler, the open state adds the selection dialog.
 * @param props - composed slot props.
 * @returns the chip element.
 */
export function KnowledgePicker({ load, toggle, useKnowledgePicker, t }: KnowledgePickerProps): ReactNode {
  const state = useKnowledgePicker(snapshot => snapshot)
  const [open, setOpen] = useState(false)

  useEffect(() => { void load() }, [load])

  const close = (): void => { setOpen(false) }
  const active = state.selectedIds.length > 0
  const loading = state.status === 'idle' || state.status === 'loading'

  const label = loading
    ? t('chip')
    : active
      ? t('chipCount', { count: String(state.selectedIds.length) })
      : state.entries.length === 0 ? t('chipEmpty') : t('chip')

  return (
    <>
      <button
        type="button"
        className={css.chip}
        data-active={active ? 'true' : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={loading}
        onClick={() => { setOpen(value => !value) }}
      >
        <span className={css.chipIcon}><IconDatabaseOutline16 size={14} /></span>
        {label}
      </button>
      {open ? (
        <PickerDialog
          state={state}
          toggle={toggle}
          confirm={close}
          onClose={close}
          t={t}
        />
      ) : null}
    </>
  )
}
