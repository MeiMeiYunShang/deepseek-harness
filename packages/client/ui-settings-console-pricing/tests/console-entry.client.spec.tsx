// @vitest-environment jsdom
/**
 * The console entry as the shipped runtime assembles it: the task-statistics
 * card gains its price-settings action only while this plugin is mounted, the
 * dialog it opens stays in front of the workbench under Escape, and disposing
 * the plugin's fiber takes the action out of an already-open console.
 */
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { CONSOLE_PRICING_NAMESPACE } from '@deepseek-ai/dsh-client-ui-primitives'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the sessionStats projection-key merge used by the fixture below.
import type {} from '@deepseek-ai/dsh-session-stats/types'
import { apply as consoleApply, inject as consoleInject } from '@deepseek-ai/dsh-client-ui-console/client'
import { en as consoleEn } from '@deepseek-ai/dsh-client-ui-console/src/client/locales.ts'
import { apply, inject } from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const SESSION = 's1' as SessionId

/** One session whose only route has no price row in the served table. */
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

/**
 * One Host view of a served namespace: an object section with no fields, which
 * every form here reads as a ready namespace holding an empty price table.
 */
function view(ns: string, revision = 0) {
  return { ns, schema: { type: 'object', dict: {} }, value: {}, applies: 'live', secrets: [], revision }
}

/**
 * Mount the console and this plugin over one runtime whose Host serves the
 * price namespace, then open the console.
 * @returns the runtime and this plugin's mounted feature handle.
 */
async function bench() {
  const runtime = await SlotTestRuntime.create()
  runtime.remote.provideNamespaces({
    settings: {
      describe: vi.fn(() => Promise.resolve({
        ok: true,
        value: { writable: true, hasDocument: true, namespaces: [view(CONSOLE_PRICING_NAMESPACE)] },
      })),
    },
  })
  await runtime.mount({ inject: [...settingsInject], apply: settingsApply })
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('en')
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  // The console's open verb navigates; only that face needs a stub here.
  runtime.ctx.provide('uiWorkspace', { openSession: vi.fn(), startSession: vi.fn() } as never)
  await runtime.sessions.add({
    id: SESSION,
    summary: { projectionValues: { sessionStats: SESSION_STATS } },
    session: {},
  })
  await runtime.declare({ 'sidebar.footer.action': { kind: 'list', scope: 'root' } })
  await runtime.mount({ inject: [...consoleInject], apply: consoleApply })
  runtime.renderSlot('sidebar.footer.action', { wide: true })
  const pricing = await runtime.mount({ inject: [...inject], apply })
  fireEvent.click(screen.getByRole('button', { name: consoleEn.trigger }))
  return { runtime, pricing }
}

describe('console task-statistics entry', () => {
  it('contributes the price-settings action into the open console card', async () => {
    const { runtime, pricing } = await bench()

    // The action lands in the same header row that titles the task-statistics
    // card, beside its fold control.
    const entry = screen.getByRole('button', { name: en.entry })
    const titleGroup = screen.getByRole('heading', { name: consoleEn.taskStats }).parentElement!
    expect(titleGroup.parentElement!.contains(entry)).toBe(true)

    fireEvent.click(entry)
    // The table appears once the settings mirror has read the namespace the Host
    // describes, so this waits for that read rather than asserting on its loading
    // frame.
    expect(await screen.findByText(en.empty)).toBeTruthy()
    const dialog = screen.getByRole('dialog', { name: en.title })
    expect(dialog.textContent).toContain(en.entryUnpriced.replace('{count}', '1'))
    // The route the card's own scope reported is named by the provider and model
    // the seat hands down, so the operator sees which row this table still lacks.
    expect(dialog.textContent).toContain(en.entryUnpricedRoutes)
    expect(within(dialog).getByText('deepseek-official/deepseek-v4-flash')).toBeTruthy()
    // The contribution sits in the seat the console declares.
    expect(runtime.slots.entries('console.task-stats.action')).toHaveLength(1)

    await pricing.dispose()
    await runtime.dispose()
  })

  it('keeps the console open when Escape closes the dialog the entry owns', async () => {
    const { runtime, pricing } = await bench()

    fireEvent.click(screen.getByRole('button', { name: en.entry }))
    expect(screen.getByRole('dialog', { name: en.title })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: en.title })).toBeNull()
    expect(screen.getByRole('dialog', { name: consoleEn.title })).toBeTruthy()

    await pricing.dispose()
    await runtime.dispose()
  })

  it('takes the action out of the open console when the plugin is stopped', async () => {
    const { runtime, pricing } = await bench()

    expect(screen.getByRole('button', { name: en.entry })).toBeTruthy()
    await pricing.dispose()

    // The card stays exactly as the console renders it without a contribution.
    expect(screen.queryByRole('button', { name: en.entry })).toBeNull()
    expect(screen.getByRole('heading', { name: consoleEn.taskStats })).toBeTruthy()
    expect(runtime.slots.entries('console.task-stats.action')).toHaveLength(0)

    await runtime.dispose()
  })
})
