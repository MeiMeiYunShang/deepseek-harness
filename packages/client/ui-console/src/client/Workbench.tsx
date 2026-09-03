/**
 * Workbench modal: the true fullscreen console panel. A custom shell (the
 * stock primitive Modal is a centered card, not a 100vw x 100vh panel) that
 * owns the mask/panel/header and the three-column grid, and hosts the nested
 * rename / new-session modals plus the session context menu.
 */

import { useState } from 'react'
import clsx from 'clsx'
import { IconCloseOutline16, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { contextMenuItems, contextAnchorRect } from './ContextMenu.tsx'
import type { ConsoleCardKey, ConsoleStoreState, ConsoleStoreWrite, LayoutPreset } from './consoleStore.ts'
import { NS, type ConsoleKey } from './locales.ts'
import type { ConsoleServices, NewSessionDraft } from './services.ts'
import type { ChatFetcher } from './SmartQA.tsx'
import { SmartQA } from './SmartQA.tsx'
import { SessionStatusCard } from './SessionStatusCard.tsx'
import { TaskStatsCard } from './TaskStatsCard.tsx'
import { SystemStatusCard } from './SystemStatusCard.tsx'
import { TimelineCard } from './TimelineCard.tsx'
import { KnowledgeCard } from './KnowledgeCard.tsx'
import { CardHeader } from './CardHeader.tsx'
import { NewSessionModal, RenameModal } from './modals.tsx'
import css from './console.module.css'

/** The selectable column layout presets and their dictionary labels. */
const LAYOUT_OPTIONS: readonly { preset: LayoutPreset; label: ConsoleKey }[] = [
  { preset: 'balanced', label: 'layoutBalanced' },
  { preset: 'timeline', label: 'layoutTimeline' },
  { preset: 'compact', label: 'layoutCompact' },
]

/** One workspace option for the new-session form. */
export interface ConsoleWorkspaceOption {
  readonly id: string
  readonly label: string
}

/** Fullscreen console dialog props (everything the workbench needs to render). */
export interface WorkbenchProps {
  /** Console-dictionary translator. */
  t: PropsLocale<typeof NS>['t']
  onClose: () => void
  /** Live session rows. */
  byId: Record<string, SessionSummary>
  /** Current session id. */
  current: string | undefined
  /** Archived session ids. */
  archived: ReadonlySet<string>
  /** Resolve a session's display title. */
  titleOf: (id: string) => string | undefined
  /** Resolve a session's pending interaction kind (feeds the grid phase). */
  pendingKindOf: (id: string) => string | undefined
  /** Live workspace options. */
  workspaces: readonly ConsoleWorkspaceOption[]
  /** Console store read hook. */
  useConsole: SnapshotSelectorHook<ConsoleStoreState>
  /** Console store writers. */
  store: ConsoleStoreWrite
  /** Service verbs. */
  services: ConsoleServices
  /** Smart Q&A fetcher. */
  chat: ChatFetcher
  /** Default Smart Q&A model. */
  defaultModel: { provider: string; model: string } | null
}

/** One open context-menu invocation. */
interface OpenContextMenu {
  id: string
  archived: boolean
  x: number
  y: number
}

/** The fullscreen workbench panel. */
export function Workbench({
  t, onClose, byId, current, archived, titleOf, pendingKindOf, workspaces, useConsole, store, services, chat, defaultModel,
}: WorkbenchProps) {
  const timeline = useConsole(value => value.timeline)
  const timelineMode = useConsole(value => value.timelineMode)
  const sessionView = useConsole(value => value.sessionView)
  const selected = useConsole(value => value.selectedSession)
  const timelineScope = useConsole(value => value.timelineScope)
  const systemStatus = useConsole(value => value.systemStatus)
  const layout = useConsole(value => value.layout)
  const collapsed = useConsole(value => value.collapsed)

  const isCollapsed = (card: ConsoleCardKey): boolean => collapsed[card] === true
  const toggleCard = (card: ConsoleCardKey): (() => void) => () => { store.toggleCollapsed(card) }

  const [contextMenu, setContextMenu] = useState<OpenContextMenu | null>(null)
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [presets, setPresets] = useState<{ readonly id: string; readonly name: string | undefined }[]>([])

  async function openNewSession(): Promise<void> {
    setNewSessionOpen(true)
    try {
      setPresets([...(await services.listPresets())] as { readonly id: string; readonly name: string | undefined }[])
    } catch {
      // The preset picker is non-blocking: an unavailable roster leaves it empty.
    }
  }

  function closeContextMenu(): void {
    setContextMenu(null)
  }

  async function createSession(draft: NewSessionDraft): Promise<unknown> {
    const id = await services.create(draft)
    if (draft.presetId !== undefined) await services.selectPreset(id, draft.presetId)
    if (draft.instruction.trim() !== '') await services.sendInstruction(id, draft.instruction.trim())
    return id
  }

  return (
    <div className={css.overlay} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div className={css.panel} role="dialog" aria-modal="true" aria-label={t('title')}>
        <div className={css.header}>
          <h1 className={css.headerTitle}>{t('title')}</h1>
          <div className={css.headerActions}>
            <div className={css.layoutSwitcher} role="group" aria-label={t('layoutAria')}>
              {LAYOUT_OPTIONS.map(option => (
                <button
                  key={option.preset}
                  type="button"
                  className={clsx(css.layoutButton, layout === option.preset && css.layoutButtonActive)}
                  aria-pressed={layout === option.preset}
                  onClick={() => { store.setLayout(option.preset) }}
                >
                  {t(option.label)}
                </button>
              ))}
            </div>
            <button type="button" className={css.closeButton} aria-label={t('close')} onClick={onClose}>
              <IconCloseOutline16 size={14} />
            </button>
          </div>
        </div>
        <div className={css.columns} data-layout={layout}>
          <div className={css.column}>
            <SessionStatusCard
              t={t}
              byId={byId}
              current={current}
              sessionView={sessionView}
              selected={selected}
              isArchived={id => archived.has(id)}
              pendingKindOf={pendingKindOf}
              setSessionView={store.setSessionView}
              selectSession={(id) => { services.open(id as SessionId) }}
              onContextMenu={(id, x, y) => { setContextMenu({ id, x, y, archived: archived.has(id) }) }}
              onNewSession={() => { void openNewSession() }}
              collapsed={isCollapsed('session')}
              onToggleCollapse={toggleCard('session')}
            />
            <TaskStatsCard t={t} byId={byId} scope={selected} titleOf={titleOf} collapsed={isCollapsed('task')} onToggleCollapse={toggleCard('task')} />
            <SystemStatusCard t={t} status={systemStatus} collapsed={isCollapsed('system')} onToggleCollapse={toggleCard('system')} />
          </div>
          <div className={css.column}>
            <TimelineCard
              t={t}
              timeline={timeline}
              timelineMode={timelineMode}
              scope={timelineScope}
              selected={selected}
              setTimelineMode={store.setTimelineMode}
              clearScope={() => { store.setTimelineScope(undefined) }}
              sendInstruction={text => sendToSession(services, selected, text)}
              collapsed={isCollapsed('timeline')}
              onToggleCollapse={toggleCard('timeline')}
            />
          </div>
          <div className={css.column}>
            <KnowledgeCard t={t} collapsed={isCollapsed('knowledge')} onToggleCollapse={toggleCard('knowledge')} />
            <div className={css.smartQACard}>
              <CardHeader t={t} title={t('smartQA')} collapsed={isCollapsed('qa')} onToggleCollapse={toggleCard('qa')} />
              {!isCollapsed('qa') && <SmartQA t={t} chat={chat} model={defaultModel} />}
            </div>
          </div>
        </div>
        {contextMenu !== null && (
          <Menu
            open
            anchor={null}
            portal
            getAnchorRect={contextAnchorRect(contextMenu.x, contextMenu.y)}
            items={contextMenuItems(t, contextMenu.archived)}
            onSelect={(action) => { dispatchContext(action, contextMenu.id, { setRenameTarget, closeContextMenu, services }) }}
            onClose={closeContextMenu}
          />
        )}
        <RenameModal
          t={t}
          open={renameTarget !== null}
          title={renameTarget === null ? '' : titleOf(renameTarget) ?? renameTarget}
          onClose={() => { setRenameTarget(null) }}
          onRename={async (next) => { await services.rename(renameTarget as SessionId, next) }}
        />
        <NewSessionModal
          t={t}
          open={newSessionOpen}
          workspaces={workspaces}
          presets={presets}
          onClose={() => { setNewSessionOpen(false) }}
          onSubmit={createSession}
          onAddWorkspace={services.pickDirectory}
        />
      </div>
    </div>
  )
}

/** Send an instruction to the selected session through the services face. */
async function sendToSession(services: ConsoleServices, selected: string | undefined, text: string): Promise<unknown> {
  /* v8 ignore next -- the composer disables itself when no session is selected,
   * so this guard only protects the inline call path the UI never reaches. */
  if (selected === undefined) throw new Error('no session selected')
  return await services.sendInstruction(selected as SessionId, text)
}

/** Dispatch a context-menu action and close the menu first. */
function dispatchContext(
  action: string,
  id: string,
  host: { setRenameTarget: (id: string | null) => void; closeContextMenu: () => void; services: ConsoleServices },
): void {
  host.closeContextMenu()
  switch (action) {
    case 'rename':
      host.setRenameTarget(id)
      break
    case 'fork':
      void host.services.fork(id as SessionId)
      break
    case 'archive':
      void host.services.archive(id as SessionId)
      break
    /* v8 ignore next -- the menu only emits the rename/fork/archive ids above */
    default:
      break
  }
}
