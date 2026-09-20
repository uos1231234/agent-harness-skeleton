// Session layer types (skeleton edition).

import type { ConversationMemory } from '../conversation-memory.js'

export type SessionId = string

export type SessionInfo = {
  sessionId: SessionId
  createdAt: number
  updatedAt: number
}

export type SessionHandle = {
  sessionId: SessionId
  conversationMemory: ConversationMemory
  createdAt: number
  updatedAt: number
}
