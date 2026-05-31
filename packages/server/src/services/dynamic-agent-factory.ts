import { randomUUID } from 'crypto'
import type {
  DynamicAgentInstance, ScopedContext, AgentRole, TaskNode,
  Run, AgentConfig, NodeContext, ProjectContext, ContextLayer,
} from '../types/index.js'
import type { AgentService } from './agent.js'
import type { WorkflowEngine } from './workflow-engine.js'
import type { ProjectService } from './project.js'
import type { ContextDBService } from './context-db.js'

/**
 * DynamicAgentFactory — 动态 Agent 实例创建工厂
 * 
 * 参考 MRF §6.3 实时创建原则：
 * - Agent 在接到任务时才被创建，不是静态常驻角色
 * - 不是预先固定上下文
 * - 每个实例的 context 精准装配：role + template + predecessors + project
 * 
 * 核心流程：
 * 1. 节点执行前调用 createInstance()
 * 2. 工厂根据节点的 agentRole + 模板信息选择合适的 base Agent
 * 3. 动态装配 ScopedContext（角色 prompt + 节点描述 + 前置产出 + 项目上下文）
 * 4. 返回 DynamicAgentInstance，供 AgentService.startTurnAsync 使用
 * 5. 节点完成后标记实例为 completed/terminated
 */
export class DynamicAgentFactory {
  private instances: Map<string, DynamicAgentInstance> = new Map()
  private agentService: AgentService
  private projectService: ProjectService
  private contextDB?: ContextDBService

  constructor(
    agentService: AgentService,
    workflowEngine: WorkflowEngine,
    projectService: ProjectService,
    contextDB?: ContextDBService
  ) {
    this.agentService = agentService
    void workflowEngine // reserved for future orchestration hooks
    this.projectService = projectService
    this.contextDB = contextDB
  }

  /**
   * 为节点创建动态 Agent 实例
   * 
   * @param node - 待执行的节点
   * @param run - 所属 Run
   * @param preferredAgentId - 用户选择的 Agent（可选，否则自动匹配）
   * @returns DynamicAgentInstance - 带有装配好的 ScopedContext
   */
  createInstance(
    node: TaskNode,
    run: Run,
    preferredAgentId?: string
  ): DynamicAgentInstance {
    // Step 1: 确定基础 Agent（用户选择或自动匹配）
    const baseAgent = this.resolveBaseAgent(node.agentRole, preferredAgentId)

    // Step 2: 装配作用域上下文
    const scopedContext = this.assembleScopedContext(node, run)

    // Step 3: 创建动态实例
    const instance: DynamicAgentInstance = {
      id: `agent_inst_${randomUUID().slice(0, 8)}`,
      baseAgentId: baseAgent.id,
      nodeId: node.id,
      runId: run.id,
      role: node.agentRole,
      name: this.generateInstanceName(baseAgent, node),
      scopedContext,
      status: 'created',
      createdAt: Date.now(),
    }

    this.instances.set(instance.id, instance)
    console.log(`[DynamicAgentFactory] Created instance ${instance.id} (${instance.name}) for node "${node.name}"`)

    return instance
  }

  /**
   * 激活实例（节点开始执行时调用）
   */
  activateInstance(instanceId: string): void {
    const instance = this.instances.get(instanceId)
    if (instance) {
      instance.status = 'active'
    }
  }

  /**
   * 完成实例（节点执行完毕时调用）
   */
  completeInstance(instanceId: string): void {
    const instance = this.instances.get(instanceId)
    if (instance) {
      instance.status = 'completed'
      instance.terminatedAt = Date.now()
    }
  }

  /**
   * 终止实例（节点取消或失败时调用）
   */
  terminateInstance(instanceId: string): void {
    const instance = this.instances.get(instanceId)
    if (instance) {
      instance.status = 'terminated'
      instance.terminatedAt = Date.now()
    }
  }

  /**
   * 获取节点关联的动态实例
   */
  getInstanceByNode(nodeId: string, runId: string): DynamicAgentInstance | undefined {
    for (const instance of this.instances.values()) {
      if (instance.nodeId === nodeId && instance.runId === runId && instance.status !== 'terminated') {
        return instance
      }
    }
    return undefined
  }

  /**
   * 获取 Run 下所有活跃实例
   */
  getActiveInstances(runId: string): DynamicAgentInstance[] {
    return Array.from(this.instances.values()).filter(
      inst => inst.runId === runId && (inst.status === 'created' || inst.status === 'active')
    )
  }

