/** Session-status presentation derivation: phase, grid-filter bucket, and label keys. */

import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ConsoleKey } from './locales.ts'

/** A session's coarse status phase (drives the grid square color / aria label). */
export type SessionPhase =
  | 'running'
  | 'planning'
  | 'pending'
  | 'waiting'
  | 'available'
  | 'archived'

/**
 * Derive a session's status phase from its summary plus the pending-interaction
 * and archival context. Running wins over every signal; a session with a
 * question or plan-review pending reads as waiting/planning; an archived id is
 * always archived; the remaining sessions are available.
 * @param summary - session summary.
 * @param pendingKind - the pending interaction kind for this session, if any.
 * @param archived - whether the session id is in the archived set.
 * @returns the display phase.
 */
export function sessionPhase(
  summary: SessionSummary,
  pendingKind: string | undefined,
  archived: boolean,
): SessionPhase {
  if (archived) return 'archived'
  if (summary.running) return 'running'
  if (pendingKind === 'plan-review') return 'planning'
  if (pendingKind === 'question') return 'pending'
  return 'available'
}

/** Label key for a session phase (grid aria description and tone legend).
 * @param phase - the session phase.
 * @returns the dictionary key to translate. */
export function sessionPhaseLabel(phase: SessionPhase): ConsoleKey {
  switch (phase) {
    case 'running': return 'sessionStatus.running'
    case 'planning': return 'sessionStatus.planning'
    case 'pending': return 'sessionStatus.pending'
    case 'waiting': return 'sessionStatus.waiting'
    case 'archived': return 'sessionStatus.archived'
    default: return 'sessionStatus.available'
  }
}

/**
 * A session's grid-filter bucket. Unlike {@link SessionPhase}, the five buckets
 * are disjoint and total — every session belongs to exactly one — because they
 * decide whether the grid shows its square rather than how that square is drawn.
 */
export type SessionBucket = 'running' | 'pending' | 'completed' | 'available' | 'archived'

/** The grid-filter buckets, in the order the filter lists them. */
export const SESSION_BUCKETS: readonly SessionBucket[] = ['running', 'pending', 'completed', 'available', 'archived']

/** Dictionary key per bucket: the four counted status labels plus the idle one. */
const BUCKET_LABEL: Record<SessionBucket, ConsoleKey> = {
  running: 'sessionRunning',
  pending: 'sessionPending',
  completed: 'sessionCompleted',
  available: 'sessionIdle',
  archived: 'sessionArchived',
}

/**
 * Assign a session to its grid-filter bucket, in precedence order
 * archived > running > pending > completed > available. Every arm below is
 * tried in that order and the last one takes whatever is left, so the buckets
 * partition the session list: no session is left unbucketed, and none is
 * claimed by two. A pending interaction of any kind awaits operator input —
 * whatever kind a domain publishes — which is the same test the statistics
 * view counts its awaiting-input tile by, so the tile never counts a session
 * the grid then leaves out of that bucket. The predicate is the kind's
 * presence alone and not an enumeration: `sessionPhase` is where the
 * `question` and `plan-review` kinds are told apart, because it draws the
 * square rather than deciding whether the grid shows it. `completed` is the
 * summary's own flag rather than a phase, which is why it can be a bucket
 * without changing {@link sessionPhase}.
 * @param summary - session summary.
 * @param pendingKind - the pending interaction kind for this session, if any.
 * @param archived - whether the session id is in the archived set.
 * @returns the single bucket this session belongs to.
 */
export function sessionBucket(
  summary: SessionSummary,
  pendingKind: string | undefined,
  archived: boolean,
): SessionBucket {
  if (archived) return 'archived'
  if (summary.running) return 'running'
  if (pendingKind !== undefined) return 'pending'
  if (summary.completed === true) return 'completed'
  return 'available'
}

/** Label key for a grid-filter bucket.
 * @param bucket - the grid-filter bucket.
 * @returns the dictionary key to translate. */
export function sessionBucketLabel(bucket: SessionBucket): ConsoleKey {
  return BUCKET_LABEL[bucket]
}
