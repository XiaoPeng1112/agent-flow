import { spawn, execSync, type ChildProcess } from 'child_process'
import type {
  AgentConfig, AgentRole, AgentCard, AgentCapability,
  AgentProvider, AgentEndpoint, AgentContextScope, AgentConstraints,
  NodeType, A2AMessageType,
} from '../types/index.js'
import type { WorkflowEngine } from './workflow-engine.js'
import type { AutoFlowEngine } from './auto-flow-engine.js'
import type { AdversarialTurnService } from './adversarial-turn.js'
import type { A2AProtocolService } from './a2a-protocol.js'

/**
 * AgentService — 多角色 Agent 调度服务
 * 
 * 参考 MAF 的角色体系：
 * - planner: 全局规划，分析需求生成 DAG
 * - manager: 管理节点，分派子任务，验收结果
 * - executor: 实际执行代码操作
 * 
 * 改进点：
 * - 执行前检测 CLI 是否可用（which/command -v）
 * - 流式输出实时推送
 * - 支持取消执行
 * - 超时保护
 */
export class AgentService {
  private agents: Map<string, AgentConfig> = new Map()
  private agentCards: Map<string, AgentCard> = new Map()  // AgentCard Registry
  private activeProcesses: Map<string, ChildProcess> = new Map()  // turnId → process
  private cancelledTurns: Set<string> = new Set()  // 已取消的 turn，防止 close handler 重复提交
  private workflowEngine: WorkflowEngine
  private autoFlowEngine?: AutoFlowEngine
  private adversarialTurnService?: AdversarialTurnService
  private a2aProtocol?: A2AProtocolService

  constructor(workflowEngine: WorkflowEngine) {
    this.workflowEngine = workflowEngine
    this.registerDefaults()
    // AgentCards 已在 registerAgent() 中同步生成，无需额外调用 buildCardsFromConfigs
  }

  /**
   * 注入 AutoFlowEngine（延迟注入，避免循环依赖）
   */
  injectAutoFlow(autoFlowEngine: AutoFlowEngine): void {
    this.autoFlowEngine = autoFlowEngine
  }

  /**
   * 注入 AdversarialTurnService（延迟注入，避免循环依赖）
   */
  injectAdversarial(adversarialTurnService: AdversarialTurnService): void {
    this.adversarialTurnService = adversarialTurnService
  }

  /**
   * 注入 A2AProtocolService（进度汇报 + 任务交付消息）
   */
  injectA2A(a2aProtocol: A2AProtocolService): void {
    this.a2aProtocol = a2aProtocol
  }

  private registerDefaults(): void {
    // ═══════════════ Codex 系列 Agent（OpenAI GPT 模型）═══════════════

    this.registerAgent({
      id: 'codex-planner',
      name: 'Codex Planner (GPT-5.5)',
      role: 'planner',
      type: 'codex',
      command: 'codex',
      model: 'gpt-5.5',
      category: 'codex',
      description: '旗舰模型，全局需求分析与架构设计，推理能力最强',
      modelDescription: '最强旗舰模型，顶级推理与创造力',
      maxTurns: 3,
    })

    this.registerAgent({
      id: 'codex-manager',
      name: 'Codex Manager (GPT-5.4)',
      role: 'manager',
      type: 'codex',
      command: 'codex',
      model: 'gpt-5.4',
      category: 'codex',
      description: '深度推理模型，任务分派、代码审查与质量验收',
      modelDescription: '深度推理模型，适合复杂分析与决策',
      maxTurns: 5,
    })

    this.registerAgent({
      id: 'codex-coder',
      name: 'Codex Coder (GPT-5.3-codex)',
      role: 'executor',
      type: 'codex',
      command: 'codex',
      model: 'gpt-5.3-codex',
      category: 'codex',
      description: '代码专精模型，Codex 系列能力天花板，性价比最优的代码生成选择',
      modelDescription: '代码专精模型，编码能力最强',
      maxTurns: 10,
    })

    this.registerAgent({
      id: 'codex-tester',
      name: 'Codex Tester (GPT-5.2)',
      role: 'executor',
      type: 'codex',
      command: 'codex',
      model: 'gpt-5.2',
      category: 'codex',
      description: '通用模型，适合测试脚本编写与回归验证，成本最低',
      modelDescription: '轻量通用模型，成本最低',
      maxTurns: 10,
    })

    this.registerAgent({
      id: 'codex-universal',
      name: 'Codex Universal (GPT-5.4)',
      role: 'planner',
      type: 'codex',
      command: 'codex',
      model: 'gpt-5.4',
      category: 'codex',
      description: '通用 Agent，平衡能力与成本，可用于任何节点类型',
      modelDescription: '深度推理模型，平衡能力与成本',
      maxTurns: 10,
    })

    // ═══════════════ Claude 系列 Agent（Anthropic 模型）═══════════════

    this.registerAgent({
      id: 'claude-planner',
      name: 'Claude Planner (Opus-4-8)',
      role: 'planner',
      type: 'claude',
      command: 'claude',
      model: 'claude-opus-4-8',
      category: 'claude',
      description: '旗舰模型，全局需求分析与架构设计，推理能力最强',
      modelDescription: '最新最强的旗舰模型',
      maxTurns: 3,
    })

    this.registerAgent({
      id: 'claude-manager',
      name: 'Claude Manager (Opus-4-7)',
      role: 'manager',
      type: 'claude',
      command: 'claude',
      model: 'claude-opus-4-7',
      category: 'claude',
      description: '次旗舰模型，任务分派、代码审查与质量验收',
      modelDescription: '次旗舰模型，性能超越前代',
      maxTurns: 5,
    })

    this.registerAgent({
      id: 'claude-coder',
      name: 'Claude Coder (Opus-4-6)',
      role: 'executor',
      type: 'claude',
      command: 'claude',
      model: 'claude-opus-4-6',
      category: 'claude',
      description: '最智能模型，代码生成与代理构建能力最强',
      modelDescription: '最智能的模型，用于构建代理和编码',
      maxTurns: 10,
    })

    this.registerAgent({
      id: 'claude-tester',
      name: 'Claude Tester (Haiku-4-5)',
      role: 'executor',
      type: 'claude',
      command: 'claude',
      model: 'claude-haiku-4-5-20251001',
      category: 'claude',
      description: '轻量快速模型，适合测试脚本编写与简单任务',
      modelDescription: '快速响应，适合简单任务',
      maxTurns: 10,
    })

    this.registerAgent({
      id: 'claude-universal',
      name: 'Claude Universal (Sonnet-4-6)',
      role: 'planner',
      type: 'claude',
      command: 'claude',
      model: 'claude-sonnet-4-6',
      category: 'claude',
      description: '通用 Agent，平衡性能与速度，可用于任何节点类型',
      modelDescription: '平衡性能与速度，适合日常使用',
      maxTurns: 10,
    })
  }

  // ═══════════════ Agent 注册 ═══════════════

  registerAgent(config: AgentConfig): void {
    this.agents.set(config.id, config)
    // 同步生成 AgentCard（确保新注册的 Agent 也能被能力路由发现）
    const card = this.buildCardFromConfig(config)
    this.agentCards.set(card.id, card)
  }

  getAgents(): AgentConfig[] {
    return Array.from(this.agents.values())
  }

  getAgentsByRole(role: AgentRole): AgentConfig[] {
    // 返回该角色的 Agent + 所有通用 Agent
    return this.getAgents().filter((a) => 
      a.role === role || a.id.includes('universal')
    )
  }

