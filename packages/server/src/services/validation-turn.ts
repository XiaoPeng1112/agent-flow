import { executionEnvironment } from './execution-environment.js'
import { execFileSync } from 'child_process'
import { randomUUID } from 'crypto'
import { ExecutionWorkerClient } from './execution-worker-client.js'
import { workspaceFingerprint } from './workspace-fingerprint.js'
import { realpathSync } from 'fs'
import { resolve, relative, isAbsolute, sep } from 'path'
import type { ProjectService } from './project.js'
import type {
  TaskNode, Run, ExitCondition,
} from '../types/index.js'
import type { WorkflowEngine } from './workflow-engine.js'
import type { ContractValidatorService } from './contract-validator.js'
import type { FeedbackCollector } from './feedback-collector.js'
import type { RobustnessService } from './robustness.js'
import type { RepoIsolationService } from './repo-isolation.js'
import type { AgentService } from './agent.js'
import type { DynamicAgentFactory } from './dynamic-agent-factory.js'

// ═══════════════════════════════════════════════════
// ValidationTurnService — 验证 Turn 机制
//
// 设计文档参考：深化方案 Phase 3 - 自验能力
//
// 核心职责：
// 1. Agent 完成主执行 Turn 后，根据节点类型自动执行验证策略
// 2. 代码节点：运行验证脚本（lint/test），复用 DET 模式基础设施
// 3. 文档节点：可选 LLM 验证 Turn（使用 reviewer 角色检查产出物质量）
// 4. 验证结果作为信心信号接入 AutoFlowEngine
//
// 设计原则：
// - 验证是可选的（由 AutoFlowConfig.validation 控制）
// - 必需检查全部通过才允许完成；分数仅保留为诊断信息
// - 验证脚本有严格超时限制，不阻塞主流程
// - LLM 验证 Turn 是异步的，通过回调通知结果
// ═══════════════════════════════════════════════════

/** 验证配置（扩展 AutoFlowConfig） */
export interface ValidationConfig {
  /** 是否启用验证 Turn（默认 true when AutoFlow enabled） */
  enabled: boolean
  /** 代码节点的验证脚本（覆盖节点 exitConditions 中的脚本） */
  scripts?: Record<string, string>
  /** 是否启用 LLM 验证 Turn（默认 false，成本敏感） */
  useLLMValidation?: boolean
  /** LLM 验证使用的 Agent 角色（默认 manager） */
  llmValidationRole?: 'manager' | 'executor'
  /** 验证脚本超时（毫秒，默认 60000） */
  scriptTimeout?: number
  /** 跳过验证的节点类型 */
  skipValidationNodes?: string[]
}

/** 验证结果 */
export interface ValidationResult {
  turnId?: string
  configuration?: string
  cwd?: string
  workspaceFingerprint?: string
  /** 验证是否通过 */
  passed: boolean
  /** 验证策略 */
  strategy: 'script' | 'llm' | 'contract' | 'composite' | 'skipped'
  /** 综合验证分数 (0.0 - 1.0) */
  score: number
  /** 各项验证细节 */
  details: ValidationDetail[]
  /** 执行耗时（ms） */
  duration: number
  /** 人可读摘要 */
  summary: string
}

/** 单项验证细节 */
export interface ValidationDetail {
  name: string
  passed: boolean
  score: number
  output?: string
  error?: string
  duration?: number
}

/** 验证脚本执行结果 */
interface ScriptExecResult {
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
  duration: number
}

/** 默认验证配置 */
const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  enabled: true,
  useLLMValidation: false,
  llmValidationRole: 'manager',
  scriptTimeout: 60_000,
  skipValidationNodes: [],
}

/** 代码类节点类型 */
const CODE_NODE_TYPES = new Set(['implement', 'test', 'review'])

/** 文档类节点类型 */
const DOC_NODE_TYPES = new Set(['specify', 'design', 'deliver'])

export class ValidationTurnService {
  private scriptWorkers = new Map<string, Set<ExecutionWorkerClient>>()
  private cancelledValidations = new Set<string>()
  private pendingValidations = new Map<string, Promise<ValidationResult>>()
  private workflowEngine!: WorkflowEngine
  private contractValidator!: ContractValidatorService
  private _feedbackCollector!: FeedbackCollector
  private robustnessService!: RobustnessService
  private repoIsolation?: RepoIsolationService
  private projectService?: ProjectService
  private agentService?: AgentService
  private dynamicAgentFactory?: DynamicAgentFactory

  /** 正在进行的 LLM 验证（防止重复） */
  private pendingLLMValidations: Map<string, Promise<ValidationDetail>> = new Map()

  /** 验证结果缓存（供 AutoFlowEngine 查询） */
  private validationResults: Map<string, ValidationResult> = new Map()
  private static readonly MAX_CACHE_SIZE = 300

