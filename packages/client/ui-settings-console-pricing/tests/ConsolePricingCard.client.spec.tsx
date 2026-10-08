// @vitest-environment jsdom
/** Price table presentation: rows, accessible names, refusals, and read-only chrome. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ConsolePricingCard } from '../src/client/ConsolePricingCard.tsx'
import type { ConsolePricingCardProps } from '../src/client/ConsolePricingCard.tsx'
import type { ConsolePricingCardState } from '../src/client/console-pricing-card-controller.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

/** One staged table of two routes, as the page renders it. */
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
    rows: [
      {
        baseUrl: 'https://api.deepseek.com',
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        peakCacheHit: '0.04',
        peakCacheMiss: '2',
        peakOutput: '8',
        offPeakCacheHit: '0.02',
        offPeakCacheMiss: '1',
        offPeakOutput: '4',
      },
      {
        baseUrl: 'https://api.deepseek.com',
        provider: 'deepseek-official',
        model: 'deepseek-v4-pro',
        peakCacheHit: '0.3',
        peakCacheMiss: '9',
        peakOutput: '27',
        offPeakCacheHit: '0.15',
        offPeakCacheMiss: '4.5',
        offPeakOutput: '13.5',
      },
    ],
    ...overrides,
  }
}

/**
 * The renderer-bound props for one page render. The framework's global seats
 * arrive from the live slot renderer, so this spec supplies the shares the
 * component reads and asserts on those alone.
 * @param current - the page snapshot the bound hook publishes.
 * @param view - the view the Plugins page asks for.
 * @returns the composed props.
 */
function props(current: ConsolePricingCardState, view: 'page' | 'summary' = 'page'): ConsolePricingCardProps {
  return {
    view,
    t: makeTranslate(en, zh),
    useConsolePricingCard: bindSnapshotSelector(createSnapshotStore(current)),
    editCell: vi.fn(),
    addRow: vi.fn(),
    removeRow: vi.fn(),
    save: vi.fn(),
    discard: vi.fn(),
  } as ConsolePricingCardProps
}

describe('ConsolePricingCard', () => {
  it('renders one accessible cell per route, band, and token type', () => {
    const bound = props(state())

    render(<ConsolePricingCard {...bound} />)

    expect(screen.getByLabelText<HTMLInputElement>('Endpoint 1').value).toBe('https://api.deepseek.com')
    expect(screen.getByLabelText<HTMLInputElement>('Model 2').value).toBe('deepseek-v4-pro')
    expect(screen.getByLabelText<HTMLInputElement>('Peak Cache-hit input 1').value).toBe('0.04')
    expect(screen.getByLabelText<HTMLInputElement>('Peak Output 2').value).toBe('27')
    expect(screen.getByLabelText<HTMLInputElement>('Off-peak Cache-miss input 2').value).toBe('4.5')
    expect(screen.getByText(en.unit)).toBeTruthy()
    expect(screen.getAllByText(en.peak)).toHaveLength(2)
    expect(screen.getAllByText(en.offPeak)).toHaveLength(2)
  })

  it('reports every edit as the cell it belongs to', () => {
    const bound = props(state({ dirty: true }))

    render(<ConsolePricingCard {...bound} />)
    fireEvent.change(screen.getByLabelText('Peak Output 2'), { target: { value: '30' } })
    fireEvent.click(screen.getByLabelText('Remove model route 1'))
    fireEvent.click(screen.getByRole('button', { name: en.addRow }))
    fireEvent.click(screen.getByRole('button', { name: en.save }))

    expect(bound.editCell).toHaveBeenCalledWith(1, 'peakOutput', '30')
    expect(bound.removeRow).toHaveBeenCalledWith(0)
    expect(bound.addRow).toHaveBeenCalledTimes(1)
    expect(bound.save).toHaveBeenCalledTimes(1)
  })

  it('names the row a refused table has to correct and marks its cells', () => {
    const bound = props(state({ dirty: true, invalid: true, problem: { kind: 'price', row: 1 } }))

    render(<ConsolePricingCard {...bound} />)

    expect(screen.getByRole('alert').textContent).toBe(en.invalidPrice)
    expect(screen.getByLabelText('Peak Output 2').getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByLabelText('Endpoint 2').getAttribute('aria-invalid')).toBeNull()
    expect(screen.getByRole('button', { name: en.save }).hasAttribute('disabled')).toBe(true)
  })

  it('marks the route cells of a duplicate row', () => {
    const bound = props(state({ dirty: true, invalid: true, problem: { kind: 'duplicate', row: 0 } }))

    render(<ConsolePricingCard {...bound} />)

    expect(screen.getByRole('alert').textContent).toBe(en.invalidDuplicate)
    expect(screen.getByLabelText('Provider 1').getAttribute('aria-invalid')).toBe('true')
  })

  it('says the table is empty and offers the first row', () => {
    const bound = props(state({ rows: [] }))

    render(<ConsolePricingCard {...bound} />)

    expect(screen.getByText(en.empty)).toBeTruthy()
    expect(screen.queryByLabelText('Endpoint 1')).toBeNull()
  })

  it('disables every control on a document the deployment stores read-only', () => {
    const bound = props(state({ writable: false }))

    render(<ConsolePricingCard {...bound} />)

    expect(screen.getByText(en.readOnly)).toBeTruthy()
    expect(screen.getByLabelText<HTMLInputElement>('Model 1').disabled).toBe(true)
    expect(screen.getByRole('button', { name: en.addRow }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByLabelText('Remove model route 2').hasAttribute('disabled')).toBe(true)
  })

  it('keeps the draft on screen when another writer moved the revision', () => {
    const bound = props(state({ dirty: true, conflicted: true }))

    render(<ConsolePricingCard {...bound} />)

    expect(screen.getByText(en.conflicted)).toBeTruthy()
    expect(screen.getByLabelText<HTMLInputElement>('Model 1').value).toBe('deepseek-v4-flash')
  })

  it('reports a save the deployment refused beside the retained table', () => {
    const bound = props(state({ dirty: true, failed: true }))

    render(<ConsolePricingCard {...bound} />)

    expect(screen.getByText(en.saveFailed)).toBeTruthy()
    expect(screen.getByLabelText<HTMLInputElement>('Model 1').value).toBe('deepseek-v4-flash')
  })

  it('renders the one-liner alone in the summary view', () => {
    const bound = props(state(), 'summary')

    const view = render(<ConsolePricingCard {...bound} />)

    expect(view.container.textContent).toBe(en.summary)
  })

  it('replaces the table with the unavailable line while the namespace is not served', () => {
    const bound = props(state({ available: false }))

    render(<ConsolePricingCard {...bound} />)

    expect(screen.getByText(en.unavailable)).toBeTruthy()
    expect(screen.queryByLabelText('Endpoint 1')).toBeNull()
  })
})
