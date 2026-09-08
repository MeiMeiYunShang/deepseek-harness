/**
 * Knowledge settings page: a catalog list (search + category/group filtering),
 * inline create/update, delete with confirmation, a group panel, and an entry
 * detail disclosure. The Host stays the single fact source — every mutation
 * goes through the injected `knowledge` Remote callbacks and the page re-reads
 * the catalog on success.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  IconChevronDownOutline14, IconCloseOutline16, IconEditOutline16, IconPlusOutline16,
  IconSearchOutline16, IconTrashOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  KnowledgeCategory, KnowledgeEntryId, KnowledgeEntryView, KnowledgeGroupId,
} from '@deepseek-ai/dsh-api-remotes/client'
import { createKnowledgeSettingsStore } from './store.ts'
import { NS } from './locales.ts'
import css from './KnowledgeSection.module.css'

/** Stable display order for the category filter (UI-only; the Host validates). */
const CATEGORIES: readonly KnowledgeCategory[] = [
  'architecture', 'debugging', 'performance', 'pattern', 'configuration', 'api', 'workflow', 'general',
]

/** Inline editor state for a create/update row. */
interface EntryDraft {
  readonly title: string
  readonly content: string
  readonly category: KnowledgeCategory
  readonly groupId: KnowledgeGroupId | undefined
  readonly tags: string
}

const EMPTY_DRAFT: EntryDraft = {
  title: '', content: '', category: 'general', groupId: undefined, tags: '',
}

/** Registration-side business face for the Knowledge section. */
export interface KnowledgeSectionInjected {
  /** Fetch the full entry list and group catalog. */
  load: () => Promise<void>
  /** Create an entry and refetch; rejects on a wire refusal. */
  create: (input: {
    title: string
    content: string
    category: KnowledgeCategory
    tags?: readonly string[]
    groupId?: KnowledgeGroupId
  }) => Promise<void>
  /** Update an entry and refetch; rejects on a wire refusal. */
  update: (id: KnowledgeEntryId, patch: {
    title?: string
    content?: string
    category?: KnowledgeCategory
    tags?: readonly string[]
    groupId?: KnowledgeGroupId
  }) => Promise<void>
  /** Delete an entry and refetch; rejects on a wire refusal. */
  remove: (id: KnowledgeEntryId) => Promise<void>
  /** Create a group and refetch; rejects on a wire refusal. */
  createGroup: (input: { name: string; description: string }) => Promise<void>
  /** Delete a group and refetch; rejects on a wire refusal. */
  deleteGroup: (id: KnowledgeGroupId) => Promise<void>
}

/** Full component props. */
export type KnowledgeSectionProps =
  PropsRuntime<'settings.section'>
  & PropsStore<ReturnType<typeof createKnowledgeSettingsStore>>
  & PropsLocale<typeof NS>
  & InjectFace<KnowledgeSectionInjected>

type Translate = KnowledgeSectionProps['t']

function splitTags(raw: string): readonly string[] {
  return raw.split(/[\s,]/).map(tag => tag.trim()).filter(Boolean)
}

/** Join tags back into a comma/space separatable string. */
function joinTags(tags: readonly string[]): string {
  return tags.join(', ')
}

/** Select value for the editor's group seat: the id, or blank for ungrouped. */
function selectGroupValue(groupId: KnowledgeGroupId | undefined): string {
  return groupId === undefined ? '' : String(groupId)
}

/** A single entry row with its detail disclosure and actions. */
function EntryRow({ entry, expanded, onToggle, onEdit, onDelete, groupName, t }: {
  readonly entry: KnowledgeEntryView
  readonly expanded: boolean
  readonly onToggle: () => void
  readonly onEdit: () => void
  readonly onDelete: () => void
  readonly groupName: string | undefined
  readonly t: Translate
}): ReactNode {
  return (
    <li className={css.entry} data-entry-id={String(entry.id)}>
      <div className={css.entryHead}>
        <button type="button" className={css.entryToggle} aria-expanded={expanded} onClick={onToggle}>
          <IconChevronDownOutline14 className={css.chevron} aria-hidden="true" />
          <strong className={css.entryTitle}>{entry.title}</strong>
          <span className={css.entryCategory}>{entry.category}</span>
          <span className={css.entryGroup}>{groupName ?? t('unspecified')}</span>
        </button>
        <span className={css.entryActions}>
          <button type="button" className={css.actionButton} aria-label={t('edit')} onClick={onEdit}>
            <IconEditOutline16 />
          </button>
          <button type="button" className={css.actionButton} aria-label={t('delete')} onClick={onDelete}>
            <IconTrashOutline16 />
          </button>
        </span>
      </div>
      {expanded ? (
        <div className={css.entryDetail}>
          <p className={css.entryContent}>{entry.content}</p>
          {entry.tags.length === 0 ? null : <p className={css.entryTags}>{entry.tags.join(' · ')}</p>}
        </div>
      ) : null}
    </li>
  )
}

