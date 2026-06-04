import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import type {
  AutoFlowConfig, WsMessage,
} from '../types/index.js'
import type { WorkflowEngine } from './workflow-engine.js'
import type { ContractValidatorService } from './contract-validator.js'
import type { MetricsCollector } from './metrics-collector.js'
import type { FeedbackCollector } from './feedback-collector.js'
import type { RobustnessService } from './robustness.js'
import type { RepoIsolationService } from './repo-isolation.js'
import type { ValidationTurnService } from './validation-turn.js'
import type { L1RuleLifecycleService } from './l1-rule-lifecycle.js'

export type AutoFlowEmitter = (type: WsMessage['type'], payload: unknown) => void

// ═══════════════════════════════════════════════════
// AutoFlowEngine — L2 自动审批引擎
//
// 核心职责：
// 1. 在 Agent 成功完成节点后，评估是否可以自动通过（跳过人工审批）
// 2. 收集多维信号计算信心分（0-100）
// 3. 信心分 >= 阈值 → 自动 completed；< 阈值 → wait_user_review
// 4. 所有决策记录审计日志，确保可追溯
//
// 设计原则：
// - 默认关闭（向后兼容）
// - 评估逻辑同步/快速执行（< 50ms），不阻塞 Agent close handler
// - 保守决策：宁可多审不可漏审
// - 信号体系可扩展
// ═══════════════════════════════════════════════════

/**
 * 信心评估信号集合
 */
export interface ConfidenceSignals {
  /** OutputContract 满足度 (0.0 - 1.0) */
  contractSatisfaction: number
  /** 准出条件是否通过 (0.0 或 1.0) */
  exitConditionsPassed: number
  /** 同 template 同位置节点的历史一次通过率 (0.0 - 1.0) */
  historicalPassRate: number
  /** 输出质量启发式评分 (0.0 - 1.0) */
  outputQuality: number
  /** 执行稳定性评分 (0.0 - 1.0) */
  executionStability: number
  /** 合并冲突风险 (1.0 = 无冲突, 0.8 = 低严重度, 0.5 = 中, 0.2 = 高, 0.0 = 极严重) */
  mergeConflictFree: number
  /** 验证 Turn 结果 (0.0 - 1.0, undefined = 未执行验证) */
  validationScore?: number
}

/**
 * AutoFlow 评估结果
 */
export interface EvaluationResult {
  /** 最终信心分 (0 - 100) */
  confidence: number
  /** 各信号值 */
  signals: ConfidenceSignals
  /** 决策结果 */
  decision: 'auto_approve' | 'require_review'
  /** 决策阈值 */
  threshold: number
  /** 人可读的决策解释 */
  reasoning: string
}

/** 
 * 信号权重配置（7 信号加权，基础 6 信号总和 = 1.0）
 * 当 validationScore 可用时，动态重分配权重（validation 占 15%，其余按比例缩减）
 */
const SIGNAL_WEIGHTS = {
  contractSatisfaction: 0.30,
  exitConditionsPassed: 0.22,
  historicalPassRate: 0.18,
  outputQuality: 0.10,
  executionStability: 0.08,
  mergeConflictFree: 0.12,
  // 验证信号权重（当可用时从其他信号按比例借用）
  validation: 0.15,
} as const

/** 默认 AutoFlow 配置 */
const DEFAULT_CONFIG: AutoFlowConfig = {
  enabled: false,
  confidenceThreshold: 75,
}

/** 默认强制 review 的节点类型（需求/设计/交付永远要人看） */
const DEFAULT_ALWAYS_REVIEW_NODES = ['specify', 'design', 'deliver']

/** 默认连续自动放行上限 */
const DEFAULT_MAX_CONSECUTIVE_AUTO_APPROVE = 3

export class AutoFlowEngine {
  private workflowEngine!: WorkflowEngine
  private contractValidator!: ContractValidatorService
  private metricsCollector!: MetricsCollector
  private feedbackCollector!: FeedbackCollector
  private robustnessService!: RobustnessService
  private repoIsolation?: RepoIsolationService
  private validationTurnService?: ValidationTurnService
  private l1RuleLifecycle?: L1RuleLifecycleService
  private emitter?: AutoFlowEmitter
  private storagePath: string
  private persistDebounceTimer?: ReturnType<typeof setTimeout>

  /** 连续自动放行计数器 key = runId */
  private consecutiveAutoApproveCount: Map<string, number> = new Map()

  constructor() {
    const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
    this.storagePath = join(home, '.agent-flow', 'autoflow')
  }

  /**
   * 注入依赖（延迟注入，避免循环依赖）
   */
  inject(deps: {
    workflowEngine: WorkflowEngine
    contractValidator: ContractValidatorService
    metricsCollector: MetricsCollector
    feedbackCollector: FeedbackCollector
    robustnessService: RobustnessService
    repoIsolation?: RepoIsolationService
    validationTurnService?: ValidationTurnService
    l1RuleLifecycle?: L1RuleLifecycleService
    emitter?: AutoFlowEmitter
  }): void {
    this.workflowEngine = deps.workflowEngine
    this.contractValidator = deps.contractValidator
    this.metricsCollector = deps.metricsCollector
    this.feedbackCollector = deps.feedbackCollector
    this.robustnessService = deps.robustnessService
    this.repoIsolation = deps.repoIsolation
    this.validationTurnService = deps.validationTurnService
    this.l1RuleLifecycle = deps.l1RuleLifecycle
    this.emitter = deps.emitter
    // 启动时恢复持久化状态
    this.restoreState().catch(err => {
      console.warn('[AutoFlow] Failed to restore adaptive state:', err.message)
    })
  }

  // ═══════════════ 核心决策方法 ═══════════════

  /**
   * 异步评估：先执行验证 Turn（如果启用），再做信心评估
   * 
   * 调用时机：Agent 成功完成后，需要执行验证脚本/LLM 验证时
   * 与 evaluateAndDecide 的区别：此方法会先触发异步验证，再做同步评估
   * 
   * @returns 'completed' = 自动通过 | 'waiting_user_review' = 需人工审核
   */
  async evaluateAndDecideAsync(runId: string, nodeId: string): Promise<'completed' | 'waiting_user_review'> {
    // 如果 ValidationTurnService 可用，先执行验证
    if (this.validationTurnService) {
      try {
        await this.validationTurnService.validate(runId, nodeId)
      } catch (err) {
        console.warn(`[AutoFlow] Validation failed for run=${runId} node=${nodeId}, continuing with evaluation:`, (err as Error).message)
      }
    }

    // 验证完成后（结果已缓存在 ValidationTurnService 中），执行同步评估
    return this.evaluateAndDecide(runId, nodeId)
  }