  /**
   * 获取所有实例（用于 Agent Tree 可视化）
   */
  getAllInstances(runId?: string): DynamicAgentInstance[] {
    const all = Array.from(this.instances.values())
    return runId ? all.filter(inst => inst.runId === runId) : all
  }

  /**
   * 构建完整的 prompt（将 ScopedContext 组装为发送给 Agent 的完整 prompt）
   */
  buildFullPrompt(instance: DynamicAgentInstance, userInput: string): string {
    const ctx = instance.scopedContext
    const parts: string[] = []

    // 1. 系统角色提示
    parts.push(ctx.systemPrompt)

    // 2. Context DB 多层上下文（SYS → L0 → L1 → L2）
    if (ctx.contextLayers && ctx.contextLayers.length > 0) {
      const levelLabels: Record<string, string> = {
        SYS: '系统规则', L0: '项目上下文', L1: '流程上下文', L2: '节点上下文',
      }
      parts.push('\n## 上下文数据库\n')
      let currentLevel = ''
      for (const layer of ctx.contextLayers) {
        if (layer.level !== currentLevel) {
          currentLevel = layer.level
          parts.push(`\n### ${levelLabels[layer.level] || layer.level}\n`)
        }
        parts.push(layer.content)
      }
    }

    // 3. 项目上下文（如果有且 Context DB 未覆盖）
    if (ctx.projectContext && (!ctx.contextLayers || ctx.contextLayers.length === 0)) {
      parts.push('\n## 项目背景\n')
      parts.push(ctx.projectContext)
    }

    // 4. 前置节点产出物摘要
    if (ctx.predecessorSummaries.length > 0) {
      parts.push('\n## 前置节点产出物\n')
      parts.push(ctx.predecessorSummaries.join('\n---\n'))
    }

    // 5. 节点描述和 prompt
    if (ctx.nodePrompt) {
      parts.push('\n## 节点指令\n')
      parts.push(ctx.nodePrompt)
    }

    // 6. 用户本次输入
    parts.push('\n## 当前任务\n')
    parts.push(userInput)

    return parts.join('\n')
  }

  // ═══════════════ 内部方法 ═══════════════

  /**
   * 解析基础 Agent：优先使用用户选择，否则按角色自动匹配
   */
  private resolveBaseAgent(role: AgentRole, preferredAgentId?: string): AgentConfig {
    if (preferredAgentId) {
      const agent = this.agentService.getAgent(preferredAgentId)
      if (agent) return agent
    }

    // 自动匹配：获取该角色可用的 Agent，优先选择 available 的
    const candidates = this.agentService.getAgentsWithStatus()
      .filter(a => a.available && (a.role === role || a.id.includes('universal')))

    if (candidates.length > 0) {
      // 优先精确匹配角色
      const exactMatch = candidates.find(a => a.role === role)
      return exactMatch || candidates[0]
    }

    // 兜底：返回第一个可用 Agent
    const available = this.agentService.getAgentsWithStatus().filter(a => a.available)
    if (available.length > 0) return available[0]

    // 最终兜底：返回角色默认 Agent（即使不可用）
    const roleAgents = this.agentService.getAgentsByRole(role)
    if (roleAgents.length > 0) return roleAgents[0]

    throw new Error(`No agent available for role: ${role}`)
  }

  /**
   * 装配作用域上下文
   */
  private assembleScopedContext(node: TaskNode, run: Run): ScopedContext {
    // 1. 生成角色系统提示
    const systemPrompt = this.generateRolePrompt(node.agentRole, node.type)

    // 2. 提取前置节点摘要
    const predecessorSummaries = this.extractPredecessorSummaries(node.context)

    // 3. 获取项目上下文
    const projectContext = this.getProjectContext(run.projectId)

    // 4. 构建模板变量
    const variables: Record<string, string> = {
      'node.name': node.name,
      'node.type': node.type,
      'node.description': node.description,
      'run.name': run.name,
      'run.id': run.id,
      'date': new Date().toISOString().split('T')[0],
      'timestamp': String(Date.now()),
    }

    // 5. 异步装配 Context DB 层级（同步返回空，后台填充）
    const contextLayers: ContextLayer[] = []
    if (this.contextDB) {
      // 触发异步装配但不阻塞实例创建
      this.contextDB.assembleContext({
        projectId: run.projectId,
        templateId: run.templateId,
        nodeId: node.id,
      }).then(layers => {
        // 注入到实例中（实例对象是引用类型，buildFullPrompt 时会读到）
        const instance = this.getInstanceByNode(node.id, run.id)
        if (instance) {
          instance.scopedContext.contextLayers = layers
        }
      }).catch(err => {
        console.error(`[DynamicAgentFactory] Context DB assemble failed:`, err.message)
      })
    }

    return {
      systemPrompt,
      nodeDescription: node.description,
      nodePrompt: node.prompt,
      predecessorSummaries,
      projectContext,
      skills: node.skillIds || [],
      variables,
      contextLayers,
    }
  }

