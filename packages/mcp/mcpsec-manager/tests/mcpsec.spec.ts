import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Entry } from '@deepseek-ai/cordis-plugin-loader'
import type { PreToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { apply, classifyTool, gateReason, hasCredential, parseMcpName } from '../src/index.ts'

describe('parseMcpName', () => {
  it('parses an MCP tool name and rejects others', () => {
    expect(parseMcpName('mcp__github__list_issues')).toEqual({ server: 'github', tool: 'list_issues' })
    expect(parseMcpName('not mcp')).toBeNull()
    expect(parseMcpName(42)).toBeNull()
  })
})

describe('classifyTool', () => {
  it('classifies read, write, and unknown tool names', () => {
    expect(classifyTool('get_issue')).toBe('read')
    expect(classifyTool('create_issue')).toBe('write')
    expect(classifyTool('weirdop')).toBe('unknown')
    expect(classifyTool(undefined)).toBe('unknown')
  })
})

describe('hasCredential', () => {
  it('detects credential-looking values and ignores plain args', () => {
    expect(hasCredential({ authorization: 'Bearer abcdef1234567890' })).toBe(true)
    expect(hasCredential({ api_key: 'sk-abc123' })).toBe(true)
    expect(hasCredential({ title: 'hello world' })).toBe(false)
  })

  it('treats a stringify-throwing payload as non-credential', () => {
    expect(hasCredential({ big: BigInt(1) })).toBe(false)
  })
})

describe('gateReason', () => {
  const base = { scope: 'read-write', toolRules: {}, serverName: 'gh' }
  it('denies an explicit deny rule', () => {
    const reason = gateReason({ ...base, toolRules: { delete_repo: 'deny' } }, 'delete_repo')
    expect(reason).toMatch(/explicitly denied/)
  })
  it('denies everything on a blocked scope', () => {
    expect(gateReason({ ...base, scope: 'blocked' }, 'read_thing')).toMatch(/blocked/)
  })
  it('denies a write-capable tool on a read-only scope', () => {
    expect(gateReason({ ...base, scope: 'read-only' }, 'create_thing')).toMatch(/read-only/)
  })
  it('allows a read tool on a read-only scope and an allow rule', () => {
    expect(gateReason({ ...base, scope: 'read-only' }, 'get_thing')).toBeUndefined()
    expect(gateReason({ ...base, scope: 'read-only', toolRules: { create_thing: 'allow' } }, 'create_thing')).toBeUndefined()
  })
  it('denies an explicit write rule and allows an explicit read rule on read-only', () => {
    expect(gateReason({ ...base, scope: 'read-only', toolRules: { create_thing: 'write' } }, 'create_thing')).toMatch(/read-only/)
    expect(gateReason({ ...base, scope: 'read-only', toolRules: { thing: 'read' } }, 'thing')).toBeUndefined()
  })
  it('allows on read-write and on no policy', () => {
    expect(gateReason(base, 'create_thing')).toBeUndefined()
    expect(gateReason(undefined, 'create_thing')).toBeUndefined()
  })
})

describe('apply wiring', () => {
  const entry = (cfg: Record<string, unknown>, extra: Partial<Entry> = {}): Entry => ({
    id: 'e1',
    options: { id: 'e1', name: '@deepseek-ai/dsh-mcp-client', config: cfg },
    disabled: false,
    ...extra,
  } as unknown as Entry)

  function setup(
    entries: Entry[] = [entry({ serverName: 'gh', transport: 'streamable-http', url: 'https://api.github.com' })],
    schemas: Array<{ name: string }> = [{ name: 'mcp__gh__get_issue' }, { name: 'mcp__gh__create_issue' }],
  ) {
    const ctx = new Context()
    const rpcHandle = vi.fn()
    const create = vi.fn(async (_entry?: unknown) => 'new-id')
    const update = vi.fn(async () => {})
    const remove = vi.fn(async () => {})
    ctx.provide('loader', {
      entries: () => entries,
      create,
      update,
      remove,
    } as never)
    ctx.provide('tools', {
      schemas: () => schemas,
    } as never)
    ctx.provide('connection', {
      rpc: { handle: rpcHandle },
    } as never)
    apply(ctx)
    const handler = rpcHandle.mock.calls[0]?.[1] as (endpoint: string, payload: unknown) => Promise<unknown>
    const preExecute = (exec: ToolExecution, next: () => Promise<PreToolDecision>) => ctx.waterfall('tools/pre-execute', exec, next)
    const toolResult = (exec: ToolExecution, result: ToolExecutionResult): void => { ctx.emit('tools/result', exec, result) }
    return { ctx, entries, preExecute, toolResult, handler, create, update, remove }
  }

  const mkExec = (name: string, args: Record<string, unknown> = {}): ToolExecution =>
    ({ name, token: Symbol('t'), arguments: args } as unknown as ToolExecution)
  const errResult = (message: string): ToolExecutionResult =>
    ({ isError: true, error: { message } } as unknown as ToolExecutionResult)

  it('denies a write-capable MCP tool on a read-only scope', async () => {
    const s = setup([entry({ serverName: 'gh', mcpSecurity: { scope: 'read-only' } })])
    const exec = mkExec('mcp__gh__create_issue')
    const decision = await s.preExecute(exec, async () => ({ kind: 'allow' } as unknown as PreToolDecision))
    expect(decision).toMatchObject({ kind: 'deny' })
  })

  it('passes a read MCP tool through on a read-only scope', async () => {
    const s = setup([entry({ serverName: 'gh', mcpSecurity: { scope: 'read-only' } })])
    const next = vi.fn(async () => ({ kind: 'allow' } as unknown as PreToolDecision))
    const decision = await s.preExecute(mkExec('mcp__gh__get_issue'), next)
    expect(decision).toMatchObject({ kind: 'allow' })
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('passes a non-MCP tool through unchanged', async () => {
    const s = setup()
    const next = vi.fn(async () => ({ kind: 'allow' } as unknown as PreToolDecision))
    await s.preExecute(mkExec('bash'), next)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('records call usage and scores an alert when the threshold is crossed', async () => {
    const s = setup()
    const exec = mkExec('mcp__gh__get_issue', { authorization: 'Bearer abcdef1234567890' })
    s.toolResult(exec, errResult('401 unauthorized'))
    s.toolResult(exec, errResult('403 forbidden'))
    const stats = await s.handler('stats', {})
    const value = stats as { ok: true; value: { servers: Array<{ server: string; score: number }>; alerts: unknown[] } }
    expect(value.value.servers[0]?.server).toBe('gh')
    expect(value.value.servers[0]?.score).toBeGreaterThanOrEqual(50)
    expect(value.value.alerts.length).toBeGreaterThan(0)
  })

  it('lists servers and handles npmSearch', async () => {
    const s = setup()
    const list = await s.handler('list', {})
    expect((list as { value: { servers: unknown[] } }).value.servers).toHaveLength(1)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ objects: [{ package: { name: 'mcp-server-foo', version: '1.0.0', description: 'd', date: '2020-01-01', links: {}, publisher: { username: 'u' }, keywords: ['k'] } }] }) }) as unknown as Response))
    const search = await s.handler('npmSearch', { query: 'foo' })
    expect((search as { ok: true; value: { packages: unknown[] } }).value.packages).toHaveLength(1)
    vi.unstubAllGlobals()
  })

  it('adds, sets scope/enabled, removes, and clears stats', async () => {
    const { handler, create, update, remove } = setup()
    const created = await handler('add', { serverName: 'new', transport: 'stdio', command: 'node' })
    expect(created).toMatchObject({ ok: true, value: { id: 'new-id' } })
    expect(create).toHaveBeenCalled()
    await handler('setScope', { id: 'e1', scope: 'blocked' })
    expect(update).toHaveBeenCalled()
    await handler('setEnabled', { id: 'e1', enabled: false })
    await handler('remove', { id: 'e1' })
    expect(remove).toHaveBeenCalled()
    const cleared = await handler('clearStats', {})
    expect(cleared).toMatchObject({ ok: true, value: { cleared: true } })
  })

  it('rejects invalid add inputs and reports a missing server', async () => {
    const { handler } = setup()
    const badName = await handler('add', { serverName: 'bad name!', transport: 'stdio', command: 'node' })
    expect(badName).toMatchObject({ ok: false })
    const dup = await handler('add', { serverName: 'gh', transport: 'stdio', command: 'node' })
    expect(dup).toMatchObject({ ok: false })
    const noUrl = await handler('add', { serverName: 'x', transport: 'streamable-http' })
    expect(noUrl).toMatchObject({ ok: false })
    const noCmd = await handler('add', { serverName: 'y', transport: 'stdio' })
    expect(noCmd).toMatchObject({ ok: false })
    const missing = await handler('remove', { id: 'nope' })
    expect(missing).toMatchObject({ ok: false })
    const missScope = await handler('setScope', { id: 'nope', scope: 'read-only' })
    expect(missScope).toMatchObject({ ok: false })
    const missEnabled = await handler('setEnabled', { id: 'nope', enabled: true })
    expect(missEnabled).toMatchObject({ ok: false })
  })

  it('sets a valid or rejected threshold and handles unknown endpoints', async () => {
    const { handler } = setup()
    const ok = await handler('setThreshold', { threshold: 90 })
    expect(ok).toMatchObject({ ok: true, value: { threshold: 90 } })
    const bad = await handler('setThreshold', { threshold: 999 })
    expect(bad).toMatchObject({ ok: false })
    const unknown = await handler('nope', {})
    expect(unknown).toMatchObject({ ok: false })
  })

  it('returns npm search failure and rejection paths', async () => {
    const { handler } = setup()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response))
    const http = await handler('npmSearch', { query: 'x' })
    expect(http).toMatchObject({ ok: false })
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network'))))
    const threw = await handler('npmSearch', { query: 'x' })
    expect(threw).toMatchObject({ ok: false })
    vi.unstubAllGlobals()
  })

  it('scores a spike/payload/failure server', async () => {
    const s = setup()
    for (let i = 0; i < 6; i++) s.toolResult(mkExec('mcp__gh__get_issue'), errResult('boom'))
    const stats = await s.handler('stats', {})
    const value = stats as { ok: true; value: { servers: Array<{ score: number; reasons: string[] }> } }
    expect(value.value.servers[0]?.score).toBeGreaterThanOrEqual(20)
    expect(value.value.servers[0]?.reasons).toContain('fail')
  })

  it('edits a server across stdio/HTTP and rejects invalid edits', async () => {
    const { handler, update } = setup()
    const edited = await handler('edit', { id: 'e1', scope: 'blocked', toolRules: { x: 'deny' } })
    expect(edited).toMatchObject({ ok: true, value: { serverName: 'gh' } })
    expect(update).toHaveBeenCalled()
    const stdio = await handler('edit', { id: 'e1', transport: 'stdio', command: 'node' })
    expect(stdio).toMatchObject({ ok: true })
    const http = await handler('edit', { id: 'e1', transport: 'streamable-http', url: 'https://x.dev' })
    expect(http).toMatchObject({ ok: true })
    const badName = await handler('edit', { id: 'e1', serverName: 'bad name!' })
    expect(badName).toMatchObject({ ok: false })
    const missing = await handler('edit', { id: 'nope', serverName: 'x' })
    expect(missing).toMatchObject({ ok: false })
    const badCwd = await handler('edit', { id: 'e1', transport: 'stdio', cwd: '' })
    expect(badCwd).toMatchObject({ ok: true })
  })

  it('lists servers with varied config fields', async () => {
    const s = setup([
      entry({ serverName: 'gh', transport: 'streamable-http', url: 'https://api.github.com?q=1#frag', env: { A: '1', B: '2' }, headers: { H: 'x' }, args: ['a'], cwd: '/tmp', toolCallTimeoutMs: 5000, failOnStartupError: true }, { fiber: { state: 2 } } as unknown as Partial<Entry>),
      entry({ transport: 'stdio', command: 'node' }),
    ])
    const list = await s.handler('list', {})
    const value = list as { ok: true; value: { servers: Array<Record<string, unknown>> } }
    const gh = value.value.servers.find(sv => sv.serverName === 'gh')
    const noName = value.value.servers.find(sv => sv.serverName === '')
    expect(gh?.url).toBe('https://api.github.com')
    expect(gh?.envCount).toBe(2)
    expect(gh?.headersCount).toBe(1)
    expect(gh?.fiberPhase).toBe('active')
    expect(gh?.tools).toEqual(['get_issue', 'create_issue'])
    expect(noName?.fiberPhase).toBeNull()
    expect(noName?.transport).toBe('stdio')
    expect(noName?.tools).toEqual([])
  })

  it('adds a stdio server with env/args/cwd/timeout/failOnStartup and normalizes rules', async () => {
    const { handler, create } = setup()
    const res = await handler('add', {
      serverName: 'srv', transport: 'stdio', command: 'node', args: ['-v', '--x'],
      env: { A: '1' }, cwd: '/tmp', toolCallTimeoutMs: 5000, failOnStartupError: true,
      scope: 'read-only', toolRules: { a: 'allow', b: 'nope', c: 'deny' },
    })
    expect(res).toMatchObject({ ok: true })
    const payload = create.mock.calls[0]?.[0] as { config: Record<string, unknown> }
    expect(payload.config).toMatchObject({ env: { A: '1' }, cwd: '/tmp', toolCallTimeoutMs: 5000, failOnStartupError: true })
    expect(payload.config.mcpSecurity).toMatchObject({ toolRules: { a: 'allow', c: 'deny' } })
  })

  it('skips invalid add env/headers, array toolRules, and non-positive timeout', async () => {
    const { handler } = setup()
    const stdio = await handler('add', { serverName: 's1', transport: 'stdio', command: 'n', env: { A: 1 }, args: 'not-array', toolCallTimeoutMs: 0, toolRules: ['bad'] })
    expect(stdio).toMatchObject({ ok: true })
    const http = await handler('add', { serverName: 's2', transport: 'streamable-http', url: 'https://x.dev', headers: ['bad'] })
    expect(http).toMatchObject({ ok: true })
  })

  it('edits transport modes and deletes cwd/env/headers', async () => {
    const { handler, update } = setup()
    await handler('edit', { id: 'e1', transport: 'stdio', command: 'node', cwd: '/x', env: { B: '2' }, toolCallTimeoutMs: 10, failOnStartupError: false })
    expect(update).toHaveBeenCalled()
    await handler('edit', { id: 'e1', transport: 'stdio', env: ['bad'], cwd: '' })
    await handler('edit', { id: 'e1', transport: 'streamable-http', url: 'https://y.dev', headers: { K: 'v' } })
    expect(update).toHaveBeenCalledTimes(3)
  })

  it('setScope merges or replaces toolRules and falls back the scope', async () => {
    const { handler, update } = setup()
    await handler('setScope', { id: 'e1', scope: 'read-only', toolRules: { a: 'allow' }, mergeRules: true })
    await handler('setScope', { id: 'e1', scope: 'weird', toolRules: { b: 'deny' } })
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('maps npm search objects with varied fallback shapes', async () => {
    const s = setup()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ objects: [
      { package: null },
      { package: { name: 'foo', version: 1, description: null, date: 2, links: { repository: 'r', homepage: 'h' }, publisher: null, keywords: ['k', 7, 'j'] } },
    ] }) }) as unknown as Response))
    const search = await s.handler('npmSearch', {})
    const value = search as { ok: true; value: { packages: Array<Record<string, unknown>> } }
    expect(value.value.packages).toHaveLength(1)
    expect(value.value.packages[0]).toMatchObject({ name: 'foo', version: '', description: '', date: '', publisher: '', repository: 'r', homepage: 'h', keywords: ['k', 'j'] })
    vi.unstubAllGlobals()
  })

  it('returns empty packages and clamps npm search limit/query', async () => {
    const s = setup()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ objects: [{ package: { name: '', version: '1' } }] }) }) as unknown as Response))
    await s.handler('npmSearch', { query: '  ', limit: 999 })
    const search = await s.handler('npmSearch', { query: 'x', limit: -5 })
    const value = search as { ok: true; value: { packages: unknown[] } }
    expect(value.value.packages).toEqual([])
    vi.unstubAllGlobals()
  })

  it('ignores a non-MCP tool result and an error with no message', async () => {
    const s = setup()
    s.toolResult(mkExec('bash', {}), { isError: false } as unknown as ToolExecutionResult)
    s.toolResult(mkExec('mcp__gh__get_issue', {}), errResult('401 unauthorized'))
    s.toolResult(mkExec('mcp__gh__get_issue', {}), { isError: true } as unknown as ToolExecutionResult)
    const stats = await s.handler('stats', {})
    expect(stats).toMatchObject({ ok: true })
  })

  it('passes a tool through unchanged when its server has no entry', async () => {
    const s = setup()
    const next = vi.fn(async () => ({ kind: 'allow' } as unknown as PreToolDecision))
    const decision = await s.preExecute(mkExec('mcp__nowhere__read'), next)
    expect(decision).toMatchObject({ kind: 'allow' })
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('reports loader failures with varied error shapes', async () => {
    const s = setup()
    s.create.mockRejectedValueOnce(new Error('create boom'))
    expect(await s.handler('add', { serverName: 'e1-err', transport: 'stdio', command: 'n' })).toMatchObject({ ok: false })
    s.create.mockRejectedValueOnce({ message: 'object boom' })
    expect(await s.handler('add', { serverName: 'e2-err', transport: 'stdio', command: 'n' })).toMatchObject({ ok: false })
    s.update.mockRejectedValueOnce('string boom')
    expect(await s.handler('setScope', { id: 'e1', scope: 'blocked' })).toMatchObject({ ok: false })
    s.update.mockRejectedValueOnce(null)
    expect(await s.handler('setEnabled', { id: 'e1', enabled: false })).toMatchObject({ ok: false })
  })

  it('scores cred/auth/fail/spike/payload/block across servers', async () => {
    const s = setup([
      entry({ serverName: 'gh', transport: 'streamable-http', url: 'https://x' }),
      entry({ serverName: 'g2', mcpSecurity: { scope: 'blocked' } }),
    ])
    for (let i = 0; i < 3; i++) await s.preExecute(mkExec('mcp__g2__read'), async () => ({ kind: 'allow' } as unknown as PreToolDecision))
    for (let i = 0; i < 8; i++) s.toolResult(mkExec('mcp__gh__get_issue', { api_key: 'abcdefghijklmnopqrst' }), errResult('401 unauthorized'))
    s.toolResult(mkExec('mcp__gh__get_issue', { blob: 'x'.repeat(70000) }), errResult('boom'))
    const stats = await s.handler('stats', {})
    const value = stats as { ok: true; value: { servers: Array<{ score: number; reasons: string[] }>; alerts: unknown[] } }
    const allReasons = value.value.servers.flatMap(sv => sv.reasons)
    expect(allReasons).toEqual(expect.arrayContaining(['cred', 'auth', 'fail', 'spike', 'payload', 'block']))
    expect(value.value.alerts.length).toBeGreaterThan(0)
  })

  it('computes a zero rate and no flags for a fully-successful server', async () => {
    const s = setup()
    s.toolResult(mkExec('mcp__gh__get_issue', {}), { isError: false, value: {} } as unknown as ToolExecutionResult)
    const stats = await s.handler('stats', {})
    const value = stats as { ok: true; value: { servers: Array<{ failures: number; score: number; reasons: string[] }> } }
    expect(value.value.servers[0]).toMatchObject({ failures: 0, score: 0, reasons: [] })
  })

  it('handles empty/absent args across handlers', async () => {
    const { handler } = setup()
    expect(await handler('add', null)).toMatchObject({ ok: false })
    expect(await handler('remove', {})).toMatchObject({ ok: false })
    expect(await handler('setEnabled', {})).toMatchObject({ ok: false })
    expect(await handler('setEnabled', { id: 'e1', enabled: true })).toMatchObject({ ok: true, value: { enabled: true } })
  })

  it('adds an http server with valid headers', async () => {
    const { handler } = setup()
    const res = await handler('add', { serverName: 'h', transport: 'streamable-http', url: 'https://h.dev', headers: { K: 'v' } })
    expect(res).toMatchObject({ ok: true })
  })

  it('edits mixed transport fields and clears stale ones', async () => {
    const { handler, update } = setup()
    await handler('edit', { id: 'e1', transport: 'streamable-http', url: 'https://z.dev', headers: { A: 'b' } })
    await handler('edit', { id: 'e1', serverName: 'gh2', toolCallTimeoutMs: -1 })
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('flags two alerts and sorts them after a low threshold', async () => {
    const s = setup([
      entry({ serverName: 'gh', transport: 'streamable-http', url: 'https://x' }),
      entry({ serverName: 'g2', mcpSecurity: { scope: 'blocked' } }),
    ])
    for (let i = 0; i < 3; i++) await s.preExecute(mkExec('mcp__g2__read'), async () => ({ kind: 'allow' } as unknown as PreToolDecision))
    s.toolResult(mkExec('mcp__gh__get_issue', {}), errResult('401 unauthorized'))
    s.toolResult(mkExec('mcp__gh__get_issue', {}), errResult('401 unauthorized'))
    await s.handler('setThreshold', { threshold: 10 })
    const stats = await s.handler('stats', {})
    const value = stats as { ok: true; value: { alerts: unknown[] } }
    expect(value.value.alerts.length).toBe(2)
  })

  it('lists servers with varied shapes and skips non-MCP entries', async () => {
    const s = setup([
      entry({ serverName: 'gh', transport: 'stdio', command: 'node', args: ['-v'], cwd: '/tmp', env: { E: '1' }, headers: { H: '2' }, url: 'https://x?q', mcpSecurity: { scope: 'read-only', toolRules: { a: 'deny' } } }),
      entry({ mcpSecurity: { toolRules: ['a'] as unknown as Record<string, string> } }),
      entry(undefined as unknown as Record<string, unknown>),
      entry({ serverName: 'other' }, { options: { id: 'o', name: 'not-mcp', config: { serverName: 'other' } } }),
    ], [{ name: 'mcp__gh__get_issue' }, { name: 'not-mcp' }, { name: 'mcp__other__x' }])
    const list = await s.handler('list', {})
    const value = list as { ok: true; value: { servers: Array<Record<string, unknown>> } }
    const gh = value.value.servers.find(sv => sv.serverName === 'gh')
    expect(gh?.transport).toBe('stdio')
    expect(gh?.command).toBe('node')
    expect(gh?.args).toEqual(['-v'])
    expect(gh?.envCount).toBe(1)
    expect(gh?.headersCount).toBe(1)
    expect(gh?.scope).toBe('read-only')
    expect(gh?.toolRules).toEqual({ a: 'deny' })
    expect(gh?.tools).toEqual(['get_issue'])
    expect(value.value.servers.some(sv => sv.serverName === 'other')).toBe(false)
    expect(value.value.servers.some(sv => sv.serverName === '')).toBe(true)
  })

  it('trims the event window past MAX_EVENTS', async () => {
    const s = setup()
    for (let i = 0; i < 2001; i++) s.toolResult(mkExec('mcp__gh__get_issue'), { isError: false, value: {} } as unknown as ToolExecutionResult)
    const stats = await s.handler('stats', {})
    const serversMatcher = expect.any(Array) as unknown as unknown[]
    const expected = { ok: true, value: { servers: serversMatcher } }
    expect(stats).toMatchObject(expected)
  })

  it('measures a duration across a pre-execute/result pair', async () => {
    const s = setup()
    const exec = mkExec('mcp__gh__get_issue')
    await s.preExecute(exec, async () => ({ kind: 'allow' } as unknown as PreToolDecision))
    s.toolResult(exec, { isError: false, value: {} } as unknown as ToolExecutionResult)
    const stats = await s.handler('stats', {})
    const value = stats as { ok: true; value: { servers: Array<{ avgDurMs: number }> } }
    expect(value.value.servers[0]?.avgDurMs).toBeGreaterThanOrEqual(0)
  })

  it('handles null args across npmSearch/setScope/setEnabled/edit', async () => {
    const s = setup()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ objects: [] }) }) as unknown as Response))
    expect(await s.handler('npmSearch', null)).toMatchObject({ ok: true })
    vi.unstubAllGlobals()
    expect(await s.handler('setScope', null)).toMatchObject({ ok: false })
    expect(await s.handler('setEnabled', null)).toMatchObject({ ok: false })
    expect(await s.handler('edit', null)).toMatchObject({ ok: false })
  })

  it('reports remove failures', async () => {
    const s = setup()
    s.remove.mockRejectedValueOnce(new Error('remove boom'))
    expect(await s.handler('remove', { id: 'e1' })).toMatchObject({ ok: false })
  })

  it('skips events outside the usage window', async () => {
    vi.useFakeTimers()
    try {
      const s = setup()
      vi.setSystemTime(new Date('2000-01-01'))
      s.toolResult(mkExec('mcp__gh__get_issue', {}), { isError: false, value: {} } as unknown as ToolExecutionResult)
      vi.setSystemTime(new Date('2100-01-01'))
      const stats = await s.handler('stats', {})
      const value = stats as { ok: true; value: { servers: unknown[] } }
      expect(value.value.servers).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('counts an event as outside the spark window but inside the usage window', async () => {
    vi.useFakeTimers()
    try {
      const s = setup()
      vi.setSystemTime(new Date('2000-01-01'))
      s.toolResult(mkExec('mcp__gh__get_issue', {}), { isError: false, value: {} } as unknown as ToolExecutionResult)
      vi.setSystemTime(new Date('2000-01-01T00:03:00'))
      const stats = await s.handler('stats', {})
      const value = stats as { ok: true; value: { servers: Array<{ calls: number; spike: boolean }> } }
      expect(value.value.servers[0]).toMatchObject({ calls: 1, spike: false })
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns no packages when the npm response has no objects array', async () => {
    const s = setup()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ objects: 'nope' }) }) as unknown as Response))
    const search = await s.handler('npmSearch', { query: 'x' })
    const value = search as { ok: true; value: { packages: unknown[] } }
    expect(value.value.packages).toEqual([])
    vi.unstubAllGlobals()
  })

  it('setScope normalizes a non-object config and merges over existing rules', async () => {
    const MCP = '@deepseek-ai/dsh-mcp-client'
    const s = setup([
      entry({ serverName: 'gh', mcpSecurity: { scope: 'read-only', toolRules: { old: 'deny' } } }),
      entry({}, { options: { id: 's1', name: MCP, config: 'non-object' } }),
    ])
    await s.handler('setScope', { id: 'e1', scope: 'blocked', toolRules: { a: 'allow' }, mergeRules: true })
    await s.handler('setScope', { id: 's1', scope: 'weird', toolRules: { b: 'deny' } })
    expect(s.update).toHaveBeenCalledTimes(2)
  })

  it('edits a non-object config base, rejects a duplicate name, and clears fields', async () => {
    const MCP = '@deepseek-ai/dsh-mcp-client'
    const s = setup([
      entry({ serverName: 'gh', mcpSecurity: { scope: 'read-only', toolRules: {} } }),
      entry({ serverName: 'dup' }, { options: { id: 'd', name: MCP, config: { serverName: 'dup' } } }),
      entry({}, { options: { id: 's1', name: MCP, config: 'non-object' } }),
    ])
    expect(await s.handler('edit', { id: 'e1', serverName: 'dup' })).toMatchObject({ ok: false })
    await s.handler('edit', { id: 's1', scope: 'weird', args: 'string' })
    await s.handler('edit', { id: 'e1', transport: 'streamable-http', headers: 42 })
    await s.handler('edit', { id: 'e1', transport: 'stdio', args: ['a'], toolRules: { t: 'allow' }, failOnStartupError: true, toolCallTimeoutMs: 3 })
    expect(s.update).toHaveBeenCalledTimes(3)
  })

  it('reports edit failures', async () => {
    const s = setup()
    s.update.mockRejectedValueOnce(new Error('edit boom'))
    expect(await s.handler('edit', { id: 'e1', scope: 'blocked' })).toMatchObject({ ok: false })
  })

  it('resolves an object tool-rules policy through the pre-execute gate', async () => {
    const s = setup([entry({ serverName: 'gh', mcpSecurity: { scope: 'read-only', toolRules: { thing: 'allow' } } })])
    const next = vi.fn(async () => ({ kind: 'allow' } as unknown as PreToolDecision))
    const decision = await s.preExecute(mkExec('mcp__gh__thing'), next)
    expect(decision).toMatchObject({ kind: 'allow' })
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('clears stdio args that are not an array', async () => {
    const s = setup()
    await s.handler('edit', { id: 'e1', transport: 'stdio', args: 'not-array' })
    expect(s.update).toHaveBeenCalled()
  })
})
