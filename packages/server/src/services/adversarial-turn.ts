import { randomUUID } from 'crypto'
import type {
  SubTurn, ReviewVerdict,
  AdversarialSession, AdversarialStrategy, AdversarialResult,
  AdversarialConfig, TaskNode, Run, DynamicAgentInstance,
  AgentTurn,
} from '../types/index.js'
import type { WorkflowEngine } from './workflow-engine.js'
import type { DynamicAgentFactory } from './dynamic-agent-factory.js'
import type { AgentService } from './agent.js'
import type { A2AProtocolService } from './a2a-protocol.js'
import type { RobustnessService } from './robustness.js'

// ═══════════════════════════════════════════════════
// AdversarialTurnService — 节点内多 Agent 对抗机制
//
// 核心职责：
// 1. 在 Agent 主执行完成后，编排 coder→reviewer→(fix) 对抗 loop
// 2. 为 reviewer 创建独立 Sub-Agent 实例（独立上下文、独立 roleStatement）
// 3. 解析 reviewer 输出判定 verdict（approved/rejected/conditional）
// 4. rejected 时将反馈注入 coder prompt 进行修复（最多 N 轮）
// 5. 对抗结果产出 qualityScore 信号供 AutoFlow 使用
//
// 设计原则：
// - 对抗是节点级可选能力（由 TemplateNode.adversarial 配置）
// - Sub-Turn 是 Turn 的子结构，不影响外部状态机流转
// - Reviewer 只审不改：严格限制为"指出问题"而非"帮你修"
// - 最大轮次硬限制（默认 3），防止无限循环
// - 通过 A2A 通信（可选），让消息链路可观测
//
// 参考： coder+reviewer+tester 三角色交叉验证
// 实测可将 One-Shot 准确率从 60% 提升到 80%
// ═══════════════════════════════════════════════════

/** 默认对抗配置 */
const DEFAULT_ADVERSARIAL_CONFIG: Required<Omit<AdversarialConfig, 'reviewerRoleStatement' | 'testerRoleStatement'>> = {
  enabled: false,
  strategy: 'coder_reviewer',
  maxRounds: 3,
  requireAutoFlowAfterPass: true,
}

/** Reviewer 默认 roleStatement */
const DEFAULT_REVIEWER_ROLE_STATEMENT = `你是一个严格的代码/文档审查员。你的职责是：
1. 仔细阅读 coder 的产出物
2. 从逻辑正确性、代码质量、安全性、可维护性、规范遵循等维度审查
3. 明确指出存在的问题（每个问题独占一行，以 "- " 开头）
4. 给出最终结论

你只审不改。你不要帮忙修复代码，只需要清晰描述问题所在。

你的输出必须以以下格式结束：
---
VERDICT: [APPROVED|REJECTED|CONDITIONAL]
---

- APPROVED: 产出物质量达标，无需修改
- REJECTED: 存在必须修复的问题（列出具体问题）
- CONDITIONAL: 存在可选改进项，但不阻塞通过`

/** Tester 默认 roleStatement */
const DEFAULT_TESTER_ROLE_STATEMENT = `你是一个测试验证专家。你的职责是：
1. 阅读 coder 的实现代码
2. 编写关键路径的单元测试或验证脚本
3. 执行测试并报告结果

你的输出必须以以下格式结束：
---
VERDICT: [APPROVED|REJECTED]
---

- APPROVED: 所有测试通过
- REJECTED: 存在测试失败（列出失败用例）`

export class AdversarialTurnService {
  private workflowEngine!: WorkflowEngine
  private dynamicAgentFactory!: DynamicAgentFactory
  private agentService!: AgentService
  private a2aProtocol?: A2AProtocolService
  private robustnessService?: RobustnessService

  /** 活跃的对抗会话 */
  private sessions: Map<string, AdversarialSession> = new Map()

  /** 会话结果缓存（供 AutoFlow 查询信心信号） */
  private resultCache: Map<string, AdversarialResult> = new Map()
  private static readonly MAX_CACHE_SIZE = 200

  constructor() {}

  /**
   * 注入依赖（延迟注入，避免循环依赖）
   */
  inject(deps: {
    workflowEngine: WorkflowEngine
    dynamicAgentFactory: DynamicAgentFactory
    agentService: AgentService
    a2aProtocol?: A2AProtocolService
    robustnessService?: RobustnessService
  }): void {
    this.workflowEngine = deps.workflowEngine
    this.dynamicAgentFactory = deps.dynamicAgentFactory
    this.agentService = deps.agentService
    this.a2aProtocol = deps.a2aProtocol
    this.robustnessService = deps.robustnessService
  }

