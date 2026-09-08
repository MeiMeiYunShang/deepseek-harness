/**
 * JSON file persistence provider for the knowledge store.
 *
 * Reads and writes knowledge entries and groups as individual JSON files under
 * a configurable root directory (default: `$DSH_HOME/knowledge/`). On boot it
 * hydrates the in-memory store from disk; on every `knowledge/change` event it
 * writes the changed entry or group back.
 *
 * Storage layout:
 * ```
 * <root>/
 *   entries/<id>.json   — one file per knowledge entry
 *   groups/<id>.json    — one file per knowledge group
 * ```
 *
 * @module @deepseek-ai/dsh-knowledge-file
 */

import type { Context } from '@deepseek-ai/cordis'
import type { KnowledgeEntry, KnowledgeGroup } from '@deepseek-ai/dsh-knowledge'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'

export const name = 'knowledge-file'
export const inject = ['knowledge']

/** Deployment configuration for the file persistence provider. */
export interface Config {
  /** Absolute path to the knowledge storage root directory. */
  root: string
}

/** Schemastery configuration for the file persistence provider. */
export const Config: z<Config> = z.object({
  root: z.string(),
})

/**
 * Wire the file persistence provider: hydrate the store from disk, then
 * listen for `knowledge/change` to write mutations back.
 * @param ctx - plugin context carrying the knowledge store.
 * @param config - deployment configuration with the storage root path.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const root = config.root
  const entriesDir = join(root, 'entries')
  const groupsDir = join(root, 'groups')

  // Ensure directories exist.
  await mkdir(entriesDir, { recursive: true })
  await mkdir(groupsDir, { recursive: true })

  // Hydrate from disk.
  const entries = await loadEntries(entriesDir)
  const groups = await loadGroups(groupsDir)
  ctx.knowledge.hydrate(entries, groups)

  // Coalesce bursts of `knowledge/change`: a change arriving mid-flush marks the
  // store dirty and the running flush loop re-runs, so the final disk state is
  // never dropped by an overlapping change.
  let writing = false
  let dirty = false
  const scheduleFlush = (): void => {
    if (writing) {
      dirty = true
      return
    }
    writing = true
    void (async () => {
      do {
        dirty = false
        await flushAll(ctx, entriesDir, groupsDir)
        // oxlint-disable-next-line typescript/no-unnecessary-condition
      } while (dirty)
    })().finally(() => { writing = false })
  }
  ctx.on('knowledge/change', scheduleFlush)
}

/** Load all entry JSON files from a directory. */
async function loadEntries(dir: string): Promise<KnowledgeEntry[]> {
  const entries: KnowledgeEntry[] = []
  let files: string[]
  try {
    files = await readdir(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return entries
    throw error
  }
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    try {
      const raw = await readFile(join(dir, file), 'utf8')
      const parsed = JSON.parse(raw) as KnowledgeEntry
      entries.push(parsed)
    } catch {
      // Malformed file: the store re-creates it on the next write.
    }
  }
  return entries
}

/** Load all group JSON files from a directory. */
async function loadGroups(dir: string): Promise<KnowledgeGroup[]> {
  const groups: KnowledgeGroup[] = []
  let files: string[]
  try {
    files = await readdir(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return groups
    throw error
  }
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    try {
      const raw = await readFile(join(dir, file), 'utf8')
      const parsed = JSON.parse(raw) as KnowledgeGroup
      groups.push(parsed)
    } catch {
      // Malformed file: the store re-creates it on the next write.
    }
  }
  return groups
}

/** Write the full store state to disk. */
async function flushAll(ctx: Context, entriesDir: string, groupsDir: string): Promise<void> {
  try {
    const entries = ctx.knowledge.listEntries()
    const groups = ctx.knowledge.listGroups()

    // Write entries.
    const entryFiles = new Set<string>()
    for (const entry of entries) {
      const file = `${entry.id}.json`
      entryFiles.add(file)
      await writeFile(join(entriesDir, file), JSON.stringify(entry, null, 2) + '\n', 'utf8')
    }
    // Remove entry files that no longer exist in the store.
    await removeStaleFiles(entriesDir, entryFiles)

    // Write groups.
    const groupFiles = new Set<string>()
    for (const group of groups) {
      const file = `${group.id}.json`
      groupFiles.add(file)
      await writeFile(join(groupsDir, file), JSON.stringify(group, null, 2) + '\n', 'utf8')
    }
    await removeStaleFiles(groupsDir, groupFiles)
  } catch (error) {
    ctx.logger.warn('knowledge-file: flush failed')
    ctx.logger.warn(error)
  }
}

/** Remove files in a directory that are not in the keep set (best-effort). */
async function removeStaleFiles(dir: string, keep: Set<string>): Promise<void> {
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return
  }
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    if (!keep.has(file)) {
      try {
        await unlink(join(dir, file))
      } catch {
        // Best-effort cleanup; a missing file is already gone.
      }
    }
  }
}
