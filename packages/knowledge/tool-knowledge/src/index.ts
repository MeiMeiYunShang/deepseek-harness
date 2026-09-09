/**
 * Consumer-side knowledge tools, system-prompt injection, and auto-summarization.
 *
 * Registers two model-facing tools (`knowledge_search` and `save_knowledge`),
 * injects a knowledge summary into the system prompt, and optionally listens
 * for session disposal or archiving to extract reusable knowledge from the
 * ending session.
 *
 * @module @deepseek-ai/dsh-tool-knowledge
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Message } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import {
  KNOWLEDGE_CATEGORIES,
  KnowledgeGroupId,
} from '@deepseek-ai/dsh-knowledge'
import type {
  KnowledgeCategory,
  KnowledgeEntry,
} from '@deepseek-ai/dsh-knowledge'
// Declaration merge only: makes ctx.systemPrompt visible for section registration.
import type {} from '@deepseek-ai/dsh-system-prompt'
// Declaration merge only: makes AssembleContext.agent visible.
import type {} from '@deepseek-ai/dsh-agent'

export const name = 'tool-knowledge'
export const inject = ['tools', 'knowledge', 'systemPrompt', 'llm']

/** Model-facing knowledge tool configuration. */
export interface Config {
  /** Whether to enable auto-summarization on session disposal or archive. */
  autoSummarize?: boolean
  /** Maximum number of knowledge entries to extract per session summary. */
  maxSummaryEntries?: number
  /** Token budget for the system-prompt knowledge section. */
  promptBudgetTokens?: number
  /** Group ids whose entries are injected into the system prompt. */
  defaultGroupIds?: string[]
  /** Model to use for summarization (empty = extract from session header). */
  summarizeModel?: string
}

/** Schemastery configuration for the knowledge tool consumer. */
export const Config: z<Config> = z.object({
  autoSummarize: z.boolean().default(true),
  maxSummaryEntries: z.number().default(5),
  promptBudgetTokens: z.number().default(500),
  defaultGroupIds: z.array(z.string()).default([]),
  summarizeModel: z.string().default(''),
})

/** The system-prompt section name for knowledge injection. */
const KNOWLEDGE_SECTION = 'knowledge:context'

/** Exact model-visible request recorded before one auxiliary summarize dispatch. */
export interface KnowledgeSummaryLlmRequestEventData {
  /** Exact auxiliary LLM provider route. */
  readonly provider: string
  /** Exact auxiliary LLM model id. */
  readonly model: string
  /** Exact auxiliary summarize message list (the user prompt plus any framing). */
  readonly messages: Message[]
  /** Maximum number of knowledge entries requested from the session. */
  readonly maxSummaryEntries: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Log-only pre-dispatch record of one knowledge auto-summarize model request. */
    'knowledge/summary-llm-request': KnowledgeSummaryLlmRequestEventData
  }
}