  constructor() {}

  /**
   * 注入依赖（延迟注入，避免循环依赖）
   */
  inject(deps: {
    workflowEngine: WorkflowEngine
    contractValidator: ContractValidatorService
    feedbackCollector: FeedbackCollector
    robustnessService: RobustnessService
    repoIsolation?: RepoIsolationService
    projectService?: ProjectService
    agentService?: AgentService
    dynamicAgentFactory?: DynamicAgentFactory
  }): void {
    this.workflowEngine = deps.workflowEngine
    this.contractValidator = deps.contractValidator
    this._feedbackCollector = deps.feedbackCollector
    this.robustnessService = deps.robustnessService
    this.repoIsolation = deps.repoIsolation
    this.projectService = deps.projectService
    this.agentService = deps.agentService
    this.dynamicAgentFactory = deps.dynamicAgentFactory
    deps.workflowEngine.onExecutionStop?.(async (runId, nodeIds) => {
      const keys = nodeIds.map(nodeId => `${runId}:${nodeId}`)
      for (const key of keys) {
        this.validationResults.delete(key)
        this.cancelledValidations.add(key)
        for (const worker of this.scriptWorkers.get(key) || []) worker.cancel()
      }
      await Promise.all(keys.map(key => this.pendingValidations.get(key)))
      for (const key of keys) this.cancelledValidations.delete(key)
    })
  }

  // ═══════════════ 核心验证入口 ═══════════════

  /**
   * 执行节点验证
   * 
   * 调用时机：Agent 主执行 Turn 成功完成后，AutoFlow 评估之前
   * 设计原理：验证结果作为额外信心信号注入到 AutoFlow 评估中
   * 
   * 验证策略选择：
   * - 代码节点 → 优先运行验证脚本（lint/test），再做 contract 校验
   * - 文档节点 → contract 校验 + 可选 LLM 审查
   * - 自定义节点 → 仅 contract 校验
   * 
   * @returns ValidationResult — 包含综合分数和各项细节
   */
  validate(runId: string, nodeId: string): Promise<ValidationResult> {
    const key = `${runId}:${nodeId}`
    if (this.workflowEngine.isTransitioning?.(runId)) return Promise.resolve(this.buildSkippedResult('节点状态变更中', Date.now()))
    const existing = this.pendingValidations.get(key)
    if (existing) return existing
    const pending = this.performValidation(runId, nodeId).finally(() => this.pendingValidations.delete(key))
    this.pendingValidations.set(key, pending)
    return pending
  }

  private async performValidation(runId: string, nodeId: string): Promise<ValidationResult> {
    const startTime = Date.now()
    this.validationResults.delete(`${runId}:${nodeId}`)

    try {
      const run = this.workflowEngine.getRun(runId)
      const node = run?.nodes.find(n => n.id === nodeId)
      if (!run || !node) {
        return this.buildSkippedResult('节点或 Run 不存在', startTime)
      }

      // 获取验证配置
      const config = this.getValidationConfig(run)
      if (!config.enabled) {
        return this.buildSkippedResult('验证已禁用', startTime)
      }

      // 检查是否跳过验证
      if (this.shouldSkipValidation(node, config)) {
        return this.buildSkippedResult(`节点类型 ${node.type} 跳过验证`, startTime)
      }

      const executionCwd = this.resolveWorkingDirectory(run, node)
      const beforeFingerprint = executionCwd ? workspaceFingerprint(executionCwd) : undefined
      const initialTurnId = this.workflowEngine.getNodeTurns(nodeId).at(-1)?.id
      const initialConfiguration = this.configurationKey(run, node)
      // 根据节点类型选择验证策略
      const details: ValidationDetail[] = []

      // 1. Contract 校验（所有节点都执行）
      const contractDetail = this.validateContracts(node)
      details.push(contractDetail)

      // 2. 代码节点：运行验证脚本
      if (CODE_NODE_TYPES.has(node.type)) {
        const scriptDetails = await this.runValidationScripts(node, run, config)
        details.push(...scriptDetails)
      }

      // 3. 文档节点 + LLM 验证开启：执行 LLM 审查
      if (DOC_NODE_TYPES.has(node.type) && config.useLLMValidation) {
        const llmDetail = await this.runLLMValidation(node, run)
        if (llmDetail) {
          details.push(llmDetail)
        }
      }

      // 4. 输出质量启发式检查（所有节点）
      const qualityDetail = this.validateOutputQuality(node)
      details.push(qualityDetail)

      // 综合计算
      const result = this.computeCompositeResult(details, startTime)

      result.turnId = initialTurnId
      result.configuration = initialConfiguration
      result.cwd = executionCwd
      result.workspaceFingerprint = beforeFingerprint
      if (executionCwd && beforeFingerprint !== workspaceFingerprint(executionCwd)) {
        result.passed = false
        result.summary = '验证期间代码发生变化，请重新验证'
      }
      // 缓存结果
      if (this.cancelledValidations.has(`${runId}:${nodeId}`)) {
        return this.buildSkippedResult('验证已取消', startTime)
      }
      this.cacheResult(runId, nodeId, result)

      // 验证失败时记录反馈（供自适应学习使用）
      if (!result.passed && this._feedbackCollector) {
        this._feedbackCollector.recordValidationFailure({
          runId,
          nodeId,
          nodeName: node.name,
          summary: result.summary,
          details: result.details.filter(d => !d.passed).map(d => `${d.name}: ${d.output || d.error || ''}`).join('; '),
        })
      }

      // 审计记录
      this.auditValidation(runId, nodeId, node.name, result)

      return result
    } catch (err) {
      console.error(`[ValidationTurn] Unexpected error for run=${runId} node=${nodeId}:`, (err as Error).message)
      return this.buildSkippedResult(`验证异常: ${(err as Error).message}`, startTime)
    }
  }

