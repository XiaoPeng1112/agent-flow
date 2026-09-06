import type { AgentConfig, TokenUsage } from '../types/index.js'
import type { ExecutionWorkspaceStore } from '../services/execution-workspace.js'
import type { ProviderExecution } from '../services/providers/journal.js'
import type { ProviderEvent } from '../services/providers/adapter.js'

export interface ExecutionJob {
  turnId: string
  agent?: AgentConfig
  script?: string
  prompt: string
  cwd: string
  environment: Record<string, string | undefined>
  workspace?: { root: string; prepare: Parameters<ExecutionWorkspaceStore['prepare']>[0]; resumeFromTurnId?: string }
  recovery?: ProviderExecution
  timeoutMs: number
  killGraceMs?: number
}
export interface ExecutionResult {
  success: boolean
  allowFallback?: boolean
  code: number | null
  cancelled: boolean
  snapshotOK: boolean
  error?: string
  output: string
  tokenUsage?: TokenUsage
  toolCalls?: string[]
  filesModified?: number
}
export type WorkerMessage =
  | { type: 'prepared'; cwd: string }
  | { type: 'spawned'; pid: number }
  | { type: 'output'; text: string }
  | { type: 'provider'; event: ProviderEvent }
  | { type: 'result'; result: ExecutionResult }
