// ═══════════════════════════════════════════════════
// AgentFlow Client Types — 与 Server 类型对齐
// ═══════════════════════════════════════════════════

// ─── Run ───

export type RunStatus = 'created' | 'running' | 'paused' | 'completed' | 'failed'

export interface Run {
  id: string
  projectId: string
  templateId: string
  name: string
  description?: string
  status: RunStatus
  nodes: TaskNode[]
  edges: DAGEdge[]
  createdAt: number
  startedAt?: number
  completedAt?: number
}

export interface DAGEdge {
  source: string
  target: string
}

// ─── TaskNode ───

export type TaskNodeStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'wait_user_review'
  | 'completed'
  | 'failed'
  | 'skipped'

export type NodeType =
  | 'specify'
  | 'design'
  | 'task'
  | 'implement'
  | 'review'
  | 'test'
  | 'deliver'
  | 'custom'

export type AgentRole = 'planner' | 'manager' | 'executor'

export interface TaskNode {
  id: string
  runId: string
  name: string
  type: NodeType
  description: string
  status: TaskNodeStatus
  agentRole: AgentRole
  skillIds: string[]
  artifacts: Artifact[]
  prompt?: string
  userInput?: string
  order: number
  executionMode?: ExecutionMode
  script?: string
  scriptCwd?: string
  startedAt?: number
  completedAt?: number
  error?: string
}

// ─── AgentTurn ───

export type AgentTurnStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error'
export type TurnResult = 'succeeded' | 'failed' | 'paused_for_question'

export interface AgentTurn {
  id: string
  nodeId: string
  runId: string
  agentId: string
  turnIndex: number
  status: AgentTurnStatus
  result?: TurnResult
  prompt: string
  output: string
  question?: string
  tokenUsage?: { input: number; output: number; total: number }
  startedAt: number
  completedAt?: number
}

// ─── Agent ───

export interface AgentConfig {
  id: string
  name: string
  role: AgentRole
  type: 'codex' | 'claude' | 'custom-cli'
  description: string
  maxTurns?: number
  available?: boolean
  cliPath?: string
}

// ─── Artifact ───

export interface Artifact {
  id: string
  nodeId: string
  title: string
  category: 'document' | 'code' | 'config' | 'test' | 'report'
  format: string
  content?: string
  filePath?: string
  createdAt: number
}

// ─── Workflow Template ───

export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  nodes: TemplateNode[]
  edges: DAGEdge[]
}

export type ExecutionMode = 'det' | 'hyb' | 'llm'

export interface TemplateNode {
  id: string
  name: string
  type: NodeType
  description: string
  agentRole: AgentRole
  skillIds: string[]
  prompt?: string
  outputContracts?: OutputContract[]
  executionMode?: ExecutionMode
  script?: string
  scriptCwd?: string
}

export interface OutputContract {
  id: string
  title: string
  category: 'document' | 'code' | 'config' | 'test' | 'report'
  format: string
  required: boolean
}

// ─── Skill ───

export interface SkillInfo {
  id: string
  name: string
  path: string
  description: string
  triggers: string[]
}

// ─── Project ───

export interface Project {
  id: string
  name: string
  path: string
  description?: string
  contextConfig?: ProjectContext
  enabledAgentIds?: string[]       // 项目启用的 Agent ID 列表（未设置 = 全部启用）
  skills: SkillInfo[]
  runs: Run[]
  createdAt: number
  lastActiveAt: number
}

export interface ProjectContext {
  product?: string
  technical?: string
  repoUrl?: string
  linkedRepos?: string[]
}

// ─── Inbox ───

export type InboxItemType = 'delegated_task' | 'task_delivery' | 'user_input'
export type InboxItemStatus = 'queued' | 'processing' | 'resolved' | 'failed'

export interface InboxItem {
  id: string
  agentId: string
  nodeId: string
  runId: string
  type: InboxItemType
  status: InboxItemStatus
  createdAt: number
}

// ─── Dynamic Agent Instance (动态 Agent 实例) ───

export interface DynamicAgentInstance {
  id: string
  baseAgentId: string
  nodeId: string
  runId: string
  role: AgentRole
  name: string
  scopedContext: ScopedContext
  status: 'created' | 'active' | 'completed' | 'terminated'
  createdAt: number
  terminatedAt?: number
}

export interface ScopedContext {
  systemPrompt: string
  nodeDescription: string
  nodePrompt?: string
  predecessorSummaries: string[]
  projectContext?: string
  skills: string[]
  variables: Record<string, string>
}

// ─── UI 类型 ───

export type ProjectTab = 'runs' | 'workflow' | 'skills' | 'agents' | 'settings'

export type RunDetailTab = 'dag' | 'agents' | 'artifacts' | 'log' | 'agent-tree' | 'context-db' | 'checkpoint'