  /**
   * 生成增强版角色提示（考虑节点类型）
   */
  private generateRolePrompt(role: AgentRole, nodeType: string): string {
    const basePrompt = this.getBaseRolePrompt(role)
    const typeHint = this.getNodeTypeHint(nodeType)
    
    return `${basePrompt}\n\n当前阶段：${typeHint}`
  }

  private getBaseRolePrompt(role: AgentRole): string {
    switch (role) {
      case 'planner':
        return `你是一个项目规划师。你的职责是分析需求、制定技术方案、设计架构。
你需要产出结构化的分析文档，包括：需求理解、技术选型建议、架构设计、任务拆分建议。
请以 Markdown 格式输出，注重逻辑清晰和方案可执行性。`

      case 'manager':
        return `你是一个任务管理者。你的职责是将大任务拆分为可执行的子任务，分派给执行者，并验收执行结果。
你需要明确每个子任务的目标、输入、期望产出和验收标准。
请确保子任务的粒度合理，每个子任务应该在一个 Agent Turn 内可完成。`

      case 'executor':
        return `你是一个代码执行者。你的职责是根据任务要求，在指定的代码仓库中进行实际的代码编写、修改和测试。
请直接产出代码变更，并简要说明你的实现思路。确保代码质量和测试覆盖。`

      default:
        return '你是一个智能助手，请根据上下文完成指定任务。'
    }
  }

  private getNodeTypeHint(nodeType: string): string {
    switch (nodeType) {
      case 'specify': return '需求分析阶段 — 请深入理解用户需求，产出需求分析文档'
      case 'design': return '方案设计阶段 — 请基于需求产出技术方案'
      case 'task': return '任务拆分阶段 — 请将方案拆解为可执行的子任务'
      case 'implement': return '代码实现阶段 — 请根据方案和任务进行编码'
      case 'review': return '代码审查阶段 — 请对代码进行质量审查'
      case 'test': return '测试验证阶段 — 请编写和运行测试'
      case 'deliver': return '交付汇总阶段 — 请汇总所有产出物并生成交付报告'
      default: return '自定义阶段 — 请根据节点描述完成任务'
    }
  }

  /**
   * 提取前置节点摘要列表
   */
  private extractPredecessorSummaries(context?: NodeContext): string[] {
    if (!context?.predecessorOutputs || context.predecessorOutputs.length === 0) {
      return []
    }

    return context.predecessorOutputs.map(pred => {
      const artifactInfo = pred.artifacts.length > 0
        ? `\n产出物: ${pred.artifacts.map(a => a.title).join(', ')}`
        : ''
      return `### [${pred.nodeName}] (${pred.nodeType})\n${pred.summary}${artifactInfo}`
    })
  }

  /**
   * 获取项目级上下文
   */
  private getProjectContext(projectId: string): string | undefined {
    try {
      const project = this.projectService.getProject(projectId)
      if (!project?.contextConfig) return undefined

      const ctx: ProjectContext = project.contextConfig
      const parts: string[] = []

      if (ctx.product) parts.push(`产品背景: ${ctx.product}`)
      if (ctx.technical) parts.push(`技术栈: ${ctx.technical}`)
      if (ctx.repoUrl) parts.push(`仓库: ${ctx.repoUrl}`)

      return parts.length > 0 ? parts.join('\n') : undefined
    } catch {
      return undefined
    }
  }

  /**
   * 生成实例名称
   */
  private generateInstanceName(baseAgent: AgentConfig, node: TaskNode): string {
    const roleLabel = { planner: '规划', manager: '管理', executor: '执行' }[node.agentRole] || '通用'
    return `${baseAgent.name} [${roleLabel}·${node.name}]`
  }
}
