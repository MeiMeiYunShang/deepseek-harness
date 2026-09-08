import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { KnowledgeStore, KnowledgeEntryId, KnowledgeGroupId } from '../src/index.ts'
import type { KnowledgeCategory } from '../src/index.ts'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(KnowledgeStore)
  return ctx
}

describe('dsh-knowledge', () => {
  describe('KnowledgeStore entry operations', () => {
    it('saves and retrieves a knowledge entry', async () => {
      const ctx = await setup()
      const entry = ctx.knowledge.saveEntry({
        title: 'Test Entry',
        content: 'Test content for the entry.',
        category: 'debugging',
        tags: ['test', 'debugging'],
      })
      expect(entry.id).toBeDefined()
      expect(entry.title).toBe('Test Entry')
      expect(entry.category).toBe('debugging')
      expect(entry.tags).toEqual(['test', 'debugging'])
      expect(entry.createdAt).toBeGreaterThan(0)

      const retrieved = ctx.knowledge.getEntry(entry.id)
      expect(retrieved).toEqual(entry)
    })

    it('lists entries sorted by creation time descending', async () => {
      const ctx = await setup()
      const entryId = KnowledgeEntryId('k_1')
      const olderId = KnowledgeEntryId('k_2')
      ctx.knowledge.hydrate([
        { id: olderId, title: 'Older', content: 'Older content.', category: 'general', tags: [], createdAt: 1000, updatedAt: 1000 },
        { id: entryId, title: 'Newer', content: 'Newer content.', category: 'general', tags: [], createdAt: 2000, updatedAt: 2000 },
      ], [])

      const entries = ctx.knowledge.listEntries()
      expect(entries.map(e => e.id)).toEqual([entryId, olderId])
    })

    it('filters entries by query', async () => {
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

      const results = ctx.knowledge.listEntries({ query: 'typescript' })
      expect(results).toHaveLength(1)
      expect(results[0]!.title).toBe('TypeScript Tips')
    })

    it('filters entries by category', async () => {
      const ctx = await setup()
      ctx.knowledge.saveEntry({ title: 'Debug', content: 'Debug tip.', category: 'debugging' })
      ctx.knowledge.saveEntry({ title: 'Pattern', content: 'Pattern tip.', category: 'pattern' })

      const results = ctx.knowledge.listEntries({ category: 'debugging' })
      expect(results).toHaveLength(1)
      expect(results[0]!.title).toBe('Debug')
    })

    it('deletes an entry', async () => {
      const ctx = await setup()
      const entry = ctx.knowledge.saveEntry({
        title: 'To Delete',
        content: 'Will be deleted.',
        category: 'general',
      })
      expect(ctx.knowledge.listEntries()).toHaveLength(1)

      const deleted = ctx.knowledge.deleteEntry(entry.id)
      expect(deleted).toBe(true)
      expect(ctx.knowledge.listEntries()).toHaveLength(0)
      expect(ctx.knowledge.getEntry(entry.id)).toBeUndefined()
    })

    it('rejects empty title', async () => {
      const ctx = await setup()
      expect(() => ctx.knowledge.saveEntry({
        title: '',
        content: 'Content.',
        category: 'general',
      })).toThrow('non-empty string')
    })

    it('rejects invalid category', async () => {
      const ctx = await setup()
      expect(() => ctx.knowledge.saveEntry({
        title: 'Title',
        content: 'Content.',
        category: 'invalid' as KnowledgeCategory,
      })).toThrow('invalid knowledge category')
    })
  })

  describe('KnowledgeStore group operations', () => {
    it('creates and lists groups', async () => {
      const ctx = await setup()
      const group = ctx.knowledge.createGroup({
        name: 'Test Group',
        description: 'A test group.',
      })
      expect(group.id).toBeDefined()
      expect(group.name).toBe('Test Group')
      expect(group.entryIds).toEqual([])

      const groups = ctx.knowledge.listGroups()
      expect(groups).toHaveLength(1)
      expect(groups[0]!.id).toBe(group.id)
    })

    it('assigns entries to groups', async () => {
      const ctx = await setup()
      const entry = ctx.knowledge.saveEntry({
        title: 'Entry',
        content: 'Content.',
        category: 'general',
      })
      const group = ctx.knowledge.createGroup({
        name: 'Group',
        description: 'A group.',
      })

      const assigned = ctx.knowledge.assignToGroup(entry.id, group.id)
      expect(assigned).toBe(true)

      const updatedEntry = ctx.knowledge.getEntry(entry.id)
      expect(updatedEntry!.groupId).toBe(group.id)

      const updatedGroup = ctx.knowledge.getGroup(group.id)
      expect(updatedGroup!.entryIds).toContain(entry.id)
    })

    it('deletes a group and clears entry groupId', async () => {
      const ctx = await setup()
      const entry = ctx.knowledge.saveEntry({
        title: 'Entry',
        content: 'Content.',
        category: 'general',
      })
      const group = ctx.knowledge.createGroup({
        name: 'Group',
        description: 'A group.',
      })
      ctx.knowledge.assignToGroup(entry.id, group.id)

      const deleted = ctx.knowledge.deleteGroup(group.id)
      expect(deleted).toBe(true)
      expect(ctx.knowledge.listGroups()).toHaveLength(0)

      const updatedEntry = ctx.knowledge.getEntry(entry.id)
      expect(updatedEntry!.groupId).toBeUndefined()
    })
  })

  describe('KnowledgeStore hydration', () => {
    it('hydrates from external data and advances the id counters', async () => {
      const ctx = await setup()
      const entryId = KnowledgeEntryId('k_10')
      const groupId = KnowledgeGroupId('g_5')

      ctx.knowledge.hydrate(
        [{
          id: entryId,
          title: 'Hydrated Entry',
          content: 'Content.',
          category: 'architecture',
          tags: [],
          createdAt: 1000,
          updatedAt: 1000,
        }],
        [{
          id: groupId,
          name: 'Hydrated Group',
          description: 'Description.',
          entryIds: [entryId],
        }],
      )

      expect(ctx.knowledge.getEntry(entryId)).toBeDefined()
      expect(ctx.knowledge.getGroup(groupId)).toBeDefined()

      const newEntry = ctx.knowledge.saveEntry({
        title: 'New',
        content: 'After hydration.',
        category: 'general',
      })
      expect(newEntry.id).toBe(KnowledgeEntryId('k_11'))
    })
  })

  describe('knowledge/change event', () => {
    it('emits on save', async () => {
      const ctx = await setup()
      let fired = false
      ctx.on('knowledge/change', () => { fired = true })

      ctx.knowledge.saveEntry({
        title: 'Trigger',
        content: 'Change.',
        category: 'general',
      })
      expect(fired).toBe(true)
    })

    it('emits on delete', async () => {
      const ctx = await setup()
      const entry = ctx.knowledge.saveEntry({
        title: 'To Delete',
        content: 'Content.',
        category: 'general',
      })

      let fired = false
      ctx.on('knowledge/change', () => { fired = true })
      ctx.knowledge.deleteEntry(entry.id)
      expect(fired).toBe(true)
    })
  })
})
