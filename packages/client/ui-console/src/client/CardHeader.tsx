/**
 * Shared console card header: a title, an optional right-aligned actions area,
 * and a fold toggle that hides the card body. Cards opt in by rendering this
 * and wrapping their body in the `collapsed` flag.
 */

import type { ReactNode } from 'react'
import { IconChevronDownOutline14, IconChevronUpOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConsoleKey } from './locales.ts'
import css from './console.module.css'

/** Props for the shared card header. */
export interface CardHeaderProps {
  /** Translator. */
  t: (key: ConsoleKey) => string
  /** Card title. */
  title: string
  /** Whether the card body is collapsed; omit with `onToggleCollapse` for a card that cannot fold. */
  collapsed?: boolean
  /** Toggle the collapsed state; omitted, the header renders no fold control. */
  onToggleCollapse?: () => void
  /** Right-aligned actions (e.g. the new-session button, a mode toggle). */
  actions?: ReactNode
  /** Control rendered directly after the title, before the free space. */
  afterTitle?: ReactNode
}

/** Card title row with a fold toggle and an optional actions area. */
export function CardHeader({ t, title, collapsed, onToggleCollapse, actions, afterTitle }: CardHeaderProps) {
  return (
    <div className={css.cardHeader}>
      {/* The group grows so the title stays left, a control placed after it
          lands beside the title rather than against the actions. */}
      <div className={css.cardTitleGroup}>
        <h3 className={css.cardTitle}>{title}</h3>
        {afterTitle}
      </div>
      {actions !== undefined && <div className={css.cardHeaderActions}>{actions}</div>}
      {onToggleCollapse !== undefined && (
        <button
          type="button"
          className={css.foldButton}
          aria-expanded={collapsed !== true}
          aria-label={collapsed === true ? t('expand') : t('collapse')}
          onClick={onToggleCollapse}
        >
          {collapsed === true ? <IconChevronDownOutline14 /> : <IconChevronUpOutline14 />}
        </button>
      )}
    </div>
  )
}
