/** The composer projection's equality: what counts as an unchanged projection. */

import { describe, expect, it } from 'vitest'
import { sameComposerState, UNBOUND_COMPOSER } from '../src/client/composer.ts'
import type { ConsoleComposerState } from '../src/client/composer.ts'

const bound: ConsoleComposerState = { ready: true, draft: 'hello', failed: false }

describe('sameComposerState', () => {
  it('holds for two projections that carry the same facts', () => {
    expect(sameComposerState(bound, { ...bound })).toBe(true)
    expect(sameComposerState(UNBOUND_COMPOSER, { ready: false, draft: '', failed: false })).toBe(true)
  })

  it('breaks on a moved draft, readiness, or send failure', () => {
    // Each fact is compared on its own: a revision that moves one of them is a
    // new projection even when the other two are untouched.
    expect(sameComposerState(bound, { ...bound, ready: false })).toBe(false)
    expect(sameComposerState(bound, { ...bound, draft: 'hello!' })).toBe(false)
    expect(sameComposerState(bound, { ...bound, failed: true })).toBe(false)
  })
})

describe('UNBOUND_COMPOSER', () => {
  it('carries no draft and withholds the composer', () => {
    expect(UNBOUND_COMPOSER).toEqual({ ready: false, draft: '', failed: false })
  })
})
