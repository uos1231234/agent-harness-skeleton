// Signal Gate — createSignalGate implementation (types见 types.ts, skeleton edition).
//
//   - emit/on: kind-filtered synchronous broadcast; subscriber throws are
//     swallowed with a warning (one bad subscriber must not break the stream).
//   - request/resolve: request mints a requestId → broadcasts the full
//     GateRequest → parks a promise; resolve lands the reply. Timeout
//     (default 300s) fails closed: reject + cleanup; late replies are
//     silently ignored (expected timing, not an anomaly).
//   - command: routes to host-injected handlers. approval.decision /
//     ask_user.answer are reply forms of requests — routed into resolve.
//   - snapshot: reports only the gate's own state.
//
// Session-level serialization: the gate is the single front/back relay, so
// concurrency control lives here — turns within ONE session are serialized
// (queued, never dropped), while different sessions run in parallel.

import { randomUUID } from 'node:crypto'

import { createSessionQueue } from './session-queue.js'
import type { QueuedPromptReceipt } from './session-queue.js'
import { createChunkMode } from './chunk-mode.js'
import { splitChunk, DEFAULT_CHUNK_TOKENS } from './chunk.js'
import type {
  GateCommand,
  GateRequest,
  GateRequestInput,
  GateSignal,
  GateSnapshot,
  GateSubscriptionKind,
  GateSubscriber,
  SignalGate,
  SignalGateHandlers,
} from './types.js'

const DEFAULT_REQUEST_TIMEOUT_MS = 300_000

export type SignalGateOptions = {
  requestTimeoutMs?: number | undefined
  handlers: SignalGateHandlers
}