  /**
   * 评估并决定节点是否自动通过（同步版本）
   *
   * 调用时机：Agent 成功完成后（exitCode === 0），在 submitNodeDecision 之前
   * 性能要求：全同步内存操作，< 50ms（验证结果从缓存读取）
   *
   * @returns 'completed' = 自动通过 | 'waiting_user_review' = 需人工审核
   */
  evaluateAndDecide(runId: string, nodeId: string): 'completed' | 'waiting_user_review' {
    try {
      // 1. 获取节点级 AutoFlow 配置
      const config = this.getNodeAutoFlowConfig(runId, nodeId)
      if (!config.enabled) {
        return 'waiting_user_review'
      }

      // 2. 安全机制检查（在信号采集前快速判断，避免无效计算）
      const safetyBlock = this.checkSafetyMechanisms(runId, nodeId)
      if (safetyBlock) {
        // 安全机制触发，强制进入 review
        const signals = this.collectSignalsSafe(runId, nodeId)
        const confidence = this.computeConfidence(signals)
        const result: EvaluationResult = {
          confidence,
          signals,
          decision: 'require_review',
          threshold: 100,
          reasoning: safetyBlock,
        }
        this.recordEvaluation(runId, nodeId, result)
        this.emitSafetyBlocked(runId, nodeId, safetyBlock)
        return 'waiting_user_review'
      }

      // 3. 收集信号（各信号独立容错）
      const signals = this.collectSignalsSafe(runId, nodeId)

      // 4. 计算信心分
      const confidence = this.computeConfidence(signals)

      // 5. 应用自适应阈值（Phase 3: 冷启动 + 反馈调整）
      const threshold = this.getAdaptiveThreshold(runId, nodeId, config.threshold)
      let decision: EvaluationResult['decision'] = confidence >= threshold ? 'auto_approve' : 'require_review'

      // 6. 低置信度保底：即使在 neverReviewNodes 中，置信度 < 50 也强制 review
      if (confidence < 50) {
        decision = 'require_review'
      }

      // 7. 生成决策解释
      const reasoning = this.buildReasoning(signals, confidence, threshold, decision)

      // 8. 记录审计日志
      const result: EvaluationResult = { confidence, signals, decision, threshold, reasoning }
      this.recordEvaluation(runId, nodeId, result)

      // 9. 更新连续放行计数器 + 发射对应事件
      if (decision === 'auto_approve') {
        const count = (this.consecutiveAutoApproveCount.get(runId) || 0) + 1
        this.consecutiveAutoApproveCount.set(runId, count)
        this.emitAutoApproved(runId, nodeId, confidence)
      } else {
        // 任何 require_review 重置连续计数
        this.consecutiveAutoApproveCount.set(runId, 0)
        this.emitWaitingHumanReview(runId, nodeId, confidence, threshold)
      }

      return decision === 'auto_approve' ? 'completed' : 'waiting_user_review'
    } catch (err) {
      // 任何未预期的异常都 fallback 到人工审核（宁可多审不可漏审）
      console.error(`[AutoFlow] evaluateAndDecide failed for run=${runId} node=${nodeId}:`, err)
      if (this.robustnessService) {
        this.robustnessService.audit('autoflow_evaluation_error', {
          runId,
          nodeId,
          error: (err as Error).message,
        }, 'error')
      }
      return 'waiting_user_review'
    }
  }

  /**
   * 获取评估结果（供前端查询展示）
   */
  getLastEvaluation(runId: string, nodeId: string): EvaluationResult | undefined {
    return this.evaluationCache.get(`${runId}:${nodeId}`)
  }

  /**
   * 获取审计日志（供 WeeklyDigest 信号健康度分析使用）
   * 返回所有历史评估记录，包含 signals 字段用于分布分析
   */
  getAuditLog(): Array<EvaluationResult & { timestamp: number }> {
    return Array.from(this.evaluationHistory.values())
  }

  /**
   * 用户 approve 后重置连续计数器（人工介入打断连续链）
   */
  resetConsecutiveCount(runId: string): void {
    this.consecutiveAutoApproveCount.set(runId, 0)
  }

  /**
   * 获取 AutoFlow 统计数据（供 WeeklyDigest 使用）
   * 
   * 从评估缓存 + 自适应记录中提取关键指标
   * @param sinceDays - 只统计最近 N 天的数据（默认 7 天），避免缓存淘汰导致数据不完整
   */
  getAutoFlowStats(sinceDays = 7): {
    totalEvaluations: number
    autoApproved: number
    requireReview: number
    autoApproveCorrect: number
    autoApproveIncorrect: number
    averageConfidence: number
  } {
    const cutoff = Date.now() - sinceDays * 24 * 60 * 60 * 1000
    const evaluations = Array.from(this.evaluationHistory.values()).filter(e => e.timestamp >= cutoff)
    const totalEvaluations = evaluations.length
    const autoApproved = evaluations.filter(e => e.decision === 'auto_approve').length
    const requireReview = evaluations.filter(e => e.decision === 'require_review').length
    const averageConfidence = totalEvaluations > 0
      ? Math.round(evaluations.reduce((sum, e) => sum + e.confidence, 0) / totalEvaluations)
      : 0

    // 从自适应记录中汇总准确率数据
    let autoApproveCorrect = 0
    let autoApproveIncorrect = 0
    for (const record of this.adaptiveAdjustments.values()) {
      autoApproveCorrect += record.autoApproveCorrect
      autoApproveIncorrect += record.autoApproveIncorrect
    }

    return {
      totalEvaluations,
      autoApproved,
      requireReview,
      autoApproveCorrect,
      autoApproveIncorrect,
      averageConfidence,
    }
  }

  // ═══════════════ 安全机制 ═══════════════

  /**
   * 安全机制检查（在信心评估之前执行，快速拦截）
   * 
   * @returns null 表示通过安全检查；string 表示被阻断的原因
   */
  private checkSafetyMechanisms(runId: string, nodeId: string): string | null {
    const run = this.workflowEngine.getRun(runId)
    const node = run?.nodes.find(n => n.id === nodeId)
    if (!run || !node) return null

    const runConfig = this.workflowEngine.getRunConfig(runId)
    const autoFlow = runConfig?.autoFlow || DEFAULT_CONFIG

    const templateNodeId = this.extractTemplateNodeId(runId, nodeId)
    const nodeType = node.type || ''

    // 0. neverReviewNodes 快速放行（这些节点跳过所有安全拦截，但仍基于信心分决策）
    const neverReview = autoFlow.neverReviewNodes || []
    if (neverReview.length > 0) {
      if (neverReview.includes(templateNodeId) || neverReview.includes(nodeType) || neverReview.includes(node.name)) {
        return null  // 不阻断，走正常信心分评估
      }
    }

    // 1. alwaysReviewNodes 检查（节点模板 ID 或节点类型或节点名称匹配）
    const alwaysReview = autoFlow.alwaysReviewNodes || DEFAULT_ALWAYS_REVIEW_NODES
    if (alwaysReview.length > 0) {
      if (alwaysReview.includes(templateNodeId) || alwaysReview.includes(nodeType) || alwaysReview.includes(node.name)) {
        return `安全机制：节点「${node.name}」在 alwaysReviewNodes 列表中，强制人工审核`
      }
    }

    // 2. maxConsecutiveAutoApprove 检查（neverReviewNodes 已提前返回，不受此限制）
    const maxConsecutive = autoFlow.maxConsecutiveAutoApprove ?? DEFAULT_MAX_CONSECUTIVE_AUTO_APPROVE
    const currentConsecutive = this.consecutiveAutoApproveCount.get(runId) || 0
    if (currentConsecutive >= maxConsecutive) {
      return `安全机制：已连续自动放行 ${currentConsecutive} 个节点（上限 ${maxConsecutive}），强制人工审核`
    }

    return null
  }

  // ═══════════════ 事件发射 ═══════════════

  private emitAutoApproved(runId: string, nodeId: string, confidence: number): void {
    if (!this.emitter) return
    const run = this.workflowEngine.getRun(runId)
    const node = run?.nodes.find(n => n.id === nodeId)
    this.emitter('run:node_auto_approved', {
      runId,
      nodeId,
      nodeName: node?.name || nodeId,
      confidence,
    })
  }

  private emitWaitingHumanReview(runId: string, nodeId: string, confidence: number, threshold: number): void {
    if (!this.emitter) return
    const run = this.workflowEngine.getRun(runId)
    const node = run?.nodes.find(n => n.id === nodeId)
    this.emitter('run:waiting_human_review', {
      runId,
      nodeId,
      nodeName: node?.name || nodeId,
      confidence,
      threshold,
    })
  }

