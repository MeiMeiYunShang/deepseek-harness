/**
 * Frame-wide MCP risk-alert toast (shell.overlay). Reads the shared store's
 * alert window; the toast is dismissable per signal so an unchanged risk set
 * stays quiet after the user acknowledges it.
 */

import { useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { createMcpSecStore } from './store.ts'
import { NS, type McpSecLocaleKey } from './locales.ts'
import css from './McpSec.module.css'

/** Full component props. */
export type McpSecAlertProps =
  PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createMcpSecStore>>
  & PropsLocale<typeof NS>
  & InjectFace<object>

/** The risk-toast signature: server + score pairs, unchanged across alerts. */
function signature(alerts: readonly { server: string; score: number }[]): string {
  return alerts.map(alert => `${alert.server}:${alert.score}`).join('|')
}

/** Frame-wide risk alert toast. */
export function McpSecAlert({ useStore, t }: McpSecAlertProps): ReactNode {
  const [dismissedSig, setDismissedSig] = useState<string>('')
  const alerts = useStore(snapshot => snapshot.stats.alerts)
  const sig = signature(alerts)
  if (alerts.length === 0 || sig === dismissedSig) return null
  return (
    <div className={css.toast} role="alert">
      <div className={css.toastTitle}>{t('alertTitle')}</div>
      {alerts.slice(0, 4).map((alert, index) => (
        <div className={css.toastItem} key={`${alert.server}:${index}`}>
          <span className={css.toastServer}>{alert.server} · {t('score')} {alert.score}</span>
          <div className={css.toastReasons}>
            {alert.reasons.map(reason => (
              <span key={reason} className={css.toastReason}>
                {t(('r_' + reason) as McpSecLocaleKey)}
              </span>
            ))}
          </div>
        </div>
      ))}
      <button type="button" className={css.toastDismiss} onClick={() => { setDismissedSig(sig) }}>
        {t('dismiss')}
      </button>
    </div>
  )
}
