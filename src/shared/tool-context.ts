// Shared tool context type. Lives at the bottom of the dependency graph
// alongside json-schema.ts. Both shell and im import it; neither owns it.
//
// Skeleton edition: only the fields the generic harness needs. Domain-specific
// context (projection handles, memory layers, sub-agent policy, retrieval
// ledgers) is intentionally absent — this is the generic skeleton.

import type { ApprovalStore } from '../security/approval-store.js'
import type { TokenCounter } from './token-counter.js'

export type ToolContext = {
  /** Identity of the agent whose loop runs the tool. */
  agentId?: string
  /** Security session identifier (per-session approval isolation). */
  sessionId?: string
  /** The session's approval store. Set by ToolRegistry.execute() after the security check. */
  approvalStore?: ApprovalStore
  /** Cooperative cancellation signal for the current turn. */
  signal?: AbortSignal
  /** agent→user reverse-RPC handler (e.g. request_user_input). */
  requestHandler?: (kind: string, payload: unknown) => Promise<unknown>
  /** Effective execution boundary for the current loop. */
  allowedToolRefs?: readonly string[]
  /** Counter selected by the host for this loop's provider/model. */
  tokenCounter?: TokenCounter
}
