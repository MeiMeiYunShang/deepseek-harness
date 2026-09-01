/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-console`.
 * @module @deepseek-ai/dsh-client-ui-console/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-console'

/** Cordis companion plugin name. */
export const name = 'client-ui-console-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this is a browser-side console workbench whose node
 * half emits no event stream and owns no cross-plugin mutable state. Its one
 * slot registration proves disposal through the HMR-safety spec; the forwarded
 * events it subscribes to (`api-session/*`, `host/metrics`) are owned by their
 * emitting host packages and validated by the Remote assembly.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
