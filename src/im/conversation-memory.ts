// The canonical ordered conversation sequence (skeleton edition).
//
// ConversationMemory is the single source of truth for the working prompt:
// user, assistant, AND tool turns in exact append order. There is no second
// projection store — the full result lives in the canonical sequence.

import type { ToolCall, ContentPart } from '../protocol/types.js'

export type ToolTurn = {
  id: string
  role: 'tool'
  toolCallId: string
  name: string
  content: string
  isError?: boolean
  at: number
}

export type ConversationTurn =
  | { id: string; role: 'user'; content: string | ContentPart[]; at: number }
  | { id: string; role: 'assistant'; content: string | null; toolCalls?: ToolCall[]; at: number }
  | ToolTurn

export class ConversationMemory {
  private readonly stored: ConversationTurn[] = []

  append(turn: ConversationTurn): void {
    this.stored.push(turn)
  }

  turns(): readonly ConversationTurn[] {
    return this.stored
  }

  last(): ConversationTurn | undefined {
    return this.stored[this.stored.length - 1]
  }
}
