/** Console workbench service surface: the verbs the browser half can perform. */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** New-session form inputs captured by the create modal. */
export interface NewSessionDraft {
  readonly workspaceId: string | undefined
  readonly presetId: string | undefined
  readonly instruction: string
}

/** One agent-preset option for the new-session form. */
export interface ConsolePresetOption {
  readonly id: string
  readonly name: string | undefined
}

/** The verbs a workbench needs beyond the standard session/workspace feeds. */
export interface ConsoleServices {
  /** Open a session as the current one. */
  open: (sessionId: SessionId) => void
  /** Rename a session to a new title. */
  rename: (sessionId: SessionId, title: string) => Promise<unknown>
  /** Fork a session (adopted into the current workspace). */
  fork: (sessionId: SessionId) => Promise<unknown>
  /** Archive a session. */
  archive: (sessionId: SessionId) => Promise<unknown>
  /** Create a session in a workspace (optionally with a preset and first instruction). */
  create: (draft: NewSessionDraft) => Promise<SessionId>
  /** Apply a preset when creating a session. */
  selectPreset: (sessionId: SessionId, presetId: string) => Promise<unknown>
  /** Send one instruction to a live session. */
  sendInstruction: (sessionId: SessionId, text: string) => Promise<unknown>
  /** Open the native directory chooser for an additional workspace path. */
  pickDirectory: () => Promise<string | null>
  /** List the agent-pretests for the new-session form. */
  listPresets: () => Promise<readonly ConsolePresetOption[]>
}
