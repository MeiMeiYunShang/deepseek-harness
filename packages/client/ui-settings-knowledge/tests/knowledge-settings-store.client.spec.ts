import { describe, expect, it } from 'vitest'
import { KnowledgeEntryId, KnowledgeGroupId } from '@deepseek-ai/dsh-knowledge/types'
import type { KnowledgeEntryView, KnowledgeGroupView } from '@deepseek-ai/dsh-api-remotes/client'
import { createKnowledgeSettingsStore } from '../src/client/store.ts'

const entry: KnowledgeEntryView = {
  id: KnowledgeEntryId('k-1'),
  title: 'Title',
  content: 'Content',
  category: 'pattern',
  tags: ['tag'],
  createdAt: 1,
  updatedAt: 2,
}

const group: KnowledgeGroupView = {
  id: KnowledgeGroupId('g-1'),
  name: 'Group',
  description: 'Description',
  entryIds: [KnowledgeEntryId('k-1')],
}

describe('knowledge settings store', () => {
  it('starts idle with an empty catalog', () => {
    const instance = createKnowledgeSettingsStore().create()
    expect(instance.getSnapshot()).toEqual({ status: 'idle', error: null, entries: [], groups: [] })
  })

  it('marks a load in progress', () => {
    const instance = createKnowledgeSettingsStore().create()
    instance.actions.beginLoad()
    expect(instance.getSnapshot().status).toBe('loading')
    expect(instance.getSnapshot().error).toBeNull()
  })

  it('publishes a fetched catalog', () => {
    const instance = createKnowledgeSettingsStore().create()
    instance.actions.setCatalog([entry], [group])
    expect(instance.getSnapshot().status).toBe('ready')
    expect(instance.getSnapshot().entries).toEqual([entry])
    expect(instance.getSnapshot().groups).toEqual([group])
  })

  it('reports a failed load as an error with the message', () => {
    const instance = createKnowledgeSettingsStore().create()
    instance.actions.beginLoad()
    instance.actions.setFailed('boom')
    expect(instance.getSnapshot().status).toBe('error')
    expect(instance.getSnapshot().error).toBe('boom')
    expect(instance.getSnapshot().entries).toHaveLength(0)
  })

  it('gives every instance a fresh state', () => {
    const first = createKnowledgeSettingsStore().create()
    const second = createKnowledgeSettingsStore().create()
    first.actions.setCatalog([entry], [])
    expect(second.getSnapshot().entries).toHaveLength(0)
  })
})
