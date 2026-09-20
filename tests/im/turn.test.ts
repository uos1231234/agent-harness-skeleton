import { describe, expect, it } from 'vitest'

import { turnToMessage, appendCanonicalTurn, mintTurnId } from '../../src/im/turn.js'
import { ConversationMemory } from '../../src/im/conversation-memory.js'

describe('turn', () => {
  it('mints prefixed unique ids', () => {
    const a = mintTurnId('tool')
    const b = mintTurnId('tool')
    expect(a.startsWith('tool-')).toBe(true)
    expect(a).not.toBe(b)
  })

  it('translates user / assistant / tool turns to wire messages', () => {
    expect(turnToMessage({ id: 'u', role: 'user', content: 'hi', at: 0 })).toEqual({ role: 'user', content: 'hi' })
    expect(turnToMessage({ id: 'a', role: 'assistant', content: 'yo', at: 0 })).toEqual({ role: 'assistant', content: 'yo' })
    expect(
      turnToMessage({ id: 't', role: 'tool', toolCallId: 'call-1', name: 'echo', content: '{}', at: 0 }),
    ).toEqual({ role: 'tool', tool_call_id: 'call-1', content: '{}' })
  })

  it('appends to the canonical conversation', () => {
    const memory = new ConversationMemory()
    appendCanonicalTurn(memory, { id: 'u', role: 'user', content: 'hi', at: 0 })
    expect(memory.turns()).toHaveLength(1)
  })
})
