/**
 * Durable UI notification for a failed image-recognition pass.
 * @module @deepseek-ai/dsh-image-understanding/events
 */

/** Stable machine-routing failure classification for one recognition pass. */
export type ImageUnderstandingFailureReason =
  | 'BACKEND_ERROR'
  | 'TIMEOUT'
  | 'ATTACHMENT_READ_ERROR'

/** Durable payload of `user/image-understanding-failed` (declared on the session log). */
export interface ImageUnderstandingFailedEventData {
  /** Message id of the restored prompt; the same id stays pending in the inbox. */
  messageId: string
  /** 1-based indexes of the image blocks inside the message content that failed. */
  failedIndexes: readonly number[]
  /** Stable machine-routing failure classification. */
  reason: ImageUnderstandingFailureReason
  /** User-facing Chinese explanation; UI surfaces it verbatim. */
  explanation: string
}

// The core `SessionEventMap` declares the `user/image-understanding-failed`
// payload; this package owns the reason union and shapes the event it appends.
import type { SessionEventMap } from '@deepseek-ai/dsh-session/types'

/** The exact payload type the core session log expects for this event. */
export type ImageUnderstandingFailedEvent = SessionEventMap['user/image-understanding-failed']