  getAgent(id: string): AgentConfig | undefined {
    return this.agents.get(id)
  }

  // ═══════════════ AgentCard Registry ═══════════════

  /**
   * 注册 AgentCard（手动注册完整 AgentCard，适用于外部 Agent）
   */
  registerCard(card: AgentCard): void {
    this.agentCards.set(card.id, card)
  }

  /**
   * 从已注册的 AgentConfig 自动生成 AgentCard 并注册
   * 在 registerDefaults 之后调用一次即可
   */
  buildCardsFromConfigs(): void {
    for (const config of this.agents.values()) {
      const card = this.buildCardFromConfig(config)
      this.agentCards.set(card.id, card)
    }
    console.log(`[AgentCard] Built ${this.agentCards.size} cards from registered agents`)
  }

  /**
   * 获取所有已注册的 AgentCard
   */
  getCards(): AgentCard[] {
    return Array.from(this.agentCards.values())
  }

  /**
   * 获取指定 AgentCard
   */
  getCard(id: string): AgentCard | undefined {
    return this.agentCards.get(id)
  }

  /**
   * 基于能力标签查询：返回所有具备指定能力的 Agent
   * 
   * @param capabilityId - 能力标签 ID（如 'code-generation', 'code-review'）
   * @param minStrength - 最低能力强度 (0.0-1.0)，默认 0.3
   */
  queryByCapability(capabilityId: string, minStrength = 0.3): AgentCard[] {
    return this.getCards().filter(card =>
      card.capabilities.some(
        cap => cap.id === capabilityId && cap.strength >= minStrength
      )
    )
  }

  /**
   * 基于语言/技术栈查询：返回擅长指定语言的 Agent
   */
  queryByLanguage(language: string): AgentCard[] {
    const lower = language.toLowerCase()
    return this.getCards().filter(card =>
      card.capabilities.some(
        cap => cap.languages?.some(l => l.toLowerCase() === lower)
      )
    )
  }

  /**
   * 基于领域查询：返回擅长指定领域的 Agent
   */
  queryByDomain(domain: string): AgentCard[] {
    const lower = domain.toLowerCase()
    return this.getCards().filter(card =>
      card.capabilities.some(
        cap => cap.domains?.some(d => d.toLowerCase() === lower)
      )
    )
  }

  /**
   * 智能路由：根据任务描述找到最合适的 Agent
   * 
   * 匹配策略（加权打分）：
   * 1. 角色匹配（精确匹配角色 +10 分）
   * 2. 能力匹配（每个匹配的 capability × strength 权重）
   * 3. 节点类型匹配（AgentCard.contextScope.nodeTypes 包含目标类型 +5 分）
   * 4. 可用性（CLI 可用 +20 分，不可用 -100 分）
   * 
   * @returns 按得分降序排列的 AgentCard 列表（已过滤不可用的）
   */
  findBestForTask(params: {
    role?: AgentRole
    capabilities?: string[]
    language?: string
    domain?: string
    nodeType?: NodeType
  }): AgentCard[] {
    const { role, capabilities, language, domain, nodeType } = params

    const scored = this.getCards().map(card => {
      let score = 0

      // 1. 角色匹配
      if (role && card.roles.includes(role)) {
        score += 10
      }

      // 2. 能力匹配
      if (capabilities) {
        for (const capId of capabilities) {
          const match = card.capabilities.find(c => c.id === capId)
          if (match) {
            score += match.strength * 8  // 最高 8 分
          }
        }
      }

      // 3. 语言匹配
      if (language) {
        const lower = language.toLowerCase()
        const langMatch = card.capabilities.some(
          c => c.languages?.some(l => l.toLowerCase() === lower)
        )
        if (langMatch) score += 5
      }

      // 4. 领域匹配
      if (domain) {
        const lower = domain.toLowerCase()
        const domainMatch = card.capabilities.some(
          c => c.domains?.some(d => d.toLowerCase() === lower)
        )
        if (domainMatch) score += 5
      }

      // 5. 节点类型匹配
      if (nodeType && card.contextScope.nodeTypes.includes(nodeType)) {
        score += 5
      }

      // 6. 可用性检查（CLI 是否存在）
      const cliCheck = this.checkCliAvailable(card.provider.command)
      if (cliCheck.available) {
        score += 20
      } else {
        score -= 100  // 不可用的 Agent 几乎不应被选中
      }

      return { card, score }
    })

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(s => s.card)
  }

  /**
   * 更新 AgentCard 的 lastActiveAt 时间戳（Agent 被使用时调用）
   */
  touchCard(agentId: string): void {
    const card = this.agentCards.get(agentId)
    if (card) {
      card.lastActiveAt = Date.now()
    }
  }

  /**
   * 从 AgentConfig 构建 AgentCard
   * 
   * 映射策略：
   * - provider: 从 type + command + model + category 映射
   * - capabilities: 从 role + description 推导默认能力集
   * - endpoint: 所有内置 Agent 均为 local-cli 类型
   * - contextScope: 根据 role 推导默认可处理的节点类型
   * - constraints: 从 maxTurns 和 Agent 特性推导
   */
  private buildCardFromConfig(config: AgentConfig): AgentCard {
    const now = Date.now()

    const provider: AgentProvider = {
      id: config.type === 'codex' ? 'openai' : config.type === 'claude' ? 'anthropic' : 'custom',
      name: config.type === 'codex' ? 'OpenAI' : config.type === 'claude' ? 'Anthropic' : 'Custom',
      command: config.command,
      model: config.model,
      category: config.category,
    }

    const capabilities = this.inferCapabilities(config)
    const roles: AgentRole[] = config.id.includes('universal')
      ? ['planner', 'manager', 'executor']
      : [config.role]

    const endpoint: AgentEndpoint = {
      type: 'local-cli',
      address: config.command,
      protocolVersion: '1.0',
      supportedMessageTypes: ['delegated_task', 'task_delivery', 'progress_report'] as A2AMessageType[],
      maxConcurrency: config.role === 'planner' ? 1 : 3,
    }

    const contextScope: AgentContextScope = {
      requiredLayers: this.inferRequiredLayers(config.role),
      nodeTypes: this.inferNodeTypes(config.role),
      maxContextTokens: this.inferMaxTokens(config),
    }

    const constraints: AgentConstraints = {
      maxTurnsPerNode: config.maxTurns || 10,
      maxExecutionTimeSec: 600,  // 10 min (与 timeout 一致)
      supportsStreaming: true,
      supportsCancellation: true,
      requiresInteraction: false,
    }

    return {
      id: config.id,
      name: config.name,
      version: '1.0.0',
      description: config.description,
      provider,
      capabilities,
      roles,
      endpoint,
      contextScope,
      constraints,
      registeredAt: now,
    }
  }

