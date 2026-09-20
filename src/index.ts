// agent-harness-skeleton public API surface.
//
// Pure sugar: re-exports the symbols external callers are most likely to need.
// Internal modules continue to import from their existing paths.

// ---- IM loop ----
export { runIMLoop, advanceElapsed } from './im/loop.js'
export type { IMLoopOptions, IMLoopResult } from './im/loop.js'

// ---- minimal IM factory ----
export { createMinimalIM } from './im/minimal.js'

// ---- canonical conversation ----
export { ConversationMemory } from './im/conversation-memory.js'
export type { ConversationTurn, ToolTurn } from './im/conversation-memory.js'
export { turnToMessage, appendCanonicalTurn, mintTurnId } from './im/turn.js'

// ---- session layer (multi-session windows + persistence) ----
export { createSessionManager, SessionStore, recoverSession } from './im/session/index.js'
export type { SessionManager, SessionHandle, SessionId, SessionInfo } from './im/session/index.js'

// ---- shell (state machine + guards + gate + compose + call) ----
export { createConfig, DEFAULT_CONFIG } from './shell/config.js'
export type { ShellConfig } from './shell/config.js'
export { runGuards } from './shell/guards.js'
export type { GuardHit, GuardId } from './shell/guards.js'
export { gate, ShellTerminatedError } from './shell/gate.js'
export type { State } from './shell/state.js'
export { shellCall } from './shell/call.js'
export type { ShellDeps, ShellCallResult } from './shell/call.js'
export { compose } from './shell/compose.js'
export type { PromptPart, FinalPrompt } from './shell/compose.js'
export {
  createMetrics,
  addUsage,
  addStep,
  addToolCalls,
  addToolError,
  resetToolErrors,
} from './shell/metrics.js'
export type { Metrics, Usage } from './shell/metrics.js'

// ---- tool registry (registration mechanism) ----
export { ToolRegistry } from './shell/registry.js'
export type {
  SecurityHook,
  ToolDefinition,
  SystemTool,
  MCPTool,
  SkillDefinition,
  ToolExecutor,
  ToolCategory,
} from './shell/registry.js'

// ---- security (doors + classifiers + approvals) ----
export { SecurityRouter } from './security/router.js'
export type {
  SecurityDoor,
  SecurityDecision,
  SessionSecurityState,
  SessionId as SecuritySessionId,
} from './security/types.js'
export { ApprovalStore } from './security/approval-store.js'
export type { ApprovalHandler, ApprovalRequest, ApprovalScope } from './security/approval-store.js'
export {
  createSensitivePathDoor,
  createDangerousCommandDoor,
  createWriteApprovalDoor,
  createBrowserToolsDoor,
} from './security/index.js'
export { checkDangerousCommand } from './security/classifiers/dangerous-command.js'
export type { DangerousResult, ShellKind } from './security/classifiers/dangerous-command.js'
export { isSensitivePath, findSensitiveShellPath } from './security/classifiers/sensitive-path.js'

// ---- protocol (OpenAI wire format) ----
export { parseToolCallArguments } from './protocol/tool-calls.js'

// ---- shared ----
export {
  defaultLogger,
  createSilentLogger,
  setLevel,
  setSink,
  getLevel,
} from './shared/logger.js'
export type { Logger, LogLevel, LogFields, LogRecord } from './shared/logger.js'
export type { ToolContext } from './shared/tool-context.js'

// ---- signal gate (front/back signal boundary) ----
export { createSignalGate } from './signals/index.js'
export type {
  SignalGate,
  SignalGateOptions,
  SignalGateHandlers,
  GateSignal,
  GateRequest,
  GateRequestInput,
  GateCommand,
  GateSubscriptionKind,
  GateSnapshot,
} from './signals/index.js'
