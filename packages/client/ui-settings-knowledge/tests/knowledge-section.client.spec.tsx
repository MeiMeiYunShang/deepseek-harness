// @vitest-environment jsdom
/**
 * The Knowledge settings page: catalog list with filtering, inline create/edit,
 * delete confirmation, groups panel, detail disclosure, and the injected
 * mutation callbacks. The catalog is seeded through the store instance before
 * render; every write callback is a spec stub this suite asserts on.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { KnowledgeEntryId, KnowledgeGroupId } from '@deepseek-ai/dsh-knowledge/types'
import type { KnowledgeEntryView, KnowledgeGroupView } from '@deepseek-ai/dsh-api-remotes/client'
import { KnowledgeSection, type KnowledgeSectionProps } from '../src/client/KnowledgeSection.tsx'
import { createKnowledgeSettingsStore } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(en)

type Instance = ReturnType<ReturnType<typeof createKnowledgeSettingsStore>['create']>
type Seed = (instance: Instance) => void

const ENTRY_GROUPED: KnowledgeEntryView = {
  id: KnowledgeEntryId('k-1'), title: 'Cache hygiene', content: 'Clear stale entries.', category: 'performance',
  tags: ['cache'], groupId: KnowledgeGroupId('g-1'), createdAt: 1, updatedAt: 2,
}
const ENTRY_PLAIN: KnowledgeEntryView = {
  id: KnowledgeEntryId('k-2'), title: 'API retries', content: 'Retry once.', category: 'api',
  tags: [], createdAt: 1, updatedAt: 2,
}
const GROUP: KnowledgeGroupView = {
  id: KnowledgeGroupId('g-1'), name: 'Ops', description: 'Operational notes', entryIds: [KnowledgeEntryId('k-1')],
}

/** Seed a fresh store and render the section. */
function renderSection(seed?: Seed) {
  const instance = createKnowledgeSettingsStore().create()
  seed?.(instance)
  const load = vi.fn(async () => {})
  const create = vi.fn(async () => {})
  const update = vi.fn(async () => {})
  const remove = vi.fn(async () => {})
  const createGroup = vi.fn(async () => {})
  const deleteGroup = vi.fn(async () => {})
  render(<KnowledgeSection {...({
    load, create, update, remove, createGroup, deleteGroup,
    useStore: bindSnapshotSelector(instance.store),
    t,
  } as unknown as KnowledgeSectionProps)} />)
  return { instance, load, create, update, remove, createGroup, deleteGroup }
}

const catalog = (instance: Instance): void => { instance.actions.setCatalog([ENTRY_GROUPED, ENTRY_PLAIN], [GROUP]) }
const combo = (index: number): HTMLSelectElement => screen.getAllByRole('combobox')[index] as HTMLSelectElement
const titleInput = (): HTMLInputElement => screen.getByPlaceholderText(en.title) as HTMLInputElement