/**
 * Register the knowledge tools, system-prompt section, and auto-summarize
 * listener.
 * @param ctx - plugin context carrying the knowledge store and tool registry.
 * @param config - deployment configuration for the knowledge consumer.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const autoSummarize = config.autoSummarize ?? true
  const maxSummaryEntries = config.maxSummaryEntries ?? 5
  const promptBudgetTokens = config.promptBudgetTokens ?? 500
  const defaultGroupIds = config.defaultGroupIds ?? []
  const summarizeModel = config.summarizeModel ?? ''

  registerSearchTool(ctx, promptBudgetTokens)
  registerSaveTool(ctx)
  registerPromptSection(ctx, promptBudgetTokens, defaultGroupIds)
  if (autoSummarize) {
    registerAutoSummarize(ctx, maxSummaryEntries, summarizeModel)
  }
}

// ── knowledge_search tool ────────────────────────────────────────────

/** Register the `knowledge_search` model tool. */
function registerSearchTool(ctx: Context, _promptBudgetTokens: number): void {
  ctx.tools.register(defineTool({
    name: 'knowledge_search',
    description: 'Search the knowledge base for reusable experience, debugging tips, patterns, and configurations. '
      + 'Returns matching knowledge entries with title, content, category, and tags. '
      + 'Use this when a task might benefit from previously recorded experience.',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'Search query to match against knowledge entry titles, content, and tags.',
      },
      category: {
        type: 'string',
        enum: [...KNOWLEDGE_CATEGORIES],
        description: 'Restrict results to a specific knowledge category.',
      },
      groupId: {
        type: 'string',
        description: 'Restrict results to a specific knowledge group.',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Match entries carrying any of these tags.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of entries to return (default 10).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                content: { type: 'string', required: true },
                category: { type: 'string', required: true },
                tags: { type: 'array', required: true, items: { type: 'string' } },
              },
            },
          },
          total: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.total === 0
          ? 'No matching knowledge entries found.'
          : `Found ${value.total} knowledge entries.`,
      }],
    },
    execute(args) {
      const rawTags = args.tags as readonly string[] | undefined
      const filter = {
        query: args.query,
        ...args.category !== undefined ? { category: args.category } : {},
        ...args.groupId !== undefined ? { groupId: KnowledgeGroupId(args.groupId) } : {},
        ...rawTags !== undefined && rawTags.length > 0 ? { tags: rawTags } : {},
        limit: args.limit ?? 10,
      }
      const entries = ctx.knowledge.listEntries(filter)
      return Promise.resolve({
        entries: entries.map(entry => ({
          id: entry.id,
          title: entry.title,
          content: entry.content,
          category: entry.category,
          tags: [...entry.tags],
        })),
        total: entries.length,
      })
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Search knowledge',
      kind: 'read',
      rawInput: args.query,
    }),
  }))
}

// ── save_knowledge tool ──────────────────────────────────────────────

/** Register the `save_knowledge` model tool. */
function registerSaveTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'save_knowledge',
    description: 'Save a piece of reusable experience to the shared knowledge base. '
      + 'Use this when you discover a debugging technique, architectural pattern, performance tip, '
      + 'or other reusable knowledge during the session. The entry is immediately available for '
      + 'future sessions via knowledge_search.',
    parameters: {
      title: {
        type: 'string',
        required: true,
        description: 'Short descriptive title for the knowledge entry.',
      },
      content: {
        type: 'string',
        required: true,
        description: 'Full knowledge content — the reusable experience to remember.',
      },
      category: {
        type: 'string',
        required: true,
        enum: [...KNOWLEDGE_CATEGORIES],
        description: 'Classification category for the knowledge entry.',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Free-form tags for cross-cutting discovery.',
      },
      groupId: {
        type: 'string',
        description: 'Group to assign this entry to.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          title: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Saved knowledge entry "${value.title}" (${value.id}).`,
      }],
    },
    execute(args, exec) {
      const rawTags = args.tags as readonly string[] | undefined
      const entry = ctx.knowledge.saveEntry({
        title: args.title,
        content: args.content,
        category: args.category,
        ...rawTags !== undefined ? { tags: rawTags } : {},
        ...args.groupId !== undefined ? { groupId: KnowledgeGroupId(args.groupId) } : {},
        ...exec.agent !== undefined ? { sourceSessionId: exec.agent.session.id } : {},
      })
      return Promise.resolve({ id: entry.id, title: entry.title })
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Save knowledge',
      kind: 'other',
      rawInput: args.title,
    }),
  }))
}

// ── System Prompt injection ──────────────────────────────────────────

/** Register the knowledge context section in the system prompt. */
function registerPromptSection(
  ctx: Context,
  promptBudgetTokens: number,
  defaultGroupIds: string[],
): void {
  ctx.systemPrompt.section({
    name: KNOWLEDGE_SECTION,
    order: ctx.systemPrompt.getSectionOrder('TOOL_KNOWLEDGE'),
    text: (context) => {
      if (context.agent === undefined) return ''
      const summary = buildKnowledgeSummary(ctx, promptBudgetTokens, defaultGroupIds)
      if (summary === '') return ''
      return [
        '<knowledge_context>',
        'The following knowledge entries are available from the shared knowledge base.',
        'Call `knowledge_search` for full content of relevant entries before acting on them.',
        '',
        summary,
        '</knowledge_context>',
      ].join('\n')
    },
  })
}

