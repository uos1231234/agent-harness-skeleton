// A Turn is IM's representation of one conversational step (skeleton edition).
//
// turnToMessage is the only place where Turn → OpenAI ChatMessage conversion
// happens, so the rest of the IM and the shell.compose layer stay decoupled
// from the protocol's wire format.

import { randomUUID } from 'node:crypto'
import type { ToolCall, ChatMessage } from '../protocol/types.js'
import type { ConversationTurn, ConversationMemory, ToolTurn } from './conversation-memory.js'

export type { ToolTurn, ConversationTurn, ConversationMemory }

export type Turn = ConversationTurn

export const mintTurnId = (prefix: string): string => `${prefix}-${randomUUID()}`

export const turnToMessage = (turn: ConversationTurn): ChatMessage => {
  switch (turn.role) {
    case 'user':
      return { role: 'user', content: turn.content }
    case 'assistant': {
      const msg: { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] } = {
        role: 'assistant',
        content: turn.content,
      }
      if (turn.toolCalls !== undefined) msg.tool_calls = turn.toolCalls
      return msg
    }
    case 'tool':
      return { role: 'tool', tool_call_id: turn.toolCallId, content: turn.content }
  }
}

export function appendCanonicalTurn(
  conversation: ConversationMemory,
  turn: ConversationTurn,
): void {
  conversation.append(turn)
}
