/** Pure formatting helpers: human durations, wall-clock time, and severity bands. */

/**
 * Format a millisecond wall time as a compact human duration (xms / x.xs / xmxxs).
 * @param ms - wall time in milliseconds.
 * @returns the compact duration string.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const totalSeconds = ms / 1000
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.round(totalSeconds % 60)
  return `${minutes}m${seconds.toString().padStart(2, '0')}s`
}

/** Format epoch milliseconds as HH:MM:SS.
 * @param ms - epoch milliseconds.
 * @returns the HH:MM:SS wall-clock string. */
export function formatTime(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** A resource gauge's severity band (null means no data). */
export type GaugeTone = 'na' | 'ok' | 'warn' | 'critical'

/** Map a metric value to a severity band; null means no data.
 * @param value - the percent value, or null for no sample.
 * @returns the severity band. */
export function toneOf(value: number | null): GaugeTone {
  if (value === null) return 'na'
  if (value >= 85) return 'critical'
  if (value >= 60) return 'warn'
  return 'ok'
}

/** Accent color per severity band, as a CSS variable reference. */
export const GAUGE_COLOR: Record<GaugeTone, string> = {
  na: 'var(--dsw-alias-label-secondary)',
  ok: 'var(--dsw-alias-state-success-primary)',
  warn: 'var(--dsw-alias-state-warn-primary)',
  critical: 'var(--dsw-alias-state-error-primary)',
}
