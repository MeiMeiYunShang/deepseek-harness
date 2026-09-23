// @vitest-environment jsdom
/**
 * The console's own wiring of the operator price table: a `console-pricing`
 * section the settings mirror accepts AFTER `bind` must reach the
 * task-statistics cost figure, not only a section standing at mount time.
 */
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import {
  SlotTestRuntime, TestRemote, stubSettingsScope, usePinnedBrowserLanguages,
} from '@deepseek-ai/dsh-client-test-runtime'
import type { ModelPrice } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the sessionStats projection-key merge used by the fixture below.
import type {} from '@deepseek-ai/dsh-session-stats/types'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-console/client'
import { en } from '../src/client/locales.ts'

usePinnedBrowserLanguages('en')
afterEach(cleanup)

const SESSION = 's1' as SessionId

/** The operator's row for the only route the session statistics report. */
const FLASH: ModelPrice = {
  baseUrl: 'https://api.deepseek.com',
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  peak: { cacheHit: 0.25, cacheMiss: 1, output: 2 },
  offPeak: { cacheHit: 0.125, cacheMiss: 0.5, output: 1 },
}

/** One reported route: a million peak-band input tokens, one unit per million. */
const SESSION_STATS = {
  turns: 0, steps: 0, llmMs: 0, toolMs: 0,
  ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0, inputTokens: 1_000_000, turnRoutes: [],
  routes: [{
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    peak: { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    offPeak: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  }],
}

/** Mount the plugin over a real runtime with an answerable `console-pricing` scope. */
async function bench() {
  const runtime = await SlotTestRuntime.create()
  const pricing = stubSettingsScope<{ models?: ModelPrice[] }>()
  runtime.ctx.provide('settingsScope', {
    bind: ({ namespace }: { namespace: string }) => namespace === 'console-pricing'
      ? pricing.scope
      : stubSettingsScope().scope,
  } as never)
  new TestRemote(runtime.ctx, { llm: { chat: vi.fn(async function* () { /* no chunks */ }), listProviders: vi.fn() } })
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('en')
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.sessions.add({
    id: SESSION,
    summary: { projectionValues: { sessionStats: SESSION_STATS } },
    session: {},
  })
  await runtime.declare({ 'sidebar.footer.action': { kind: 'list', scope: 'root' } })
  await runtime.mount({ inject: [...inject], apply })
  runtime.renderSlot('sidebar.footer.action', { wide: true })
  return { runtime, pricing }
}

/** Open the console modal from the sidebar footer trigger. */
function openConsole(): void {
  fireEvent.click(screen.getByRole('button', { name: en.trigger }))
}

describe('console price table wiring', () => {
  it('charges the cost figure from the first section the namespace serves after bind', async () => {
    const { runtime, pricing } = await bench()

    // The face the sidebar trigger receives serves the table as a live source,
    // not as the value a read at bind time would have found.
    const face = (runtime.slots.entries('sidebar.footer.action')[0]!.inject as unknown as () => {
      hooks: { prices: { getSnapshot: () => readonly ModelPrice[] } }
    })()
    expect(face.hooks.prices.getSnapshot()).toEqual([])

    openConsole()
    // Nothing is priced yet: the route is named, not charged at zero.
    expect(screen.getByText(en.taskCostUnpriced)).toBeTruthy()

    act(() => { pricing.publish({ status: 'ready', value: { models: [FLASH] }, revision: 1 }) })

    expect(face.hooks.prices.getSnapshot()).toEqual([FLASH])
    expect(screen.getByText('1.00')).toBeTruthy()
    expect(screen.queryByText(en.taskCostUnpriced)).toBeNull()

    await runtime.dispose()
  })

  it('stops charging when an accepted section records no table', async () => {
    const { runtime, pricing } = await bench()
    act(() => { pricing.publish({ status: 'ready', value: { models: [FLASH] }, revision: 1 }) })
    openConsole()
    expect(screen.getByText('1.00')).toBeTruthy()

    act(() => { pricing.publish({ value: {}, revision: 2 }) })
    expect(screen.getByText(en.taskCostUnpriced)).toBeTruthy()

    await runtime.dispose()
  })
})
