// SessionStore: JSONL persistence of conversation turns, one file per session.
//
// The store owns the disk; the manager owns the in-memory handles. A session
// file is append-only JSONL — recovery replays it in order.

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ConversationTurn } from '../conversation-memory.js'
import type { SessionId, SessionInfo } from './types.js'

export class SessionStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true })
  }

  private file(sessionId: SessionId): string {
    return join(this.dir, `${sessionId}.jsonl`)
  }

  /** Create an empty session file (idempotent). */
  touch(sessionId: SessionId): void {
    if (!existsSync(this.file(sessionId))) writeFileSync(this.file(sessionId), '')
  }

  append(sessionId: SessionId, turn: ConversationTurn): void {
    appendFileSync(this.file(sessionId), `${JSON.stringify(turn)}\n`)
  }

  load(sessionId: SessionId): ConversationTurn[] {
    const p = this.file(sessionId)
    if (!existsSync(p)) return []
    return readFileSync(p, 'utf8')
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as ConversationTurn)
  }

  exists(sessionId: SessionId): boolean {
    return existsSync(this.file(sessionId))
  }

  list(): SessionInfo[] {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => f.slice(0, -'.jsonl'.length))
      .map((sessionId) => {
        const st = statSync(this.file(sessionId))
        return { sessionId, createdAt: st.birthtimeMs, updatedAt: st.mtimeMs }
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  delete(sessionId: SessionId): boolean {
    const p = this.file(sessionId)
    if (!existsSync(p)) return false
    rmSync(p)
    return true
  }

  /** Delete sessions not updated within maxAgeMs. Returns the count removed. */
  pruneExpired(maxAgeMs: number): number {
    const now = Date.now()
    let removed = 0
    for (const info of this.list()) {
      if (now - info.updatedAt > maxAgeMs) {
        if (this.delete(info.sessionId)) removed += 1
      }
    }
    return removed
  }
}