  /**
   * 获取验证结果（供 AutoFlowEngine 查询）
   */
  getValidationResult(runId: string, nodeId: string): ValidationResult | undefined {
    const result = this.validationResults.get(`${runId}:${nodeId}`)
    const run = this.workflowEngine.getRun(runId)
    const node = run?.nodes.find(item => item.id === nodeId)
    if (!result || !run || !node || !result.turnId) return undefined
    const turn = this.workflowEngine.getNodeTurns(nodeId).at(-1)
    if (turn?.id !== result.turnId || turn.status !== 'completed') return undefined
    if (result.configuration !== this.configurationKey(run, node)) return undefined
    if (result.cwd) {
      try {
        if (this.resolveWorkingDirectory(run, node) !== result.cwd ||
            workspaceFingerprint(result.cwd) !== result.workspaceFingerprint) return undefined
      } catch { return undefined }
    }
    return result
  }

  /**
   * 获取验证分数作为信心信号
   * AutoFlowEngine 调用此方法获取额外的验证信号
   * 
   * @returns 0.0 - 1.0，无结果时返回 undefined（不影响信心分计算）
   */
  getValidationScore(runId: string, nodeId: string): number | undefined {
    const result = this.getValidationResult(runId, nodeId)
    if (!result || result.strategy === 'skipped') return undefined
    return result.score
  }

  private configurationKey(run: Run, node: TaskNode): string {
    return JSON.stringify({ config: this.getValidationConfig(run), contracts: node.outputContracts,
      conditions: node.exitConditions, artifacts: node.artifacts, scriptCwd: node.scriptCwd })
  }

  hasPassingCheck(runId: string, nodeId: string, condition: ExitCondition): boolean {
    const result = this.getValidationResult(runId, nodeId)
    const name = condition.type === 'lint_pass' ? 'Lint' : 'Test'
    return !!result?.details.some(detail => detail.name === name && detail.passed)
  }

  // ═══════════════ Contract 校验 ═══════════════

  /**
   * 验证节点的 OutputContracts
   * 复用 ContractValidatorService 的已有能力
   */
  private validateContracts(node: TaskNode): ValidationDetail {
    if (!node.outputContracts || node.outputContracts.length === 0) {
      return {
        name: 'OutputContract',
        passed: true,
        score: 1.0,
        output: '无 Contract 约束，默认通过',
      }
    }

    try {
      const result = this.contractValidator.validateNode(node, node.outputContracts)
      const requiredContracts = result.results.filter(r => r.required)
      const optionalContracts = result.results.filter(r => !r.required)

      const requiredPassed = requiredContracts.filter(r => r.satisfied).length
      const optionalPassed = optionalContracts.filter(r => r.satisfied).length

      // 必填项占主要权重
      const requiredScore = requiredContracts.length > 0
        ? requiredPassed / requiredContracts.length
        : 1.0
      const optionalScore = optionalContracts.length > 0
        ? optionalPassed / optionalContracts.length
        : 1.0

      // 综合分数：必填 80% + 可选 20%
      const score = requiredScore * 0.8 + optionalScore * 0.2

      const failedContracts = result.results
        .filter(r => !r.satisfied)
        .map(r => `[${r.required ? 'REQUIRED' : 'OPTIONAL'}] ${r.title}: ${r.reason || 'not satisfied'}`)

      return {
        name: 'OutputContract',
        passed: requiredScore === 1.0,
        score,
        output: failedContracts.length > 0
          ? `失败项: ${failedContracts.join('; ')}`
          : `全部满足 (${requiredContracts.length} required + ${optionalContracts.length} optional)`,
      }
    } catch (err) {
      return {
        name: 'OutputContract',
        passed: false,
        score: 0.0,
        error: `Contract 校验异常: ${(err as Error).message}`,
      }
    }
  }

