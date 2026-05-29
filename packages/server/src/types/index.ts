/** WebSocket 消息类型 */
export type WsMessageType =
  | 'terminal:input'
  | 'terminal:output'
  | 'terminal:resize'
  | 'agent:start'
  | 'agent:progress'
  | 'agent:complete'
  | 'agent:error'
  | 'file:changed'
  | 'file:created'
  | 'file:deleted'

export interface WsMessage {
  type: WsMessageType
  payload: unknown
  timestamp: number
}

/** Agent 定义 */
export interface AgentConfig {
  id: string
  name: string
  type: 'codex' | 'claude' | 'custom-cli'
  command: string       // 执行命令模板
  description: string
  env?: Record<string, string>
}

/** Skill 定义 */
export interface SkillConfig {
  name: string
  path: string
  description: string
  triggers: string[]
  content?: string
}

/** 工作流执行记录 */
export interface SessionRecord {
  id: string
  workflowId: string
  nodeId: string
  agentId: string
  input: string
  output: string
  status: 'running' | 'completed' | 'error'
  startedAt: number
  completedAt?: number
}

/** 文件变更 */
export interface FileChange {
  path: string
  type: 'add' | 'change' | 'unlink'
  content?: string
  diff?: string
}
