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
  prompt?: string                // 节点级 prompt（向后兼容）
  roleStatement?: string         // 角色声明（新模板使用）
  inputs?: string[]              // 声明式输入依赖（从模板继承）
  outputContracts?: OutputContract[] // 产出物契约（从模板继承）
  entryConditions?: EntryCondition[] // 准入条件（从模板继承）
  exitConditions?: ExitCondition[]   // 准出条件（从模板继承）
  userInput?: string             // 用户补充输入
  context?: NodeContext          // 从前置节点继承的上下文
  order: number                  // 执行顺序（DAG 拓扑排序用）
  executionMode?: ExecutionMode  // 执行模式（从模板继承）
  script?: string                // DET/HYB 模式下的脚本命令
  scriptCwd?: string             // 脚本执行目录
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

export type AgentCategory = 'codex' | 'claude' | 'custom'

export interface AgentConfig {
  id: string
  name: string
  role: AgentRole
  type: 'codex' | 'claude' | 'custom-cli'
  command: string
  description: string
  model?: string                 // 指定使用的模型（如 gpt-5.5, claude-opus-4-8）
  modelDescription?: string      // 模型官方描述（前端小字展示）
  category: AgentCategory        // Agent 分类（用于前端分组展示）
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

/**
 * 执行模式：
 * - det: 确定性执行（直接运行脚本，不走 LLM Agent）
 * - hyb: 混合模式（脚本 + LLM 兜底）
 * - llm: 纯 LLM Agent 执行（默认）
 */
export type ExecutionMode = 'det' | 'hyb' | 'llm'

export interface TemplateNode {
  id: string
  name: string
  type: NodeType
  description: string
  agentRole: AgentRole
  skillIds: string[]

  /**
   * 节点角色声明（精简版 prompt）
   * 只描述"你是谁、你在流程中的位置、你的职能边界"
   * 不包含具体任务细节（那是 L2 的事）、不包含项目信息（那是 L0 的事）
   * 不包含协作规则（那是 L1 的事）、不包含编码规范（那是 SYS 的事）
   */
  roleStatement: string

  /**
   * 向后兼容的 prompt 字段（deprecated，迁移期保留）
   * 新模板应使用 roleStatement + Context DB 四层体系
   */
  prompt?: string

  /**
   * 声明式输入依赖：本节点需要哪些前置节点的产出物
   * 格式: "{sourceNodeId}.{outputContractId}" 或 "{sourceNodeId}.*"（全部产出物）
   * 装配引擎会自动将这些产出物注入到 Agent 的 prompt 中
   */
  inputs?: string[]

  /**
   * 产出物契约：本节点必须/可选输出的结构化产物
   * 下游节点可通过 inputs 字段引用这些产出物
   */
  outputContracts?: OutputContract[]

  /**
   * 准入条件：前置节点满足什么状态/输出条件才能启动本节点
   * 默认：所有前置节点 status === 'completed'
   */
  entryConditions?: EntryCondition[]

  /**
   * 准出条件：本节点完成的标准（除了 outputContracts 全部满足之外的额外条件）
   */
  exitConditions?: ExitCondition[]