/** Build a token-budgeted summary of knowledge entries for the system prompt. */
function buildKnowledgeSummary(
  ctx: Context,
  budgetTokens: number,
  groupIds: string[],
): string {
  // Rough character budget: ~4 chars per token.
  const budgetChars = budgetTokens * 4
  let entries: KnowledgeEntry[]
  if (groupIds.length > 0) {
    entries = []
    for (const groupId of groupIds) {
      const groupEntries = ctx.knowledge.listEntries({ groupId: KnowledgeGroupId(groupId) })
      entries.push(...groupEntries)
    }
  } else {
    // When no groups are configured, show the most recent entries.
    entries = ctx.knowledge.listEntries({ limit: 20 })
  }
  if (entries.length === 0) return ''

  const lines: string[] = []
  let totalChars = 0
  for (const entry of entries) {
    const line = `- [${entry.category}] ${entry.title} (tags: ${entry.tags.join(', ') || 'none'})`
    if (totalChars + line.length > budgetChars) break
    lines.push(line)
    totalChars += line.length
  }
  return lines.join('\n')
}

// ── Auto-summarize on session disposal or archive ────────────────────

/** Register the `session/disposed` and `domain/changed` auto-summarize listeners. */
function registerAutoSummarize(
  ctx: Context,
  maxSummaryEntries: number,
  summarizeModel: string,
): void {
  // Track already-summarized sessions to prevent double-processing when both
  // archive (domain/changed) and disposal (session/disposed) fire for the same
  // session.
  const summarized = new Set<string>()

  /** Summarize one session exactly once. */
  const trySummarize = (session: Session): void => {
    const id = String(session.id)
    if (summarized.has(id)) return
    summarized.add(id)
    void summarizeSession(ctx, session, maxSummaryEntries, summarizeModel).catch((error: unknown) => {
      ctx.logger.warn(`knowledge: auto-summarize failed for session "${session.id}": ${String(error)}`)
    })
  }

  // Trigger on session disposal (session removed from memory).
  ctx.on('session/disposed', (session: Session) => {
    trySummarize(session)
  })

  // Trigger on session archive (workspace domain state change). Archiving does
  // not dispose the session — it only adds the id to the workspace registry's
  // archivedSessionIds set.
  let lastArchivedIds = new Set<string>()
  ctx.on('domain/changed', (change: DomainChanged) => {
    if (change.domain !== 'workspace' || change.table !== '' || change.operation !== 'put') return
    const value = change.value as { archivedSessionIds?: readonly string[] } | undefined
    if (value === undefined || !Array.isArray(value.archivedSessionIds)) return
    const currentIds = value.archivedSessionIds.map(String)
    for (const id of currentIds) {
      if (lastArchivedIds.has(id)) continue
      const session = ctx.get('sessions')?.get(id as SessionId)
      if (session !== undefined) {
        trySummarize(session)
      }
    }
    lastArchivedIds = new Set(currentIds)
  })
}

/**
 * Extract reusable knowledge from a disposed or archived session. The LLM call
 * uses the provider/model from the session's last request header, or skips when
 * none is available. Failures are contained (fire-and-forget).
 */
