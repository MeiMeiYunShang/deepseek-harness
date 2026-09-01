/**
 * Package-owned invariant companion for @deepseek-ai/dsh-host-metrics.
 * @module @deepseek-ai/dsh-host-metrics/invariant
 */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-metrics'

/** Cordis companion plugin name. */
export const name = 'host-metrics-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the sampler owns no durable relation beyond the
 * interval it clears on dispose — covered by the package's HMR-safety test.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
