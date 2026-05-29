// ═══════════════════════════════════════════════════
// AgentFlow Core Types — 参考 MAF 三层状态机设计
// ═══════════════════════════════════════════════════

// ─── Run (最高层：一次完整的工作流执行实例) ───

export type RunStatus = 'created' | 'running' | 'paused' | 'completed' | 'failed'

export interface Run {
  id: string
  projectId: string
  templateId: string
  name: string
  description?: string
  status: RunStatus
  nodes: TaskNode[]              // DAG 节点列表
  edges: DAGEdge[]               // DAG 依赖边
  config?: RunConfig             // 运行时配置
  createdAt: number
  startedAt?: number
  completedAt?: number
}

/**
 * Run 运行时配置
 */
export interface RunConfig {
  autoExecute?: boolean          // 是否自动执行 ready 节点（并行模式）
  defaultAgentId?: string        // 默认 Agent（自动执行时使用）
  maxParallel?: number           // 最大并行节点数
}

// ─── DAG (有向无环图定义) ───

export interface DAGEdge {
  source: string   // 源节点 ID
  target: string   // 目标节点 ID
  condition?: EdgeCondition  // 条件分支：当条件满足时才激活此边
}

/**
 * 边条件配置 — 支持条件分支
 * 当源节点完成后，只有满足条件的边才会激活下游节点
 */
export interface EdgeCondition {
  type: 'status' | 'output_contains' | 'expression'
  // status: 源节点的完成状态匹配（如 completed / failed）
  // output_contains: 源节点输出包含特定关键词
  // expression: 简单表达式评估（预留扩展）
  value: string
}

// ─── TaskNode (工作流节点状态机) ───

/**
 * 节点状态机：
 *   pending → ready → running → wait_user_review → completed
 *                   ↘ failed
 *                   ↗ (rollback: 回到 pending)
 * 
 * - pending: 等待前置节点完成
 * - ready: 前置节点全部完成，可以启动
 * - running: Agent 正在工作
 * - wait_user_review: Agent 提交等待用户验收
 * - completed: 节点完成
 * - failed: 执行失败
 * - skipped: 用户跳过
 */
export type TaskNodeStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'wait_user_review'
  | 'completed'
  | 'failed'
  | 'skipped'

export interface TaskNode {
  id: string
  runId: string
  name: string
  type: NodeType
  description: string
  status: TaskNodeStatus
  agentRole: AgentRole           // 由哪种角色的 Agent 执行
  skillIds: string[]             // 绑定的 Skills
  artifacts: Artifact[]          // 产出物
  prompt?: string                // 节点级 prompt
  userInput?: string             // 用户补充输入
  context?: NodeContext          // 从前置节点继承的上下文
  order: number                  // 执行顺序（DAG 拓扑排序用）
  startedAt?: number
  completedAt?: number
  error?: string
}

/**
 * 节点上下文：由前置节点的产出物和输出自动聚合而来
 * 实现 Context Chaining — 后续节点可自动获取前置节点的成果
 */
export interface NodeContext {
  predecessorOutputs: PredecessorOutput[]
  variables?: Record<string, string>   // 模板变量（用于 Prompt 模板化）
}

export interface PredecessorOutput {
  nodeId: string
  nodeName: string
  nodeType: NodeType
  summary: string              // Turn 输出摘要
  artifacts: Artifact[]        // 产出物引用
}

export type NodeType =
  | 'specify'       // 需求分析
  | 'design'        // 方案设计
  | 'task'          // 任务拆分
  | 'implement'     // 代码实现
  | 'review'        // 代码审查
  | 'test'          // 测试验证
  | 'deliver'       // 交付汇总
  | 'custom'        // 自定义

// ─── AgentRole (多角色 Agent 体系) ───

/**
 * 参考 MAF 的 planner / task_manager / repo_executor
 * 简化为三层：
 * - planner: 全局规划，生成 DAG
 * - manager: 管理节点执行，分派子任务
 * - executor: 实际代码执行
 */
export type AgentRole = 'planner' | 'manager' | 'executor'

export interface AgentConfig {
  id: string
  name: string
  role: AgentRole
  type: 'codex' | 'claude' | 'custom-cli'
  command: string
  description: string
  env?: Record<string, string>
  maxTurns?: number              // 单节点最大 turn 数
}

// ─── AgentTurn (Agent Turn 状态机) ───

