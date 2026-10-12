/**
 * The console composer's local candidate menu: a self-contained, controlled
 * dropdown the console owns rather than the chat's shared input-trigger
 * controller. It positions itself `fixed` from the composer field's live rect,
 * so it escapes the timeline card's `overflow: hidden` (a fixed element is not
 * clipped by a scrolling ancestor that owns no containing block) and is never
 * cut off, clamping its height to the room above the field. Focus stays in the
 * textarea (the combobox pattern): rows are `mousedown`-handled so a pick never
 * steals focus, the highlight is a controlled index the parent moves with the
 * keyboard, and a pointer outside the menu and outside the composer card, or an
 * Escape, dismisses it.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { MenuSurface } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './console.module.css'

/** One rendered candidate row. */
export interface ComposerMenuRow {
  /** Stable option key (the command name or file path). */
  readonly id: string
  /** Primary label — the command name or file path. */
  readonly label: string
  /** Optional secondary name shown beside a localized label; unused for now. */
  readonly alias?: string
  /** Right-aligned description from the catalog, shown verbatim. */
  readonly description?: string
}

/** Props of the controlled candidate menu. */
export interface ComposerMenuProps {
  /** The composer field the menu opens above; null leaves the menu unplaced. */
  anchorEl: HTMLElement | null
  /** The composer card: a pointer inside it must not dismiss the menu. */
  composerEl: HTMLElement | null
  /** Rows in display order (already filtered by the parent). */
  rows: readonly ComposerMenuRow[]
  /** Controlled highlight index, or null while nothing is highlighted. */
  activeIndex: number | null
  /** Whether a fetch is in flight (skeleton rows while the list is empty). */
  loading: boolean
  /** The listbox DOM id (the textarea's `aria-controls` target). */
  listId: string
  /** Prefix of each option's DOM id, so the parent computes `aria-activedescendant`. */
  optionIdPrefix: string
  /** Move the highlight to a row (pointer motion). */
  onHover: (index: number) => void
  /** Pick a row. */
  onPick: (index: number) => void
  /** Dismiss the menu (outside pointer, or Escape). */
  onDismiss: () => void
  /** Accessible name of the option list. */
  ariaLabel: string
  /** Copy shown when a settled fetch matched nothing. */
  emptyLabel: string
  /** Accessible label for the loading state. */
  loadingLabel: string
}

/** Height cap matching the chat menu's design cap. */
const MAX_HEIGHT = 400

/** Viewport top clearance, so a tall list stops short of the window top. */
const TOP_CLEARANCE = 84

/**
 * Render the console composer's candidate menu.
 * @param props - the controlled rows, highlight, pick/hover/dismiss routes, and copy.
 * @returns a fixed-position surface while it has an anchor; null otherwise.
 */
export function ComposerMenu(props: ComposerMenuProps) {
  const {
    anchorEl, composerEl, rows, activeIndex, loading, listId, optionIdPrefix,
    onHover, onPick, onDismiss, ariaLabel, emptyLabel, loadingLabel,
  } = props
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const [placement, setPlacement] = useState<{ left: number; width: number; bottom: number; maxHeight: number } | null>(null)

  // Measure the anchor on every row change (the composer grows as the draft
  // wraps, moving its top edge), and re-measure on scroll/resize so the menu
  // tracks the field rather than drifting from it.
  const measure = useCallback((): void => {
    if (anchorEl === null) {
      setPlacement(null)
      return
    }
    const rect = anchorEl.getBoundingClientRect()
    const spaceAbove = Math.max(0, rect.top - TOP_CLEARANCE)
    setPlacement({
      left: rect.left,
      width: rect.width,
      bottom: window.innerHeight - rect.top + 4,
      maxHeight: Math.min(MAX_HEIGHT, spaceAbove),
    })
  }, [anchorEl])

  useLayoutEffect(() => {
    measure()
  }, [measure, rows.length, loading])
  useEffect(() => {
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [measure])

  // Dismiss on a pointer outside the menu AND outside the composer card (the
  // field and its control row must not close the menu they opened).
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (surfaceRef.current?.contains(target)) return
      if (composerEl?.contains(target)) return
      onDismiss()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => { document.removeEventListener('pointerdown', onPointerDown, true) }
  }, [composerEl, onDismiss])

  if (placement === null) return null
  return (
    <MenuSurface
      ref={surfaceRef}
      className={css.composerMenu}
      style={{
        position: 'fixed',
        left: placement.left,
        width: placement.width,
        bottom: placement.bottom,
        maxHeight: placement.maxHeight,
      }}
    >
      <div className={css.composerMenuViewport} role="listbox" id={listId} aria-label={ariaLabel}>
        {rows.length === 0
          ? (
            loading
              ? (
                <div role="status" aria-label={loadingLabel}>
                  <div className={css.composerMenuSkeleton} />
                  <div className={css.composerMenuSkeleton} />
                </div>
              )
              : <div className={css.composerMenuEmpty}>{emptyLabel}</div>
          )
          : rows.map((row, index) => (
            <button
              key={row.id}
              id={`${optionIdPrefix}-${index}`}
              type="button"
              role="option"
              aria-selected={activeIndex === index}
              className={clsx(css.composerMenuItem, activeIndex === index && css.composerMenuItemActive)}
              // mousedown, not click: the textarea keeps focus (combobox).
              onMouseDown={(event) => {
                event.preventDefault()
                onPick(index)
              }}
              onMouseMove={activeIndex === index ? undefined : () => { onHover(index) }}
            >
              <span className={css.composerMenuName}>{row.label}</span>
              {row.description !== undefined && <span className={css.composerMenuDescription}>{row.description}</span>}
            </button>
          ))}
      </div>
    </MenuSurface>
  )
}
