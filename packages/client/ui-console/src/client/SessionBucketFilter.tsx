/**
 * Session-grid bucket filter: a dropdown of the five status buckets, each row
 * checking that bucket in or out of the grid. The selection lives in the console
 * store; this component owns only whether its own list is open.
 */

import { useState } from 'react'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConsoleKey } from './locales.ts'
import { SESSION_BUCKETS, sessionBucketLabel } from './sessionState.ts'
import type { SessionBucket } from './sessionState.ts'
import css from './console.module.css'

/** Props for the session-grid bucket filter. */
export interface SessionBucketFilterProps {
  /** Translator. */
  t: (key: ConsoleKey) => string
  /** The buckets whose squares the grid renders. */
  selected: readonly SessionBucket[]
  /** Toggle one bucket's selection. */
  onToggle: (bucket: SessionBucket) => void
}

/** One checkable row per bucket, in the order the filter lists them. */
function bucketItems(t: (key: ConsoleKey) => string): readonly MenuEntry[] {
  return SESSION_BUCKETS.map(bucket => ({
    id: bucket,
    label: <span className={css.menuItem}>{t(sessionBucketLabel(bucket))}</span>,
  }))
}

/**
 * Grid-filter dropdown: a trigger that reports its own expanded state, and a
 * checkable row per bucket. The list stays open across a toggle so several
 * buckets can be changed in one visit, and the Menu closes it on Escape or an
 * outside click.
 * @param props - translator, the selected buckets, and the bucket toggle.
 * @returns the trigger and its anchored list.
 */
export function SessionBucketFilter({ t, selected, onToggle }: SessionBucketFilterProps) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      // Portaled: the card clips its own overflow, which would crop the list.
      portal
      anchor={(
        <button
          type="button"
          className={css.sessionFilterTrigger}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => { setOpen(value => !value) }}
        >
          <span>{t('sessionFilter')}</span>
          <IconChevronDownOutline14 />
        </button>
      )}
      items={bucketItems(t)}
      selectedIds={selected}
      onSelect={(bucket) => { onToggle(bucket as SessionBucket) }}
      onClose={() => { setOpen(false) }}
    />
  )
}
