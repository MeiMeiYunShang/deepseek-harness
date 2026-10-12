/**
 * The console composer's published projection: the shared per-session input
 * machine narrowed to the facts the field, its send action, and its attachment
 * rail read. The apply closure resolves that machine for the console's one
 * scope and republishes this value into a store the renderer binds; the
 * component reads the bound hook and calls the writers below, so it holds no
 * draft, no attachment registry, and no subscription.
 */

import type {
  ComposerAttachment, DraftAttachmentId, DraftFileUploads,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

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
  /**
   * The machine's ordered browser-owned attachment ids for that session. The
   * ids, not the runtime objects, live in the input state; the rail renders the
   * resolved descriptors below and gates send on the upload states.
   */
  readonly attachmentIds: readonly DraftAttachmentId[]
  /**
   * The resolved draft attachments for {@link attachmentIds}, in the same order.
   * The apply closure resolves them through the conversation owner's intake.
   */
  readonly attachments: readonly ComposerAttachment[]
  /** Live per-draft upload states keyed by file-kind draft id (images never appear). */
  readonly uploads: DraftFileUploads
  /**
   * Whether any file-kind attachment is still uploading. While true the send
   * action is disabled, mirroring the chat composer's own upload gate.
   */
  readonly uploadsPending: boolean
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
  /**
   * Register one picked batch of browser files as draft attachments on the
   * scoped machine. Where the browser shell reports host paths, entries with a
   * real path can instead be routed as literal `@path` text by the caller, so
   * `directories` names the members the drop source flagged as directories.
   * @param files - browser files to register.
   * @param directories - members the source identified as directories.
   * @returns the rejection copy key when the batch is refused, or null on success.
   */
  addFiles: (files: readonly File[], directories?: ReadonlySet<File>) => string | null
  /** Remove one browser-owned attachment id from the scoped machine. */
  removeAttachment: (id: DraftAttachmentId) => void
  /** Restart one failed file upload on the scoped session. */
  retryUpload: (id: DraftAttachmentId) => void
}

/** The unbound projection: the console scopes no session, or none resolves a machine. */
export const UNBOUND_COMPOSER: ConsoleComposerState = {
  ready: false, draft: '', failed: false, attachmentIds: [], attachments: [], uploads: {}, uploadsPending: false,
}

/**
 * Whether two composer projections carry the same facts. The apply closure
 * republishes on every machine revision and every session revision, so an
 * unchanged projection must keep its snapshot reference: the bound hook
 * re-renders on identity, and a revision that moves neither the draft, the send
 * failure, nor the attachment set (a queue row, a run-state flip, another
 * reply's token counts) would otherwise redraw the field and its rail.
 * @param left - published projection.
 * @param right - candidate projection.
 * @returns whether every projected fact is equal.
 */
export function sameComposerState(left: ConsoleComposerState, right: ConsoleComposerState): boolean {
  return left.ready === right.ready
    && left.draft === right.draft
    && left.failed === right.failed
    && left.uploadsPending === right.uploadsPending
    && left.uploads === right.uploads
    && sameIdList(left.attachmentIds, right.attachmentIds)
}

/**
 * Whether two attachment-id lists carry the same ids in the same order. The
 * machine republishes its state on every draft keystroke, and an unchanged
 * attachment set must keep the projection's reference so the rail does not
 * rebuild on unrelated revisions.
 * @param left - published id list.
 * @param right - candidate id list.
 * @returns whether every id is equal and ordered.
 */
function sameIdList(left: readonly DraftAttachmentId[], right: readonly DraftAttachmentId[]): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false
  return true
}
