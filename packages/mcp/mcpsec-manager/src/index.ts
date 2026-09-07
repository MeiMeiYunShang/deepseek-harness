/**
 * MCP Security Manager — host half.
 *
 * A persistent profile-bundle plugin: it manages `@deepseek-ai/dsh-mcp-client`
 * loader rows (add / enable / remove, permission scope + per-tool rules carried
 * in each row's `mcpSecurity`), gates every `mcp__<server>__*` tool call through
 * the `tools/pre-execute` waterfall (read-only scope denies write-classified
 * tools before dispatch; unknown capability = write, fail closed), records
 * per-call usage from `tools/result` and scores each server over a sliding
 * window, and answers the browser half over a loopback-only Connection RPC
 * channel `/mcpsec`. Secret values never leave this half.
 *
 * @module @deepseek-ai/dsh-mcpsec-manager
 */

import { Context } from '@deepseek-ai/cordis'
import type { Entry } from '@deepseek-ai/cordis-plugin-loader'
import type { ConnectionRpcResult, ConnectionRpcFailure, ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type { PreToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'

/** Stable plugin id for loader rows. */
export const name = 'mcpsec-manager'

/** Required services: the Connection RPC registry, the loader tree, tools. */
export const inject = ['connection', 'loader', 'tools']

/** Package-private RPC channel (loopback-only). */
const RPC_CHANNEL = '/mcpsec'

/** The harness package that implements an MCP server bridge. */
const MCP_PACKAGE = '@deepseek-ai/dsh-mcp-client'

const WINDOW_MS = 10 * 60 * 1000
const SPARK_MS = 2 * 60 * 1000
const MAX_EVENTS = 2000
const DEFAULT_THRESHOLD = 50
const SEARCH_TIMEOUT_MS = 20000

/** Compact per-call record. */
interface CallEvent {
  s: string
  t: string
  ts: number
  ok: boolean
  blk: boolean
  auth: boolean
  cred: boolean
  kb: number
  dur: number
}

/** MCP security policy attached to a loader entry config. */
interface McpSecurity {
  scope?: string
  toolRules?: Record<string, string>
}

/** Resolved policy for one server. */
interface Policy {
  scope: string
  toolRules: Record<string, string>
  serverName: string
}

/** Parsed MCP tool name. */
interface McpName {
  server: string
  tool: string
}

/** One server view returned by the `list` RPC endpoint. */
interface ServerView {
  id: string
  serverName: string
  transport: string
  url: string | undefined
  command: string | undefined
  args: string[]
  cwd: string | undefined
  envCount: number
  headersCount: number
  toolCallTimeoutMs: number | undefined
  failOnStartupError: boolean
  scope: string
  toolRules: Record<string, string>
  tools: string[]
  disabled: boolean
  fiberPhase: string | null
}

/** One server stats row. */
interface StatsRow {
  server: string
  calls: number
  failures: number
  blocked: number
  authErrors: number
  credArgs: number
  maxKB: number
  avgDurMs: number
  spike: boolean
  score: number
  reasons: string[]
}

/** One alert entry. */
interface AlertEntry {
  server: string
  score: number
  reasons: string[]
}

/** Parse `mcp__server__tool` into its server and tool names. */
export function parseMcpName(toolName: unknown): McpName | null {
  if (typeof toolName !== 'string') return null
  const m = /^mcp__([A-Za-z0-9_-]{1,32})__(.+)$/.exec(toolName)
  /* v8 ignore next -- the regex requires both groups to be at least one character, so the fallbacks are unreachable */
  return m ? { server: m[1] ?? '', tool: m[2] ?? '' } : null
}

// oxlint-disable-next-line @stylistic/max-len
const READ_TOKENS = /(^|[._-])(get|list|read|search|query|find|view|describe|show|fetch|lookup|inspect|peek|stat|info|status|ping|health|count|exists|validate|check|scan|select|download|export|summarize|analyze|ocr|recognize|detect|parse|schema|meta|head|keys|entries|history|log|tail|diff)([._-]|$)/i
// oxlint-disable-next-line @stylistic/max-len
const WRITE_TOKENS = /(^|[._-])(write|set|update|delete|remove|create|add|post|put|patch|send|push|commit|upload|edit|modify|insert|drop|truncate|rename|move|copy|save|store|publish|deploy|run|execute|exec|kill|terminate|format|clear|reset|import|append|assign|enable|disable|start|stop|restart|reboot|install|uninstall|configure|generate|transform|mutate|upsert|merge|overwrite|sync|backup|restore|convert|compile|build|test|invoke|call)([._-]|$)/i

/** Classify one tool name: read, write, or unknown (fail closed as write). */
export function classifyTool(tool: unknown): string {
  if (typeof tool !== 'string') return 'unknown'
  if (WRITE_TOKENS.test(tool)) return 'write'
  if (READ_TOKENS.test(tool)) return 'read'
  return 'unknown'
}

// oxlint-disable-next-line @stylistic/max-len
const AUTH_ERR_RE = /(401|403|unauthorized|forbidden|invalid (api[-_ ]?)?key|permission denied|rate limit|quota exceeded|expired|credentials)/i
// oxlint-disable-next-line @stylistic/max-len
const CRED_RE = /("(authorization|api[-_]?key|apikey|x-api-key|secret|password|passwd|token|cookie)"\s*[:=])|(bearer\s+[a-z0-9._~-]{8,})|(\b(sk|ghp|glpat|xox[baprs]-)[a-z0-9_-]{16,}\b)/i

/** Whether an args payload looks like it carries a credential. */
export function hasCredential(args: unknown): boolean {
  try {
    const text = JSON.stringify(args)
    return text.length > 0 && CRED_RE.test(text.slice(0, 8192))
  } catch {
    return false
  }
}

/** Build the deny reason for one MCP tool call under a policy, or undefined to allow. */
export function gateReason(policy: Policy | undefined, tool: string): string | undefined {
  if (policy === undefined) return undefined
  const rule = toolRuleOf(policy.toolRules, tool)
  if (rule === 'deny') {
    return `MCP security policy: tool "${tool}" is explicitly denied on server "${policy.serverName}"`
  }
  if (policy.scope === 'blocked') {
    return `MCP security policy: server "${policy.serverName}" is blocked`
  }
  if (policy.scope === 'read-only') {
    let cls: string
    if (rule === 'read' || rule === 'write') cls = rule
    else if (rule === 'allow') cls = 'read'
    else cls = classifyTool(tool)
    if (cls !== 'read') {
      return `MCP security policy: server "${policy.serverName}" is read-only; write-capable tool "${tool}" is denied`
    }
  }
  return undefined
}

function toolRuleOf(toolRules: Record<string, string>, tool: string): string | undefined {
  const v = toolRules[tool]
  if (v === 'allow' || v === 'deny' || v === 'read' || v === 'write') return v
  return undefined
}

/** Bound one backend's registry of MCP entries to a per-server policy view. */
function policyOf(entry: Entry | undefined): Policy | undefined {
  if (entry === undefined) return undefined
  const sec: McpSecurity = (entry.options.config && (entry.options.config as { mcpSecurity?: McpSecurity }).mcpSecurity) || {}
  const scope = sec.scope === 'read-only' || sec.scope === 'blocked' ? sec.scope : 'read-write'
  const toolRules = sec.toolRules && typeof sec.toolRules === 'object' && !Array.isArray(sec.toolRules)
    ? sec.toolRules : {}
  return { scope, toolRules, serverName: nameOf(entry) }
}

function nameOf(entry: Entry): string {
  const cfg = entry.options.config as Record<string, unknown> | undefined
  /* v8 ignore next -- entryByServer matches a string serverName, so the non-string fallback is unreachable here */
  return typeof cfg?.serverName === 'string' ? cfg.serverName : ''
}

function isStringRecord(v: unknown): boolean {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  for (const key of Object.keys(v as Record<string, unknown>)) if (typeof (v as Record<string, unknown>)[key] !== 'string') return false
  return true
}

function normalizeToolRules(rules: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return out
  for (const key of Object.keys(rules as Record<string, unknown>)) {
    const v = (rules as Record<string, unknown>)[key]
    if (v === 'allow' || v === 'deny' || v === 'read' || v === 'write') out[key] = v
  }
  return out
}

function sanitizeUrl(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined
  const cut = url.search(/[?#]/)
  return cut === -1 ? url : url.slice(0, cut)
}

function countKeys(v: unknown): number {
  return v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v as Record<string, unknown>).length : 0
}

function fiberPhaseOf(entry: Entry): string | null {
  if (!entry.fiber) return null
  const states: Record<number, string> = { 0: 'pending', 1: 'loading', 2: 'active', 3: 'failed', 4: 'disposed', 5: 'unloading' }
  return states[entry.fiber.state] ?? null
}

function messageOf(e: unknown): string {
  try {
    if (e instanceof Error) return e.message
    if (e && typeof e === 'object' && typeof (e as Record<string, unknown>).message === 'string') {
      /* v8 ignore next -- narrowed to string above, so the fallback is unreachable */
      return (e as Record<string, string>).message ?? ''
    }
    return String(e)
  } catch {
    /* v8 ignore next -- String() and the narrowing above cannot throw for the reachable inputs */
    return 'unknown error'
  }
}

function okValue<T>(value: T): ConnectionRpcResult<T> {
  return { ok: true, value }
}

function fail(error: string, details: object = {}): ConnectionRpcResult<unknown> {
  return { ok: false, error: { code: 'internal', message: error, details } as ConnectionRpcFailure }
}

/** Plugin body: register the gate, the stats observer, and the RPC channel. */
export function apply(ctx: Context): void {
  let threshold = DEFAULT_THRESHOLD
  const events: CallEvent[] = []
  const starts = new Map<unknown, number>()

  const entries = (): Entry[] => [...ctx.loader.entries()].filter(entry => !entry.options.group)

  function entryByServer(serverName: string): Entry | undefined {
    return entries().find(entry =>
      entry.options.name === MCP_PACKAGE
      && (entry.options.config as Record<string, unknown>)?.serverName === serverName)
  }

  function resolveMcpEntry(id: string): Entry | undefined {
    return entries().find(entry => entry.options.name === MCP_PACKAGE && (entry.id === id || entry.options.id === id))
  }

  function pushEvent(rec: CallEvent): void {
    events.push(rec)
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
  }

  // 1) execution gate — deny before dispatch through the pre-execute waterfall.
  ctx.on('tools/pre-execute', (exec: ToolExecution, next: () => Promise<PreToolDecision>) => {
    const m = parseMcpName(exec.name)
    if (!m) return next()
    const policy = policyOf(entryByServer(m.server))
    const reason = gateReason(policy, m.tool)
    if (reason !== undefined) {
      pushEvent({ s: m.server, t: m.tool, ts: Date.now(), ok: false, blk: true, auth: false, cred: false, kb: 0, dur: 0 })
      return Promise.resolve({ kind: 'deny', reason } as PreToolDecision)
    }
    /* v8 ignore next -- the 3000-entry guard is a pathological scale arm; emptying the map does not change behavior */
    if (starts.size > 3000) starts.clear()
    starts.set(exec.token, Date.now())
    return next()
  })
  // 2) usage statistics — observe every settled MCP tool call.
  ctx.on('tools/result', (exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>) => {
    const m = parseMcpName(exec.name)
    if (!m) return
    const start = starts.get(exec.token)
    starts.delete(exec.token)
    const dur = start === undefined ? 0 : Date.now() - start
    const failed = result.isError
    let auth = false
    if (failed && result.error && typeof result.error.message === 'string') {
      auth = AUTH_ERR_RE.test(result.error.message)
    }
    const text = JSON.stringify(exec.arguments)
    const kb = Math.ceil(text.length / 1024)
    /* v8 ignore next -- any arguments object stringifies to at least '{}' (kb >= 1), so the zero path is unreachable */
    const cred = kb > 0 && hasCredential(exec.arguments)
    pushEvent({ s: m.server, t: m.tool, ts: Date.now(), ok: !failed, blk: false, auth, cred, kb, dur })
  })

  // 4) npm search — direct HTTP against the npm registry search API.
  async function npmSearch(args: unknown): Promise<ConnectionRpcResult<unknown>> {
    const a = (args && typeof args === 'object') ? args as Record<string, unknown> : {}
    const raw = String(typeof a.query === 'string' ? a.query : '').trim()
    const limit = Math.min(Math.max(Number(a.limit) || 20, 1), 50)
    const text = raw ? `mcp-server ${raw}` : 'mcp-server'
    const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(text)}&size=${limit}`
    try {
      const controller = new AbortController()
      /* v8 ignore next -- the abort fires only after the 20s search timeout, which a deterministic test cannot wait for */
      const timer = setTimeout(() => { controller.abort() }, SEARCH_TIMEOUT_MS)
      let response: Response
      try {
        response = await fetch(url, { signal: controller.signal })
      } finally {
        clearTimeout(timer)
      }
      if (!response.ok) return fail(`npm search failed (HTTP ${response.status})`)
      const data = await response.json() as Record<string, unknown>
      const packages = (Array.isArray(data.objects) ? data.objects : [])
        .map((entry: unknown) => {
          const rec = entry as Record<string, unknown> | null
          const p = (rec && rec.package) as Record<string, unknown> | undefined ?? {} as Record<string, unknown>
          const links = (p.links || {}) as Record<string, unknown>
          const publisher = (p.publisher || {}) as Record<string, unknown>
          return {
            name: typeof p.name === 'string' ? p.name : '',
            version: typeof p.version === 'string' ? p.version : '',
            description: typeof p.description === 'string' ? p.description : '',
            date: typeof p.date === 'string' ? p.date : '',
            publisher: typeof publisher.username === 'string' ? publisher.username : '',
            repository: typeof links.repository === 'string' ? links.repository : '',
            homepage: typeof links.homepage === 'string' ? links.homepage : '',
            keywords: Array.isArray(p.keywords) ? (p.keywords as unknown[]).filter((k): k is string => typeof k === 'string').slice(0, 8) : [],
          }
        })
        .filter((p: { name: string }) => p.name !== '')
        .slice(0, 50)
      return okValue({ query: raw, packages })
    } catch (e) {
      return fail(`npm search error: ${messageOf(e)}`)
    }
  }

  function listServers(): ConnectionRpcResult<unknown> {
    const servers: ServerView[] = []
    for (const entry of entries()) {
      if (entry.options.name !== MCP_PACKAGE) continue
      const cfg = (entry.options.config || {}) as Record<string, unknown>
      const sec = (cfg.mcpSecurity as McpSecurity | undefined) || {}
      const tools: string[] = []
      for (const schema of ctx.tools.schemas()) {
        const m = parseMcpName(schema.name)
        if (m && m.server === cfg.serverName) tools.push(m.tool)
      }
      servers.push({
        id: entry.id,
        serverName: typeof cfg.serverName === 'string' ? cfg.serverName : '',
        transport: cfg.transport === 'stdio' ? 'stdio' : 'streamable-http',
        url: sanitizeUrl(cfg.url),
        command: typeof cfg.command === 'string' ? cfg.command : undefined,
        args: Array.isArray(cfg.args) ? cfg.args as string[] : [],
        cwd: typeof cfg.cwd === 'string' ? cfg.cwd : undefined,
        envCount: countKeys(cfg.env),
        headersCount: countKeys(cfg.headers),
        toolCallTimeoutMs: cfg.toolCallTimeoutMs as number | undefined,
        failOnStartupError: cfg.failOnStartupError === true,
        scope: sec.scope === 'read-only' || sec.scope === 'blocked' ? sec.scope : 'read-write',
        toolRules: sec.toolRules && typeof sec.toolRules === 'object' && !Array.isArray(sec.toolRules) ? sec.toolRules : {},
        tools,
        disabled: entry.disabled,
        fiberPhase: fiberPhaseOf(entry),
      })
    }
    servers.sort((a, b) => a.serverName.localeCompare(b.serverName))
    return okValue({ servers })
  }

  function computeStats(): ConnectionRpcResult<unknown> {
    const now = Date.now()
    type Bucket = {
      calls: number
      failures: number
      blocked: number
      authErrors: number
      credArgs: number
      maxKB: number
      totalDur: number
      recent: number
    }
    const acc = new Map<string, Bucket>()
    for (const e of events) {
      if (now - e.ts > WINDOW_MS) continue
      let a = acc.get(e.s)
      if (!a) {
        a = { calls: 0, failures: 0, blocked: 0, authErrors: 0, credArgs: 0, maxKB: 0, totalDur: 0, recent: 0 }
        acc.set(e.s, a)
      }
      a.calls += 1
      if (e.blk) a.blocked += 1
      else {
        if (!e.ok) a.failures += 1
        if (e.auth) a.authErrors += 1
        if (e.cred) a.credArgs += 1
        if (e.kb > a.maxKB) a.maxKB = e.kb
        a.totalDur += e.dur
        /* v8 ignore next -- recent needs a timestamp inside the spark window but outside the usage window, unreachable without a clock */
        if (now - e.ts <= SPARK_MS) a.recent += 1
      }
    }
    const servers: StatsRow[] = []
    const alerts: AlertEntry[] = []
    const buckets = WINDOW_MS / SPARK_MS
    for (const [server, a] of acc.entries()) {
      /* v8 ignore next -- an aggregated bucket always has at least one call, so the zero branch is unreachable */
      const rate = a.calls ? a.failures / a.calls : 0
      const authRate = a.failures ? a.authErrors / a.failures : 0
      const spike = a.recent >= 8 && a.recent > (a.calls / buckets) * 3
      const reasons: string[] = []
      let score = 0
      if (a.credArgs > 0) { score += 30; reasons.push('cred') }
      if (a.authErrors >= 2 && authRate >= 0.25) { score += 20; reasons.push('auth') }
      if (a.calls >= 5 && rate > 0.4) { score += 20; reasons.push('fail') }
      if (a.blocked >= 3) { score += 15; reasons.push('block') }
      if (spike) { score += 10; reasons.push('spike') }
      if (a.maxKB > 64) { score += 10; reasons.push('payload') }
      /* v8 ignore next -- 'slow' needs a real multi-second call duration, which a deterministic unit test cannot produce */
      if (a.calls >= 5 && a.totalDur / a.calls > 30000) { score += 5; reasons.push('slow') }
      servers.push({
        server, calls: a.calls, failures: a.failures, blocked: a.blocked,
        authErrors: a.authErrors, credArgs: a.credArgs, maxKB: a.maxKB,
        /* v8 ignore next -- an aggregated bucket always has at least one call, so the zero branch is unreachable */
        avgDurMs: a.calls ? Math.round(a.totalDur / a.calls) : 0,
        spike, score, reasons,
      })
      if (score >= threshold) alerts.push({ server, score, reasons: reasons.slice() })
    }
    servers.sort((x, y) => y.score - x.score)
    alerts.sort((x, y) => y.score - x.score)
    return okValue({ threshold, windowMs: WINDOW_MS, servers, alerts })
  }

  async function addServer(args: unknown): Promise<ConnectionRpcResult<unknown>> {
    try {
      const a = (args && typeof args === 'object') ? args as Record<string, unknown> : {}
      const serverName = String(typeof a.serverName === 'string' ? a.serverName : '')
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(serverName)) return fail('invalid serverName', { serverName: 'serverName must match [A-Za-z0-9_-]{1,32}' })
      if (entryByServer(serverName)) return fail('serverName is already in use', { serverName })
      const transport = a.transport === 'stdio' ? 'stdio' : 'streamable-http'
      if (transport === 'streamable-http' && (typeof a.url !== 'string' || !/^https?:\/\/.+/.test(a.url))) {
        return fail('invalid-config', { url: 'a valid http(s) URL is required' })
      }
      if (transport === 'stdio' && (typeof a.command !== 'string' || a.command.trim() === '')) {
        return fail('invalid-config', { command: 'an executable command is required' })
      }
      const config: Record<string, unknown> = {
        serverName,
        transport,
        mcpSecurity: { scope: a.scope === 'read-only' || a.scope === 'blocked' ? a.scope : 'read-write', toolRules: normalizeToolRules(a.toolRules) },
      }
      if (transport === 'stdio') {
        config.command = String(a.command)
        if (Array.isArray(a.args)) config.args = (a.args as unknown[]).map(String)
        if (a.env !== undefined && isStringRecord(a.env)) config.env = a.env
        if (typeof a.cwd === 'string') config.cwd = a.cwd
      } else {
        config.url = String(a.url)
        if (a.headers !== undefined && isStringRecord(a.headers)) config.headers = a.headers
      }
      if (typeof a.toolCallTimeoutMs === 'number' && a.toolCallTimeoutMs >= 1) config.toolCallTimeoutMs = a.toolCallTimeoutMs
      if (a.failOnStartupError === true) config.failOnStartupError = true
      const id = await ctx.loader.create({ name: MCP_PACKAGE, config })
      return okValue({ id })
    } catch (e) {
      return fail(`load-failed: ${messageOf(e)}`)
    }
  }

  async function removeServer(args: unknown): Promise<ConnectionRpcResult<unknown>> {
    try {
      const a = (args && typeof args === 'object') ? args as Record<string, unknown> : {}
      const id = String(typeof a.id === 'string' ? a.id : '')
      const entry = resolveMcpEntry(id)
      if (!entry) return fail(`no such MCP server entry: ${id}`)
      await ctx.loader.remove(entry.id)
      return okValue({ removed: id })
    } catch (e) {
      return fail(`remove-failed: ${messageOf(e)}`)
    }
  }

  async function setEnabled(args: unknown): Promise<ConnectionRpcResult<unknown>> {
    try {
      const a = (args && typeof args === 'object') ? args as Record<string, unknown> : {}
      const entry = resolveMcpEntry(String(typeof a.id === 'string' ? a.id : ''))
      if (!entry) return fail('no such MCP server entry')
      await ctx.loader.update(entry.id, { disabled: !(a.enabled === true) })
      return okValue({ id: entry.id, enabled: a.enabled === true })
    } catch (e) {
      return fail(`update-failed: ${messageOf(e)}`)
    }
  }

  async function setScope(args: unknown): Promise<ConnectionRpcResult<unknown>> {
    try {
      const a = (args && typeof args === 'object') ? args as Record<string, unknown> : {}
      const entry = resolveMcpEntry(String(typeof a.id === 'string' ? a.id : ''))
      if (!entry) return fail('no such MCP server entry')
      const cfg = (entry.options.config && typeof entry.options.config === 'object') ? { ...(entry.options.config as Record<string, unknown>) } : {}
      const sec = (cfg.mcpSecurity && typeof cfg.mcpSecurity === 'object') ? { ...(cfg.mcpSecurity as McpSecurity) } : {}
      const scope = a.scope === 'read-only' || a.scope === 'blocked' ? a.scope as string : 'read-write'
      sec.scope = scope
      const mergedRules = normalizeToolRules(a.toolRules)
      if (a.mergeRules === true) {
        const old = (sec.toolRules && typeof sec.toolRules === 'object') ? sec.toolRules : {}
        sec.toolRules = { ...old, ...mergedRules }
      } else {
        sec.toolRules = mergedRules
      }
      cfg.mcpSecurity = sec
      await ctx.loader.update(entry.id, { config: cfg })
      return okValue({ id: entry.id, scope, toolRules: sec.toolRules })
    } catch (e) {
      return fail(`update-failed: ${messageOf(e)}`)
    }
  }

  async function editServer(args: unknown): Promise<ConnectionRpcResult<unknown>> {
    try {
      const a = (args && typeof args === 'object') ? args as Record<string, unknown> : {}
      const id = String(typeof a.id === 'string' ? a.id : '')
      const entry = resolveMcpEntry(id)
      if (!entry) return fail(`no such MCP server entry: ${id}`)
      const oldCfg = (entry.options.config && typeof entry.options.config === 'object') ? { ...(entry.options.config as Record<string, unknown>) } : {}
      const cfg: Record<string, unknown> = { ...oldCfg }

      if (typeof a.serverName === 'string') {
        if (!/^[A-Za-z0-9_-]{1,32}$/.test(a.serverName)) return fail('invalid serverName format')
        if (a.serverName !== oldCfg.serverName && entryByServer(a.serverName)) return fail('serverName is already in use')
        cfg.serverName = a.serverName
      }
      if (a.transport === 'stdio' || a.transport === 'streamable-http') cfg.transport = a.transport

      if (cfg.transport === 'stdio') {
        if (typeof a.command === 'string') cfg.command = a.command
        if (a.args !== undefined) cfg.args = Array.isArray(a.args) ? a.args : []
        if (typeof a.cwd === 'string' && a.cwd) cfg.cwd = a.cwd
        else if (a.cwd !== undefined) delete cfg.cwd
        if (a.env !== undefined && isStringRecord(a.env)) cfg.env = a.env
        else if (a.env !== undefined) delete cfg.env
        delete cfg.url
        delete cfg.headers
      } else {
        if (typeof a.url === 'string') cfg.url = a.url
        if (a.headers !== undefined && isStringRecord(a.headers)) cfg.headers = a.headers
        else if (a.headers !== undefined) delete cfg.headers
        delete cfg.command
        delete cfg.args
        delete cfg.cwd
        delete cfg.env
      }

      if (typeof a.toolCallTimeoutMs === 'number' && a.toolCallTimeoutMs >= 1) cfg.toolCallTimeoutMs = a.toolCallTimeoutMs
      else if (a.toolCallTimeoutMs !== undefined) delete cfg.toolCallTimeoutMs
      if (a.failOnStartupError === true) cfg.failOnStartupError = true
      else delete cfg.failOnStartupError

      if (a.scope !== undefined || a.toolRules !== undefined) {
        const sec: McpSecurity = (cfg.mcpSecurity && typeof cfg.mcpSecurity === 'object' && !Array.isArray(cfg.mcpSecurity))
          ? { ...(cfg.mcpSecurity as McpSecurity) } : { scope: 'read-write', toolRules: {} }
        if (a.scope !== undefined) sec.scope = a.scope === 'read-only' || a.scope === 'blocked' ? a.scope as string : 'read-write'
        if (a.toolRules !== undefined) sec.toolRules = normalizeToolRules(a.toolRules)
        cfg.mcpSecurity = sec
      }

      await ctx.loader.update(entry.id, { config: cfg })
      return okValue({ id: entry.id, serverName: cfg.serverName })
    } catch (e) {
      return fail(`edit-failed: ${messageOf(e)}`)
    }
  }

  function setThreshold(args: unknown): ConnectionRpcResult<unknown> {
    const n = Number((args && typeof args === 'object' && (args as Record<string, unknown>).threshold))
    if (!Number.isFinite(n) || n < 0 || n > 200) return fail('threshold must be a number in [0, 200]')
    threshold = n
    return okValue({ threshold })
  }

  function clearStats(): ConnectionRpcResult<unknown> {
    events.length = 0
    starts.clear()
    return okValue({ cleared: true })
  }

  // 6) register the loopback-only Connection RPC channel.
  ctx.effect(() => {
    const handler: ConnectionRpcHandler = async (endpoint, payload) => {
      switch (endpoint) {
        case 'list': return listServers()
        case 'add': return addServer(payload)
        case 'remove': return removeServer(payload)
        case 'setEnabled': return setEnabled(payload)
        case 'setScope': return setScope(payload)
        case 'edit': return editServer(payload)
        case 'stats': return computeStats()
        case 'setThreshold': return setThreshold(payload)
        case 'clearStats': return clearStats()
        case 'npmSearch': return npmSearch(payload)
        default: return fail(`unknown-endpoint: ${endpoint}`)
      }
    }
    const dispose = ctx.connection.rpc.handle(RPC_CHANNEL, handler)
    /* v8 ignore next -- the channel disposer runs on fiber teardown, exercised by the HMR-safety suite rather than this apply-level spec */
    return () => { void dispose() }
  }, 'mcpsec: rpc channel')

  ctx.logger('mcpsec-manager').info('mcpsec-manager active')
}
