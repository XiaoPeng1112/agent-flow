import { createHash } from 'crypto'
import type { AgentTurn, Run } from '../types/index.js'

export interface RunTombstone { id: string; _deleted: true; deletedAt: number }
export type RunSyncRecord = (Run & { _turns: Record<string, AgentTurn[]>; _revision?: string }) | RunTombstone

/** Content revisions include node/turn progress, independently of lifecycle timestamps and key order. */
export function recordRevision(record: RunSyncRecord | null): string | null {
  if (!record) return null
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]))
    return value
  }
  const body = Object.fromEntries(Object.entries(record).filter(([key]) => key !== '_revision'))
  return createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex')
}

export function isTombstone(record: RunSyncRecord): record is RunTombstone { return '_deleted' in record && record._deleted === true }