/** Full knowledge settings page. */
export function KnowledgeSection({
  useStore, load, create, update, remove, createGroup, deleteGroup, t,
}: KnowledgeSectionProps): ReactNode {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<KnowledgeCategory | ''>('')
  const [groupFilter, setGroupFilter] = useState<KnowledgeGroupId | ''>('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'edit'; id: KnowledgeEntryId } | null>(null)
  const [draft, setDraft] = useState<EntryDraft>(EMPTY_DRAFT)
  const [groupFormOpen, setGroupFormOpen] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [groupDescription, setGroupDescription] = useState('')
  const [confirm, setConfirm] = useState<{ kind: 'entry'; id: KnowledgeEntryId } | { kind: 'group'; id: KnowledgeGroupId } | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => { void load() }, [load])

  const state = useStore(snapshot => snapshot)
  const filtered = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
    return state.entries.filter((entry) => {
      if (category !== '' && entry.category !== category) return false
      if (groupFilter !== '' && entry.groupId !== groupFilter) return false
      if (terms.length === 0) return true
      const haystack = `${entry.title} ${entry.content} ${entry.tags.join(' ')}`.toLocaleLowerCase()
      return terms.some(term => haystack.includes(term))
    })
  }, [state.entries, query, category, groupFilter])

  const groupNameFor = (id: KnowledgeGroupId | undefined): string | undefined =>
    state.groups.find(group => group.id === id)?.name

  const run = async (op: () => Promise<void>): Promise<void> => {
    try {
      setFailure(null)
      await op()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    }
  }

  const submitEditor = async (): Promise<void> => {
    if (draft.title.trim() === '') return
    await run(async () => {
      /* v8 ignore next -- the save button only renders while an editor is open, so editor is never null here */
      if (editor === null) return
      const payload = {
        title: draft.title.trim(),
        content: draft.content,
        category: draft.category,
        tags: splitTags(draft.tags),
        ...draft.groupId === undefined ? {} : { groupId: draft.groupId },
      }
      if (editor.mode === 'create') {
        await create(payload)
      } else {
        await update(editor.id, payload)
      }
    })
    setEditor(null)
    setDraft(EMPTY_DRAFT)
  }

  const openCreate = (): void => {
    setEditor({ mode: 'create' })
    setDraft(EMPTY_DRAFT)
  }
  const openEdit = (entry: KnowledgeEntryView): void => {
    setEditor({ mode: 'edit', id: entry.id })
    setDraft({
      title: entry.title,
      content: entry.content,
      category: entry.category,
      groupId: entry.groupId,
      tags: joinTags(entry.tags),
    })
  }

  const submitGroup = async (): Promise<void> => {
    if (groupName.trim() === '') return
    await run(() => createGroup({ name: groupName.trim(), description: groupDescription.trim() }))
    setGroupName('')
    setGroupDescription('')
    setGroupFormOpen(false)
  }

  const content = state.status === 'error' ? (
    <div className={css.failure}>
      <p role="alert">{state.error ?? t('error')}</p>
      <button type="button" onClick={() => { void load() }}>{t('retry')}</button>
    </div>
  ) : filtered.length === 0 && state.entries.length === 0 ? (
    <p className={css.status}>{t('empty')}</p>
  ) : filtered.length === 0 ? (
    <p className={css.status}>{t('emptySearch')}</p>
  ) : (
    <ul className={css.entries}>
      {filtered.map(entry => (
        <EntryRow
          key={String(entry.id)}
          entry={entry}
          expanded={expanded === String(entry.id)}
          onToggle={() => { setExpanded(current => current === String(entry.id) ? null : String(entry.id)) }}
          onEdit={() => { openEdit(entry) }}
          onDelete={() => { setConfirm({ kind: 'entry', id: entry.id }) }}
          groupName={groupNameFor(entry.groupId)}
          t={t}
        />
      ))}
    </ul>
  )

  return (
    <div className={css.section} aria-busy={state.status === 'loading'}>
      {state.status === 'loading' && state.entries.length === 0 ? <p className={css.status}>{t('loading')}</p> : null}
      {failure !== null ? <p className={css.failure} role="alert">{failure}</p> : null}

      <div className={css.toolbar}>
        <label className={css.search}>
          <IconSearchOutline16 aria-hidden="true" />
          <input
            type="search"
            placeholder={t('search')}
            aria-label={t('search')}
            value={query}
            onChange={(event) => { setQuery(event.currentTarget.value) }}
          />
        </label>
        <select className={css.select} value={category} onChange={(event) => { setCategory(event.currentTarget.value as KnowledgeCategory | '') }}>
          <option value="">{t('allCategories')}</option>
          {CATEGORIES.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <select className={css.select} value={groupFilter} onChange={(event) => { setGroupFilter(event.currentTarget.value as KnowledgeGroupId | '') }}>
          <option value="">{t('allGroups')}</option>
          {state.groups.map(group => <option key={String(group.id)} value={String(group.id)}>{group.name}</option>)}
        </select>
        <button type="button" className={css.primaryButton} onClick={openCreate}>
          <IconPlusOutline16 /> {t('create')}
        </button>
      </div>

      <div className={css.body}>
        <div className={css.entriesColumn}>{content}</div>

        <aside className={css.groupPanel}>
          <div className={css.groupPanelHead}>
            <h3 className={css.groupTitle}>{t('group')}</h3>
            <button type="button" className={css.actionButton} aria-label={t('createGroup')} onClick={() => { setGroupFormOpen(value => !value) }}>
              <IconPlusOutline16 />
            </button>
          </div>
          {groupFormOpen ? (
            <div className={css.groupForm}>
              <input className={css.input} placeholder={t('groupName')} value={groupName} onChange={(e) => { setGroupName(e.currentTarget.value) }} />
              <input className={css.input} placeholder={t('groupDescription')} value={groupDescription} onChange={(e) => { setGroupDescription(e.currentTarget.value) }} />
              <div className={css.groupFormActions}>
                <button type="button" className={css.primaryButton} onClick={() => { void submitGroup() }}>{t('save')}</button>
                <button type="button" className={css.actionButton} aria-label={t('cancel')} onClick={() => { setGroupFormOpen(false) }}><IconCloseOutline16 /></button>
              </div>
            </div>
          ) : null}
          {state.groups.length === 0 ? (
            <p className={css.status}>{t('noGroups')}</p>
          ) : (
            <ul className={css.groupList}>
              {state.groups.map(group => (
                <li key={String(group.id)} className={css.groupRow} data-group-id={String(group.id)}>
                  <button type="button" className={css.groupNameButton} onClick={() => { setGroupFilter(group.id) }}>
                    <span className={css.groupName}>{group.name}</span>
                    <span className={css.groupCount}>{t('entryCount', { count: String(group.entryIds.length) })}</span>
                  </button>
                  <button type="button" className={css.actionButton} aria-label={t('deleteGroup')} onClick={() => { setConfirm({ kind: 'group', id: group.id }) }}>
                    <IconTrashOutline16 />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {editor !== null ? (
        <div className={css.editor}>
          <input className={css.input} placeholder={t('title')} value={draft.title} onChange={(e) => { setDraft({ ...draft, title: e.currentTarget.value }) }} />
          <textarea className={css.input} placeholder={t('content')} value={draft.content} rows={4} onChange={(e) => { setDraft({ ...draft, content: e.currentTarget.value }) }} />
          <div className={css.editorRow}>
            <select className={css.select} value={draft.category} onChange={(e) => {
              setDraft({ ...draft, category: e.currentTarget.value as KnowledgeCategory })
            }}>
              {CATEGORIES.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
            <select className={css.select} value={selectGroupValue(draft.groupId)} onChange={(e) => { setDraft({ ...draft, groupId: e.currentTarget.value === '' ? undefined : e.currentTarget.value as KnowledgeGroupId }) }}>
              <option value="">{t('unspecified')}</option>
              {state.groups.map(group => <option key={String(group.id)} value={String(group.id)}>{group.name}</option>)}
            </select>
          </div>
          <input className={css.input} placeholder={t('tags')} value={draft.tags} onChange={(e) => { setDraft({ ...draft, tags: e.currentTarget.value }) }} />
          <div className={css.editorActions}>
            <button type="button" className={css.primaryButton} onClick={() => { void submitEditor() }}>{t('save')}</button>
            <button type="button" className={css.actionButton} aria-label={t('cancel')} onClick={() => { setEditor(null) }}><IconCloseOutline16 /></button>
          </div>
        </div>
      ) : null}

      {confirm !== null ? (
        <div className={css.confirm} role="alertdialog">
          <p className={css.confirmText}>
            {confirm.kind === 'entry' ? t('deleteConfirm') : t('deleteGroupConfirm')}
          </p>
          <div className={css.confirmActions}>
            <button type="button" className={css.dangerButton} onClick={() => {
              const target = confirm
              setConfirm(null)
              void run(() => target.kind === 'entry' ? remove(target.id) : deleteGroup(target.id))
            }}>
              {t('delete')}
            </button>
            <button type="button" className={css.actionButton} onClick={() => { setConfirm(null) }}>{t('cancel')}</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
