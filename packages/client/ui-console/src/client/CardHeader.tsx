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
  /** Whether the card body is collapsed. */
  collapsed: boolean
  /** Toggle the collapsed state. */
  onToggleCollapse: () => void
  /** Right-aligned actions (e.g. the new-session button, a mode toggle). */
  actions?: ReactNode
}

/** Card title row with a fold toggle and an optional actions area. */
export function CardHeader({ t, title, collapsed, onToggleCollapse, actions }: CardHeaderProps) {
  return (
    <div className={css.cardHeader}>
      <h3 className={css.cardTitle}>{title}</h3>
      {actions !== undefined && <div className={css.cardHeaderActions}>{actions}</div>}
      <button
        type="button"
        className={css.foldButton}
        aria-expanded={!collapsed}
        aria-label={collapsed ? t('expand') : t('collapse')}
        onClick={onToggleCollapse}
      >
        {collapsed ? <IconChevronDownOutline14 /> : <IconChevronUpOutline14 />}
      </button>
    </div>
  )
}
