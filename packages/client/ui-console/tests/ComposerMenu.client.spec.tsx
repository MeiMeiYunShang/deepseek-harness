// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { ComposerMenu } from '../src/client/ComposerMenu.tsx'
import type { ComposerMenuRow } from '../src/client/ComposerMenu.tsx'

afterEach(cleanup)

/** Rows the menu renders verbatim; the parent owns filtering. */
const ROWS: readonly ComposerMenuRow[] = [
  { id: 'deploy', label: '/deploy', description: 'Ship it' },
  { id: 'rollback', label: '/rollback' },
]

/**
 * Mount the menu against an in-document anchor so its measured placement is
 * non-null and the surface actually paints. Returns the mounted anchor.
 */
function mount(props: Partial<ComponentProps<typeof ComposerMenu>> = {}) {
  const anchor = document.createElement('div')
  document.body.appendChild(anchor)
  const onPick = props.onPick ?? vi.fn()
  const onDismiss = props.onDismiss ?? vi.fn()
  render(<ComposerMenu
    anchorEl={anchor}
    composerEl={null}
    rows={ROWS}
    activeIndex={0}
    loading={false}
    listId="list"
    optionIdPrefix="opt"
    onHover={vi.fn()}
    onPick={onPick}
    onDismiss={onDismiss}
    ariaLabel="Commands"
    emptyLabel="No matching command."
    loadingLabel="Loading"
    {...props}
  />)
  return { anchor, onPick, onDismiss }
}

describe('ComposerMenu', () => {
  it('renders each row as a listbox option, description included', () => {
    mount()
    expect(screen.getByRole('listbox', { name: 'Commands' })).toBeTruthy()
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[0]?.textContent).toContain('/deploy')
    expect(options[0]?.textContent).toContain('Ship it')
    expect(options[0]?.getAttribute('aria-selected')).toBe('true')
  })

  it('shows the empty copy once rows settle empty and no fetch is in flight', () => {
    mount({ rows: [], loading: false })
    expect(screen.getByText('No matching command.')).toBeTruthy()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('shows the loading status while a fetch is in flight with nothing yet', () => {
    mount({ rows: [], loading: true })
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy()
  })

  it('picks a row on mousedown with its index, keeping focus off the option', () => {
    const { onPick } = mount()
    const second = screen.getAllByRole('option')[1]!
    fireEvent.mouseDown(second)
    expect(onPick).toHaveBeenCalledWith(1)
  })

  it('dismisses on a pointer down outside the surface', () => {
    const { onDismiss, anchor } = mount()
    // The anchor (outside the menu, with no composerEl) is an outside press.
    act(() => {
      anchor.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })
    expect(onDismiss).toHaveBeenCalled()
  })

  it('renders nothing without an anchor to place itself against', () => {
    render(<ComposerMenu
      anchorEl={null}
      composerEl={null}
      rows={ROWS}
      activeIndex={null}
      loading={false}
      listId="list"
      optionIdPrefix="opt"
      onHover={vi.fn()}
      onPick={vi.fn()}
      onDismiss={vi.fn()}
      ariaLabel="Commands"
      emptyLabel="No matching command."
      loadingLabel="Loading"
    />)
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