  private emitSafetyBlocked(runId: string, nodeId: string, reason: string): void {
    if (!this.emitter) return
    const run = this.workflowEngine.getRun(runId)
    const node = run?.nodes.find(n => n.id === nodeId)
    this.emitter('run:auto_flow_blocked', {
      runId,
      nodeId,
      nodeName: node?.name || nodeId,
      reason,
    })
  }

  // ═══════════════ 配置解析 ═══════════════

  /**
   * 获取节点级别的 AutoFlow 有效配置
   * 优先级：nodeOverrides > 全局配置 > 默认值
   */
  private getNodeAutoFlowConfig(runId: string, nodeId: string): { enabled: boolean; threshold: number } {
    const runConfig = this.workflowEngine.getRunConfig(runId)
    const autoFlow = runConfig?.autoFlow || DEFAULT_CONFIG

    if (!autoFlow.enabled) {
      return { enabled: false, threshold: autoFlow.confidenceThreshold }
    }

    // 检查节点级覆盖
    if (autoFlow.nodeOverrides) {
      // nodeId 格式: "run_xxxxx_nodeTemplateId"，提取原始模板 ID
      const templateNodeId = this.extractTemplateNodeId(runId, nodeId)
      const override = autoFlow.nodeOverrides[templateNodeId]
      if (override) {
        const enabled = override.enabled !== undefined ? override.enabled : autoFlow.enabled
        const threshold = override.threshold !== undefined ? override.threshold : autoFlow.confidenceThreshold
        return { enabled, threshold }
      }
    }

    return { enabled: autoFlow.enabled, threshold: autoFlow.confidenceThreshold }
  }

  /**
   * 从运行时 nodeId 提取模板原始 ID
   * nodeId 格式: "{runId}_{templateNodeId}"
   */
  private extractTemplateNodeId(runId: string, nodeId: string): string {
    const prefix = `${runId}_`
    if (nodeId.startsWith(prefix)) {
      return nodeId.slice(prefix.length)
    }
    return nodeId
  }

  // ═══════════════ 信号采集 ═══════════════

  /**
   * 采集所有评估信号（各信号独立容错）
   * 
   * 任何单个信号采集失败不影响其他信号，失败的信号使用保守默认值：
   * - 0.0 表示"不确定，倾向于审核"
   * - 0.5 表示"中性，不影响决策"
   */
  private collectSignalsSafe(runId: string, nodeId: string): ConfidenceSignals {
    const signals: ConfidenceSignals = {
      contractSatisfaction: this.safeCollect(() => this.getContractSatisfaction(runId, nodeId), 0.0, 'contractSatisfaction', runId, nodeId),
      exitConditionsPassed: this.safeCollect(() => this.getExitConditionsScore(runId, nodeId), 0.0, 'exitConditionsPassed', runId, nodeId),
      historicalPassRate: this.safeCollect(() => this.getHistoricalPassRate(runId, nodeId), 0.5, 'historicalPassRate', runId, nodeId),
      outputQuality: this.safeCollect(() => this.getOutputQuality(nodeId), 0.0, 'outputQuality', runId, nodeId),
      executionStability: this.safeCollect(() => this.getExecutionStability(nodeId), 0.0, 'executionStability', runId, nodeId),
      mergeConflictFree: this.safeCollect(() => this.getMergeConflictFreeScore(runId, nodeId), 1.0, 'mergeConflictFree', runId, nodeId),
    }

    // 验证 Turn 信号：从 ValidationTurnService 缓存中获取（非阻塞）
    if (this.validationTurnService) {
      const validationScore = this.validationTurnService.getValidationScore(runId, nodeId)
      if (validationScore !== undefined) {
        signals.validationScore = validationScore
      }
    }

    return signals
  }

  /**
   * 安全采集单个信号，异常时返回保守默认值
   */
  private safeCollect(fn: () => number, fallback: number, signalName: string, runId: string, nodeId: string): number {
    try {
      const value = fn()
      // 防御 NaN / Infinity
      if (!Number.isFinite(value)) {
        console.warn(`[AutoFlow] Signal "${signalName}" returned non-finite value for run=${runId} node=${nodeId}, using fallback=${fallback}`)
        return fallback
      }
      return Math.max(0, Math.min(1, value))
    } catch (err) {
      console.warn(`[AutoFlow] Signal "${signalName}" collection failed for run=${runId} node=${nodeId}:`, (err as Error).message)
      return fallback
    }
  }

  /**
   * 信号: OutputContract 满足度
   * 无 contract 定义 = 1.0（不约束即满足）
   */
  private getContractSatisfaction(runId: string, nodeId: string): number {
    const run = this.workflowEngine.getRun(runId)
    const node = run?.nodes.find(n => n.id === nodeId)
    if (!node?.outputContracts?.length) return 1.0

    const result = this.contractValidator.validateNode(node, node.outputContracts)
    const requiredContracts = result.results.filter(r => r.required)
    if (requiredContracts.length === 0) return 1.0

    const satisfiedCount = requiredContracts.filter(r => r.satisfied).length
    return satisfiedCount / requiredContracts.length
  }

  /**
   * 信号: 准出条件满足情况
   * 无 exitConditions = 1.0；有则检查最后 Turn 输出
   */
  private getExitConditionsScore(runId: string, nodeId: string): number {
    const run = this.workflowEngine.getRun(runId)
    const node = run?.nodes.find(n => n.id === nodeId)
    if (!node?.exitConditions?.length) return 1.0

    // 通过检查最后一个 Turn 的输出来预判准出条件
    const turns = this.workflowEngine.getNodeTurns(nodeId)
    const lastTurn = [...turns].reverse().find(t => t.status === 'completed')
    if (!lastTurn?.output) return 0.0

    let passedCount = 0
    for (const cond of node.exitConditions) {
      switch (cond.type) {
        case 'output_contains':
          if (cond.value && lastTurn.output.includes(cond.value)) passedCount++
          break
        case 'lint_pass': {
          const hasLintError = lastTurn.output.includes('lint error') || lastTurn.output.includes('eslint')
          if (!hasLintError) passedCount++
          break
        }
        case 'test_pass': {
          const hasTestFail = lastTurn.output.includes('FAIL') || lastTurn.output.includes('test failed')
          if (!hasTestFail) passedCount++
          break
        }
        default:
          passedCount++ // expression 等预留类型默认通过
      }
    }

    return passedCount / node.exitConditions.length
  }

  /**
   * 信号: 历史一次通过率
   * 查询同 template 同 order 位置节点的历史表现
   * 无历史数据 = 0.5（中性值，不主导决策）
   * 
   * 性能优化：
   * - 只扫描同 projectId 的 Runs（缩小搜索范围）
   * - 从最新往回倒序遍历，找到 10 条即停
   * - 避免全量 filter + sort
   */
  private getHistoricalPassRate(runId: string, nodeId: string): number {
    const run = this.workflowEngine.getRun(runId)
    const node = run?.nodes.find(n => n.id === nodeId)
    if (!run || !node) return 0.5

    // 只查同 project 的 Runs（同一项目的 template 才有比较意义）
    const allRuns = this.workflowEngine.getRuns(run.projectId)

    // 倒序遍历收集最近 10 条同 template 的已完成 Run（避免全量 filter）
    const MAX_HISTORY = 10
    const sameTemplateRuns: typeof allRuns = []
    for (let i = allRuns.length - 1; i >= 0 && sameTemplateRuns.length < MAX_HISTORY; i--) {
      const r = allRuns[i]
      if (r.templateId === run.templateId && r.id !== runId && r.status === 'completed') {
        sameTemplateRuns.push(r)
      }
    }

    if (sameTemplateRuns.length === 0) return 0.5

    // 找同 order 位置节点的一次通过率
    let passCount = 0
    let totalCount = 0

    for (const histRun of sameTemplateRuns) {
      const histNode = histRun.nodes.find(n => n.order === node.order)
      if (!histNode || histNode.status !== 'completed') continue

      totalCount++
      const metrics = this.metricsCollector.getRunMetrics(histRun.id)
      const nodeMetric = metrics?.nodeMetrics.find(nm => nm.nodeId === histNode.id)
      if (nodeMetric?.firstPassApproved) {
        passCount++
      }
    }

    return totalCount > 0 ? passCount / totalCount : 0.5
  }

