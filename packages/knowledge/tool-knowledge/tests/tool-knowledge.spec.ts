import { describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionToken, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import KnowledgeStore from '@deepseek-ai/dsh-knowledge'
import * as toolKnowledge from '../src/index.ts'

/** Minimal `llm` service so the plugin's `inject` resolves; not invoked here. */
class StubLlm extends Service {
  constructor(ctx: Context) {
    super(ctx, 'llm')
  }
}

function execOf(name: string, args: unknown, agent?: { session: { id: string } }): ToolRunContext {
  const token = Symbol('dsh.tool.execution') as ToolExecutionToken
  return {
    callId: ToolCallId(`call_${name}`),
    name,
    arguments: args,
    signal: new AbortController().signal,
    token,
    deferContext: () => {},
    concludeTurn: () => {},
    ...agent === undefined ? {} : { agent },
  } as unknown as ToolRunContext
}

async function setup(config: toolKnowledge.Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(KnowledgeStore)
  await ctx.plugin(StubLlm)
  await ctx.plugin(toolKnowledge, config)
  return ctx
}

async function toolNames(ctx: Context): Promise<string[]> {
  const schemas = ctx.tools.schemas()
  return schemas.map(schema => schema.name).sort()
}

describe('dsh-tool-knowledge', () => {
  it('registers the knowledge_search and save_knowledge tools', async () => {
    const ctx = await setup()
    const names = await toolNames(ctx)
    expect(names).toContain('knowledge_search')
    expect(names).toContain('save_knowledge')
  })

  it('knowledge_search returns matching entries from the store', async () => {
    const ctx = await setup()
    ctx.knowledge.saveEntry({
      title: 'TypeScript Tips',
      content: 'How to use TypeScript effectively.',
      category: 'pattern',
      tags: ['typescript'],
    })
    ctx.knowledge.saveEntry({
      title: 'Python Patterns',
      content: 'Common Python design patterns.',
      category: 'pattern',
      tags: ['python'],
    })

    const search = ctx.tools.get('knowledge_search')
    expect(search).toBeDefined()
    const result = await search!.execute({ query: 'typescript' }, execOf('knowledge_search', { query: 'typescript' }))
    const value = result as { entries: Array<{ title: string; content: string }>; total: number }
    expect(value.total).toBe(1)
    expect(value.entries[0]!.title).toBe('TypeScript Tips')
  })

  it('save_knowledge creates an entry without a source session when no agent is present', async () => {
    const ctx = await setup()
    const save = ctx.tools.get('save_knowledge')
    expect(save).toBeDefined()
    const args = { title: 'Saved', content: 'Content.', category: 'general' }
    await save!.execute(args, execOf('save_knowledge', args))
    const entries = ctx.knowledge.listEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]!.title).toBe('Saved')
    expect(entries[0]!.sourceSessionId).toBeUndefined()
  })

  it('save_knowledge records the session id when an agent is present', async () => {
    const ctx = await setup()
    const save = ctx.tools.get('save_knowledge')
    expect(save).toBeDefined()
    const args = { title: 'Saved', content: 'Content.', category: 'general' }
    const exec = execOf('save_knowledge', args, { session: { id: 'session-123' } })
    await save!.execute(args, exec)
    const entries = ctx.knowledge.listEntries()
    expect(entries[0]!.sourceSessionId).toBe('session-123')
  })

  it('auto-summarize logs the model request and saves the extracted entries', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(KnowledgeStore)
    ctx.provide('llm', {
      stream: async function* () {
        yield { type: 'text-delta', index: 0, text: JSON.stringify([{ title: 'Tip', content: 'Body', category: 'pattern', tags: [] }]) }
      },
    } as never)
    await ctx.plugin(toolKnowledge, { autoSummarize: true })

    const append = vi.fn()
    const session = {
      id: SessionId('sum-1'),
      events: [
        { type: 'request/header', data: { header: { config: { provider: 'deepseek', model: 'chat' } } } },
        { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'A '.repeat(60) }] } },
        { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'B '.repeat(60) }] } } },
      ],
      append,
    } as never

    ctx.emit('session/disposed', session)

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(append).toHaveBeenCalledWith('knowledge/summary-llm-request', expect.objectContaining({
      provider: 'deepseek',
      model: 'chat',
      maxSummaryEntries: 5,
    }))
    expect(ctx.knowledge.listEntries()).toHaveLength(1)
  })
})
