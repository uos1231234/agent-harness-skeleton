// The IM main loop (skeleton edition). This is the orchestrator.
//
// The shell is a "valve" + guard-runner, the protocol is the "delivery
// mechanism", the registry is the "tool phonebook", the conversation memory
// is the canonical history. IM is the agent's brain.
//
// Loop shape per round:
//   compose(system + history + tools) → shellCall (gate → protocol) →
//   advanceElapsed → runGuards (trip ⇒ terminate) →
//   tool calls ⇒ execute via registry → append turns → next round
//   no tool calls ⇒ append assistant turn → terminate 'completed'
//
// Invariants (enforced by tests):
//   1. The loop always terminates: completed / guard-tripped / protocol-error /
//      shell-terminated. No infinite loop.
//   2. Tripped state never enters the prompt (it is a control signal for the
//      caller only, returned in IMLoopResult).
//   3. Tool execution goes through ToolRegistry.execute — security doors run
//      inside the registry, so every tool call is gated.
//   4. ProtocolError is retried at most MAX_PROTOCOL_ERROR_RETRIES times with
//      exponential backoff, then terminates as 'protocol-error'.

import type { ToolRegistry } from '../shell/registry.js'
import type { ShellConfig } from '../shell/config.js'
import { shellCall } from '../shell/call.js'
import { compose, type PromptPart } from '../shell/compose.js'
import type { State } from '../shell/state.js'
import { runGuards, type GuardHit } from '../shell/guards.js'
import { ShellTerminatedError } from '../shell/gate.js'
import {
  createMetrics,
  addToolError,
  resetToolErrors,
  type Metrics,
} from '../shell/metrics.js'
import type { StreamChunk, ToolCall } from '../protocol/types.js'
import { ProtocolError } from '../protocol/types.js'
import { parseToolCallArguments } from '../protocol/tool-calls.js'
import { ConversationMemory } from './conversation-memory.js'
import { turnToMessage, appendCanonicalTurn, mintTurnId } from './turn.js'
import type { ToolContext } from '../shared/tool-context.js'
import type { Logger } from '../shared/logger.js'
import { defaultLogger } from '../shared/logger.js'

const MAX_PROTOCOL_ERROR_RETRIES = 3
const PROTOCOL_ERROR_RETRY_BASE_MS = 1000

export type IMLoopOptions = {
  config: ShellConfig
  registry: ToolRegistry
  conversationMemory: ConversationMemory
  streamChat: (
    url: string,
    request: { model: string; messages: ReturnType<typeof compose>['messages']; tools?: ReturnType<typeof compose>['tools']; [k: string]: unknown },
  ) => AsyncIterable<StreamChunk>
  url: string
  model: string
  systemPrompt: string
  /** Templated user prompt (becomes the first user message). */
  userTemplate?: string
  workingAgentId?: string
  /** Security session identifier (per-session approval isolation). */
  sessionId?: string
  initialMetrics?: Metrics
  signal?: AbortSignal
  logger?: Logger
  /** Streaming delta observer (pure observation; does not change aggregation). */
  onStreamChunk?: ((chunk: StreamChunk) => void) | undefined
  strictAlternation?: boolean | undefined
}

export type IMLoopResult = {
  terminated: boolean
  reason: 'completed' | 'guard-tripped' | 'protocol-error' | 'shell-terminated'
  finalState: State
  hits: GuardHit[]
  turns: number
  metrics: Metrics
}