  /**
   * 信号: 输出质量（启发式）
   * 基于输出内容的简单规则判断
   */
  private getOutputQuality(nodeId: string): number {
    const turns = this.workflowEngine.getNodeTurns(nodeId)
    const lastTurn = [...turns].reverse().find(t => t.status === 'completed')
    if (!lastTurn?.output) return 0.0

    let score = 1.0
    const output = lastTurn.output

    // 输出过短（< 50 字符可能是空输出/错误）
    if (output.length < 50) score -= 0.4

    // 包含严重错误指标
    const criticalPatterns = [
      'fatal error', 'FATAL', 'panic:', 'segfault',
      'out of memory', 'stack overflow', 'SIGKILL',
    ]
    if (criticalPatterns.some(p => output.toLowerCase().includes(p.toLowerCase()))) {
      score -= 0.6
    }

    // 包含一般错误指标（需要排除代码中讨论 error 的情况）
    // 只在输出末尾 500 字符检查，避免代码内容中的误报
    const tail = output.slice(-500)
    const errorPatterns = ['Error:', 'error:', 'FAILED', 'npm ERR!', 'TypeError', 'SyntaxError']
    if (errorPatterns.some(p => tail.includes(p))) {
      score -= 0.3
    }

    // 包含告警但不致命
    const warnPatterns = ['warning:', 'Warning:', 'WARN', 'deprecated']
    if (warnPatterns.some(p => tail.includes(p))) {
      score -= 0.1
    }

    return Math.max(0, Math.min(1, score))
  }

  /**
   * 信号: 执行稳定性
   * 评估因子：Turn 次数、执行时长、是否有提问中断
   */
  private getExecutionStability(nodeId: string): number {
    const turns = this.workflowEngine.getNodeTurns(nodeId)
    if (turns.length === 0) return 0.0

    let score = 1.0

    // 多次 Turn 表示不稳定（重试/提问/多轮）
    if (turns.length > 2) score -= 0.3
    else if (turns.length > 1) score -= 0.15

    // 检查最后一个成功的 Turn
    const lastSuccessful = [...turns].reverse().find(t => t.result === 'succeeded')
    if (!lastSuccessful) return 0.0

    // 执行时长评估
    const duration = (lastSuccessful.completedAt || Date.now()) - lastSuccessful.startedAt
    if (duration > 8 * 60 * 1000) score -= 0.3         // > 8 min: 接近超时
    else if (duration > 5 * 60 * 1000) score -= 0.15   // > 5 min: 偏慢

    // 有中途提问的 Turn = 不够流畅
    const hasQuestion = turns.some(t => t.result === 'paused_for_question')
    if (hasQuestion) score -= 0.2

    return Math.max(0, Math.min(1, score))
  }

  /**
   * 信号: 合并冲突风险（升级版）
   * 
   * 检测节点工作空间中是否存在 merge conflict，返回连续分数：
   * - 无 RepoIsolation 或无工作空间 → 1.0（中性偏好）
   * - 无冲突 → 1.0
   * - 低严重度冲突（文档/测试文件）→ 0.8
   * - 中等严重度冲突（配置文件）→ 0.5
   * - 高严重度冲突（核心代码）→ 0.2
   * - 极严重冲突（多文件核心代码 + modify/delete）→ 0.0
   *
   * 改进点（对比旧版简单二值）：
   * 1. 基于文件路径重要性和冲突类型的连续分数（非二值）
   * 2. 详细日志输出冲突类型分析
   * 3. 为决策原因提供具体的冲突文件和类型信息
   */
  private getMergeConflictFreeScore(runId: string, nodeId: string): number {
    if (!this.repoIsolation) return 1.0

    const result = this.repoIsolation.checkMergeConflict(runId, nodeId)
    if (!result.hasConflict) return 1.0

    // 输出详细冲突信息（供审计和调试）
    const conflictSummary = result.conflicts
      .map(c => `[${c.type}] ${c.filePath}`)
      .join(', ')
    console.log(`[AutoFlow] Merge conflict detected for run=${runId} node=${nodeId}: severity=${result.severity}, conflicts: ${conflictSummary}`)

    // 返回 RepoIsolation 计算的严重度分数
    return result.severityScore
  }

  // ═══════════════ 信心分计算 ═══════════════

  /**
   * 加权计算信心分（利用学习后的动态权重）
   * 
   * 动态权重策略（3 层）：
   * 1. 基础权重：SIGNAL_WEIGHTS 中的固定配置
   * 2. 学习调整：基于 signalPerformance 的可靠性乘数
   * 3. 验证信号：当 validationScore 可用时，借用 15% 权重（其余按比例缩减至 85%）
   * 
   * 注意：学习权重在无充足反馈样本时退化为基础权重
   */
  private computeConfidence(signals: ConfidenceSignals): number {
    const hasValidation = signals.validationScore !== undefined

    // 获取学习后的权重（已归一化到总和=1.0）
    const learnedWeights = this.getLearnedSignalWeights()

    if (hasValidation) {
      // 动态重分配：validation 占 15%，学习后权重按比例缩减至 85%
      const shrinkFactor = 1 - SIGNAL_WEIGHTS.validation  // 0.85
      
      // validation 信号的权重乘数也做学习调整
      const validationPerf = this.signalPerformance.get('validationScore')
      const validationMultiplier = validationPerf?.weightMultiplier || 1.0
      const adjustedValidationWeight = SIGNAL_WEIGHTS.validation * Math.min(1.3, validationMultiplier)

      const confidence =
        signals.contractSatisfaction * learnedWeights.contractSatisfaction * shrinkFactor +
        signals.exitConditionsPassed * learnedWeights.exitConditionsPassed * shrinkFactor +
        signals.historicalPassRate * learnedWeights.historicalPassRate * shrinkFactor +
        signals.outputQuality * learnedWeights.outputQuality * shrinkFactor +
        signals.executionStability * learnedWeights.executionStability * shrinkFactor +
        signals.mergeConflictFree * learnedWeights.mergeConflictFree * shrinkFactor +
        signals.validationScore! * adjustedValidationWeight

      return Math.round(confidence * 100)
    }

    // 无验证信号时，使用学习后的 6 信号权重（总和 = 1.0）
    const confidence =
      signals.contractSatisfaction * learnedWeights.contractSatisfaction +
      signals.exitConditionsPassed * learnedWeights.exitConditionsPassed +
      signals.historicalPassRate * learnedWeights.historicalPassRate +
      signals.outputQuality * learnedWeights.outputQuality +
      signals.executionStability * learnedWeights.executionStability +
      signals.mergeConflictFree * learnedWeights.mergeConflictFree

    return Math.round(confidence * 100)
  }

  // ═══════════════ 决策解释 ═══════════════

