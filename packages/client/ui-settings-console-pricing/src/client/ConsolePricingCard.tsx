/**
 * The model price table as the Plugins page shows it: the shared {@link
 * PriceTable} body inside the settings form frame, with the one-liner standing
 * alone in the summary view.
 */

import { SettingsForm } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { formLabels } from './locales.ts'
import type { ConsolePricingCardFace } from './console-pricing-card-controller.ts'
import { PriceTable } from './PriceTable.tsx'

/** Props the renderer binds for the price table page. */
export type ConsolePricingCardProps =
  PropsRuntime<'plugins.item'>
  & PropsLocale<'settings.consolePricing'>
  & InjectFace<ConsolePricingCardFace>

/**
 * Render the model price table page.
 * @param props - the view the Plugins page asks for, locale copy, the page snapshot, and its table actions.
 * @returns the one-liner, or the settings form with the table.
 */
export function ConsolePricingCard(props: ConsolePricingCardProps) {
  const { t } = props
  const state = props.useConsolePricingCard(snapshot => snapshot)
  if (props.view === 'summary') return t('summary')
  return (
    <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
      <PriceTable
        state={state}
        t={t}
        editCell={props.editCell}
        addRow={props.addRow}
        removeRow={props.removeRow}
      />
    </SettingsForm>
  )
}
