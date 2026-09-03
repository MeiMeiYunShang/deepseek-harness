// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { contextAnchorRect, contextMenuItems } from '../src/client/ContextMenu.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: string): string => (en as Record<string, string>)[key] ?? key

describe('contextMenuItems', () => {
  it('builds rename, fork, and archive rows', () => {
    const items = contextMenuItems(t, false)
    expect(items.map(item => ('id' in item ? item.id : null))).toEqual(['rename', 'fork', 'archive'])
  })
})

describe('contextAnchorRect', () => {
  it('returns the cursor-derived dropdown rect', () => {
    const rect = contextAnchorRect(10, 20)()
    expect(rect.x).toBe(10)
    expect(rect.y).toBe(20)
  })
})

describe('ContextMenu rendering through Menu', () => {
  it('renders the menu once its entries are handed to a Menu', () => {
    render(<Menu
      open
      anchor={null}
      portal={false}
      items={contextMenuItems(t, false)}
      onSelect={() => {}}
      onClose={() => {}}
    />)
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /rename/i })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /fork/i })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /archive/i })).toBeTruthy()
  })
})
