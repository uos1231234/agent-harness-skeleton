// Trigger the token guard and watch the loop terminate.
// Demonstrates the "funnel" pattern: guard trip → shell.call never reaches
// the protocol.

import { runIMLoop } from '../src/im/loop.js'
import { ConversationMemory } from '../src/im/conversation-memory.js'
import { ToolRegistry } from '../src/shell/registry.js'
import { createConfig } from '../src/shell/config.js'
import { createMetrics } from '../src/shell/metrics.js'
import type { StreamChunk, ChatCompletionResponse } from '../src/protocol/types.js'

const fakeStreamChat = (resp: ChatCompletionResponse) =>
  async function* (): AsyncIterable<StreamChunk> {
    const msg = resp.choices[0]?.message
    if (typeof msg?.content === 'string' && msg.content.length > 0) {
      yield { type: 'content_delta', text: msg.content }
    }
    yield { type: 'finish', reason: resp.choices[0]?.finish_reason ?? 'stop' }
    if (resp.usage) yield { type: 'usage', usage: resp.usage }
    yield { type: 'done' }
  }

const result = await runIMLoop({
  config: createConfig({ maxTokens: 5 }), // very low limit
  registry: new ToolRegistry(),
  conversationMemory: new ConversationMemory(),
  initialMetrics: createMetrics(),
  streamChat: fakeStreamChat({
    id: 'r1',
    model: 'gpt-4',
    choices: [{ index: 0, message: { role: 'assistant', content: 'big response' }, finish_reason: 'stop' }],
    usage: { promptTokens: 100, completionTokens: 100, totalTokens: 200 }, // 200 > 5
  }),
  url: 'https://x',
  model: 'gpt-4',
  systemPrompt: 'SYS',
  userTemplate: 'T',
})

console.log('result:', result)
console.log('expected: reason="guard-tripped", finalState="Tripped", hits has token')
