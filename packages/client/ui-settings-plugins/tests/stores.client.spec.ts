/**
 * The staged card form: what a draft shows before it is written, which wire
 * call a save reaches, and what happens to drafts the Host did not accept.
 */

import { describe, expect, it, vi } from 'vitest'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { RemoteError, stubSettingsScope, type StubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { CardForm, numberField, textField } from '../src/client/card-form.ts'
import { AgentLoopCardController, type AgentLoopSettings } from '../src/client/agent-loop-card-controller.ts'
import { BashCardController, type BashSettings } from '../src/client/bash-card-controller.ts'
import {
  SettingsDescribeMirror, type SettingsMirrorSnapshot,
} from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { ConfigurablePluginsTabController } from '../src/client/tab-store.ts'
import {
  SubagentModelSelectionCardController,
  subagentModelCandidates,
  type SubagentModelSelectionSettings,
} from '../src/client/subagent-model-selection-card-controller.ts'
import { WebSearchCardController, type WebSearchSettings } from '../src/client/web-search-card-controller.ts'
import {
  ConsoleBridgeCardController,
  type ConsoleBridgeSettings,
  type ConsoleBridgeTestRequest,
  type ConsoleBridgeTestResult,
} from '../src/client/console-bridge-card-controller.ts'
import {
  ConsolePricingCardController, type ConsolePricingCardFace, type ConsolePricingRow, type ConsolePricingSettings,
} from '../src/client/console-pricing-card-controller.ts'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'

/** Make the stub behave like a Host that accepts every write. */
function acceptWrites<T>(host: StubSettingsScope<T>): void {
  const section = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().value as object })
  const layer = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().user as object })
  host.set.mockImplementation((field: string, value: unknown) => {
    host.publish({ value: { ...section(), [field]: value } as T, user: { ...layer(), [field]: value } })
  })
  host.mutate.mockImplementation((ops: readonly SettingsPathOpView[]) => {
    const value = { ...section() }
    const user = { ...layer() }
    for (const op of ops) {
      const field = op.path[0]!
      if (op.op === 'set') {
        value[field] = op.value
        user[field] = op.value
      }
    }
    host.publish({ value: value as T, user })
  })
  host.unset.mockImplementation((field: string) => {
    const user = Object.fromEntries(Object.entries(layer()).filter(([key]) => key !== field))
    const base = host.scope.getSnapshot().base as Record<string, unknown> | undefined
    host.publish({ value: { ...section(), [field]: base?.[field] } as T, user })
  })
}

/** The card plugin's context, scripted down to the namespaces a card reaches. */
function ctxWith(namespaces: object) {
  return { remote: namespaces } as never
}

function credentialsApi(configured: boolean) {
  const describe = vi.fn(() => Promise.resolve({
    ok: true as const,
    value: { DEEPSEEK_API_KEY: { configured, writable: true } },
  }))
  const set = vi.fn(() => Promise.resolve({ ok: true as const, value: undefined }))
  return { ctx: ctxWith({ credentials: { describe, set } }), describe, set }
}

