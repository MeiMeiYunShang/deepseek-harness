/**
 * The console-bridge card: the console-connection fields the operator edits, the
 * bridge enable switch, and a connection probe. `token` is a section secret, so
 * the wire never returns it; the control is write-only and renders blank, and
 * saving stores whatever was typed.
 */

import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type {
  ConsoleBridgeCardFace, ConsoleBridgeTestResult,
} from './console-bridge-card-controller.ts'
import type {} from './slot-contract.ts'
import css from './ConsoleBridgeCard.module.css'

/** Props the renderer binds for the console-bridge card. */
export type ConsoleBridgeCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<ConsoleBridgeCardFace>

/**
 * Render the console-bridge card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function ConsoleBridgeCard(props: ConsoleBridgeCardProps) {
  const { t } = props
  const state = props.useConsoleBridgeCard(snapshot => snapshot)
  const disabled = !state.writable
  const [enabled, setEnabled] = useState(() => props.getEnabled())
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<ConsoleBridgeTestResult | undefined>(undefined)

  const onToggle = async (next: boolean): Promise<void> => {
    setEnabled(next)
    await props.setEnabled(next)
  }

  const onTest = async (): Promise<void> => {
    setTesting(true)
    setResult(undefined)
    try {
      setResult(await props.testConnection())
    } finally {
      setTesting(false)
    }
  }

  return (
    <PluginCard
      t={t}
      titleKey="consoleBridgeTitle"
      descriptionKey="consoleBridgeDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <div className={css.enabled}>
        <label htmlFor="plugin-config-console-bridge-enabled">
          <input
            id="plugin-config-console-bridge-enabled"
            type="checkbox"
            checked={enabled}
            disabled={disabled}
            onChange={(event) => { void onToggle(event.target.checked) }}
          />
          <span>{t('consoleBridgeEnabled')}</span>
        </label>
        <span className={css.enabledHint}>{t('consoleBridgeEnabledHint')}</span>
      </div>
      <ValueField
        id="plugin-config-console-bridge-agent"
        label={t('consoleBridgeAgentId')}
        hint={t('consoleBridgeAgentIdHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.agentId}
        onEdit={(text) => { props.edit('agentId', text) }}
        onReset={() => { props.resetField('agentId') }}
      />
      <ValueField
        id="plugin-config-console-bridge-broker"
        label={t('consoleBridgeBrokerUrl')}
        hint={t('consoleBridgeBrokerUrlHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.brokerUrl}
        onEdit={(text) => { props.edit('brokerUrl', text) }}
        onReset={() => { props.resetField('brokerUrl') }}
      />
      <ValueField
        id="plugin-config-console-bridge-mqtt-username"
        label={t('consoleBridgeMqttUsername')}
        hint={t('consoleBridgeMqttUsernameHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.mqttUsername}
        onEdit={(text) => { props.edit('mqttUsername', text) }}
        onReset={() => { props.resetField('mqttUsername') }}
      />
      <ValueField
        id="plugin-config-console-bridge-mqtt-password"
        label={t('consoleBridgeMqttPassword')}
        hint={t('consoleBridgeMqttPasswordHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        password
        disabled={disabled}
        {...state.mqttPassword}
        onEdit={(text) => { props.edit('mqttPassword', text) }}
        onReset={() => { props.resetField('mqttPassword') }}
      />
      <ValueField
        id="plugin-config-console-bridge-base"
        label={t('consoleBridgeBaseUrl')}
        hint={t('consoleBridgeBaseUrlHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.consoleBaseUrl}
        onEdit={(text) => { props.edit('consoleBaseUrl', text) }}
        onReset={() => { props.resetField('consoleBaseUrl') }}
      />
      <ValueField
        id="plugin-config-console-bridge-token"
        label={t('consoleBridgeToken')}
        hint={t('consoleBridgeTokenHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        password
        disabled={disabled}
        {...state.token}
        onEdit={(text) => { props.edit('token', text) }}
        onReset={() => { props.resetField('token') }}
      />
      <div className={css.test}>
        <button
          type="button"
          className={css.testButton}
          disabled={disabled || testing}
          onClick={() => { void onTest() }}
        >
          {testing ? t('consoleBridgeTesting') : t('consoleBridgeTest')}
        </button>
        {result !== undefined
          ? (
            <span
              className={result.ok ? css.testOk : css.testFail}
              role="status"
            >
              {result.ok ? t('consoleBridgeTestOk') : t('consoleBridgeTestFail')}: {result.message}
            </span>
          )
          : null}
      </div>
    </PluginCard>
  )
}
