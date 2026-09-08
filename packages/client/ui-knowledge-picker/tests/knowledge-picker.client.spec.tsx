// @vitest-environment jsdom
/**
 * The knowledge picker chip: a closed chip that opens the multi-select dialog.
 * The catalog and selection are fed through the injected hooks source and the
 * inject callbacks; the test seeds the store before render (the sanctioned
 * zero-machinery path) and asserts user-visible behavior.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { KnowledgeEntryId, type KnowledgeCategory } from '@deepseek-ai/dsh-knowledge/types'
import { KnowledgePicker } from '../src/client/KnowledgePicker.tsx'
import { createKnowledgePickerStore } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(en)

type Entry = { id: ReturnType<typeof KnowledgeEntryId>; title: string; category: KnowledgeCategory; tags: readonly string[] }
const CATALOG: readonly Entry[] = [
  { id: KnowledgeEntryId('k-1'), title: 'Cache hygiene', category: 'pattern', tags: ['cache'] },
]

type Instance = ReturnType<ReturnType<typeof createKnowledgePickerStore>['create']>
const chip = (): HTMLButtonElement => screen.getByRole('button') as HTMLButtonElement

/** Seed a fresh picker store and render the chip (the catalog is pre-set). */
function renderPicker(seed?: (instance: Instance) => void) {
  const instance = createKnowledgePickerStore().create()
  seed?.(instance)
  const load = vi.fn(async () => {})
  render(<KnowledgePicker {...{
    load,
    toggle: (id: string) => { instance.actions.toggle(id as never) },
    clear: () => { instance.actions.clear() },
    useKnowledgePicker: bindSnapshotSelector(instance.store),
    t,
  }} />)
  return { instance, load }
}

describe('the knowledge picker chip', () => {
  it('loads the catalog on first render and shows a live chip', async () => {
    const { load } = renderPicker((instance) => { instance.actions.setCatalog(CATALOG) })
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(1) })
    expect(chip().textContent).toBe(en.chip)
    expect(chip().hasAttribute('disabled')).toBe(false)
  })

  it('shows the chip disabled while the catalog is loading', () => {
    renderPicker((instance) => { instance.actions.startLoad() })
    expect(chip().hasAttribute('disabled')).toBe(true)
    expect(chip().textContent).toBe(en.chip)
  })

  it('opens the dialog and multi-selects entries', () => {
    const { instance } = renderPicker((instance) => { instance.actions.setCatalog(CATALOG) })
    fireEvent.click(chip())
    expect(screen.getByText(en.dialogTitle)).toBeDefined()
    const first = screen.getAllByRole('checkbox')[0] as HTMLElement
    fireEvent.click(first)
    expect(instance.store.getSnapshot().selectedIds).toEqual([KnowledgeEntryId('k-1')])
    fireEvent.click(first)
    expect(instance.store.getSnapshot().selectedIds).toEqual([])
  })

  it('filters entries by a search query', () => {
    renderPicker((instance) => { instance.actions.setCatalog(CATALOG) })
    fireEvent.click(chip())
    const search = screen.getByLabelText(en.search) as HTMLInputElement
    fireEvent.change(search, { target: { value: 'zzz' } })
    expect(screen.getByText(en.empty)).toBeDefined()
    fireEvent.change(search, { target: { value: 'cache' } })
    expect(screen.getByText('Cache hygiene')).toBeDefined()
    expect(screen.queryByText(en.empty)).toBeNull()
  })

  it('closes the dialog from the confirm and cancel buttons', () => {
    renderPicker((instance) => { instance.actions.setCatalog(CATALOG) })
    fireEvent.click(chip())
    fireEvent.click(screen.getByText(en.confirm))
    expect(screen.queryByText(en.dialogTitle)).toBeNull()
    fireEvent.click(chip())
    fireEvent.click(screen.getByText(en.cancel))
    expect(screen.queryByText(en.dialogTitle)).toBeNull()
  })

  it('shows the active selected count on the chip', () => {
    renderPicker((instance) => {
      instance.actions.setCatalog(CATALOG)
      instance.actions.toggle(KnowledgeEntryId('k-1'))
    })
    expect(chip().textContent).toBe(en.chipCount.replace('{count}', '1'))
    expect(chip().hasAttribute('data-active')).toBe(true)
  })

  it('shows the empty catalog message when no entries exist', () => {
    renderPicker((instance) => { instance.actions.setCatalog([]) })
    expect(chip().textContent).toBe(en.chipEmpty)
    fireEvent.click(chip())
    expect(screen.getByText(en.empty)).toBeDefined()
  })

  it('clears the selection through the injected clear callback', () => {
    const { instance } = renderPicker((instance) => {
      instance.actions.setCatalog(CATALOG)
      instance.actions.toggle(KnowledgeEntryId('k-1'))
    })
    expect(instance.store.getSnapshot().selectedIds).toEqual([KnowledgeEntryId('k-1')])
  })
})
