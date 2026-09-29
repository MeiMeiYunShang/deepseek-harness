/**
 * Real-composition guard for the web settings surface. The bundle boots the
 * console-bridge row through master's settings composition — the real
 * `@deepseek-ai/dsh-config-editor` and `@deepseek-ai/dsh-settings` services
 * over a profile Loader — so the entry's editable fields appear in
 * `ctx.settings.describe()` and the price table the cost view reads is the same
 * composition data a running installation projects.
 *
 * The row is disabled (`enabled: false`), so boot subscribes to nothing and
 * needs no console endpoint; the spec pins composition and projection only.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished } from 'vitest'
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import * as consoleBridge from '../src/index.ts'

/** A test agents registry; the bridge only needs the service to exist at mount. */
const agents = {
  name: 'console-bridge-test-agents',
  apply: (ctx: Context) => { ctx.provide('agents', { create: () => Promise.reject(new Error('no agents in test')) }) },
}

/**
 * Boot a fresh profile whose bundle inserts the console-bridge row with the
 * supplied config, alongside the real config-editor and settings services.
 * @param config - the raw `console-bridge` entry config to compose.
 * @returns the booted root context.
 */
async function bootComposition(config: Record<string, unknown>): Promise<Context> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-console-bridge-composition-')))
  const dir = join(home, 'profiles', 'test')
  onTestFinished(() => { rmSync(home, { recursive: true, force: true }) })
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules', 'test-bundle')
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(home, 'package.json'), '{"name":"test-installation"}\n')
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({
    name: 'test-bundle',
    version: '1.0.0',
    dsh: { bundle: { patch: 'cordis.patch.yml' } },
  }))
  writeFileSync(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'config-editor', name: 'cordis:editor' },
    { id: 'settings', name: 'cordis:settings' },
    { id: 'agents', name: 'cordis:console-bridge-agents' },
    { id: 'console-bridge', name: 'cordis:console-bridge', config },
  ] }]))
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = {
    name: 'test',
    startedBundles: ['test-bundle'],
    dir,
    patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'),
    cwd: home,
    home,
    overlays: [],
    telemetryDisabledEnv: undefined,
  }
  const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), (booted) => {
    booted.provide('profileContext', profile)
    booted.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => undefined } })
    Object.assign(booted.loader.builtins, {
      editor: ConfigEditor,
      settings: Settings,
      'console-bridge-agents': agents,
      'console-bridge': consoleBridge,
    })
  })
  onTestFinished(async () => { await ctx.fiber.dispose() })
  return ctx
}

/** The console-bridge descriptor the settings service projects, or undefined. */
function bridgeDescriptor(ctx: Context) {
  return ctx.settings.describe().find(descriptor => String(descriptor.ns) === 'console-bridge')
}

describe('console-bridge real composition', () => {
  it('registers the console-bridge entry in the settings describe output', async () => {
    // The entry's presence in `describe()` is what renders its editable card;
    // the removed settings namespaces are gone.
    const ctx = await bootComposition({ enabled: false })
    const names = ctx.settings.describe().map(descriptor => String(descriptor.ns))
    expect(names).toContain('console-bridge')
    expect(names).not.toContain('console-pricing')
  })

  it('projects the composed price table and off-peak window through the entry', async () => {
    const offPeak = { start: '22:30', end: '06:15', timezone: 'Asia/Kolkata' }
    const models = [{
      baseUrl: 'https://api.deepseek.com',
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      peak: { cacheHit: 0.1, cacheMiss: 0.5, output: 1.5 },
      offPeak: { cacheHit: 0.05, cacheMiss: 0.25, output: 0.75 },
    }]
    const ctx = await bootComposition({ enabled: false, models, offPeak })
    const value = bridgeDescriptor(ctx)?.value
    // The stored table and window are what the settings card reads and stages.
    expect(value).toMatchObject({ enabled: false, transport: 'mqtt', models, offPeak })
  })

  it('treats an empty price table as valid', async () => {
    const ctx = await bootComposition({ enabled: false, models: [] })
    expect(bridgeDescriptor(ctx)?.value).toMatchObject({ models: [] })
  })
})
