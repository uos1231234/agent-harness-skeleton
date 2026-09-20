// 出站 wire 规范化 —— 相邻 user 消息合并。
//
// 问题：canonical 历史里会出现相邻的 role:'user' 回合（例如空 userTemplate
// 回合紧跟一条真实 user 消息）。OpenAI 兼容栈容忍相邻 user；**Anthropic 的
// 严格交替会 400**。
//
// 分层：canonical 保持诚实结构（两个独立回合落盘 / 恢复都看得到），只在
// **出站 wire** 上合并。规则本体住在这里（与 wire 词汇、tool-calls.ts 同层），
// 唯一应用点在 shell/call.ts 构造 fullRequest 处——那是所有 streamChat 实现
// 的必经之路。
//
// **无损**：合并是拼接，不丢弃任何非空内容。它不是截断机制。

import type { ChatMessage, ContentPart } from './types.js'

/** 合并相邻 user 消息时插入的分隔。两个空行：markdown 段落边界，不吞正文。 */
const MERGE_SEPARATOR = '\n\n'

const isBlank = (text: string): boolean => text.trim().length === 0

/**
 * 把一段连续的 user 消息合并成一条。
 *
 * 全是字符串时产出字符串（保持最常见形态不变，让"请求 + 空模板"合并后仍是
 * 纯文本）；任一条带 ContentPart（图片）时产出 ContentPart[]，字符串段转成
 * text part。
 *
 * 空白段被跳过：空字符串不携带信息，留着只会在正文里插一串多余的分隔符
 * （来源 2 的空 userTemplate 正是这种情况）。这不是截断——没有任何非空内容
 * 被丢弃。
 */
const mergeUserRun = (run: readonly ChatMessage[]): ChatMessage => {
  const allStrings = run.every((m) => m.role === 'user' && typeof m.content === 'string')
  if (allStrings) {
    const text = run
      .map((m) => (m.role === 'user' && typeof m.content === 'string' ? m.content : ''))
      .filter((s) => !isBlank(s))
      .join(MERGE_SEPARATOR)
    return { role: 'user', content: text }
  }

  const parts: ContentPart[] = []
  for (const m of run) {
    if (m.role !== 'user') continue
    if (typeof m.content === 'string') {
      if (!isBlank(m.content)) parts.push({ type: 'text', text: m.content })
    } else {
      parts.push(...m.content)
    }
  }
  return { role: 'user', content: parts }
}

/**
 * 合并相邻的 `role:'user'` 消息，让严格交替的 provider 不会 400。
 *
 * **只处理 user**，其余角色刻意不动，每个排除都有具体理由：
 * - `tool`：连续的 tool 消息是协议合法的（每个 tool_call_id 一条），合并会
 *   摧毁 tool_call_id ↔ 结果的配对。
 * - `assistant`：合并会有 tool_calls 配对风险；且我们的 canonical 不产出相邻
 *   assistant（finalizeRound 每轮只 append 一个，工具轮之间必隔着 tool 回合）。
 * - `system`：多条 system part 是刻意的（系统提示词 + runtime/temporal 注入 +
 *   MEMORY.md 注入，见 loop.ts:239-252 的组装顺序）；严格交替约束的是
 *   user/assistant 轮次，而 Anthropic 把 system 作为顶层独立字段传递。
 *
 * 无相邻 user 时返回内容等价的副本（调用方可安全复用）。幂等：对已规范化的
 * 序列再跑一次结果不变。
 */
export const normalizeStrictAlternation = (messages: readonly ChatMessage[]): ChatMessage[] => {
  const out: ChatMessage[] = []
  let run: ChatMessage[] = []

  const flush = (): void => {
    if (run.length === 0) return
    if (run.length === 1) out.push(run[0]!)
    else out.push(mergeUserRun(run))
    run = []
  }

  for (const m of messages) {
    if (m.role === 'user') {
      run.push(m)
      continue
    }
    flush()
    out.push(m)
  }
  flush()
  return out
}

/** 序列里是否存在相邻 user（供日志与测试判定"这次转写是否真的改了形状"）。 */
export const hasAdjacentUserMessages = (messages: readonly ChatMessage[]): boolean => {
  for (let i = 1; i < messages.length; i += 1) {
    if (messages[i]!.role === 'user' && messages[i - 1]!.role === 'user') return true
  }
  return false
}