  // ═══════════════ 核心编排方法 ═══════════════

  /**
   * 发起对抗会话
   * 
   * 调用时机：Agent 主 Turn 完成后（coder 产出物已生成），在 AutoFlow 评估之前
   * 
   * @param runId - Run ID
   * @param nodeId - 节点 ID
   * @param parentTurnId - 主 Turn ID（coder 的首次执行）
   * @param coderOutput - coder 首次产出物内容
   * @returns AdversarialResult - 对抗结果（含 qualityScore）
   */
  async runAdversarial(
    runId: string,
    nodeId: string,
    parentTurnId: string,
    coderOutput: string
  ): Promise<AdversarialResult> {
    const run = this.workflowEngine.getRun(runId)
    const node = run?.nodes.find(n => n.id === nodeId)
    if (!run || !node) {
      throw new Error(`[Adversarial] Node not found: runId=${runId}, nodeId=${nodeId}`)
    }

    const config = this.resolveConfig(node)
    if (!config.enabled) {
      // 未启用对抗，返回默认通过结果
      return this.createBypassResult()
    }

    // 创建对抗会话
    const session = this.createSession(runId, nodeId, parentTurnId, config)
    this.sessions.set(session.id, session)

    console.log(`[Adversarial] Starting session ${session.id} for node "${node.name}" (strategy=${config.strategy}, maxRounds=${config.maxRounds})`)

    try {
      // 执行对抗 loop
      const result = await this.executeAdversarialLoop(session, node, run, coderOutput, config)
      
      // 记录结果
      session.result = result
      session.status = result.passed ? 'completed' : (session.currentRound >= session.maxRounds ? 'max_rounds_exceeded' : 'completed')
      session.completedAt = Date.now()

      // 缓存供 AutoFlow 查询
      this.cacheResult(runId, nodeId, result)

      // 审计日志
      this.audit('adversarial_completed', {
        sessionId: session.id,
        runId,
        nodeId,
        nodeName: node.name,
        strategy: config.strategy,
        totalRounds: result.totalRounds,
        passed: result.passed,
        qualityScore: result.qualityScore,
      })

      console.log(`[Adversarial] Session ${session.id} completed: passed=${result.passed}, rounds=${result.totalRounds}, quality=${result.qualityScore}`)
      return result
    } catch (err) {
      session.status = 'failed'
      session.completedAt = Date.now()

      const failResult = this.createFailResult((err as Error).message)
      this.cacheResult(runId, nodeId, failResult)

      this.audit('adversarial_failed', {
        sessionId: session.id,
        runId,
        nodeId,
        error: (err as Error).message,
      }, 'error')

      console.error(`[Adversarial] Session ${session.id} failed:`, (err as Error).message)
      return failResult
    }
  }

  /**
   * 获取节点的对抗结果（供 AutoFlow 查询信心信号）
   * 
   * @returns qualityScore (0.0 - 1.0) 或 undefined（未执行对抗）
   */
  getAdversarialScore(runId: string, nodeId: string): number | undefined {
    const result = this.resultCache.get(`${runId}:${nodeId}`)
    return result?.qualityScore
  }

  /**
   * 获取节点的完整对抗结果
   */
  getAdversarialResult(runId: string, nodeId: string): AdversarialResult | undefined {
    return this.resultCache.get(`${runId}:${nodeId}`)
  }

