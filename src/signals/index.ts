// Signal gate public surface (skeleton edition).

export { createSignalGate } from './gate.js'
export type { SignalGateOptions } from './gate.js'
export { createSessionQueue } from './session-queue.js'
export type { QueuedPromptReceipt } from './session-queue.js'
export { splitChunk, DEFAULT_CHUNK_TOKENS } from './chunk.js'
export type {
  SignalGate,
  SignalGateHandlers,
  SignalGateSessionHandlers,
  GateSignal,
  GateRequest,
  GateRequestInput,
  GateCommand,
  GateSubscriptionKind,
  GateSubscriber,
  GateSnapshot,
} from './types.js'
