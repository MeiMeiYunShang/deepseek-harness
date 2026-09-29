/**
 * The console composer's published projection: the shared per-session input
 * machine narrowed to the facts the field and its send action read. The apply
 * closure resolves that machine for the console's one scope and republishes
 * this value into a store the renderer binds; the component reads the bound
 * hook and calls the writers below, so it holds no draft and no subscription.
 */

/** One scope's composer projection. */
export interface ConsoleComposerState {
  /**
   * Whether the console's scope resolved a live input machine. No scoped
   * session, and a scoped session that resolves no binding, both answer false:
   * there is no machine to type into.
   */
  readonly ready: boolean
  /** The machine's draft for that session (empty while unbound). */
  readonly draft: string
  /**
   * Whether that session reports a failed send — `SessionSnapshot.promptError`,
   * the same object-layer fact the chat composer announces for the same draft.
   */
  readonly failed: boolean
}

/**
 * The composer's writers, closed over the apply closure's live scope
 * resolution, so both address whichever session the console currently scopes.
 */
export interface ConsoleComposerActions {
  /** Replace the scoped machine's whole draft. */
  setDraft: (text: string) => void
  /** Submit the scoped machine's current draft through its own submission path. */
  submit: () => void
}

/** The unbound projection: the console scopes no session, or none resolves a machine. */
export const UNBOUND_COMPOSER: ConsoleComposerState = { ready: false, draft: '', failed: false }

/**
 * Whether two composer projections carry the same facts. The apply closure
 * republishes on every machine revision and every session revision, so an
 * unchanged projection must keep its snapshot reference: the bound hook
 * re-renders on identity, and a revision that moves neither the draft nor the
 * send failure (a queue row, a run-state flip, another reply's token counts)
 * would otherwise redraw the field.
 * @param left - published projection.
 * @param right - candidate projection.
 * @returns whether every projected fact is equal.
 */
export function sameComposerState(left: ConsoleComposerState, right: ConsoleComposerState): boolean {
  return left.ready === right.ready && left.draft === right.draft && left.failed === right.failed
}
