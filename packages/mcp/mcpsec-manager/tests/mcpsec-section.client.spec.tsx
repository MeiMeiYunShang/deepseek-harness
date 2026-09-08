// @vitest-environment jsdom
/**
 * The MCP security settings section: server catalog, per-server scope/rules/
 * enable/remove, the add flow (npm search → prefilled → custom), the edit
 * form, and the usage/risk stats window. The catalog is seeded through the
 * store instance before render; every write callback is a spec stub asserted
 * on by this suite.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ServerView, StatsData } from '../src/client/types.ts'
import { McpSecSection, type McpSecSectionProps } from '../src/client/McpSecSection.tsx'
import { createMcpSecStore } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(en)

type Instance = ReturnType<ReturnType<typeof createMcpSecStore>['create']>

const SERVER: ServerView = {
  id: 'e1', serverName: 'gh', transport: 'streamable-http', url: 'https://api.github.com',
  command: undefined, args: [], cwd: undefined, envCount: 1, headersCount: 0,
  toolCallTimeoutMs: 5000, failOnStartupError: true, scope: 'read-only',
  toolRules: { delete_repo: 'deny' }, tools: ['get_issue', 'create_issue'], disabled: false, fiberPhase: 'active',
}

const STATS: StatsData = {
  threshold: 50, windowMs: 600000,
  servers: [{ server: 'gh', calls: 3, failures: 0, blocked: 0, authErrors: 0, credArgs: 0, maxKB: 0, avgDurMs: 5, spike: false, score: 10, reasons: [] }],
  alerts: [{ server: 'gh', score: 60, reasons: ['cred'] }],
}

/** Seed a fresh store and render the section. */
function renderSection(seed?: (instance: Instance) => void, overrides: Partial<Record<'refresh' | 'add' | 'remove' | 'setEnabled' | 'setScope' | 'edit' | 'setThreshold' | 'clearStats' | 'npmSearch', ReturnType<typeof vi.fn>>> = {}) {
  const instance = createMcpSecStore().create()
  seed?.(instance)
  const calls = {
    refresh: vi.fn(async () => {}),
    add: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    setEnabled: vi.fn(async () => {}),
    setScope: vi.fn(async () => {}),
    edit: vi.fn(async () => {}),
    setThreshold: vi.fn(async () => {}),
    clearStats: vi.fn(async () => {}),
    npmSearch: vi.fn(async () => []),
    ...overrides,
  }
  render(<McpSecSection {...({
    useStore: bindSnapshotSelector(instance.store),
    ...calls,
    t,
  } as unknown as McpSecSectionProps)} />)
  return { instance, calls }
}

const seedCatalog = (instance: Instance): void => { instance.actions.setData([SERVER], STATS) }

