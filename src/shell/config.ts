// Guards are not hot-pluggable. They are built-in. Configuration only.
// Every guard threshold below must be reachable: each field is read by a
// guard in guards.ts and each guard's metric has a producer. There are no
// "reserved" config fields.

export type ShellConfig = {
  maxTokens: number                  // tokenGuard: trip if metrics.lastRequestTokens > maxTokens
                                     // (this round's request size, NOT cumulative spend)
  maxSteps: number                   // iterGuard: trip if metrics.stepCount > maxSteps
  maxToolCalls: number               // toolRateGuard: trip if metrics.toolCallCount > maxToolCalls
  maxElapsedMs: number               // timeGuard: trip if metrics.elapsedMs > maxElapsedMs
  // errorRateGuard: trip if metrics.consecutiveToolErrors > maxConsecutiveToolErrors.
  // Counting semantics: unit is one TURN (assistant round), not one tool call —
  // a batch where several tools fail increments the counter once. Any round
  // where every tool call succeeds resets the counter to 0. The comparison is
  // strict >, so the default of 10 trips on the 11th consecutive error turn.
  maxConsecutiveToolErrors: number
}

export const DEFAULT_CONFIG: ShellConfig = {
  maxTokens: 1_000_000,
  maxSteps: 500,
  maxToolCalls: 1000,
  // Time budget is not enforced by the state machine: tool execution has no
  // harness deadline (tools may carry their own timeout), and termination
  // authority stays with the user (close the loop / abort via ctx.signal).
  // iter/toolRate/errorRate guards still prevent infinite loops and error
  // storms. Hosts must not override guard thresholds — state machine behavior
  // is global and identical across front-ends.
  maxElapsedMs: Number.POSITIVE_INFINITY,
  maxConsecutiveToolErrors: 10,        // trips on the 11th consecutive error turn (strict >).
}

export const createConfig = (overrides: Partial<ShellConfig> = {}): ShellConfig => ({
  ...DEFAULT_CONFIG,
  ...overrides,
})
