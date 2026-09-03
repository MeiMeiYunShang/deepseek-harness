import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** Session-status card view: the stats counters or the per-session grid. */
export type SessionView = 'stats' | 'grid'

/** A timeline row's coarse kind (drives its label and tone). */
export type TimelineKind = 'activity' | 'status'

/** Whether the timeline renders every event or only status/activity rows. */
export type TimelineMode = 'all' | 'brief'

/** One derived timeline entry from a forwarded `api-session/*` event. */
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
  setTimelineScope: (sessionId: string | undefined) => void
}

/** Console store state: the live activity/timeline the apply closure feeds. */
export interface ConsoleStoreState {
  timeline: TimelineEntry[]
  seq: number
  /** Latest host resource sample, or `null` before the first frame arrives. */
  systemStatus: SystemStatus | null
  /** Selected timeline verbosity. */
  timelineMode: TimelineMode
  /** Session-status card view. */
  sessionView: SessionView
  /** Grid-selected session id (drives the timeline detail and composer). */
  selectedSession: string | undefined
  /** Timeline scope: one session id, or `undefined` for the whole list. */
  timelineScope: string | undefined
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
  setTimelineScope: (draft: ConsoleStoreState, sessionId: string | undefined) => void
}

/**
 * Console store: holds the live activity timeline the apply closure feeds, the
 * selected timeline verbosity, the session-status view, the grid selection, and
 * the timeline scope. The component reads it through the `useStore` share.
 * @returns the store handle.
 */
export function createConsoleStore(): EngineStoreHandle<ConsoleStoreState, ConsoleStoreActions> {
  return defineStore({
    init: (): ConsoleStoreState => ({
      timeline: [],
      seq: 0,
      systemStatus: null,
      timelineMode: 'brief',
      sessionView: 'stats',
      selectedSession: undefined,
      timelineScope: undefined,
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
      setTimelineScope(draft, sessionId): void {
        draft.timelineScope = sessionId
      },
    },
  })
}