  /**
   * 生成人可读的决策解释
   */
  private buildReasoning(
    signals: ConfidenceSignals,
    confidence: number,
    threshold: number,
    decision: EvaluationResult['decision']
  ): string {
    const parts: string[] = []

    if (decision === 'auto_approve') {
      parts.push(`信心分 ${confidence} >= 阈值 ${threshold}，自动通过。`)
    } else {
      parts.push(`信心分 ${confidence} < 阈值 ${threshold}，需人工审核。`)
    }

    // 列出关键信号贡献
    if (signals.contractSatisfaction < 1.0) {
      parts.push(`Contract 满足度: ${Math.round(signals.contractSatisfaction * 100)}%`)
    }
    if (signals.exitConditionsPassed < 1.0) {
      parts.push(`准出条件未完全满足`)
    }
    if (signals.outputQuality < 0.7) {
      parts.push(`输出质量偏低: ${Math.round(signals.outputQuality * 100)}%`)
    }
    if (signals.executionStability < 0.7) {
      parts.push(`执行稳定性不足: ${Math.round(signals.executionStability * 100)}%`)
    }
    if (signals.mergeConflictFree < 1.0) {
      const severityLabel = signals.mergeConflictFree >= 0.8 ? '低' :
        signals.mergeConflictFree >= 0.5 ? '中' :
          signals.mergeConflictFree >= 0.2 ? '高' : '极高'
      parts.push(`合并冲突风险(${severityLabel}): 安全分${Math.round(signals.mergeConflictFree * 100)}%`)
    }
    if (signals.validationScore !== undefined && signals.validationScore < 0.6) {
      parts.push(`验证 Turn 分数偏低: ${Math.round(signals.validationScore * 100)}%`)
    }

    return parts.join(' ')
  }

  // ═══════════════ 审计记录 ═══════════════

  /** 评估结果缓存（供前端实时查询，LRU 上限 500 条） */
  private evaluationCache: Map<string, EvaluationResult> = new Map()
  private static readonly MAX_CACHE_SIZE = 500

  /** 评估历史记录（带时间戳，供统计聚合，定期清理超过 30 天的数据） */
  private evaluationHistory: Map<string, EvaluationResult & { timestamp: number }> = new Map()
  private static readonly MAX_HISTORY_AGE_MS = 30 * 24 * 60 * 60 * 1000

  /**
   * 记录评估结果（审计日志 + 内存缓存）
   */
  private recordEvaluation(runId: string, nodeId: string, result: EvaluationResult): void {
    const key = `${runId}:${nodeId}`

    // 缓存供前端查询（LRU：超出上限时淘汰最早的条目）
    if (this.evaluationCache.size >= AutoFlowEngine.MAX_CACHE_SIZE) {
      const firstKey = this.evaluationCache.keys().next().value
      if (firstKey) this.evaluationCache.delete(firstKey)
    }
    this.evaluationCache.set(key, result)

    // 写入历史记录（供统计聚合），并定期清理老旧数据
    this.evaluationHistory.set(key, { ...result, timestamp: Date.now() })
    if (this.evaluationHistory.size > 1000) {
      this.pruneEvaluationHistory()
    }

    // 广播 WebSocket 事件（前端实时感知）
    if (this.emitter) {
      this.emitter('autoflow:evaluated', {
        runId,
        nodeId,
        confidence: result.confidence,
        threshold: result.threshold,
        decision: result.decision,
        reasoning: result.reasoning,
      })
    }

    // 写入审计日志
    if (this.robustnessService) {
      this.robustnessService.audit(
        result.decision === 'auto_approve' ? 'autoflow_auto_approved' : 'autoflow_require_review',
        {
          runId,
          nodeId,
          confidence: result.confidence,
          threshold: result.threshold,
          signals: result.signals,
          reasoning: result.reasoning,
        },
        'info'
      )
    }
  }

  /**
   * 清理超过 30 天的评估历史记录（内存回收）
   */
  private pruneEvaluationHistory(): void {
    const cutoff = Date.now() - AutoFlowEngine.MAX_HISTORY_AGE_MS
    for (const [key, entry] of this.evaluationHistory) {
      if (entry.timestamp < cutoff) {
        this.evaluationHistory.delete(key)
      }
    }
  }

  // ═══════════════ Phase 3: 自适应学习（贝叶斯方案） ═══════════════

  /**
   * 自适应学习记录（贝叶斯 Beta 分布建模）
   * key = "{templateId}:{nodeOrder}" 标识一类节点
   * 
   * 核心思想：
   * - 用 Beta 分布 Beta(alpha, beta) 建模每类节点"自动放行正确"的先验概率
   * - alpha = 成功次数的加权和（自动通过且用户认可 / 被拦截但用户通过）
   * - beta = 失败次数的加权和（自动通过但被打回）
   * - 后验均值 = alpha / (alpha + beta) 作为可靠性指标
   * - 阈值调整 = baseThreshold * (1 + adjustFactor)，adjustFactor 由后验分布决定
   */
  private adaptiveAdjustments: Map<string, AdaptiveRecord> = new Map()

  /** 信号权重学习记录：跟踪每个信号在预测中的贡献度 */
  private signalPerformance: Map<string, SignalPerformanceRecord> = new Map()

  /** 冷启动计数器：key = "{templateId}:{nodeOrder}"，value = 已完成次数 */
  private coldStartCounters: Map<string, number> = new Map()

  /** 冷启动阈值：前 N 次强制 review（不论信心分多高） */
  private static readonly COLD_START_RUNS = 3

  /** 时间衰减半衰期（天）：30 天前的样本影响力减半 */
  private static readonly DECAY_HALF_LIFE_DAYS = 30

  /** 贝叶斯先验参数（弱先验 = 假设系统初始 50% 可靠） */
  private static readonly PRIOR_ALPHA = 2
  private static readonly PRIOR_BETA = 2

