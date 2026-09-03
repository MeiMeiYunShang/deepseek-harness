import { describe, expect, it } from 'vitest'
import { foldText, FOLD_LIMIT, shortId, timelineLabelKey, timelineTone } from '../src/client/timelineText.ts'

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

  it('folds text over the default limit and leaves short text intact', () => {
    expect(FOLD_LIMIT).toBe(48)
    expect(foldText('short', 48)).toBe('short')
    expect(foldText('x'.repeat(60), 48)).toBe(`${'x'.repeat(48)}…`)
  })
})