  /**
   * 从 AgentConfig 推导能力声明
   * 
   * 推导规则：
   * - planner → architecture-design (0.9), task-decomposition (0.8)
   * - manager → code-review (0.8), quality-assurance (0.7), task-decomposition (0.7)
   * - executor → code-generation (0.9), debugging (0.7), testing (0.6)
   * - 包含 'coder' → code-generation strength 提升到 0.95
   * - 包含 'tester' → testing strength 提升到 0.9
   */
  private inferCapabilities(config: AgentConfig): AgentCapability[] {
    const caps: AgentCapability[] = []
    const allLanguages = ['typescript', 'javascript', 'python', 'go', 'rust', 'java']
    const isCoder = config.id.includes('coder')
    const isTester = config.id.includes('tester')

    switch (config.role) {
      case 'planner':
        caps.push({
          id: 'architecture-design',
          description: '架构设计与技术方案',
          languages: allLanguages,
          domains: ['frontend', 'backend', 'fullstack'],
          strength: 0.9,
        })
        caps.push({
          id: 'task-decomposition',
          description: '需求分析与任务拆分',
          domains: ['project-management'],
          strength: 0.8,
        })
        caps.push({
          id: 'code-generation',
          description: '代码生成',
          languages: allLanguages,
          strength: 0.5,  // planner 也能写代码但不是主业
        })
        break

      case 'manager':
        caps.push({
          id: 'code-review',
          description: '代码审查与质量验收',
          languages: allLanguages,
          domains: ['quality-assurance'],
          strength: 0.85,
        })
        caps.push({
          id: 'task-decomposition',
          description: '任务分派与验收',
          domains: ['project-management'],
          strength: 0.7,
        })
        caps.push({
          id: 'quality-assurance',
          description: '质量保证与规范检查',
          domains: ['quality-assurance'],
          strength: 0.8,
        })
        break

      case 'executor':
        caps.push({
          id: 'code-generation',
          description: '代码生成与实现',
          languages: allLanguages,
          domains: ['frontend', 'backend', 'fullstack'],
          strength: isCoder ? 0.95 : 0.8,
        })
        caps.push({
          id: 'debugging',
          description: '调试与问题排查',
          languages: allLanguages,
          strength: 0.7,
        })
        caps.push({
          id: 'testing',
          description: '测试编写与验证',
          languages: allLanguages,
          domains: ['testing'],
          strength: isTester ? 0.9 : 0.6,
        })
        break
    }

    return caps
  }

  /**
   * 根据角色推导需要的 Context DB 层级
   */
  private inferRequiredLayers(role: AgentRole): ('SYS' | 'L0' | 'L1' | 'L2')[] {
    switch (role) {
      case 'planner':
        return ['SYS', 'L0']  // Planner 需要全局视角
      case 'manager':
        return ['SYS', 'L0', 'L1']  // Manager 需要流程协作信息
      case 'executor':
        return ['SYS', 'L0', 'L1', 'L2']  // Executor 需要最精确的上下文
      default:
        return ['SYS', 'L0']
    }
  }

  /**
   * 根据角色推导可处理的节点类型
   */
  private inferNodeTypes(role: AgentRole): NodeType[] {
    switch (role) {
      case 'planner':
        return ['specify', 'design', 'task', 'deliver']
      case 'manager':
        return ['task', 'review', 'deliver']
      case 'executor':
        return ['implement', 'test', 'review', 'custom']
      default:
        return ['custom']
    }
  }

  /**
   * 推导最大上下文 Token 窗口
   */
  private inferMaxTokens(config: AgentConfig): number {
    // 高端模型（5.5/opus-4-8）有更大上下文窗口
    if (config.model?.includes('5.5') || config.model?.includes('opus-4-8')) {
      return 200_000
    }
    if (config.model?.includes('5.4') || config.model?.includes('opus-4-7') || config.model?.includes('sonnet')) {
      return 128_000
    }
    if (config.model?.includes('haiku')) {
      return 64_000
    }
    return 100_000  // 默认
  }

  // ═══════════════ CLI 可用性检测 ═══════════════

  /**
   * 检查 CLI 命令是否存在于 PATH 中
   */
  private checkCliAvailable(command: string): { available: boolean; path?: string; error?: string } {
    try {
      const extraPaths = [
        '/opt/homebrew/bin',
        '/usr/local/bin',
        `${process.env.HOME}/.nvm/versions/node/v20.19.2/bin`,
        `${process.env.HOME}/.local/bin`,
      ].join(':')
      const fullPath = `${extraPaths}:${process.env.PATH || ''}`

      const result = execSync(`which ${command} 2>/dev/null || command -v ${command} 2>/dev/null`, {
        encoding: 'utf-8',
        timeout: 5000,
        env: { ...process.env, PATH: fullPath },
      }).trim()
      
      if (result) {
        return { available: true, path: result }
      }
      return { available: false, error: `命令 "${command}" 未找到。请确认已安装并在 PATH 中。` }
    } catch {
      return { available: false, error: `命令 "${command}" 不可用。请先安装对应的 CLI 工具。` }
    }
  }

  /**
   * 获取所有 Agent 的可用性状态
   */
  getAgentsWithStatus(): (AgentConfig & { available: boolean; cliPath?: string })[] {
    return this.getAgents().map((agent) => {
      const check = this.checkCliAvailable(agent.command)
      return { ...agent, available: check.available, cliPath: check.path }
    })
  }

  // ═══════════════ Turn 执行 ═══════════════

  /**
   * 异步启动 Agent Turn（非阻塞）
   * 
   * 同步完成：CLI 可用性检测 + Turn 记录创建 + 进程 spawn
   * 异步进行：进程执行 + 流式输出 + 完成回调
   * 
   * @returns turnId - 立即返回，不等待进程完成
   * @throws 如果 CLI 不存在或 Agent 不存在
   */
  startTurnAsync(params: {
    agentId: string
    nodeId: string
    runId: string
    prompt: string
    cwd?: string
    contextArtifacts?: string[]
  }): string {
    const { agentId, nodeId, runId, prompt, cwd, contextArtifacts } = params

    const agent = this.agents.get(agentId)
    if (!agent) throw new Error(`Agent not found: ${agentId}`)

    // ★ 改进1: 执行前检测 CLI 可用性（同步快速失败）
    const cliCheck = this.checkCliAvailable(agent.command)
    if (!cliCheck.available) {
      throw new Error(
        `Agent "${agent.name}" 的 CLI 工具不可用: ${cliCheck.error}\n` +
        `需要的命令: ${agent.command}\n` +
        `请先安装对应的 CLI 工具`
      )
    }

    // 构建完整 prompt
    const fullPrompt = this.buildContextualPrompt(agent, prompt, contextArtifacts)

    // Phase 1: StartAgentTurn（同步创建 Turn 记录）
    const turn = this.workflowEngine.startTurn(nodeId, runId, agentId, fullPrompt)

    // 后台异步执行进程（不阻塞 HTTP 响应）
    this.spawnAgentProcess(turn.id, agent, fullPrompt, nodeId, runId, cwd)

    return turn.id
  }