  /**
   * 记录用户反馈（贝叶斯自适应学习）
   *
   * 调用时机：
   * - 用户 approve 节点时（feedback = 'approve'）
   * - 用户 reject 节点时（feedback = 'reject'）
   *
   * 贝叶斯更新规则：
   * - 自动通过 + 用户认可 → alpha += 1.0（强正样本）
   * - 被拦截 + 用户通过 → alpha += 0.3（弱正样本，系统过于保守）
   * - 自动通过 + 用户打回 → beta += 2.0（强负样本，误判代价高）
   * - 被拦截 + 用户打回 → beta += 0（系统判断正确，无需更新）
   * 
   * 信号权重学习：
   * - 记录决策时刻各信号的值
   * - 对比决策结果与实际反馈，计算每个信号的预测准确度
   * - 高准确度信号增加权重，低准确度信号减少权重
   */
  recordFeedback(runId: string, nodeId: string, feedback: 'approve' | 'reject'): void {
    const evaluation = this.evaluationCache.get(`${runId}:${nodeId}`)
    if (!evaluation) return // 没有评估记录（可能是 AutoFlow 未开启时的节点）

    const run = this.workflowEngine.getRun(runId)
    const node = run?.nodes.find(n => n.id === nodeId)
    if (!run || !node) return

    // 记录到 feedbackCollector（用于长期趋势分析和周报）
    if (feedback === 'reject' && evaluation.decision === 'auto_approve') {
      this.feedbackCollector.recordReviewReject({
        runId,
        nodeId,
        nodeName: node.name,
        reason: `AutoFlow 误判：信心分 ${evaluation.confidence} >= 阈值 ${evaluation.threshold} 但被用户打回。${evaluation.reasoning}`,
        retryCount: 0,
      })
    }

    const nodeKey = `${run.templateId}:${node.order}`
    const now = Date.now()

    // === 贝叶斯阈值更新 ===
    const record = this.adaptiveAdjustments.get(nodeKey) || this.createDefaultAdaptiveRecord()

    // 计算时间衰减权重（最近的反馈权重更高）
    const decayWeight = 1.0 // 当前反馈无衰减
    
    if (feedback === 'approve') {
      record.totalApprovals++
      if (evaluation.decision === 'auto_approve') {
        // 自动通过且用户认可 → 强正样本
        record.autoApproveCorrect++
        record.bayesAlpha += 1.0 * decayWeight
      } else {
        // 被拦截审核但用户快速通过 → 弱正样本（系统过于保守）
        record.bayesAlpha += 0.3 * decayWeight
        record.falseNegatives++
      }
    } else {
      record.totalRejections++
      if (evaluation.decision === 'auto_approve') {
        // 自动通过但用户打回 → 强负样本（误判代价高，增加 beta 更多）
        record.autoApproveIncorrect++
        record.bayesBeta += 2.0 * decayWeight
        record.falsePositives++
      }
      // require_review + reject → 系统判断正确，不调 beta
    }

    // 记录样本时间戳（用于后续时间衰减计算）
    record.sampleTimestamps.push(now)
    // 限制时间戳数组大小（保留最近 200 个）
    if (record.sampleTimestamps.length > 200) {
      record.sampleTimestamps = record.sampleTimestamps.slice(-200)
    }

    // 计算后验统计量
    record.posteriorMean = record.bayesAlpha / (record.bayesAlpha + record.bayesBeta)
    record.posteriorVariance = (record.bayesAlpha * record.bayesBeta) /
      ((record.bayesAlpha + record.bayesBeta) ** 2 * (record.bayesAlpha + record.bayesBeta + 1))
    record.confidenceInterval95 = [
      Math.max(0, record.posteriorMean - 1.96 * Math.sqrt(record.posteriorVariance)),
      Math.min(1, record.posteriorMean + 1.96 * Math.sqrt(record.posteriorVariance)),
    ]

    // 动态计算阈值偏移（基于后验分布而非固定步进）
    // 核心思想：后验均值高 → 系统可靠 → 降低阈值；反之提高
    record.thresholdDelta = this.computeBayesianThresholdDelta(record)

    record.lastUpdated = now
    this.adaptiveAdjustments.set(nodeKey, record)

    // === 信号权重学习 ===
    this.updateSignalPerformance(evaluation.signals, evaluation.decision, feedback)

    // 更新冷启动计数器
    const currentCount = this.coldStartCounters.get(nodeKey) || 0
    this.coldStartCounters.set(nodeKey, currentCount + 1)

    // 持久化（防抖写入，避免高频操作时 IO 过多）
    this.schedulePersist()

    // Phase 4: L1 沉淀 —— 高频 reject 原因自动沉淀为规则
    if (feedback === 'reject' && run.templateId && this.l1RuleLifecycle) {
      const rejectHistory = this.feedbackCollector.getRecentRejectsByNodeName(node.name, 10)
      const totalRejects = rejectHistory.reduce((sum, r) => sum + r.count, 0)
      if (totalRejects >= AutoFlowEngine.L1_SEDIMENTATION_THRESHOLD) {
        this.l1RuleLifecycle.sediment({
          templateId: run.templateId,
          nodeName: node.name,
          reasons: rejectHistory,
          totalRejects,
        }).catch(err => {
          console.warn('[AutoFlow] L1 sedimentation failed:', (err as Error).message)
        })
      }
      // 记录触发（即使未达阈值，已有规则也需要刷新衰减计时）
      this.l1RuleLifecycle.recordTrigger(run.templateId, node.name)
    }

    // Phase 4: L1 规则效果追踪 —— 节点通过时记录正样本
    if (feedback === 'approve' && run.templateId && this.l1RuleLifecycle) {
      this.l1RuleLifecycle.recordApproval(run.templateId, node.name)
    }

    // 审计日志
    if (this.robustnessService) {
      this.robustnessService.audit(
        'autoflow_adaptive_feedback',
        {
          runId,
          nodeId,
          nodeKey,
          feedback,
          originalDecision: evaluation.decision,
          posteriorMean: record.posteriorMean,
          confidenceInterval: record.confidenceInterval95,
          newThresholdDelta: record.thresholdDelta,
          signalWeightAdjustments: this.getLearnedSignalWeights(),
        },
        'info'
      )
    }
  }

  /**
   * 基于 Beta 后验分布计算阈值偏移
   * 
   * 策略：
   * - 后验均值 > 0.8 → 系统高度可靠，逐步降低阈值（最多 -12）
   * - 后验均值 ∈ [0.5, 0.8] → 系统一般可靠，小幅调整
   * - 后验均值 < 0.5 → 系统不可靠，提高阈值（最多 +15）
   * - 置信区间越窄（样本量大），调整越大胆
   * 
   * 公式：delta = (posteriorMean - 0.65) * scaleFactor * certaintyMultiplier
   */
  private computeBayesianThresholdDelta(record: AdaptiveRecord): number {
    const mean = record.posteriorMean
    const totalSamples = record.bayesAlpha + record.bayesBeta - AutoFlowEngine.PRIOR_ALPHA - AutoFlowEngine.PRIOR_BETA

    // 样本量较少时（<5），调整力度减弱
    const certaintyMultiplier = Math.min(1.0, totalSamples / 10)

    // 中心参考点 0.65（期望 65% 以上的自动通过准确率才开始降低阈值）
    const deviation = mean - 0.65

    // scaleFactor: 偏移放大系数
    // 可靠时（正偏差）：最多降低 12 分
    // 不可靠时（负偏差）：最多提高 18 分（不对称——误判代价高于保守代价）
    let scaleFactor: number
    if (deviation >= 0) {
      scaleFactor = 35  // 正偏差 → 最大约 0.35 * 35 = 12.25
    } else {
      scaleFactor = 50  // 负偏差 → 最大约 -0.65 * 50 = -32.5（被 clamp 到 -18）
    }

    const rawDelta = deviation * scaleFactor * certaintyMultiplier

    // 阈值偏移不超越安全区间 [-12, +18]
    return Math.max(-12, Math.min(18, -rawDelta))  // 注意方向：mean 高 → delta 为负（降低阈值）
  }

  /**
   * 创建默认自适应记录（使用弱先验）
   */
  private createDefaultAdaptiveRecord(): AdaptiveRecord {
    return {
      totalApprovals: 0,
      totalRejections: 0,
      autoApproveCorrect: 0,
      autoApproveIncorrect: 0,
      falsePositives: 0,
      falseNegatives: 0,
      bayesAlpha: AutoFlowEngine.PRIOR_ALPHA,
      bayesBeta: AutoFlowEngine.PRIOR_BETA,
      posteriorMean: 0.5,
      posteriorVariance: 0.05,
      confidenceInterval95: [0.1, 0.9],
      thresholdDelta: 0,
      sampleTimestamps: [],
      lastUpdated: Date.now(),
    }
  }