function modelsApi(options: {
  groups?: readonly {
    id: string
    name: string
    models: readonly { id: string; name: string }[]
  }[]
  failures?: readonly { id: string; name: string; message: string }[]
  error?: string
} = {}) {
  const models = vi.fn(() => Promise.resolve({
    ...(options.error === undefined
      ? { ok: true as const, value: { groups: options.groups ?? [], failures: options.failures ?? [] } }
      : { ok: false as const, error: new RemoteError('gateway/internal', options.error, {}) }),
  }))
  return { ctx: ctxWith({ session: { modelCatalog: models } }), models }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('CardForm', () => {
  function form() {
    const host = stubSettingsScope<Record<string, unknown>>()
    const subject = new CardForm(host.scope, [numberField('timeoutMs'), textField('baseURL')])
    host.publish({
      status: 'ready',
      writable: true,
      value: { timeoutMs: 60_000, baseURL: 'https://search.test/v1' },
      base: { timeoutMs: 60_000, baseURL: 'https://search.test/v1' },
      user: {},
    })
    return { host, subject }
  }

  it('shows the effective value and stays clean until something is staged', () => {
    const { subject } = form()

    expect(subject.field('timeoutMs')).toEqual({ text: '60000', overridden: false, invalid: false })
    expect(subject.shell()).toMatchObject({ available: true, writable: true, dirty: false, invalid: false })
  })

  it('marks a field the user layer carries as overridden', () => {
    const { host, subject } = form()

    host.publish({ value: { timeoutMs: 60_000 }, user: { timeoutMs: 60_000 } })

    // An override equal to the composition default is still an override.
    expect(subject.field('timeoutMs').overridden).toBe(true)
  })

  it('writes nothing until the form is saved', async () => {
    const { host, subject } = form()
    acceptWrites(host)

    subject.actions().edit('timeoutMs', '9000')

    expect(subject.field('timeoutMs')).toEqual({ text: '9000', overridden: true, invalid: false })
    expect(subject.shell().dirty).toBe(true)
    expect(host.set).not.toHaveBeenCalled()

    await subject.save()

    expect(host.set.mock.calls).toEqual([['timeoutMs', 9_000]])
    expect(subject.shell()).toMatchObject({ dirty: false, failed: false, saving: false })
  })

  it('drops a draft that settles back on the value already shown', async () => {
    const { host, subject } = form()

    subject.actions().edit('timeoutMs', '9000')
    subject.actions().edit('timeoutMs', '60000')

    expect(subject.shell().dirty).toBe(false)
    await subject.save()

    expect(host.set).not.toHaveBeenCalled()
  })

  it('refuses to save while a draft is not a value the field accepts', async () => {
    const { host, subject } = form()

    subject.actions().edit('timeoutMs', 'soon')

    expect(subject.field('timeoutMs')).toEqual({ text: 'soon', overridden: false, invalid: true })
    expect(subject.shell()).toMatchObject({ dirty: true, invalid: true })

    await subject.save()

    expect(host.set).not.toHaveBeenCalled()
    expect(subject.field('timeoutMs').text).toBe('soon')
  })

  it('stages a reset that clears the field only once saved', async () => {
    const { host, subject } = form()
    acceptWrites(host)
    host.publish({ value: { timeoutMs: 9_000 }, user: { timeoutMs: 9_000 } })

    subject.actions().resetField('timeoutMs')

    // The badge previews the save: the field will no longer be overridden.
    expect(subject.field('timeoutMs')).toEqual({ text: '60000', overridden: false, invalid: false })
    expect(host.unset).not.toHaveBeenCalled()

    await subject.save()

    expect(host.unset.mock.calls).toEqual([['timeoutMs']])
    expect(subject.shell()).toMatchObject({ dirty: false, failed: false })
  })

  it('treats resetting an inherited field as no change at all', async () => {
    const { host, subject } = form()

    subject.actions().resetField('timeoutMs')

    expect(subject.shell().dirty).toBe(false)
    await subject.save()

    expect(host.unset).not.toHaveBeenCalled()
  })

  it('clears a number field by emptying it', async () => {
    const { host, subject } = form()
    acceptWrites(host)
    host.publish({ user: { timeoutMs: 9_000 } })

    subject.actions().edit('timeoutMs', '')

    expect(subject.field('timeoutMs')).toEqual({ text: '', overridden: false, invalid: false })
    await subject.save()

    expect(host.unset.mock.calls).toEqual([['timeoutMs']])
  })

  it('clears a text field by emptying it', async () => {
    const { host, subject } = form()
    acceptWrites(host)
    host.publish({ user: { baseURL: 'https://search.test/v1' } })

    subject.actions().edit('baseURL', '   ')
    await subject.save()

    expect(host.unset.mock.calls).toEqual([['baseURL']])
  })

  it('writes the trimmed text of a text field', async () => {
    const { host, subject } = form()
    acceptWrites(host)

    subject.actions().edit('baseURL', '  https://other.test  ')
    await subject.save()

    expect(host.set.mock.calls).toEqual([['baseURL', 'https://other.test']])
  })

  it('keeps the drafts a save did not land, and reports the failure', async () => {
    const { host, subject } = form()

    subject.actions().edit('timeoutMs', '9000')
    await subject.save()

    // The stub Host accepted the call without storing it, exactly as a
    // validator that refuses the value does.
    expect(host.set).toHaveBeenCalledWith('timeoutMs', 9_000)
    expect(subject.shell()).toMatchObject({ dirty: true, failed: true, saving: false })
    expect(subject.field('timeoutMs').text).toBe('9000')
  })

  it('reports a reset the Host did not apply as a failure', async () => {
    const { host, subject } = form()
    host.publish({ user: { timeoutMs: 9_000 } })

    subject.actions().resetField('timeoutMs')
    await subject.save()

    expect(host.unset).toHaveBeenCalledWith('timeoutMs')
    expect(subject.shell().failed).toBe(true)
  })

  it('clears the failure as soon as the user edits again', async () => {
    const { subject } = form()

    subject.actions().edit('timeoutMs', '9000')
    await subject.save()
    expect(subject.shell().failed).toBe(true)

    subject.actions().edit('timeoutMs', '9001')

    expect(subject.shell().failed).toBe(false)
  })

  it('discards every staged edit', async () => {
    const { host, subject } = form()

    subject.actions().edit('timeoutMs', '9000')
    subject.actions().discard()

    expect(subject.field('timeoutMs').text).toBe('60000')
    expect(subject.shell()).toMatchObject({ dirty: false, failed: false })

    // A discard with nothing staged publishes nothing.
    const before = subject.shell()
    subject.actions().discard()
    expect(subject.shell()).toEqual(before)

    await subject.save()
    expect(host.set).not.toHaveBeenCalled()
  })

  it('refuses a second save while one is in flight', async () => {
    const { host, subject } = form()
    acceptWrites(host)

    subject.actions().edit('timeoutMs', '9000')
    const first = subject.save()
    expect(subject.shell().saving).toBe(true)
    const second = subject.save()
    await Promise.all([first, second])

    expect(host.set).toHaveBeenCalledTimes(1)
  })

  it('publishes a projection whenever the scope or a draft changes', () => {
    const { host, subject } = form()
    const store = subject.bind(() => subject.field('timeoutMs').text)
    expect(store.getSnapshot()).toBe('60000')

    host.publish({ value: { timeoutMs: 1_000 } })
    expect(store.getSnapshot()).toBe('1000')

    subject.actions().edit('timeoutMs', '2000')
    expect(store.getSnapshot()).toBe('2000')
  })

  it('refuses to address a field the card never declared', () => {
    const { subject } = form()

    expect(() => subject.field('nope')).toThrow('plugin card has no field nope')
  })

  it('renders an absent section value as an empty draft', () => {
    const host = stubSettingsScope<Record<string, unknown>>()
    const subject = new CardForm(host.scope, [numberField('timeoutMs'), textField('baseURL')])

    host.publish({ status: 'ready', writable: true, value: {}, base: {}, user: undefined })

    expect(subject.field('timeoutMs').text).toBe('')
    expect(subject.field('baseURL').text).toBe('')
    expect(subject.shell().available).toBe(true)
  })

  it('stays unavailable while the namespace is not served', () => {
    const host = stubSettingsScope<Record<string, unknown>>()
    const subject = new CardForm(host.scope, [numberField('timeoutMs')])

    host.publish({ status: 'unavailable' })

    expect(subject.shell()).toMatchObject({ available: false, writable: false })
  })
})

describe('BashCardController', () => {
  it('projects both fields and saves them in one write pass', async () => {
    const host = stubSettingsScope<BashSettings>()
    acceptWrites(host)
    const controller = new BashCardController(host.scope)
    host.publish({
      status: 'ready',
      writable: true,
      value: { timeoutMs: 5_000, maxOutputBytes: 64_000 },
      base: { timeoutMs: 60_000, maxOutputBytes: 64_000 },
      user: { timeoutMs: 5_000 },
    })
    const face = controller.inject()

    expect(face.hooks.bashCard.getSnapshot()).toMatchObject({
      available: true,
      writable: true,
      dirty: false,
      timeoutMs: { text: '5000', overridden: true },
      maxOutputBytes: { text: '64000', overridden: false },
    })

    face.edit('timeoutMs', '9000')
    face.edit('maxOutputBytes', '1024')
    expect(face.hooks.bashCard.getSnapshot().dirty).toBe(true)

    face.save()
    await vi.waitFor(() => { expect(host.set).toHaveBeenCalledTimes(2) })

    expect(host.set.mock.calls).toEqual([['timeoutMs', 9_000], ['maxOutputBytes', 1_024]])
    expect(face.hooks.bashCard.getSnapshot().dirty).toBe(false)
  })

  it('stages a reset and applies it on save', async () => {
    const host = stubSettingsScope<BashSettings>()
    acceptWrites(host)
    const controller = new BashCardController(host.scope)
    host.publish({
      status: 'ready',
      writable: true,
      value: { timeoutMs: 5_000 },
      base: { timeoutMs: 60_000 },
      user: { timeoutMs: 5_000 },
    })
    const face = controller.inject()

    face.resetField('timeoutMs')
    expect(face.hooks.bashCard.getSnapshot().timeoutMs.text).toBe('60000')

    face.save()
    await vi.waitFor(() => { expect(host.unset).toHaveBeenCalledWith('timeoutMs') })

    expect(face.hooks.bashCard.getSnapshot()).toMatchObject({
      dirty: false,
      timeoutMs: { text: '60000', overridden: false },
    })
  })

  it('discards staged edits without writing', () => {
    const host = stubSettingsScope<BashSettings>()
    const controller = new BashCardController(host.scope)
    host.publish({ status: 'ready', writable: true, value: { timeoutMs: 5_000 }, user: {} })
    const face = controller.inject()

    face.edit('timeoutMs', '9000')
    face.discard()

    expect(face.hooks.bashCard.getSnapshot().timeoutMs.text).toBe('5000')
    expect(host.set).not.toHaveBeenCalled()
  })
})

describe('AgentLoopCardController', () => {
  it('saves the only field it owns', async () => {
    const host = stubSettingsScope<AgentLoopSettings>()
    acceptWrites(host)
    const controller = new AgentLoopCardController(host.scope)
    host.publish({
      status: 'ready',
      writable: true,
      value: { maxParallelToolCalls: 10 },
      base: { maxParallelToolCalls: 10 },
      user: {},
    })
    const face = controller.inject()

    face.edit('maxParallelToolCalls', '4')
    face.save()
    await vi.waitFor(() => { expect(host.set).toHaveBeenCalledWith('maxParallelToolCalls', 4) })

    expect(face.hooks.agentLoopCard.getSnapshot()).toMatchObject({
      dirty: false,
      maxParallelToolCalls: { text: '4', overridden: true },
    })
  })

  it('reports a read-only document so the card can disable its controls', () => {
    const host = stubSettingsScope<AgentLoopSettings>()
    const controller = new AgentLoopCardController(host.scope)

    host.publish({ status: 'ready', writable: false, value: { maxParallelToolCalls: 10 } })

    expect(controller.inject().hooks.agentLoopCard.getSnapshot().writable).toBe(false)
  })
})

describe('SubagentModelSelectionCardController', () => {
  it('joins stored routes with the live catalog without dropping unavailable choices', () => {
    const candidates = subagentModelCandidates(
      [{ id: 'alpha', name: 'Alpha API', models: [{ id: 'fast', name: 'Fast' }] }],
      [{ provider: 'legacy', model: 'old' }],
      new Set(['legacy\0old']),
    )

    expect(candidates).toEqual([
      {
        key: 'alpha\0fast', provider: 'alpha', model: 'fast', providerName: 'Alpha API',
        modelName: 'Fast', available: true, selected: false,
      },
      {
        key: 'legacy\0old', provider: 'legacy', model: 'old', providerName: 'legacy',
        modelName: 'old', available: false, selected: true,
      },
    ])
  })

  it('loads adapter models and saves the switch and routes atomically', async () => {
    const host = stubSettingsScope<SubagentModelSelectionSettings>()
    acceptWrites(host)
    const models = modelsApi({
      groups: [{ id: 'alpha', name: 'Alpha API', models: [{ id: 'fast', name: 'Fast' }] }],
    })
    const controller = new SubagentModelSelectionCardController(host.scope, models.ctx)
    host.publish({
      status: 'ready', writable: true, revision: 3,
      value: { enabled: false, allowedModels: [] }, user: {},
    })
    const face = controller.inject()

    expect(face.hooks.subagentModelSelectionCard.getSnapshot().enabled).toBe(false)
    face.toggleEnabled()
    await vi.waitFor(() => {
      expect(face.hooks.subagentModelSelectionCard.getSnapshot().candidates).toHaveLength(1)
    })
    face.toggleModel('alpha\0fast')
    face.save()
    await vi.waitFor(() => {
      expect(host.mutate).toHaveBeenCalledWith([
        { op: 'set', path: ['enabled'], value: true },
        { op: 'set', path: ['allowedModels'], value: [{ provider: 'alpha', model: 'fast' }] },
      ], 3)
    })

    expect(face.hooks.subagentModelSelectionCard.getSnapshot()).toMatchObject({
      enabled: true,
      dirty: false,
      saving: false,
      failed: false,
    })
  })

  it('starts an empty draft when a ready test scope has no decoded value', () => {
    const host = stubSettingsScope<SubagentModelSelectionSettings>()
    const controller = new SubagentModelSelectionCardController(host.scope, modelsApi().ctx)
    host.publish({ status: 'ready', writable: true, revision: 0, value: undefined })
    const face = controller.inject()

    face.toggleEnabled()

    expect(face.hooks.subagentModelSelectionCard.getSnapshot()).toMatchObject({
      enabled: true, dirty: true, invalid: true,
    })
  })

  it('keeps the Host value and reports a rejected write', async () => {
    const host = stubSettingsScope<SubagentModelSelectionSettings>()
    const models = modelsApi({
      groups: [{ id: 'alpha', name: 'Alpha API', models: [{ id: 'fast', name: 'Fast' }] }],
    })
    const controller = new SubagentModelSelectionCardController(host.scope, models.ctx)
    host.publish({ status: 'ready', writable: true, value: { enabled: false, allowedModels: [] }, user: {} })
    const face = controller.inject()

    face.toggleEnabled()
    await vi.waitFor(() => {
      expect(face.hooks.subagentModelSelectionCard.getSnapshot().candidates).toHaveLength(1)
    })
    face.toggleModel('alpha\0fast')
    face.save()
    await vi.waitFor(() => {
      expect(face.hooks.subagentModelSelectionCard.getSnapshot().failed).toBe(true)
    })

    expect(face.hooks.subagentModelSelectionCard.getSnapshot()).toMatchObject({
      enabled: true,
      dirty: true,
      saving: false,
    })
  })

  it('loads stored routes, stages removal and disablement, and discards both', async () => {
    const host = stubSettingsScope<SubagentModelSelectionSettings>()
    const models = modelsApi({
      groups: [{ id: 'alpha', name: 'Alpha API', models: [{ id: 'fast', name: 'Fast' }] }],
      failures: [{ id: 'beta', name: 'Beta', message: 'offline' }],
    })
    const controller = new SubagentModelSelectionCardController(host.scope, models.ctx)
    host.publish({
      status: 'ready', writable: true, revision: 5,
      value: { enabled: true, allowedModels: [{ provider: 'alpha', model: 'fast' }] }, user: {},
    })
    const face = controller.inject()
    const state = () => face.hooks.subagentModelSelectionCard.getSnapshot()
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })
    expect(state().catalogPartial).toBe(true)

    face.toggleModel('missing')
    expect(state().dirty).toBe(false)
    face.toggleModel('alpha\0fast')
    expect(state()).toMatchObject({ dirty: true, invalid: true })
    face.discard()
    expect(state()).toMatchObject({ dirty: false, invalid: false, enabled: true })

    face.toggleEnabled()
    expect(state()).toMatchObject({ dirty: true, enabled: false })
    face.toggleEnabled()
    expect(state()).toMatchObject({ dirty: false, enabled: true })
  })

  it('retains selected routes when disabling and loads an already-ready enabled card', async () => {
    const host = stubSettingsScope<SubagentModelSelectionSettings>()
    acceptWrites(host)
    host.publish({
      status: 'ready', writable: true, revision: 5,
      value: { enabled: true, allowedModels: [{ provider: 'alpha', model: 'fast' }] }, user: {},
    })
    const models = modelsApi({
      groups: [{ id: 'alpha', name: 'Alpha API', models: [{ id: 'fast', name: 'Fast' }] }],
    })
    const controller = new SubagentModelSelectionCardController(host.scope, models.ctx)
    const face = controller.inject()
    await vi.waitFor(() => { expect(models.models).toHaveBeenCalledOnce() })

    face.toggleEnabled()
    face.save()
    await vi.waitFor(() => {
      expect(host.mutate).toHaveBeenCalledWith([
        { op: 'set', path: ['enabled'], value: false },
        { op: 'set', path: ['allowedModels'], value: [{ provider: 'alpha', model: 'fast' }] },
      ], 5)
    })
    expect(face.hooks.subagentModelSelectionCard.getSnapshot()).toMatchObject({
      enabled: false, dirty: false,
    })
  })

  it('reports a directory error and retries it', async () => {
    const host = stubSettingsScope<SubagentModelSelectionSettings>()
    const models = modelsApi({ error: 'offline' })
    const controller = new SubagentModelSelectionCardController(host.scope, models.ctx)
    host.publish({ status: 'ready', writable: true, value: { enabled: false, allowedModels: [] }, user: {} })
    const face = controller.inject()
    const state = () => face.hooks.subagentModelSelectionCard.getSnapshot()

    face.toggleEnabled()
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('error') })
    face.retryCatalog()
    await vi.waitFor(() => { expect(models.models).toHaveBeenCalledTimes(2) })
  })

  it('rejects a draft after the Host revision changes', async () => {
    const host = stubSettingsScope<SubagentModelSelectionSettings>()
    const models = modelsApi({
      groups: [{ id: 'alpha', name: 'Alpha API', models: [{ id: 'fast', name: 'Fast' }] }],
    })
    const controller = new SubagentModelSelectionCardController(host.scope, models.ctx)
    host.publish({
      status: 'ready', writable: true, revision: 4,
      value: { enabled: false, allowedModels: [] }, user: {},
    })
    const face = controller.inject()
    face.toggleEnabled()
    await vi.waitFor(() => {
      expect(face.hooks.subagentModelSelectionCard.getSnapshot().candidates).toHaveLength(1)
    })
    face.toggleModel('alpha\0fast')

    host.publish({
      revision: 5,
      value: { enabled: true, allowedModels: [{ provider: 'other', model: 'new' }] },
    })
    expect(face.hooks.subagentModelSelectionCard.getSnapshot()).toMatchObject({
      conflicted: true, failed: false, dirty: true,
    })
    face.save()
    await Promise.resolve()

    expect(host.mutate).not.toHaveBeenCalled()
    face.discard()
    expect(face.hooks.subagentModelSelectionCard.getSnapshot()).toMatchObject({
      conflicted: false, failed: false, dirty: false, enabled: true,
    })
  })

  it('settles a draft when a newer Host revision already contains it', async () => {
    const host = stubSettingsScope<SubagentModelSelectionSettings>()
    const models = modelsApi({
      groups: [{ id: 'alpha', name: 'Alpha', models: [{ id: 'fast', name: 'Fast' }] }],
    })
    const controller = new SubagentModelSelectionCardController(host.scope, models.ctx)
    host.publish({
      status: 'ready', writable: true, revision: 4,
      value: { enabled: false, allowedModels: [] }, user: {},
    })
    const face = controller.inject()
    face.toggleEnabled()
    await vi.waitFor(() => { expect(face.hooks.subagentModelSelectionCard.getSnapshot().candidates).toHaveLength(1) })
    face.toggleModel('alpha\0fast')

    host.publish({
      revision: 5,
      value: { enabled: true, allowedModels: [{ provider: 'alpha', model: 'fast' }] },
    })

    expect(face.hooks.subagentModelSelectionCard.getSnapshot()).toMatchObject({
      conflicted: false, dirty: false, enabled: true,
    })
  })

  it('retains unsaved routes across a catalog refresh', async () => {
    const host = stubSettingsScope<SubagentModelSelectionSettings>()
    acceptWrites(host)
    host.publish({
      status: 'ready', writable: true, revision: 2,
      value: { enabled: false, allowedModels: [] }, user: {},
    })
    const refreshed = deferred<never>()
    const models = vi.fn()
      .mockResolvedValueOnce({
        ok: true, value: {
          groups: [{ id: 'alpha', name: 'Alpha', models: [{ id: 'fast', name: 'Fast' }] }],
          failures: [],
        },
      })
      .mockImplementationOnce(() => refreshed.promise)
    const controller = new SubagentModelSelectionCardController(
      host.scope, ctxWith({ session: { modelCatalog: models } }),
    )
    const face = controller.inject()
    const state = () => face.hooks.subagentModelSelectionCard.getSnapshot()
    face.toggleEnabled()
    await vi.waitFor(() => { expect(state().candidates).toHaveLength(1) })
    face.toggleModel('alpha\0fast')

    controller.refreshCatalog()
    expect(state()).toMatchObject({
      catalogStatus: 'loading',
      candidates: [expect.objectContaining({ key: 'alpha\0fast', selected: true })],
    })
    refreshed.resolve({
      ok: true, value: { groups: [], failures: [] },
    } as never)
    await vi.waitFor(() => { expect(state().catalogStatus).toBe('ready') })
    expect(state().candidates).toEqual([
      expect.objectContaining({ key: 'alpha\0fast', available: false, selected: true }),
    ])

    face.save()
    await vi.waitFor(() => {
      expect(host.mutate).toHaveBeenCalledWith([
        { op: 'set', path: ['enabled'], value: true },
        { op: 'set', path: ['allowedModels'], value: [{ provider: 'alpha', model: 'fast' }] },
      ], 2)
    })
  })

  it('drops a draft when the connection generation changes', async () => {
    const host = stubSettingsScope<SubagentModelSelectionSettings>()
    const models = modelsApi({
      groups: [{ id: 'alpha', name: 'Alpha', models: [{ id: 'fast', name: 'Fast' }] }],
    })
    host.publish({
      status: 'ready', writable: true, revision: 4,
      value: { enabled: false, allowedModels: [] }, user: {},
    })
    const controller = new SubagentModelSelectionCardController(host.scope, models.ctx)
    const face = controller.inject()
    face.toggleEnabled()
    await vi.waitFor(() => { expect(face.hooks.subagentModelSelectionCard.getSnapshot().candidates).toHaveLength(1) })
    face.toggleModel('alpha\0fast')

    controller.resetConnection()
    host.publish({
      revision: 4,
      value: { enabled: true, allowedModels: [{ provider: 'other', model: 'new' }] },
    })

    expect(face.hooks.subagentModelSelectionCard.getSnapshot()).toMatchObject({
      conflicted: false, dirty: false, enabled: true,
    })
    face.save()
    await Promise.resolve()
    expect(host.mutate).not.toHaveBeenCalled()
  })

  it('reloads the model catalog after invalidation', async () => {
    const host = stubSettingsScope<SubagentModelSelectionSettings>()
    host.publish({
      status: 'ready', writable: true, revision: 1,
      value: { enabled: true, allowedModels: [] }, user: {},
    })
    const models = vi.fn()
      .mockResolvedValueOnce({
        ok: true, value: {
          groups: [{ id: 'alpha', name: 'Alpha', models: [{ id: 'fast', name: 'Fast' }] }],
          failures: [],
        },
      })
      .mockResolvedValueOnce({
        ok: true, value: {
          groups: [{ id: 'beta', name: 'Beta', models: [{ id: 'new', name: 'New' }] }],
          failures: [],
        },
      })
    const controller = new SubagentModelSelectionCardController(
      host.scope, ctxWith({ session: { modelCatalog: models } }),
    )
    const state = () => controller.inject().hooks.subagentModelSelectionCard.getSnapshot()
    await vi.waitFor(() => { expect(state().candidates[0]?.provider).toBe('alpha') })

    controller.refreshCatalog()

    await vi.waitFor(() => { expect(state().candidates[0]?.provider).toBe('beta') })
    expect(models).toHaveBeenCalledTimes(2)
  })

  it('suppresses duplicate actions and late save settlements', async () => {
    const host = stubSettingsScope<SubagentModelSelectionSettings>()
    const catalog = modelsApi({
      groups: [{ id: 'alpha', name: 'Alpha API', models: [{ id: 'fast', name: 'Fast' }] }],
    })
    const write = deferred<undefined>()
    const mutate = vi.fn(async (ops: readonly SettingsPathOpView[]) => {
      await write.promise
      const enabled = ops.find(op => op.path[0] === 'enabled')
      const allowedModels = ops.find(op => op.path[0] === 'allowedModels')
      host.publish({ value: {
        enabled: enabled?.op === 'set' ? enabled.value as boolean : false,
        allowedModels: allowedModels?.op === 'set' ? allowedModels.value as never[] : [],
      } })
    })
    const controller = new SubagentModelSelectionCardController({ ...host.scope, mutate }, catalog.ctx)
    const face = controller.inject()

    face.save()
    face.toggleModel('alpha\0fast')
    host.publish({ status: 'ready', writable: true, value: { enabled: false, allowedModels: [] }, user: {} })
    face.save()
    face.toggleEnabled()
    await vi.waitFor(() => { expect(face.hooks.subagentModelSelectionCard.getSnapshot().catalogStatus).toBe('ready') })
    face.save()
    face.toggleModel('alpha\0fast')
    face.save()
    expect(face.hooks.subagentModelSelectionCard.getSnapshot().saving).toBe(true)
    face.toggleEnabled()
    face.toggleModel('alpha\0fast')
    face.save()
    face.discard()
    controller.dispose()
    write.resolve(undefined)
    await write.promise
    expect(mutate).toHaveBeenCalledOnce()
  })

  it('suppresses duplicate directory loads and late settlements', async () => {
    const host = stubSettingsScope<SubagentModelSelectionSettings>()
    host.publish({ status: 'ready', writable: true, value: { enabled: false, allowedModels: [] }, user: {} })

    const pending = deferred<never>()
    const models = vi.fn(() => pending.promise)
    const controller = new SubagentModelSelectionCardController(host.scope, ctxWith({ session: { modelCatalog: models } }))
    const face = controller.inject()
    face.toggleEnabled()
    face.retryCatalog()
    expect(models).toHaveBeenCalledOnce()
    controller.dispose()
    pending.resolve({ ok: false, error: new RemoteError('gateway/internal', 'late failure', {}) } as never)
    await pending.promise

    const pendingResolve = deferred<never>()
    const resolving = new SubagentModelSelectionCardController(
      host.scope,
      ctxWith({ session: { modelCatalog: () => pendingResolve.promise } }),
    )
    const resolvingFace = resolving.inject()
    resolvingFace.toggleEnabled()
    resolving.dispose()
    pendingResolve.resolve({
      ok: true, value: { groups: [], failures: [] },
    } as never)
    await pendingResolve.promise
  })

  it('ignores writes while read-only and scope notifications after disposal', () => {
    const host = stubSettingsScope<SubagentModelSelectionSettings>()
    const controller = new SubagentModelSelectionCardController(host.scope, modelsApi().ctx)
    host.publish({ status: 'ready', writable: false, value: { enabled: false, allowedModels: [] }, user: {} })
    const face = controller.inject()

    face.toggleEnabled()
    face.toggleModel('alpha\0fast')
    face.save()
    expect(host.mutate).not.toHaveBeenCalled()

    controller.dispose()
    controller.refreshCatalog()
    controller.resetConnection()
    face.toggleEnabled()
    face.retryCatalog()
    face.save()
    host.publish({ value: { enabled: true, allowedModels: [{ provider: 'alpha', model: 'fast' }] } })
    expect(host.mutate).not.toHaveBeenCalled()
    expect(face.hooks.subagentModelSelectionCard.getSnapshot().enabled).toBe(false)
  })
})