  /**
   * 后台 spawn Agent 进程
   */
  private spawnAgentProcess(
    turnId: string,
    agent: AgentConfig,
    prompt: string,
    nodeId: string,
    runId: string,
    cwd?: string
  ): void {
    const { args, useStdin } = this.buildArgs(agent, prompt)

    console.log(`[Agent] Starting turn ${turnId}: ${agent.command} ${args.join(' ').slice(0, 60)}...`)
    console.log(`[Agent] CWD: ${cwd || process.cwd()}, useStdin: ${useStdin}`)

    // 确保 PATH 包含常见的 CLI 安装路径
    const extraPaths = [
      '/opt/homebrew/bin',
      '/usr/local/bin',
      `${process.env.HOME}/.nvm/versions/node/v20.19.2/bin`,
      `${process.env.HOME}/.local/bin`,
    ].join(':')
    const fullPath = `${extraPaths}:${process.env.PATH || ''}`

    const proc = spawn(agent.command, args, {
      cwd: cwd || process.cwd(),
      env: {
        ...process.env,
        ...agent.env,
        PATH: fullPath,
        TERM: 'xterm-256color',  // 避免 "TERM is dumb" 错误
      },
      shell: false,  // ★ 关键修复：不通过 shell 执行，避免 prompt 被当命令解析
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // 如果需要通过 stdin 传递 prompt（codex exec 使用 `-` 从 stdin 读取）
    if (useStdin && proc.stdin) {
      proc.stdin.write(prompt)
      proc.stdin.end()
    }

    this.activeProcesses.set(turnId, proc)

    let hasOutput = false
    let fullOutput = ''  // 收集完整输出用于解析 token

    // ★ 超时保护（10 分钟）
    const timeout = setTimeout(() => {
      console.log(`[Agent] Turn ${turnId} timed out (10 min)`)
      this.workflowEngine.appendTurnOutput(turnId, nodeId, '\n\n⚠️ 执行超时（10分钟），已自动终止。\n')
      proc.kill('SIGTERM')
      setTimeout(() => {
        if (proc.exitCode === null) proc.kill('SIGKILL')
      }, 5000)
    }, 10 * 60 * 1000)

    // ★ A2A 进度汇报：每 15 秒向 manager 发送 reportProgress
    const startTime = Date.now()
    let lastProgressAt = 0
    const PROGRESS_INTERVAL_MS = 15_000
    const reportProgressThrottled = () => {
      const now = Date.now()
      if (!this.a2aProtocol || now - lastProgressAt < PROGRESS_INTERVAL_MS) return
      lastProgressAt = now

      const elapsedSec = Math.round((now - startTime) / 1000)
      const outputLines = fullOutput.split('\n').length
      // 使用输出行数 + 经过时间作为进度信号（无法预估总量，用相对指标）
      this.a2aProtocol.reportProgress({
        fromAgentId: agent.id,
        toAgentId: 'autoflow-orchestrator',
        runId,
        nodeId,
        progress: {
          percentage: -1,  // -1 表示不确定进度（非百分比制）
          message: `执行中: ${elapsedSec}s, ${outputLines} 行输出`,
          details: { elapsedSec, outputLines, turnId },
        },
      })
    }

    proc.stdout?.on('data', (data: Buffer) => {
      hasOutput = true
      const chunk = data.toString()
      fullOutput += chunk
      // ★ 流式推送到前端
      this.workflowEngine.appendTurnOutput(turnId, nodeId, chunk)
      // ★ 节流进度汇报
      reportProgressThrottled()
    })

    proc.stderr?.on('data', (data: Buffer) => {
      hasOutput = true
      const chunk = data.toString()
      fullOutput += chunk
      this.workflowEngine.appendTurnOutput(turnId, nodeId, chunk)
    })

    proc.on('close', async (code) => {
      clearTimeout(timeout)
      this.activeProcesses.delete(turnId)

      const wasCancelled = this.cancelledTurns.has(turnId)
      this.cancelledTurns.delete(turnId)

      console.log(`[Agent] Turn ${turnId} exited with code ${code}${wasCancelled ? ' (cancelled)' : ''}`)

      // ★ 解析 Token 使用量（从 CLI 输出中提取）
      const tokenUsage = this.parseTokenUsage(fullOutput, agent.type)
      if (tokenUsage) {
        console.log(`[Agent] Turn ${turnId} token usage: ${JSON.stringify(tokenUsage)}`)
      }

      // ★ 解析工具调用和文件修改（从 CLI 输出中提取）
      const toolCalls = this.parseToolCalls(fullOutput)
      const filesModified = this.parseFilesModified(fullOutput)

      // ★ 产出物结构化解析：从 Agent 输出中提取代码块和文件引用
      if (code === 0 && !wasCancelled) {
        this.parseAndCreateArtifacts(fullOutput, runId, nodeId)
      }

      // ★ A2A 任务交付消息：通知 orchestrator 任务完成/失败
      if (this.a2aProtocol) {
        this.a2aProtocol.deliverTask({
          fromAgentId: agent.id,
          toAgentId: 'autoflow-orchestrator',
          runId,
          nodeId,
          delivery: {
            taskId: turnId,
            summary: code === 0 && !wasCancelled
              ? `Agent 成功完成 (${fullOutput.split('\n').length} 行输出)`
              : `Agent 执行${wasCancelled ? '被取消' : '失败'} (exit=${code})`,
            artifacts: this.workflowEngine.getNodeArtifacts(runId, nodeId),
          },
        })
      }

      // Phase 2: RecordAgentTurnResult
      const result = wasCancelled ? 'failed' : (code === 0 ? 'succeeded' : 'failed')
      this.workflowEngine.recordTurnResult(turnId, nodeId, result as any, undefined, tokenUsage, toolCalls, filesModified)

      // Phase 3+4: Finalize
      this.workflowEngine.finalizeTurn(turnId, nodeId)

      // 如果失败且没有输出，额外推送一条错误信息
      if (code !== 0 && !hasOutput) {
        this.workflowEngine.appendTurnOutput(
          turnId, nodeId,
          wasCancelled
            ? `\n⚠️ 用户已取消执行。\n`
            : `\n❌ Agent 进程异常退出 (code=${code})。CLI: ${agent.command}\n`
        )
      }

      // 通知节点完成/失败 — 通过自动提交节点决策（只提交一次）
      try {
        let decision: 'waiting_user_review' | 'completed' | 'failed'
        if (wasCancelled) {
          decision = 'failed'
        } else if (code !== 0) {
          decision = 'failed'
        } else {
          // ★ Phase 1: Adversarial 对抗审查（如果节点配置启用）
          // 在 AutoFlow 评估之前执行，对抗结果将作为 AutoFlow 第 8 信号
          await this.runAdversarialIfEnabled(runId, nodeId, turnId, fullOutput)

          // ★ Phase 2: AutoFlow 决策点：执行验证 Turn + 评估是否可自动通过
          // 使用异步版本以支持验证脚本执行（lint/test/LLM review）
          decision = this.autoFlowEngine
            ? await this.autoFlowEngine.evaluateAndDecideAsync(runId, nodeId)
            : 'waiting_user_review'
        }

        await this.workflowEngine.submitNodeDecision(
          runId,
          nodeId,
          decision,
          wasCancelled ? '用户取消执行' : (code !== 0 ? `Agent 退出码: ${code}` : undefined)
        )
      } catch (e) {
        console.error(`[Agent] Failed to submit node decision:`, (e as Error).message)
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timeout)
      this.activeProcesses.delete(turnId)

      console.error(`[Agent] Turn ${turnId} spawn error:`, err.message)

      this.workflowEngine.appendTurnOutput(
        turnId, nodeId,
        `\n❌ Agent 进程启动失败: ${err.message}\n请确认 "${agent.command}" 已正确安装。\n`
      )

      this.workflowEngine.recordTurnResult(turnId, nodeId, 'failed')
      this.workflowEngine.finalizeTurn(turnId, nodeId)
    })
  }

  /**
   * 如果节点配置了 adversarial 对抗审查，则触发 AdversarialTurnService
   * 
   * 执行时机：Agent 主 Turn 成功完成后、AutoFlow 评估之前
   * 对抗结果会缓存到 AdversarialTurnService 中，AutoFlow 收集信号时自动查询
   */
  private async runAdversarialIfEnabled(
    runId: string,
    nodeId: string,
    turnId: string,
    coderOutput: string
  ): Promise<void> {
    if (!this.adversarialTurnService) return

    // 获取节点的 adversarial 配置
    const run = this.workflowEngine.getRun(runId)
    const node = run?.nodes.find(n => n.id === nodeId)
    if (!node?.adversarial?.enabled) return

    console.log(`[Agent] Triggering adversarial review for node "${node.name}" (${nodeId})`)
    try {
      const result = await this.adversarialTurnService.runAdversarial(runId, nodeId, turnId, coderOutput)
      console.log(`[Agent] Adversarial result for node "${node.name}": passed=${result.passed}, quality=${result.qualityScore}`)
    } catch (err) {
      // 对抗失败不应阻塞整体流程，记录错误后继续 AutoFlow 评估
      console.error(`[Agent] Adversarial failed for node ${nodeId}:`, (err as Error).message)
    }
  }

  /**
   * 取消正在执行的 Turn
   * 注意：不立即删除 activeProcesses，让 close handler 统一处理
   */
  cancelTurn(turnId: string): boolean {
    const proc = this.activeProcesses.get(turnId)
    if (!proc) return false

    console.log(`[Agent] Cancelling turn ${turnId}`)
    // 标记为已取消，close handler 中会检查此标记
    this.cancelledTurns.add(turnId)
    proc.kill('SIGTERM')
    // 5秒后强制 kill
    setTimeout(() => {
      if (proc.exitCode === null) {
        proc.kill('SIGKILL')
      }
    }, 5000)

    return true
  }

  /**
   * 获取当前活跃的 Turn ID 列表
   */
  getActiveTurnIds(): string[] {
    return Array.from(this.activeProcesses.keys())
  }

  /**
   * 检查某个 Turn 是否正在执行
   */
  isTurnActive(turnId: string): boolean {
    return this.activeProcesses.has(turnId)
  }

  /**
   * 回答暂停中的 Agent 问题
   */
  answerQuestion(params: {
    nodeId: string
    runId: string
    agentId: string
    originalQuestion: string
    answer: string
    cwd?: string
  }): string {
    const prompt = `上一轮你提出了问题："${params.originalQuestion}"\n\n用户回答：${params.answer}\n\n请基于此回答继续完成任务。`

    return this.startTurnAsync({
      agentId: params.agentId,
      nodeId: params.nodeId,
      runId: params.runId,
      prompt,
      cwd: params.cwd,
    })
  }

  // ═══════════════ DET 确定性执行 ═══════════════

  /**
   * 确定性执行（DET 模式）：直接执行脚本命令，不调用 LLM Agent
   * 
   * 适用场景：跑测试、lint、构建、部署等确定性任务
   * 输出同样通过 WorkflowEngine 的 Turn 机制管理，保持 UI 一致
   * 
   * @returns turnId
   */
  executeDET(params: {
    nodeId: string
    runId: string
    script: string
    cwd?: string
  }): string {
    const { nodeId, runId, script, cwd } = params

    // 使用虚拟 Agent ID 标识 DET 执行
    const agentId = 'det-executor'

    // 创建 Turn 记录
    const turn = this.workflowEngine.startTurn(nodeId, runId, agentId, `[DET] ${script}`)

    // 异步执行脚本
    this.spawnDETProcess(turn.id, script, nodeId, runId, cwd)

    return turn.id
  }

  /**
   * 混合模式（HYB）：先执行脚本，若脚本失败则回退到 LLM Agent
   * 
   * @returns turnId
   */
  executeHYB(params: {
    nodeId: string
    runId: string
    script: string
    agentId: string
    prompt: string
    cwd?: string
  }): string {
    const { nodeId, runId, script, agentId, prompt, cwd } = params

    // 先以 DET 方式创建 Turn
    const detAgentId = 'hyb-executor'
    const turn = this.workflowEngine.startTurn(nodeId, runId, detAgentId, `[HYB] ${script}`)

    // 异步执行：脚本成功则完成，失败则启动 LLM
    this.spawnHYBProcess(turn.id, script, nodeId, runId, agentId, prompt, cwd)

    return turn.id
  }

  /**
   * DET 模式进程 spawn
   */
  private spawnDETProcess(
    turnId: string,
    script: string,
    nodeId: string,
    runId: string,
    cwd?: string
  ): void {
    console.log(`[DET] Starting turn ${turnId}: ${script}`)

    const extraPaths = [
      '/opt/homebrew/bin',
      '/usr/local/bin',
      `${process.env.HOME}/.nvm/versions/node/v20.19.2/bin`,
      `${process.env.HOME}/.local/bin`,
    ].join(':')
    const fullPath = `${extraPaths}:${process.env.PATH || ''}`

    const proc = spawn('sh', ['-c', script], {
      cwd: cwd || process.cwd(),
      env: { ...process.env, PATH: fullPath },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.activeProcesses.set(turnId, proc)

    // 5 分钟超时（DET 脚本一般较快）
    const timeout = setTimeout(() => {
      console.log(`[DET] Turn ${turnId} timed out (5 min)`)
      this.workflowEngine.appendTurnOutput(turnId, nodeId, '\n⚠️ DET 脚本执行超时（5分钟），已终止。\n')
      proc.kill('SIGTERM')
      setTimeout(() => { if (proc.exitCode === null) proc.kill('SIGKILL') }, 5000)
    }, 5 * 60 * 1000)

    proc.stdout?.on('data', (data: Buffer) => {
      this.workflowEngine.appendTurnOutput(turnId, nodeId, data.toString())
    })

    proc.stderr?.on('data', (data: Buffer) => {
      this.workflowEngine.appendTurnOutput(turnId, nodeId, data.toString())
    })

    proc.on('close', async (code) => {
      clearTimeout(timeout)
      this.activeProcesses.delete(turnId)

      const wasCancelled = this.cancelledTurns.has(turnId)
      this.cancelledTurns.delete(turnId)

      console.log(`[DET] Turn ${turnId} exited with code ${code}${wasCancelled ? ' (cancelled)' : ''}`)

      const result = wasCancelled ? 'failed' : (code === 0 ? 'succeeded' : 'failed')
      this.workflowEngine.recordTurnResult(turnId, nodeId, result as any)
      this.workflowEngine.finalizeTurn(turnId, nodeId)

      // DET 模式：成功直接 completed（不需要人工审批），失败则标记 failed
      try {
        await this.workflowEngine.submitNodeDecision(
          runId, nodeId,
          wasCancelled ? 'failed' : (code === 0 ? 'completed' : 'failed'),
          wasCancelled ? '用户取消执行' : (code !== 0 ? `DET 脚本退出码: ${code}` : undefined)
        )
      } catch (e) {
        console.error(`[DET] Failed to submit node decision:`, (e as Error).message)
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timeout)
      this.activeProcesses.delete(turnId)
      this.workflowEngine.appendTurnOutput(turnId, nodeId, `\n❌ DET 脚本执行失败: ${err.message}\n`)
      this.workflowEngine.recordTurnResult(turnId, nodeId, 'failed')
      this.workflowEngine.finalizeTurn(turnId, nodeId)
    })
  }

  /**
   * HYB 模式进程 spawn：先跑脚本，失败后回退到 LLM Agent
   */
  private spawnHYBProcess(
    turnId: string,
    script: string,
    nodeId: string,
    runId: string,
    fallbackAgentId: string,
    fallbackPrompt: string,
    cwd?: string
  ): void {
    console.log(`[HYB] Starting script phase for turn ${turnId}: ${script}`)

    const extraPaths = [
      '/opt/homebrew/bin',
      '/usr/local/bin',
      `${process.env.HOME}/.nvm/versions/node/v20.19.2/bin`,
      `${process.env.HOME}/.local/bin`,
    ].join(':')
    const fullPath = `${extraPaths}:${process.env.PATH || ''}`

    const proc = spawn('sh', ['-c', script], {
      cwd: cwd || process.cwd(),
      env: { ...process.env, PATH: fullPath },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.activeProcesses.set(turnId, proc)
    let fullOutput = ''

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM')
      setTimeout(() => { if (proc.exitCode === null) proc.kill('SIGKILL') }, 5000)
    }, 5 * 60 * 1000)

    proc.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString()
      fullOutput += chunk
      this.workflowEngine.appendTurnOutput(turnId, nodeId, chunk)
    })

    proc.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString()
      fullOutput += chunk
      this.workflowEngine.appendTurnOutput(turnId, nodeId, chunk)
    })

    proc.on('close', async (code) => {
      clearTimeout(timeout)
      this.activeProcesses.delete(turnId)

      if (code === 0) {
        // 脚本成功 → 直接完成
        console.log(`[HYB] Script succeeded for turn ${turnId}, marking completed`)
        this.workflowEngine.recordTurnResult(turnId, nodeId, 'succeeded')
        this.workflowEngine.finalizeTurn(turnId, nodeId)
        try {
          await this.workflowEngine.submitNodeDecision(runId, nodeId, 'completed')
        } catch (e) {
          console.error(`[HYB] Failed to submit node decision:`, (e as Error).message)
        }
      } else {
        // 脚本失败 → 回退到 LLM Agent
        console.log(`[HYB] Script failed (code=${code}) for turn ${turnId}, falling back to LLM Agent`)
        this.workflowEngine.appendTurnOutput(turnId, nodeId, `\n\n⚠️ 脚本执行失败（退出码 ${code}），回退到 LLM Agent...\n\n`)
        this.workflowEngine.recordTurnResult(turnId, nodeId, 'failed')
        this.workflowEngine.finalizeTurn(turnId, nodeId)

        // 启动 LLM Agent Turn，将脚本输出作为上下文
        const enrichedPrompt = `之前执行的脚本 \`${script}\` 失败了（退出码 ${code}）。\n\n脚本输出:\n\`\`\`\n${fullOutput.slice(-2000)}\n\`\`\`\n\n请分析失败原因并完成任务：\n${fallbackPrompt}`
        try {
          this.startTurnAsync({
            agentId: fallbackAgentId,
            nodeId,
            runId,
            prompt: enrichedPrompt,
            cwd,
          })
        } catch (e) {
          console.error(`[HYB] Failed to start LLM fallback:`, (e as Error).message)
        }
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timeout)
      this.activeProcesses.delete(turnId)
      // 脚本启动失败 → 直接回退到 LLM
      this.workflowEngine.appendTurnOutput(turnId, nodeId, `\n❌ 脚本启动失败: ${err.message}，回退到 LLM Agent\n`)
      this.workflowEngine.recordTurnResult(turnId, nodeId, 'failed')
      this.workflowEngine.finalizeTurn(turnId, nodeId)
      try {
        this.startTurnAsync({
          agentId: fallbackAgentId,
          nodeId,
          runId,
          prompt: `脚本 \`${script}\` 启动失败: ${err.message}\n\n请直接完成任务：\n${fallbackPrompt}`,
          cwd,
        })
      } catch (e) {
        console.error(`[HYB] Failed to start LLM fallback:`, (e as Error).message)
      }
    })
  }

