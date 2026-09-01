/** Timeline label helpers: turn a row kind into copy. */

/** A timeline row's display tone (colors the leading dot). */
export type TimelineTone = 'info' | 'action'

/**
 * Label key for a timeline kind. The store only ever holds the `activity` and
 * `status` kinds (see {@link TimelineKind}), so an unknown kind degrades to the
 * activity label rather than rendering the raw kind.
 * @param kind - coarse timeline kind.
 * @returns the dictionary key to translate.
 */
export function timelineLabelKey(kind: string): 'timelineActivity' | 'timelineStatus' {
  if (kind === 'status') return 'timelineStatus'
  return 'timelineActivity'
}

/**
 * Dot tone for a timeline kind.
 * @param kind - coarse timeline kind.
 * @returns the tone class suffix.
 */
export function timelineTone(kind: string): TimelineTone {
  return kind === 'status' ? 'action' : 'info'
}

/** Shorten a session id for display (keeps a trailing stable suffix).
 * @param id - full session id.
 * @returns the trailing-6 short form, or the id unchanged when it is short. */
export function shortId(id: string): string {
  return id.length > 8 ? id.slice(-6) : id
}
