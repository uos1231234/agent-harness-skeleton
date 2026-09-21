# Architecture (skeleton edition)

## One-line positioning

A pure TypeScript library that keeps an LLM tool-calling loop **safe,
terminable, and observable** — and nothing else.

## Layers

```
┌──────────────────────────────────────────────────────────┐
│  Application (your agent)                                 │
│   1. Build a ToolRegistry, register tools + doors.        │
│   2. Build a ConversationMemory (canonical history).      │
│   3. Create a ShellConfig with thresholds.                │
│   4. Call runIMLoop({ ... }).                             │
│                                                          │
│  runIMLoop drives, per round:                             │
│    compose(system + history + tools) → FinalPrompt        │
│    shellCall → gate(state) → streamChat → metrics         │
│    advanceElapsed → runGuards → trip? terminate           │
│    toolCalls → registry.execute (doors run inside)        │
│              → append turns → next round                  │
│    no toolCalls → append assistant turn → completed       │
└──────────────────────────────────────────────────────────┘
```

### Module boundaries

| Module | May import | Must not import |
|---|---|---|
| `protocol/` | nothing (leaf) | `shell/`, `im/` |
| `shell/` | `protocol/`, `shared/` | `im/` |
| `im/` | `shell/`, `protocol/`, `shared/`, `security/` | — |
| `security/` | `shared/` | `im/`, `shell/` |
| `signals/` | own modules | `im/`, `shell/` |

## Core invariants

1. **Termination is structural.** The loop exits on exactly four outcomes:
   `completed`, `guard-tripped`, `protocol-error`, `shell-terminated`.
2. **State never leaks into the prompt.** `Running`/`Tripped` and guard hits
   are returned via `IMLoopResult`, never sent to the model.
3. **One guard evaluation point per round.** `shellCall` runs the entry gate;
   the loop runs `runGuards` once on the returned metrics after applying
   wall-clock elapsed time.
4. **Every guard is reachable.** Each config threshold has a producer on the
   happy path (ADR-014 discipline): token ← request size, iter ← step count,
   toolRate ← tool-call count, time ← elapsed, errorRate ← consecutive error
   turns.
5. **Tool execution is gated.** Doors run inside `ToolRegistry.execute()`
   before dispatch; the first rejection throws. Full-permission sessions
   bypass doors explicitly and visibly.
6. **The canonical conversation is the single history.** There is no second
   projection store in the skeleton.

## Security doors

`SecurityDoor` is a stateless strategy; all mutable state (approval grants)
lives in `SessionSecurityState.approvalStore`. The registry owns the session
map and runs doors in registration order (deny-override: the first rejection
throws, after earlier doors already ran; slots are released in `finally`).

Built-in doors:

- `sensitive-path` — hard block on credential/key paths (`.env`, `id_rsa*`,
  `.ssh/`, `.aws/credentials`, `*.pem`, …), including shell-command
  laundering (`cat ~/.ssh/id_rsa`, `curl -F file=@…`).
- `dangerous-command` — hard block on destructive shell commands (POSIX +
  PowerShell): recursive deletes, `curl|sh`, fork bombs, device writes,
  `git push --force`, embedded PowerShell hosts, fail-closed on deep nesting.
- `write-approval` — human approval round-trip for write/edit and shell
  tools; file-scope and session-scope grants; fail-closed on timeout/abort.
- `browser-tools` — concurrency slot reservation for browser-driven tools.

## Signal gate

The gate is the single front/back relay — the only boundary between the loop
core and front-ends (CLI / web / app):

- **Signals down** — the core broadcasts typed signals (`turn.*`,
  `approval.request`, `permission.changed`, `chunk.changed`); subscribers are
  isolated, so a throwing subscriber cannot break the stream.
- **Commands up** — front-ends send typed commands (`user.prompt`,
  `turn.cancel`, `approval.decision`, `ask_user.answer`, `session.*`,
  `permission.full`, `chunk.*`).
- **Request / resolve** — the core asks for approvals or answers with minted
  request IDs and parks a promise; any front-end answers via command.
  Fail-closed on timeout (default 300s); late replies are ignored.

Governance deliberately sits at the gate, not in front-ends:

- **Per-session turn serialization** — a second prompt in a busy session is
  queued (never dropped) and made visible via `turn.queue`; different sessions
  run in parallel. `dropPending` (turn.cancel) and `forget` (session
  close/delete) have distinct cleanup semantics to keep the concurrency
  boundary closed.
- **Approval round-trips are transport-agnostic** — a terminal prompt, a web
  modal, and an IM button are interchangeable hosts for the same request.
- **The boundary is transport-agnostic** — in-process, WebSocket, or an HTTP
  envelope. `SignalGateHandlers` (`runPrompt` / `cancel` / session CRUD /
  `setFullPermission`) is the host-injected seam; the core imports nothing
  front-end-specific.

New kinds are added by extending the `GateSignal` / `GateCommand`
discriminated unions — the skeleton ships the boundary, the host brings its
own kinds.

## Sessions

`SessionManager` mints UUID sessions, each with an independent
`ConversationMemory`; `SessionStore` persists turns as append-only JSONL
(one file per session). `recoverSession` replays a session from disk.

## Testing discipline

- Guards, gate, doors, and the loop are covered by unit tests with fake
  `streamChat` (no network).
- The loop tests pin the four termination outcomes and the door-gating
  behavior.