  // ═══════════════ 验证脚本执行 ═══════════════

  /**
   * 运行代码节点的验证脚本
   * 
   * 脚本来源优先级：
   * 1. ValidationConfig.scripts[nodeType] — 全局配置覆盖
   * 2. node.exitConditions 中定义的检查脚本
   * 3. 默认推断（lint + test）
   * 
   * 复用 DET 模式的执行基础设施（execSync + timeout）
   */
  private async runValidationScripts(
    node: TaskNode,
    run: Run,
    config: ValidationConfig
  ): Promise<ValidationDetail[]> {
    const details: ValidationDetail[] = []
    const timeout = config.scriptTimeout || 60_000

    // 确定工作目录
    const cwd = this.resolveWorkingDirectory(run, node)
    if (!cwd) {
      details.push({
        name: 'ValidationScript',
        passed: false,
        score: 0,
        output: '无法确定工作目录，跳过脚本验证',
      })
      return details
    }

    // 收集需要运行的验证脚本
    const scripts = this.collectValidationScripts(node, config)

    for (const script of scripts) {
      if (this.cancelledValidations.has(`${run.id}:${node.id}`)) break
      const result = await this.executeScript(script.command, cwd, timeout, `${run.id}:${node.id}`)

      const passed = result.exitCode === 0 && !result.timedOut
      let score: number
      if (passed) {
        score = 1.0
      } else if (result.timedOut) {
        score = 0.3  // 超时不一定是失败，给中间分
      } else {
        // 根据输出分析失败严重程度
        score = this.analyzeScriptFailureSeverity(result)
      }

      details.push({
        name: script.name,
        passed,
        score,
        output: this.truncateOutput(result.stdout + result.stderr, 500),
        duration: result.duration,
        error: result.timedOut ? `超时 (${timeout}ms)` : undefined,
      })
    }

    return details
  }

  /**
   * 收集验证脚本列表
   */
  private collectValidationScripts(
    node: TaskNode,
    config: ValidationConfig
  ): Array<{ name: string; command: string }> {
    const scripts: Array<{ name: string; command: string }> = []

    // 优先使用配置中的脚本
    if (config.scripts) {
      const configScript = config.scripts[node.type] || config.scripts[node.name]
      if (configScript) {
        scripts.push({ name: `Config:${node.type}`, command: configScript })
        // 必需的准出检查仍需单独运行，不能被通用脚本覆盖。
      }
    }

    // 从 exitConditions 中提取验证脚本
    if (node.exitConditions) {
      for (const cond of node.exitConditions) {
        switch (cond.type) {
          case 'lint_pass':
            scripts.push({
              name: 'Lint',
              command: cond.value || 'npm run lint --silent',
            })
            break
          case 'test_pass':
            scripts.push({
              name: 'Test',
              command: cond.value || 'npm test --silent',
            })
            break
        }
      }
    }

    // 如果没有任何脚本配置，使用智能推断
    if (scripts.length === 0 && node.type === 'implement') {
      // 尝试检测项目类型并推断验证命令
      scripts.push({
        name: 'TypeCheck',
        command: 'npm exec --no -- tsc --noEmit',
      })
    }

    return scripts
  }

  /**
   * 执行单个脚本（异步，带超时）
   */
  private async executeScript(command: string, cwd: string, timeout: number, key: string): Promise<ScriptExecResult> {
    const startTime = Date.now()
    let diagnostics = ''
    const worker = new ExecutionWorkerClient({ turnId: `validation-${randomUUID()}`, prompt: '', script: command,
      cwd, timeoutMs: timeout, environment: { ...executionEnvironment(), CI: 'true', FORCE_COLOR: '0' } }, message => {
      if (message.type === 'output') diagnostics = (diagnostics + message.text).slice(-2000)
    }, () => !this.cancelledValidations.has(key))
    const workers = this.scriptWorkers.get(key) || new Set<ExecutionWorkerClient>()
    workers.add(worker)
    this.scriptWorkers.set(key, workers)
    try {
      const result = await worker.result
      return { exitCode: result.success ? 0 : result.code || 1,
        stdout: result.output, stderr: `${diagnostics}\n${result.error || ''}`,
        timedOut: result.error?.includes('timed out') === true, duration: Date.now() - startTime }
    } finally {
      workers.delete(worker)
      if (!workers.size) this.scriptWorkers.delete(key)
    }
  }

