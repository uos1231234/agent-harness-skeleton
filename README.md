# agent-harness-skeleton

**中文**：一个最小、安全、可终止的 Agent 循环骨架：OpenAI 协议客户端 + 运行时守卫壳 + 可插拔安全门禁 + 会话隔离 + 信号关前后端解耦。零运行时依赖。只给骨架，不给血肉——提示词、工具资产、上下文工程都由你决定。

**English**: A minimal, safe, terminable agent-loop skeleton — OpenAI protocol client + runtime guard shell + pluggable security doors + session isolation + signal-gate front/back decoupling. Zero runtime dependencies. Mechanisms only: prompts, tools, and context engineering are yours to build.

**Skill 版本**：同一套东西我打包成了可安装的 SKILL.md skill，在 [Agensi](https://www.agensi.io/skills/minimal-extensible-agent-loop) 上架（$9/月订阅，含验证步骤与可运行示例）。这个仓库保持 MIT 开源，随时可 clone。

**Skill version**: the same runtime is also packaged as an installable SKILL.md skill on [Agensi](https://www.agensi.io/skills/minimal-extensible-agent-loop) ($9/mo, with a verification checklist and runnable examples). This repo stays MIT-licensed and freely clonable.

---

## Why

Most "agent frameworks" ship opinions: their prompt stack, their tool set,
their memory format. If you are building your own agent and want the hard
part — a loop that **cannot run away**, where every tool call passes a
**security door**, and where state is **never leaked into the prompt** —
this skeleton gives you exactly that and nothing else.

## What's inside

| Layer | Module | Responsibility |
|---|---|---|
| `protocol/` | OpenAI wire format | SSE parsing, tool-call accumulation, retry policy (429/503 only) |
| `shell/` | Runtime guard shell | 2-value state machine, pure guards (token/iter/toolRate/time/errorRate), gate, prompt composition |
| `im/` | The loop | `runIMLoop`: compose → shellCall → guards → tool execution → terminate |
| `security/` | Doors | sensitive-path, dangerous-command, write-approval, browser-tools — pluggable, per-session |
| `im/session/` | Sessions | Multi-session windows, JSONL persistence, recovery |
| `signals/` | Signal gate | Front/back boundary: emit/on broadcast, request/resolve round-trips, per-session turn serialization — see [Signal gate](#signal-gate-frontback-decoupling) |

## Guarantees (enforced by tests)

1. **The loop always terminates.** `completed` / `guard-tripped` /
   `protocol-error` / `shell-terminated` — no infinite loop is representable.
2. **Tripped state never enters the prompt.** Guard hits are a control signal
   for the caller (`IMLoopResult.hits`), never model input.
3. **Every tool call is gated.** `ToolRegistry.execute()` runs all registered
   security doors before dispatch; the first rejection throws.
4. **Sessions are isolated.** Per-session approval stores; a grant in one
   session never short-circuits another.
5. **Zero runtime dependencies.** Node built-ins only.

## Quick start

```bash
npm install
npm run example:minimal      # hello world with a fake streamChat
npm run example:guard-demo   # watch the token guard trip the loop
npm test                     # unit tests
npm run typecheck
```

Minimal usage:

```ts
import { runIMLoop, ToolRegistry, ConversationMemory, createConfig, createMetrics } from 'agent-harness-skeleton'

const registry = new ToolRegistry()
registry.registerSystemTool({
  name: 'echo',
  description: 'echoes its argument',
  parameters: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
  execute: async (args) => ({ echo: (args as { x: string }).x }),
})

const result = await runIMLoop({
  config: createConfig(),
  registry,
  conversationMemory: new ConversationMemory(),
  streamChat,                       // your OpenAI-compatible streaming client
  url: 'https://api.example.com/v1/chat/completions',
  model: 'gpt-4',
  systemPrompt: 'You are a helpful assistant.',
})
```

## Security doors

```ts
import {
  ToolRegistry,
  createSensitivePathDoor,
  createDangerousCommandDoor,
  createWriteApprovalDoor,
} from 'agent-harness-skeleton'

const registry = new ToolRegistry()
registry.registerDoor(createSensitivePathDoor())          // hard-blocks ~/.ssh, .env, keys…
registry.registerDoor(createDangerousCommandDoor())       // hard-blocks rm -rf /, curl|sh, fork bombs…
registry.registerDoor(createWriteApprovalDoor({           // human approval round-trip
  handler: async (request) => /* 'approved' | 'rejected' */ 'approved',
}))
```

- `checkDangerousCommand(cmd, shell?)` — POSIX + PowerShell destructive-command
  classifier (pure function, zero deps).
- `isSensitivePath(path)` / `findSensitiveShellPath(cmd)` — credential/key path
  detection, including shell-command laundering paths.

## Signal gate: front/back decoupling

The hard part of an agent product is not the loop — it is everything around
it: sessions, approvals, cancellation, queueing. Re-implementing that
governance once per front-end (CLI, web, app) is how agent codebases rot.

The **signal gate** is the single relay between the loop core and any number
of front-ends:

- **Down (signals)** — the core broadcasts typed signals: `turn.start` /
  `turn.delta` / `turn.end`, `turn.queue`, `approval.request`,
  `permission.changed`, `chunk.changed`. Front-ends subscribe by kind; a
  throwing subscriber is isolated, so one bad listener cannot break the
  stream.
- **Up (commands)** — front-ends send typed commands: `user.prompt`,
  `turn.cancel`, `approval.decision`, `ask_user.answer`, `session.*`,
  `permission.full`, `chunk.*`.
- **Round-trip (requests)** — `request` / `resolve` with minted request IDs:
  the core asks for an approval or an answer, parks a promise (fail-closed,
  300s default), and any front-end answers through a command.

**Governance lives at the gate, not in any front-end:**

- **Per-session turn serialization** — a second prompt in a busy session is
  queued (never dropped) and made visible via `turn.queue`; different sessions
  run in parallel.
- **Approval flows are transport-agnostic** — the same `approval.request`
  drives a terminal y/n prompt, a web modal, or an IM button.
- **Transport-agnostic boundary** — in-process, WebSocket, or an HTTP
  envelope: the gate does not care how bytes travel.

### Three front-ends, one core

| Front-end | Subscribes to | Sends | Never has to implement |
|---|---|---|---|
| CLI | `turn.delta` → stdout, `turn.queue` → "queued (n)" | `user.prompt`, `approval.decision` | session locking, queueing, approval storage |
| Web | SSE/WS bridge → UI state | same commands over HTTP/WS | the same — governance is already done |
| App / IM | message events | same commands via bot API | the same — no CLI-specific assumptions in the core |

Write a new front-end by subscribing and commanding. The loop core never
imports anything front-end-specific; its only view of the outside world is
`SignalGateHandlers` (`runPrompt` / `cancel` / session CRUD / permission),
which your host injects.

```ts
import { createSignalGate } from 'agent-harness-skeleton'

const gate = createSignalGate({
  handlers: { runPrompt, cancel, session: sessionHandlers, setFullPermission },
})

// a front-end is just this:
gate.on('turn.delta', (s) => process.stdout.write(s.text))
gate.on('approval.request', (r) =>
  gate.command({ kind: 'approval.decision', requestId: r.requestId, decision: 'approved' }),
)
await gate.command({ kind: 'user.prompt', sessionId, text: 'hello' })
```

New signal and command kinds are added by extending the discriminated unions
(`GateSignal`, `GateCommand`) — the skeleton ships the boundary; your host
brings its own kinds.

## Extension points

- **Tools**: `registry.registerSystemTool(...)` at startup. No hot-plug, by design.
- **Doors**: implement `SecurityDoor` and `registry.registerDoor(...)`.
- **Front-ends**: subscribe to the `SignalGate`, answer `approval.request` /
  `ask_user` requests, drive `user.prompt` / `turn.cancel` commands — see
  [Signal gate](#signal-gate-frontback-decoupling) for the full boundary
  contract.
- **Sessions**: `createSessionManager({ dir })` for persistent multi-session apps.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the data flow, invariants,
and module boundaries.

## Not included (by design)

Prompt engineering, tool assets (bash/read/write/search…), MCP integration,
context compression/recall, sub-agent trees, goal mode, rendering. If you need
those, build them on top — the skeleton's job is to stay out of the way while
keeping the loop safe and terminable.

## License

MIT
