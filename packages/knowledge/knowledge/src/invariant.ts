/** Package-owned durable knowledge invariants. @module @deepseek-ai/dsh-knowledge/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-knowledge'

/** Cordis companion plugin name. */
export const name = 'knowledge-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Validate that every live knowledge entry has non-empty required fields. */
function validateStore(fail: InvariantFailure, ctx: Context): void {
  const store = ctx.get('knowledge') as { listEntries(): Array<{ id: string; title: string; content: string; category: string }> } | undefined
  if (store === undefined) return
  for (const entry of store.listEntries()) {
    if (typeof entry.title !== 'string' || entry.title.trim().length === 0) {
      fail(`knowledge entry "${entry.id}" has empty title`)
    }
    if (typeof entry.content !== 'string' || entry.content.trim().length === 0) {
      fail(`knowledge entry "${entry.id}" has empty content`)
    }
  }
}

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Install validation for loaded knowledge entries. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  validateStore(fail, ctx)
}, { inject: ['knowledge'] })
/* jscpd:ignore-end */

/**
 * Register the knowledge invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
