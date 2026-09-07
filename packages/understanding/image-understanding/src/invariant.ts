/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-image-understanding`.
 * @module @deepseek-ai/dsh-image-understanding/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const PACKAGE_NAME = '@deepseek-ai/dsh-image-understanding'

/** Cordis companion plugin name. */
export const name = 'image-understanding-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Every `user/image-understanding-failed` notification must be followed, in
 * the same session, by a `next-turn` inbox insertion of the same message id
 * before the turn closes: the plugin's failure path restores the claimed
 * prompt to the pending queue, and losing that restoration would drop the
 * user's message from every surface.
 */
const install: InvariantInstaller = (ctx, fail) => {
  const pending = new Set<string>()
  ctx.on('session/event', (_session, event: SessionEvent) => {
    switch (event.type) {
      case 'user/image-understanding-failed':
        pending.add(event.data.messageId)
        return
      case 'agent/inbox/spliced':
        if (event.data.target === 'next-turn') {
          const inserted = event.data.inserted.map(message => String(message.id))
          for (const id of [...pending]) {
            if (inserted.includes(id)) pending.delete(id)
          }
        }
        return
      case 'turn/end':
        if (hasPending(pending)) {
          fail(`turn ended with ${pending.size} un-restored image-understanding failure(s): ${[...pending].join(', ')}`)
        }
        return
      default:
        // Every other session event is outside this invariant's relation.
        return
    }
  })
}

/** Whether any image-understanding failure is still awaiting restoration. */
function hasPending(pending: ReadonlySet<string>): boolean {
  return pending.size > 0
}

/** The invariant installer, exported for direct unit coverage of the event relation. */
export const installInvariant = install

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
