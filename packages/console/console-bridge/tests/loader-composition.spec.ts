/**
 * Real-composition guard for the web settings surface: the bundle boots
 * the console-bridge row with `config: { autoStart: false }` and no `agentId`
 * — the operator enters the identity in the browser form. The plugin must load
 * under that config (registering the settings namespaces is what makes the
 * plugins tab render one card per namespace) and must not fail when the bridge
 * is disabled. Booted through the real Loader + Include path, exactly like the
 * settings-file composition suite.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import * as consoleBridge from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * Boot the console-bridge row through the real Loader against one settings document.
 * @param settingsYaml - the `$DSH_HOME/settings.yaml` content the provider reads.
 * @returns the booted root context and the path of the settings document.
 */
async function boot(settingsYaml: string): Promise<{ ctx: Context; settingsPath: string }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-console-bridge-composition-'))
  const settingsPath = join(root, 'settings.yaml')
  await writeFile(settingsPath, settingsYaml)

  const agents = {
    name: 'test-agents',
    apply: (ctx: Context) => {
      ctx.provide('agents', { create: () => Promise.reject(new Error('no agents in test')) })
    },
  }

  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: settings',
    "  name: '@deepseek-ai/dsh-settings-file'",
    '  config:',
    `    path: ${JSON.stringify(settingsPath)}`,
    '    debounceMs: 10',
    '- id: agents',
    '  name: test-agents',
    '- id: console-bridge',
    "  name: '@deepseek-ai/dsh-console-bridge'",
    '  config:',
    '    autoStart: false',
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-settings-file', FileSettingsProvider],
    ['test-agents', agents],
    ['@deepseek-ai/dsh-console-bridge', consoleBridge],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  return { ctx, settingsPath }
}

describe('console-bridge real composition', () => {
  it('registers the settings namespace under the web row config (autoStart only)', async () => {
    const { ctx, settingsPath } = await boot('')

    // The namespace the settings form binds; its presence is what turns the
    // tab from an empty page into the editable connection form.
    const settings = ctx.get('settings')!
    expect(settings.describe().map(entry => entry.ns)).toContain('console-bridge')
    // Disabled boot writes nothing and subscribes nothing.
    expect(await readFile(settingsPath, 'utf8')).toBe('')
  })

  it('registers console-pricing so the plugins tab renders its card', async () => {
    const { ctx } = await boot([
      'console-pricing:',
      '  models:',
      '    - baseUrl: https://api.deepseek.com',
      '      provider: deepseek-official',
      '      model: deepseek-v4-flash',
      '      peak:',
      '        cacheHit: 0.1',
      '        cacheMiss: 0.5',
      '        output: 1.5',
      '      offPeak:',
      '        cacheHit: 0.05',
      '        cacheMiss: 0.25',
      '        output: 0.75',
      '',
    ].join('\n'))

    const settings = ctx.get('settings')!
    // The plugins tab builds one card per described namespace, so a namespace
    // missing from `describe()` has no card however well its card is registered.
    expect(settings.describe().map(entry => entry.ns)).toContain('console-pricing')
    // The stored table is what the card reads and stages; the document loads
    // asynchronously after plugin apply.
    await vi.waitFor(() => {
      expect(settings.get('console-pricing')).toEqual({
        models: [
          {
            baseUrl: 'https://api.deepseek.com',
            provider: 'deepseek-official',
            model: 'deepseek-v4-flash',
            peak: { cacheHit: 0.1, cacheMiss: 0.5, output: 1.5 },
            offPeak: { cacheHit: 0.05, cacheMiss: 0.25, output: 0.75 },
          },
        ],
      })
    })
  })

  it('treats an absent and an empty price table as valid', async () => {
    const { ctx } = await boot('console-pricing:\n  models: []\n')
    const settings = ctx.get('settings')!
    await vi.waitFor(() => {
      expect(settings.get('console-pricing')).toEqual({ models: [] })
    })
  })

  it('resolves a stored off-peak window alongside the price table', async () => {
    // YAML reads an unquoted `22:30` as a sexagesimal number, so the window's
    // times are quoted in every document an operator writes.
    const { ctx } = await boot([
      'console-pricing:',
      '  offPeak:',
      '    start: "22:30"',
      '    end: "06:15"',
      '    timezone: Asia/Kolkata',
      '',
    ].join('\n'))

    const settings = ctx.get('settings')!
    await vi.waitFor(() => {
      expect(settings.get('console-pricing')).toEqual({
        models: [],
        offPeak: { start: '22:30', end: '06:15', timezone: 'Asia/Kolkata' },
      })
    })
  })

  it('refuses to load a stored window no fold could read', async () => {
    // The window decides which band a token is charged in, so an unreadable one
    // is refused at load rather than left to silently price everything at peak.
    await expect(boot([
      'console-pricing:',
      '  offPeak:',
      '    start: "25:00"',
      '    end: "06:15"',
      '    timezone: Asia/Kolkata',
      '',
    ].join('\n'))).rejects.toThrow('console-pricing: offPeak.start is not an HH:MM time: "25:00"')

    await expect(boot([
      'console-pricing:',
      '  offPeak:',
      '    start: "22:30"',
      '    end: "06:15"',
      '    timezone: Mars/Olympus',
      '',
    ].join('\n'))).rejects.toThrow('console-pricing: offPeak.timezone is not an IANA time zone: "Mars/Olympus"')
  })
})
