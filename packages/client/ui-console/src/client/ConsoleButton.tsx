/**
 * Console workbench button: a sidebar-footer trigger that opens the true
 * fullscreen workbench modal. The open state lives in the console store;
 * every data source and verb arrives through the composed props shares.
 */

import { IconCodeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionReference, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the useSessions / useSessionStatus standard hooks.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the useWorkspaces standard hook (GlobalStandardProps merge).
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: pulls this package's SlotMap merge (the task-statistics action seat).
import type {} from './slot-contract.ts'
import type { ConsoleStoreState, ConsoleStoreWrite } from './consoleStore.ts'
import type { ConsoleComposerActions, ConsoleComposerState } from './composer.ts'
import type { ComposerCandidateSource } from './candidates.ts'
import type { TimelineMessage } from './timelineMessages.ts'
import type { ModelPrice } from '@deepseek-ai/dsh-client-ui-primitives'
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

/** The injected face: store writers, service verbs, composer writers, chat, and the model. */
export interface ConsoleFaces {
  /** Console store writers. */
  store: ConsoleStoreWrite
  /** Service verbs. */
  services: ConsoleServices
  /** Writers onto the scoped session's input machine. */
  composerActions: ConsoleComposerActions
  /** The composer's `/` and `@` candidate catalogs, bound to the client Remote. */
  candidates: ComposerCandidateSource
  /** Streams Smart Q&A completions over the `chat` Remote. */
  chat: ChatFetcher
  /** Default Smart Q&A model, or null when none is resolvable. */
  defaultModel: ConsoleQaModel | null
}

/**
 * The face `apply` registers for the sidebar footer action, before the
 * renderer binds the `hooks` compartment: `apply` annotates its inject factory
 * with this type, so a registration that stops carrying one of these members
 * fails to compile.
 */
export type ConsoleInjectFace = ConsoleFaces & {
  /** Raw live sources; the renderer binds each one to a `use<Name>` selector hook. */
  hooks: {
    console: HostObservable<ConsoleStoreState>
    /** The operator's model price table for the task-statistics cost figure. */
    prices: HostObservable<readonly ModelPrice[]>
    /** The selected session's conversation, in log order; empty while nothing is scoped. */
    messages: HostObservable<readonly TimelineMessage[]>
    /** The same session's composer projection, from the shared input machine. */
    composer: HostObservable<ConsoleComposerState>
    /** The retained reference to the scoped session, or absence while none is live; the composer's session-scope seats bind through it. */
    composerScope: HostObservable<SessionReference | undefined>
  }
}

/** Composed props: slot runtime + the child seats this entry declares + injected face + console dictionary. */
export type ConsoleButtonProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsRenderSlots<'console.task-stats.action' | 'console.input.permission' | 'console.input.model'>
  & InjectFace<ConsoleInjectFace>
  & PropsLocale<typeof NS>

/**
 * Console button trigger plus the workbench modal. Shows the wide label only in
 * the expanded sidebar column; keeps the code glyph in every mode.
 * @param props - slot runs plus the injected workbench face.
 * @returns the trigger button and the fullscreen modal when open.
 */
export function ConsoleButton(props: ConsoleButtonProps) {
  const { t, wide } = props
  const open = props.useConsole(value => value.open)
  // The operator's table is read through its bound hook, so a section the
  // settings mirror accepts after this plugin mounted still prices the card.
  const prices = props.usePrices(value => value)
  const messages = props.useMessages(value => value)
  const byId = props.useSessions(value => value.byId)
  const workspace = props.useWorkspaces(value => value)
  const status = props.useSessionStatus(value => value)
  // The retained reference to the console's selected session, published by the
  // apply closure only while a live binding exists; absence means no session.
  const composerRef = props.useComposerScope(value => value)

  const archived = new Set(workspace.archivedSessionIds)
  const workspaces = workspace.items.map(item => ({ id: item.workspaceId, label: item.title }))
  // The main panel's session is the row its `mainView` reference marks; the
  // console reads the same retained-by signal the shell's title does.
  const current = Object.values(byId).find(row => (row.retainedBy.mainView ?? 0) > 0)?.id
  const statusOf = (id: string) => status.get(id as never)
  const pendingKindOf = (id: string): string | undefined => statusOf(id)?.pendingInteraction?.kind

  // The composer's permission and model controls are the chat composer's own
  // seat occupants, rendered for the console's selected session. The retained
  // reference (published by the apply closure only while a live binding exists)
  // binds them through SessionProvider; the console keeps its own text field and
  // never mounts a second editor for the session.
  const renderComposerControls = (locked: boolean): ReactNode =>
    composerRef === undefined
      ? null
      : (
        <props.SessionProvider session={composerRef}>
          {props.renderSlot('console.input.permission', { locked })}
          {props.renderSlot('console.input.model', { locked })}
        </props.SessionProvider>
      )

  const workbench: WorkbenchProps = {
    t,
    onClose: () => { props.store.setOpen(false) },
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
    prices,
    messages,
    useComposer: props.useComposer,
    composerActions: props.composerActions,
    candidates: props.candidates,
    renderSlot: props.renderSlot,
    renderComposerControls,
  }
  return (
    <>
      <button
        type="button"
        className={css.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('trigger')}
        onClick={() => { props.store.setOpen(true) }}
      >
        <IconCodeOutlineRegular size={16} className={css.triggerIcon} />
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
