import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { AgentRegistry, AgentOptions } from '@deepseek-ai/dsh-agent'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'

/** Terminal outcome of a single DSH task. */
export interface TaskOutcome {
  /** 0 success, 1 failure, 124 honest timeout (mirrors the console contract). */
  exitCode: number
  status: 'SUCCEEDED' | 'FAILED'
  /** Aggregated assistant text, truncated to 1024 chars by the caller. */
  summary: string
  durationMs: number
}

/** Options controlling one task run. */
export interface RunTaskOptions {
  prompt: string
  cwd?: string
  provider?: string
  model?: string
  /** Hard wall-clock budget in milliseconds; on expiry the agent is cancelled. */
  timeoutMs: number
}

function pickAgentOptions(ctx: Context, options: RunTaskOptions): AgentOptions {
  const explicit = {
    ...(options.provider !== undefined ? { provider: options.provider } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
  }
  if (explicit.provider !== undefined && explicit.model !== undefined) return explicit
  // A task agent must carry a provider/model or prompt assembly fails on the
  // {{model}} variable. Fall back to the deployment default model selection
  // (the same service the headless entry point reads) when the command does not
  // pin one — otherwise "hello"-style natural-language prompts would always
  // fail.
  const defaults = ctx.get('agentDefaultModel') as { currentSelection(): { provider: string; model: string } } | undefined
  if (defaults !== undefined) {
    const { provider, model } = defaults.currentSelection()
    if (provider.length > 0 && model.length > 0) {
      return { ...explicit, provider, model }
    }
  }
  return explicit
}

/**
 * Run one prompt to completion inside a fresh DSH session and report the
 * aggregated assistant text plus a terminal exit code.
 *
 * Drives the agent exactly as the ACP bridge does: create a session, queue the
 * prompt with `followup`, await whole-agent idle, then read committed
 * `assistant/message` text from the session feed. A turn ending in `error` is a
 * failure; exceeding `timeoutMs` is an honest `124` timeout that cancels the
 * agent rather than masking the overrun.
 *
 * @param ctx - Cordis context carrying the session event stream.
 * @param agents - Agent registry used to create the task session.
 * @param options - prompt and run bounds.
 * @returns the terminal outcome.
 */
export async function runDshTask(
  ctx: Context,
  agents: AgentRegistry,
  options: RunTaskOptions,
): Promise<TaskOutcome> {
  const sessionId = SessionId(randomUUID())
  const handle = await agents.create({
    sessionId,
    // A task session must carry an absolute `cwd` or the deployment persona's
    // `{{cwd}}` variable has no value (the same trap as `{{model}}`). Fall back
    // to the process working directory, as the headless entry point does, when
    // the command does not pin one.
    meta: { cwd: options.cwd ?? process.cwd() },
    agentOptions: pickAgentOptions(ctx, options),
  })
  const texts: string[] = []
  let errored = false
  let errorMessage: string | undefined
  const off = ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (session.header.id !== sessionId) return
    if (event.type === 'assistant/message') {
      for (const block of event.data.message.content) {
        if (block.type === 'text') texts.push(block.text)
      }
    } else if (event.type === 'turn/end' && event.data.reason.kind === 'error') {
      errored = true
      errorMessage = event.data.reason.error.message
    }
  })
  const startedAt = Date.now()
  let timedOut = false
  const idle = handle.agent.whenIdle()
  const timer = setTimeout(() => {
    timedOut = true
    handle.agent.cancel({ kind: 'user' })
  }, options.timeoutMs)
  try {
    handle.agent.followup(
      createUserMessage({ content: [{ type: 'text', text: options.prompt }], source: { kind: 'user' } }),
    )
    await idle
  } finally {
    clearTimeout(timer)
    off()
  }
  const durationMs = Date.now() - startedAt
  let exitCode: number
  let status: TaskOutcome['status']
  let summary: string
  if (timedOut) {
    exitCode = 124
    status = 'FAILED'
    summary = texts.join('').trim() || '[timeout] task exceeded execTimeoutS'
  } else if (errored) {
    exitCode = 1
    status = 'FAILED'
    summary = texts.join('').trim()
      || (errorMessage !== undefined && errorMessage.length > 0 ? `[failed] ${errorMessage}` : '[failed] no assistant output')
  } else {
    exitCode = 0
    status = 'SUCCEEDED'
    summary = texts.join('').trim() || '[no output]'
  }
  if (summary.length > 1024) summary = summary.slice(0, 1024)
  await handle.dispose()
  return { exitCode, status, summary, durationMs }
}
