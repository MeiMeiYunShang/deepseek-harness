/**
 * The console's price-settings entry: the action the task-statistics card's
 * header gains while this plugin is mounted, opening the same model price
 * table in a dialog over the workbench.
 *
 * The card hands down the route buckets it aggregated and the table it charged,
 * so the entry can name the routes that figure could not bill — each one by its
 * own `provider/model` label, under the reason it went unbilled. Editing runs
 * through a staged draft of this dialog's own: closing it without saving drops
 * what the dialog staged and leaves the Plugins page's draft untouched.
 */

import { useState } from 'react'
import { Modal, SettingsForm, totalCost } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the console's SlotMap merge (the 'console.task-stats.action' seat).
import type {} from '@deepseek-ai/dsh-client-ui-console/client'
import { formLabels } from './locales.ts'
import type { ConsolePricingCardFace } from './console-pricing-card-controller.ts'
import { PriceTable } from './PriceTable.tsx'
import css from './ConsolePricingCard.module.css'

/** Props the renderer binds for the console entry. */
export type ConsolePricingEntryProps =
  PropsRuntime<'console.task-stats.action'>
  & PropsLocale<'settings.consolePricing'>
  & InjectFace<ConsolePricingCardFace>

/**
 * One reason the figure went unbilled, and every route it left behind. A bucket
 * carries `provider` and `model` only, which is what `totalCost` labels it with,
 * so the line names exactly what the row below must match.
 * @param props - the reason and the routes it holds.
 * @returns the group's title and one route per line.
 */
function RouteGroup({ title, routes }: { title: string; routes: readonly string[] }) {
  return (
    <div className={css.unbillableGroup}>
      <p className={css.unbillableTitle}>{title}</p>
      {routes.map(route => <p key={route} className={css.unbillableRoute}>{route}</p>)}
    </div>
  )
}

/**
 * Render the price-settings action and its dialog.
 * @param props - the scoped routes and table the card charged, locale copy, and the dialog's staged draft.
 * @returns the header action, and the price table over the workbench while it is open.
 */
export function ConsolePricingEntry(props: ConsolePricingEntryProps) {
  const { t } = props
  const [open, setOpen] = useState(false)
  const state = props.useConsolePricingCard(snapshot => snapshot)
  // The card shows the figure; the dialog leads with the routes that figure
  // could not bill whenever there are any, and with what the table edits
  // otherwise.
  const { unpriced, ambiguous } = totalCost(props.prices, props.routes)
  return (
    <>
      <button type="button" className={css.entry} onClick={() => { setOpen(true) }}>
        {t('entry')}
      </button>
      {open && (
        <Modal
          size="panel"
          open
          onClose={() => { setOpen(false) }}
          title={t('title')}
          closeLabel={t('close')}
          description={unpriced.length > 0 ? t('entryUnpriced', { count: String(unpriced.length) }) : t('summary')}
        >
          <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
            {unpriced.length > 0 || ambiguous.length > 0 ? (
              <div className={css.unbillable} role="status">
                {unpriced.length > 0 ? <RouteGroup title={t('entryUnpricedRoutes')} routes={unpriced} /> : null}
                {ambiguous.length > 0 ? <RouteGroup title={t('entryAmbiguousRoutes')} routes={ambiguous} /> : null}
              </div>
            ) : null}
            <PriceTable
              state={state}
              t={t}
              editCell={props.editCell}
              addRow={props.addRow}
              removeRow={props.removeRow}
            />
          </SettingsForm>
        </Modal>
      )}
    </>
  )
}
