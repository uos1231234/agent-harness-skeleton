import { describe, expect, it } from 'vitest'

import { createSignalGate } from '../../src/signals/index.js'

const makeGate = () => {
  const runs: string[] = []
  const gate = createSignalGate({
    handlers: {
      runPrompt: async (_sessionId, text) => {
        runs.push(text)
        return { ok: true }
      },
      cancel: () => {},
      session: {
        create: () => ({ sessionId: 'created' }),
        open: (sessionId) => ({ sessionId }),
        close: () => ({}),
        delete: () => true,
        list: () => [],
      },
      setFullPermission: () => {},
    },
  })
  return { gate, runs }
}

describe('signal gate', () => {
  it('broadcasts signals to kind and wildcard subscribers', () => {
    const { gate } = makeGate()
    const seen: string[] = []
    gate.on('turn.queue', (s) => seen.push(`kind:${s.kind}`))
    gate.on('*', (s) => seen.push(`star:${s.kind}`))
    gate.emit({ kind: 'turn.queue', sessionId: 's1', pending: 1 })
    expect(seen).toEqual(['kind:turn.queue', 'star:turn.queue'])
  })

  it('fails closed when a request times out without an answer', async () => {
    const { gate } = makeGate()
    const p = gate.request({ kind: 'approval.request', toolName: 'echo', reason: 'test' }, { timeoutMs: 20 })
    await expect(p).rejects.toThrow(/timed out/)
    expect(gate.snapshot().pendingRequests).toBe(0)
  })

  it('serializes turns within one session (queue, never drop)', async () => {
    const runs: string[] = []
    let release = (): void => {}
    const blocker = new Promise<void>((r) => { release = r })

    const gate = createSignalGate({
      handlers: {
        runPrompt: async (_sessionId, text) => {
          runs.push(text)
          if (runs.length === 1) await blocker
          return { ok: true }
        },
        cancel: () => {},
        session: {
          create: () => ({}),
          open: () => ({}),
          close: () => ({}),
          delete: () => true,
          list: () => [],
        },
        setFullPermission: () => {},
      },
    })

    const first = gate.command({ kind: 'user.prompt', sessionId: 's1', text: 'one' })
    const second = await gate.command({ kind: 'user.prompt', sessionId: 's1', text: 'two' })
    expect(second).toEqual({ queued: true, position: 1 })

    release()
    await first

    // The host emits turn.end when a turn fully finishes; the gate then runs
    // the next queued turn (chained).
    gate.emit({ kind: 'turn.end', sessionId: 's1' })
    await new Promise((r) => setTimeout(r, 10))
    expect(runs).toEqual(['one', 'two'])
  })

  it('drops queued prompts on turn.cancel but leaves the in-flight turn alone', async () => {
    const { gate, runs } = makeGate()
    const first = gate.command({ kind: 'user.prompt', sessionId: 's1', text: 'one' })
    await gate.command({ kind: 'user.prompt', sessionId: 's1', text: 'two' })
    await gate.command({ kind: 'turn.cancel', sessionId: 's1' })
    await first
    expect(runs).toEqual(['one'])
  })
})