async function summarizeSession(
  ctx: Context,
  session: Session,
  maxSummaryEntries: number,
  summarizeModel: string,
): Promise<void> {
  const conversationText = extractConversationText(session.snapshotEvents())
  if (conversationText.trim().length < 100) {
    ctx.logger.debug(`knowledge: skipping auto-summarize for session "${session.id}" — conversation too short (${conversationText.trim().length} chars)`)
    return
  }

  const { provider, model } = resolveSessionModel(session, summarizeModel)
  if (provider === undefined || model === undefined) {
    ctx.logger.debug(`knowledge: skipping auto-summarize for session "${session.id}" — no provider/model available`)
    return
  }

  ctx.logger.debug(`knowledge: auto-summarizing session "${session.id}" with ${provider}/${model}`)

  const summarizePrompt = buildSummarizePrompt(conversationText, maxSummaryEntries)
  const messages: Message[] = [
    createUserMessage({
      content: [{ type: 'text', text: summarizePrompt }],
      source: { kind: 'user' },
    }),
  ]

  // The summarization is a model-visible auxiliary request; record the exact
  // pre-dispatch payload so it reconstructs from the log without becoming part
  // of the conversation history.
  session.append('knowledge/summary-llm-request', {
    provider,
    model,
    messages,
    maxSummaryEntries,
  })

  let responseText = ''
  try {
    const stream = ctx.llm.stream({ provider, model, messages })
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') {
        responseText += chunk.text
      }
    }
  } catch (error) {
    ctx.logger.warn(`knowledge: LLM summarize call failed: ${String(error)}`)
    return
  }

  const extracted = parseSummarizeResponse(responseText)
  if (extracted.length === 0) {
    ctx.logger.debug(`knowledge: no knowledge extracted from session "${session.id}"`)
    return
  }

  const toSave = extracted.slice(0, maxSummaryEntries)
  let savedCount = 0
  for (const item of toSave) {
    try {
      ctx.knowledge.saveEntry({
        title: item.title,
        content: item.content,
        category: item.category,
        tags: item.tags,
        sourceSessionId: session.id,
      })
      savedCount++
    } catch (error) {
      ctx.logger.warn(`knowledge: failed to save summarized entry: ${String(error)}`)
    }
  }
  ctx.logger.info(`knowledge: auto-summarized session "${session.id}" — saved ${savedCount}/${toSave.length} entries`)
}

/** Extract the provider and model from a session's last request header. */
function resolveSessionModel(
  session: Session,
  summarizeModel: string,
): { provider?: string; model?: string } {
  if (summarizeModel !== '') {
    // When a specific model is configured, the caller must also supply a provider.
    return { model: summarizeModel }
  }
  // Walk events backwards to find the last request/header.
  for (const event of [...session.snapshotEvents()].reverse()) {
    if (event.type === 'request/header') {
      return {
        provider: event.data.header.config.provider,
        model: event.data.header.config.model,
      }
    }
  }
  return {}
}

/** Extract readable conversation text from session events. */
function extractConversationText(events: readonly SessionEvent[]): string {
  const parts: string[] = []
  for (const event of events) {
    if (event.type === 'user/message') {
      const message = event.data
      if (message.source.kind === 'user') {
        for (const block of message.content) {
          if (block.type === 'text') parts.push(`User: ${block.text}`)
        }
      }
    } else if (event.type === 'assistant/message') {
      for (const block of event.data.message.content) {
        if (block.type === 'text') parts.push(`Assistant: ${block.text}`)
      }
    }
  }
  return parts.join('\n\n')
}

/** Build the summarize prompt sent to the LLM. */
function buildSummarizePrompt(conversationText: string, maxEntries: number): string {
  return `分析以下对话，提取最多 ${maxEntries} 条可复用的经验知识。

每条知识需包含：
- title: 简短的描述性标题（使用中文）
- content: 完整的可复用经验内容（使用中文）
- category: 分类，取以下之一: architecture, debugging, performance, pattern, configuration, api, workflow, general
- tags: 相关标签数组（使用中文）

以 JSON 数组格式返回，每个对象包含 title, content, category, tags 字段。
如果无法提取可复用的知识，返回空数组: []

对话内容:
${conversationText}`
}

/** One extracted knowledge item from the LLM response. */
interface ExtractedKnowledge {
  title: string
  content: string
  category: KnowledgeCategory
  tags: string[]
}

/** Parse the LLM summarize response into knowledge items. */
function parseSummarizeResponse(text: string): ExtractedKnowledge[] {
  try {
    // Try to find a JSON array in the response.
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (jsonMatch === null) return []
    const parsed = JSON.parse(jsonMatch[0]) as unknown[]
    if (!Array.isArray(parsed)) return []
    const results: ExtractedKnowledge[] = []
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue
      const { title, content, category, tags } = item as Record<string, unknown>
      if (typeof title !== 'string' || typeof content !== 'string' || typeof category !== 'string') continue
      if (!KNOWLEDGE_CATEGORIES.includes(category as KnowledgeCategory)) continue
      results.push({
        title,
        content,
        category: category as KnowledgeCategory,
        tags: Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string') : [],
      })
    }
    return results
  } catch {
    return []
  }
}
