import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import KnowledgeStore, { KnowledgeEntryId, KnowledgeGroupId } from '@deepseek-ai/dsh-knowledge'
import * as knowledgeFile from '../src/index.ts'

async function tmpRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-knowledge-'))
}

async function setup(root: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(KnowledgeStore)
  await ctx.plugin(knowledgeFile, { root })
  return ctx
}

describe('dsh-knowledge-file', () => {
  it('hydrates entries and groups from disk on boot', async () => {
    const root = await tmpRoot()
    await mkdir(join(root, 'entries'), { recursive: true })
    await mkdir(join(root, 'groups'), { recursive: true })
    const entryId = KnowledgeEntryId('k_1')
    await writeFile(join(root, 'entries', 'k_1.json'), JSON.stringify({
      id: entryId,
      title: 'Hydrated',
      content: 'Content.',
      category: 'general',
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    }) + '\n', 'utf8')

    const ctx = await setup(root)
    expect(ctx.knowledge.getEntry(entryId)?.title).toBe('Hydrated')
  })

  it('flushes a saved entry to disk', async () => {
    const root = await tmpRoot()
    const ctx = await setup(root)
    const entry = ctx.knowledge.saveEntry({ title: 'Saved', content: 'Content.', category: 'general' })
    await new Promise(resolve => setTimeout(resolve, 20))
    const raw = await readFile(join(root, 'entries', `${entry.id}.json`), 'utf8')
    const parsed = JSON.parse(raw) as { title: unknown }
    expect(parsed.title).toBe('Saved')
  })

  it('removes stale entry files when an entry is deleted', async () => {
    const root = await tmpRoot()
    const ctx = await setup(root)
    const entry = ctx.knowledge.saveEntry({ title: 'To Delete', content: 'Content.', category: 'general' })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect((await import('node:fs/promises')).stat(join(root, 'entries', `${entry.id}.json`))).toBeDefined()

    ctx.knowledge.deleteEntry(entry.id)
    await new Promise(resolve => setTimeout(resolve, 20))
    const { access } = await import('node:fs/promises')
    await expect(access(join(root, 'entries', `${entry.id}.json`))).rejects.toThrow()
  })

  it('hydrates counters from existing ids', async () => {
    const root = await tmpRoot()
    await mkdir(join(root, 'entries'), { recursive: true })
    await writeFile(join(root, 'entries', 'k_7.json'), JSON.stringify({
      id: KnowledgeEntryId('k_7'),
      title: 'Hydrated',
      content: 'Content.',
      category: 'general',
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    }) + '\n', 'utf8')

    const ctx = await setup(root)
    const entry = ctx.knowledge.saveEntry({ title: 'Next', content: 'Content.', category: 'general' })
    expect(entry.id).toBe(KnowledgeEntryId('k_8'))
  })

  it('handles an empty root with no entries or groups', async () => {
    const root = await tmpRoot()
    const ctx = await setup(root)
    expect(ctx.knowledge.listEntries()).toHaveLength(0)
    expect(ctx.knowledge.listGroups()).toHaveLength(0)
  })

  it('persists a group and its entries', async () => {
    const root = await tmpRoot()
    const ctx = await setup(root)
    const group = ctx.knowledge.createGroup({ name: 'Group', description: 'A group.' })
    const entry = ctx.knowledge.saveEntry({ title: 'Entry', content: 'Content.', category: 'general', groupId: group.id })
    await new Promise(resolve => setTimeout(resolve, 20))
    const raw = await readFile(join(root, 'groups', `${group.id}.json`), 'utf8')
    const parsed = JSON.parse(raw) as { name: string; entryIds: unknown[] }
    expect(parsed.name).toBe('Group')
    expect(parsed.entryIds).toEqual([entry.id])
  })

  it('hydrates a known group', async () => {
    const root = await tmpRoot()
    await mkdir(join(root, 'entries'), { recursive: true })
    await mkdir(join(root, 'groups'), { recursive: true })
    const groupId = KnowledgeGroupId('g_2')
    await writeFile(join(root, 'groups', 'g_2.json'), JSON.stringify({
      id: groupId,
      name: 'Group',
      description: 'Desc.',
      entryIds: [],
    }) + '\n', 'utf8')
    const ctx = await setup(root)
    expect(ctx.knowledge.getGroup(groupId)?.name).toBe('Group')
  })
})
