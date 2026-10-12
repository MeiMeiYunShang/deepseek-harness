/** The composer projection's equality: what counts as an unchanged projection. */

import { describe, expect, it } from 'vitest'
import { sameComposerState, UNBOUND_COMPOSER } from '../src/client/composer.ts'
import type { ConsoleComposerState } from '../src/client/composer.ts'

const bound: ConsoleComposerState = {
  ready: true, draft: 'hello', failed: false, attachmentIds: [], attachments: [], uploads: {}, uploadsPending: false,
}

describe('sameComposerState', () => {
  it('holds for two projections that carry the same facts', () => {
    expect(sameComposerState(bound, { ...bound })).toBe(true)
    expect(sameComposerState(UNBOUND_COMPOSER, { ...UNBOUND_COMPOSER })).toBe(true)
  })

  it('breaks on a moved draft, readiness, or send failure', () => {
    // Each fact is compared on its own: a revision that moves one of them is a
    // new projection even when the others are untouched.
    expect(sameComposerState(bound, { ...bound, ready: false })).toBe(false)
    expect(sameComposerState(bound, { ...bound, draft: 'hello!' })).toBe(false)
    expect(sameComposerState(bound, { ...bound, failed: true })).toBe(false)
  })

  it('breaks on a moved attachment set or pending gate, and holds on an unchanged one', () => {
    // The rail re-renders when an attachment is added or removed, or when the
    // pending gate flips, but an unrelated revision carrying the same attachment
    // ids (same order) keeps the projection's reference.
    expect(sameComposerState(bound, { ...bound, attachmentIds: ['draft-0' as never] })).toBe(false)
    expect(sameComposerState(bound, { ...bound, uploadsPending: true })).toBe(false)
    expect(sameComposerState(
      { ...bound, attachmentIds: ['draft-0' as never, 'draft-1' as never] },
      { ...bound, attachmentIds: ['draft-0' as never, 'draft-1' as never] },
    )).toBe(true)
    // A reordered id list is a different attachment set.
    expect(sameComposerState(
      { ...bound, attachmentIds: ['draft-0' as never, 'draft-1' as never] },
      { ...bound, attachmentIds: ['draft-1' as never, 'draft-0' as never] },
    )).toBe(false)
  })
})

describe('UNBOUND_COMPOSER', () => {
  it('carries no draft, no attachment, and withholds the composer', () => {
    expect(UNBOUND_COMPOSER).toEqual({
      ready: false, draft: '', failed: false, attachmentIds: [], attachments: [], uploads: {}, uploadsPending: false,
    })
  })
})
