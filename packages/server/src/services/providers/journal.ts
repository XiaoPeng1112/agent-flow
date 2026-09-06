import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { ProviderEvent, ProviderKind } from './adapter.js'

export interface ProviderExecution {
  provider: ProviderKind
  command: string
  model?: string
  sessionId?: string
  cwd: string
  pid?: number
  resumedFromTurnId?: string
}
export interface JournalEvent { sequence: number; timestamp: number; event: ProviderEvent }

/** Local-only recovery authority. Workflow data received from sync cannot select a local CLI session. */
export class ProviderJournal {
  constructor(private readonly directory: string) {}
  private path(turnId: string, suffix: string): string {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(turnId)) throw new Error('Invalid turn ID')
    return join(this.directory, `${turnId}.${suffix}`)
  }
  get(turnId: string): ProviderExecution | undefined {
    const path = this.path(turnId, 'json')
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined
  }
  set(turnId: string, state: ProviderExecution): void {
    mkdirSync(this.directory, { recursive: true })
    const path = this.path(turnId, 'json')
    writeFileSync(`${path}.tmp`, JSON.stringify(state), { mode: 0o600 })
    renameSync(`${path}.tmp`, path)
  }
  append(turnId: string, entry: JournalEvent): void {
    mkdirSync(this.directory, { recursive: true })
    appendFileSync(this.path(turnId, 'jsonl'), `${JSON.stringify(entry)}\n`, { mode: 0o600 })
  }
  read(turnId: string, after = 0, limit = 200): { events: JournalEvent[]; nextCursor: number; hasMore: boolean } {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new Error('Invalid event cursor or limit')
    }
    const path = this.path(turnId, 'jsonl')
    const data = existsSync(path) ? readFileSync(path, 'utf8') : ''
    // Ignore only an incomplete final append left by a crash; malformed complete entries fail closed.
    const lines = data.split('\n').slice(0, -1)
    const entries = lines.map(line => JSON.parse(line) as JournalEvent)
    const eligible = entries.filter(entry => entry.sequence > after)
    const events = eligible.slice(0, limit)
    return { events, nextCursor: events.at(-1)?.sequence ?? after, hasMore: eligible.length > events.length }
  }
}
