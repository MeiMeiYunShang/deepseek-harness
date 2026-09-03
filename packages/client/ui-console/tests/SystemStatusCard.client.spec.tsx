// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SystemStatusCard, RingGauge } from '../src/client/SystemStatusCard.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: string): string => (en as Record<string, string>)[key] ?? key

describe('SystemStatusCard', () => {
  it('renders each gauge with a live percentage', () => {
    render(<SystemStatusCard t={t} status={{ cpu: 42, memory: 61, gpu: 12 }} collapsed={false} onToggleCollapse={() => {}} />)
    expect(screen.getByText('42%')).toBeTruthy()
    expect(screen.getByText('61%')).toBeTruthy()
    expect(screen.getByText('12%')).toBeTruthy()
    expect(screen.getByText(en.cpu)).toBeTruthy()
    expect(screen.getByText(en.ram)).toBeTruthy()
    expect(screen.getByText(en.gpu)).toBeTruthy()
  })

  it('renders N/A when no sample or a null gpu adapter', () => {
    render(<SystemStatusCard t={t} status={null} collapsed={false} onToggleCollapse={() => {}} />)
    expect(screen.getAllByText(en.na, { exact: true }).length).toBe(3)

    cleanup()
    render(<SystemStatusCard t={t} status={{ cpu: 10, memory: 20, gpu: null }} collapsed={false} onToggleCollapse={() => {}} />)
    expect(screen.getAllByText(en.na, { exact: true }).length).toBeGreaterThanOrEqual(1)
  })

  it('exposes an accessible ring via RingGauge', () => {
    render(<RingGauge label="CPU" value={null} naLabel="n/a" />)
    expect(screen.getByRole('img', { name: 'CPU n/a' })).toBeTruthy()
  })

  it('clamps a gauge value into the 0-100 ring', () => {
    render(<RingGauge label="CPU" value={120} naLabel="n/a" />)
    expect(screen.getByText('120%')).toBeTruthy()
  })

  it('hides the gauges when collapsed', () => {
    render(<SystemStatusCard t={t} status={{ cpu: 50, memory: 50, gpu: 50 }} collapsed onToggleCollapse={() => {}} />)
    expect(screen.getByText(en.systemStatus)).toBeTruthy()
    expect(screen.queryByText('50%')).toBeNull()
  })
})
