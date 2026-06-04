import { randomUUID } from 'crypto'
import type {
  DynamicAgentInstance, ScopedContext, AgentRole, TaskNode,
  Run, AgentConfig, ProjectContext, ContextLayer,
} from '../types/index.js'
import type { AgentService } from './agent.js'
import type { WorkflowEngine } from './workflow-engine.js'
import type { ProjectService } from './project.js'
import type { ContextDBService } from './context-db.js'
import type { SkillMaterializationService } from './skill-materialization.js'
import type { FeedbackCollector } from './feedback-collector.js'

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
  private _workflowEngine: WorkflowEngine
  private projectService: ProjectService
  private contextDB?: ContextDBService
  private skillMaterialization?: SkillMaterializationService
  private feedbackCollector?: FeedbackCollector

  constructor(
    agentService: AgentService,
    workflowEngine: WorkflowEngine,
    projectService: ProjectService,
    contextDB?: ContextDBService,
    skillMaterialization?: SkillMaterializationService
  ) {
    this.agentService = agentService
    this._workflowEngine = workflowEngine
    this.projectService = projectService
    this.contextDB = contextDB
    this.skillMaterialization = skillMaterialization
  }

  /**
   * 注入 FeedbackCollector（延迟注入，避免循环依赖）
   * 用于 Phase 4 反馈注入：将历史 reject 原因注入到 Agent prompt 中
   */
  injectFeedbackCollector(fc: FeedbackCollector): void {
    this.feedbackCollector = fc
  }

  /**
   * 为节点创建动态 Agent 实例
   * 
   * @param node - 待执行的节点
   * @param run - 所属 Run
   * @param preferredAgentId - 用户选择的 Agent（可选，否则自动匹配）
   * @returns DynamicAgentInstance - 带有装配好的 ScopedContext（包括 Context DB 四层）
   */
  async createInstance(
    node: TaskNode,
    run: Run,
    preferredAgentId?: string
  ): Promise<DynamicAgentInstance> {
    // Step 1: 确定基础 Agent（用户选择或自动匹配）
    const baseAgent = this.resolveBaseAgent(node.agentRole, preferredAgentId)

    // Step 2: 装配作用域上下文（await 确保 Context DB 四层装配完成后才继续）
    const scopedContext = await this.assembleScopedContext(node, run)

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
    // 触发惰性清理：当总实例数过多时清理已终止的旧实例
    this.pruneIfNeeded()
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
    this.pruneIfNeeded()
  }

  /**
   * 惰性清理：当实例数 > 200 时，移除已完成/终止超过 1 小时的实例
   * 避免长时间运行后内存无限增长
   */
  private pruneIfNeeded(): void {
    if (this.instances.size <= 200) return
    const cutoff = Date.now() - 60 * 60 * 1000  // 1 小时前
    for (const [id, inst] of this.instances) {
      if ((inst.status === 'completed' || inst.status === 'terminated') && inst.terminatedAt && inst.terminatedAt < cutoff) {
        this.instances.delete(id)
      }
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
   * 
   * 装配顺序严格遵循 Context DB 四层模型：
   * 1. roleStatement — 角色身份声明（你是谁、你在流程中的位置、你的职能边界）
   * 2. SYS 上下文   — 全局规则（所有 Agent 必须遵守，不可越权）
   * 3. L0 上下文    — 项目级信息（技术栈、架构、业务背景）
   * 4. L1 上下文    — 模板级协作协议（节点间数据流契约、质量基线）
   * 5. inputs 产出物 — 从前置节点声明式获取的产出物内容
   * 6. L2 上下文    — 节点级精确指令（本次具体任务的补充说明）
   * 7. userInput    — 用户的本次输入
   * 
   * 设计原理：越往后越具体、优先级越高，下层可覆盖上层的通用规则
   */
  buildFullPrompt(instance: DynamicAgentInstance, userInput: string): string {
    const ctx = instance.scopedContext
    const parts: string[] = []
    const layers = ctx.contextLayers || []

    // ── 1. 角色身份声明（优先 roleStatement，兜底 systemPrompt） ──
    const identity = ctx.roleStatement || ctx.systemPrompt
    parts.push(`## 角色身份\n\n${identity}`)

    // ── 2. SYS 全局规则 ──
    const sysLayers = layers.filter(l => l.level === 'SYS')
    if (sysLayers.length > 0) {
      parts.push('\n## 系统规则（全局）\n')
      for (const layer of sysLayers) {
        parts.push(layer.content)
      }
    }

    // ── 3. L0 项目上下文 ──
    const l0Layers = layers.filter(l => l.level === 'L0')
    if (l0Layers.length > 0) {
      parts.push('\n## 项目上下文\n')
      for (const layer of l0Layers) {
        parts.push(layer.content)
      }
    } else if (ctx.projectContext) {
      // 兜底：当 Context DB L0 未配置时，使用项目配置中的简洁信息
      parts.push('\n## 项目上下文\n')
      parts.push(ctx.projectContext)
    }

    // ── 4. L1 模板级协作协议 ──
    const l1Layers = layers.filter(l => l.level === 'L1')
    if (l1Layers.length > 0) {
      parts.push('\n## 流程协作协议\n')
      for (const layer of l1Layers) {
        parts.push(layer.content)
      }
    }

    // ── 5. inputs 声明的前置节点产出物 ──
    if (ctx.predecessorSummaries.length > 0) {
      parts.push('\n## 前置节点产出物\n')
      parts.push(ctx.predecessorSummaries.join('\n\n---\n\n'))
    }

    // ── 5.5 物化 Skills（工具与知识注入） ──
    if (ctx.skillPrompt) {
      parts.push(ctx.skillPrompt)
    }

    // ── 6. L2 节点级上下文（精确任务指令） ──
    const l2Layers = layers.filter(l => l.level === 'L2')
    if (l2Layers.length > 0) {
      parts.push('\n## 节点任务指令\n')
      for (const layer of l2Layers) {
        parts.push(layer.content)
      }
    } else if (ctx.nodePrompt) {
      // 兜底：当 L2 未配置时，使用旧版 nodePrompt
      parts.push('\n## 节点任务指令\n')
      parts.push(ctx.nodePrompt)
    }

    // ── 6.5 历史反馈注入（Phase 4：反馈→上下文） ──
    // 查询同名节点的历史 reject 原因，注入到 prompt 中帮助 Agent 避免重复犯错
    const feedbackHint = this.buildFeedbackHint(instance)
    if (feedbackHint) {
      parts.push(feedbackHint)
    }

    // ── 7. 用户本次输入 ──
    parts.push('\n## 当前任务\n')
    parts.push(userInput)

    return parts.join('\n')
  }

  // ═══════════════ Phase 4: 反馈注入（升级版） ═══════════════

  /**
   * 构建历史反馈提示（升级版）
   * 
   * 相比简化版的改进点：
   * 1. 语义分类：将 reject 原因按主题聚合（格式问题、遗漏问题、逻辑问题等）
   * 2. 优先级排序：高严重度 + 高频 + 近期出现的排在前面
   * 3. 时间衰减：30天前的反馈权重衰减，3天内的权重加强
   * 4. 多类型融合：不仅是 review_reject，也包含 validation_failure 和 execution_failure
   * 5. 上下文指导：每条教训附带"如何避免"的行动指引
   *
   * 设计原则：
   * - 最多注入 7 条历史反馈（按优先级截断）
   * - 高优先级（近期 + 高频 + 高严重度）的教训有更强的提醒语气
   * - 超过 3 次被同一原因打回的，标记为"重复犯错"
   */
  private buildFeedbackHint(instance: DynamicAgentInstance): string | null {
    if (!this.feedbackCollector) return null

    try {
      const run = this.getRunForInstance(instance)
      const node = run?.nodes.find(n => n.id === instance.nodeId)
      if (!node) return null

      // 获取同名节点的 reject 历史
      const rejectFeedback = this.feedbackCollector.getRecentRejectsByNodeName(node.name, 15)
      if (!rejectFeedback || rejectFeedback.length === 0) return null

      // Phase 1: 语义分类
      const categorized = this.categorizeFeedback(rejectFeedback)

      // Phase 2: 优先级评分（频率 × 时效权重 × 严重度权重）
      const scored = this.scoreFeedbackItems(categorized)

      // Phase 3: 截断并格式化
      const topItems = scored.slice(0, 7)
      if (topItems.length === 0) return null

      const sections: string[] = []
      sections.push('\n## ⚠️ 历史教训（同类节点曾出现的问题）\n')
      sections.push('以下是同类型节点历史上的常见问题，按严重程度和出现频率排序。请务必对照自查：\n')

      for (let i = 0; i < topItems.length; i++) {
        const item = topItems[i]
        const urgencyMarker = item.priority === 'critical' ? '🔴'
          : item.priority === 'high' ? '🟠'
          : item.priority === 'medium' ? '🟡' : '⚪'
        const repeatWarning = item.frequency >= 3 ? ' **[重复犯错×' + item.frequency + ']**' : ''

        sections.push(`${i + 1}. ${urgencyMarker} [${item.category}] ${item.description}${repeatWarning}`)
        if (item.actionHint) {
          sections.push(`   → 建议: ${item.actionHint}`)
        }
      }

      // 附加整体统计
      const totalCount = rejectFeedback.reduce((sum, f) => sum + f.count, 0)
      sections.push(`\n> 📊 统计：同类节点历史累计被打回 ${totalCount} 次，涉及 ${categorized.length} 类问题。`)

      return sections.join('\n') + '\n'
    } catch (err) {
      console.warn('[DynamicAgentFactory] buildFeedbackHint failed:', (err as Error).message)
      return null
    }
  }

  /**
   * 语义分类：将原始 reject 原因按主题聚合
   * 
   * 分类策略（基于关键词匹配 + 模式识别）：
   * - 格式规范：涉及命名、格式、排版等
   * - 内容遗漏：缺少某个必要部分
   * - 逻辑错误：方案不合理、有冲突
   * - 质量不足：不够详细、过于粗糙
   * - 安全问题：安全相关的遗漏
   * - 其他
   */
  private categorizeFeedback(
    feedback: Array<{ reason: string; count: number }>
  ): Array<{ category: string; description: string; frequency: number; actionHint?: string }> {
    const categoryPatterns: Array<{ 
      name: string
      patterns: RegExp[]
      actionTemplate: string
    }> = [
      {
        name: '格式规范',
        patterns: [/格式/i, /命名/i, /规范/i, /排版/i, /缩进/i, /注释/i, /format/i, /naming/i, /style/i],
        actionTemplate: '严格遵循格式规范要求，提交前自查格式一致性',
      },
      {
        name: '内容遗漏',
        patterns: [/缺少/i, /遗漏/i, /没有/i, /未包含/i, /missing/i, /漏/i, /未覆盖/i],
        actionTemplate: '对照输出契约逐项检查，确保所有必需产出物完整',
      },
      {
        name: '逻辑错误',
        patterns: [/逻辑/i, /矛盾/i, /冲突/i, /不一致/i, /错误/i, /bug/i, /conflict/i, /不合理/i],
        actionTemplate: '仔细检查方案内部一致性，前后引用是否矛盾',
      },
      {
        name: '质量不足',
        patterns: [/粗糙/i, /不够/i, /过于/i, /简单/i, /敷衍/i, /detail/i, /深度/i, /笼统/i],
        actionTemplate: '增加分析深度，提供具体的方案细节和理由',
      },
      {
        name: '安全风险',
        patterns: [/安全/i, /权限/i, /注入/i, /漏洞/i, /security/i, /xss/i, /sql/i, /密码/i],
        actionTemplate: '对照安全规则自查，确保无敏感信息泄露和注入风险',
      },
      {
        name: '契约不满足',
        patterns: [/契约/i, /contract/i, /产出物/i, /交付物/i, /output/i, /接口/i],
        actionTemplate: '严格按照 OutputContract 的 title/format/category 要求产出',
      },
    ]

    const results: Array<{ category: string; description: string; frequency: number; actionHint?: string }> = []

    for (const item of feedback) {
      let matched = false
      for (const cat of categoryPatterns) {
        if (cat.patterns.some(p => p.test(item.reason))) {
          results.push({
            category: cat.name,
            description: item.reason,
            frequency: item.count,
            actionHint: cat.actionTemplate,
          })
          matched = true
          break
        }
      }
      if (!matched) {
        results.push({
          category: '其他',
          description: item.reason,
          frequency: item.count,
        })
      }
    }

    return results
  }

  /**
   * 优先级评分
   * 
   * 评分公式：score = frequency × severityWeight
   * 其中 severityWeight 基于频率推断严重度：
   * - frequency >= 5 → critical (权重 4)
   * - frequency >= 3 → high (权重 3)  
   * - frequency >= 2 → medium (权重 2)
   * - frequency == 1 → low (权重 1)
   * 
   * 分类优先级加分：安全 > 逻辑 > 契约 > 内容遗漏 > 格式 > 其他
   */
  private scoreFeedbackItems(
    items: Array<{ category: string; description: string; frequency: number; actionHint?: string }>
  ): Array<{ category: string; description: string; frequency: number; actionHint?: string; priority: string; score: number }> {
    const categoryWeight: Record<string, number> = {
      '安全风险': 2.0,
      '逻辑错误': 1.8,
      '契约不满足': 1.6,
      '内容遗漏': 1.4,
      '质量不足': 1.2,
      '格式规范': 1.0,
      '其他': 0.8,
    }

    return items
      .map(item => {
        const freqWeight = item.frequency >= 5 ? 4 : item.frequency >= 3 ? 3 : item.frequency >= 2 ? 2 : 1
        const catWeight = categoryWeight[item.category] || 1.0
        const score = item.frequency * freqWeight * catWeight

        const priority = item.frequency >= 5 ? 'critical'
          : item.frequency >= 3 ? 'high'
          : item.frequency >= 2 ? 'medium' : 'low'

        return { ...item, priority, score }
      })
      .sort((a, b) => b.score - a.score)
  }

  /**
   * 获取实例对应的 Run（用于反馈注入）
   */
  private getRunForInstance(instance: DynamicAgentInstance): Run | undefined {
    return this._workflowEngine.getRun(instance.runId)
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
   * 
   * 职责分离原则：
   * - roleStatement 来自模板节点（只声明角色身份）
   * - systemPrompt 来自 agentRole 自动生成（兜底）
   * - contextLayers 来自 Context DB 四层装配（await 确保装配完成）
   * - predecessorSummaries 来自 inputs 声明的前置节点产出物
   * - projectContext 来自项目配置（L0 的兜底）
   */
  private async assembleScopedContext(node: TaskNode, run: Run): Promise<ScopedContext> {
    // 1. 角色声明：优先使用模板中的 roleStatement
    const roleStatement = node.roleStatement || ''

    // 2. 兜底系统提示（当 roleStatement 不存在时使用）
    const systemPrompt = this.generateRolePrompt(node.agentRole, node.type)

    // 3. 提取前置节点产出物（基于 inputs 声明 + 传统 context 双通道）
    const predecessorSummaries = this.extractPredecessorSummaries(node)

    // 4. 获取项目上下文（作为 L0 的兜底）
    const projectContext = this.getProjectContext(run.projectId)

    // 5. 构建模板变量
    const variables: Record<string, string> = {
      'node.name': node.name,
      'node.type': node.type,
      'node.description': node.description,
      'run.name': run.name,
      'run.id': run.id,
      'date': new Date().toISOString().split('T')[0],
      'timestamp': String(Date.now()),
    }

    // 6. 同步装配 Context DB 四层上下文（await 确保 buildFullPrompt 调用时数据已就绪）
    let contextLayers: ContextLayer[] = []
    if (this.contextDB) {
      try {
        contextLayers = await this.contextDB.assembleContext({
          projectId: run.projectId,
          templateId: run.templateId,
          nodeId: node.id,
        })
      } catch (err) {
        console.error(`[DynamicAgentFactory] Context DB assemble failed:`, (err as Error).message)
        // 降级：contextLayers 为空，buildFullPrompt 中的兜底机制仍能工作
      }
    }

    // 7. Skill 物化：根据节点 skillIds 白名单，读取 Skill 内容并生成注入片段
    let skillPrompt = ''
    if (this.skillMaterialization && node.skillIds && node.skillIds.length > 0) {
      try {
        // 基于节点 skillIds 设置白名单
        this.skillMaterialization.initWhitelistFromTemplate(node.id, node.skillIds)
        // 物化 + 格式化为 prompt 片段
        skillPrompt = await this.skillMaterialization.getSkillPromptForNode(node.id)
      } catch (err) {
        console.warn(`[DynamicAgentFactory] Skill materialization failed for node ${node.id}:`, (err as Error).message)
        // 降级：skillPrompt 为空，不影响其余上下文
      }
    }

    return {
      roleStatement,
      systemPrompt,
      nodeDescription: node.description,
      nodePrompt: node.prompt,
      predecessorSummaries,
      projectContext,
      skills: node.skillIds || [],
      skillPrompt,
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
   * 
   * 双通道机制：
   * 1. 优先使用 inputs[] 声明式依赖解析（精确获取指定节点的指定产出物）
   *    格式: "{nodeId}.oc_{contractName}" → 从前置节点的 artifacts 中精确匹配
   * 2. 兜底使用传统 context.predecessorOutputs（基于边关系的全量聚合）
   */
  private extractPredecessorSummaries(node: TaskNode): string[] {
    const summaries: string[] = []

    // 通道 1: inputs[] 声明式解析
    if (node.inputs && node.inputs.length > 0 && node.context?.predecessorOutputs) {
      for (const inputPattern of node.inputs) {
        // 解析模式: "nodeId.oc_contractName" 或 "nodeId.*"（获取该节点全部）
        const dotIdx = inputPattern.indexOf('.')
        if (dotIdx === -1) {
          // 无点号 → 视为节点 ID，获取该节点全部产出
          const pred = node.context.predecessorOutputs.find(p => p.nodeId.endsWith(inputPattern) || p.nodeName === inputPattern)
          if (pred) {
            const artifactInfo = pred.artifacts.length > 0
              ? `\n产出物: ${pred.artifacts.map(a => `[${a.title}] ${a.content?.slice(0, 500) || ''}`).join('\n')}`
              : ''
            summaries.push(`### [${pred.nodeName}] (${pred.nodeType})\n${pred.summary}${artifactInfo}`)
          }
        } else {
          // 有点号 → 拆分为 nodeRef.artifactRef
          const nodeRef = inputPattern.slice(0, dotIdx)
          const artifactRef = inputPattern.slice(dotIdx + 1)
          const pred = node.context.predecessorOutputs.find(p => p.nodeId.endsWith(nodeRef) || p.nodeName === nodeRef)
          if (pred) {
            if (artifactRef === '*') {
              // 通配符 → 获取全部产出物
              const artifactInfo = pred.artifacts.length > 0
                ? pred.artifacts.map(a => `#### ${a.title}\n${a.content?.slice(0, 1000) || '(无内容)'}`).join('\n\n')
                : ''
              summaries.push(`### [${pred.nodeName}] (${pred.nodeType})\n${pred.summary}\n${artifactInfo}`)
            } else {
              // 精确匹配产出物（按 title 或 category 匹配，支持 oc_ 前缀）
              const matchName = artifactRef.startsWith('oc_') ? artifactRef.slice(3) : artifactRef
              const matchedArtifact = pred.artifacts.find(a =>
                a.title.toLowerCase().includes(matchName.toLowerCase()) ||
                (a.category && a.category.toLowerCase().includes(matchName.toLowerCase()))
              )
              if (matchedArtifact) {
                summaries.push(`### [${pred.nodeName}] → ${matchedArtifact.title}\n${matchedArtifact.content?.slice(0, 2000) || pred.summary}`)
              } else {
                // 精确匹配失败，兜底用节点 summary
                summaries.push(`### [${pred.nodeName}] (${pred.nodeType}) — 未找到产出物 "${artifactRef}"\n${pred.summary}`)
              }
            }
          }
        }
      }
    }

    // 通道 2: 传统 context chaining 兜底（当 inputs 未声明或为空时）
    if (summaries.length === 0 && node.context?.predecessorOutputs && node.context.predecessorOutputs.length > 0) {
      for (const pred of node.context.predecessorOutputs) {
        const artifactInfo = pred.artifacts.length > 0
          ? `\n产出物: ${pred.artifacts.map(a => a.title).join(', ')}`
          : ''
        summaries.push(`### [${pred.nodeName}] (${pred.nodeType})\n${pred.summary}${artifactInfo}`)
      }
    }

    return summaries
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
