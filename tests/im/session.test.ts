import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { createSessionManager } from '../../src/im/session/index.js'
import { recoverSession } from '../../src/im/session/index.js'

const dir = mkdtempSync(join(tmpdir(), 'harness-session-'))

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('session layer', () => {
  it('creates, persists, reopens, lists and deletes sessions', () => {
    const manager = createSessionManager({ dir })

    const handle = manager.create()
    expect(manager.store.exists(handle.sessionId)).toBe(true)

    handle.conversationMemory.append({ id: 'u', role: 'user', content: 'hi', at: Date.now() })
    manager.store.append(handle.sessionId, { id: 'u', role: 'user', content: 'hi', at: Date.now() })

    const reopened = manager.open(handle.sessionId)
    expect(reopened.conversationMemory.turns()).toHaveLength(1)

    expect(manager.list().map((s) => s.sessionId)).toContain(handle.sessionId)

    expect(recoverSession(manager.store, handle.sessionId)?.turns).toHaveLength(1)
    expect(recoverSession(manager.store, randomUUID())).toBeNull()

    expect(manager.delete(handle.sessionId)).toBe(true)
    expect(manager.store.exists(handle.sessionId)).toBe(false)
  })

  it('prunes expired snapshots', () => {
    const manager = createSessionManager({ dir })
    const handle = manager.create()
    const file = join(dir, `${handle.sessionId}.jsonl`)
    const past = new Date(Date.now() - 60_000)
    utimesSync(file, past, past)
    expect(manager.pruneExpiredSnapshots(30_000)).toBe(1)
    expect(manager.store.exists(handle.sessionId)).toBe(false)
  })
})
