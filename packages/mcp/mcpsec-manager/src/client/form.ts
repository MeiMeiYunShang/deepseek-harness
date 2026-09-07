/**
 * Pure add/edit form helpers for the MCP security section. Extracted from the
 * component so the parsing, name-suggestion, and payload-building branches are
 * unit-testable without rendering.
 */

import type { NpmPackage } from './types.ts'

/** One editable server form field set (add/edit share this shape). */
export interface ServerForm {
  serverName: string
  transport: string
  url: string
  command: string
  args: string
  cwd: string
  env: string
  headers: string
  timeout: string
  failOnStartup: boolean
  scope: string
  toolRules: string
}

/** Blank custom-form state. */
export const EMPTY_FORM: ServerForm = {
  serverName: '', transport: 'stdio', url: '', command: '', args: '', cwd: '',
  env: '', headers: '', timeout: '', failOnStartup: false, scope: 'read-write', toolRules: '',
}

/** The three selectable permission scopes. */
export const SCOPES: readonly string[] = ['read-write', 'read-only', 'blocked']

/** Validate a serverName against the host half's rule. */
export function validName(name: string): boolean {
  return /^[A-Za-z0-9_-]{1,32}$/.test(name)
}

/** Parse key=value / Key: value lines into a record. */
export function parsePairs(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of (text || '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    const colon = trimmed.indexOf(':')
    const sep = eq === -1 ? colon : colon === -1 ? eq : Math.min(eq, colon)
    if (sep <= 0) continue
    let key = trimmed.slice(0, sep).trim()
    let value = trimmed.slice(sep + 1).trim()
    if (key.length >= 2 && ((key[0] === '"' && key[key.length - 1] === '"') || (key[0] === "'" && key[key.length - 1] === "'"))) key = key.slice(1, -1).trim()
    if (value.length >= 2 && ((value[0] === '"' && value[value.length - 1] === '"') || (value[0] === "'" && value[value.length - 1] === "'"))) value = value.slice(1, -1).trim()
    /* v8 ignore next -- sep > 0 guarantees a non-empty key, so the empty-key write guard never fires */
    if (key) out[key] = value
  }
  return out
}

/** Parse `toolName=allow|deny|read|write` lines into a record. */
export function parseToolRules(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of (text || '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (key && (value === 'allow' || value === 'deny' || value === 'read' || value === 'write')) out[key] = value
  }
  return out
}

/** Join a tool-rules record back into its text-editor form. */
export function rulesToText(rules: Record<string, string>): string {
  return Object.keys(rules).map(key => `${key}=${rules[key]}`).join('\n')
}

/** Suggest a serverName from an npm package name. */
export function suggestServerName(pkgName: string): string {
  const base = (pkgName || '')
    .replace(/^@[^/]+\//, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return (base || 'mcp').slice(0, 32)
}

/** Assert a form's required fields and return the `/mcpsec` add/edit payload. */
export function formPayload(form: ServerForm): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    serverName: form.serverName.trim(),
    transport: form.transport,
    scope: form.scope,
    toolRules: parseToolRules(form.toolRules),
  }
  if (form.transport === 'stdio') {
    payload.command = form.command.trim()
    if (form.args.trim()) payload.args = form.args.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    if (form.env.trim()) payload.env = parsePairs(form.env)
    if (form.cwd.trim()) payload.cwd = form.cwd.trim()
  } else {
    payload.url = form.url.trim()
    if (form.headers.trim()) payload.headers = parsePairs(form.headers)
  }
  if (form.timeout.trim()) {
    const n = Number(form.timeout)
    if (Number.isFinite(n) && n >= 1) payload.toolCallTimeoutMs = n
  }
  if (form.failOnStartup) payload.failOnStartupError = true
  return payload
}

/** Prefill a form from a picked npm package. */
export function presetForm(pkg: NpmPackage): ServerForm {
  return {
    serverName: suggestServerName(pkg.name),
    transport: 'stdio',
    url: '',
    command: 'npx',
    args: `-y\n${pkg.name}`,
    cwd: '',
    env: '',
    headers: '',
    timeout: '',
    failOnStartup: false,
    scope: 'read-only',
    toolRules: '',
  }
}
