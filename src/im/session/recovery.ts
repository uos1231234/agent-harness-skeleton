// recoverSession: load a persisted session's turns from the store.
// Returns null when the session does not exist on disk.

import type { SessionStore } from './session-store.js'
import type { ConversationTurn } from '../conversation-memory.js'

export const recoverSession = (
  store: SessionStore,
  sessionId: string,
): { turns: ConversationTurn[] } | null =>
  store.exists(sessionId) ? { turns: store.load(sessionId) } : null