  /**
   * 应用时间衰减到自适应记录
   * 
   * 定期调用（在 getAdaptiveThreshold 时触发），将旧样本的影响力衰减
   * 使用指数衰减：weight = 0.5 ^ (daysSinceSample / halfLife)
   */
  private applyTimeDecay(record: AdaptiveRecord): AdaptiveRecord {
    const now = Date.now()

    // 重新计算 alpha 和 beta（基于带衰减的样本）
    // 简化方案：基于最后更新时间对整体 alpha/beta 做衰减
    const daysSinceUpdate = (now - record.lastUpdated) / (24 * 60 * 60 * 1000)
    
    if (daysSinceUpdate < 1) return record // 一天内不衰减

    const decayFactor = Math.pow(0.5, daysSinceUpdate / AutoFlowEngine.DECAY_HALF_LIFE_DAYS)
    
    // 对超出先验部分做衰减，保留先验底数
    const alphaExcess = (record.bayesAlpha - AutoFlowEngine.PRIOR_ALPHA) * decayFactor
    const betaExcess = (record.bayesBeta - AutoFlowEngine.PRIOR_BETA) * decayFactor

    record.bayesAlpha = AutoFlowEngine.PRIOR_ALPHA + Math.max(0, alphaExcess)
    record.bayesBeta = AutoFlowEngine.PRIOR_BETA + Math.max(0, betaExcess)

    // 重新计算后验统计量
    record.posteriorMean = record.bayesAlpha / (record.bayesAlpha + record.bayesBeta)
    record.posteriorVariance = (record.bayesAlpha * record.bayesBeta) /
      ((record.bayesAlpha + record.bayesBeta) ** 2 * (record.bayesAlpha + record.bayesBeta + 1))
    record.confidenceInterval95 = [
      Math.max(0, record.posteriorMean - 1.96 * Math.sqrt(record.posteriorVariance)),
      Math.min(1, record.posteriorMean + 1.96 * Math.sqrt(record.posteriorVariance)),
    ]

    record.thresholdDelta = this.computeBayesianThresholdDelta(record)
    record.lastUpdated = now

    return record
  }

  // === 信号权重动态学习 ===

  /**
   * 更新信号表现记录
   * 
   * 原理：每次反馈到来时，回顾决策时各信号的值，评估它们的预测准确度。
   * - 如果信号高分（>0.7）且最终用户认可 → 该信号预测准确，增加可靠性
   * - 如果信号高分但用户打回 → 该信号预测失误，降低可靠性
   * - 信号低分（<0.3）且被打回 → 信号正确预警，增加可靠性
   */
  private updateSignalPerformance(
    signals: ConfidenceSignals,
    decision: 'auto_approve' | 'require_review',
    feedback: 'approve' | 'reject'
  ): void {
    const isCorrectDecision = 
      (decision === 'auto_approve' && feedback === 'approve') ||
      (decision === 'require_review' && feedback === 'reject')

    const signalEntries: Array<[string, number]> = [
      ['contractSatisfaction', signals.contractSatisfaction],
      ['exitConditionsPassed', signals.exitConditionsPassed],
      ['historicalPassRate', signals.historicalPassRate],
      ['outputQuality', signals.outputQuality],
      ['executionStability', signals.executionStability],
      ['mergeConflictFree', signals.mergeConflictFree],
    ]

    if (signals.validationScore !== undefined) {
      signalEntries.push(['validationScore', signals.validationScore])
    }

    for (const [name, value] of signalEntries) {
      const perf = this.signalPerformance.get(name) || {
        name,
        totalSamples: 0,
        correctPredictions: 0,
        reliability: 0.5,
        weightMultiplier: 1.0,
        lastUpdated: Date.now(),
      }

      perf.totalSamples++

      // 判断信号是否做出了正确预测
      const signalPrediction = value >= 0.6 ? 'positive' : 'negative'
      const actualOutcome = feedback === 'approve' ? 'positive' : 'negative'
      
      if (signalPrediction === actualOutcome) {
        perf.correctPredictions++
      }

      // 加入决策一致性的额外奖惩
      if (isCorrectDecision) {
        // 决策正确时，高贡献信号（高权重*高值）额外加分
        const contribution = value * (SIGNAL_WEIGHTS as Record<string, number>)[name] || 0
        if (contribution > 0.1) perf.correctPredictions += 0.2
      }

      // 计算可靠性分数（带时间衰减的滚动准确率）
      perf.reliability = perf.totalSamples > 0
        ? perf.correctPredictions / perf.totalSamples
        : 0.5

      // 权重乘数：可靠性高的信号权重上调，低的下调
      // 范围限制在 [0.5, 1.5]，避免某个信号权重过高或过低
      perf.weightMultiplier = Math.max(0.5, Math.min(1.5,
        0.5 + perf.reliability  // reliability ∈ [0, 1] → multiplier ∈ [0.5, 1.5]
      ))

      perf.lastUpdated = Date.now()
      this.signalPerformance.set(name, perf)
    }
  }

  /**
   * 获取学习后的信号权重（应用可靠性乘数后归一化）
   * 
   * 供 computeConfidence 使用，使信心分计算能利用历史反馈
   */
  getLearnedSignalWeights(): Record<string, number> {
    const baseWeights: Record<string, number> = {
      contractSatisfaction: SIGNAL_WEIGHTS.contractSatisfaction,
      exitConditionsPassed: SIGNAL_WEIGHTS.exitConditionsPassed,
      historicalPassRate: SIGNAL_WEIGHTS.historicalPassRate,
      outputQuality: SIGNAL_WEIGHTS.outputQuality,
      executionStability: SIGNAL_WEIGHTS.executionStability,
      mergeConflictFree: SIGNAL_WEIGHTS.mergeConflictFree,
    }

    // 应用信号可靠性乘数
    let totalAdjustedWeight = 0
    const adjustedWeights: Record<string, number> = {}

    for (const [name, baseWeight] of Object.entries(baseWeights)) {
      const perf = this.signalPerformance.get(name)
      const multiplier = perf?.weightMultiplier || 1.0
      adjustedWeights[name] = baseWeight * multiplier
      totalAdjustedWeight += adjustedWeights[name]
    }

    // 归一化到总和 = 1.0（保持与原始权重体系一致）
    if (totalAdjustedWeight > 0) {
      for (const name of Object.keys(adjustedWeights)) {
        adjustedWeights[name] = adjustedWeights[name] / totalAdjustedWeight
      }
    }

    return adjustedWeights
  }

  // ═══════════════ Phase 4: L1 沉淀 ═══════════════

  /** L1 沉淀触发阈值：同一节点名称被 reject N 次后触发沉淀 */
  private static readonly L1_SEDIMENTATION_THRESHOLD = 3

  /**
   * 获取自适应调整后的有效阈值（含时间衰减）
   * 
   * 在 getNodeAutoFlowConfig 返回基准阈值后，基于贝叶斯后验分布调整：
   * 1. 冷启动检查：前 N 次强制 review
   * 2. 时间衰减：旧样本影响力随时间递减
   * 3. 贝叶斯阈值偏移：基于后验均值和置信区间
   */
  private getAdaptiveThreshold(runId: string, nodeId: string, baseThreshold: number): number {
    const run = this.workflowEngine.getRun(runId)
    const node = run?.nodes.find(n => n.id === nodeId)
    if (!run || !node) return baseThreshold

    const nodeKey = `${run.templateId}:${node.order}`

    // 冷启动检查：如果该类节点完成次数 < N，强制高阈值（= 不自动通过）
    const completionCount = this.coldStartCounters.get(nodeKey) || 0
    if (completionCount < AutoFlowEngine.COLD_START_RUNS) {
      return 100 // 不可能达到的阈值 → 强制进入 review
    }

    const record = this.adaptiveAdjustments.get(nodeKey)
    if (!record) return baseThreshold

    // 应用时间衰减（会更新 record 中的后验统计量和 thresholdDelta）
    this.applyTimeDecay(record)
    this.adaptiveAdjustments.set(nodeKey, record)

    // 保守策略：使用置信区间下界来决定方向
    // 如果置信区间下界 > 0.65，说明系统确实可靠，大胆降低阈值
    // 如果置信区间上界 < 0.5，说明系统确实不可靠，大胆提高阈值
    // 中间区域使用后验均值对应的 thresholdDelta
    const adjusted = baseThreshold + record.thresholdDelta
    return Math.max(50, Math.min(95, adjusted))
  }

