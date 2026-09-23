import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { IconCloseOutline16 } from './icons/index.tsx'
import css from './Modal.module.css'

/**
 * Card geometry. `compact` is the 380px form card a prompt or confirmation
 * uses; `panel` is the settings surface — 800px wide with a viewport-bounded
 * height — that a catalog, editor, or browser dialog shares with the settings
 * shell, so the two cannot drift apart.
 */
export type ModalSize = 'compact' | 'panel'

interface ModalCommonProps {
  open: boolean
  onClose: () => void
  description?: string
  children?: ReactNode
  footer?: ReactNode
  /** Extra class on the card; the size still owns width, height, and radius. */
  className?: string
  /** Optional class for the scrolling content region. */
  contentClassName?: string
  size?: ModalSize
}

/** A headless surface paints its own card interior, so it may name itself from a rendered node. */
type ModalHeadlessProps = ModalCommonProps & { headless: true; closeLabel?: never } & (
  | { title: string; labelledBy?: never }
  | { labelledBy: string; title?: never }
)

/** Default chrome renders the title row, so the dialog always names itself from `title`. */
type ModalChromeProps = ModalCommonProps & {
  headless?: false
  closeLabel: string
  title: string
  labelledBy?: never
}

type ModalProps = ModalHeadlessProps | ModalChromeProps

/**
 * Render a centered, body-portaled modal over a blurred page mask.
 * @param props.open - whether the dialog is showing.
 * @param props.onClose - Escape or mask click.
 * @param props.title - dialog heading; also the accessible name unless `labelledBy` names a node.
 * @param props.labelledBy - id of the node that names the dialog, for headless surfaces whose title is slot content.
 * @param props.closeLabel - localized accessible close-button label.
 * @param props.description - optional supporting sentence under the title.
 * @param props.children - body (inputs, catalogs, editors).
 * @param props.footer - action row; `panel` spread the row so an owner may lead it with a status line.
 * @param props.size - card geometry (default 'compact').
 * @param props.contentClassName - optional class for a scrollable content region.
 * @param props.headless - render children directly in the card (no default
 * header/close/body chrome); mask, card, Escape, and the accessible name remain.
 * @returns null when closed; otherwise the overlay tree.
 */
export function Modal({
  open, onClose, description, children, footer, className, contentClassName, size = 'compact', ...props
}: ModalProps) {
  const headless = props.headless === true
  const labelledBy = props.labelledBy
  const title = props.title
  // The name travels as the attribute the surface can honor: a headless shell
  // paints its heading through a slot, whose node id it already owns.
  const name = labelledBy === undefined ? { 'aria-label': title } : { 'aria-labelledby': labelledBy }

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open, onClose])

  if (!open) return null

  return createPortal((
    <div className={css.root} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div
        className={clsx(css.dialog, css[size], className)}
        role="dialog"
        aria-modal="true"
        {...name}
      >
        {headless
          ? children
          : (
            <>
              <div className={clsx(css.content, contentClassName)}>
                <div className={css.header}>
                  <h2 className={css.title}>{title}</h2>
                  <button type="button" className={css.close} aria-label={props.closeLabel} onClick={onClose}>
                    <IconCloseOutline16 size={14} />
                  </button>
                </div>
                {description !== undefined && description !== '' && (
                  <p className={css.description}>{description}</p>
                )}
                {children !== undefined && <div className={css.body}>{children}</div>}
              </div>
              {footer !== undefined && <div className={css.footer}>{footer}</div>}
            </>
          )}
      </div>
    </div>
  ), document.body)
}