  /**
   * 分析脚本失败的严重程度
   * 返回 0.0 - 0.5 的分数（0 = 完全失败，0.5 = 部分问题）
   */
  private analyzeScriptFailureSeverity(result: ScriptExecResult): number {
    const output = (result.stdout + result.stderr).toLowerCase()

    // 致命错误模式
    const fatalPatterns = [
      'syntax error', 'cannot find module', 'reference error',
      'segmentation fault', 'out of memory', 'fatal:',
    ]
    if (fatalPatterns.some(p => output.includes(p))) {
      return 0.0
    }

    // 严重错误（编译失败、大量测试失败）
    const severePatterns = ['error ts', 'build failed', 'failed to compile']
    if (severePatterns.some(p => output.includes(p))) {
      return 0.1
    }

    // 中等问题（部分测试失败、lint 警告）
    const moderatePatterns = ['test failed', 'tests failed', 'assertion']
    if (moderatePatterns.some(p => output.includes(p))) {
      // 尝试提取失败比例
      const failMatch = output.match(/(\d+)\s+(?:failed|failing)/)
      const passMatch = output.match(/(\d+)\s+(?:passed|passing)/)
      if (failMatch && passMatch) {
        const failed = parseInt(failMatch[1])
        const passed = parseInt(passMatch[1])
        const total = failed + passed
        if (total > 0) {
          return Math.min(0.5, (passed / total) * 0.5)
        }
      }
      return 0.2
    }

    // 轻微问题（lint 警告等）
    const minorPatterns = ['warning', 'deprecated']
    if (minorPatterns.some(p => output.includes(p))) {
      return 0.4
    }

    // 未知失败，给保守分
    return 0.2
  }

  // ═══════════════ LLM 验证 Turn ═══════════════

  /**
   * 执行 LLM 验证 Turn
   * 
   * 使用 manager 角色 Agent 审查节点产出物质量
   * 验证 Turn 是异步的，但有超时保护（30s）
   * 
   * 审查维度：
   * - 产出物是否回答了任务要求
   * - 结构是否完整
   * - 是否有明显遗漏
   */
  private async runLLMValidation(node: TaskNode, run: Run): Promise<ValidationDetail | null> {
    if (!this.agentService || !this.dynamicAgentFactory) {
      return null
    }

    const key = `${run.id}:${node.id}`

    // 防止重复验证
    if (this.pendingLLMValidations.has(key)) {
      try {
        return await this.pendingLLMValidations.get(key)!
      } catch {
        return null
      }
    }

    const validationPromise = this.executeLLMValidation(node, run)
    this.pendingLLMValidations.set(key, validationPromise)

    try {
      const result = await validationPromise
      return result
    } finally {
      this.pendingLLMValidations.delete(key)
    }
  }

  /**
   * 执行 LLM 验证的实际逻辑
   */
  private async executeLLMValidation(node: TaskNode, _run: Run): Promise<ValidationDetail> {
    const startTime = Date.now()

    try {
      // 获取节点最后一个 Turn 的输出
      const turns = this.workflowEngine.getNodeTurns(node.id)
      const lastTurn = [...turns].reverse().find(t => t.status === 'completed')
      if (!lastTurn?.output) {
        return {
          name: 'LLM Review',
          passed: false,
          score: 0.0,
          output: '无可审查的输出内容',
          duration: Date.now() - startTime,
        }
      }

      // 构建验证 Prompt
      const validationPrompt = this.buildValidationPrompt(node, lastTurn.output)

      // 查找合适的 reviewer Agent
      const reviewerAgent = this.findReviewerAgent()
      if (!reviewerAgent) {
        return {
          name: 'LLM Review',
          passed: false,
          score: 0,
          output: '无可用的 Reviewer Agent，无法执行所需 LLM 验证',
          duration: Date.now() - startTime,
        }
      }

      // 执行验证 Turn（使用独立的 turn 机制）
      // 注意：这里不创建正式的 workflow turn，而是用轻量级方式执行
      const reviewOutput = await this.executeReviewAgent(reviewerAgent, validationPrompt, node)

      // 解析 LLM 输出中的验证结论
      const { passed, score, reasoning } = this.parseLLMReviewOutput(reviewOutput)

      return {
        name: 'LLM Review',
        passed,
        score,
        output: reasoning,
        duration: Date.now() - startTime,
      }
    } catch (err) {
      return {
        name: 'LLM Review',
        passed: true,
        score: 0.5,
        error: `LLM 验证异常: ${(err as Error).message}`,
        duration: Date.now() - startTime,
      }
    }
  }