describe('WebSearchCardController', () => {
  it('reads the credential state for the reference the tab names', async () => {
    const host = stubSettingsScope<WebSearchSettings>()
    const credentials = credentialsApi(true)
    const controller = new WebSearchCardController(host.scope, credentials.ctx)
    const state = () => controller.inject().hooks.webSearchCard.getSnapshot()
    await vi.waitFor(() => { expect(credentials.describe).toHaveBeenCalled() })

    host.publish({ status: 'ready', writable: true, value: { baseURL: 'https://search.test/v1' }, user: {} })
    await vi.waitFor(() => { expect(state().apiKeyConfigured).toBe(true) })

    expect(state()).toMatchObject({
      baseURL: { text: 'https://search.test/v1', overridden: false },
      apiKey: { text: '', overridden: false },
    })
  })

  it('writes the staged key through the credentials domain, never the settings section', async () => {
    const host = stubSettingsScope<WebSearchSettings>()
    const credentials = credentialsApi(false)
    const controller = new WebSearchCardController(host.scope, credentials.ctx)
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    const face = controller.inject()

    face.edit('apiKey', ' ds-secret ')
    expect(face.hooks.webSearchCard.getSnapshot().dirty).toBe(true)
    expect(credentials.set).not.toHaveBeenCalled()

    credentials.describe.mockImplementation(() => Promise.resolve({
      ok: true as const,
      value: { DEEPSEEK_API_KEY: { configured: true, writable: true } },
    }))
    face.save()
    await vi.waitFor(() => { expect(credentials.set).toHaveBeenCalled() })

    expect(credentials.set).toHaveBeenCalledWith('DEEPSEEK_API_KEY', 'ds-secret')
    expect(host.set).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(face.hooks.webSearchCard.getSnapshot()).toMatchObject({ dirty: false, apiKeyConfigured: true })
    })
  })

  it('keeps the stored key when the draft is left blank', () => {
    const host = stubSettingsScope<WebSearchSettings>()
    const credentials = credentialsApi(true)
    const controller = new WebSearchCardController(host.scope, credentials.ctx)
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    const face = controller.inject()

    face.edit('apiKey', '   ')

    expect(face.hooks.webSearchCard.getSnapshot().dirty).toBe(false)
    face.save()

    expect(credentials.set).not.toHaveBeenCalled()
  })

  it('re-reads when the Host reports the watched reference changed', async () => {
    const host = stubSettingsScope<WebSearchSettings>()
    const credentials = credentialsApi(false)
    const controller = new WebSearchCardController(host.scope, credentials.ctx)
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    await vi.waitFor(() => { expect(credentials.describe).toHaveBeenCalled() })
    credentials.describe.mockClear()

    // Another reference is not this card's business.
    controller.refreshCredential('OTHER_KEY')
    expect(credentials.describe).not.toHaveBeenCalled()

    // A key written on another surface reaches this card only through this signal.
    credentials.describe.mockImplementation(() => Promise.resolve({
      ok: true as const,
      value: { DEEPSEEK_API_KEY: { configured: true, writable: true } },
    }))
    controller.refreshCredential('DEEPSEEK_API_KEY')

    await vi.waitFor(() => {
      expect(controller.inject().hooks.webSearchCard.getSnapshot().apiKeyConfigured).toBe(true)
    })
  })

  it('addresses the reference the tab declares rather than the default', async () => {
    const host = stubSettingsScope<WebSearchSettings>()
    const credentials = credentialsApi(false)
    const controller = new WebSearchCardController(host.scope, credentials.ctx)
    host.publish({ status: 'ready', writable: true, value: { apiKeyEnv: 'SEARCH_KEY' }, user: {} })
    const face = controller.inject()

    face.edit('apiKey', 'ds-secret')
    face.save()
    await vi.waitFor(() => { expect(credentials.set).toHaveBeenCalled() })

    expect(credentials.set).toHaveBeenCalledWith('SEARCH_KEY', 'ds-secret')
  })

  it('reports a key the Host did not store as a failed save', async () => {
    const host = stubSettingsScope<WebSearchSettings>()
    const credentials = credentialsApi(false)
    const controller = new WebSearchCardController(host.scope, credentials.ctx)
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    const face = controller.inject()

    face.edit('apiKey', 'ds-secret')
    face.save()

    await vi.waitFor(() => {
      expect(face.hooks.webSearchCard.getSnapshot()).toMatchObject({ failed: true, dirty: true })
    })
  })

  it('keeps the card usable when the credential read is refused', async () => {
    const host = stubSettingsScope<WebSearchSettings>()
    const refusal = () => Promise.resolve({
      ok: false as const,
      error: new RemoteError('credential/rejected', 'offline', { ref: 'DEEPSEEK_API_KEY' }),
    })
    const describe = vi.fn(refusal)
    const set = vi.fn(refusal)
    const controller = new WebSearchCardController(host.scope, ctxWith({ credentials: { describe, set } }))
    const face = controller.inject()
    await vi.waitFor(() => { expect(describe).toHaveBeenCalled() })

    host.publish({ status: 'ready', writable: true, value: { baseURL: 'https://search.test/v1' }, user: {} })
    face.edit('apiKey', 'ds-secret')
    face.save()
    await vi.waitFor(() => { expect(set).toHaveBeenCalled() })

    expect(face.hooks.webSearchCard.getSnapshot()).toMatchObject({
      available: true,
      apiKeyConfigured: false,
      baseURL: { text: 'https://search.test/v1' },
    })
  })

  it('ignores a credential read the Host refused', async () => {
    const host = stubSettingsScope<WebSearchSettings>()
    const describe = vi.fn(() => Promise.resolve({
      ok: false as const,
      error: new RemoteError('gateway/internal', 'no credential provider', {}),
    }))
    const controller = new WebSearchCardController(host.scope, ctxWith({
      credentials: { describe, set: vi.fn() },
    }))
    await vi.waitFor(() => { expect(describe).toHaveBeenCalled() })

    expect(controller.inject().hooks.webSearchCard.getSnapshot().apiKeyConfigured).toBe(false)
  })

  it('saves the endpoint and the search budget together', async () => {
    const host = stubSettingsScope<WebSearchSettings>()
    acceptWrites(host)
    const credentials = credentialsApi(true)
    const controller = new WebSearchCardController(host.scope, credentials.ctx)
    host.publish({ status: 'ready', writable: true, value: {}, base: {}, user: {} })
    const face = controller.inject()

    face.edit('baseURL', 'https://other.test')
    face.edit('maxUses', '3')
    face.save()
    await vi.waitFor(() => { expect(host.set).toHaveBeenCalledTimes(2) })

    expect(host.set.mock.calls).toEqual([['baseURL', 'https://other.test'], ['maxUses', 3]])
    expect(credentials.set).not.toHaveBeenCalled()
  })
})

