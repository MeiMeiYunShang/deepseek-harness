import { useRef } from 'react'
import type { KeyboardEventHandler, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { IconCloseOutlineRegular } from './icons/index.tsx'
import { useModalLayer } from './useModalLayer.ts'
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
  shortcutModal?: string
  onKeyDownCapture?: KeyboardEventHandler<HTMLDivElement>
  backdropBlur?: boolean
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
 * @param props.onClose - application close command, Escape, or mask click; while a menu is open inside the
 * dialog, Escape belongs to that menu first.
 * @param props.title - dialog heading; also the accessible name unless `labelledBy` names a node.
 * @param props.labelledBy - id of the node that names the dialog, for headless surfaces whose title is slot content.
 * @param props.closeLabel - localized accessible close-button label.
 * @param props.description - optional supporting sentence under the title.
 * @param props.children - dialog body; mark its initial-focus control with
 * data-modal-autofocus instead of React autoFocus to preserve return focus.
 * @param props.footer - action row; `panel` spread the row so an owner may lead it with a status line.
 * @param props.size - card geometry (default 'compact').
 * @param props.contentClassName - optional class for a scrollable content region.
 * @param props.backdropBlur - disable when the caller already blurs the page; defaults to true.
 * @param props.shortcutModal - command scope allowed by shortcut owners; unnamed
 * dialogs block application commands unless their owner allows the "other" scope.
 * @param props.headless - render children directly in the card (no default
 * header/close/body chrome); mask, card, Escape, and the accessible name remain.
 * @param props.onKeyDownCapture - handle a nested dialog's keys before the document Escape listeners.
 * @returns null when closed; otherwise the overlay tree.
 */
export function Modal({
  open, onClose, description, children, footer, className, contentClassName, size = 'compact',
  onKeyDownCapture, backdropBlur = true, shortcutModal, ...props
}: ModalProps) {
  const headless = props.headless === true
  const labelledBy = props.labelledBy
  const title = props.title
  // The name travels as the attribute the surface can honor: a headless shell
  // paints its heading through a slot, whose node id it already owns.
  const name = labelledBy === undefined ? { 'aria-label': title } : { 'aria-labelledby': labelledBy }
  const dialog = useRef<HTMLDivElement>(null)
  useModalLayer(dialog, open, onClose)

  if (!open) return null

  return createPortal((
    <div className={css.root} role="presentation" onKeyDownCapture={onKeyDownCapture}>
      <div className={css.mask} style={backdropBlur ? undefined : { backdropFilter: 'none' }} aria-hidden="true" onClick={onClose} />
      <div
        ref={dialog}
        tabIndex={-1}
        data-shortcut-modal={shortcutModal}
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
                    <IconCloseOutlineRegular size={14} />
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