  // ═══════════════ 上下文构建 ═══════════════

  private buildContextualPrompt(
    agent: AgentConfig,
    userPrompt: string,
    contextArtifacts?: string[]
  ): string {
    const parts: string[] = []

    // 角色系统提示
    parts.push(this.getRoleSystemPrompt(agent.role))

    // 前置节点上下文
    if (contextArtifacts && contextArtifacts.length > 0) {
      parts.push('\n## 前置节点产出物\n')
      parts.push(contextArtifacts.join('\n---\n'))
    }

    // 用户 prompt（支持模板变量替换）
    parts.push('\n## 当前任务\n')
    parts.push(userPrompt)

    // ★ 产出物格式引导（帮助 extractArtifactsFromOutput 精准识别）
    parts.push(this.getArtifactFormatGuidance())

    return parts.join('\n')
  }

  /**
   * 产出物格式引导指令
   * 
   * 指导 Agent 以结构化方式标记产出物，使后端解析器能精准提取。
   * 优先级策略与 extractArtifactsFromOutput 的 4 层识别对齐：
   *   Tier 1: JSON 结构化声明块
   *   Tier 2: 命名代码块（```language:filename）
   *   Tier 3: Markdown 文档段落（## 标题 + 正文）
   *   Tier 4: 大型无名代码块（>10 行）
   */
  private getArtifactFormatGuidance(): string {
    return `

## 产出物格式规范（重要）

你的输出将被自动解析为结构化产出物。请遵循以下格式规范以确保产出物被正确识别：

### 代码类产出物
使用带文件名的代码块标记：
\`\`\`typescript:src/services/example.ts
// 你的代码内容
\`\`\`

文件名必须是合法的路径格式（如 \`src/index.ts\`、\`api/routes.ts\`），不要使用描述性文字作为文件名。

### 文档类产出物
使用 Markdown 二级标题标记每个独立文档段落：
## 需求分析文档

（正文内容，至少包含一段完整的分析描述...）

## 验收标准

（正文内容...）

每个 ## 标题下的内容应当是一个完整的、有意义的文档段落（不少于 200 字符）。

### 注意事项
- 不要将简短的代码片段（<10 行）或命令行输出标记为代码块，直接内联即可
- 每个产出物应当是完整的、可独立使用的内容，而非碎片化的片段
- 产出物标题应当简洁明确，能体现其核心用途`
  }

