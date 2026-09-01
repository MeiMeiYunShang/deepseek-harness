/**
 * Real-composition guard for the web settings surface: the bundle boots
 * the console-bridge row with `config: { autoStart: false }` and no `agentId`
 * — the operator enters the identity in the browser form. The plugin must load
 * under that config (registering the `console-bridge` namespace is what makes
 * the settings tab render) and must not fail when the bridge is disabled. Booted
 * through the real Loader + Include path, exactly like the settings-file
 * composition suite.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
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

describe('console-bridge real composition', () => {
  it('registers the settings namespace under the web row config (autoStart only)', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-console-bridge-composition-'))
    const settingsPath = join(root, 'settings.yaml')
    await writeFile(settingsPath, '')

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

    // The namespace the settings form binds; its presence is what turns the
    // tab from an empty page into the editable connection form.
    const settings = ctx.get('settings')!
    expect(settings.describe().map(entry => entry.ns)).toContain('console-bridge')
    // Disabled boot writes nothing and subscribes nothing.
    expect(await (await import('node:fs/promises')).readFile(settingsPath, 'utf8')).toBe('')
  })
})
