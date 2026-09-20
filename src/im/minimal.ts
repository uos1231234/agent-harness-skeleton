// createMinimalIM: wrap partial options with the skeleton's defaults.
//
// The caller still provides config, registry, streamChat, url, model, and
// systemPrompt. Each call mints a fresh security session id (one call = one
// session), so permission grants never leak across loops that share a registry.

import { randomUUID } from 'node:crypto'
import { ConversationMemory } from './conversation-memory.js'
import type { IMLoopOptions } from './loop.js'

export const createMinimalIM = (opts: {
  config: IMLoopOptions['config']
  registry: IMLoopOptions['registry']
  streamChat: IMLoopOptions['streamChat']
  url: string
  model: string
  systemPrompt: string
  userTemplate?: string
  conversationMemory?: ConversationMemory
  workingAgentId?: string
  sessionId?: string
  signal?: AbortSignal
  logger?: IMLoopOptions['logger']
}): IMLoopOptions => {
  const securitySessionId = opts.sessionId ?? randomUUID()
  return {
    config: opts.config,
    registry: opts.registry,
    conversationMemory: opts.conversationMemory ?? new ConversationMemory(),
    streamChat: opts.streamChat,
    url: opts.url,
    model: opts.model,
    systemPrompt: opts.systemPrompt,
    ...(opts.userTemplate !== undefined ? { userTemplate: opts.userTemplate } : {}),
    workingAgentId: opts.workingAgentId ?? 'main',
    sessionId: securitySessionId,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
  }
}
