// Signal gate types (skeleton edition).
//
// The gate is the front/back signal boundary: the harness core emits signals
// and routes commands; the host (CLI / web / headless) subscribes and answers
// requests. Host-specific command kinds (providers, wiki, goal mode, workflow,
// MCP settings, sub-agent settings) are intentionally absent — the skeleton
// ships the boundary, the host brings its own commands.

export type GateSignal =
  | { kind: 'turn.start'; sessionId: string }
  | { kind: 'turn.delta'; sessionId: string; text: string }
  | { kind: 'turn.end'; sessionId: string }
  | { kind: 'turn.queue'; sessionId: string; pending: number }
  | { kind: 'approval.request'; sessionId?: string; requestId: string; toolName: string; reason: string }
  | { kind: 'permission.changed'; sessionId: string; enabled: boolean }
  | { kind: 'chunk.changed'; sessionId: string; enabled: boolean; chunkTokens?: number }

export type GateSubscriptionKind = GateSignal['kind'] | GateRequestInput['kind'] | '*'

export type GateSubscriber = (sig: GateSignal | GateRequest) => void

export type GateRequestInput =
  | { kind: 'approval.request'; sessionId?: string; toolName: string; reason: string }
  | { kind: 'ask_user'; sessionId?: string; question: string }

export type GateRequest = GateRequestInput & { requestId: string }

export type GateCommand =
  | { kind: 'user.prompt'; sessionId: string; text: string }
  | { kind: 'turn.cancel'; sessionId: string }
  | { kind: 'approval.decision'; requestId: string; decision: 'approved' | 'rejected' }
  | { kind: 'ask_user.answer'; requestId: string; answers: string[]; cancelled?: boolean }
  | { kind: 'permission.full'; sessionId: string; enabled: boolean }
  | { kind: 'session.create'; payload: { title?: string } }
  | { kind: 'session.open'; sessionId: string }
  | { kind: 'session.close'; sessionId: string }
  | { kind: 'session.delete'; sessionId: string }
  | { kind: 'session.list' }
  | { kind: 'chunk.set'; sessionId: string; enabled: boolean; chunkTokens?: number }
  | { kind: 'chunk.get'; sessionId: string }

export type GateSnapshot = {
  sessions: string[]
  pendingRequests: number
  subscribers: number
  emitted: number
}

export type SignalGateSessionHandlers = {
  create: (payload: { title?: string }) => unknown
  open: (sessionId: string) => unknown
  close: (sessionId: string) => unknown
  delete: (sessionId: string) => unknown
  list: () => unknown
}

export type SignalGateHandlers = {
  runPrompt: (sessionId: string, text: string) => Promise<unknown>
  cancel: (sessionId: string) => void
  session: SignalGateSessionHandlers
  setFullPermission: (sessionId: string, enabled: boolean) => void
}

export type SignalGate = {
  emit: (sig: GateSignal) => void
  on: (kind: GateSubscriptionKind, cb: GateSubscriber) => () => void
  request: (input: GateRequestInput, opts?: { timeoutMs?: number | undefined }) => Promise<unknown>
  resolve: (requestId: string, payload: unknown) => void
  command: (cmd: GateCommand) => Promise<unknown>
  snapshot: () => GateSnapshot
}

export type SignalGateOptions = {
  /** request() default timeout ms. Default 300_000, fail-closed. */
  requestTimeoutMs?: number | undefined
  handlers: SignalGateHandlers
}
