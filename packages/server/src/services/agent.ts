import { spawn, execSync, type ChildProcess } from 'child_process'
import type { AgentConfig, AgentRole } from '../types/index.js'
import type { WorkflowEngine } from './workflow-engine.js'

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
  private activeProcesses: Map<string, ChildProcess> = new Map()  // turnId → process
  private cancelledTurns: Set<string> = new Set()  // 已取消的 turn，防止 close handler 重复提交
  private workflowEngine: WorkflowEngine

  constructor(workflowEngine: WorkflowEngine) {
    this.workflowEngine = workflowEngine
    this.registerDefaults()
  }

  private registerDefaults(): void {
    // planner 角色 Agent
    this.registerAgent({
      id: 'claude-planner',
      name: 'Claude Planner',
      role: 'planner',
      type: 'claude',
      command: 'claude',
      description: '使用 Claude Code CLI 进行需求分析和架构设计规划',
      maxTurns: 3,
    })

    // manager 角色 Agent
    this.registerAgent({
      id: 'claude-manager',
      name: 'Claude Manager',
      role: 'manager',
      type: 'claude',
      command: 'claude',
      description: '使用 Claude Code CLI 管理任务分派和验收',
      maxTurns: 5,
    })

    // executor 角色 Agents — 多选
    this.registerAgent({
      id: 'codex-executor',
      name: 'Codex Executor',
      role: 'executor',
      type: 'codex',
      command: 'codex',
      description: '使用 OpenAI Codex CLI 执行代码生成和修改',
      maxTurns: 10,
    })

    this.registerAgent({
      id: 'claude-executor',
      name: 'Claude Executor',
      role: 'executor',
      type: 'claude',
      command: 'claude',
      description: '使用 Claude Code CLI 执行代码生成和修改',
      maxTurns: 10,
    })

    // 通用型 Agent（可用于任何角色，灵活配置）
    this.registerAgent({
      id: 'codex-universal',
      name: 'Codex (通用)',
      role: 'planner',  // 默认角色，但实际可用于任何节点
      type: 'codex',
      command: 'codex',
      description: 'Codex CLI 通用 Agent，可用于规划/管理/执行',
      maxTurns: 10,
    })

    this.registerAgent({
      id: 'claude-universal',
      name: 'Claude (通用)',
      role: 'planner',
      type: 'claude',
      command: 'claude',
      description: 'Claude Code CLI 通用 Agent，可用于规划/管理/执行',
      maxTurns: 10,
    })
  }

  // ═══════════════ Agent 注册 ═══════════════

  registerAgent(config: AgentConfig): void {
    this.agents.set(config.id, config)
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

    proc.stdout?.on('data', (data: Buffer) => {
      hasOutput = true
      const chunk = data.toString()
      fullOutput += chunk
      // ★ 流式推送到前端
      this.workflowEngine.appendTurnOutput(turnId, nodeId, chunk)
    })

    proc.stderr?.on('data', (data: Buffer) => {
      hasOutput = true
      const chunk = data.toString()
      fullOutput += chunk
      this.workflowEngine.appendTurnOutput(turnId, nodeId, chunk)
    })

    proc.on('close', (code) => {
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

      // ★ 产出物结构化解析：从 Agent 输出中提取代码块和文件引用
      if (code === 0 && !wasCancelled) {
        this.parseAndCreateArtifacts(fullOutput, runId, nodeId)
      }

      // Phase 2: RecordAgentTurnResult
      const result = wasCancelled ? 'failed' : (code === 0 ? 'succeeded' : 'failed')
      this.workflowEngine.recordTurnResult(turnId, nodeId, result as any, undefined, tokenUsage)

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
        this.workflowEngine.submitNodeDecision(
          runId,
          nodeId,
          wasCancelled ? 'failed' : (code === 0 ? 'waiting_user_review' : 'failed'),
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

    return parts.join('\n')
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
      if (agentType === 'codex') {
        // Codex 输出格式: "tokens used\n9,000" 或 "tokens used\n12,345"
        const match = output.match(/tokens?\s*used\s*\n?\s*([\d,]+)/i)
        if (match) {
          const total = parseInt(match[1].replace(/,/g, ''), 10)
          // Codex 不区分 input/output，估算 70% input 30% output
          return { input: Math.round(total * 0.7), output: Math.round(total * 0.3), total }
        }
      } else if (agentType === 'claude') {
        // Claude CLI 输出格式可能包含: "Input tokens: X" "Output tokens: Y"
        const inputMatch = output.match(/input\s*tokens?[:\s]+([\d,]+)/i)
        const outputMatch = output.match(/output\s*tokens?[:\s]+([\d,]+)/i)
        const totalMatch = output.match(/total\s*(?:cost|tokens?)[:\s]+([\d,]+)/i)
        
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

    // 提取带文件名的代码块: ```language:filename 或 ```language // filename
    const codeBlockRegex = /```(\w+)(?:[:\s]+([^\n]+))?\n([\s\S]*?)```/g
    let match: RegExpExecArray | null

    while ((match = codeBlockRegex.exec(output)) !== null) {
      const language = match[1]
      const fileName = match[2]?.trim()
      const content = match[3].trim()

      // 只提取有明确文件名或较长内容的代码块
      if (!fileName && content.length < 100) continue

      const title = fileName || `code_snippet.${language}`
      const category = this.inferCategory(language, fileName || '')
      
      artifacts.push({
        title,
        category,
        format: language,
        content,
      })
    }

    // 提取 JSON 结构化输出块（如果 Agent 输出包含 JSON Schema 格式的产出物声明）
    const jsonOutputRegex = /```json\n(\{[\s\S]*?"artifacts?"[\s\S]*?\})\n```/g
    while ((match = jsonOutputRegex.exec(output)) !== null) {
      try {
        const parsed = JSON.parse(match[1])
        if (parsed.artifacts && Array.isArray(parsed.artifacts)) {
          for (const a of parsed.artifacts) {
            if (a.title && a.content) {
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

    return artifacts
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
        return {
          args: ['exec', '-', '--skip-git-repo-check'],
          useStdin: true,
        }
      case 'claude':
        // claude CLI: claude -p "prompt" --no-input
        // prompt 直接作为参数传递（claude 不需要 shell 转义，因为 shell: false）
        return {
          args: ['-p', prompt, '--no-input'],
          useStdin: false,
        }
      case 'custom-cli':
        return { args: [prompt], useStdin: false }
      default:
        return { args: [prompt], useStdin: false }
    }
  }
}
