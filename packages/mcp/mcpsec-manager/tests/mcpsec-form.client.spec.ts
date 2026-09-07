/** Pure add/edit form helpers: pair parsing, tool-rule parsing, name suggestion, and payload building. */

import { describe, expect, it } from 'vitest'
import {
  EMPTY_FORM, SCOPES, formPayload, parsePairs, parseToolRules, presetForm, rulesToText,
  suggestServerName, validName, type ServerForm,
} from '../src/client/form.ts'

describe('parsePairs', () => {
  it('parses = and : separators, strips quotes, and skips blank lines', () => {
    expect(parsePairs('a=1\nb:2\n"c"=3\n\'d\'=4\n\n#no-sep\n=')).toEqual({ a: '1', b: '2', c: '3', d: '4' })
  })

  it('handles quoted values and trims whitespace', () => {
    expect(parsePairs('key = "value with spaces"')).toEqual({ key: 'value with spaces' })
    expect(parsePairs("k='y'")).toEqual({ k: 'y' })
  })

  it('picks the earlier of a mixed separator pair', () => {
    expect(parsePairs('a:b=1')).toEqual({ a: 'b=1' })
  })

  it('returns an empty record for blank or separator-less input', () => {
    expect(parsePairs('')).toEqual({})
    expect(parsePairs('just-a-line')).toEqual({})
    expect(parsePairs('  \n  ')).toEqual({})
  })
})

describe('parseToolRules', () => {
  it('keeps only allow/deny/read/write values', () => {
    expect(parseToolRules('a=allow\nb=deny\nc=read\nd=write\ne=bad\nf\n=x')).toEqual({
      a: 'allow', b: 'deny', c: 'read', d: 'write',
    })
  })

  it('returns an empty record for blank or malformed input', () => {
    expect(parseToolRules('')).toEqual({})
    expect(parseToolRules('no-equals')).toEqual({})
  })
})

describe('rulesToText', () => {
  it('serializes and joins rules, and returns empty text for an empty record', () => {
    expect(rulesToText({ a: 'allow', b: 'deny' })).toBe('a=allow\nb=deny')
    expect(rulesToText({})).toBe('')
  })
})

describe('suggestServerName', () => {
  it('derives a slug, strips a scope, falls back to mcp, and truncates', () => {
    expect(suggestServerName('@scope/pkg-name')).toBe('pkg-name')
    expect(suggestServerName('My Pkg!')).toBe('my-pkg')
    expect(suggestServerName('---foo---')).toBe('foo')
    expect(suggestServerName('')).toBe('mcp')
    expect(suggestServerName('@scope/')).toBe('mcp')
    expect(suggestServerName('a'.repeat(64))).toHaveLength(32)
  })
})

describe('validName', () => {
  it('accepts a slug and rejects spaces, blanks, and oversized names', () => {
    expect(validName('abc')).toBe(true)
    expect(validName('bad name!')).toBe(false)
    expect(validName('')).toBe(false)
    expect(validName('a'.repeat(33))).toBe(false)
  })
})

describe('formPayload', () => {
  const base: ServerForm = { ...EMPTY_FORM, serverName: 'srv' }

  it('builds a stdio payload with args/env/cwd/timeout/failOnStartup', () => {
    const payload = formPayload({ ...base, command: 'node', args: '-y\nfoo', env: 'A=1', cwd: '/tmp', timeout: '5000', failOnStartup: true })
    expect(payload).toEqual({
      serverName: 'srv', transport: 'stdio', scope: 'read-write', toolRules: {},
      command: 'node', args: ['-y', 'foo'], env: { A: '1' }, cwd: '/tmp', toolCallTimeoutMs: 5000, failOnStartupError: true,
    })
  })

  it('omits optional stdio keys when blank and skips a non-finite timeout', () => {
    const payload = formPayload({ ...base, command: 'node', timeout: 'abc' })
    expect(payload).toMatchObject({ command: 'node' })
    expect(payload).not.toHaveProperty('args')
    expect(payload).not.toHaveProperty('env')
    expect(payload).not.toHaveProperty('cwd')
    expect(payload).not.toHaveProperty('toolCallTimeoutMs')
  })

  it('builds an http payload with url and headers', () => {
    const payload = formPayload({ ...base, transport: 'streamable-http', url: 'https://x.dev', headers: 'A: 1' })
    expect(payload).toEqual({
      serverName: 'srv', transport: 'streamable-http', scope: 'read-write', toolRules: {},
      url: 'https://x.dev', headers: { A: '1' },
    })
  })

  it('omits http headers when blank', () => {
    const payload = formPayload({ ...base, transport: 'streamable-http', url: 'https://x.dev' })
    expect(payload).not.toHaveProperty('headers')
  })
})

describe('presetForm', () => {
  it('prefills a read-only npx form from a picked package', () => {
    const form = presetForm({ name: '@scope/pkg', version: '1', description: '', date: '', publisher: '', repository: '', homepage: '', keywords: [] })
    expect(form).toMatchObject({
      serverName: 'pkg', transport: 'stdio', command: 'npx', args: '-y\n@scope/pkg', scope: 'read-only',
    })
  })
})

describe('SCOPES', () => {
  it('exposes the three selectable scopes in order', () => {
    expect(SCOPES).toEqual(['read-write', 'read-only', 'blocked'])
  })
})
