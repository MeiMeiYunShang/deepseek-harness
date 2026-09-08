/** Session-status presentation derivation: phase, label key, and tone. */

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
