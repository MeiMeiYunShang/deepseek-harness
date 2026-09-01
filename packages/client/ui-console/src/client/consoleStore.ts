import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** A timeline row's coarse kind (drives its label and ton). */
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

/** Console store state: the live activity/timeline the apply closure feeds. */
export interface ConsoleStoreState {
  timeline: TimelineEntry[]
  seq: number
  /** Latest host resource sample, or `null` before the first frame arrives. */
  systemStatus: SystemStatus | null
  /** Selected timeline verbosity. */
  timelineMode: TimelineMode
}

/** Timeline cap: a monitoring panel keeps a bounded recent window. */
const TIMELINE_LIMIT = 200

/** Write surface for {@link ConsoleStoreState}. */
type ConsoleStoreActions = {
  pushTimeline: (draft: ConsoleStoreState, entry: { sessionId: string; time: number; kind: TimelineKind }) => void
  updateSystemStatus: (draft: ConsoleStoreState, status: SystemStatus) => void
  setTimelineMode: (draft: ConsoleStoreState, mode: TimelineMode) => void
}

/**
 * Console store: holds the live activity timeline the apply closure feeds and
 * the selected verbosity the timeline toggle writes. The component reads it
 * through the `useStore` share.
 * @returns the store handle.
 */
export function createConsoleStore(): EngineStoreHandle<ConsoleStoreState, ConsoleStoreActions> {
  return defineStore({
    init: (): ConsoleStoreState => ({
      timeline: [],
      seq: 0,
      systemStatus: null,
      timelineMode: 'brief',
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
    },
  })
}
