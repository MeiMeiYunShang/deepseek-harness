import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** Session-status card view: the stats counters or the per-session grid. */
export type SessionView = 'stats' | 'grid'

/**
 * A timeline row's coarse kind (drives its label and tone): a forwarded
 * `activity` or `status` event, or the `history` row backfilled from the
 * session list when the workbench opens.
 */
export type TimelineKind = 'activity' | 'status' | 'history'

/** Whether the timeline renders every row or only status rows. */
export type TimelineMode = 'all' | 'brief'

/** A preset column layout for the workbench grid. */
export type LayoutPreset = 'balanced' | 'timeline' | 'compact'

/** The foldable workbench cards, keyed for per-card collapse state. */
export type ConsoleCardKey = 'session' | 'task' | 'system' | 'knowledge' | 'qa'

/** One derived timeline entry: a forwarded `api-session/*` event or a backfilled history row. */
export interface TimelineEntry {
  /** Monotonic insertion id (store-owned; not the session event seq). */
  id: number
  /** Owning session id (shortened for display by the renderer). */
  sessionId: string
  /** Event epoch milliseconds. */
  time: number
  /** Coarse kind of the event. */
  kind: TimelineKind
  /** Optional event detail text (e.g. an instruction or ask question). */
  detail?: string
  /** Session's human-facing title, carried by the backfilled `history` row and revealed when the row is expanded. */
  title?: string
}

/** One sampled host resource snapshot; all values are 0–100 percent (gpu nullable). */
export interface SystemStatus {
  /** CPU utilization percent. */
  cpu: number
  /** Memory utilization percent. */
  memory: number
  /** GPU utilization percent, or `null` when no adapter is available. */
  gpu: number | null
}

/** Public write face: action methods without the immer draft frame. */
export interface ConsoleStoreWrite {
  setTimelineMode: (mode: TimelineMode) => void
  setSessionView: (view: SessionView) => void
  setSelectedSession: (sessionId: string | undefined) => void
  setLayout: (layout: LayoutPreset) => void
  toggleCollapsed: (card: ConsoleCardKey) => void
  /** Open or close the workbench. */
  setOpen: (open: boolean) => void
}

/** Console store state: the live activity/timeline the apply closure feeds. */
export interface ConsoleStoreState {
  /** Whether the workbench is showing. */
  open: boolean
  timeline: TimelineEntry[]
  seq: number
  /** Latest host resource sample, or `null` before the first frame arrives. */
  systemStatus: SystemStatus | null
  /** Selected timeline verbosity. */
  timelineMode: TimelineMode
  /** Session-status card view. */
  sessionView: SessionView
  /**
   * The console's scope: `undefined` covers the whole session list. One value
   * drives the task-statistics scope line and cost, the rows the timeline
   * lists, and the instruction composer's target.
   */
  selectedSession: string | undefined
  /** Selected column layout preset. */
  layout: LayoutPreset
  /** Per-card fold state: a true value hides that card's body. */
  collapsed: Partial<Record<ConsoleCardKey, boolean>>
}

/** Timeline cap: a monitoring panel keeps a bounded recent window. */
const TIMELINE_LIMIT = 200

/** Write surface for {@link ConsoleStoreState}. */
type ConsoleStoreActions = {
  pushTimeline: (draft: ConsoleStoreState, entry: Omit<TimelineEntry, 'id'>) => void
  updateSystemStatus: (draft: ConsoleStoreState, status: SystemStatus) => void
  setTimelineMode: (draft: ConsoleStoreState, mode: TimelineMode) => void
  setSessionView: (draft: ConsoleStoreState, view: SessionView) => void
  setSelectedSession: (draft: ConsoleStoreState, sessionId: string | undefined) => void
  setLayout: (draft: ConsoleStoreState, layout: LayoutPreset) => void
  toggleCollapsed: (draft: ConsoleStoreState, card: ConsoleCardKey) => void
  setOpen: (draft: ConsoleStoreState, open: boolean) => void
}

/**
 * Console store: holds the live activity timeline the apply closure feeds, the
 * selected timeline verbosity, the session-status view, and the console's
 * selected session. The component reads it through the `useStore` share.
 * @returns the store handle.
 */
export function createConsoleStore(): EngineStoreHandle<ConsoleStoreState, ConsoleStoreActions> {
  return defineStore({
    init: (): ConsoleStoreState => ({
      open: false,
      timeline: [],
      seq: 0,
      systemStatus: null,
      timelineMode: 'all',
      sessionView: 'stats',
      selectedSession: undefined,
      layout: 'balanced',
      collapsed: {},
    }),
    actions: {
      pushTimeline(draft, entry): void {
        draft.seq += 1
        draft.timeline.push({ ...entry, id: draft.seq })
        if (draft.timeline.length > TIMELINE_LIMIT) {
          draft.timeline.splice(0, draft.timeline.length - TIMELINE_LIMIT)
        }
      },
      updateSystemStatus(draft, status): void {
        draft.systemStatus = status
      },
      setTimelineMode(draft, mode): void {
        draft.timelineMode = mode
      },
      setSessionView(draft, view): void {
        draft.sessionView = view
      },
      setSelectedSession(draft, sessionId): void {
        draft.selectedSession = sessionId
      },
      setLayout(draft, layout): void {
        draft.layout = layout
      },
      toggleCollapsed(draft, card): void {
        draft.collapsed[card] = !(draft.collapsed[card] ?? false)
      },
      setOpen(draft, open): void {
        draft.open = open
      },
    },
  })
}

/**
 * Project the client's session list into one history row per listed session,
 * ordered by ascending update time. The store appends in insertion order and
 * the timeline list renders the array reversed, so ascending input makes the
 * most recently updated session render first. Each row carries the summary's
 * human-facing title, the only identifying text the snapshot holds.
 * @param list - current session-list snapshot; a listed id without a row is skipped.
 * @returns one `history` row per listed session, oldest first.
 */
export function historyEntries(list: SessionListState): Omit<TimelineEntry, 'id'>[] {
  const rows: Omit<TimelineEntry, 'id'>[] = []
  for (const id of list.ids) {
    const summary = list.byId[id]
    if (summary === undefined) continue
    rows.push({ sessionId: summary.id, time: summary.updatedAt, kind: 'history', title: summary.displayTitle })
  }
  rows.sort((left, right) => left.time - right.time)
  return rows
}
