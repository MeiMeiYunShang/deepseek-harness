import { describe, expect, it } from 'vitest'
import { KnowledgeEntryId } from '@deepseek-ai/dsh-knowledge/types'
import { createKnowledgePickerStore } from '../src/client/store.ts'

const id1 = KnowledgeEntryId('k-1')
const id2 = KnowledgeEntryId('k-2')

describe('knowledge picker store', () => {
  it('starts idle with an empty catalog and selection', () => {
    const instance = createKnowledgePickerStore().create()
    expect(instance.getSnapshot()).toEqual({ status: 'idle', entries: [], selectedIds: [] })
  })

  it('loads the catalog through its write set', () => {
    const instance = createKnowledgePickerStore().create()
    instance.actions.startLoad()
    expect(instance.getSnapshot().status).toBe('loading')
    instance.actions.setCatalog([
      { id: id1, title: 'Title', category: 'pattern', tags: ['a'] },
    ])
    expect(instance.getSnapshot().status).toBe('ready')
    expect(instance.getSnapshot().entries).toHaveLength(1)
  })

  it('reports a failed catalog load as an error state', () => {
    const instance = createKnowledgePickerStore().create()
    instance.actions.startLoad()
    instance.actions.setFailed()
    expect(instance.getSnapshot().status).toBe('error')
    expect(instance.getSnapshot().entries).toHaveLength(0)
  })

  it('toggles one entry into and out of the selection', () => {
    const instance = createKnowledgePickerStore().create()
    instance.actions.toggle(id1)
    expect(instance.getSnapshot().selectedIds).toEqual([id1])
    instance.actions.toggle(id2)
    expect(instance.getSnapshot().selectedIds).toEqual([id1, id2])
    instance.actions.toggle(id1)
    expect(instance.getSnapshot().selectedIds).toEqual([id2])
  })

  it('clears the selection', () => {
    const instance = createKnowledgePickerStore().create()
    instance.actions.toggle(id1)
    instance.actions.clear()
    expect(instance.getSnapshot().selectedIds).toEqual([])
  })

  it('gives every instance a fresh state', () => {
    const first = createKnowledgePickerStore().create()
    const second = createKnowledgePickerStore().create()
    first.actions.toggle(id1)
    expect(second.getSnapshot().selectedIds).toEqual([])
  })
})