  /**
   * 构建验证 Prompt
   * 
   * 明确告知 Agent 这是一个验证任务（非执行任务），
   * 要求输出结构化的验证结论
   */
  private buildValidationPrompt(node: TaskNode, output: string): string {
    const truncatedOutput = output.length > 5000 ? output.slice(0, 5000) + '\n\n... (输出已截断)' : output

    return [
      '## 验证任务',
      '',
      '你是一个质量审查员。请审查以下节点的执行产出物，判断其是否满足任务要求。',
      '',
      `### 节点信息`,
      `- 名称: ${node.name}`,
      `- 类型: ${node.type}`,
      `- 描述: ${node.description}`,
      '',
      node.outputContracts && node.outputContracts.length > 0
        ? `### 预期产出契约\n${node.outputContracts.map(c => `- [${c.required ? 'REQUIRED' : 'OPTIONAL'}] ${c.title}: ${c.category} (${c.format})`).join('\n')}\n`
        : '',
      '### 实际产出',
      '```',
      truncatedOutput,
      '```',
      '',
      '### 请以下面的格式输出验证结论：',
      '',
      'VERDICT: PASS 或 FAIL',
      'SCORE: 0-100 的质量分数',
      'REASONING: 一段简要说明（100字以内）',
      '',
      '注意：只做验证判断，不要执行任何代码修改。对于文档类产出，重点检查完整性和逻辑性；对于代码类产出，重点检查正确性和规范性。',
    ].filter(Boolean).join('\n')
  }

  /**
   * 查找可用的 Reviewer Agent
   */
  private findReviewerAgent(): { id: string; command: string } | null {
    if (!this.agentService) return null

    // 优先查找 manager 角色的 Agent
    const agents = this.agentService.getAgentsWithStatus()
    const reviewer = agents.find(a => a.available && a.role === 'manager')
    if (reviewer) return { id: reviewer.id, command: reviewer.command }

    // 兜底：使用任何可用 Agent
    const available = agents.find(a => a.available)
    if (available) return { id: available.id, command: available.command }

    return null
  }

  /**
   * 执行 Reviewer Agent（轻量级，不走完整的 Turn 生命周期）
   * 
   * 使用 execSync 同步执行（超时 30s），因为验证需要阻塞等待结果
   * 这里不创建正式的 workflow Turn，避免污染节点的 Turn 历史
   */
  private async executeReviewAgent(
    agent: { id: string; command: string },
    prompt: string,
    _node: TaskNode
  ): Promise<string> {
    const timeout = 30_000  // 30 秒超时

    const run = this.workflowEngine.getRun(_node.runId)
    const cwd = run && this.resolveWorkingDirectory(run, _node)
    if (!cwd) throw new Error('Reviewer execution directory is unavailable')
    const config = this.agentService?.getAgent(agent.id)
    if (!config || !['codex', 'claude'].includes(config.type)) throw new Error('Unsupported reviewer provider')
    const args = config.type === 'codex'
      ? ['exec', '--sandbox', 'read-only', '-'] : ['--print', '--tools', '']
    return execFileSync(agent.command, args, { cwd, input: prompt, encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'], timeout, maxBuffer: 2 * 1024 * 1024,
      env: executionEnvironment(config.type),
    })

  }

  /**
   * 解析 LLM 审查输出
   * 提取结构化的 VERDICT / SCORE / REASONING
   */
  private parseLLMReviewOutput(output: string): { passed: boolean; score: number; reasoning: string } {
    if (!output || output.trim().length === 0) {
      return { passed: true, score: 0.5, reasoning: 'LLM 验证无输出，默认中性' }
    }

    // 提取 VERDICT
    const verdictMatch = output.match(/VERDICT:\s*(PASS|FAIL)/i)
    const passed = verdictMatch ? verdictMatch[1].toUpperCase() === 'PASS' : true

    // 提取 SCORE
    const scoreMatch = output.match(/SCORE:\s*(\d+)/i)
    const rawScore = scoreMatch ? parseInt(scoreMatch[1]) : (passed ? 75 : 40)
    const score = Math.max(0, Math.min(100, rawScore)) / 100

    // 提取 REASONING
    const reasoningMatch = output.match(/REASONING:\s*(.+?)(?:\n|$)/i)
    const reasoning = reasoningMatch
      ? reasoningMatch[1].trim().slice(0, 200)
      : (passed ? '验证通过' : '验证未通过')

    return { passed, score, reasoning }
  }

  // ═══════════════ 输出质量检查 ═══════════════

