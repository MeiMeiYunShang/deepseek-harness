/**
 * Workbench modals: the rename dialog and the new-session form (workspace and
 * preset chips, the instruction textarea, and the submit action).
 */

import { useRef, useState } from 'react'
import clsx from 'clsx'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConsoleKey } from './locales.ts'
import type { NewSessionDraft } from './services.ts'
import css from './console.module.css'

/** Props for the rename dialog. */
export interface RenameModalProps {
  t: (key: ConsoleKey) => string
  open: boolean
  title: string
  onClose: () => void
  onRename: (title: string) => Promise<unknown>
}

/** A modal that renames a session to a new title. */
export function RenameModal({ t, open, title, onClose, onRename }: RenameModalProps) {
  const [draft, setDraft] = useState(title)
  const [busy, setBusy] = useState(false)
  const wasOpen = useRef(open)

  // Re-seed the draft on the open transition (a dialog opening for another
  // session carries its own title; keep the operator's in-progress edit during
  // a re-render).
  if (open && !wasOpen.current) setDraft(title)
  if (!open && wasOpen.current) setDraft(title)
  wasOpen.current = open

  async function confirm(): Promise<void> {
    const next = draft.trim()
    if (next === '' || busy) return
    setBusy(true)
    try {
      await onRename(next)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('renameTitle')} closeLabel={t('close')}>
      <div className={css.modalForm}>
        <label className={css.fieldLabel} htmlFor="console-rename">{t('rename')}</label>
        <input
          id="console-rename"
          type="text"
          className={css.textInput}
          value={draft}
          aria-label={t('renameInputAria')}
          onChange={(event) => { setDraft(event.target.value) }}
          onKeyDown={(event) => { if (event.key === 'Enter') void confirm() }}
        />
        <div className={css.modalFooter}>
          <button type="button" className={css.secondaryButton} onClick={onClose}>{t('renameCancel')}</button>
          <button
            type="button"
            className={css.sendButton}
            disabled={draft.trim() === '' || busy}
            onClick={() => { void confirm() }}
          >
            {t('renameConfirm')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** One selectable chip in the new-session form. */
export function Chip({ label, active, onSelect, dashed }: {
  label: string
  active: boolean
  onSelect: () => void
  dashed?: boolean
}) {
  return (
    <button
      type="button"
      className={clsx(css.chip, dashed === true && css.addWorkspaceChip, active && css.chipActive)}
      aria-pressed={active}
      onClick={onSelect}
    >
      {label}
    </button>
  )
}

/** Props for the new-session modal. */
export interface NewSessionModalProps {
  t: (key: ConsoleKey) => string
  open: boolean
  workspaces: readonly { readonly id: string; readonly label: string }[]
  presets: readonly { readonly id: string; readonly name: string | undefined }[]
  onClose: () => void
  onSubmit: (draft: NewSessionDraft) => Promise<unknown>
  onAddWorkspace: () => Promise<string | null>
}

/** New-session form modal: workspace + preset chips and the instruction textarea. */
export function NewSessionModal({
  t, open, workspaces, presets, onClose, onSubmit, onAddWorkspace,
}: NewSessionModalProps) {
  const [workspaceId, setWorkspaceId] = useState<string | undefined>(undefined)
  const [presetId, setPresetId] = useState<string | undefined>(undefined)
  const [instruction, setInstruction] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(): Promise<void> {
    /* v8 ignore next -- the send button is disabled without a workspace, so the
     * guard only protects the async re-entry path the UI never reaches. */
    if (workspaceId === undefined || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ workspaceId, presetId, instruction })
      onClose()
    } catch {
      setError(t('composerError'))
    } finally {
      setBusy(false)
    }
  }

  async function addWorkspace(): Promise<void> {
    const path = await onAddWorkspace()
    if (path === null) return
    setError(null)
  }

  return (
    <Modal open={open} onClose={onClose} title={t('newSessionTitle')} closeLabel={t('close')}>
      <div className={css.modalForm}>
        <label className={css.fieldLabel}>{t('workspaceLabel')}</label>
        <div className={css.chipRow}>
          {workspaces.map(workspace => (
            <Chip
              key={workspace.id}
              label={workspace.label}
              active={workspace.id === workspaceId}
              onSelect={() => { setWorkspaceId(workspace.id) }}
            />
          ))}
          <Chip label={t('addWorkspace')} active={false} dashed onSelect={() => { void addWorkspace() }} />
        </div>
        <label className={css.fieldLabel}>{t('presetLabel')}</label>
        <div className={css.chipRow}>
          <Chip
            label={t('presetNone')}
            active={presetId === undefined}
            onSelect={() => { setPresetId(undefined) }}
          />
          {presets.map(preset => (
            <Chip
              key={preset.id}
              label={preset.name ?? preset.id}
              active={preset.id === presetId}
              onSelect={() => { setPresetId(preset.id) }}
            />
          ))}
        </div>
        <label className={css.fieldLabel} htmlFor="console-instruction">{t('instructionLabel')}</label>
        <textarea
          id="console-instruction"
          className={css.textArea}
          value={instruction}
          placeholder={t('instructionPlaceholder')}
          onChange={(event) => { setInstruction(event.target.value) }}
        />
        <div className={css.modalFooterCenter}>
          <span className={css.formError}>{error ?? ''}</span>
          <button type="button" className={css.sendButton} disabled={workspaceId === undefined || busy} onClick={() => { void submit() }}>
            {t('send')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
