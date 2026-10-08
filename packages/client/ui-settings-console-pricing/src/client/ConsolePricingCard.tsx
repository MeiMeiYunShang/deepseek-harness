/**
 * The model price table: one row per `(baseUrl, provider, model)` route and
 * what that route costs, in currency units per million tokens. Each route
 * carries its own peak and off-peak rates, because the accounting charges a
 * step's tokens at the rate of the band that step was served in. Rows are
 * added, edited, and removed in place, and nothing reaches the Host before
 * save: a table the checks refuse keeps every keystroke on screen and names
 * the row to correct, rather than dropping it.
 *
 * An absent or empty table is a normal state: the page says so and offers the
 * first row, and a save of an unchanged empty table writes nothing.
 */

import { IconTrashOutlineRegular, SettingsForm } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { formLabels } from './locales.ts'
import type { ConsolePricingLocaleKey } from './locales.ts'
import type {
  ConsolePricingCardFace, ConsolePricingCell, ConsolePricingDraftRow, ConsolePricingProblem, ConsolePricingProblemKind,
} from './console-pricing-card-controller.ts'
import css from './ConsolePricingCard.module.css'

/** Props the renderer binds for the price table page. */
export type ConsolePricingCardProps =
  PropsRuntime<'plugins.item'>
  & PropsLocale<'settings.consolePricing'>
  & InjectFace<ConsolePricingCardFace>

/** The route cells a duplicate row marks. */
const ROUTE_CELLS: readonly ConsolePricingCell[] = ['baseUrl', 'provider', 'model']

/** The rate cells a refused price marks. */
const RATE_CELLS: readonly ConsolePricingCell[] = [
  'peakCacheHit', 'peakCacheMiss', 'peakOutput',
  'offPeakCacheHit', 'offPeakCacheMiss', 'offPeakOutput',
]

/**
 * Locale key naming why the staged table cannot be saved.
 * @param kind - the check that refused the table.
 * @returns that check's copy key.
 */
function problemKey(kind: ConsolePricingProblemKind): ConsolePricingLocaleKey {
  switch (kind) {
    case 'baseUrl': return 'invalidBaseUrl'
    case 'provider': return 'invalidProvider'
    case 'model': return 'invalidModel'
    case 'price': return 'invalidPrice'
    case 'duplicate': return 'invalidDuplicate'
  }
}

/**
 * The cells one refusal marks as invalid.
 * @param problem - the refusal a save would hit.
 * @returns the cells it names.
 */
