/**
 * Console workbench button: a sidebar-footer trigger that opens the true
 * fullscreen workbench modal. The component owns only the open state; every
 * data source and verb arrives through the composed props shares.
 */

import { useState } from 'react'
import { IconCodeOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the useSessions / useSessionPendingInteraction standard hooks.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the useWorkspaces standard hook (GlobalStandardProps merge).
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { ConsoleStoreState, ConsoleStoreWrite } from './consoleStore.ts'
import { NS } from './locales.ts'
import type { ConsoleServices } from './services.ts'
import type { ChatFetcher } from './SmartQA.tsx'
import type { WorkbenchProps } from './Workbench.tsx'
import { Workbench } from './Workbench.tsx'
import css from './console.module.css'

/** Selected model identity for the Smart Q&A panel. */
export interface ConsoleQaModel {
  /** Provider route id. */
  provider: string
  /** Model id. */
  model: string
}

/** The injected face: store writers, service verbs, chat, and the model. */
export interface ConsoleFaces {
  /** Console store writers. */
  store: ConsoleStoreWrite
  /** Service verbs. */
  services: ConsoleServices
  /** Streams Smart Q&A completions over the `chat` Remote. */
  chat: ChatFetcher
  /** Default Smart Q&A model, or null when none is resolvable. */
  defaultModel: ConsoleQaModel | null
}

/** Composed props: slot runtime + injected face + console dictionary. */
export type ConsoleButtonProps =
  PropsRuntime<'sidebar.footer.action'>
  & InjectFace<{ hooks: { console: HostObservable<ConsoleStoreState> } } & ConsoleFaces>
  & PropsLocale<typeof NS>

/**
 * Console button trigger plus the workbench modal. Shows the wide label only in
 * the expanded sidebar column; keeps the code glyph in every mode.
 * @param props - slot runs plus the injected workbench face.
 * @returns the trigger button and the fullscreen modal when open.
 */
export function ConsoleButton(props: ConsoleButtonProps) {
  const [open, setOpen] = useState(false)
  const { t, wide } = props
  const byId = props.useSessions(value => value.byId)
  const current = props.useSessions(value => value.current)
  const workspace = props.useWorkspaces(value => value)
  const pending = props.useSessionPendingInteraction(value => value)

  const archived = new Set(workspace.archivedSessionIds)
  const workspaces = workspace.items.map(item => ({ id: item.workspaceId, label: item.title }))
  const pendingKindOf = (id: string): string | undefined => pending.get(id as never)?.kind

  const workbench: WorkbenchProps = {
    t,
    onClose: () => { setOpen(false) },
    byId,
    current,
    archived,
    titleOf: id => titleOf(byId, id),
    pendingKindOf,
    workspaces,
    useConsole: props.useConsole,
    store: props.store,
    services: props.services,
    chat: props.chat,
    defaultModel: props.defaultModel,
  }
  return (
    <>
      <button
        type="button"
        className={css.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('trigger')}
        onClick={() => { setOpen(true) }}
      >
        <IconCodeOutline16 size={16} className={css.triggerIcon} />
        {wide && <span className={css.triggerLabel}>{t('trigger')}</span>}
      </button>
      {open && <Workbench {...workbench} />}
    </>
  )
}

/** Resolve a session's display title from the rows map. */
function titleOf(byId: Record<string, SessionSummary>, id: string): string | undefined {
  return byId[id]?.displayTitle
}
