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

export type AgentCategory = 'codex' | 'claude' | 'custom'

export interface AgentConfig {
  id: string
  name: string
  role: AgentRole
  type: 'codex' | 'claude' | 'custom-cli'
  description: string
  model?: string
  modelDescription?: string
  category: AgentCategory
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
  mergeMode?: 'local' | 'pr'      // 代码合入方式：本地合入 or PR 模式
  defaultExecutionMode?: 'llm' | 'det' | 'hyb'  // 默认运行模式
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

export type RunDetailTab = 'dag' | 'agents' | 'artifacts' | 'log' | 'agent-tree' | 'context-db' | 'checkpoint' | 'a2a' | 'diff-review' | 'metrics' | 'autoflow' | 'digest' | 'l1-rules' | 'validation' | 'merge-conflict' | 'feedback' | 'sub-turn'

// ─── A2A Protocol (Agent-to-Agent 通信) ───

export type A2AMessageType =
  | 'delegated_task'
  | 'task_delivery'
  | 'user_input'
  | 'progress_report'
  | 'resource_request'

export type A2AMessageStatus = 'queued' | 'delivered' | 'processing' | 'resolved' | 'failed' | 'expired'

export type A2APriority = 'low' | 'normal' | 'high' | 'critical'

export interface A2AMessage {
  id: string
  fromAgentId: string
  toAgentId: string
  runId: string
  nodeId: string
  type: A2AMessageType
  payload: unknown
  priority: A2APriority
  status: A2AMessageStatus
  requiresAck: boolean
  createdAt: number
  expiresAt?: number
  deliveredAt?: number
  ackAt?: number
  resolvedAt?: number
  retryCount: number
  maxRetries: number
}

export interface A2AChannel {
  id: string
  runId: string
  participants: string[]
  createdAt: number
  lastActivityAt: number
}

export interface A2AStats {
  total: number
  queued: number
  processing: number
  resolved: number
  failed: number
  expired: number
}

// ─── AgentCard (标准化 Agent 描述符) ───

export interface AgentCard {
  id: string
  name: string
  version: string
  description: string
  provider: AgentProvider
  capabilities: AgentCapability[]
  roles: AgentRole[]
  endpoint: AgentEndpoint
  contextScope: AgentContextScope
  constraints: AgentConstraints
  metadata?: Record<string, unknown>
  registeredAt: number
  lastActiveAt?: number
}

export interface AgentProvider {
  id: string
  name: string
  command: string
  model?: string
  category: AgentCategory
}

export interface AgentCapability {
  id: string
  description: string
  languages?: string[]
  domains?: string[]
  strength: number
}

export interface AgentEndpoint {
  type: 'local-cli' | 'http' | 'grpc' | 'a2a-internal'
  address: string
  protocolVersion: string
  supportedMessageTypes: A2AMessageType[]
  maxConcurrency: number
}

export interface AgentContextScope {
  requiredLayers: ('SYS' | 'L0' | 'L1' | 'L2')[]
  nodeTypes: NodeType[]
  preferredPaths?: string[]
  excludedPaths?: string[]
  maxContextTokens: number
}

export interface AgentConstraints {
  maxTurnsPerNode: number
  maxExecutionTimeSec: number
  supportsStreaming: boolean
  supportsCancellation: boolean
  requiresInteraction: boolean
}

// ─── Adversarial / Sub-Turn (节点内多 Agent 对抗) ───

export type SubTurnRole = 'coder' | 'reviewer' | 'tester'
export type SubTurnStatus = 'pending' | 'running' | 'completed' | 'failed'
export type ReviewVerdict = 'approved' | 'rejected' | 'conditional'
export type AdversarialStrategy = 'coder_reviewer' | 'coder_reviewer_tester' | 'review_only'
export type AdversarialSessionStatus = 'active' | 'completed' | 'failed' | 'max_rounds_exceeded'

export interface SubTurn {
  id: string
  parentTurnId: string
  nodeId: string
  runId: string
  roundIndex: number
  role: SubTurnRole
  agentInstanceId: string
  status: SubTurnStatus
  prompt: string
  output: string
  verdict?: ReviewVerdict
  reviewFeedback?: string[]
  startedAt: number
  completedAt?: number
  tokenUsage?: { input: number; output: number; total: number }
}

export interface AdversarialSession {
  id: string
  nodeId: string
  runId: string
  parentTurnId: string
  strategy: AdversarialStrategy
  subTurns: SubTurn[]
  currentRound: number
  maxRounds: number
  result?: AdversarialResult
  status: AdversarialSessionStatus
  startedAt: number
  completedAt?: number
}

export interface AdversarialResult {
  passed: boolean
  totalRounds: number
  finalVerdict: ReviewVerdict
  qualityScore: number
  summary: string
}
