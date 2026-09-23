// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { ModelPrice } from '@deepseek-ai/dsh-client-ui-primitives'
import { PriceTablePolicy } from '../src/client/price-table.ts'

const FLASH: ModelPrice = {
  baseUrl: 'https://api.deepseek.com',
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  peak: { cacheHit: 0.25, cacheMiss: 1, output: 2 },
  offPeak: { cacheHit: 0.125, cacheMiss: 0.5, output: 1 },
}

describe('PriceTablePolicy', () => {
  it('starts empty, because the namespace answers after bind', () => {
    const policy = new PriceTablePolicy(stubSettingsScope<{ models?: ModelPrice[] }>().scope)
    expect(policy.prices.getSnapshot()).toEqual([])
  })

  it('adopts the table a section accepted after construction carries', () => {
    const host = stubSettingsScope<{ models?: ModelPrice[] }>()
    const policy = new PriceTablePolicy(host.scope)
    expect(host.listenerCount()).toBe(1)

    host.publish({ status: 'ready', value: { models: [FLASH] }, revision: 1 })
    expect(policy.prices.getSnapshot()).toEqual([FLASH])

    const raised: ModelPrice[] = [{ ...FLASH, peak: { cacheHit: 1, cacheMiss: 2, output: 3 } }]
    host.publish({ value: { models: raised }, revision: 2 })
    expect(policy.prices.getSnapshot()).toEqual(raised)
  })

  it('adopts a section standing at construction', () => {
    const host = stubSettingsScope<{ models?: ModelPrice[] }>()
    host.publish({ status: 'ready', value: { models: [FLASH] }, revision: 1 })
    expect(new PriceTablePolicy(host.scope).prices.getSnapshot()).toEqual([FLASH])
  })

  it('keeps the same table reference when the section is republished unchanged', () => {
    const host = stubSettingsScope<{ models?: ModelPrice[] }>()
    const models = [FLASH]
    const policy = new PriceTablePolicy(host.scope)
    host.publish({ status: 'ready', value: { models }, revision: 1 })
    const adopted = policy.prices.getSnapshot()
    let notifications = 0
    policy.prices.subscribe(() => { notifications += 1 })
    host.publish({ revision: 2 })
    expect(policy.prices.getSnapshot()).toBe(adopted)
    expect(notifications).toBe(0)
  })

  it('clears the table when the accepted section records none', () => {
    const host = stubSettingsScope<{ models?: ModelPrice[] }>()
    const policy = new PriceTablePolicy(host.scope)
    host.publish({ status: 'ready', value: { models: [FLASH] }, revision: 1 })
    host.publish({ value: {}, revision: 2 })
    expect(policy.prices.getSnapshot()).toEqual([])
  })
})
