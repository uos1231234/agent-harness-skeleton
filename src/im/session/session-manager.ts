// SessionManager: multi-session windows with per-session ConversationMemory
// and JSONL persistence (skeleton edition).
//
// One open handle per session; the store is the durable source of truth.
// Each session's conversation is independent — no cross-session leakage.

import { randomUUID } from 'node:crypto'

import { ConversationMemory } from '../conversation-memory.js'
import { SessionStore } from './session-store.js'
import type { SessionHandle, SessionId, SessionInfo } from './types.js'

export type SessionManager = {
  create: () => SessionHandle
  open: (sessionId: SessionId) => SessionHandle
  list: () => SessionInfo[]
  close: (sessionId: SessionId) => void
  delete: (sessionId: SessionId) => boolean
  pruneExpiredSnapshots: (maxAgeMs: number) => number
  store: SessionStore
}

export const createSessionManager = (opts: { dir: string }): SessionManager => {
  const store = new SessionStore(opts.dir)
  const handles = new Map<SessionId, SessionHandle>()

  return {
    create() {
      const sessionId = randomUUID()
      store.touch(sessionId)
      const handle: SessionHandle = {
        sessionId,
        conversationMemory: new ConversationMemory(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      handles.set(sessionId, handle)
      return handle
    },
    open(sessionId) {
      const existing = handles.get(sessionId)
      if (existing) return existing
      const memory = new ConversationMemory()
      for (const turn of store.load(sessionId)) memory.append(turn)
      const handle: SessionHandle = {
        sessionId,
        conversationMemory: memory,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      handles.set(sessionId, handle)
      return handle
    },
    list: () => store.list(),
    close(sessionId) {
      handles.delete(sessionId)
    },
    delete(sessionId) {
      handles.delete(sessionId)
      return store.delete(sessionId)
    },
    pruneExpiredSnapshots: (maxAgeMs) => store.pruneExpired(maxAgeMs),
    store,
  }
}
