/**
 * Knowledge-base card. The console's knowledge catalog has no backend seam
 * yet, so the card shows a single source row in its placeholder state; the
 * row type is exported so a future seam can feed it.
 */

import type { ConsoleKey } from './locales.ts'
import css from './console.module.css'

/** One knowledge source row. */
export interface KnowledgeItem {
  /** Stable row id. */
  readonly id: string
  /** Source display name. */
  readonly name: string
  /** Whether it is the most recently updated source. */
  readonly latest: boolean
}

/** Props for the knowledge card. */
export interface KnowledgeCardProps {
  /** Translator. */
  t: (key: ConsoleKey) => string
  /** Source rows; absent/empty renders the empty hint. */
  items?: readonly KnowledgeItem[]
}

/** Knowledge-base card: the source list or its empty state. */
export function KnowledgeCard({ t, items = [] }: KnowledgeCardProps) {
  return (
    <div className={css.card}>
      <h3 className={css.cardTitle}>{t('knowledge')}</h3>
      <div className={css.knowledgeList}>
        {items.length === 0
          ? <span className={css.emptyHint}>{t('knowledgeEmpty')}</span>
          : items.map(item => (
            <div key={item.id} className={css.knowledgeItem}>
              <span className={css.knowledgeName}>{item.name}</span>
              {item.latest && <span className={css.latestBadge}>{t('knowledgeLatest')}</span>}
            </div>
          ))}
      </div>
    </div>
  )
}
