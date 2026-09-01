import { describe, expect, it } from 'vitest'
import { timelineLabelKey, timelineTone, shortId } from '../src/client/timelineText.ts'

describe('timelineText', () => {
  it('maps known timeline kinds to dictionary keys and unknown kinds to the activity label', () => {
    expect(timelineLabelKey('activity')).toBe('timelineActivity')
    expect(timelineLabelKey('status')).toBe('timelineStatus')
    expect(timelineLabelKey('call')).toBe('timelineActivity')
  })

  it('distinguishes the dot tone by kind', () => {
    expect(timelineTone('activity')).toBe('info')
    expect(timelineTone('status')).toBe('action')
    expect(timelineTone('other')).toBe('info')
  })

  it('shortens long session ids to a stable trailing suffix', () => {
    expect(shortId('session-12345678')).toBe('345678')
    expect(shortId('abc')).toBe('abc')
  })
})