type PendingRequest = {
  resolve: (payload: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export const createSignalGate = (opts: SignalGateOptions): SignalGate => {
  const handlers = opts.handlers
  const defaultTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS

  const subscribers = new Map<GateSubscriptionKind, GateSubscriber[]>()
  const pending = new Map<string, PendingRequest>()
  const sessions = new Set<string>()
  let emitted = 0

  const queue = createSessionQueue()
  const chunkMode = createChunkMode()

  const emitQueueState = (sessionId: string): void => {
    emit({ kind: 'turn.queue', sessionId, pending: queue.pending(sessionId) })
  }

  const startTurn = (sessionId: string, text: string, warnOnFailure = false): Promise<unknown> => {
    const p = handlers.runPrompt(sessionId, text)
    void p.catch((e: unknown) => {
      if (warnOnFailure) {
        console.warn('[signal-gate] queued prompt failed', {
          sessionId,
          err: e instanceof Error ? e.message : String(e),
        })
      }
      advanceQueue(sessionId)
    })
    return p
  }

  const advanceQueue = (sessionId: string): void => {
    const next = queue.finish(sessionId)
    emitQueueState(sessionId)
    if (next === undefined) return
    void startTurn(sessionId, next, true)
  }

  const enqueueChunks = (sessionId: string, parts: string[]): { next: string; chunks: number } => {
    let next = ''
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i]!
      queue.begin(sessionId, part)
      if (i === 0) next = part
    }
    emitQueueState(sessionId)
    return { next, chunks: parts.length }
  }

  const countSubscribers = (): number => {
    let n = 0
    for (const list of subscribers.values()) n += list.length
    return n
  }

  const dispatch = (sig: GateSignal | GateRequest): void => {
    if ('sessionId' in sig && typeof sig.sessionId === 'string') sessions.add(sig.sessionId)
    const targets = [...(subscribers.get(sig.kind) ?? []), ...(subscribers.get('*') ?? [])]
    for (const cb of targets) {
      try {
        cb(sig)
      } catch (e) {
        console.warn('[signal-gate] subscriber threw', {
          kind: sig.kind,
          err: e instanceof Error ? e.message : String(e),
        })
      }
    }
  }

  const emit = (sig: GateSignal): void => {
    emitted++
    dispatch(sig)
    if (sig.kind === 'turn.end') advanceQueue(sig.sessionId)
  }

  const on = (kind: GateSubscriptionKind, cb: GateSubscriber): (() => void) => {
    const list = subscribers.get(kind) ?? []
    list.push(cb)
    subscribers.set(kind, list)
    return () => {
      const cur = subscribers.get(kind)
      if (cur === undefined) return
      const idx = cur.indexOf(cb)
      if (idx >= 0) cur.splice(idx, 1)
    }
  }

  const request = (input: GateRequestInput, reqOpts?: { timeoutMs?: number | undefined }): Promise<unknown> => {
    const requestId = `req-${randomUUID()}`
    const timeoutMs = reqOpts?.timeoutMs ?? defaultTimeoutMs
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error(`Signal gate request "${input.kind}" (${requestId}) timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      pending.set(requestId, { resolve, reject, timer })
      dispatch({ ...input, requestId })
    })
  }

  const resolve = (requestId: string, payload: unknown): void => {
    const p = pending.get(requestId)
    if (p === undefined) return
    clearTimeout(p.timer)
    pending.delete(requestId)
    p.resolve(payload)
  }

  const command = async (cmd: GateCommand): Promise<unknown> => {
    switch (cmd.kind) {
      case 'user.prompt': {
        sessions.add(cmd.sessionId)
        const chunkTokens = chunkMode.tokensOf(cmd.sessionId)
        if (chunkTokens !== undefined && cmd.text.length > chunkTokens) {
          const parts = splitChunk(cmd.text, chunkTokens)
          const { next } = enqueueChunks(cmd.sessionId, parts)
          await startTurn(cmd.sessionId, next)
          return { chunked: true, chunks: parts.length }
        }
        const outcome = queue.begin(cmd.sessionId, cmd.text)
        if (outcome.kind === 'queued') {
          emitQueueState(cmd.sessionId)
          const receipt: QueuedPromptReceipt = { queued: true, position: outcome.position }
          return receipt
        }
        return startTurn(cmd.sessionId, cmd.text)
      }
      case 'session.create':
        return handlers.session.create(cmd.payload)
      case 'session.open':
        sessions.add(cmd.sessionId)
        return handlers.session.open(cmd.sessionId)
      case 'session.close':
        queue.forget(cmd.sessionId)
        chunkMode.forget(cmd.sessionId)
        emitQueueState(cmd.sessionId)
        sessions.delete(cmd.sessionId)
        return handlers.session.close(cmd.sessionId)
      case 'session.delete':
        queue.forget(cmd.sessionId)
        chunkMode.forget(cmd.sessionId)
        emitQueueState(cmd.sessionId)
        sessions.delete(cmd.sessionId)
        return handlers.session.delete(cmd.sessionId)
      case 'session.list':
        return handlers.session.list()
      case 'turn.cancel':
        sessions.add(cmd.sessionId)
        queue.dropPending(cmd.sessionId)
        emitQueueState(cmd.sessionId)
        handlers.cancel(cmd.sessionId)
        return undefined
      case 'approval.decision':
        resolve(cmd.requestId, cmd.decision)
        return undefined
      case 'ask_user.answer': {
        const payload = cmd.cancelled === true
          ? { answers: [], cancelled: true }
          : { answers: cmd.answers }
        resolve(cmd.requestId, payload)
        return undefined
      }
      case 'permission.full':
        sessions.add(cmd.sessionId)
        handlers.setFullPermission(cmd.sessionId, cmd.enabled)
        return undefined
      case 'chunk.set': {
        const wasEnabled = chunkMode.isEnabled(cmd.sessionId)
        if (cmd.enabled) {
          chunkMode.enable(cmd.sessionId, cmd.chunkTokens)
        } else {
          chunkMode.disable(cmd.sessionId)
        }
        sessions.add(cmd.sessionId)
        emit({
          kind: 'chunk.changed',
          sessionId: cmd.sessionId,
          enabled: cmd.enabled,
          ...(cmd.enabled ? { chunkTokens: cmd.chunkTokens ?? DEFAULT_CHUNK_TOKENS } : {}),
        })
        return { enabled: cmd.enabled, changed: wasEnabled !== cmd.enabled }
      }
      case 'chunk.get': {
        const t = chunkMode.tokensOf(cmd.sessionId)
        return { enabled: t !== undefined, chunkTokens: t }
      }
      default: {
        const _exhaustive: never = cmd
        throw new Error(`Signal gate: unknown command ${JSON.stringify(_exhaustive)}`)
      }
    }
  }

  const snapshot = (): GateSnapshot => ({
    sessions: [...sessions].sort(),
    pendingRequests: pending.size,
    subscribers: countSubscribers(),
    emitted,
  })

  return { emit, on, request, resolve, command, snapshot }
}
