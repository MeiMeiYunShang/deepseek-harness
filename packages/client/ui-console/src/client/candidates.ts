/**
 * The console composer's read-only candidate catalogs. The renderer holds no
 * client context, so the apply closure builds these fetchers over
 * `ctx.remote` and hands them down; the composer's local menu calls them with
 * the scoped session id and an abort signal. Each fetcher is best-effort: a
 * failed Remote call resolves to an empty list rather than throwing, so the
 * menu simply shows nothing (the chat menu's own fold-a-failed-group rule).
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * Type-only: the Remote service merge (`ctx.remote`) plus the command, skill,
 * and file-reference namespaces the composer browses.
 */
import type {} from '@deepseek-ai/dsh-api-remotes/client'

/** One `/` menu candidate, merged from the host command catalog and the skill catalog. */
export interface ComposerCommandCandidate {
  /** Lowercase command or skill name, without the leading slash. */
  readonly name: string
  /** Human-readable summary; the catalog's own copy, never a console invention. */
  readonly description?: string
  /** Whether the command advertises free-form input (a parameterized vs a bare command). */
  readonly hasInput: boolean
  /** Which catalog produced the row, for group labelling. */
  readonly origin: 'command' | 'skill'
}

/** The candidate catalogs the console composer browses for its `/` and `@` menus. */
export interface ComposerCandidateSource {
  /**
   * The session's command and skill roster, merged into one `/` list.
   * @param sessionId - the scoped session id.
   * @param signal - cancellation for a superseded keystroke or a closed menu.
   * @returns ranked-agnostic candidates; empty when a catalog cannot be reached.
   */
  commands: (sessionId: SessionId, signal: AbortSignal) => Promise<readonly ComposerCommandCandidate[]>
  /**
   * File and directory paths under the session's working directory matching
   * `query`, for the `@` menu. The composer inserts the picked path as literal
   * text, so only the path string is needed.
   * @param sessionId - the scoped session id.
   * @param query - the `@` token typed so far.
   * @param signal - cancellation for a superseded keystroke.
   * @returns candidate paths; empty when the catalog cannot be reached.
   */
  files: (sessionId: SessionId, query: string, signal: AbortSignal) => Promise<readonly string[]>
}

/**
 * Bind the candidate catalogs to a client root's Remote service.
 * @param ctx - client root context (the `remote` service is a required inject).
 * @returns the fetchers the composer's menu calls.
 */
export function createComposerCandidates(ctx: Context): ComposerCandidateSource {
  return {
    async commands(sessionId, signal) {
      const [commandResult, skillResult] = await Promise.all([
        ctx.remote.commands.list(sessionId).catch(() => undefined),
        ctx.remote.skills.list({ sessionId }, signal).catch(() => undefined),
      ])
      const candidates: ComposerCommandCandidate[] = []
      if (commandResult?.ok === true) {
        for (const descriptor of commandResult.value) {
          candidates.push({
            name: descriptor.name,
            description: descriptor.description,
            hasInput: descriptor.input !== undefined,
            origin: 'command',
          })
        }
      }
      if (skillResult?.ok === true) {
        for (const skill of skillResult.value.skills) {
          candidates.push({
            name: skill.name,
            // The user-only marker is not reproduced in the console's compact
            // row; a `disable-model-invocation` skill still reads through its
            // description here. The catalog's own copy is shown verbatim.
            description: skill.description,
            hasInput: false,
            origin: 'skill',
          })
        }
      }
      return candidates
    },
    async files(sessionId, query, signal) {
      const result = await ctx.remote.fileReferences.list(sessionId, query, signal).catch(() => undefined)
      return result?.ok === true ? result.value.map(candidate => candidate.path) : []
    },
  }
}
