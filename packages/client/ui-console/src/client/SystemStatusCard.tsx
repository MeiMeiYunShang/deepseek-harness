/** System-status card: three SVG ring gauges (CPU / memory / GPU). */

import type { ConsoleKey } from './locales.ts'
import { GAUGE_COLOR, toneOf } from './format.ts'
import css from './console.module.css'

/** One ring gauge value: a 0-100 percent, or null for a missing adapter. */
export interface RingValue {
  /** Percent value, or null when the adapter reports none. */
  value: number | null
}

/** One SVG ring gauge with the percentage centered inside. */
export function RingGauge({ label, value, naLabel }: {
  label: string
  value: number | null
  naLabel: string
}) {
  const size = 56
  const stroke = 6
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const ratio = value === null ? 0 : Math.max(0, Math.min(100, value)) / 100
  const dash = `${ratio * circumference} ${circumference}`
  const color = GAUGE_COLOR[toneOf(value)]
  return (
    <div className={css.ringItem}>
      <div className={css.ring}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`${label} ${value === null ? naLabel : `${value}%`}`}
        >
          <circle className={css.ringTrack} cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none" />
          <circle
            className={css.ringValue}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={dash}
            stroke={color}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <span className={css.ringText}>{value === null ? naLabel : `${value}%`}</span>
      </div>
      <span className={css.ringLabel}>{label}</span>
    </div>
  )
}

/** Props for the system-status card. */
export interface SystemStatusCardProps {
  /** Translator. */
  t: (key: ConsoleKey) => string
  /** Latest host sample, or null before any frame arrives. */
  status: { cpu: number; memory: number; gpu: number | null } | null
}

/** System-status card: title plus three ring gauges. */
export function SystemStatusCard({ t, status }: SystemStatusCardProps) {
  return (
    <div className={css.card}>
      <h3 className={css.cardTitle}>{t('systemStatus')}</h3>
      <div className={css.systemStatus}>
        <RingGauge label={t('cpu')} naLabel={t('na')} value={status === null ? null : Math.round(status.cpu)} />
        <RingGauge label={t('ram')} naLabel={t('na')} value={status === null ? null : Math.round(status.memory)} />
        <RingGauge label={t('gpu')} naLabel={t('na')} value={status?.gpu == null ? null : Math.round(status.gpu)} />
      </div>
    </div>
  )
}