  /**
   * 启发式输出质量检查
   * 补充 AutoFlowEngine 中已有的 outputQuality 信号
   * 这里做更深入的分析
   */
  private validateOutputQuality(node: TaskNode): ValidationDetail {
    const turns = this.workflowEngine.getNodeTurns(node.id)
    const lastTurn = [...turns].reverse().find(t => t.status === 'completed')

    if (!lastTurn?.output) {
      return {
        name: 'OutputQuality',
        passed: false,
        score: 0.0,
        output: '无输出内容',
      }
    }

    const output = lastTurn.output
    let score = 1.0
    const issues: string[] = []

    // 1. 长度检查（按节点类型区分）
    const minLength = this.getMinOutputLength(node.type)
    if (output.length < minLength) {
      score -= 0.3
      issues.push(`输出过短 (${output.length} < ${minLength} 字符)`)
    }

    // 2. 致命错误模式检测
    const fatalPatterns = [
      { pattern: /fatal error/i, desc: 'Fatal error' },
      { pattern: /panic:/i, desc: 'Panic' },
      { pattern: /segfault|segmentation fault/i, desc: 'Segfault' },
      { pattern: /out of memory/i, desc: 'OOM' },
      { pattern: /SIGKILL|SIGABRT/i, desc: '进程被杀' },
    ]
    for (const { pattern, desc } of fatalPatterns) {
      if (pattern.test(output)) {
        score -= 0.5
        issues.push(desc)
        break  // 一个致命错误就够了
      }
    }

    // 3. 错误密度分析（在输出末尾 1000 字符中分析）
    const tail = output.slice(-1000)
    const errorLines = tail.split('\n').filter(line =>
      /error:|Error:|ERROR|FAIL(?:ED)?|TypeError|SyntaxError|ReferenceError/i.test(line)
    )
    const totalTailLines = tail.split('\n').length
    const errorDensity = totalTailLines > 0 ? errorLines.length / totalTailLines : 0

    if (errorDensity > 0.3) {
      score -= 0.4
      issues.push(`高错误密度 (${Math.round(errorDensity * 100)}%)`)
    } else if (errorDensity > 0.1) {
      score -= 0.2
      issues.push(`中等错误密度 (${Math.round(errorDensity * 100)}%)`)
    }

    // 4. 未完成指标
    const incompletePatterns = [
      /TODO:|FIXME:|HACK:|XXX:/i,
      /not implemented/i,
      /placeholder/i,
    ]
    const incompleteCount = incompletePatterns.filter(p => p.test(output)).length
    if (incompleteCount > 0) {
      score -= 0.1 * incompleteCount
      issues.push(`包含 ${incompleteCount} 个未完成标记`)
    }

    // 5. 正面信号（加分）
    const positivePatterns = [
      { pattern: /all tests? pass/i, boost: 0.1 },
      { pattern: /build succeeded|compiled successfully/i, boost: 0.1 },
      { pattern: /0 errors?/i, boost: 0.05 },
    ]
    for (const { pattern, boost } of positivePatterns) {
      if (pattern.test(tail)) {
        score = Math.min(1.0, score + boost)
      }
    }

    score = Math.max(0, Math.min(1, score))

    return {
      name: 'OutputQuality',
      passed: score >= 0.5,
      score,
      output: issues.length > 0 ? issues.join('; ') : '质量检查通过',
    }
  }

  /**
   * 根据节点类型确定最小输出长度
   */
  private getMinOutputLength(nodeType: string): number {
    switch (nodeType) {
      case 'specify': return 200     // 需求文档至少 200 字
      case 'design': return 300      // 设计文档至少 300 字
      case 'implement': return 50    // 代码实现至少 50 字符
      case 'test': return 30         // 测试输出至少 30 字符
      case 'review': return 100      // 审查报告至少 100 字
      case 'deliver': return 150     // 交付报告至少 150 字
      default: return 30
    }
  }

  // ═══════════════ 综合计算 ═══════════════

