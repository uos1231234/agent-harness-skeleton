import { describe, expect, it } from 'vitest'

import { runIMLoop } from '../../src/im/loop.js'
import { ConversationMemory } from '../../src/im/conversation-memory.js'
import { ToolRegistry } from '../../src/shell/registry.js'
import { createConfig } from '../../src/shell/config.js'
import { createMetrics } from '../../src/shell/metrics.js'
import type { SecurityDoor } from '../../src/security/types.js'
import type { StreamChunk, ChatCompletionResponse } from '../../src/protocol/types.js'

const fakeStreamChat = (responses: ChatCompletionResponse[]) => {
  let i = 0
  return async function* (): AsyncIterable<StreamChunk> {
    const resp = responses[Math.min(i, responses.length - 1)]!
    i += 1
    const msg = resp.choices[0]?.message
    if (typeof msg?.content === 'string' && msg.content.length > 0) {
      yield { type: 'content_delta', text: msg.content }
    }
    for (const tc of msg?.tool_calls ?? []) {
      yield { type: 'tool_call_delta', index: 0, id: tc.id, name: tc.function.name, arguments_delta: tc.function.arguments }
    }
    yield { type: 'finish', reason: resp.choices[0]?.finish_reason ?? 'stop' }
    if (resp.usage) yield { type: 'usage', usage: resp.usage }
    yield { type: 'done' }
  }
}

const contentResponse = (text: string, usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 }): ChatCompletionResponse => ({
  id: 'r1',
  model: 'gpt-4',
  choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
  usage,
})

const toolCallResponse = (): ChatCompletionResponse => ({
  id: 'r1',
  model: 'gpt-4',
  choices: [{
    index: 0,
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'echo', arguments: '{"x":"hi"}' } }],
    },
    finish_reason: 'tool_calls',
  }],
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
})

const echoRegistry = (): ToolRegistry => {
  const registry = new ToolRegistry()
  registry.registerSystemTool({
    name: 'echo',
    description: 'echoes its argument',
    parameters: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
    execute: async (args) => ({ echo: (args as { x: string }).x }),
  })
  return registry
}

describe('runIMLoop', () => {
  it('terminates as completed when the model returns content', async () => {
    const memory = new ConversationMemory()
    memory.append({ id: 'user-1', role: 'user', content: 'hi', at: Date.now() })

    const result = await runIMLoop({
      config: createConfig(),
      registry: echoRegistry(),
      conversationMemory: memory,
      initialMetrics: createMetrics(),
      streamChat: fakeStreamChat([contentResponse('hello')]),
      url: 'https://x',
      model: 'gpt-4',
      systemPrompt: 'SYS',
    })

    expect(result.reason).toBe('completed')
    expect(result.finalState).toBe('Running')
    expect(result.turns).toBe(1)
    expect(memory.turns()).toHaveLength(2)
    expect(memory.last()).toMatchObject({ role: 'assistant', content: 'hello' })
  })

  it('executes registered tools and appends tool turns', async () => {
    const memory = new ConversationMemory()
    memory.append({ id: 'user-1', role: 'user', content: 'hi', at: Date.now() })

    const result = await runIMLoop({
      config: createConfig(),
      registry: echoRegistry(),
      conversationMemory: memory,
      initialMetrics: createMetrics(),
      streamChat: fakeStreamChat([toolCallResponse(), contentResponse('done')]),
      url: 'https://x',
      model: 'gpt-4',
      systemPrompt: 'SYS',
    })

    expect(result.reason).toBe('completed')
    expect(result.turns).toBe(2)
    const roles = memory.turns().map((t) => t.role)
    expect(roles).toEqual(['user', 'assistant', 'tool', 'assistant'])
    const toolTurn = memory.turns()[2]!
    expect(toolTurn).toMatchObject({ role: 'tool', name: 'echo', toolCallId: 'call-1' })
    expect(toolTurn.role === 'tool' && JSON.parse(toolTurn.content)).toEqual({ echo: 'hi' })
  })

  it('terminates as guard-tripped when the token guard trips', async () => {
    const result = await runIMLoop({
      config: createConfig({ maxTokens: 5 }),
      registry: echoRegistry(),
      conversationMemory: new ConversationMemory(),
      initialMetrics: createMetrics(),
      streamChat: fakeStreamChat([contentResponse('big', { promptTokens: 100, completionTokens: 100, totalTokens: 200 })]),
      url: 'https://x',
      model: 'gpt-4',
      systemPrompt: 'SYS',
    })

    expect(result.reason).toBe('guard-tripped')
    expect(result.finalState).toBe('Tripped')
    expect(result.hits.map((h) => h.id)).toContain('token')
  })

  it('gates tool calls through security doors (rejection becomes an error turn)', async () => {
    const registry = echoRegistry()
    const blockingDoor: SecurityDoor = {
      name: 'block-echo',
      check: () => ({ allow: false, reason: 'blocked by test' }),
    }
    registry.registerDoor(blockingDoor)

    const memory = new ConversationMemory()
    memory.append({ id: 'user-1', role: 'user', content: 'hi', at: Date.now() })

    const result = await runIMLoop({
      config: createConfig(),
      registry,
      conversationMemory: memory,
      initialMetrics: createMetrics(),
      streamChat: fakeStreamChat([toolCallResponse(), contentResponse('recovered')]),
      url: 'https://x',
      model: 'gpt-4',
      systemPrompt: 'SYS',
    })

    expect(result.reason).toBe('completed')
    const toolTurn = memory.turns()[2]!
    expect(toolTurn.role === 'tool' && toolTurn.isError).toBe(true)
    expect(toolTurn.role === 'tool' && toolTurn.content).toContain('block-echo')
  })

  it('records an error turn for unregistered tools', async () => {
    const memory = new ConversationMemory()
    memory.append({ id: 'user-1', role: 'user', content: 'hi', at: Date.now() })

    const result = await runIMLoop({
      config: createConfig(),
      registry: new ToolRegistry(),
      conversationMemory: memory,
      initialMetrics: createMetrics(),
      streamChat: fakeStreamChat([toolCallResponse(), contentResponse('ok')]),
      url: 'https://x',
      model: 'gpt-4',
      systemPrompt: 'SYS',
    })

    expect(result.reason).toBe('completed')
    const toolTurn = memory.turns()[2]!
    expect(toolTurn.role === 'tool' && toolTurn.isError).toBe(true)
    expect(toolTurn.role === 'tool' && toolTurn.content).toContain('not registered')
  })
})
