/**
 * The band decision the `sessionStats` fold applies to an event time: the
 * `console-pricing` section is narrowed to a window, each window edge is
 * decided from the event's own wall-clock time in the window's zone, and the
 * window is what the unit's persisted-cache version stands for.
 */

import { describe, expect, it } from 'vitest'
import {
  CONSOLE_PRICING_NAMESPACE,
  offPeakWindowOf,
  priceBandOf,
  sessionStatsStateVersion,
} from '../src/off-peak.ts'

/** Epoch ms of one UTC wall-clock instant, for the zones' offsets to shift. */
function utc(hour: number, minute: number): number {
  return Date.UTC(2024, 0, 15, hour, minute)
}

describe('offPeakWindowOf', () => {
  it('names the console pricing namespace', () => {
    expect(CONSOLE_PRICING_NAMESPACE).toBe('console-pricing')
  })

  it('reads a well-formed window out of the section', () => {
    expect(offPeakWindowOf({ offPeak: { start: '22:30', end: '06:15', timezone: 'Asia/Kolkata' } }))
      .toEqual({ start: '22:30', end: '06:15', timezone: 'Asia/Kolkata' })
    expect(offPeakWindowOf({
      models: [{ provider: 'p', model: 'm', inputPerMillion: 1, outputPerMillion: 2 }],
      offPeak: { start: '00:00', end: '23:59', timezone: 'UTC' },
    })).toEqual({ start: '00:00', end: '23:59', timezone: 'UTC' })
  })

  it('answers "no window" for a section the namespace never registered or left empty', () => {
    expect(offPeakWindowOf(undefined)).toBeUndefined()
    expect(offPeakWindowOf(null)).toBeUndefined()
    expect(offPeakWindowOf('console-pricing')).toBeUndefined()
    expect(offPeakWindowOf({})).toBeUndefined()
    expect(offPeakWindowOf({ models: [] })).toBeUndefined()
    expect(offPeakWindowOf({ offPeak: null })).toBeUndefined()
  })

  it('answers "no window" for an off-peak member this fold could not read', () => {
    expect(offPeakWindowOf({ offPeak: { start: '08:00', end: '18:00' } })).toBeUndefined()
    expect(offPeakWindowOf({ offPeak: { start: 8, end: '18:00', timezone: 'UTC' } })).toBeUndefined()
    // The console-pricing owner rejects these at its write boundary; a document
    // edited around it must not reach the fold as a split it cannot compute.
    expect(offPeakWindowOf({ offPeak: { start: '8:00', end: '18:00', timezone: 'UTC' } })).toBeUndefined()
    expect(offPeakWindowOf({ offPeak: { start: '08:00', end: '24:00', timezone: 'UTC' } })).toBeUndefined()
    expect(offPeakWindowOf({ offPeak: { start: '08:00', end: '18:00', timezone: 'Mars/Olympus' } })).toBeUndefined()
  })
})

describe('priceBandOf', () => {
  it('makes every time peak when no window is configured', () => {
    const bandOf = priceBandOf(undefined)
    expect(bandOf(utc(3, 0))).toBe('peak')
    expect(bandOf(utc(23, 0))).toBe('peak')
  })

  it('decides each window edge from the event time, including exactly on the edges', () => {
    const bandOf = priceBandOf({ start: '09:00', end: '18:00', timezone: 'UTC' })
    expect(bandOf(utc(8, 59))).toBe('peak')
    // The window is half-open: `start` belongs to it, `end` does not.
    expect(bandOf(utc(9, 0))).toBe('offPeak')
    expect(bandOf(utc(17, 59))).toBe('offPeak')
    expect(bandOf(utc(18, 0))).toBe('peak')
  })

  it('decides a window that wraps past midnight from both sides of the local day', () => {
    const bandOf = priceBandOf({ start: '22:00', end: '06:00', timezone: 'UTC' })
    expect(bandOf(utc(21, 59))).toBe('peak')
    expect(bandOf(utc(22, 0))).toBe('offPeak')
    expect(bandOf(utc(23, 59))).toBe('offPeak')
    expect(bandOf(utc(0, 0))).toBe('offPeak')
    expect(bandOf(utc(5, 59))).toBe('offPeak')
    expect(bandOf(utc(6, 0))).toBe('peak')
  })

  it('reads a zone whose offset is not a whole hour', () => {
    // Asia/Kolkata is UTC+05:30, so the local edges sit on half hours of UTC.
    const bandOf = priceBandOf({ start: '09:00', end: '18:00', timezone: 'Asia/Kolkata' })
    expect(bandOf(utc(3, 29))).toBe('peak')
    expect(bandOf(utc(3, 30))).toBe('offPeak')
    expect(bandOf(utc(12, 29))).toBe('offPeak')
    expect(bandOf(utc(12, 30))).toBe('peak')
    // A window edge on a quarter hour is local, not a UTC hour boundary.
    const quarter = priceBandOf({ start: '09:15', end: '18:00', timezone: 'Asia/Kathmandu' })
    expect(quarter(utc(3, 29))).toBe('peak')
    expect(quarter(utc(3, 30))).toBe('offPeak')
  })

  it('reads equal window edges as the whole local day', () => {
    const bandOf = priceBandOf({ start: '07:00', end: '07:00', timezone: 'UTC' })
    expect(bandOf(utc(6, 59))).toBe('offPeak')
    expect(bandOf(utc(7, 0))).toBe('offPeak')
    expect(bandOf(utc(23, 59))).toBe('offPeak')
  })
})

describe('sessionStatsStateVersion', () => {
  const window = { start: '22:00', end: '06:00', timezone: 'UTC' }

  it('bumps the single-bucket version to the peak-only one', () => {
    expect(sessionStatsStateVersion(undefined)).toBe(5)
  })

  it('gives one window one version and another window another', () => {
    expect(sessionStatsStateVersion(window)).toBe(sessionStatsStateVersion({ ...window }))
    expect(sessionStatsStateVersion(window)).toBeGreaterThan(5)
    expect(sessionStatsStateVersion(window)).not.toBe(sessionStatsStateVersion({ ...window, start: '23:00' }))
    expect(sessionStatsStateVersion(window)).not.toBe(sessionStatsStateVersion({ ...window, timezone: 'Asia/Tokyo' }))
    // A windowed fold is never mistaken for a peak-only row.
    expect(sessionStatsStateVersion(window)).not.toBe(sessionStatsStateVersion(undefined))
  })
})
