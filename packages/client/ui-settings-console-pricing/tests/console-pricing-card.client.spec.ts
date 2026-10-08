/** Staged price table behavior over the `console-bridge` configuration form. */

import { describe, expect, it } from 'vitest'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import type { StubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { ConsolePricingCardController } from '../src/client/console-pricing-card-controller.ts'
import type {
  ConsolePricingCardFace, ConsolePricingCardState, ConsolePricingRow, ConsolePricingSettings,
} from '../src/client/console-pricing-card-controller.ts'

const FLASH: ConsolePricingRow = {
  baseUrl: 'https://api.deepseek.com',
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
  offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
}

const PRO: ConsolePricingRow = {
  baseUrl: 'https://api.deepseek.com',
  provider: 'deepseek-official',
  model: 'deepseek-v4-pro',
  peak: { cacheHit: 0.3, cacheMiss: 9, output: 27 },
  offPeak: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
}

/** A ready, writable form serving one table at revision 3. */
function bench(rows: readonly ConsolePricingRow[] = [FLASH]): StubConfigForm<ConsolePricingSettings> {
  const stub = stubConfigForm<ConsolePricingSettings>()
  stub.publish({
    status: 'ready',
    value: { models: rows },
    base: {},
    user: { models: rows },
    revision: 3,
    writable: true,
  })
  return stub
}

/** Make accepted writes publish `next` as the Host's answer, one revision on. */
function acceptWith(stub: StubConfigForm<ConsolePricingSettings>, next: readonly ConsolePricingRow[]): void {
  stub.mutate.mockImplementation(() => {
    stub.publish({ value: { models: next }, user: { models: next }, revision: (stub.scope.getSnapshot().revision ?? 0) + 1 })
    return Promise.resolve(true)
  })
}

/** Mount one controller over a stub form. */
function mount(stub: StubConfigForm<ConsolePricingSettings>): {
  card: ConsolePricingCardController
  face: ConsolePricingCardFace
  state: () => ConsolePricingCardState
} {
  const card = new ConsolePricingCardController(stub.scope)
  const face = card.inject()
  return { card, face, state: () => face.hooks.consolePricingCard.getSnapshot() }
}

/** Let a save's wire round trip and its settlement settle. */
async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('ConsolePricingCardController', () => {
  it('stages the stored table as typed text', () => {
    const { state } = mount(bench())

    const snapshot = state()
    expect(snapshot.rows).toEqual([{
      baseUrl: 'https://api.deepseek.com',
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      peakCacheHit: '0.04',
      peakCacheMiss: '2',
      peakOutput: '8',
      offPeakCacheHit: '0.02',
      offPeakCacheMiss: '1',
      offPeakOutput: '4',
    }])
    expect(snapshot.dirty).toBe(false)
    expect(snapshot.problem).toBeUndefined()
  })

  it('writes the staged table as one models operation fenced by the revision the draft read', async () => {
    const stub = bench()
    acceptWith(stub, [{ ...FLASH, peak: { ...FLASH.peak, output: 9 } }])
    const { face, state } = mount(stub)

    face.editCell(0, 'peakOutput', '9')
    expect(state().dirty).toBe(true)
    face.save()
    await flush()

    expect(stub.mutate).toHaveBeenCalledWith([{
      op: 'set',
      path: ['models'],
      value: [{ ...FLASH, peak: { ...FLASH.peak, output: 9 } }],
    }], 3)
    expect(state().dirty).toBe(false)
    expect(state().failed).toBe(false)
  })

  it('appends the first row to an empty table and removes a row without writing', () => {
    const stub = bench([])
    const { face, state } = mount(stub)

    expect(state().rows).toEqual([])
    face.addRow()
    expect(state().rows).toHaveLength(1)
    expect(state().rows[0]?.baseUrl).toBe('')

    face.editCell(0, 'baseUrl', 'https://api.deepseek.com')
    face.removeRow(0)
    expect(state().rows).toEqual([])
    expect(stub.mutate).not.toHaveBeenCalled()
  })

  it('refuses every table a check rejects and names the earliest row', () => {
    const stub = bench([FLASH, PRO])
    const { face, state } = mount(stub)

    face.addRow()
    expect(state().problem).toEqual({ kind: 'baseUrl', row: 2 })
    expect(state().invalid).toBe(true)

    face.editCell(2, 'baseUrl', 'https://api.deepseek.com')
    face.editCell(2, 'provider', 'deepseek-official')
    expect(state().problem).toEqual({ kind: 'model', row: 2 })

    // The rates are checked before the route key, so a row that repeats the
    // triple is only reported as a duplicate once its six rates resolve.
    face.editCell(2, 'model', 'deepseek-v4-flash')
    expect(state().problem).toEqual({ kind: 'price', row: 2 })
    for (const cell of ['peakCacheHit', 'peakCacheMiss', 'peakOutput', 'offPeakCacheHit', 'offPeakCacheMiss', 'offPeakOutput'] as const) {
      face.editCell(2, cell, '1')
    }
    expect(state().problem).toEqual({ kind: 'duplicate', row: 2 })

    face.editCell(2, 'model', 'deepseek-v4-lite')
    expect(state().problem).toBeUndefined()
    face.editCell(2, 'peakCacheHit', 'free')
    expect(state().problem).toEqual({ kind: 'price', row: 2 })
    face.editCell(2, 'peakCacheHit', '-1')
    expect(state().problem).toEqual({ kind: 'price', row: 2 })

    face.save()
    expect(stub.mutate).not.toHaveBeenCalled()
    expect(state().rows).toHaveLength(3)
  })

  it('names the provider of the first row that carries none', () => {
    const { face, state } = mount(bench([FLASH]))

    face.editCell(0, 'provider', '   ')

    expect(state().problem).toEqual({ kind: 'provider', row: 0 })
  })

  it('keeps the draft when the Host refuses the write', async () => {
    const stub = bench()
    stub.mutate.mockImplementation(() => Promise.resolve(false))
    const { face, state } = mount(stub)

    face.editCell(0, 'peakOutput', '9')
    face.save()
    await flush()

    expect(state().failed).toBe(true)
    expect(state().dirty).toBe(true)
    expect(state().rows[0]?.peakOutput).toBe('9')
  })

  it('clears the draft when its own write lands as staged', async () => {
    const stub = bench()
    acceptWith(stub, [{ ...FLASH, peak: { ...FLASH.peak, output: 9 } }])
    const { face, state } = mount(stub)

    face.editCell(0, 'peakOutput', '9')
    face.save()
    await flush()

    expect(state().conflicted).toBe(false)
    expect(state().rows[0]?.peakOutput).toBe('9')
  })

  it('keeps the draft and reports the conflict when another writer moves the revision', () => {
    const stub = bench()
    const { face, state } = mount(stub)

    face.editCell(0, 'peakOutput', '9')
    stub.publish({ value: { models: [PRO] }, user: { models: [PRO] }, revision: 4 })

    expect(state().conflicted).toBe(true)
    expect(state().rows[0]?.peakOutput).toBe('9')
    face.save()
    expect(stub.mutate).not.toHaveBeenCalled()
  })

  it('clears its own draft when the revision moves to the table it staged', () => {
    const stub = bench()
    const { face, state } = mount(stub)

    face.editCell(0, 'peakOutput', '9')
    stub.publish({
      value: { models: [{ ...FLASH, peak: { ...FLASH.peak, output: 9 } }] },
      user: { models: [{ ...FLASH, peak: { ...FLASH.peak, output: 9 } }] },
      revision: 4,
    })

    expect(state().conflicted).toBe(false)
    expect(state().dirty).toBe(false)
    expect(state().rows[0]?.peakOutput).toBe('9')
  })

  it('drops the staged table on discard', () => {
    const stub = bench()
    const { face, state } = mount(stub)

    face.editCell(0, 'peakOutput', '9')
    stub.publish({ value: { models: [PRO] }, user: { models: [PRO] }, revision: 4 })
    face.discard()

    expect(state().dirty).toBe(false)
    expect(state().conflicted).toBe(false)
    expect(state().rows[0]?.model).toBe('deepseek-v4-pro')
  })

  it('ignores edits and saves on a document the deployment stores read-only', () => {
    const stub = bench()
    stub.publish({ writable: false })
    const { face, state } = mount(stub)

    face.editCell(0, 'peakOutput', '9')
    face.addRow()
    face.removeRow(0)
    face.save()

    expect(state().rows).toHaveLength(1)
    expect(state().rows[0]?.peakOutput).toBe('8')
    expect(state().dirty).toBe(false)
    expect(stub.mutate).not.toHaveBeenCalled()
  })

  it('stops publishing and stops observing the form after dispose', () => {
    const stub = bench()
    const { card, state } = mount(stub)
    const before = state()

    card.dispose()
    stub.publish({ revision: 4, value: { models: [PRO] } })

    expect(stub.listenerCount()).toBe(0)
    expect(state()).toBe(before)
  })

  it('suppresses the settlement of a write that was still crossing the wire at dispose', async () => {
    const stub = bench()
    let settle = (_accepted: boolean): void => {}
    stub.mutate.mockImplementation(() => new Promise<boolean>((resolve) => { settle = resolve }))
    const { card, face, state } = mount(stub)

    face.editCell(0, 'peakOutput', '9')
    face.save()
    expect(state().saving).toBe(true)
    face.editCell(0, 'peakCacheHit', '1')

    card.dispose()
    settle(true)
    await flush()

    expect(state().rows[0]?.peakCacheHit).toBe('0.04')
  })
})