function problemCells(problem: ConsolePricingProblem): readonly ConsolePricingCell[] {
  switch (problem.kind) {
    case 'baseUrl': case 'provider': case 'model': return [problem.kind]
    case 'price': return RATE_CELLS
    case 'duplicate': return ROUTE_CELLS
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
function Cell({ name, placeholder, value, numeric = false, invalid = false, disabled, onEdit }: {
  /** The cell's accessible name, already unique across the table. */
  name: string
  /** What the empty cell shows; the accessible name carries the band and row. */
  placeholder: string
  /** The staged text the cell renders. */
  value: string
  /** Whether the cell holds a rate rather than an identity field. */
  numeric?: boolean
  /** Whether the row's standing refusal names this cell. */
  invalid?: boolean
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
      aria-invalid={invalid || undefined}
      disabled={disabled}
      onChange={(event) => { onEdit(event.target.value) }}
    />
  )
}

/** One price row: the route's identity, its two bands, and its removal. */
function PriceRow({ index, row, problem, disabled, t, editCell, removeRow }: {
  /** Zero-based row index, which every cell's accessible name carries. */
  index: number
  /** The staged row this line renders. */
  row: ConsolePricingDraftRow
  /** The refusal this row carries, when a save would hit one here. */
  problem: ConsolePricingProblem | undefined
  disabled: boolean
  t: (key: ConsolePricingLocaleKey) => string
  editCell: (index: number, cell: ConsolePricingCell, text: string) => void
  removeRow: (index: number) => void
}) {
  const marked = problem === undefined ? [] : problemCells(problem)
  const invalid = (cell: ConsolePricingCell): boolean => marked.includes(cell)
  return (
    <div className={css.row}>
      <Cell
        name={cellName(index, t('baseUrl'))}
        placeholder={t('baseUrl')}
        value={row.baseUrl}
        invalid={invalid('baseUrl')}
        disabled={disabled}
        onEdit={(text) => { editCell(index, 'baseUrl', text) }}
      />
      <Cell
        name={cellName(index, t('provider'))}
        placeholder={t('provider')}
        value={row.provider}
        invalid={invalid('provider')}
        disabled={disabled}
        onEdit={(text) => { editCell(index, 'provider', text) }}
      />
      <Cell
        name={cellName(index, t('model'))}
        placeholder={t('model')}
        value={row.model}
        invalid={invalid('model')}
        disabled={disabled}
        onEdit={(text) => { editCell(index, 'model', text) }}
      />
      <button
        type="button"
        className={css.remove}
        aria-label={cellName(index, t('removeRow'))}
        title={t('removeRow')}
        disabled={disabled}
        onClick={() => { removeRow(index) }}
      >
        <IconTrashOutlineRegular size={14} />
      </button>
      <div className={css.bands}>
        <div className={css.band}>
          <span className={css.bandLabel}>{t('peak')}</span>
          <Cell
            name={cellName(index, t('peak'), t('cacheHit'))}
            placeholder={t('cacheHit')}
            value={row.peakCacheHit}
            numeric
            invalid={invalid('peakCacheHit')}
            disabled={disabled}
            onEdit={(text) => { editCell(index, 'peakCacheHit', text) }}
          />
          <Cell
            name={cellName(index, t('peak'), t('cacheMiss'))}
            placeholder={t('cacheMiss')}
            value={row.peakCacheMiss}
            numeric
            invalid={invalid('peakCacheMiss')}
            disabled={disabled}
            onEdit={(text) => { editCell(index, 'peakCacheMiss', text) }}
          />
          <Cell
            name={cellName(index, t('peak'), t('output'))}
            placeholder={t('output')}
            value={row.peakOutput}
            numeric
            invalid={invalid('peakOutput')}
            disabled={disabled}
            onEdit={(text) => { editCell(index, 'peakOutput', text) }}
          />
        </div>
        <div className={css.band}>
          <span className={css.bandLabel}>{t('offPeak')}</span>
          <Cell
            name={cellName(index, t('offPeak'), t('cacheHit'))}
            placeholder={t('cacheHit')}
            value={row.offPeakCacheHit}
            numeric
            invalid={invalid('offPeakCacheHit')}
            disabled={disabled}
            onEdit={(text) => { editCell(index, 'offPeakCacheHit', text) }}
          />
          <Cell
            name={cellName(index, t('offPeak'), t('cacheMiss'))}
            placeholder={t('cacheMiss')}
            value={row.offPeakCacheMiss}
            numeric
            invalid={invalid('offPeakCacheMiss')}
            disabled={disabled}
            onEdit={(text) => { editCell(index, 'offPeakCacheMiss', text) }}
          />
          <Cell
            name={cellName(index, t('offPeak'), t('output'))}
            placeholder={t('output')}
            value={row.offPeakOutput}
            numeric
            invalid={invalid('offPeakOutput')}
            disabled={disabled}
            onEdit={(text) => { editCell(index, 'offPeakOutput', text) }}
          />
        </div>
      </div>
      {problem === undefined
        ? null
        : <p className={css.problem} role="alert">{t(problemKey(problem.kind))}</p>}
    </div>
  )
}

/**
 * Render the model price table.
 * @param props - the view the Plugins page asks for, locale copy, the page snapshot, and its table actions.
 * @returns the one-liner, or the settings form with the table.
 */
export function ConsolePricingCard(props: ConsolePricingCardProps) {
  const { t } = props
  const state = props.useConsolePricingCard(snapshot => snapshot)
  if (props.view === 'summary') return t('summary')
  const disabled = !state.writable || state.saving
  return (
    <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
      <p className={css.intro}>{t('intro')}</p>
      <p className={css.unit}>{t('unit')}</p>
      <div className={css.table}>
        {state.rows.length === 0 ? <p className={css.empty}>{t('empty')}</p> : null}
        {state.rows.map((row, index) => (
          <PriceRow
            key={index}
            index={index}
            row={row}
            problem={state.problem?.row === index ? state.problem : undefined}
            disabled={disabled}
            t={t}
            editCell={props.editCell}
            removeRow={props.removeRow}
          />
        ))}
        <button type="button" className={css.add} disabled={disabled} onClick={props.addRow}>
          {t('addRow')}
        </button>
      </div>
      {state.conflicted
        ? <p className={css.conflict} role="status">{t('conflicted')}</p>
        : null}
    </SettingsForm>
  )
}
