# agent-harness-skeleton

**中文**：一个最小、安全、可终止的 Agent 循环骨架：OpenAI 协议客户端 + 运行时守卫壳 + 可插拔安全门禁 + 会话隔离。零运行时依赖。只给骨架，不给血肉——提示词、工具资产、上下文工程都由你决定。

**English**: A minimal, safe, terminable agent-loop skeleton — OpenAI protocol client + runtime guard shell + pluggable security doors + session isolation. Zero runtime dependencies. Mechanisms only: prompts, tools, and context engineering are yours to build.

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
| `signals/` | Signal gate | Front/back boundary: emit/on broadcast, request/resolve round-trips, per-session turn serialization |

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

## Extension points

- **Tools**: `registry.registerSystemTool(...)` at startup. No hot-plug, by design.
- **Doors**: implement `SecurityDoor` and `registry.registerDoor(...)`.
- **Front-ends**: subscribe to the `SignalGate`, answer `approval.request` /
  `ask_user` requests, drive `user.prompt` / `turn.cancel` commands.
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