  executionMode?: ExecutionMode  // 执行模式，默认 'llm'
  script?: string                // DET/HYB 模式下的脚本命令
  scriptCwd?: string             // 脚本执行的工作目录（相对于项目根目录）
}

/**
 * 准入条件：节点启动前的检查项
 */
export interface EntryCondition {
  type: 'predecessor_status' | 'artifact_exists' | 'expression'
  /** predecessor_status: 指定前置节点 ID; artifact_exists: "{nodeId}.{contractId}"; expression: 自定义表达式 */
  value: string
  /** 条件描述（用于 UI 展示和 Agent 理解） */
  description?: string
}

/**
 * 准出条件：节点完成的额外验证规则
 */
export interface ExitCondition {
  type: 'output_contains' | 'lint_pass' | 'test_pass' | 'expression'
  /** 具体的验证值或规则 */
  value: string
  /** 条件描述 */
  description?: string
}

// ─── Repo Isolation (仓库隔离) ───

/**
 * 仓库池配置 — Run 级别共享仓库
 * 每个 Run 可关联多个仓库，Agent 通过 worktree/symlink 访问隔离的工作副本
 */
export interface RepoPool {
  runId: string
  repos: RepoEntry[]
}

export interface RepoEntry {
  id: string
  name: string
  url: string                     // Git clone URL 或本地路径
  localPath: string              // 本地 clone 的基础路径
  branch?: string                // 默认分支
  clonedAt?: number
}

/**
 * Agent 工作目录：每个 Agent Turn 获得独立的工作空间
 * 通过 git worktree 或目录拷贝实现隔离
 */
export interface AgentWorkspace {
  turnId: string
  agentId: string
  nodeId: string
  runId: string
  basePath: string               // 工作目录根路径
  repoMounts: RepoMount[]       // 挂载的仓库引用
  createdAt: number
  cleanedAt?: number
}

export interface RepoMount {
  repoId: string
  mountPath: string              // 在工作目录中的挂载点
  mode: 'worktree' | 'symlink' | 'copy'
  branch?: string
  permissions: RepoPermission
}

export type RepoPermission = 'read' | 'read-write' | 'none'

// ─── Skill Materialization (Skill 物化) ───

/**
 * Skill 物化配置 — 控制哪些 Skill 可被 Agent 在运行时加载
 */
export interface SkillWhitelist {
  nodeId: string
  allowedSkillIds: string[]      // 白名单：允许使用的 Skill ID 列表
  denySkillIds?: string[]        // 黑名单（优先级高于白名单）
}

/**
 * 运行时 Skill 实例：注入到 Agent 执行上下文中的 Skill 副本
 */
export interface MaterializedSkill {
  skillId: string
  name: string
  content: string                // Skill 文件内容副本
  injectedAt: number
  expiresAt?: number             // 过期时间（可选，防止 Skill 缓存过久）
}

// ─── Permission Isolation (权限隔离) ───

/**
 * Agent 权限策略
 * 定义 Agent 在 Run 中可访问的资源范围
 */
export interface AgentPermissionPolicy {
  agentId: string
  runId: string
  repoAccess: RepoAccessRule[]   // 仓库级别权限
  filePatterns?: FileAccessRule[] // 文件级别权限（glob 模式）
  networkAccess?: NetworkRule[]   // 网络访问控制（预留）
}

export interface RepoAccessRule {
  repoId: string
  permission: RepoPermission
  allowedPaths?: string[]        // 限制只能访问的子目录
  deniedPaths?: string[]         // 禁止访问的子目录
}

export interface FileAccessRule {
  pattern: string                // Glob 模式（如 "src/**/*.ts"）
  permission: 'read' | 'write' | 'none'
}

export interface NetworkRule {
  host: string
  allowed: boolean
}

// ─── A2A Protocol (Agent-to-Agent 通信协议增强) ───

/**
 * A2A 消息类型扩展
 * 在原有 InboxItem 基础上增加协议级别的消息路由和确认机制
 */
export type A2AMessageType =
  | 'delegated_task'             // 委派任务
  | 'task_delivery'              // 任务交付
  | 'user_input'                 // 用户输入
  | 'coordination'              // 协调消息（Agent 间同步）
  | 'progress_report'           // 进度汇报
  | 'resource_request'          // 资源请求（如请求访问某 repo）

export interface A2AMessage {
  id: string
  fromAgentId: string
  toAgentId: string
  runId: string
  nodeId: string
  type: A2AMessageType
  payload: unknown
  priority: 'low' | 'normal' | 'high' | 'critical'
  status: 'queued' | 'delivered' | 'processing' | 'resolved' | 'failed' | 'expired'
  requiresAck: boolean           // 是否需要接收方确认
  ackAt?: number
  createdAt: number
  deliveredAt?: number
  resolvedAt?: number
  expiresAt?: number             // 消息过期时间
  retryCount: number
  maxRetries: number
}

/**
 * A2A 通信通道：Agent 间建立的逻辑通信链路
 */
export interface A2AChannel {
  id: string
  runId: string
  participants: string[]         // Agent IDs
  createdAt: number
  lastActivityAt: number
}

// ─── OutputContract Validation (产出物合同验证) ───

/**
 * 合同验证结果
 */
export interface ContractValidationResult {
  nodeId: string
  passed: boolean
  results: ContractCheckResult[]
  validatedAt: number
}

export interface ContractCheckResult {
  contractId: string
  title: string
  required: boolean
  satisfied: boolean
  matchedArtifact?: string       // 匹配的 Artifact ID
  reason?: string                // 不满足的原因
}

// ─── Robustness (健壮性增强) ───

/**
 * 重试策略配置
 */
export interface RetryPolicy {
  maxRetries: number
  backoffType: 'fixed' | 'exponential'
  baseDelayMs: number
  maxDelayMs: number
}

/**
 * 死信队列项：多次重试仍失败的任务
 */
export interface DeadLetterItem {
  id: string
  nodeId: string
  runId: string
  agentId: string
  failedAt: number
  retryCount: number
  lastError: string
  originalPrompt: string
  resolution?: 'manual_retry' | 'skipped' | 'reassigned'
  resolvedAt?: number
}

/**
 * 检查点：Run 的快照，用于灾难恢复
 */
export interface Checkpoint {
  id: string
  runId: string
  snapshotAt: number
  nodeStates: Array<{ nodeId: string; status: TaskNodeStatus }>
  description?: string
}

/**
 * 审计日志条目
 */
export interface AuditLogEntry {
  id: string
  runId: string
  nodeId?: string
  agentId?: string
  action: string
  details: Record<string, unknown>
  timestamp: number
  level: 'info' | 'warn' | 'error'
}

// ─── Dynamic Agent Instance (动态 Agent 实例) ───

/**
 * 动态 Agent 实例：每个节点执行时动态创建的 Agent 实例
 * 不是静态常驻角色，而是针对具体任务动态装配上下文
 * 
 * 参考 MRF §6.3: "Agent 在接到任务时才被创建，不是静态常驻角色"
 */
export interface DynamicAgentInstance {
  id: string                        // 动态实例 ID (e.g. "agent_inst_xxxxx")
  baseAgentId: string               // 基于哪个 Agent 模板创建
  nodeId: string                    // 关联的节点
  runId: string                     // 关联的 Run
  role: AgentRole                   // 分配的角色
  name: string                      // 实例名称（动态生成）
  scopedContext: ScopedContext       // 作用域上下文
  status: 'created' | 'active' | 'completed' | 'terminated'
  createdAt: number
  terminatedAt?: number
}

/**
 * 作用域上下文：动态注入到 Agent 的精确上下文
 * 
 * 装配顺序（buildFullPrompt 的组装优先级）：
 * 1. roleStatement — 角色身份声明（你是谁、你的职能边界）
 * 2. SYS 上下文   — 全局规则（编码规范、安全策略、输出格式）
 * 3. L0 上下文    — 项目级信息（技术栈、架构、业务背景）
 * 4. L1 上下文    — 模板级协作协议（节点间数据流契约、质量基线）
 * 5. inputs 产出物 — 从前置节点声明式获取的产出物内容
 * 6. L2 上下文    — 节点级精确指令（本次具体任务的补充说明）
 * 7. userInput    — 用户的本次输入
 */
export interface ScopedContext {
  /** 角色声明（优先使用 roleStatement，兜底使用 agentRole 自动生成） */
  roleStatement: string
  /** 系统角色提示（向后兼容：当 roleStatement 不存在时使用） */
  systemPrompt: string
  nodeDescription: string           // 节点描述
  nodePrompt?: string               // 节点级 prompt（向后兼容）
  predecessorSummaries: string[]    // 前置节点摘要（从 inputs 声明解析）
  projectContext?: string           // 项目上下文（L0 不可用时的兜底）
  skills: string[]                  // 注入的 skill ID 列表
  variables: Record<string, string> // 模板变量
  contextLayers?: ContextLayer[]    // Context DB 四层上下文
}

/**
 * 上下文层级（预留 Context DB SYS/L0/L1/L2 集成）
 */
export interface ContextLayer {
  level: 'SYS' | 'L0' | 'L1' | 'L2'
  content: string
  source?: string                   // 来源文件路径或标识
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
  enabledAgentIds?: string[]       // 项目启用的 Agent ID 列表（未设置 = 全部启用）
  /** Git remote URL（跨设备同步时用于自动匹配同一项目） */
  gitRemote?: string
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