describe('ConfigurablePluginsTabController', () => {
  function settingsApi(namespaces: string[]) {
    const describe = vi.fn(() => Promise.resolve({
      ok: true as const,
      value: {
        writable: true,
        hasDocument: true,
        namespaces: namespaces.map(ns => ({
          ns, schema: {}, value: {}, applies: 'live' as const, secrets: [], revision: 0,
        })),
      },
    }))
    return { mirror: new SettingsDescribeMirror(ctxWith({ settings: { describe } })), describe }
  }

  /** Slot ledger stand-in: one stored entry per registered card key. */
  function ledger(...keys: string[]) {
    return keys.map(key => ({ component: null, options: { key } }))
  }

  it('dispatches the served namespaces a card claims, in card registration order', async () => {
    const settings = settingsApi(['bash', 'ui-theme', 'agent-loop'])
    const controller = new ConfigurablePluginsTabController(settings.mirror, () => ledger('agent-loop', 'bash'))

    await settings.mirror.ensure()

    // ui-theme is served but claimed by no card here — another surface owns
    // it. The order is the cards', not the Host's: plugin activation can
    // reorder the description between boots.
    expect(controller.inject().hooks.configurablePlugins.getSnapshot().namespaces)
      .toEqual(['agent-loop', 'bash'])
  })

  it('never dispatches a card whose namespace this deployment does not serve', async () => {
    const settings = settingsApi(['bash'])
    const controller = new ConfigurablePluginsTabController(settings.mirror, () => ledger('bash', 'web-search-deepseek'))

    await settings.mirror.ensure()

    expect(controller.inject().hooks.configurablePlugins.getSnapshot().namespaces).toEqual(['bash'])
  })

  it('takes a card registered after the read without asking the Host again', async () => {
    const settings = settingsApi(['bash'])
    let entries = ledger()
    const controller = new ConfigurablePluginsTabController(settings.mirror, () => entries)
    await settings.mirror.ensure()
    expect(controller.inject().hooks.configurablePlugins.getSnapshot().namespaces).toEqual([])

    entries = ledger('bash')
    controller.refresh()

    expect(controller.inject().hooks.configurablePlugins.getSnapshot().namespaces).toEqual(['bash'])
    expect(settings.describe).toHaveBeenCalledOnce()
  })

  it('keeps the namespaces it knew when a refresh fails', async () => {
    const settings = settingsApi(['bash'])
    const controller = new ConfigurablePluginsTabController(settings.mirror, () => ledger('bash'))
    await settings.mirror.ensure()
    settings.describe.mockRejectedValueOnce(new Error('offline'))

    await settings.mirror.load()

    expect(controller.inject().hooks.configurablePlugins.getSnapshot().namespaces).toEqual(['bash'])
  })

  it('stops following the mirror once disposed, and never claims it was answered', async () => {
    const settings = settingsApi(['bash'])
    const controller = new ConfigurablePluginsTabController(settings.mirror, () => ledger('bash'))

    controller.dispose()
    await settings.mirror.load()

    expect(controller.inject().hooks.configurablePlugins.getSnapshot())
      .toEqual({ loaded: false, namespaces: [] })
  })

  it('ignores a slot-ledger change that arrives after disposal', async () => {
    const settings = settingsApi(['bash'])
    let entries = ledger()
    const controller = new ConfigurablePluginsTabController(settings.mirror, () => entries)
    await settings.mirror.ensure()

    controller.dispose()
    entries = ledger('bash')
    controller.refresh()

    expect(controller.inject().hooks.configurablePlugins.getSnapshot().namespaces).toEqual([])
  })

  it('ignores a mirror notification already queued when disposal starts', () => {
    let notify = (): void => {}
    let snapshot: SettingsMirrorSnapshot = {
      status: 'ready' as const,
      view: { writable: true, hasDocument: true, namespaces: [] },
      error: null,
    }
    const describeFace = {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        notify = listener
        return () => {}
      },
      ensure: () => Promise.resolve(),
      acceptView: vi.fn(),
    } as never
    const controller = new ConfigurablePluginsTabController(describeFace, () => ledger('bash'))
    expect(controller.inject().hooks.configurablePlugins.getSnapshot())
      .toEqual({ loaded: true, namespaces: [] })

    controller.dispose()
    snapshot = {
      status: 'ready',
      view: {
        writable: true,
        hasDocument: true,
        namespaces: [{
          ns: 'bash', schema: {}, value: {}, applies: 'live', secrets: [], revision: 1,
        }],
      },
      error: null,
    }
    notify()

    expect(controller.inject().hooks.configurablePlugins.getSnapshot())
      .toEqual({ loaded: true, namespaces: [] })
  })

  it('reports the Host answered even when it serves nothing this tab shows', async () => {
    const settings = settingsApi(['ui-theme'])
    const controller = new ConfigurablePluginsTabController(settings.mirror, () => ledger('bash'))

    await settings.mirror.ensure()

    expect(controller.inject().hooks.configurablePlugins.getSnapshot())
      .toEqual({ loaded: true, namespaces: [] })
  })
})

