/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-console-bridge`.
 * @module @deepseek-ai/dsh-console-bridge/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-console-bridge'

/** Cordis companion plugin name. */
export const name = 'console-bridge-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the bridge holds no durable package-local event stream
 * — its only state is in-flight command maps that the runtime GCs, and the
 * down/cmd → up/cmd/ack → up/result relationship is covered by protocol and
 * integration tests against a console fixture.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
