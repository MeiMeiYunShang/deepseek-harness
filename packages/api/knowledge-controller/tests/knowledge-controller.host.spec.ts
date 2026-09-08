import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import KnowledgeStore, { KnowledgeEntryId } from '@deepseek-ai/dsh-knowledge'
import KnowledgeController from '../src/index.ts'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(KnowledgeStore)
  await ctx.plugin(KnowledgeController)
  return ctx
}

describe('dsh-api-knowledge-controller', () => {
  it('lists entries and groups through the remote namespace', async () => {
    const ctx = await setup()
    ctx.knowledge.saveEntry({ title: 'Tip', content: 'Content.', category: 'pattern' })
    ctx.knowledge.createGroup({ name: 'Group', description: 'Desc.' })
    const value = ctx.knowledgeController.list({})
    expect(value.entries).toHaveLength(1)
    expect(value.groups).toHaveLength(1)
    expect(value.entries[0]!.category).toBe('pattern')
  })

  it('creates and retrieves a knowledge entry', async () => {
    const ctx = await setup()
    const { entry } = ctx.knowledgeController.create({ title: 'Tip', content: 'Content.', category: 'general' })
    expect(entry.id).toBeDefined()
    const got = ctx.knowledgeController.get(entry.id)
    expect(got.entry.title).toBe('Tip')
  })

  it('updates a knowledge entry title', async () => {
    const ctx = await setup()
    const { entry } = ctx.knowledgeController.create({ title: 'Old', content: 'Content.', category: 'general' })
    const updated = ctx.knowledgeController.update(entry.id, { title: 'New' })
    expect(updated.entry.title).toBe('New')
  })

  it('deletes a knowledge entry idempotently', async () => {
    const ctx = await setup()
    const { entry } = ctx.knowledgeController.create({ title: 'Tip', content: 'Content.', category: 'general' })
    expect(ctx.knowledgeController.delete(entry.id)).toEqual({ deleted: true })
    expect(ctx.knowledge.listEntries()).toHaveLength(0)
  })

  it('classifies an unknown id as knowledge/not-found', async () => {
    const ctx = await setup()
    expect(() => ctx.knowledgeController.get(KnowledgeEntryId('k_missing'))).toThrow(RemoteError)
  })

  it('classifies an invalid category as knowledge/invalid-category', async () => {
    const ctx = await setup()
    expect(() => ctx.knowledgeController.create({
      title: 'Tip', content: 'Content.', category: 'nope' as never,
    })).toThrow(/invalid knowledge category/)
  })

  it('manages groups through the remote namespace', async () => {
    const ctx = await setup()
    const group = ctx.knowledgeController.createGroup({ name: 'Group', description: 'Desc.' })
    expect(group.group.name).toBe('Group')
    expect(ctx.knowledgeController.deleteGroup(group.group.id)).toEqual({ deleted: true })
  })

  it('assigns a group id on create', async () => {
    const ctx = await setup()
    const group = ctx.knowledgeController.createGroup({ name: 'G', description: 'D' })
    const { entry } = ctx.knowledgeController.create({ title: 'T', content: 'C', category: 'general', groupId: group.group.id })
    expect(entry.groupId).toBe(group.group.id)
  })
})