export const advanceElapsed = (m: Metrics, loopStart: number, now: number): Metrics => ({
  ...m,
  elapsedMs: now - loopStart,
})

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export const runIMLoop = async (opts: IMLoopOptions): Promise<IMLoopResult> => {
  const logger = opts.logger ?? defaultLogger
  const memory = opts.conversationMemory
  const agentId = opts.workingAgentId ?? 'main'
  const loopStart = Date.now()

  let state: State = 'Running'
  let metrics = opts.initialMetrics ?? createMetrics()
  let turns = 0
  let protocolErrorRetries = 0

  const toolSchemas = opts.registry.toOpenAIToolSchemas()

  for (;;) {
    if (opts.signal?.aborted === true) {
      return { terminated: true, reason: 'shell-terminated', finalState: state, hits: [], turns, metrics }
    }

    const parts: PromptPart[] = [
      { type: 'system', content: opts.systemPrompt },
      ...memory.turns().map((t): PromptPart => ({ type: 'turn', message: turnToMessage(t) })),
      ...(opts.userTemplate !== undefined ? [{ type: 'userTemplate', content: opts.userTemplate } as PromptPart] : []),
    ]
    const composed = compose(opts.registry, parts)
    const prompt = toolSchemas.length > 0 ? { ...composed, tools: toolSchemas } : composed

    let call
    try {
      call = await shellCall(
        {
          config: opts.config,
          registry: opts.registry,
          state,
          metrics,
          streamChat: opts.streamChat,
          url: opts.url,
          model: opts.model,
          ...(opts.onStreamChunk !== undefined ? { onStreamChunk: opts.onStreamChunk } : {}),
          ...(opts.strictAlternation !== undefined ? { strictAlternation: opts.strictAlternation } : {}),
        },
        prompt,
      )
    } catch (e) {
      if (e instanceof ShellTerminatedError) {
        return { terminated: true, reason: 'shell-terminated', finalState: e.state, hits: e.hits, turns, metrics }
      }
      if (e instanceof ProtocolError && protocolErrorRetries < MAX_PROTOCOL_ERROR_RETRIES) {
        protocolErrorRetries += 1
        await sleep(PROTOCOL_ERROR_RETRY_BASE_MS * 2 ** (protocolErrorRetries - 1))
        continue
      }
      logger.error('im.loop protocol error', { err: e instanceof Error ? e.message : String(e) })
      return { terminated: true, reason: 'protocol-error', finalState: state, hits: [], turns, metrics }
    }

    metrics = advanceElapsed(call.updatedMetrics, loopStart, Date.now())
    protocolErrorRetries = 0
    turns += 1

    const hits = runGuards(metrics, opts.config)
    if (hits.length > 0) {
      state = 'Tripped'
      return { terminated: true, reason: 'guard-tripped', finalState: state, hits, turns, metrics }
    }

    const toolCalls: ToolCall[] = call.toolCalls
    const assistantContent = call.response.choices[0]?.message.content ?? null

    if (toolCalls.length === 0) {
      appendCanonicalTurn(memory, {
        id: mintTurnId('assistant'),
        role: 'assistant',
        content: assistantContent,
        at: Date.now(),
      })
      return { terminated: true, reason: 'completed', finalState: state, hits: [], turns, metrics }
    }

    appendCanonicalTurn(memory, {
      id: mintTurnId('assistant'),
      role: 'assistant',
      content: assistantContent,
      toolCalls,
      at: Date.now(),
    })

    const ctx: ToolContext = {
      agentId,
      ...(opts.sessionId !== undefined ? { sessionId: opts.sessionId } : {}),
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    }

    let hadError = false
    for (const callItem of toolCalls) {
      const parsed = parseToolCallArguments(callItem.function.arguments)
      let output: unknown
      let isError = false
      if (!parsed.ok) {
        output = `Tool "${callItem.function.name}" failed: arguments are not a valid JSON object`
        isError = true
      } else {
        try {
          output = await opts.registry.execute(callItem.function.name, parsed.value, ctx)
        } catch (e) {
          output = `Tool "${callItem.function.name}" failed: ${e instanceof Error ? e.message : String(e)}`
          isError = true
        }
      }
      appendCanonicalTurn(memory, {
        id: mintTurnId('tool'),
        role: 'tool',
        toolCallId: callItem.id,
        name: callItem.function.name,
        content: typeof output === 'string' ? output : JSON.stringify(output),
        ...(isError ? { isError: true } : {}),
        at: Date.now(),
      })
      if (isError) hadError = true
    }

    metrics = hadError ? addToolError(metrics) : resetToolErrors(metrics)
  }
}