describe('ConsoleBridgeCardController', () => {
  /** A test-connection remote that reports the given reachability. */
  function consoleApi(ok: boolean, message = 'reachable (200)') {
    const testConnection = vi.fn<
      (input: ConsoleBridgeTestRequest) => Promise<RemoteResult<ConsoleBridgeTestResult>>
    >(async _input => (
      ok
        ? { ok: true as const, value: { ok, message } }
        : { ok: false as const, error: new RemoteError('gateway/internal', message, {}) }
    ))
    return { testConnection }
  }

  it('projects the connection fields, writes them on save, and toggles the enable switch', async () => {
    const host = stubSettingsScope<ConsoleBridgeSettings>()
    acceptWrites(host)
    const controller = new ConsoleBridgeCardController(host.scope, consoleApi(true).testConnection)
    host.publish({
      status: 'ready', writable: true,
      value: { agentId: 'a', brokerUrl: 'mqtt://x', transport: 'http', enabled: false },
      base: { agentId: 'a' },
      user: { agentId: 'a' },
    })
    const face = controller.inject()

    expect(face.getEnabled()).toBe(false)
    expect(face.hooks.consoleBridgeCard.getSnapshot()).toMatchObject({
      available: true, writable: true, dirty: false,
      agentId: { text: 'a', overridden: true },
      brokerUrl: { text: 'mqtt://x', overridden: false },
    })
    // Write-only secrets render blank and never reveal a stored value.
    expect(face.hooks.consoleBridgeCard.getSnapshot().token.text).toBe('')

    face.edit('brokerUrl', 'mqtt://new')
    face.save()
    await vi.waitFor(() => { expect(host.set).toHaveBeenCalledWith('brokerUrl', 'mqtt://new') })

    await face.setEnabled(true)
    expect(host.set).toHaveBeenCalledWith('enabled', true)
    expect(face.getEnabled()).toBe(true)
  })

  it('reads the enabled flag as false when the namespace carries none', () => {
    const host = stubSettingsScope<ConsoleBridgeSettings>()
    host.publish({ status: 'ready', writable: true, value: { transport: 'http' }, user: {} })
    const controller = new ConsoleBridgeCardController(host.scope, consoleApi(true).testConnection)

    expect(controller.getEnabled()).toBe(false)
  })

  it('builds a request from the current scope and unwraps an ok connection probe', async () => {
    const host = stubSettingsScope<ConsoleBridgeSettings>()
    host.publish({
      status: 'ready', writable: true,
      value: { agentId: 'a', brokerUrl: 'mqtt://x', mqttUsername: 'u', mqttPassword: 'p', consoleBaseUrl: 'http://h', token: 't', transport: 'http' },
      user: {},
    })
    const { testConnection } = consoleApi(true)
    const controller = new ConsoleBridgeCardController(host.scope, testConnection)

    expect(await controller.runTest()).toEqual({ ok: true, message: 'reachable (200)' })
    const request = testConnection.mock.calls[0]![0]
    expect(request).toMatchObject({ agentId: 'a', transport: 'http', brokerUrl: 'mqtt://x', token: 't' })
  })

  it('unwraps a refused connection probe into a failed result', async () => {
    const host = stubSettingsScope<ConsoleBridgeSettings>()
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    const controller = new ConsoleBridgeCardController(host.scope, consoleApi(false, 'auth failed').testConnection)

    expect(await controller.runTest()).toEqual({ ok: false, message: 'auth failed' })
  })

  it('writes a secret only when the draft is non-empty', async () => {
    const host = stubSettingsScope<ConsoleBridgeSettings>()
    acceptWrites(host)
    const controller = new ConsoleBridgeCardController(host.scope, consoleApi(true).testConnection)
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    const face = controller.inject()

    // A blank draft writes nothing, so saving other fields never wipes the key.
    face.edit('token', '   ')
    face.save()
    await Promise.resolve()
    expect(host.set).not.toHaveBeenCalledWith('token', '   ')

    face.edit('token', 'secret-tok')
    face.save()
    await vi.waitFor(() => { expect(host.set).toHaveBeenCalledWith('token', 'secret-tok') })
  })

  it('reports a save failure when the Host rejects a write', async () => {
    const host = stubSettingsScope<ConsoleBridgeSettings>()
    host.set.mockRejectedValueOnce(new Error('reject'))
    const controller = new ConsoleBridgeCardController(host.scope, consoleApi(true).testConnection)
    host.publish({ status: 'ready', writable: true, value: {}, user: {} })
    const face = controller.inject()

    face.edit('token', 'secret-tok')
    face.save()

    await vi.waitFor(() => {
      expect(face.hooks.consoleBridgeCard.getSnapshot()).toMatchObject({ failed: true, dirty: true })
    })
  })
})

