/**
 * The console-pricing card: one row per `(baseUrl, provider, model)` route and
 * what that route costs, in currency units per million tokens. Each route
 * carries its own peak and off-peak rates, because the accounting charges a
 * step's tokens at the rate of the band that step was served in. Rows are
 * added, edited, and removed in place, and nothing reaches the Host before save.
 * A table the checks refuse keeps every keystroke on screen and names the row to
 * correct, rather than dropping it.
 *
 * An absent or empty table is a normal state: the card says so and offers the
 * first row, and a save of an unchanged empty table writes nothing.
 */

import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { PluginCard } from './PluginCard.tsx'
import type { PluginsSettingsLocaleKey } from './locales.ts'
import type {
  ConsolePricingCardFace, ConsolePricingProblemKind,
} from './console-pricing-card-controller.ts'
import type {} from './slot-contract.ts'
import css from './ConsolePricingCard.module.css'

/** Props the renderer binds for the console-pricing card. */
export type ConsolePricingCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<ConsolePricingCardFace>

/**
 * Locale key naming why the staged table cannot be saved.
 * @param kind - the check that refused the table.
 * @returns that check's copy key.
 */
function problemKey(kind: ConsolePricingProblemKind): PluginsSettingsLocaleKey {
  switch (kind) {
    case 'baseUrl': return 'consolePricingInvalidBaseUrl'
    case 'provider': return 'consolePricingInvalidProvider'
    case 'model': return 'consolePricingInvalidModel'
    case 'price': return 'consolePricingInvalidPrice'
    case 'duplicate': return 'consolePricingInvalidDuplicate'
  }
}

/**
 * One cell's accessible name: its own copy, its band when it belongs to one, and
 * the row it sits in, so every field of every row is addressed on its own.
 * @param index - zero-based row index.
 * @param copy - the cell's localized name, band first.
 * @returns the cell's accessible name.
 */
function cellName(index: number, ...copy: string[]): string {
  return `${copy.join(' ')} ${index + 1}`
}

/** One editable cell of one price row. */
function Cell({ name, placeholder, value, numeric = false, disabled, onEdit }: {
  /** The cell's accessible name, already unique across the table. */
  name: string
  /** What the empty cell shows; the accessible name carries the band and row. */
  placeholder: string
  /** The staged text the cell renders. */
  value: string
  /** Whether the cell holds a rate rather than an identity field. */
  numeric?: boolean
  disabled: boolean
  onEdit: (text: string) => void
}) {
  return (
    <input
      className={css.input}
      type="text"
      inputMode={numeric ? 'decimal' : 'text'}
      value={value}
      placeholder={placeholder}
      aria-label={name}
      disabled={disabled}
      onChange={(event) => { onEdit(event.target.value) }}
    />
  )
}

/** Removal glyph for one price row. */
function IconTrash(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4M6.5 6.8v4.4M9.5 6.8v4.4"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Render the price table.
 * @param props - locale copy, the card snapshot, and its table actions.
 * @returns the card, or nothing when the namespace is unavailable.
 */
export function ConsolePricingCard(props: ConsolePricingCardProps) {
  const { t } = props
  const state = props.useConsolePricingCard(snapshot => snapshot)
  const disabled = !state.writable || state.saving
  return (
    <PluginCard
      t={t}
      titleKey="consolePricingTitle"
      descriptionKey="consolePricingDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <p className={css.unit}>{t('consolePricingUnit')}</p>
      <div className={css.table}>
        {state.rows.length === 0 ? <p className={css.empty}>{t('consolePricingEmpty')}</p> : null}
        {state.rows.map((row, index) => {
          const problem = state.problem
          return (
            <div key={index} className={css.row}>
              <Cell
                name={cellName(index, t('consolePricingBaseUrl'))}
                placeholder={t('consolePricingBaseUrl')}
                value={row.baseUrl}
                disabled={disabled}
                onEdit={(text) => { props.editCell(index, 'baseUrl', text) }}
              />
              <Cell
                name={cellName(index, t('consolePricingProvider'))}
                placeholder={t('consolePricingProvider')}
                value={row.provider}
                disabled={disabled}
                onEdit={(text) => { props.editCell(index, 'provider', text) }}
              />
              <Cell
                name={cellName(index, t('consolePricingModel'))}
                placeholder={t('consolePricingModel')}
                value={row.model}
                disabled={disabled}
                onEdit={(text) => { props.editCell(index, 'model', text) }}
              />
              <button
                type="button"
                className={css.remove}
                aria-label={`${t('consolePricingRemoveRow')} ${index + 1}`}
                title={t('consolePricingRemoveRow')}
                disabled={disabled}
                onClick={() => { props.removeRow(index) }}
              >
                <IconTrash />
              </button>
              <div className={css.bands}>
                <div className={css.band}>
                  <span className={css.bandLabel}>{t('consolePricingPeak')}</span>
                  <Cell
                    name={cellName(index, t('consolePricingPeak'), t('consolePricingCacheHit'))}
                    placeholder={t('consolePricingCacheHit')}
                    value={row.peakCacheHit}
                    numeric
                    disabled={disabled}
                    onEdit={(text) => { props.editCell(index, 'peakCacheHit', text) }}
                  />
                  <Cell
                    name={cellName(index, t('consolePricingPeak'), t('consolePricingCacheMiss'))}
                    placeholder={t('consolePricingCacheMiss')}
                    value={row.peakCacheMiss}
                    numeric
                    disabled={disabled}
                    onEdit={(text) => { props.editCell(index, 'peakCacheMiss', text) }}
                  />
                  <Cell
                    name={cellName(index, t('consolePricingPeak'), t('consolePricingOutputPrice'))}
                    placeholder={t('consolePricingOutputPrice')}
                    value={row.peakOutput}
                    numeric
                    disabled={disabled}
                    onEdit={(text) => { props.editCell(index, 'peakOutput', text) }}
                  />
                </div>
                <div className={css.band}>
                  <span className={css.bandLabel}>{t('consolePricingOffPeak')}</span>
                  <Cell
                    name={cellName(index, t('consolePricingOffPeak'), t('consolePricingCacheHit'))}
                    placeholder={t('consolePricingCacheHit')}
                    value={row.offPeakCacheHit}
                    numeric
                    disabled={disabled}
                    onEdit={(text) => { props.editCell(index, 'offPeakCacheHit', text) }}
                  />
                  <Cell
                    name={cellName(index, t('consolePricingOffPeak'), t('consolePricingCacheMiss'))}
                    placeholder={t('consolePricingCacheMiss')}
                    value={row.offPeakCacheMiss}
                    numeric
                    disabled={disabled}
                    onEdit={(text) => { props.editCell(index, 'offPeakCacheMiss', text) }}
                  />
                  <Cell
                    name={cellName(index, t('consolePricingOffPeak'), t('consolePricingOutputPrice'))}
                    placeholder={t('consolePricingOutputPrice')}
                    value={row.offPeakOutput}
                    numeric
                    disabled={disabled}
                    onEdit={(text) => { props.editCell(index, 'offPeakOutput', text) }}
                  />
                </div>
              </div>
              {problem !== undefined && problem.row === index
                ? <p className={css.problem} role="alert">{t(problemKey(problem.kind))}</p>
                : null}
            </div>
          )
        })}
        <button
          type="button"
          className={css.add}
          disabled={disabled}
          onClick={props.addRow}
        >
          {t('consolePricingAddRow')}
        </button>
      </div>
    </PluginCard>
  )
}
