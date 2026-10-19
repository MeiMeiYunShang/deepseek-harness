// Build a self-contained, copy-to-host dsh web package via the workspace tarball
// closure recipe (the same mechanism apps/desktop uses in prepare-dsh.ts): pack
// every workspace package reachable from the CLI through dependencies +
// peerDependencies + optionalDependencies, then emit an install project whose
// package.json binds each packed tarball both as a dependency and as a pnpm
// override, so the whole @deepseek-ai/* graph resolves off local tarballs and
// only external packages touch a registry. pnpm deploy is NOT used: it omits
// workspace plugins that appear only as a transitive dependency's peer (e.g.
// @deepseek-ai/cordis-plugin-group), which crashes the detached folder at boot.
//
// Two phases:
//   node deploy/pack-closure.mjs --out <dir>
//     Compute the closure, pack each member into <dir>/dsh-packages, run the
//     static completeness gate, and write the install project. No registry use.
//   node deploy/pack-closure.mjs --out <dir> --install
//     The above, then `pnpm install --prod` in <dir> and a plain-node smoke of
//     the shipped CLI bin. This is the heavy, networked step.

import { spawnSync } from 'node:child_process'
import { existsSync, globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES_DIR = 'dsh-packages'

// CLI package that owns the `dsh` bin, plus the shipped web profile bundle layers
// (PROFILE_TEMPLATES.web.bundles in @deepseek-ai/dsh-app-boot). Rooting the
// closure here guarantees the bin and both web bundle layers are packed.
const CLI_PACKAGE = '@deepseek-ai/dsh'
const FALLBACK_WEB_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
const ROOT_PACKAGES = [CLI_PACKAGE, ...FALLBACK_WEB_BUNDLES]

// Per-package pnpm pack budget; a pack that exceeds it is treated as hung.
const PACK_TIMEOUT_MS = 180_000

// A workspace postinstall restores the exec bit on node-pty's macOS spawn helper;
// pnpm 10 strictDepBuilds rejects its script unless allowed, as apps/desktop does.
const CORE_BUILD_PACKAGE = '@deepseek-ai/dsh-subprocess-local'

function arg(name) {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}
const OUT_DIR = resolve(arg('--out') ?? '')
const DO_INSTALL = process.argv.includes('--install')
if (!OUT_DIR) throw new Error('pack-closure: --out <dir> is required')

/** Read the web profile bundle layers from the built app-boot, falling back to the literal tuple. */
async function webBundles() {
  try {
    const { PROFILE_TEMPLATES } = await import('@deepseek-ai/dsh-app-boot')
    const bundles = PROFILE_TEMPLATES.web?.bundles
    if (Array.isArray(bundles) && bundles.length > 0) return [...bundles]
  } catch {
    // app-boot not built or not resolvable; the literal is the shipped tuple.
  }
  return [...FALLBACK_WEB_BUNDLES]
}

/** Map every workspace member's package name to its directory and manifest. */
function collectMembers() {
  const ws = readFileSync(join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8')
  const patterns = []
  let inPackages = false
  for (const line of ws.split(/\r?\n/u)) {
    if (/^packages:\s*$/u.test(line)) { inPackages = true; continue }
    if (inPackages) {
      if (/^\s*#\s/u.test(line)) continue
      const item = line.match(/^\s*-\s*(.+?)\s*$/u)
      if (item !== null) { patterns.push(item[1].replace(/^['"]|['"]$/gu, '')); continue }
      if (line.trim() !== '' && !/^\s/u.test(line)) break
    }
  }
  const members = new Map()
  for (const pattern of patterns) {
    for (const rel of globSync(`${pattern}/package.json`, { cwd: REPO_ROOT })) {
      const dir = resolve(REPO_ROOT, dirname(rel))
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      if (typeof manifest.name === 'string' && !members.has(manifest.name)) {
        members.set(manifest.name, { dir, version: manifest.version ?? '0.0.0', manifest })
      }
    }
  }
  return members
}

/** Whether a manifest targets the platform this package is being built for. */
function platformOk(manifest) {
  for (const [field, current] of [['os', process.platform], ['cpu', process.arch]]) {
    const listed = manifest[field]
    if (listed === undefined) continue
    const arr = (Array.isArray(listed) ? listed : [listed]).map((value) => String(value))
    const allowed = arr.filter((value) => !value.startsWith('!'))
    const denied = arr.filter((value) => value.startsWith('!')).map((value) => value.slice(1))
    if (allowed.length > 0 && !allowed.includes(current)) return false
    if (denied.includes(current)) return false
  }
  return true
}

/** Names a manifest pulls in, split into required (dependencies + peerDependencies) and optional. */
function runtimeEdges(manifest) {
  return {
    required: [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ],
    optional: Object.keys(manifest.optionalDependencies ?? {}),
  }
}

/**
 * Transitive set of workspace members reachable from the roots. A required dependency that
 * cannot be built for this platform is a hard error; an optional dependency is followed only
 * when it is buildable, mirroring apps/desktop (which visits an optional package solely when
 * its tarball is available). This keeps foreign-platform native addons out of the closure.
 */
function computeClosure(members) {
  for (const root of ROOT_PACKAGES) {
    if (!members.has(root)) throw new Error(`pack-closure: workspace root ${root} is not a workspace member`)
  }
  const buildable = new Map([...members].map(([name, entry]) => [name, platformOk(entry.manifest)]))
  const closure = new Set()
  const pruned = new Set()
  const queue = [...ROOT_PACKAGES]
  while (queue.length > 0) {
    const name = queue.pop()
    if (closure.has(name)) continue
    const entry = members.get(name)
    if (entry === undefined) continue // external package, resolved from a registry at install
    if (!buildable.get(name)) {
      throw new Error(`pack-closure: required package ${name} is not buildable on ${process.platform}-${process.arch}`)
    }
    closure.add(name)
    const { required, optional } = runtimeEdges(entry.manifest)
    for (const dep of required) {
      if (!members.has(dep)) continue
      if (!buildable.get(dep)) {
        throw new Error(`pack-closure: ${name} requires ${dep}, which is not buildable on ${process.platform}-${process.arch}`)
      }
      if (!closure.has(dep)) queue.push(dep)
    }
    for (const dep of optional) {
      if (!members.has(dep)) continue
      if (buildable.get(dep)) { if (!closure.has(dep)) queue.push(dep) }
      else pruned.add(dep)
    }
  }
  return { closure, buildable, pruned }
}

/**
 * Static completeness gate: every buildable workspace member any closure package references at
 * runtime must itself be in the closure (packed). This is precisely what pnpm deploy got wrong
 * for @deepseek-ai/cordis-plugin-group.
 */
function auditClosure(members, closure, buildable) {
  const missing = new Map()
  for (const name of closure) {
    const { required, optional } = runtimeEdges(members.get(name).manifest)
    for (const dep of [...required, ...optional]) {
      if (members.has(dep) && buildable.get(dep) && !closure.has(dep)) {
        const list = missing.get(dep) ?? []
        list.push(name)
        missing.set(dep, list)
      }
    }
  }
  if (missing.size > 0) {
    const detail = [...missing].map(([dep, parents]) => `  ${dep} <- referenced by ${parents.join(', ')}`)
    throw new Error(`pack-closure: closure is incomplete, these workspace members are referenced but not included:\n${detail.join('\n')}`)
  }
}

/** Deterministic npm tarball filename for a scoped package at a version. */
function tarballName(name, version) {
  return `${name.slice(name.startsWith('@') ? 1 : 0).replace(/\//gu, '-')}-${version}.tgz`
}

/** Pack one workspace member into the destination directory and return its path. */
function packMember(entry, destDir) {
  const expected = join(destDir, tarballName(entry.manifest.name, entry.version))
  // --config.ignore-scripts=true: pnpm pack otherwise runs each package's prepack
  // (e.g. verify-launcher-binary), which can stall under concurrency. The repo is
  // already built (`pnpm run build`), so packing skips lifecycle and tars the
  // existing lib. A bounded timeout turns any residual hang into a named failure.
  const result = spawnSync('pnpm', ['--config.ignore-scripts=true', '--filter', entry.manifest.name, 'pack', '--pack-destination', destDir], {
    cwd: REPO_ROOT, shell: true, encoding: 'utf8', timeout: PACK_TIMEOUT_MS,
  })
  if (result.error !== undefined || result.status === null) {
    throw new Error(`pack-closure: pnpm pack did not finish for ${entry.manifest.name} (timeout or spawn error: ${result.error?.message ?? `signal ${String(result.signal)}`})`)
  }
  if (result.status !== 0) {
    throw new Error(`pack-closure: pnpm pack failed for ${entry.manifest.name}\n${result.stdout ?? ''}${result.stderr ?? ''}`)
  }
  // Trust pnpm's own report when it names a different path; fall back to the deterministic one.
  const reported = [...(result.stdout ?? '').matchAll(/(\S+\.tgz)\s*$/gmu)].pop()
  const packed = reported === undefined ? expected : resolve(destDir, reported[1].split(/[\\/]/u).pop())
  if (!existsSync(packed)) throw new Error(`pack-closure: expected tarball not found after packing ${entry.manifest.name}: ${packed}`)
  return packed
}

/** Write the install project: package.json (deps + overrides + web bundles) and pnpm-workspace.yaml. */
function writeInstallProject(members, closure, tarballs, bundles) {
  const specs = {}
  for (const name of closure) {
    const file = tarballName(name, members.get(name).version)
    specs[name] = `file:./${PACKAGES_DIR}/${file}`
  }
  const manifest = {
    name: '@deepseek-ai/dsh-web-runtime',
    private: true,
    version: members.get(CLI_PACKAGE).version,
    type: 'module',
    dependencies: specs,
    dsh: { profile: { bundles } },
  }
  writeFileSync(join(OUT_DIR, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)

  const overrideLines = Object.entries(specs).map(([name, spec]) => `  ${JSON.stringify(name)}: ${JSON.stringify(spec)}`)
  const coreLocal = closure.has(CORE_BUILD_PACKAGE)
    ? `  ${JSON.stringify(`${CORE_BUILD_PACKAGE}@${specs[CORE_BUILD_PACKAGE].replace('file:./', 'file:')}`)}: true\n`
    : ''
  const workspace = `packages:\n  - .\n\noverrides:\n${overrideLines.join('\n')}\n\n`
    + 'nodeLinker: hoisted\n'
    + 'autoInstallPeers: false\n'
    + 'allowBuilds:\n'
    + '  node-pty: true\n'
    + '  koffi: true\n'
    + '  fs-ext: true\n'
    + coreLocal
    + "  '@google/genai': false\n"
    + '  protobufjs: false\n'
    + '  node-addon-require-builtin: false\n'
  writeFileSync(join(OUT_DIR, 'pnpm-workspace.yaml'), workspace)
}

/** Run the heavy, networked install and the plain-node boot smoke; on failure remove the package. */
function installAndSmoke() {
  const binRel = join('node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  console.log('pack-closure: pnpm install --prod (heavy, needs registry for external packages)...')
  const install = spawnSync('pnpm', ['install', '--prod'], { cwd: OUT_DIR, shell: true, stdio: 'inherit' })
  if (install.status !== 0) { fail('pnpm install --prod failed') }
  const bin = join(OUT_DIR, binRel)
  if (!existsSync(bin)) fail(`installed package missing CLI bin at ${binRel}`)
  console.log('pack-closure: smoke-testing the shipped CLI (node lib/bin.js --help)...')
  const smoke = spawnSync('node', [bin, '--help'], { cwd: OUT_DIR, encoding: 'utf8' })
  if (smoke.status !== 0) {
    fail(`CLI failed to boot (exit ${String(smoke.status)})\n${smoke.stdout ?? ''}${smoke.stderr ?? ''}`)
  }
  const cmd = [
    '@echo off',
    'rem Launch dsh web from this package (requires Node on PATH).',
    'rem Pass any dsh web flags, e.g.: run-web.cmd --port 3080 --no-open',
    'node "%~dp0node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" web %*',
  ]
  writeFileSync(join(OUT_DIR, 'run-web.cmd'), `${cmd.join('\r\n')}\r\n`)
  console.log('pack-closure: smoke passed; package is self-contained.')
  return bin
}

function fail(message) {
  rmSync(OUT_DIR, { recursive: true, force: true })
  throw new Error(`pack-closure: ${message} (removed ${OUT_DIR})`)
}

const members = collectMembers()
const { closure, buildable, pruned } = computeClosure(members)
auditClosure(members, closure, buildable)
const bundles = await webBundles()

const packagesDir = join(OUT_DIR, PACKAGES_DIR)
rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(packagesDir, { recursive: true })

console.log(`pack-closure: closure of ${closure.size} workspace packages (rooted at ${ROOT_PACKAGES.join(', ')})`)
if (pruned.size > 0) console.log(`  pruned ${pruned.size} foreign-platform optional packages: ${[...pruned].sort().join(', ')}`)
for (const probe of ['@deepseek-ai/cordis', '@deepseek-ai/cordis-plugin-group', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-host-webserver']) {
  console.log(`  ${closure.has(probe) ? 'included' : 'ABSENT   '} ${probe}`)
}

const tarballs = new Map()
const names = [...closure].sort()
for (let i = 0; i < names.length; i += 1) {
  const name = names[i]
  console.log(`pack-closure: packing ${i + 1}/${names.length} ${name}`)
  tarballs.set(name, packMember(members.get(name), packagesDir))
}
writeInstallProject(members, closure, tarballs, bundles)

const summary = {
  outDir: OUT_DIR,
  closureSize: closure.size,
  webBundles: bundles,
  installed: false,
}
if (DO_INSTALL) {
  summary.bin = installAndSmoke()
  summary.installed = true
} else {
  console.log('pack-closure: prepared the install project (closure packed + static gate passed). Re-run with --install to materialize node_modules.')
}
console.log(JSON.stringify(summary, undefined, 2))
