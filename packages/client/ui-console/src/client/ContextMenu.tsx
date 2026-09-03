/**
 * Session context menu: a cursor-anchored Menu with rename / fork / archive
 * actions for the grid cell that invoked it.
 */

import { IconEditOutline16, IconBranchOutline16, IconArchiveOutline20 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConsoleKey } from './locales.ts'
import css from './console.module.css'

/** Props for the context menu. */
export interface ContextMenuProps {
  t: (key: ConsoleKey) => string
  /** Menu list x position (the right-click clientX). */
  x: number
  /** Menu list y position (the right-click clientY). */
  y: number
  onClose: () => void
  onRename: () => void
  onFork: () => void
  onArchive: () => void
}

/** Build the menu entries for a session with its archive state. */
export function contextMenuItems(
  t: (key: ConsoleKey) => string,
  archived: boolean,
): readonly MenuEntry[] {
  return [
    { id: 'rename', label: <span className={css.menuItem}>{t('rename')}</span>, icon: <IconEditOutline16 size={14} /> },
    { id: 'fork', label: <span className={css.menuItem}>{t('fork')}</span>, icon: <IconBranchOutline16 size={14} /> },
    { id: 'archive', label: <span className={css.menuItem}>{t('archive')}</span>, icon: <IconArchiveOutline20 size={14} />, danger: archived },
  ]
}

/** Placeholder for the Menu anchor: the cursor-anchored list only needs a rect. */
export function contextAnchorRect(x: number, y: number): () => DOMRect {
  return () => new DOMRect(x, y, 0, 0)
}