  /**
   * 获取活跃会话（供前端展示）
   */
  getActiveSession(runId: string, nodeId: string): AdversarialSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.runId === runId && session.nodeId === nodeId && session.status === 'active') {
        return session
      }
    }
    return undefined
  }

  /**
   * 获取会话详情（含所有 Sub-Turn，供前端 Sub-Turn 可视化）
   */
  getSessionById(sessionId: string): AdversarialSession | undefined {
    return this.sessions.get(sessionId)
  }

  /**
   * 获取节点的所有对抗会话（历史记录）
   */
  getNodeSessions(runId: string, nodeId: string): AdversarialSession[] {
    return Array.from(this.sessions.values()).filter(
      s => s.runId === runId && s.nodeId === nodeId
    )
  }

  /**
   * 判断节点是否启用了对抗
   */
  isAdversarialEnabled(node: TaskNode): boolean {
    return this.resolveConfig(node).enabled
  }

  // ═══════════════ 对抗 Loop 执行 ═══════════════

  /**
   * 执行对抗循环
   * 
   * 流程：
   * Round 0: (coder output 已有) → reviewer 审查
   * Round 1+: 如果 rejected → coder 修复 → reviewer 再审
   * 终止条件：approved / conditional / maxRounds 达到
   */
  private async executeAdversarialLoop(
    session: AdversarialSession,
    node: TaskNode,
    run: Run,
    initialCoderOutput: string,
    config: Required<Omit<AdversarialConfig, 'reviewerRoleStatement' | 'testerRoleStatement'>> & Partial<Pick<AdversarialConfig, 'reviewerRoleStatement' | 'testerRoleStatement'>>
  ): Promise<AdversarialResult> {
    let currentCoderOutput = initialCoderOutput
    let lastVerdict: ReviewVerdict = 'rejected'
    let lastFeedback: string[] = []

    for (let round = 0; round < session.maxRounds; round++) {
      session.currentRound = round

      // ── Step 1: Reviewer 审查 ──
      const reviewResult = await this.executeReviewerSubTurn(
        session, node, run, round, currentCoderOutput, config
      )

      lastVerdict = reviewResult.verdict
      lastFeedback = reviewResult.feedback

      // 如果通过或有条件通过，结束对抗
      if (lastVerdict === 'approved' || lastVerdict === 'conditional') {
        return this.buildResult(session, lastVerdict, round + 1)
      }

      // ── Step 2: Tester 验证（可选，coder_reviewer_tester 策略时） ──
      if (config.strategy === 'coder_reviewer_tester' && round === 0) {
        await this.executeTesterSubTurn(session, node, run, round, currentCoderOutput, config)
      }

      // ── Step 3: 如果是最后一轮，不再修复 ──
      if (round >= session.maxRounds - 1) {
        break
      }

      // ── Step 4: review_only 策略不进行修复 ──
      if (config.strategy === 'review_only') {
        break
      }

      // ── Step 5: Coder 修复 ──
      const fixResult = await this.executeCoderFixSubTurn(
        session, node, run, round + 1, currentCoderOutput, lastFeedback, config
      )
      currentCoderOutput = fixResult.output
    }

    // 达到最大轮次仍未通过
    return this.buildResult(session, lastVerdict, session.maxRounds)
  }

  /**
   * 执行 Reviewer Sub-Turn
   */
  private async executeReviewerSubTurn(
    session: AdversarialSession,
    node: TaskNode,
    run: Run,
    round: number,
    coderOutput: string,
    config: { reviewerRoleStatement?: string }
  ): Promise<{ verdict: ReviewVerdict; feedback: string[] }> {
    const subTurnId = `st_${randomUUID().slice(0, 8)}`
    const reviewerPrompt = this.buildReviewerPrompt(node, coderOutput, round)

    // 创建 Sub-Turn 记录
    const subTurn: SubTurn = {
      id: subTurnId,
      parentTurnId: session.parentTurnId,
      nodeId: session.nodeId,
      runId: session.runId,
      roundIndex: round,
      role: 'reviewer',
      agentInstanceId: '',  // 填充后更新
      status: 'running',
      prompt: reviewerPrompt,
      output: '',
      startedAt: Date.now(),
    }
    session.subTurns.push(subTurn)

    try {
      // 创建 Reviewer 动态实例
      const reviewerInstance = await this.createReviewerInstance(node, run, config.reviewerRoleStatement)
      subTurn.agentInstanceId = reviewerInstance.id

      // 通过 A2A 发送审查任务（可观测）
      if (this.a2aProtocol) {
        this.a2aProtocol.send({
          fromAgentId: `adversarial_manager_${session.id}`,
          toAgentId: reviewerInstance.id,
          runId: session.runId,
          nodeId: session.nodeId,
          type: 'delegated_task',
          payload: { title: `Review Round ${round + 1}`, intent: 'code_review' },
          priority: 'high',
          requiresAck: false,
        })
      }

      // 构建完整 prompt 并执行
      const fullPrompt = this.dynamicAgentFactory.buildFullPrompt(reviewerInstance, reviewerPrompt)
      const output = await this.executeSubAgent(reviewerInstance, fullPrompt, node, run)

      // 解析 reviewer 输出
      const { verdict, feedback } = this.parseReviewerOutput(output)

      // 更新 Sub-Turn 记录
      subTurn.output = output
      subTurn.verdict = verdict
      subTurn.reviewFeedback = feedback
      subTurn.status = 'completed'
      subTurn.completedAt = Date.now()

      // 通过 A2A 汇报结果
      if (this.a2aProtocol) {
        this.a2aProtocol.send({
          fromAgentId: reviewerInstance.id,
          toAgentId: `adversarial_manager_${session.id}`,
          runId: session.runId,
          nodeId: session.nodeId,
          type: 'task_delivery',
          payload: { verdict, feedback, round },
          priority: 'normal',
          requiresAck: false,
        })
      }

      // 清理实例
      this.dynamicAgentFactory.completeInstance(reviewerInstance.id)

      return { verdict, feedback }
    } catch (err) {
      subTurn.status = 'failed'
      subTurn.completedAt = Date.now()
      subTurn.output = `Reviewer execution failed: ${(err as Error).message}`
      // Reviewer 失败时 fallback 为 conditional（不阻塞流程）
      return { verdict: 'conditional', feedback: [`Reviewer 执行失败: ${(err as Error).message}`] }
    }
  }

  /**
   * 执行 Tester Sub-Turn（可选）
   */
  private async executeTesterSubTurn(
    session: AdversarialSession,
    node: TaskNode,
    run: Run,
    round: number,
    coderOutput: string,
    config: { testerRoleStatement?: string }
  ): Promise<{ verdict: ReviewVerdict; output: string }> {
    const subTurnId = `st_${randomUUID().slice(0, 8)}`
    const testerPrompt = this.buildTesterPrompt(node, coderOutput)

    const subTurn: SubTurn = {
      id: subTurnId,
      parentTurnId: session.parentTurnId,
      nodeId: session.nodeId,
      runId: session.runId,
      roundIndex: round,
      role: 'tester',
      agentInstanceId: '',
      status: 'running',
      prompt: testerPrompt,
      output: '',
      startedAt: Date.now(),
    }
    session.subTurns.push(subTurn)

    try {
      const testerInstance = await this.createTesterInstance(node, run, config.testerRoleStatement)
      subTurn.agentInstanceId = testerInstance.id

      const fullPrompt = this.dynamicAgentFactory.buildFullPrompt(testerInstance, testerPrompt)
      const output = await this.executeSubAgent(testerInstance, fullPrompt, node, run)

      const { verdict } = this.parseReviewerOutput(output)

      subTurn.output = output
      subTurn.verdict = verdict
      subTurn.status = 'completed'
      subTurn.completedAt = Date.now()

      this.dynamicAgentFactory.completeInstance(testerInstance.id)
      return { verdict, output }
    } catch (err) {
      subTurn.status = 'failed'
      subTurn.completedAt = Date.now()
      subTurn.output = `Tester execution failed: ${(err as Error).message}`
      return { verdict: 'conditional', output: subTurn.output }
    }
  }

  /**
   * 执行 Coder 修复 Sub-Turn
   */
  private async executeCoderFixSubTurn(
    session: AdversarialSession,
    node: TaskNode,
    run: Run,
    round: number,
    previousOutput: string,
    reviewFeedback: string[],
    _config: Record<string, unknown>
  ): Promise<{ output: string }> {
    const subTurnId = `st_${randomUUID().slice(0, 8)}`
    const fixPrompt = this.buildCoderFixPrompt(node, previousOutput, reviewFeedback, round)

    const subTurn: SubTurn = {
      id: subTurnId,
      parentTurnId: session.parentTurnId,
      nodeId: session.nodeId,
      runId: session.runId,
      roundIndex: round,
      role: 'coder',
      agentInstanceId: '',
      status: 'running',
      prompt: fixPrompt,
      output: '',
      startedAt: Date.now(),
    }
    session.subTurns.push(subTurn)

    try {
      // 获取节点当前关联的 coder 实例（复用主 Turn 的 Agent）
      const coderInstance = this.dynamicAgentFactory.getInstanceByNode(node.id, run.id)
      if (!coderInstance) {
        throw new Error('Coder instance not found for fix round')
      }
      subTurn.agentInstanceId = coderInstance.id

      // 通过 A2A 发送修复任务
      if (this.a2aProtocol) {
        this.a2aProtocol.send({
          fromAgentId: `adversarial_manager_${session.id}`,
          toAgentId: coderInstance.id,
          runId: session.runId,
          nodeId: session.nodeId,
          type: 'delegated_task',
          payload: { title: `Fix Round ${round}`, intent: 'fix_issues', feedback: reviewFeedback },
          priority: 'high',
          requiresAck: false,
        })
      }

      const fullPrompt = this.dynamicAgentFactory.buildFullPrompt(coderInstance, fixPrompt)
      const output = await this.executeSubAgent(coderInstance, fullPrompt, node, run)

      subTurn.output = output
      subTurn.status = 'completed'
      subTurn.completedAt = Date.now()

      return { output }
    } catch (err) {
      subTurn.status = 'failed'
      subTurn.completedAt = Date.now()
      subTurn.output = `Coder fix failed: ${(err as Error).message}`
      // 修复失败时返回上一次的输出
      return { output: previousOutput }
    }
  }

  // ═══════════════ Sub-Agent 执行 ═══════════════

  /**
   * 执行 Sub-Agent 并等待输出
   * 
   * 通过 AgentService.startTurnAsync 启动，然后轮询等待完成
   * （Sub-Turn 不走 WorkflowEngine 的 Turn 状态机，直接管理生命周期）
   */
  private async executeSubAgent(
    instance: DynamicAgentInstance,
    prompt: string,
    node: TaskNode,
    run: Run
  ): Promise<string> {
    // 启动 Agent Turn（利用现有基础设施）
    const turnId = this.agentService.startTurnAsync({
      agentId: instance.baseAgentId,
      nodeId: node.id,
      runId: run.id,
      prompt,
      cwd: node.scriptCwd,
    })

    // 等待 Turn 完成（轮询 + 超时）
    const output = await this.waitForTurnCompletion(turnId, node.id)
    return output
  }

  /**
   * 等待 Turn 完成
   * 
   * 轮询间隔：2s
   * 超时：5 分钟（Sub-Turn 应该比主 Turn 快）
   */
  private waitForTurnCompletion(turnId: string, nodeId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now()
      const timeout = 5 * 60 * 1000  // 5 min
      const pollInterval = 2000       // 2s

      const poll = () => {
        const turns = this.workflowEngine.getNodeTurns(nodeId)
        const turn = turns.find((t: AgentTurn) => t.id === turnId)

        if (!turn) {
          // Turn 还没有被 WorkflowEngine 记录（竞态），继续等
          if (Date.now() - startTime > timeout) {
            reject(new Error(`Sub-Turn ${turnId} timed out after ${timeout / 1000}s`))
            return
          }
          setTimeout(poll, pollInterval)
          return
        }

        if (turn.status === 'completed') {
          resolve(turn.output || '')
          return
        }

        if (turn.status === 'error') {
          reject(new Error(`Sub-Turn ${turnId} failed`))
          return
        }

        // 检查超时
        if (Date.now() - startTime > timeout) {
          reject(new Error(`Sub-Turn ${turnId} timed out after ${timeout / 1000}s`))
          return
        }

        setTimeout(poll, pollInterval)
      }

      poll()
    })
  }

  // ═══════════════ Agent 实例创建 ═══════════════

  /**
   * 创建 Reviewer 动态实例
   * 
   * 独立于 coder：使用不同的 roleStatement，确保"只审不改"的角色隔离
   */
  private async createReviewerInstance(
    node: TaskNode,
    run: Run,
    customRoleStatement?: string
  ): Promise<DynamicAgentInstance> {
    // 创建一个虚拟的 reviewer 节点配置（用于 DynamicAgentFactory）
    const reviewerNode: TaskNode = {
      ...node,
      id: `${node.id}_reviewer_${randomUUID().slice(0, 4)}`,
      name: `${node.name} [Reviewer]`,
      agentRole: 'executor',  // reviewer 使用 executor 角色的 Agent（实际执行审查）
      roleStatement: customRoleStatement || DEFAULT_REVIEWER_ROLE_STATEMENT,
    }

    return this.dynamicAgentFactory.createInstance(reviewerNode, run)
  }

  /**
   * 创建 Tester 动态实例
   */
  private async createTesterInstance(
    node: TaskNode,
    run: Run,
    customRoleStatement?: string
  ): Promise<DynamicAgentInstance> {
    const testerNode: TaskNode = {
      ...node,
      id: `${node.id}_tester_${randomUUID().slice(0, 4)}`,
      name: `${node.name} [Tester]`,
      agentRole: 'executor',
      roleStatement: customRoleStatement || DEFAULT_TESTER_ROLE_STATEMENT,
    }

    return this.dynamicAgentFactory.createInstance(testerNode, run)
  }

  // ═══════════════ Prompt 构建 ═══════════════

  /**
   * 构建 Reviewer 审查 prompt
   */
  private buildReviewerPrompt(node: TaskNode, coderOutput: string, round: number): string {
    const roundInfo = round > 0 ? `\n\n> 注意：这是第 ${round + 1} 轮审查，之前的审查发现了问题，coder 已经进行了修复。请重新审查修复后的产出物。` : ''

    return `## 审查任务

你需要审查以下节点的产出物：

**节点名称**: ${node.name}
**节点类型**: ${node.type}
**节点描述**: ${node.description}
${roundInfo}

---

## Coder 产出物

${coderOutput.slice(0, 15000)}${coderOutput.length > 15000 ? '\n\n[... 输出过长已截断 ...]' : ''}

---

## 审查要求

请从以下维度审查产出物质量：
1. **正确性**: 逻辑是否正确，是否满足节点描述的要求
2. **完整性**: 是否覆盖了所有必要的场景和边界条件
3. **代码质量**: 命名、结构、可读性、可维护性
4. **安全性**: 是否存在安全隐患（注入、越权、信息泄露等）
5. **规范遵循**: 是否遵循项目的编码规范和架构约定

请在最后给出结论（严格按格式）：
---
VERDICT: [APPROVED|REJECTED|CONDITIONAL]
---`
  }

  /**
   * 构建 Tester 测试 prompt
   */
  private buildTesterPrompt(node: TaskNode, coderOutput: string): string {
    return `## 测试验证任务

你需要为以下节点的产出物编写并验证测试：

**节点名称**: ${node.name}
**节点类型**: ${node.type}

---

## Coder 产出物

${coderOutput.slice(0, 12000)}${coderOutput.length > 12000 ? '\n\n[... 输出过长已截断 ...]' : ''}

---

## 测试要求

1. 编写关键路径的验证逻辑
2. 覆盖正常流程 + 边界条件 + 异常路径
3. 报告测试结果

请在最后给出结论：
---
VERDICT: [APPROVED|REJECTED]
---`
  }

  /**
   * 构建 Coder 修复 prompt
   */
  private buildCoderFixPrompt(
    node: TaskNode,
    previousOutput: string,
    reviewFeedback: string[],
    round: number
  ): string {
    const feedbackSection = reviewFeedback.map((f, i) => `${i + 1}. ${f}`).join('\n')

    return `## 修复任务（第 ${round} 轮）

Reviewer 在审查你的产出物后指出了以下问题，请逐一修复：

---

## Reviewer 反馈

${feedbackSection}

---

## 你之前的产出物

${previousOutput.slice(0, 12000)}${previousOutput.length > 12000 ? '\n\n[... 输出过长已截断 ...]' : ''}

---

## 修复要求

1. 针对 Reviewer 指出的每个问题进行修复
2. 不要改变原有的正确逻辑
3. 确保修复后的产出物完整且可工作
4. 简要说明你做了哪些修复

**节点**: ${node.name} (${node.type})
**描述**: ${node.description}`
  }

  // ═══════════════ 输出解析 ═══════════════

  /**
   * 解析 Reviewer 输出，提取 verdict 和反馈
   * 
   * 支持格式：
   * ---
   * VERDICT: APPROVED|REJECTED|CONDITIONAL
   * ---
   * 
   * 容错：如果没有标准格式，尝试从文本中推断
   */
  private parseReviewerOutput(output: string): { verdict: ReviewVerdict; feedback: string[] } {
    // 尝试精确匹配 VERDICT 格式
    const verdictMatch = output.match(/VERDICT:\s*(APPROVED|REJECTED|CONDITIONAL)/i)
    
    let verdict: ReviewVerdict = 'conditional'  // 默认有条件通过（容错）
    if (verdictMatch) {
      const raw = verdictMatch[1].toUpperCase()
      if (raw === 'APPROVED') verdict = 'approved'
      else if (raw === 'REJECTED') verdict = 'rejected'
      else verdict = 'conditional'
    } else {
      // 启发式推断
      const lowerOutput = output.toLowerCase()
      if (lowerOutput.includes('all good') || lowerOutput.includes('通过') || lowerOutput.includes('没有问题')) {
        verdict = 'approved'
      } else if (lowerOutput.includes('严重问题') || lowerOutput.includes('必须修复') || lowerOutput.includes('critical issue')) {
        verdict = 'rejected'
      }
    }

    // 提取反馈条目（以 "- " 开头的行）
    const feedbackLines = output.split('\n')
      .filter(line => line.trim().startsWith('- '))
      .map(line => line.trim().slice(2).trim())
      .filter(line => line.length > 0)

    // 如果没有结构化反馈，尝试提取 VERDICT 之前的内容作为摘要
    if (feedbackLines.length === 0 && verdict === 'rejected') {
      const verdictIdx = output.indexOf('VERDICT:')
      if (verdictIdx > 0) {
        const beforeVerdict = output.slice(0, verdictIdx).trim()
        const lastParagraph = beforeVerdict.split('\n\n').pop()?.trim()
        if (lastParagraph) {
          feedbackLines.push(lastParagraph)
        }
      }
    }

    return { verdict, feedback: feedbackLines }
  }

  // ═══════════════ 会话与结果管理 ═══════════════

  /**
   * 创建对抗会话
   */
  private createSession(
    runId: string,
    nodeId: string,
    parentTurnId: string,
    config: { strategy: AdversarialStrategy; maxRounds?: number }
  ): AdversarialSession {
    return {
      id: `adv_${randomUUID().slice(0, 8)}`,
      nodeId,
      runId,
      parentTurnId,
      strategy: config.strategy,
      subTurns: [],
      currentRound: 0,
      maxRounds: config.maxRounds || DEFAULT_ADVERSARIAL_CONFIG.maxRounds,
      status: 'active',
      startedAt: Date.now(),
    }
  }

  /**
   * 构建对抗结果
   */
  private buildResult(
    session: AdversarialSession,
    finalVerdict: ReviewVerdict,
    totalRounds: number
  ): AdversarialResult {
    const passed = finalVerdict === 'approved' || finalVerdict === 'conditional'

    // 计算质量分数
    // 公式：基础分(verdict) × 轮次衰减 × 一致性加分
    let qualityScore: number
    if (finalVerdict === 'approved') {
      // 首轮即通过 = 1.0，之后每轮衰减 0.15
      qualityScore = Math.max(0.4, 1.0 - (totalRounds - 1) * 0.15)
    } else if (finalVerdict === 'conditional') {
      // 有条件通过基础分 0.7，同样按轮次衰减
      qualityScore = Math.max(0.3, 0.7 - (totalRounds - 1) * 0.1)
    } else {
      // 未通过（达到最大轮次仍 rejected）
      qualityScore = Math.max(0.0, 0.3 - (totalRounds - 1) * 0.1)
    }

    // 构建摘要
    const summary = this.buildResultSummary(session, finalVerdict, totalRounds, qualityScore)

    return {
      passed,
      totalRounds,
      finalVerdict,
      qualityScore,
      summary,
    }
  }

  /**
   * 构建结果摘要
   */
  private buildResultSummary(
    session: AdversarialSession,
    verdict: ReviewVerdict,
    rounds: number,
    score: number
  ): string {
    const verdictLabel = verdict === 'approved' ? '✅ 通过'
      : verdict === 'conditional' ? '⚠️ 有条件通过'
      : '❌ 未通过'

    const parts = [
      `对抗审查 ${verdictLabel}`,
      `策略: ${session.strategy}`,
      `轮次: ${rounds}/${session.maxRounds}`,
      `质量分: ${Math.round(score * 100)}%`,
    ]

    // 附加最后一轮的 reviewer 反馈摘要
    const lastReviewerSubTurn = [...session.subTurns].reverse().find(st => st.role === 'reviewer')
    if (lastReviewerSubTurn?.reviewFeedback && lastReviewerSubTurn.reviewFeedback.length > 0) {
      const feedbackPreview = lastReviewerSubTurn.reviewFeedback.slice(0, 3).join('; ')
      parts.push(`反馈: ${feedbackPreview}`)
    }

    return parts.join(' | ')
  }

  /**
   * 创建旁路结果（对抗未启用时返回）
   */
  private createBypassResult(): AdversarialResult {
    return {
      passed: true,
      totalRounds: 0,
      finalVerdict: 'approved',
      qualityScore: 1.0,  // 未执行对抗不影响信心分
      summary: '对抗未启用，跳过',
    }
  }

  /**
   * 创建失败结果
   */
  private createFailResult(error: string): AdversarialResult {
    return {
      passed: false,
      totalRounds: 0,
      finalVerdict: 'conditional',
      qualityScore: 0.5,  // 失败时返回中性值，不过度惩罚
      summary: `对抗执行失败: ${error}`,
    }
  }

  // ═══════════════ 配置解析 ═══════════════

  /**
   * 解析节点的对抗配置（合并默认值）
   */
  private resolveConfig(node: TaskNode): Required<Omit<AdversarialConfig, 'reviewerRoleStatement' | 'testerRoleStatement'>> & Partial<Pick<AdversarialConfig, 'reviewerRoleStatement' | 'testerRoleStatement'>> {
    const nodeConfig = node.adversarial
    if (!nodeConfig || !nodeConfig.enabled) {
      return { ...DEFAULT_ADVERSARIAL_CONFIG }
    }

    return {
      enabled: nodeConfig.enabled,
      strategy: nodeConfig.strategy || DEFAULT_ADVERSARIAL_CONFIG.strategy,
      maxRounds: nodeConfig.maxRounds || DEFAULT_ADVERSARIAL_CONFIG.maxRounds,
      requireAutoFlowAfterPass: nodeConfig.requireAutoFlowAfterPass ?? DEFAULT_ADVERSARIAL_CONFIG.requireAutoFlowAfterPass,
      reviewerRoleStatement: nodeConfig.reviewerRoleStatement,
      testerRoleStatement: nodeConfig.testerRoleStatement,
    }
  }

  // ═══════════════ 缓存管理 ═══════════════

  /**
   * 缓存对抗结果
   */
  private cacheResult(runId: string, nodeId: string, result: AdversarialResult): void {
    const key = `${runId}:${nodeId}`
    if (this.resultCache.size >= AdversarialTurnService.MAX_CACHE_SIZE) {
      const firstKey = this.resultCache.keys().next().value
      if (firstKey) this.resultCache.delete(firstKey)
    }
    this.resultCache.set(key, result)
  }

  // ═══════════════ 审计 ═══════════════

  private audit(action: string, details: Record<string, unknown>, level: 'info' | 'error' = 'info'): void {
    if (this.robustnessService) {
      this.robustnessService.audit(action, details, level)
    }
  }

  // ═══════════════ 清理 ═══════════════

  /**
   * 清理 Run 相关的所有会话数据
   */
  cleanupRun(runId: string): void {
    for (const [id, session] of this.sessions) {
      if (session.runId === runId) {
        this.sessions.delete(id)
      }
    }
    // 清理结果缓存中该 Run 的条目
    for (const key of this.resultCache.keys()) {
      if (key.startsWith(`${runId}:`)) {
        this.resultCache.delete(key)
      }
    }
  }

  /**
   * 获取统计信息（供 WeeklyDigest 使用）
   */
  getStats(): {
    totalSessions: number
    activeSessions: number
    passRate: number
    avgRounds: number
    avgQualityScore: number
  } {
    const all = Array.from(this.sessions.values())
    const completed = all.filter(s => s.status === 'completed' || s.status === 'max_rounds_exceeded')
    const passed = completed.filter(s => s.result?.passed)

    const avgRounds = completed.length > 0
      ? completed.reduce((sum, s) => sum + (s.result?.totalRounds || 0), 0) / completed.length
      : 0

    const avgQuality = completed.length > 0
      ? completed.reduce((sum, s) => sum + (s.result?.qualityScore || 0), 0) / completed.length
      : 0

    return {
      totalSessions: all.length,
      activeSessions: all.filter(s => s.status === 'active').length,
      passRate: completed.length > 0 ? passed.length / completed.length : 0,
      avgRounds: Math.round(avgRounds * 10) / 10,
      avgQualityScore: Math.round(avgQuality * 100) / 100,
    }
  }
}
