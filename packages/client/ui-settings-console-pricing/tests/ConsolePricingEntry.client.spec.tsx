// @vitest-environment jsdom
/** The console entry: its header action, the dialog it opens, and the routes that dialog names. */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ModelPrice } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionStatsRoute } from '@deepseek-ai/dsh-session-stats/types'
import { ConsolePricingEntry } from '../src/client/ConsolePricingEntry.tsx'
import type { ConsolePricingEntryProps } from '../src/client/ConsolePricingEntry.tsx'
import type { ConsolePricingCardState } from '../src/client/console-pricing-card-controller.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

/** One route bucket, as the card hands it down. */
function route(model: string): SessionStatsRoute {
  const band = { inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 1000, cacheWriteTokens: 0 }
  return { provider: 'deepseek-official', model, peak: band, offPeak: band }
}

/** One price row for the same route, as the saved table holds it. */
const FLASH_PRICE: ModelPrice = {
  baseUrl: 'https://api.deepseek.com',
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
  offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
}

/** The staged draft the dialog renders. */
function state(overrides: Partial<ConsolePricingCardState> = {}): ConsolePricingCardState {
  return {
    available: true,
    writable: true,
    dirty: false,
    invalid: false,
    saving: false,
    failed: false,
    conflicted: false,
    problem: undefined,
    rows: [{
      baseUrl: 'https://api.deepseek.com',
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      peakCacheHit: '0.04',
      peakCacheMiss: '2',
      peakOutput: '8',
      offPeakCacheHit: '0.02',
      offPeakCacheMiss: '1',
      offPeakOutput: '4',
    }],
    ...overrides,
  }
}

/**
 * The renderer-bound props for one card render. The framework's global seats
 * arrive from the live slot renderer, so this spec supplies the shares the
 * component reads and asserts on those alone.
 * @param overrides - the scoped routes the card aggregated, the table it charged, and the draft.
 * @returns the composed props.
 */
function props(overrides: Partial<ConsolePricingEntryProps> = {}): ConsolePricingEntryProps {
  return {
    routes: [route('deepseek-v4-flash')],
    prices: [],
    t: makeTranslate(en, zh),
    useConsolePricingCard: bindSnapshotSelector(createSnapshotStore(state())),
    editCell: vi.fn(),
    addRow: vi.fn(),
    removeRow: vi.fn(),
    save: vi.fn(),
    discard: vi.fn(),
    ...overrides,
  } as ConsolePricingEntryProps
}

describe('ConsolePricingEntry', () => {
  it('shows only the action until the operator opens the table', () => {
    render(<ConsolePricingEntry {...props()} />)

    expect(screen.getByRole('button', { name: en.entry })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByLabelText('Endpoint 1')).toBeNull()
  })

  it('opens the price table in a dialog over the workbench', () => {
    render(<ConsolePricingEntry {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: en.entry }))

    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe(en.title)
    expect(screen.getByLabelText<HTMLInputElement>('Model 1').value).toBe('deepseek-v4-flash')
  })

  it('leads with the routes the card could not bill, and with the table otherwise', () => {
    render(<ConsolePricingEntry {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: en.entry }))
    expect(screen.getByText(en.entryUnpriced.replace('{count}', '1'))).toBeTruthy()

    cleanup()
    render(<ConsolePricingEntry {...props({ prices: [FLASH_PRICE] })} />)
    fireEvent.click(screen.getByRole('button', { name: en.entry }))
    expect(screen.getByText(en.summary)).toBeTruthy()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByText(en.entryUnpricedRoutes)).toBeNull()
    expect(within(dialog).queryByText(en.entryAmbiguousRoutes)).toBeNull()
  })

  it('lists each unpriced route by the provider and model a new row must match', () => {
    render(<ConsolePricingEntry {...props({ routes: [route('deepseek-v4-flash'), route('deepseek-v4-pro')] })} />)
    fireEvent.click(screen.getByRole('button', { name: en.entry }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(en.entryUnpricedRoutes)).toBeTruthy()
    expect(within(dialog).getByText('deepseek-official/deepseek-v4-flash')).toBeTruthy()
    expect(within(dialog).getByText('deepseek-official/deepseek-v4-pro')).toBeTruthy()
  })

  it('lists a route two rows price at once, where nothing is unpriced', () => {
    // Both rows carry the bucket's provider and model and differ only by the
    // endpoint the bucket never reported, so no route is unpriced and the lead
    // stays the table's own line while the ambiguous route is still named.
    const priced: ModelPrice[] = [FLASH_PRICE, { ...FLASH_PRICE, baseUrl: 'https://other.example.com' }]
    render(<ConsolePricingEntry {...props({ prices: priced })} />)
    fireEvent.click(screen.getByRole('button', { name: en.entry }))

    expect(screen.getByText(en.summary)).toBeTruthy()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(en.entryAmbiguousRoutes)).toBeTruthy()
    expect(within(dialog).getByText('deepseek-official/deepseek-v4-flash')).toBeTruthy()
  })

  it('reports edits and the save through the staged face bound to this entry', () => {
    // A shared draft frame enables Save only once something is staged, so this
    // case renders the dialog over a dirty table rather than asserting on a
    // control the form keeps disabled.
    const bound = props({ useConsolePricingCard: bindSnapshotSelector(createSnapshotStore(state({ dirty: true }))) })
    render(<ConsolePricingEntry {...bound} />)
    fireEvent.click(screen.getByRole('button', { name: en.entry }))
    fireEvent.change(screen.getByLabelText('Peak Output 1'), { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: en.addRow }))
    fireEvent.click(screen.getByRole('button', { name: en.save }))

    expect(bound.editCell).toHaveBeenCalledWith(0, 'peakOutput', '9')
    expect(bound.addRow).toHaveBeenCalledTimes(1)
    expect(bound.save).toHaveBeenCalledTimes(1)
  })

  it('drops the dialog and discards what it staged when closed without saving', () => {
    const bound = props()
    render(<ConsolePricingEntry {...bound} />)
    fireEvent.click(screen.getByRole('button', { name: en.entry }))
    fireEvent.click(screen.getByRole('button', { name: en.close }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(bound.discard).toHaveBeenCalledTimes(1)
  })
})
