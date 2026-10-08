/**
 * Reading the console sidebar action's registered inject face back out of the
 * slot registry.
 *
 * `StoredEntry.inject` is the registry's type-erased view of the registration
 * (`(...args: never[]) => Record<string, unknown>`): entries are stored without
 * the declaration's generics, so the erased record has to be checked against
 * the face the plugin actually declares before a spec may drive it. Every spec
 * that drives the face reads it through {@link consoleFace}, so the declared
 * type is named once instead of restated at each call site.
 */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ConsoleInjectFace } from '../../src/client/ConsoleButton.tsx'

/** The registered face members that are not live sources. */
const FACE_MEMBERS = ['store', 'services', 'composerActions', 'chat', 'defaultModel'] as const

/** The `hooks` compartment's members, each a live source. */
const HOOK_MEMBERS = ['console', 'prices', 'messages', 'composer'] as const

/** Whether a value is a non-null object, the only form the erased members take. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Whether one `hooks` member carries the two members of a live source. */
function isLiveSource(value: unknown): value is HostObservable<unknown> {
  return isRecord(value) && typeof value['getSnapshot'] === 'function' && typeof value['subscribe'] === 'function'
}

/**
 * Whether an erased registration record carries the console face's members
 * with the kind each one declares.
 * @param raw - the value the entry's `inject` factory returned.
 * @returns whether `raw` is the console face rather than some other entry's.
 */
function isConsoleFace(raw: Record<string, unknown>): raw is ConsoleInjectFace & Record<string, unknown> {
  const hooks = raw['hooks']
  if (!isRecord(hooks)) return false
  const covered = HOOK_MEMBERS.every(name => isLiveSource(hooks[name]))
    && FACE_MEMBERS.every(name => name in raw)
  return covered && typeof raw['chat'] === 'function'
}

/**
 * Read the console sidebar action's injected face from the registry.
 * @param slots - live slot registry holding the console's registration.
 * @returns the face `apply` registers, in its declared type.
 * @throws when the sidebar action is unregistered or its entry carries no console face.
 */
export function consoleFace(slots: SlotRegistry): ConsoleInjectFace {
  const entry = slots.entries('sidebar.footer.action')[0]
  const inject = entry?.inject
  if (inject === undefined) {
    throw new Error('ui-console spec: the console sidebar action is not registered')
  }
  const raw = inject()
  if (!isConsoleFace(raw)) {
    throw new Error('ui-console spec: the sidebar footer action entry carries no console inject face')
  }
  return raw
}