describe('the Knowledge settings section', () => {
  it('loads the catalog and lists the entries and the group panel', () => {
    const { load } = renderSection(catalog)
    expect(load).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Cache hygiene')).toBeDefined()
    expect(screen.getAllByText('Ops').length).toBeGreaterThan(0)
  })

  it('lists groups with their entry count', () => {
    renderSection((instance) => { instance.actions.setCatalog([ENTRY_GROUPED], [GROUP]) })
    expect(screen.getByText(en.entryCount.replace('{count}', '1'))).toBeDefined()
  })

  it('renders the empty and no-groups placeholders when the catalog is empty', () => {
    renderSection()
    expect(screen.getByText(en.empty)).toBeDefined()
    expect(screen.getByText(en.noGroups)).toBeDefined()
  })

  it('shows the loading banner while the catalog is fetching and empty', () => {
    renderSection((instance) => { instance.actions.beginLoad() })
    expect(screen.getByText(en.loading)).toBeDefined()
  })

  it('shows the error surface with a retry button', () => {
    const { load } = renderSection((instance) => { instance.actions.setFailed('boom') })
    expect(screen.getByRole('alert').textContent).toBe('boom')
    fireEvent.click(screen.getByText(en.retry))
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('falls back to the default error text when the error state has no message', () => {
    renderSection((instance) => { instance.store.set({ status: 'error', error: null, entries: [], groups: [] }) })
    expect(screen.getByRole('alert').textContent).toBe(en.error)
  })

  it('filters entries by category and by a search query', () => {
    renderSection(catalog)
    fireEvent.change(combo(0), { target: { value: 'api' } })
    expect(screen.queryByText('Cache hygiene')).toBeNull()
    expect(screen.getByText('API retries')).toBeDefined()
    fireEvent.change(combo(0), { target: { value: '' } })
    fireEvent.change(combo(1), { target: { value: 'g-1' } })
    expect(screen.getByText('Cache hygiene')).toBeDefined()
    expect(screen.queryByText('API retries')).toBeNull()
    fireEvent.change(combo(1), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText(en.search), { target: { value: 'zzz' } })
    expect(screen.getByText(en.emptySearch)).toBeDefined()
    fireEvent.change(screen.getByLabelText(en.search), { target: { value: 'retries' } })
    expect(screen.getByText('API retries')).toBeDefined()
  })

  it('filters entries by clicking a group in the panel', () => {
    renderSection(catalog)
    const groupButton = screen.getAllByRole('button').find(button => button.textContent?.includes(en.entryCount.replace('{count}', '1')))
    fireEvent.click(groupButton as HTMLElement)
    expect(screen.queryByText('API retries')).toBeNull()
    expect(screen.getByText('Cache hygiene')).toBeDefined()
  })

  it('expands an entry to show its content and tags', () => {
    renderSection(catalog)
    fireEvent.click(screen.getByText('Cache hygiene'))
    expect(screen.getByText('Clear stale entries.')).toBeDefined()
    expect(screen.getByText('cache')).toBeDefined()
  })

  it('collapses an expanded entry and shows no tag row for a tagless entry', () => {
    renderSection(catalog)
    fireEvent.click(screen.getByText('API retries'))
    expect(screen.getByText('Retry once.')).toBeDefined()
    fireEvent.click(screen.getByText('API retries'))
    expect(screen.queryByText('Retry once.')).toBeNull()
    fireEvent.click(screen.getByText('Cache hygiene'))
    expect(screen.getByText('Clear stale entries.')).toBeDefined()
  })

  it('shows the unspecified fallback for an entry with no group', () => {
    renderSection((instance) => { instance.actions.setCatalog([ENTRY_PLAIN], []) })
    expect(screen.getByText(en.unspecified)).toBeDefined()
  })

  it('creates an entry through the injected callback', async () => {
    const { create } = renderSection()
    fireEvent.click(screen.getByText(en.create))
    fireEvent.change(titleInput(), { target: { value: 'New' } })
    fireEvent.change(screen.getByPlaceholderText(en.content), { target: { value: 'Body' } })
    fireEvent.click(screen.getByText(en.save))
    await waitFor(() => { expect(create).toHaveBeenCalledTimes(1) })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: 'New', content: 'Body', category: 'general' }))
  })

  it('does not create an entry when the title is blank', async () => {
    const { create } = renderSection()
    fireEvent.click(screen.getByText(en.create))
    fireEvent.click(screen.getByText(en.save))
    await waitFor(() => { expect(create).not.toHaveBeenCalled() })
  })

  it('edits an existing entry into the injected update callback', async () => {
    const { update } = renderSection(catalog)
    fireEvent.click(screen.getAllByLabelText(en.edit)[0] as HTMLElement)
    expect(titleInput().value).toBe('Cache hygiene')
    expect(combo(3).value).toBe('g-1')
    fireEvent.change(titleInput(), { target: { value: 'Tweaked' } })
    fireEvent.click(screen.getByText(en.save))
    await waitFor(() => { expect(update).toHaveBeenCalledTimes(1) })
    expect(update).toHaveBeenCalledWith(KnowledgeEntryId('k-1'), expect.objectContaining({ title: 'Tweaked' }))
  })

  it('deletes an entry after confirmation and cancels without deleting', async () => {
    const { remove } = renderSection(catalog)
    fireEvent.click(screen.getAllByLabelText(en.delete)[0] as HTMLElement)
    expect(screen.getByText(en.deleteConfirm)).toBeDefined()
    fireEvent.click(screen.getByText(en.delete))
    await waitFor(() => { expect(remove).toHaveBeenCalledWith(KnowledgeEntryId('k-1')) })
    fireEvent.click(screen.getAllByLabelText(en.delete)[0] as HTMLElement)
    fireEvent.click(screen.getByText(en.cancel))
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('creates a group through the injected callback', async () => {
    const { createGroup } = renderSection()
    fireEvent.click(screen.getByLabelText(en.createGroup))
    fireEvent.change(screen.getByPlaceholderText(en.groupName), { target: { value: 'Ops' } })
    fireEvent.change(screen.getByPlaceholderText(en.groupDescription), { target: { value: 'Notes' } })
    fireEvent.click(screen.getByText(en.save))
    await waitFor(() => {
      expect(createGroup).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ops', description: 'Notes' }))
    })
  })

  it('does not create a group with a blank name', async () => {
    const { createGroup } = renderSection()
    fireEvent.click(screen.getByLabelText(en.createGroup))
    fireEvent.click(screen.getByText(en.save))
    await waitFor(() => { expect(createGroup).not.toHaveBeenCalled() })
  })

  it('cancels the group form from its cancel button', () => {
    renderSection()
    fireEvent.click(screen.getByLabelText(en.createGroup))
    expect(screen.getByPlaceholderText(en.groupName)).toBeDefined()
    fireEvent.click(screen.getByLabelText(en.cancel))
    expect(screen.queryByPlaceholderText(en.groupName)).toBeNull()
  })

  it('cancels the editor from its cancel button', () => {
    renderSection()
    fireEvent.click(screen.getByText(en.create))
    expect(screen.getByPlaceholderText(en.title)).toBeDefined()
    fireEvent.click(screen.getByLabelText(en.cancel))
    expect(screen.queryByPlaceholderText(en.title)).toBeNull()
  })

  it('changes the editor category and tags before saving', async () => {
    const { create } = renderSection()
    fireEvent.click(screen.getByText(en.create))
    fireEvent.change(combo(2), { target: { value: 'api' } })
    fireEvent.change(screen.getByPlaceholderText(en.tags), { target: { value: 'alpha, beta' } })
    fireEvent.change(screen.getByPlaceholderText(en.title), { target: { value: 'New' } })
    fireEvent.click(screen.getByText(en.save))
    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ category: 'api', tags: ['alpha', 'beta'] }))
    })
  })

  it('surfaces a rejected mutation as a non-Error failure banner', async () => {
    const { create } = renderSection()
    create.mockRejectedValueOnce('plain rejection')
    fireEvent.click(screen.getByText(en.create))
    fireEvent.change(screen.getByPlaceholderText(en.title), { target: { value: 'New' } })
    fireEvent.click(screen.getByText(en.save))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('plain rejection') })
  })

  it('deletes a group after confirmation', async () => {
    const { deleteGroup } = renderSection((instance) => { instance.actions.setCatalog([ENTRY_GROUPED], [GROUP]) })
    fireEvent.click(screen.getByLabelText(en.deleteGroup))
    expect(screen.getByText(en.deleteGroupConfirm)).toBeDefined()
    fireEvent.click(screen.getByText(en.delete))
    await waitFor(() => { expect(deleteGroup).toHaveBeenCalledWith(KnowledgeGroupId('g-1')) })
  })

  it('surfaces a rejected mutation as a failure banner', async () => {
    const { create } = renderSection()
    create.mockRejectedValueOnce(new Error('boom'))
    fireEvent.click(screen.getByText(en.create))
    fireEvent.change(titleInput(), { target: { value: 'New' } })
    fireEvent.click(screen.getByText(en.save))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('boom') })
  })

  it('carries a selected group in the create payload', async () => {
    const { create } = renderSection((instance) => { instance.actions.setCatalog([], [GROUP]) })
    fireEvent.click(screen.getByText(en.create))
    fireEvent.change(combo(3), { target: { value: 'g-1' } })
    fireEvent.change(screen.getByPlaceholderText(en.title), { target: { value: 'New' } })
    fireEvent.click(screen.getByText(en.save))
    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ groupId: KnowledgeGroupId('g-1') }))
    })
  })

  it('sends no groupId when the editor explicitly leaves the group unselected', async () => {
    const { create } = renderSection((instance) => { instance.actions.setCatalog([], [GROUP]) })
    fireEvent.click(screen.getByText(en.create))
    fireEvent.change(combo(3), { target: { value: '' } })
    fireEvent.change(screen.getByPlaceholderText(en.title), { target: { value: 'New' } })
    fireEvent.click(screen.getByText(en.save))
    await waitFor(() => { expect(create).toHaveBeenCalledTimes(1) })
    const anyGroupId: unknown = expect.anything()
    expect(create).toHaveBeenCalledWith(expect.not.objectContaining({ groupId: anyGroupId }))
  })
})
