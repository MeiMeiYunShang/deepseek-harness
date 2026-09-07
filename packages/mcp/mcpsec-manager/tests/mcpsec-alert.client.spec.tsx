// @vitest-environment jsdom
/**
 * The frame-wide MCP risk-alert toast (shell.overlay): shows the top alerts from
 * the shared store, dismisses per signal, and renders nothing when there are no
 * alerts or when the current signal was already acknowledged.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { StatsData } from '../src/client/types.ts'
import { McpSecAlert, type McpSecAlertProps } from '../src/client/McpSecAlert.tsx'
import { createMcpSecStore } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(en)

const ALERTS = [{
  server: 'gh', score: 60, reasons: ['cred', 'spike'],
}, {
  server: 'alpha', score: 55, reasons: ['auth'],
}]

/** Render the overlay against a store seeded with the given alerts. */
function renderOverlay(alerts = ALERTS, threshold = 50) {
  const instance = createMcpSecStore().create()
  const stats: StatsData = { threshold, windowMs: 600000, servers: [], alerts }
  instance.actions.setData([], stats)
  render(<McpSecAlert {...({
    useStore: bindSnapshotSelector(instance.store),
    t,
  } as unknown as McpSecAlertProps)} />)
  return { instance }
}

describe('the MCP risk-alert overlay', () => {
  it('renders the top alerts with their scores and localized reasons', () => {
    renderOverlay()
    expect(screen.getByText(en.alertTitle)).toBeDefined()
    expect(screen.getAllByText(/gh/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/alpha/).length).toBeGreaterThan(0)
    expect(screen.getByText(en.dismiss)).toBeDefined()
    expect(screen.getAllByText(en.r_cred)).toHaveLength(1)
    expect(screen.getAllByText(en.r_auth)).toHaveLength(1)
  })

  it('renders nothing when there are no alerts', () => {
    renderOverlay([])
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('dismisses the toast for the current signal and leaves it dismissed', () => {
    renderOverlay()
    fireEvent.click(screen.getByText(en.dismiss))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('renders again when a new alert signal arrives after dismissal', () => {
    const { instance } = renderOverlay()
    fireEvent.click(screen.getByText(en.dismiss))
    expect(screen.queryByRole('alert')).toBeNull()
    const next = [{ server: 'new', score: 70, reasons: ['payload'] }]
    act(() => { instance.actions.setData([], { threshold: 50, windowMs: 600000, servers: [], alerts: next }) })
    expect(screen.getByText(/new/)).toBeDefined()
  })

  it('shows only the first four alert entries', () => {
    renderOverlay([...ALERTS, ...ALERTS, ...ALERTS])
    // 6 alerts (gh, alpha, gh, alpha, gh, alpha); the first four render, so the
    // cred reason appears on the two gh entries actually shown.
    expect(screen.getAllByText(en.r_cred)).toHaveLength(2)
  })
})
