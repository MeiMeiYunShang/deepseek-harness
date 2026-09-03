import { describe, expect, it } from 'vitest'
import { formatDuration, formatTime, GAUGE_COLOR, toneOf } from '../src/client/format.ts'

describe('format', () => {
  it('formats durations across the ms / s / mss bands', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(-5)).toBe('0s')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0s')
    expect(formatDuration(42)).toBe('42ms')
    expect(formatDuration(999)).toBe('999ms')
    expect(formatDuration(1000)).toBe('1.0s')
    expect(formatDuration(59_900)).toBe('59.9s')
    expect(formatDuration(60_000)).toBe('1m00s')
    expect(formatDuration(90_000)).toBe('1m30s')
  })

  it('formats epoch milliseconds as HH:MM:SS', () => {
    const date = new Date(2026, 0, 1, 9, 5, 7)
    expect(formatTime(date.getTime())).toBe('09:05:07')
  })

  it('maps a metric value to its severity band and color', () => {
    expect(toneOf(null)).toBe('na')
    expect(toneOf(0)).toBe('ok')
    expect(toneOf(59)).toBe('ok')
    expect(toneOf(60)).toBe('warn')
    expect(toneOf(84)).toBe('warn')
    expect(toneOf(85)).toBe('critical')
    expect(toneOf(100)).toBe('critical')
    expect(GAUGE_COLOR.na).toBe('var(--dsw-alias-label-secondary)')
    expect(GAUGE_COLOR.ok).toBe('var(--dsw-alias-state-success-primary)')
    expect(GAUGE_COLOR.warn).toBe('var(--dsw-alias-state-warn-primary)')
    expect(GAUGE_COLOR.critical).toBe('var(--dsw-alias-state-error-primary)')
  })
})