  /**
   * 综合多项验证结果，计算最终分数
   * 
   * 权重策略：
   * - Contract 校验：35%（结构化、确定性高）
   * - 验证脚本：35%（客观、可重复）
   * - 输出质量：15%（启发式）
   * - LLM 审查：15%（主观但有深度）
   * 
   * 如果某项不存在（如无脚本/无 LLM），权重自动重分配
   */
  private computeCompositeResult(details: ValidationDetail[], startTime: number): ValidationResult {
    if (details.length === 0) {
      return this.buildSkippedResult('无验证项', startTime)
    }

    // 权重分配
    const weightMap: Record<string, number> = {
      'OutputContract': 0.35,
      'Lint': 0.15,
      'Test': 0.20,
      'TypeCheck': 0.15,
      'LLM Review': 0.15,
      'OutputQuality': 0.15,
    }

    // 对配置脚本使用通用权重
    const configScriptWeight = 0.35

    let totalWeight = 0
    let weightedScore = 0

    for (const detail of details) {
      let weight = weightMap[detail.name]
      if (!weight) {
        // 配置脚本或其他未知项
        weight = detail.name.startsWith('Config:') ? configScriptWeight : 0.10
      }
      totalWeight += weight
      weightedScore += detail.score * weight
    }

    // 归一化（如果总权重不为 1）
    const score = totalWeight > 0 ? weightedScore / totalWeight : 0.5

    // 判断是否通过：分数 >= 0.6 且无致命失败
    const hasFatalFailure = details.some(d => !d.passed)
    const passed = score >= 0.6 && !hasFatalFailure

    // 确定策略标签
    const hasScript = details.some(d => ['Lint', 'Test', 'TypeCheck'].includes(d.name) || d.name.startsWith('Config:'))
    const hasLLM = details.some(d => d.name === 'LLM Review')
    let strategy: ValidationResult['strategy']
    if (hasScript && hasLLM) strategy = 'composite'
    else if (hasScript) strategy = 'script'
    else if (hasLLM) strategy = 'llm'
    else strategy = 'contract'

    // 生成摘要
    const failedItems = details.filter(d => !d.passed)
    const summary = passed
      ? `验证通过 (${Math.round(score * 100)}分)，${details.length} 项检查全部通过`
      : `验证未通过 (${Math.round(score * 100)}分)，${failedItems.length}/${details.length} 项未通过: ${failedItems.map(d => d.name).join(', ')}`

    return {
      passed,
      strategy,
      score,
      details,
      duration: Date.now() - startTime,
      summary,
    }
  }

  // ═══════════════ 辅助方法 ═══════════════

  /**
   * 获取验证配置
   */
  private getValidationConfig(run: Run): ValidationConfig {
    const autoFlow = run.config?.autoFlow

    // 从 AutoFlowConfig 中提取验证相关配置
    // 目前 ValidationConfig 字段在 AutoFlowConfig 中尚未定义，使用默认值
    // 未来可在 AutoFlowConfig 中增加 validation 字段
    const validationOverride = (autoFlow as any)?.validation as Partial<ValidationConfig> | undefined

    return {
      ...DEFAULT_VALIDATION_CONFIG,
      ...validationOverride,
    }
  }

  /**
   * 判断是否跳过验证
   */
  private shouldSkipValidation(node: TaskNode, config: ValidationConfig): boolean {
    if (config.skipValidationNodes && config.skipValidationNodes.length > 0) {
      if (config.skipValidationNodes.includes(node.type) || config.skipValidationNodes.includes(node.name)) {
        return true
      }
    }
    return false
  }

  /**
   * 解析节点工作目录
   */
  private resolveWorkingDirectory(run: Run, node: TaskNode): string | undefined {
    if (this.repoIsolation) {
      const turn = this.workflowEngine?.getNodeTurns(node.id).at(-1)
      if (!turn) throw new Error('No execution turn to verify')
      const workspace = this.repoIsolation.executions.assertSnapshot(turn.id)
      if (workspace.runId !== run.id || workspace.nodeId !== node.id) throw new Error('Workspace ownership mismatch')
      return workspace.execution.cwd
    }

    const project = this.projectService?.getProject(run.projectId)
    if (!project?.path) return undefined
    const root = realpathSync(project.path)
    const cwd = realpathSync(resolve(root, node.scriptCwd || '.'))
    const rel = relative(root, cwd)
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error('验证目录超出项目范围')
    }
    return cwd
  }

  /**
   * 构建跳过验证的结果
   */
  private buildSkippedResult(reason: string, startTime: number): ValidationResult {
    return {
      passed: false,
      strategy: 'skipped',
      score: 0.5,  // 跳过时给中性分，不影响 AutoFlow 决策
      details: [],
      duration: Date.now() - startTime,
      summary: reason,
    }
  }

  /**
   * 截断输出文本
   */
  private truncateOutput(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text
    return text.slice(0, maxLen) + '...(截断)'
  }

  /**
   * 缓存验证结果
   */
  private cacheResult(runId: string, nodeId: string, result: ValidationResult): void {
    const key = `${runId}:${nodeId}`
    if (this.validationResults.size >= ValidationTurnService.MAX_CACHE_SIZE) {
      const firstKey = this.validationResults.keys().next().value
      if (firstKey) this.validationResults.delete(firstKey)
    }
    this.validationResults.set(key, result)
  }

  /**
   * 审计记录
   */
  private auditValidation(runId: string, nodeId: string, nodeName: string, result: ValidationResult): void {
    if (!this.robustnessService) return
    this.robustnessService.audit(
      result.passed ? 'validation_passed' : 'validation_failed',
      {
        runId,
        nodeId,
        nodeName,
        strategy: result.strategy,
        score: Math.round(result.score * 100),
        duration: result.duration,
        details: result.details.map(d => ({
          name: d.name,
          passed: d.passed,
          score: Math.round(d.score * 100),
        })),
      },
      result.passed ? 'info' : 'warn'
    )
  }
}