/**
 * Agent Turn 生命周期（参考 MAF 5 阶段协议）：
 *   idle → running → (result recorded) → finalized → idle
 *        ↘ paused (等待用户输入)
 *        ↘ error (执行失败)
 * 
 * 每个 turn 是一次完整的 Agent 调用周期
 */
export type AgentTurnStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error'

export type TurnResult = 'succeeded' | 'failed' | 'paused_for_question'

export interface AgentTurn {
  id: string
  nodeId: string
  runId: string
  agentId: string
  turnIndex: number              // 第几个 turn（一个节点可能多次 turn）
  status: AgentTurnStatus
  result?: TurnResult
  prompt: string                 // 本次 turn 的输入
  output: string                 // Agent 输出
  question?: string              // paused_for_question 时的问题
  tokenUsage?: TokenUsage
  startedAt: number
  completedAt?: number
}

export interface TokenUsage {
  input: number
  output: number
  total: number
}

// ─── Inbox (Agent 间通信机制) ───

/**
 * 简化版 A2A Inbox：
 * - delegated_task: 委派任务给下游 Agent
 * - task_delivery: 下游完成后回报结果
 * - user_input: 用户补充信息
 */
export type InboxItemType = 'delegated_task' | 'task_delivery' | 'user_input'
export type InboxItemStatus = 'queued' | 'processing' | 'resolved' | 'failed'

export interface InboxItem {
  id: string
  agentId: string
  nodeId: string
  runId: string
  type: InboxItemType
  status: InboxItemStatus
  payload: DelegatedTask | TaskDelivery | UserInput
  createdAt: number
  resolvedAt?: number
}

export interface DelegatedTask {
  title: string
  intent: string
  context?: string               // 推荐的上下文范围
  outputContracts?: OutputContract[]
}

export interface TaskDelivery {
  taskId: string
  summary: string
  artifacts: Artifact[]
  inputRequired?: boolean
}

export interface UserInput {
  question: string
  answer: string
}

// ─── OutputContract (产出物合同) ───

export interface OutputContract {
  id: string
  title: string
  category: 'document' | 'code' | 'config' | 'test' | 'report'
  format: string                 // markdown / json / proto / typescript 等
  required: boolean
}

// ─── Artifact (结构化产出物) ───

export interface Artifact {
  id: string
  nodeId: string
  title: string
  category: OutputContract['category']
  format: string
  content?: string               // 内联小文件内容
  filePath?: string              // 大文件路径引用
  createdAt: number
}

// ─── Workflow Template (SDD 流程模板) ───

export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  nodes: TemplateNode[]
  edges: DAGEdge[]
}

export interface TemplateNode {
  id: string
  name: string
  type: NodeType
  description: string
  agentRole: AgentRole
  skillIds: string[]
  prompt?: string                // 默认 prompt 模板
  outputContracts?: OutputContract[]
}

// ─── Skill ───

export interface SkillConfig {
  id: string
  name: string
  path: string
  description: string
  triggers: string[]
  content?: string
}

// ─── Project ───

export interface ProjectData {
  id: string
  name: string
  path: string
  description?: string
  contextConfig?: ProjectContext
  createdAt: number
  lastActiveAt: number
}

/**
 * 项目上下文配置（简化版三维上下文）
 * - product: 产品/业务背景
 * - technical: 技术架构信息
 * - repo: 仓库相关配置
 */
export interface ProjectContext {
  product?: string               // 产品描述
  technical?: string             // 技术栈信息
  repoUrl?: string               // 仓库地址
  linkedRepos?: string[]         // 关联仓库
}

// ─── WebSocket 消息 ───

export type WsMessageType =
  // 终端
  | 'terminal:input'
  | 'terminal:output'
  | 'terminal:start'
  // Run 状态
  | 'run:status_changed'
  | 'run:node_updated'
  // Agent Turn
  | 'agent:turn_started'
  | 'agent:turn_output'
  | 'agent:turn_completed'
  | 'agent:turn_paused'
  | 'agent:turn_error'
  // 文件变更
  | 'file:changed'
  | 'file:created'
  | 'file:deleted'

export interface WsMessage<T = unknown> {
  type: WsMessageType
  payload: T
  timestamp: number
}

// ─── FileChange ───

export interface FileChange {
  path: string
  type: 'add' | 'change' | 'unlink'
  content?: string
  diff?: string
}

// ─── API Response 辅助类型 ───

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}