  /**
   * Prompt 模板变量替换
   * 支持 {{variable}} 语法，从 NodeContext.variables 和内置变量中解析
   * 
   * 内置变量：
   *   {{node.name}} - 节点名称
   *   {{node.type}} - 节点类型
   *   {{run.name}} - Run 名称
   *   {{predecessor.summary}} - 前置节点输出摘要
   *   {{predecessor.artifacts}} - 前置节点产出物列表
   *   {{date}} - 当前日期
   *   {{timestamp}} - 当前时间戳
   * 
   * 自定义变量通过 NodeContext.variables 传入
   */
  resolvePromptTemplate(
    template: string,
    variables: Record<string, string>
  ): string {
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, key) => {
      // 查找变量值
      if (key in variables) return variables[key]

      // 内置变量
      switch (key) {
        case 'date': return new Date().toISOString().split('T')[0]
        case 'timestamp': return String(Date.now())
        default: return match  // 未匹配的保留原样
      }
    })
  }

  /**
   * 从 TaskNode 和 Run 构建模板变量映射
   */
  buildTemplateVariables(
    node: { name: string; type: string; context?: { predecessorOutputs?: Array<{ summary: string; nodeName: string; artifacts: Array<{ title: string }> }> ; variables?: Record<string, string> } },
    run: { name: string }
  ): Record<string, string> {
    const vars: Record<string, string> = {
      'node.name': node.name,
      'node.type': node.type,
      'run.name': run.name,
      'date': new Date().toISOString().split('T')[0],
      'timestamp': String(Date.now()),
    }

    // 从 NodeContext 获取前置节点信息
    if (node.context?.predecessorOutputs) {
      const summaries = node.context.predecessorOutputs.map(p => `[${p.nodeName}]: ${p.summary}`).join('\n')
      vars['predecessor.summary'] = summaries

      const artifactList = node.context.predecessorOutputs
        .flatMap(p => p.artifacts)
        .map(a => a.title)
        .join(', ')
      vars['predecessor.artifacts'] = artifactList
    }

    // 合并自定义变量（优先级最高）
    if (node.context?.variables) {
      Object.assign(vars, node.context.variables)
    }

    return vars
  }

  private getRoleSystemPrompt(role: AgentRole): string {
    switch (role) {
      case 'planner':
        return `你是一个项目规划师。你的职责是分析需求、制定技术方案、设计架构。
你需要产出结构化的分析文档，包括：需求理解、技术选型建议、架构设计、任务拆分建议。
产出格式为 Markdown。`

      case 'manager':
        return `你是一个任务管理者。你的职责是将大任务拆分为可执行的子任务，分派给执行者，并验收执行结果。
你需要明确每个子任务的目标、输入、期望产出和验收标准。`

      case 'executor':
        return `你是一个代码执行者。你的职责是根据任务要求，在指定的代码仓库中进行实际的代码编写、修改和测试。
请直接产出代码变更，并简要说明你的实现思路。`

      default:
        return ''
    }
  }

  // ═══════════════ 命令构建 ═══════════════

  /**
   * 从 CLI 输出中解析 Token 使用量
   */
  private parseTokenUsage(output: string, agentType: string): { input: number; output: number; total: number } | undefined {
    try {
      // 清除 ANSI 转义码（CLI 输出中常包含颜色/样式控制字符）
      // eslint-disable-next-line no-control-regex
      const cleanOutput = output.replace(/\x1b\[[0-9;]*m/g, '')

      if (agentType === 'codex') {
        // Codex 输出格式多种：
        // 1. "tokens used\n9,000" 或 "tokens used\n12,345"
        // 2. "(68350 tokens)" 或 "(68,350 tokens)"
        // 3. "Token usage: 12345"
        const match = cleanOutput.match(/tokens?\s*used\s*\n?\s*([\d,]+)/i)
          || cleanOutput.match(/\((\s*[\d,]+)\s*tokens?\s*\)/i)
          || cleanOutput.match(/token\s*usage[:\s]+([\d,]+)/i)
        if (match) {
          const total = parseInt(match[1].replace(/[,\s]/g, ''), 10)
          // Codex 不区分 input/output，估算 70% input 30% output
          return { input: Math.round(total * 0.7), output: Math.round(total * 0.3), total }
        }
      } else if (agentType === 'claude') {
        // Claude CLI 输出格式可能包含: "Input tokens: X" "Output tokens: Y"
        const inputMatch = cleanOutput.match(/input\s*tokens?[:\s]+([\d,]+)/i)
        const outputMatch = cleanOutput.match(/output\s*tokens?[:\s]+([\d,]+)/i)
        const totalMatch = cleanOutput.match(/total\s*(?:cost|tokens?)[:\s]+([\d,]+)/i)
        
        if (inputMatch || outputMatch) {
          const input = inputMatch ? parseInt(inputMatch[1].replace(/,/g, ''), 10) : 0
          const out = outputMatch ? parseInt(outputMatch[1].replace(/,/g, ''), 10) : 0
          const total = totalMatch ? parseInt(totalMatch[1].replace(/,/g, ''), 10) : input + out
          return { input, output: out, total }
        }
      }
    } catch (e) {
      console.error('[Agent] Failed to parse token usage:', (e as Error).message)
    }
    return undefined
  }

  /**
   * 从 CLI 输出中解析工具调用列表
   * 支持格式：
   * - Codex: "Called: tool_name" 或 "tool_use: tool_name"
   * - Claude: "⏺ tool_name" 或 "Tool: tool_name"  
   * - 通用: "Using tool: xxx" / "Calling: xxx"
   */
  private parseToolCalls(output: string): string[] | undefined {
    try {
      // eslint-disable-next-line no-control-regex
      const clean = output.replace(/\x1b\[[0-9;]*m/g, '')
      const tools = new Set<string>()

      // Codex/Claude 常见格式
      const patterns = [
        /(?:Called|Calling|Tool|tool_use|Using tool)[:\s]+([a-zA-Z_][\w.-]*)/g,
        /⏺\s+([a-zA-Z_][\w.-]*)\s*(?:\(|$)/gm,
      ]

      for (const pattern of patterns) {
        let match
        while ((match = pattern.exec(clean)) !== null) {
          const tool = match[1].trim()
          if (tool && tool.length < 60) tools.add(tool)
        }
      }

      return tools.size > 0 ? Array.from(tools) : undefined
    } catch {
      return undefined
    }
  }

  /**
   * 从 CLI 输出中解析修改的文件数量
   * 支持格式：
   * - "N file(s) changed" / "N files modified"
   * - "Wrote N files" / "Updated N files"
   * - 统计输出中出现的 write/create/update 文件路径
   */
  private parseFilesModified(output: string): number | undefined {
    try {
      // eslint-disable-next-line no-control-regex
      const clean = output.replace(/\x1b\[[0-9;]*m/g, '')

      // 直接数字声明：N file(s) changed/modified/written
      const countMatch = clean.match(/(\d+)\s+files?\s+(?:changed|modified|written|updated|created)/i)
        || clean.match(/(?:wrote|updated|created|modified)\s+(\d+)\s+files?/i)
      if (countMatch) {
        return parseInt(countMatch[1], 10)
      }

      // 统计写文件路径模式：Write/Create/Update path/to/file.ext
      const fileOps = clean.match(/(?:(?:Writ(?:e|ing|ten)|Creat(?:e|ing|ed)|Updat(?:e|ing|ed))\s+)[./\w-]+\.\w+/g)
      if (fileOps && fileOps.length > 0) {
        return fileOps.length
      }
    } catch {
      // 解析失败静默
    }
    return undefined
  }

  // ═══════════════ 产出物结构化解析 ═══════════════

  /**
   * 从 Agent 输出中自动解析结构化产出物
   * 支持提取：
   * - Markdown 代码块（带文件名注释的）
   * - 显式文件路径引用
   * - JSON/YAML 结构化输出
   */
  private parseAndCreateArtifacts(output: string, runId: string, nodeId: string): void {
    try {
      const artifacts = this.extractArtifactsFromOutput(output)
      for (const artifact of artifacts) {
        this.workflowEngine.addArtifact(runId, nodeId, artifact)
      }
      if (artifacts.length > 0) {
        console.log(`[Agent] Extracted ${artifacts.length} artifact(s) from output for node ${nodeId}`)
      }
    } catch (e) {
      console.error('[Agent] Failed to parse artifacts:', (e as Error).message)
    }
  }

  /**
   * 从输出文本中提取结构化产出物
   * 
   * 提取策略（按优先级）：
   * 1. JSON 结构化声明块（Agent 显式标记的产出物）
   * 2. 带明确文件名的代码块（```language:path/to/file.ext）
   * 3. Markdown 文档段落（## 标题 + 正文，适用于报告/分析类产出物）
   * 4. 大型无名代码块（>10行 且 >500字符，作为兜底）
   * 
   * 排除规则：
   * - 无文件名且 < 5 行的代码片段（通常是引用/示例）
   * - 单行代码（如 import、变量声明）
   * - 标题看起来像代码行的（如 const x = ...）
   * - 重复标题去重
   */
  private extractArtifactsFromOutput(output: string): Array<{
    title: string
    category: 'document' | 'code' | 'config' | 'test' | 'report'
    format: string
    content: string
  }> {
    const artifacts: Array<{
      title: string
      category: 'document' | 'code' | 'config' | 'test' | 'report'
      format: string
      content: string
    }> = []
    const seenTitles = new Set<string>()

    let match: RegExpExecArray | null

    // ─── 优先级 1: JSON 结构化声明块 ───
    const jsonOutputRegex = /```json\n(\{[\s\S]*?"artifacts?"[\s\S]*?\})\n```/g
    while ((match = jsonOutputRegex.exec(output)) !== null) {
      try {
        const parsed = JSON.parse(match[1])
        if (parsed.artifacts && Array.isArray(parsed.artifacts)) {
          for (const a of parsed.artifacts) {
            if (a.title && a.content && !seenTitles.has(a.title)) {
              seenTitles.add(a.title)
              artifacts.push({
                title: a.title,
                category: a.category || 'document',
                format: a.format || 'markdown',
                content: a.content,
              })
            }
          }
        }
      } catch {
        // JSON 解析失败，跳过
      }
    }

    // ─── 优先级 2: 带明确文件名/路径的代码块 ───
    // 匹配: ```language:filename  或  ```language // filename  或 ```language filename.ext
    const namedBlockRegex = /```(\w+)(?:[:\s]+([^\n]+))?\n([\s\S]*?)```/g
    while ((match = namedBlockRegex.exec(output)) !== null) {
      const language = match[1]
      const rawName = match[2]?.trim()
      const content = match[3].trim()

      if (!rawName) continue // 无文件名的在优先级4处理
      if (!content || content.length < 10) continue

      // 验证文件名是否合理（应该像 path/to/file.ext 而不是一行代码）
      const isValidFileName = this.isLikelyFileName(rawName)
      if (!isValidFileName) continue

      const title = rawName
      if (seenTitles.has(title)) continue
      seenTitles.add(title)

      const category = this.inferCategory(language, rawName)
      artifacts.push({ title, category, format: language, content })
    }

    // ─── 优先级 3: Markdown 文档段落（适用于报告/分析类） ───
    // 匹配 ## 标题 开头的段落，提取为 document 类型产出物
    const sectionRegex = /^#{1,3}\s+(.+?)$/gm
    const sections: { title: string; start: number }[] = []
    while ((match = sectionRegex.exec(output)) !== null) {
      sections.push({ title: match[1].trim(), start: match.index + match[0].length })
    }

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i]
      const end = i + 1 < sections.length ? sections[i + 1].start - sections[i + 1].title.length - 4 : output.length
      const sectionContent = output.slice(section.start, end).trim()

      // 只提取有实质内容的段落（>200字符，排除纯代码引用段落）
      if (sectionContent.length < 200) continue
      // 排除纯代码块段落（内容80%以上是代码块）
      const codeBlockLen = (sectionContent.match(/```[\s\S]*?```/g) || []).join('').length
      if (codeBlockLen > sectionContent.length * 0.8) continue

      // 排除目录性质的标题
      const skipTitles = ['目录', '参考', '附录', 'table of contents', 'references']
      if (skipTitles.some(t => section.title.toLowerCase().includes(t))) continue

      const title = section.title
      if (seenTitles.has(title)) continue
      seenTitles.add(title)

      artifacts.push({
        title,
        category: 'document',
        format: 'markdown',
        content: sectionContent,
      })
    }

    // ─── 优先级 4: 大型无名代码块（兜底） ───
    const unnamedBlockRegex = /```(\w+)\n([\s\S]*?)```/g
    while ((match = unnamedBlockRegex.exec(output)) !== null) {
      const language = match[1]
      const content = match[2].trim()
      const lines = content.split('\n').length

      // 严格过滤：必须是有实质内容的大块代码
      if (lines < 10 || content.length < 500) continue

      // 排除纯注释或日志输出
      const codeLines = content.split('\n').filter(l => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('#'))
      if (codeLines.length < 8) continue

      const title = `code_block.${language}`
      // 用语言+内容hash避免重复
      const dedupeKey = `${language}_${content.length}_${content.slice(0, 50)}`
      if (seenTitles.has(dedupeKey)) continue
      seenTitles.add(dedupeKey)

      const category = this.inferCategory(language, '')
      artifacts.push({ title, category, format: language, content })
    }

    return artifacts
  }

  /**
   * 判断字符串是否像一个文件名/路径
   * 排除：代码行、URL、纯描述文本
   */
  private isLikelyFileName(name: string): boolean {
    // 包含路径分隔符或文件扩展名
    if (/[/\\]/.test(name) || /\.\w{1,10}$/.test(name)) {
      // 但排除看起来像代码的（如 const x = require('./file')）
      if (/^(const|let|var|import|export|function|class|if|for|while)\s/.test(name)) return false
      if (/[=(){}\[\];]/.test(name)) return false
      return true
    }
    // 像 "filename.ext" 的格式
    if (/^[\w\-./]+\.\w{1,10}$/.test(name)) return true
    return false
  }

  /**
   * 根据语言和文件名推断产出物类别
   */
  private inferCategory(language: string, fileName: string): 'document' | 'code' | 'config' | 'test' | 'report' {
    const lowerFile = fileName.toLowerCase()
    const lowerLang = language.toLowerCase()

    // 测试文件
    if (lowerFile.includes('test') || lowerFile.includes('spec') || lowerFile.includes('.test.')) {
      return 'test'
    }
    // 配置文件
    if (['json', 'yaml', 'yml', 'toml', 'ini'].includes(lowerLang) ||
        lowerFile.includes('config') || lowerFile.includes('.env') ||
        lowerFile.endsWith('.json') || lowerFile.endsWith('.yaml')) {
      return 'config'
    }
    // 文档
    if (['markdown', 'md'].includes(lowerLang) || lowerFile.endsWith('.md')) {
      return 'document'
    }
    // 代码
    return 'code'
  }

  private buildArgs(agent: AgentConfig, prompt: string): { args: string[]; useStdin: boolean } {
    switch (agent.type) {
      case 'codex':
        // codex exec 非交互模式，通过 stdin 传递 prompt（用 `-` 表示从 stdin 读取）
        // --skip-git-repo-check 避免要求 git 仓库
        // macOS 15 Sequoia 上 sandbox-exec 全局不可用（Operation not permitted），
        // 因此使用 danger-full-access 跳过系统 sandbox。
        // 安全保障由 AgentFlow 的节点审批机制 + cwd 限定来提供。
        {
          const args = [
            'exec', '-',
            '--skip-git-repo-check',
            '--sandbox', 'danger-full-access',
          ]
          // 如果 Agent 指定了模型，通过 --model 传递（覆盖全局 config.toml 配置）
          if (agent.model) {
            args.push('--model', agent.model)
          }
          return { args, useStdin: true }
        }
      case 'claude':
        // claude CLI: claude -p "prompt" --no-input [--model xxx]
        // prompt 直接作为参数传递（claude 不需要 shell 转义，因为 shell: false）
        {
          const args = ['-p', prompt, '--no-input']
          if (agent.model) {
            args.push('--model', agent.model)
          }
          return { args, useStdin: false }
        }
      case 'custom-cli':
        return { args: [prompt], useStdin: false }
      default:
        return { args: [prompt], useStdin: false }
    }
  }
}