describe('ConsolePricingCardController', () => {
  const chat: ConsolePricingRow = {
    baseUrl: 'https://api.deepseek.com',
    provider: 'deepseek',
    model: 'deepseek-chat',
    peak: { cacheHit: 0.07, cacheMiss: 0.27, output: 1.1 },
    offPeak: { cacheHit: 0.04, cacheMiss: 0.14, output: 0.55 },
  }
  const reasoner: ConsolePricingRow = {
    baseUrl: 'https://api.deepseek.com',
    provider: 'deepseek',
    model: 'deepseek-reasoner',
    peak: { cacheHit: 0.14, cacheMiss: 0.55, output: 2.19 },
    offPeak: { cacheHit: 0.07, cacheMiss: 0.28, output: 1.1 },
  }
  const stagedChat = {
    baseUrl: 'https://api.deepseek.com',
    provider: 'deepseek',
    model: 'deepseek-chat',
    peakCacheHit: '0.07', peakCacheMiss: '0.27', peakOutput: '1.1',
    offPeakCacheHit: '0.04', offPeakCacheMiss: '0.14', offPeakOutput: '0.55',
  }
  const stagedReasoner = {
    ...stagedChat,
    model: 'deepseek-reasoner',
    peakCacheHit: '0.14', peakCacheMiss: '0.55', peakOutput: '2.19',
    offPeakCacheHit: '0.07', offPeakCacheMiss: '0.28', offPeakOutput: '1.1',
  }

  /** Stage every cell of one row, as an operator filling the form would. */
  function fill(face: ConsolePricingCardFace, index: number, row: ConsolePricingRow): void {
    face.editCell(index, 'baseUrl', row.baseUrl)
    face.editCell(index, 'provider', row.provider)
    face.editCell(index, 'model', row.model)
    for (const band of ['peak', 'offPeak'] as const) {
      face.editCell(index, `${band}CacheHit`, String(row[band].cacheHit))
      face.editCell(index, `${band}CacheMiss`, String(row[band].cacheMiss))
      face.editCell(index, `${band}Output`, String(row[band].output))
    }
  }

  /** The card over one published section, with every write spy exposed. */
  function card(
    settings: ConsolePricingSettings,
    published: Partial<SettingsScopeSnapshot<ConsolePricingSettings>> = {},
  ) {
    const host = stubSettingsScope<ConsolePricingSettings>()
    const controller = new ConsolePricingCardController(host.scope)
    host.publish({
      status: 'ready', writable: true, revision: 1, value: settings, user: {}, ...published,
    })
    const face = controller.inject()
    return { host, face, state: () => face.hooks.consolePricingCard.getSnapshot() }
  }

  it('shows the stored table, staged as typed, and stays clean until a cell is edited', () => {
    const { host, face, state } = card({ models: [chat] })

    expect(state()).toMatchObject({
      available: true, writable: true, dirty: false, invalid: false, problem: undefined,
      rows: [stagedChat],
    })

    face.editCell(0, 'peakCacheMiss', '0.5')

    expect(state()).toMatchObject({ dirty: true, invalid: false, rows: [{ ...stagedChat, peakCacheMiss: '0.5' }] })
    expect(host.set).not.toHaveBeenCalled()
  })

  it('treats an absent table as an empty one', async () => {
    const { host, face, state } = card({})

    expect(state()).toMatchObject({ available: true, dirty: false, problem: undefined, rows: [] })

    face.save()
    await Promise.resolve()

    expect(host.set).not.toHaveBeenCalled()
  })

  it('writes the whole normalized table on save', async () => {
    const { host, face, state } = card({ models: [] })
    acceptWrites(host)

    face.addRow()
    fill(face, 0, { ...reasoner, provider: '  deepseek ' })
    expect(host.set).not.toHaveBeenCalled()

    face.save()
    await vi.waitFor(() => { expect(host.set).toHaveBeenCalledTimes(1) })

    expect(host.set.mock.calls).toEqual([['models', [reasoner]]])
    // The draft is dropped and the card re-reads what the Host stored.
    expect(state()).toMatchObject({ dirty: false, failed: false, saving: false })
    expect(state().rows).toEqual([stagedReasoner])
  })

  it('refuses every invalid table and writes none of them', async () => {
    const { host, face, state } = card({ models: [] })

    face.addRow()
    // An empty endpoint, provider, then model, then a rate that is missing,
    // unreadable, or negative: each names its own row and check.
    expect(state()).toMatchObject({ dirty: true, invalid: true, problem: { kind: 'baseUrl', row: 0 } })
    face.editCell(0, 'baseUrl', 'https://api.deepseek.com')
    expect(state().problem).toEqual({ kind: 'provider', row: 0 })
    face.editCell(0, 'provider', 'deepseek')
    expect(state().problem).toEqual({ kind: 'model', row: 0 })
    face.editCell(0, 'model', 'deepseek-chat')
    expect(state().problem).toEqual({ kind: 'price', row: 0 })
    face.editCell(0, 'peakCacheHit', 'soon')
    expect(state().problem).toEqual({ kind: 'price', row: 0 })
    face.editCell(0, 'peakCacheHit', '-1')
    expect(state().problem).toEqual({ kind: 'price', row: 0 })
    face.editCell(0, 'peakCacheHit', '0.07')
    expect(state().problem).toEqual({ kind: 'price', row: 0 })
    fill(face, 0, chat)
    expect(state()).toMatchObject({ invalid: false, problem: undefined })

    // A second row repeating the exact triple: the triple is what must be unique.
    face.addRow()
    fill(face, 1, chat)
    expect(state().problem).toEqual({ kind: 'duplicate', row: 1 })

    face.save()
    await Promise.resolve()

    expect(host.set).not.toHaveBeenCalled()
    expect(state().rows).toHaveLength(2)
  })

  it('accepts one model reached through two endpoints', async () => {
    // Two endpoints price the same model differently, so both rows are distinct
    // routes rather than a duplicate key.
    const { host, face, state } = card({ models: [] })
    acceptWrites(host)
    const proxy = { ...chat, baseUrl: 'https://proxy.example.com' }

    face.addRow()
    fill(face, 0, chat)
    face.addRow()
    fill(face, 1, proxy)
    expect(state()).toMatchObject({ invalid: false, problem: undefined })

    face.save()
    await vi.waitFor(() => { expect(host.set).toHaveBeenCalledTimes(1) })

    expect(host.set.mock.calls).toEqual([['models', [chat, proxy]]])
  })

  it('drops one row, and drops the whole draft on discard', () => {
    const { host, face, state } = card({ models: [chat, reasoner] })

    face.removeRow(0)
    expect(state().rows).toEqual([stagedReasoner])

    face.discard()
    expect(state()).toMatchObject({ dirty: false, rows: [stagedChat, stagedReasoner] })

    // A discard with nothing staged writes nothing further.
    face.discard()
    expect(host.set).not.toHaveBeenCalled()
  })

  it('drops a draft that settles back on the text already stored', async () => {
    const { host, face, state } = card({ models: [chat] })

    face.editCell(0, 'provider', 'deepseek-other')
    face.editCell(0, 'provider', 'deepseek')
    expect(state().dirty).toBe(false)

    face.save()
    await Promise.resolve()

    expect(host.set).not.toHaveBeenCalled()
  })

  it('keeps the draft and reports a table the Host did not store', async () => {
    const { host, face, state } = card({ models: [] })

    face.addRow()
    fill(face, 0, chat)
    face.save()

    // The stub accepted the call without storing anything, exactly as a Host
    // validator that refuses the table does.
    await vi.waitFor(() => { expect(state().failed).toBe(true) })

    expect(host.set.mock.calls).toEqual([['models', [chat]]])
    expect(state()).toMatchObject({ dirty: true, saving: false })
    expect(state().rows).toEqual([stagedChat])
  })

  it('refuses a save while the namespace is not served, or the document is read-only', async () => {
    const loading = stubSettingsScope<ConsolePricingSettings>()
    const unserved = new ConsolePricingCardController(loading.scope).inject()
    const { host, face } = card({ models: [] }, { writable: false })
    for (const target of [unserved, face]) {
      target.addRow()
      fill(target, 0, chat)
      target.save()
    }
    await Promise.resolve()

    expect(loading.set).not.toHaveBeenCalled()
    expect(host.set).not.toHaveBeenCalled()
    expect(unserved.hooks.consolePricingCard.getSnapshot()).toMatchObject({
      available: false, writable: false, dirty: true,
    })
  })

  it('refuses a second save while one is in flight', async () => {
    const host = stubSettingsScope<ConsolePricingSettings>()
    const write = deferred<undefined>()
    const set = vi.fn(async () => { await write.promise })
    const face = new ConsolePricingCardController({ ...host.scope, set }).inject()
    host.publish({ status: 'ready', writable: true, revision: 1, value: { models: [chat] }, user: {} })
    const state = () => face.hooks.consolePricingCard.getSnapshot()

    face.editCell(0, 'offPeakOutput', '2')
    face.save()
    expect(state().saving).toBe(true)
    face.save()
    write.resolve(undefined)
    await write.promise

    expect(set).toHaveBeenCalledTimes(1)
  })
})
