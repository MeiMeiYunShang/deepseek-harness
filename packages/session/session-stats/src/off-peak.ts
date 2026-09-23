/**
 * Band selection for the provider tokens the `sessionStats` fold accumulates:
 * the daily off-peak window the `console-pricing` settings namespace declares,
 * the decision one event time falls under, and the persisted-cache version
 * that decision forces.
 *
 * The window is read here, not in the fold: a projection unit's `init`/`apply`
 * receive only state and the next event (see `ProjectionDefinition` in
 * dsh-session-projection), so the unit cannot reach a service. The registrant
 * resolves the window instead and closes the resulting decision over the fold.
 *
 * @module @deepseek-ai/dsh-session-stats/off-peak
 */

/** The settings namespace declaring the off-peak window. */
export const CONSOLE_PRICING_NAMESPACE = 'console-pricing'

/**
 * A daily off-peak window: `[start, end)` as local wall-clock times in one
 * IANA zone, wrapping past midnight when `end` is not later than `start`.
 */
export interface OffPeakWindow {
  /** Window start, `HH:MM` local to `timezone`; the window includes this minute. */
  start: string
  /** Window end, `HH:MM` local to `timezone`; the window excludes this minute. */
  end: string
  /** IANA zone the two wall-clock times are local to. */
  timezone: string
}

/** Which daily price band one event time is charged at. */
export type PriceBand = 'peak' | 'offPeak'

/** `HH:MM` on a 24-hour clock, 00:00 through 23:59. */
const OFF_PEAK_TIME = /^([01][0-9]|2[0-3]):([0-5][0-9])$/

/**
 * Whether `Intl` resolves a value as a time zone, the same question the
 * console-bridge owner asks when it validates the namespace: the zone database
 * belongs to the runtime, so asking it is what keeps the two in step.
 * @param timezone - the declared zone name.
 * @returns whether the runtime accepts the name.
 */
function isResolvableTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    // An unresolvable zone is the only failure here: the options object is a
    // literal, so nothing else in this statement can throw.
    return false
  }
}

/**
 * Read the off-peak window one `console-pricing` section declares. The section
 * arrives from the settings service as `unknown`, so it is narrowed here; a
 * namespace the operator never registered, an absent `offPeak`, and a window
 * this fold could not read all answer the same way, because every one of them
 * means "no off-peak hours" rather than "an unknown split".
 * @param section - the resolved `console-pricing` section, or undefined while unregistered.
 * @returns the window, or undefined when there is none to apply.
 */
export function offPeakWindowOf(section: unknown): OffPeakWindow | undefined {
  if (typeof section !== 'object' || section === null) return undefined
  const offPeak: unknown = (section as { offPeak?: unknown }).offPeak
  if (typeof offPeak !== 'object' || offPeak === null) return undefined
  const { start, end, timezone } = offPeak as { start?: unknown; end?: unknown; timezone?: unknown }
  if (typeof start !== 'string' || typeof end !== 'string' || typeof timezone !== 'string') return undefined
  if (!OFF_PEAK_TIME.test(start) || !OFF_PEAK_TIME.test(end)) return undefined
  if (!isResolvableTimeZone(timezone)) return undefined
  return { start, end, timezone }
}

/** Minute of day a `HH:MM` window edge names; the reader has already proved the form. */
function minuteOfDay(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
}

/** The formatter a window's band decision reads local wall-clock time through. */
function wallClockFormatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Local wall-clock minute of day `time` falls on in the formatter's zone.
 * @param formatter - a formatter carrying the window's zone.
 * @param time - event time, epoch ms.
 * @returns the minute of the local day, 0 through 1439.
 */
function localMinuteOfDay(formatter: Intl.DateTimeFormat, time: number): number {
  let minutes = 0
  for (const part of formatter.formatToParts(time)) {
    if (part.type === 'hour') minutes = Number(part.value) * 60
    else if (part.type === 'minute') minutes += Number(part.value)
  }
  return minutes
}

/**
 * Build the band decision the fold applies to one event time. The decision
 * reads only the event's own time, never the clock at read time, so a replayed
 * log splits into the bands its events were served in.
 * @param window - the resolved off-peak window, or undefined for peak-only pricing.
 * @returns the band of one event time.
 */
export function priceBandOf(window: OffPeakWindow | undefined): (time: number) => PriceBand {
  if (window === undefined) return () => 'peak'
  const start = minuteOfDay(window.start)
  const end = minuteOfDay(window.end)
  const formatter = wallClockFormatter(window.timezone)
  return (time) => {
    const local = localMinuteOfDay(formatter, time)
    // `end <= start` is the window that wraps past midnight: it holds from
    // `start` to the end of the local day and again from its beginning.
    const within = start < end
      ? local >= start && local < end
      : local >= start || local < end
    return within ? 'offPeak' : 'peak'
  }
}

/** FNV-1a 32-bit fingerprint of a window's canonical text. */
function fingerprint(text: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0
  }
  return hash
}

/** Fold state version with no off-peak window configured (4 held the single-bucket routes). */
const PEAK_ONLY_STATE_VERSION = 5

/**
 * The persisted-cache state version one resolved window folds under.
 *
 * Which band a step's tokens land in is part of the fold semantics, and a
 * cached row carries only a version: reusing a row folded under an earlier
 * window would keep its bands and append the new window's to them in the same
 * buckets. So the window is folded into the version, and the registry discards
 * what an earlier window produced. Windowed versions start above the peak-only
 * one, so no window can borrow a peak-only row.
 * @param window - the resolved off-peak window, or undefined for peak-only pricing.
 * @returns the version the unit registers with.
 */
export function sessionStatsStateVersion(window: OffPeakWindow | undefined): number {
  if (window === undefined) return PEAK_ONLY_STATE_VERSION
  return PEAK_ONLY_STATE_VERSION + 1 + fingerprint(`${window.start}|${window.end}|${window.timezone}`)
}
