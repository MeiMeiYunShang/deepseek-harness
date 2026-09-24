/** Timeline label helpers: turn a row kind into decorative tone and folded copy. */

/** A timeline row's display tone (colors / style the leading dot). */
export type TimelineTone =
  | 'info'
  | 'action'
  | 'warn'
  | 'error'
  | 'neutral'
  | 'hollow'

/** Dictionaries keys a timeline kind can render a label from. */
export type TimelineLabelKey = 'timelineActivity' | 'timelineStatus' | 'timelineHistory'

/**
 * Label key for a timeline kind. The store only ever holds the `activity`,
 * `status`, and `history` kinds, so an unknown kind degrades to the activity
 * label rather than rendering the raw kind.
 * @param kind - coarse timeline kind.
 * @returns the dictionary key to translate.
 */
export function timelineLabelKey(kind: string): TimelineLabelKey {
  if (kind === 'status') return 'timelineStatus'
  if (kind === 'history') return 'timelineHistory'
  return 'timelineActivity'
}

/**
 * Leading-dot tone for a timeline kind. Status events read as completed
 * (green), a backfilled history row reads as the muted recorded snapshot it
 * is, and everything else as the brand-blue informational dot.
 * @param kind - coarse timeline kind.
 * @returns the tone, which selects a CSS class suffix.
 */
export function timelineTone(kind: string): TimelineTone {
  if (kind === 'status') return 'action'
  if (kind === 'history') return 'neutral'
  return 'info'
}

/** Shorten a session id for display (keeps a trailing stable suffix).
 * @param id - full session id.
 * @returns the trailing-6 short form, or the id unchanged when it is short. */
export function shortId(id: string): string {
  return id.length > 8 ? id.slice(-6) : id
}

/**
 * Fold a long per-event text to a bounded prefix. The timeline list keeps every
 * row single-line ellipsized; rows carrying more than `limit` characters render
 * a folded prefix plus an expand toggle.
 * @param text - the event text.
 * @param limit - max characters shown before the fold.
 * @returns the folded prefix, or the unchanged text when it fits.
 */
export function foldText(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}…`
}

/** Default character budget for a folded timeline row. */
export const FOLD_LIMIT = 48
