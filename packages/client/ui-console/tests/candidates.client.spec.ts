import { describe, expect, it, vi } from 'vitest'
import { createComposerCandidates } from '../src/client/candidates.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** A Remote stub shaped only as far as the candidate source reaches into it. */
function fakeRemote(remote: {
  commands?: { list: (sessionId: SessionId) => Promise<unknown> }
  skills?: { list: (req: unknown, signal: AbortSignal) => Promise<unknown> }
  fileReferences?: { list: (sessionId: SessionId, query: string, signal: AbortSignal) => Promise<unknown> }
}) {
  return { remote } as unknown as Context
}

const SESSION = 's1' as SessionId
const signal = new AbortController().signal

describe('createComposerCandidates', () => {
  it('merges the command and skill catalogs into one ranked-agnostic `/` list', async () => {
    const ctx = fakeRemote({
      commands: { list: async () => ({ ok: true, value: [{ name: 'deploy', description: 'Ship it', input: { hint: 'env' } }] }) },
      skills: { list: async () => ({ ok: true, value: { skills: [{ name: 'pdf', description: 'PDF kit', modelInvocable: false }] } }) },
    })
    const list = await createComposerCandidates(ctx).commands(SESSION, signal)
    expect(list).toEqual([
      { name: 'deploy', description: 'Ship it', hasInput: true, origin: 'command' },
      { name: 'pdf', description: 'PDF kit', hasInput: false, origin: 'skill' },
    ])
  })

  it('folds a failed command catalog into an empty list rather than throwing', async () => {
    const listSpy = vi.fn().mockRejectedValue(new Error('offline'))
    const ctx = fakeRemote({ commands: { list: listSpy }, skills: { list: async () => ({ ok: false, error: { code: 'x', message: 'y' } }) } })
    expect(await createComposerCandidates(ctx).commands(SESSION, signal)).toEqual([])
  })

  it('maps file-reference candidates down to their path strings', async () => {
    const ctx = fakeRemote({ fileReferences: { list: async () => ({ ok: true, value: [{ path: 'src/a.ts', kind: 'file' }] }) } })
    expect(await createComposerCandidates(ctx).files(SESSION, 'a', signal)).toEqual(['src/a.ts'])
  })

  it('returns no files when the reference catalog cannot be reached', async () => {
    const ctx = fakeRemote({ fileReferences: { list: async () => { throw new Error('offline') } } })
    expect(await createComposerCandidates(ctx).files(SESSION, 'a', signal)).toEqual([])
  })
})