  /**
   * 获取自适应学习统计（供前端展示 / API）
   * 
   * 包含丰富的贝叶斯统计信息和信号权重学习结果
   */
  getAdaptiveStats(): {
    nodeStats: Array<{
      nodeKey: string
      record: AdaptiveRecord
      effectiveThreshold: number
      coldStartCount: number
    }>
    signalWeights: Record<string, number>
    signalPerformance: Array<SignalPerformanceRecord>
  } {
    const nodeStats: Array<{
      nodeKey: string
      record: AdaptiveRecord
      effectiveThreshold: number
      coldStartCount: number
    }> = []

    for (const [nodeKey, record] of this.adaptiveAdjustments) {
      // 查询时也应用时间衰减
      this.applyTimeDecay(record)
      nodeStats.push({
        nodeKey,
        record,
        effectiveThreshold: Math.max(50, Math.min(95, 75 + record.thresholdDelta)),
        coldStartCount: this.coldStartCounters.get(nodeKey) || 0,
      })
    }

    return {
      nodeStats,
      signalWeights: this.getLearnedSignalWeights(),
      signalPerformance: Array.from(this.signalPerformance.values()),
    }
  }

  // ═══════════════ 持久化 ═══════════════

  /**
   * 立即持久化自适应状态（供优雅退出时调用，跳过防抖）
   */
  async flushState(): Promise<void> {
    if (this.persistDebounceTimer) {
      clearTimeout(this.persistDebounceTimer)
      this.persistDebounceTimer = undefined
    }
    await this.persistState()
  }

  /**
   * 持久化自适应状态（防抖：每次反馈后 2 秒内只写一次磁盘）
   */
  private schedulePersist(): void {
    if (this.persistDebounceTimer) {
      clearTimeout(this.persistDebounceTimer)
    }
    this.persistDebounceTimer = setTimeout(() => {
      this.persistState().catch(err => {
        console.error('[AutoFlow] Failed to persist adaptive state:', err.message)
      })
    }, 2000)
  }

  /**
   * 将自适应学习状态序列化到磁盘
   */
  private async persistState(): Promise<void> {
    const state: PersistedAdaptiveState = {
      version: 2,
      persistedAt: Date.now(),
      adaptiveAdjustments: Object.fromEntries(this.adaptiveAdjustments),
      coldStartCounters: Object.fromEntries(this.coldStartCounters),
      signalPerformance: Object.fromEntries(this.signalPerformance),
    }

    await mkdir(this.storagePath, { recursive: true })
    const filePath = join(this.storagePath, 'adaptive-state.json')
    await writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8')
  }

  /**
   * 从磁盘恢复自适应学习状态
   * 
   * 支持版本迁移：v1 → v2（补充贝叶斯字段）
   */
  private async restoreState(): Promise<void> {
    const filePath = join(this.storagePath, 'adaptive-state.json')
    try {
      const content = await readFile(filePath, 'utf-8')
      const state: PersistedAdaptiveState = JSON.parse(content)

      if (state.version > 2) {
        console.warn(`[AutoFlow] Unknown state version ${state.version}, skipping restore`)
        return
      }

      // 恢复 adaptiveAdjustments（v1 兼容：补充新字段）
      for (const [key, record] of Object.entries(state.adaptiveAdjustments)) {
        const rec = record as unknown as Record<string, unknown>
        // v1 → v2 迁移：补充贝叶斯字段
        if (!('bayesAlpha' in rec)) {
          const migratedRecord: AdaptiveRecord = {
            totalApprovals: (rec.totalApprovals as number) || 0,
            totalRejections: (rec.totalRejections as number) || 0,
            autoApproveCorrect: (rec.autoApproveCorrect as number) || 0,
            autoApproveIncorrect: (rec.autoApproveIncorrect as number) || 0,
            falsePositives: (rec.autoApproveIncorrect as number) || 0,
            falseNegatives: 0,
            bayesAlpha: AutoFlowEngine.PRIOR_ALPHA + ((rec.autoApproveCorrect as number) || 0),
            bayesBeta: AutoFlowEngine.PRIOR_BETA + ((rec.autoApproveIncorrect as number) || 0) * 2,
            posteriorMean: 0.5,
            posteriorVariance: 0.05,
            confidenceInterval95: [0.1, 0.9],
            thresholdDelta: (rec.thresholdDelta as number) || 0,
            sampleTimestamps: [],
            lastUpdated: Date.now(),
          }
          // 重新计算后验
          migratedRecord.posteriorMean = migratedRecord.bayesAlpha / (migratedRecord.bayesAlpha + migratedRecord.bayesBeta)
          migratedRecord.posteriorVariance = (migratedRecord.bayesAlpha * migratedRecord.bayesBeta) /
            ((migratedRecord.bayesAlpha + migratedRecord.bayesBeta) ** 2 * (migratedRecord.bayesAlpha + migratedRecord.bayesBeta + 1))
          migratedRecord.thresholdDelta = this.computeBayesianThresholdDelta(migratedRecord)
          this.adaptiveAdjustments.set(key, migratedRecord)
        } else {
          this.adaptiveAdjustments.set(key, record as AdaptiveRecord)
        }
      }

      // 恢复 coldStartCounters
      for (const [key, count] of Object.entries(state.coldStartCounters)) {
        this.coldStartCounters.set(key, count)
      }

      // 恢复 signalPerformance（v2 新增）
      if (state.signalPerformance) {
        for (const [key, perf] of Object.entries(state.signalPerformance)) {
          this.signalPerformance.set(key, perf)
        }
      }

      console.log(`[AutoFlow] Restored adaptive state (v${state.version}): ${this.adaptiveAdjustments.size} adjustments, ${this.coldStartCounters.size} cold-start counters, ${this.signalPerformance.size} signal records`)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // 文件不存在 = 首次启动，正常
        return
      }
      throw err
    }
  }
}

// ═══════════════ 类型定义 ═══════════════

/** 自适应学习记录（贝叶斯 Beta 分布建模） */
interface AdaptiveRecord {
  // 基础计数
  totalApprovals: number
  totalRejections: number
  autoApproveCorrect: number
  autoApproveIncorrect: number
  falsePositives: number
  falseNegatives: number

  // 贝叶斯参数
  /** Beta 分布 alpha 参数（成功的加权计数 + 先验） */
  bayesAlpha: number
  /** Beta 分布 beta 参数（失败的加权计数 + 先验） */
  bayesBeta: number
  /** 后验均值 = alpha / (alpha + beta) */
  posteriorMean: number
  /** 后验方差 */
  posteriorVariance: number
  /** 95% 置信区间 [lower, upper] */
  confidenceInterval95: [number, number]

  /** 累计阈值偏移量（正 = 更严格，负 = 更宽松）— 由贝叶斯后验计算 */
  thresholdDelta: number
  /** 样本时间戳（用于时间衰减） */
  sampleTimestamps: number[]
  /** 最后更新时间 */
  lastUpdated: number
}

/** 信号表现记录（信号权重动态学习） */
interface SignalPerformanceRecord {
  name: string
  /** 总样本数 */
  totalSamples: number
  /** 正确预测数（含小数，因为有额外奖惩） */
  correctPredictions: number
  /** 可靠性分数 (0.0 - 1.0) = correctPredictions / totalSamples */
  reliability: number
  /** 权重乘数 (0.5 - 1.5)：用于调节基础权重 */
  weightMultiplier: number
  /** 最后更新时间 */
  lastUpdated: number
}

/** 持久化状态结构（v2: 含贝叶斯参数和信号权重） */
interface PersistedAdaptiveState {
  version: number
  persistedAt: number
  adaptiveAdjustments: Record<string, AdaptiveRecord>
  coldStartCounters: Record<string, number>
  signalPerformance?: Record<string, SignalPerformanceRecord>
}