describe('the MCP security section', () => {
  it('loads the catalog on mount and lists servers with their facts', () => {
    const { calls } = renderSection(seedCatalog)
    expect(calls.refresh).toHaveBeenCalledTimes(1)
    expect(screen.getAllByText('gh').length).toBeGreaterThan(0)
    expect(screen.getByText(/Tools: 2/)).toBeDefined()
    expect(screen.getByText(/https:\/\/api\.github\.com/)).toBeDefined()
  })

  it('renders the empty placeholder without servers', () => {
    renderSection()
    expect(screen.getByText(en.noServers)).toBeDefined()
  })

  it('shows the alert banner and the stats window', () => {
    renderSection(seedCatalog)
    expect(screen.getByText(en.alertTitle)).toBeDefined()
    expect(screen.getByText(/Calls 3/)).toBeDefined()
    expect(screen.getAllByText('gh').length).toBeGreaterThan(0)
  })

  it('renders the error surface with a retry button', () => {
    const { calls } = renderSection((instance) => { instance.actions.setFailed('boom') })
    expect(screen.getByRole('alert').textContent).toContain('boom')
    fireEvent.click(screen.getByText(en.retry))
    expect(calls.refresh).toHaveBeenCalledTimes(2)
  })

  it('falls back to the default error text when the error state has no message', () => {
    renderSection((instance) => { instance.store.set({ status: 'error', error: null, servers: [], stats: STATS }) })
    expect(screen.getByRole('alert').textContent).toContain(en.error)
  })

  it('surfaces a rejected mutation as a failure banner', async () => {
    const { calls } = renderSection(seedCatalog)
    calls.remove.mockRejectedValueOnce('plain rejection')
    fireEvent.click(screen.getAllByText(en.remove)[0]!)
    fireEvent.click(screen.getByText(en.confirmRemove))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('plain rejection') })
  })

  it('enables/disables a server through the injected callback', async () => {
    const { calls } = renderSection(seedCatalog)
    fireEvent.click(screen.getByText(en.disabled))
    await waitFor(() => { expect(calls.setEnabled).toHaveBeenCalledWith('e1', false) })
  })

  it('shows the enabled action for a disabled server', () => {
    renderSection((instance) => { instance.actions.setData([{ ...SERVER, disabled: true, fiberPhase: null }], STATS) })
    expect(screen.getByText(en.enabled)).toBeDefined()
    expect(screen.getByText(en.disabled)).toBeDefined()
  })

  it('switches a server scope through the injected callback', async () => {
    const { calls } = renderSection(seedCatalog)
    const scope = screen.getAllByRole('combobox')[0] as HTMLSelectElement
    fireEvent.change(scope, { target: { value: 'blocked' } })
    await waitFor(() => { expect(calls.setScope).toHaveBeenCalledWith('e1', 'blocked', undefined, true) })
  })

  it('folds open the tool rules editor and saves parsed rules', async () => {
    const { calls } = renderSection(seedCatalog)
    fireEvent.click(screen.getByText(en.toolRules))
    const rules = screen.getByDisplayValue('delete_repo=deny') as HTMLTextAreaElement
    fireEvent.change(rules, { target: { value: 'del=allow\nbad' } })
    fireEvent.click(screen.getByText(en.saveRules))
    await waitFor(() => {
      expect(calls.setScope).toHaveBeenCalledWith('e1', 'read-only', { del: 'allow' })
    })
  })

  it('removes a server only after confirmation', async () => {
    const { calls } = renderSection(seedCatalog)
    fireEvent.click(screen.getAllByText(en.remove)[0]!)
    expect(screen.getByText(en.confirmRemove)).toBeDefined()
    expect(calls.remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText(en.confirmRemove))
    await waitFor(() => { expect(calls.remove).toHaveBeenCalledWith('e1') })
  })

  it('edits a server through the edit form', async () => {
    const { calls } = renderSection(seedCatalog)
    fireEvent.click(screen.getByText(en.editTitle))
    const name = screen.getByDisplayValue('gh') as HTMLInputElement
    fireEvent.change(name, { target: { value: 'github' } })
    fireEvent.click(screen.getByText(en.save))
    await waitFor(() => {
      expect(calls.edit).toHaveBeenCalledWith('e1', expect.objectContaining({ serverName: 'github' }))
    })
  })

  it('rejects an invalid edit server name', async () => {
    const { calls } = renderSection(seedCatalog)
    fireEvent.click(screen.getByText(en.editTitle))
    const name = screen.getByDisplayValue('gh') as HTMLInputElement
    fireEvent.change(name, { target: { value: 'bad name!' } })
    fireEvent.click(screen.getByText(en.save))
    await waitFor(() => { expect(calls.edit).not.toHaveBeenCalled() })
    expect(screen.getByRole('alert').textContent).toBe(en.formError)
  })

  it('commits a threshold on blur and clears stats', async () => {
    const { calls } = renderSection(seedCatalog)
    const threshold = screen.getByDisplayValue('50') as HTMLInputElement
    fireEvent.change(threshold, { target: { value: '80' } })
    fireEvent.blur(threshold)
    await waitFor(() => { expect(calls.setThreshold).toHaveBeenCalledWith(80) })
    fireEvent.click(screen.getByText(en.clearStats))
    await waitFor(() => { expect(calls.clearStats).toHaveBeenCalledTimes(1) })
  })

  it('ignores a non-finite threshold', async () => {
    const { calls } = renderSection(seedCatalog)
    const threshold = screen.getByDisplayValue('50') as HTMLInputElement
    fireEvent.change(threshold, { target: { value: 'abc' } })
    fireEvent.blur(threshold)
    await waitFor(() => { expect(calls.setThreshold).not.toHaveBeenCalled() })
  })

  it('adds a server through the custom form', async () => {
    const { calls } = renderSection()
    fireEvent.click(screen.getByText(en.addServer))
    fireEvent.click(screen.getByText(en.customTab))
    fireEvent.change(screen.getByLabelText(en.serverName), { target: { value: 'custom' } })
    fireEvent.change(screen.getByLabelText(en.command), { target: { value: 'node' } })
    fireEvent.click(screen.getByText(en.save))
    await waitFor(() => {
      expect(calls.add).toHaveBeenCalledWith(expect.objectContaining({ serverName: 'custom', command: 'node', transport: 'stdio' }))
    })
  })

  it('rejects an invalid custom server name', async () => {
    const { calls } = renderSection()
    fireEvent.click(screen.getByText(en.addServer))
    fireEvent.click(screen.getByText(en.customTab))
    fireEvent.change(screen.getByLabelText(en.serverName), { target: { value: 'bad name!' } })
    fireEvent.click(screen.getByText(en.save))
    await waitFor(() => { expect(calls.add).not.toHaveBeenCalled() })
    expect(screen.getByRole('alert').textContent).toBe(en.formError)
  })

  it('searches npm, picks a preset, and prefills the add form', async () => {
    const { calls } = renderSection(undefined, { npmSearch: vi.fn(async () => [{ name: '@scope/mcp-foo', version: '1.0.0', description: 'D', date: '2020-01-01', publisher: 'p', repository: '', homepage: 'https://x', keywords: ['a'] }]) })
    fireEvent.click(screen.getByText(en.addServer))
    await waitFor(() => { expect(calls.npmSearch).toHaveBeenCalledWith('') })
    expect(screen.getAllByText('@scope/mcp-foo').length).toBeGreaterThan(0)
    fireEvent.change(screen.getByPlaceholderText(en.searchPlaceholder), { target: { value: 'foo' } })
    fireEvent.keyDown(screen.getByPlaceholderText(en.searchPlaceholder), { key: 'Enter' })
    await waitFor(() => { expect(calls.npmSearch).toHaveBeenCalledWith('foo') })
    fireEvent.click(screen.getByText(en.choose))
    expect(screen.getByDisplayValue('mcp-foo')).toBeDefined()
    expect(screen.getByText(en.npxHint)).toBeDefined()
    fireEvent.click(screen.getByText(en.backToSearch))
    expect(screen.getByPlaceholderText(en.searchPlaceholder)).toBeDefined()
  })

  it('falls back to the custom form when a search yields nothing', async () => {
    renderSection(undefined, { npmSearch: vi.fn(async () => []) })
    fireEvent.click(screen.getByText(en.addServer))
    await waitFor(() => { expect(screen.getByText(en.noResults)).toBeDefined() })
    fireEvent.click(screen.getByText(en.tryCustom))
    expect(screen.getByText(en.serverName)).toBeDefined()
  })

  it('surfaces an npm search failure', async () => {
    renderSection(undefined, { npmSearch: vi.fn(async () => { throw new Error('search boom') }) })
    fireEvent.click(screen.getByText(en.addServer))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('search boom') })
  })

  it('cancels the add panel', () => {
    renderSection()
    fireEvent.click(screen.getByText(en.addServer))
    fireEvent.click(screen.getByText(en.customTab))
    fireEvent.click(screen.getAllByText(en.cancel)[0]!)
    expect(screen.queryByText(en.customTab)).toBeNull()
  })

  it('shows a failed add as a banner using the form error fallback', async () => {
    const { calls } = renderSection()
    calls.npmSearch.mockResolvedValueOnce([])
    fireEvent.click(screen.getByText(en.addServer))
    fireEvent.click(screen.getByText(en.customTab))
    calls.add.mockRejectedValueOnce(new Error('add boom'))
    fireEvent.change(screen.getByLabelText(en.serverName), { target: { value: 'good' } })
    fireEvent.click(screen.getByText(en.save))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('add boom') })
  })

  it('shows the HTTP transport fields when toggling transport', () => {
    const { calls } = renderSection()
    fireEvent.click(screen.getByText(en.addServer))
    fireEvent.click(screen.getByText(en.customTab))
    const transport = screen.getByLabelText(en.transport) as HTMLSelectElement
    fireEvent.change(transport, { target: { value: 'streamable-http' } })
    expect(screen.getByLabelText(en.url)).toBeDefined()
    fireEvent.change(screen.getByLabelText(en.url), { target: { value: 'https://x.dev' } })
    fireEvent.click(screen.getByText(en.save))
    expect(calls.add).not.toHaveBeenCalled()
  })

  it('passes env/headers/args for a stdio server', async () => {
    const { calls } = renderSection()
    fireEvent.click(screen.getByText(en.addServer))
    fireEvent.click(screen.getByText(en.customTab))
    fireEvent.change(screen.getByLabelText(en.serverName), { target: { value: 'stdioSrv' } })
    fireEvent.change(screen.getByLabelText(en.args), { target: { value: '-y\nfoo' } })
    fireEvent.change(screen.getByLabelText(en.env), { target: { value: 'A=1\n"B":2' } })
    fireEvent.change(screen.getByLabelText(en.cwd), { target: { value: '/tmp' } })
    fireEvent.click(screen.getByText(en.save))
    await waitFor(() => {
      expect(calls.add).toHaveBeenCalledWith(expect.objectContaining({
        serverName: 'stdioSrv', args: ['-y', 'foo'], env: { A: '1', B: '2' }, cwd: '/tmp',
      }))
    })
  })

  it('renders no stats when the window is empty', () => {
    renderSection()
    expect(screen.getByText(en.noData)).toBeDefined()
  })

  it('marks a stats row whose score reaches the threshold', () => {
    renderSection((instance) => {
      instance.actions.setData([SERVER], { ...STATS, servers: [{ server: 'gh', calls: 1, failures: 0, blocked: 0, authErrors: 0, credArgs: 0, maxKB: 0, avgDurMs: 1, spike: false, score: 60, reasons: ['cred'] }] })
    })
    expect(screen.getByText('gh ⚠')).toBeDefined()
    expect(screen.getAllByText(/60/).length).toBeGreaterThan(0)
  })

  it('renders a failed and an unknown-phase server with blocked/read-write scopes', () => {
    renderSection((instance) => {
      instance.actions.setData([
        { ...SERVER, id: 'a', serverName: 'failed-srv', fiberPhase: 'failed', scope: 'blocked', transport: 'stdio', command: '', tools: [] },
        { ...SERVER, id: 'b', serverName: 'plain-srv', fiberPhase: null, disabled: false, scope: 'read-write', transport: 'stdio', command: 'node', url: undefined },
        { ...SERVER, id: 'c', serverName: 'http-srv', transport: 'streamable-http', url: undefined },
      ], { ...STATS, alerts: [] })
    })
    expect(screen.getAllByText(en.failed).length).toBeGreaterThan(0)
    expect(screen.getAllByText(en.scopeBlocked).length).toBeGreaterThan(0)
    expect(screen.getAllByText(en.active).length).toBeGreaterThan(0)
    expect(screen.getAllByText(en.scopeReadWrite).length).toBeGreaterThan(0)
  })

  it('renders an npm package with no optional metadata', async () => {
    renderSection(undefined, { npmSearch: vi.fn(async () => [{ name: 'minimal', version: '', description: '', date: '', publisher: '', repository: '', homepage: '', keywords: [] }]) })
    fireEvent.click(screen.getByText(en.addServer))
    await waitFor(() => { expect(screen.getAllByText('minimal').length).toBeGreaterThan(0) })
    expect(screen.queryByText(en.repo)).toBeNull()
  })

  it('renders a picked preset with no optional metadata', async () => {
    renderSection(undefined, { npmSearch: vi.fn(async () => [{ name: 'min', version: '', description: '', date: '', publisher: '', repository: '', homepage: '', keywords: [] }]) })
    fireEvent.click(screen.getByText(en.addServer))
    await waitFor(() => { expect(screen.getAllByText('min').length).toBeGreaterThan(0) })
    fireEvent.click(screen.getByText(en.choose))
    expect(screen.getByText(en.npxHint)).toBeDefined()
    expect(screen.queryByText(en.repo)).toBeNull()
  })

  it('toggles the edit form to the http transport', () => {
    renderSection(seedCatalog)
    fireEvent.click(screen.getByText(en.editTitle))
    const transport = screen.getAllByLabelText(en.transport)[0] as HTMLSelectElement
    fireEvent.change(transport, { target: { value: 'streamable-http' } })
    expect(screen.getByLabelText(en.url)).toBeDefined()
    expect(screen.getByLabelText(en.headers)).toBeDefined()
  })

  it('edits and submits an http server', async () => {
    const { calls } = renderSection(seedCatalog)
    fireEvent.click(screen.getByText(en.editTitle))
    const transport = screen.getAllByLabelText(en.transport)[0] as HTMLSelectElement
    fireEvent.change(transport, { target: { value: 'streamable-http' } })
    fireEvent.change(screen.getAllByLabelText(en.url)[0]!, { target: { value: 'https://z.dev' } })
    fireEvent.change(screen.getAllByLabelText(en.headers)[0]!, { target: { value: 'H: 1' } })
    fireEvent.click(screen.getByText(en.save))
    await waitFor(() => {
      expect(calls.edit).toHaveBeenCalledWith('e1', expect.objectContaining({ transport: 'streamable-http', url: 'https://z.dev', headers: { H: '1' } }))
    })
  })

  it('fills and submits a custom http form', async () => {
    const { calls } = renderSection()
    fireEvent.click(screen.getByText(en.addServer))
    fireEvent.click(screen.getByText(en.customTab))
    fireEvent.change(screen.getByLabelText(en.transport), { target: { value: 'streamable-http' } })
    fireEvent.change(screen.getByLabelText(en.serverName), { target: { value: 'httpSrv' } })
    fireEvent.change(screen.getByLabelText(en.url), { target: { value: 'https://y.dev' } })
    fireEvent.change(screen.getByLabelText(en.headers), { target: { value: 'X: 1' } })
    fireEvent.change(screen.getByLabelText(en.scope), { target: { value: 'blocked' } })
    fireEvent.change(screen.getByLabelText(en.timeout), { target: { value: 'abc' } })
    fireEvent.click(screen.getByLabelText(en.failOnStartup))
    fireEvent.click(screen.getByText(en.save))
    await waitFor(() => {
      expect(calls.add).toHaveBeenCalledWith(expect.objectContaining({ transport: 'streamable-http', url: 'https://y.dev', headers: { X: '1' }, scope: 'blocked' }))
    })
  })

  it('triggers a search from the search button', async () => {
    const { calls } = renderSection(undefined, { npmSearch: vi.fn(async () => []) })
    fireEvent.click(screen.getByText(en.addServer))
    await waitFor(() => { expect(calls.npmSearch).toHaveBeenCalledWith('') })
    fireEvent.change(screen.getByPlaceholderText(en.searchPlaceholder), { target: { value: 'q' } })
    fireEvent.click(screen.getByText(en.searchBtn))
    await waitFor(() => { expect(calls.npmSearch).toHaveBeenCalledWith('q') })
  })

  it('falls back to formError when a mutation rejects with a falsy string', async () => {
    const { calls } = renderSection()
    calls.add.mockRejectedValueOnce('')
    fireEvent.click(screen.getByText(en.addServer))
    fireEvent.click(screen.getByText(en.customTab))
    fireEvent.change(screen.getByLabelText(en.serverName), { target: { value: 'good' } })
    fireEvent.click(screen.getByText(en.save))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(en.formError) })
  })

  it('surfaces a non-Error npm search failure', async () => {
    renderSection(undefined, { npmSearch: vi.fn(async () => { throw 'boom' }) })
    fireEvent.click(screen.getByText(en.addServer))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('boom') })
  })

  it('ignores a non-Enter key in the search input', async () => {
    const { calls } = renderSection(undefined, { npmSearch: vi.fn(async () => []) })
    fireEvent.click(screen.getByText(en.addServer))
    await waitFor(() => { expect(calls.npmSearch).toHaveBeenCalledWith('') })
    const before = calls.npmSearch.mock.calls.length
    fireEvent.keyDown(screen.getByPlaceholderText(en.searchPlaceholder), { key: 'Tab' })
    expect(calls.npmSearch.mock.calls.length).toBe(before)
  })

  it('edits a minimal server and fills every stdio field', async () => {
    const { calls } = renderSection((instance) => {
      instance.actions.setData([
        { ...SERVER, id: 'min', serverName: 'min', url: undefined, args: undefined as unknown as string[], toolCallTimeoutMs: undefined, failOnStartupError: false, scope: 'read-write', toolRules: {} },
      ], { ...STATS, alerts: [] })
    })
    fireEvent.click(screen.getByText(en.editTitle))
    const transport = screen.getAllByLabelText(en.transport)[0] as HTMLSelectElement
    fireEvent.change(transport, { target: { value: 'stdio' } })
    fireEvent.change(screen.getAllByLabelText(en.command)[0]!, { target: { value: 'node' } })
    fireEvent.change(screen.getAllByLabelText(en.args)[0]!, { target: { value: 'x\ny' } })
    fireEvent.change(screen.getAllByLabelText(en.env)[0]!, { target: { value: 'A=1' } })
    fireEvent.change(screen.getAllByLabelText(en.cwd)[0]!, { target: { value: '/t' } })
    fireEvent.click(screen.getAllByLabelText(en.failOnStartup)[0]!)
    fireEvent.change(screen.getAllByLabelText(en.timeout)[0]!, { target: { value: '42' } })
    fireEvent.change(screen.getAllByLabelText(en.scope)[0]!, { target: { value: 'blocked' } })
    fireEvent.change(screen.getAllByLabelText(en.toolRules)[0]!, { target: { value: 'a=deny' } })
    fireEvent.click(screen.getByText(en.save))
    await waitFor(() => {
      expect(calls.edit).toHaveBeenCalledWith('min', expect.objectContaining({
        transport: 'stdio', command: 'node', args: ['x', 'y'], env: { A: '1' }, cwd: '/t', toolCallTimeoutMs: 42, failOnStartupError: true, toolRules: { a: 'deny' }, scope: 'blocked',
      }))
    })
  })

  it('edits the custom tool-rules text', async () => {
    const { calls } = renderSection()
    fireEvent.click(screen.getByText(en.addServer))
    fireEvent.click(screen.getByText(en.customTab))
    fireEvent.change(screen.getByLabelText(en.toolRules), { target: { value: 'a=deny' } })
    fireEvent.change(screen.getByLabelText(en.serverName), { target: { value: 'good' } })
    fireEvent.click(screen.getByText(en.save))
    await waitFor(() => { expect(calls.add).toHaveBeenCalledWith(expect.objectContaining({ toolRules: { a: 'deny' } })) })
  })

  it('switches back to the search tab from the custom tab', () => {
    renderSection()
    fireEvent.click(screen.getByText(en.addServer))
    fireEvent.click(screen.getByText(en.customTab))
    fireEvent.click(screen.getByText(en.searchTab))
    expect(screen.getByPlaceholderText(en.searchPlaceholder)).toBeDefined()
  })

  it('surfaces a rejected mutation as an Error message', async () => {
    const { calls } = renderSection(seedCatalog)
    calls.remove.mockRejectedValueOnce(new Error('boom'))
    fireEvent.click(screen.getAllByText(en.remove)[0]!)
    fireEvent.click(screen.getByText(en.confirmRemove))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('boom') })
  })

  it('edit falls back to formError on a falsy rejection', async () => {
    const { calls } = renderSection(seedCatalog)
    calls.edit.mockRejectedValueOnce('')
    fireEvent.click(screen.getByText(en.editTitle))
    fireEvent.click(screen.getByText(en.save))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(en.formError) })
  })

  it('surfaces an Error rejection from the edit form', async () => {
    const { calls } = renderSection(seedCatalog)
    calls.edit.mockRejectedValueOnce(new Error('edit boom'))
    fireEvent.click(screen.getByText(en.editTitle))
    fireEvent.click(screen.getByText(en.save))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('edit boom') })
  })
})
