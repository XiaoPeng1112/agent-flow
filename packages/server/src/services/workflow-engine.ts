import { randomUUID } from 'crypto'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import type {
  Run, TaskNode, TaskNodeStatus, DAGEdge,
  AgentTurn, TurnResult, Artifact,
  WorkflowTemplate, InboxItem,
  WsMessage, NodeContext, PredecessorOutput,
} from '../types/index.js'

type EventHandler = (message: WsMessage) => void

/**
 * WorkflowEngine — 核心编排引擎
 * 
 * 参考 MAF 的三层状态机设计：
 * 1. Run 级：管理整个工作流实例的生命周期
 * 2. TaskNode 级：管理 DAG 节点状态流转
 * 3. AgentTurn 级：管理 Agent 单次调用的生命周期
 * 
 * 职责：
 * - DAG 拓扑排序与依赖解析
 * - 节点状态自动流转（前置节点完成 → 后续节点 ready）
 * - Agent Turn 生命周期管理
 * - Inbox 消息队列
 * - 产出物管理
 * - 持久化与事件广播
 */
export class WorkflowEngine {
  private runs: Map<string, Run> = new Map()
  private turns: Map<string, AgentTurn[]> = new Map()  // nodeId → turns
  private inbox: Map<string, InboxItem[]> = new Map()  // agentId → items
  private eventHandlers: Set<EventHandler> = new Set()
  private storagePath: string

  constructor() {
    const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
    this.storagePath = join(home, '.agent-flow', 'runs')
  }

  // ═══════════════ 初始化 ═══════════════

  async load(): Promise<void> {
    try {
      const indexPath = join(this.storagePath, 'index.json')
      const raw = await readFile(indexPath, 'utf-8')
      const data = JSON.parse(raw) as { runs: Run[]; turns: Record<string, AgentTurn[]> }
      for (const run of data.runs) {
        this.runs.set(run.id, run)
      }
      if (data.turns) {
        for (const [nodeId, nodeTurns] of Object.entries(data.turns)) {
          this.turns.set(nodeId, nodeTurns)
        }
      }
    } catch {
      // 首次启动，无数据
    }
    // 启动时自动重置孤儿 running 节点（服务器重启后进程已丢失）
    await this.resetOrphanRunningNodes()
  }

  /**
   * 重置孤儿 running 节点
   * 服务器重启后，之前 running 状态的节点对应的 agent 进程已丢失，
   * 需要将它们重置为 pending 状态，避免永远卡在 running
   */
  private async resetOrphanRunningNodes(): Promise<void> {
    let resetCount = 0
    for (const run of this.runs.values()) {
      if (run.status !== 'running') continue
      for (const node of run.nodes) {
        if (node.status === 'running') {
          node.status = 'pending'
          // 将节点对应的 running turns 标记为 error
          const nodeTurns = this.turns.get(node.id)
          if (nodeTurns) {
            for (const turn of nodeTurns) {
              if (turn.status === 'running') {
                turn.status = 'error'
                turn.result = 'failed'
                turn.completedAt = Date.now()
                turn.output += '\n[系统] 服务器重启，Agent 进程已丢失，请重新执行'
              }
            }
          }
          resetCount++
        }
      }
    }
    if (resetCount > 0) {
      console.log(`[WorkflowEngine] Reset ${resetCount} orphan running node(s) on startup`)
      await this.persist()
    }
  }

  private async persist(): Promise<void> {
    await mkdir(this.storagePath, { recursive: true })
    const data = {
      runs: Array.from(this.runs.values()),
      turns: Object.fromEntries(this.turns.entries()),
    }
    await writeFile(
      join(this.storagePath, 'index.json'),
      JSON.stringify(data, null, 2),
      'utf-8'
    )
  }

  // ═══════════════ 事件系统 ═══════════════

  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.add(handler)
    return () => this.eventHandlers.delete(handler)
  }

  private emit(type: WsMessage['type'], payload: unknown): void {
    const msg: WsMessage = { type, payload, timestamp: Date.now() }
    for (const handler of this.eventHandlers) {
      handler(msg)
    }
  }

  // ═══════════════ Run 管理 ═══════════════

  /**
   * 从模板创建 Run 实例
   */
  async createRun(projectId: string, template: WorkflowTemplate, name?: string): Promise<Run> {
    const runId = `run_${randomUUID().slice(0, 8)}`

    // 将模板节点转化为运行时 TaskNode
    const nodes: TaskNode[] = template.nodes.map((tplNode, idx) => ({
      id: `${runId}_${tplNode.id}`,
      runId,
      name: tplNode.name,
      type: tplNode.type,
      description: tplNode.description,
      status: 'pending' as TaskNodeStatus,
      agentRole: tplNode.agentRole,
      skillIds: tplNode.skillIds,
      artifacts: [],
      prompt: tplNode.prompt,
      order: idx,
    }))

    // 映射模板边到运行时 ID
    const edges: DAGEdge[] = template.edges.map((e) => ({
      source: `${runId}_${e.source}`,
      target: `${runId}_${e.target}`,
    }))

    const run: Run = {
      id: runId,
      projectId,
      templateId: template.id,
      name: name || `${template.name} - ${new Date().toLocaleString('zh-CN')}`,
      status: 'created',
      nodes,
      edges,
      createdAt: Date.now(),
    }

    this.runs.set(runId, run)

    // 计算初始 ready 节点（无前置依赖的节点）
    this.computeReadyNodes(run)

    await this.persist()
    return run
  }

  /**
   * 启动 Run
   */
  async startRun(runId: string): Promise<Run> {
    const run = this.getRun(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)
    if (run.status !== 'created') throw new Error(`Run ${runId} is not in 'created' state`)

    run.status = 'running'
    run.startedAt = Date.now()

    this.emit('run:status_changed', { runId, status: run.status })
    await this.persist()
    return run
  }

  /**
   * 暂停 Run
   * 暂停后不再推进新节点（computeReadyNodes 会跳过 paused 状态的 Run），
   * 已在 running 的节点会继续执行完当前 Turn，但后续不再调度新的 ready 节点。
   */
  async pauseRun(runId: string): Promise<Run> {
    const run = this.getRun(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)
    if (run.status !== 'running') throw new Error(`Run ${runId} is not in 'running' state (current: ${run.status})`)

    run.status = 'paused'
    this.emit('run:status_changed', { runId, status: run.status })
    await this.persist()
    return run
  }

  /**
   * 恢复 Run
   * 恢复后重新计算 ready 节点，允许继续推进
   */
  async resumeRun(runId: string): Promise<Run> {
    const run = this.getRun(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)
    if (run.status !== 'paused') throw new Error(`Run ${runId} is not in 'paused' state (current: ${run.status})`)

    run.status = 'running'
    // 重新计算 ready 节点（暂停期间可能有节点完成了）
    this.computeReadyNodes(run)
    this.checkRunCompletion(run)

    this.emit('run:status_changed', { runId, status: run.status })
    await this.persist()
    return run
  }

  /**
   * 获取所有 Runs
   */
  getRuns(projectId?: string): Run[] {
    const all = Array.from(this.runs.values())
    if (projectId) return all.filter((r) => r.projectId === projectId)
    return all
  }

  /**
   * 获取单个 Run
   */
  getRun(runId: string): Run | undefined {
    return this.runs.get(runId)
  }

  /**
   * 删除 Run
   */
  async deleteRun(runId: string): Promise<boolean> {
    const deleted = this.runs.delete(runId)
    if (deleted) await this.persist()
    return deleted
  }

  // ═══════════════ TaskNode 状态机 ═══════════════

  /**
   * 计算并设置 ready 节点
   * 规则：如果一个节点的所有前置节点都已 completed，则标记为 ready
   * 同时自动构建 Context Chaining —— 将前置节点的产出物注入到后续节点
   * 注意：如果 Run 处于 paused 状态，不推进新节点为 ready
   */
  private computeReadyNodes(run: Run): void {
    if (run.status === 'paused') return  // 暂停时不推进

    for (const node of run.nodes) {
      if (node.status !== 'pending') continue

      // 找到所有指向该节点的边
      const incomingEdges = run.edges.filter((e) => e.target === node.id)

      if (incomingEdges.length === 0) {
        // 无前置依赖，直接 ready
        node.status = 'ready'
        this.emit('run:node_updated', { runId: run.id, nodeId: node.id, status: node.status })
      } else {
        // 过滤满足条件的边（条件分支支持）
        const activeEdges = incomingEdges.filter(edge => this.evaluateEdgeCondition(run, edge))
        
        if (activeEdges.length === 0 && incomingEdges.some(e => e.condition)) {
          // 所有边都有条件但都不满足 → 跳过该节点
          node.status = 'skipped'
          this.emit('run:node_updated', { runId: run.id, nodeId: node.id, status: node.status })
          continue
        }

        // 检查所有有效前置节点是否已完成
        const edgesToCheck = activeEdges.length > 0 ? activeEdges : incomingEdges
        const allPredecessorsCompleted = edgesToCheck.every((edge) => {
          const sourceNode = run.nodes.find((n) => n.id === edge.source)
          return sourceNode?.status === 'completed' || sourceNode?.status === 'skipped'
        })
        if (allPredecessorsCompleted) {
          node.status = 'ready'
          // Context Chaining: 自动聚合前置节点的产出物到当前节点上下文
          node.context = this.buildNodeContext(run, node, edgesToCheck)
          this.emit('run:node_updated', { runId: run.id, nodeId: node.id, status: node.status })
        }
      }
    }
  }

  /**
   * 评估边条件是否满足
   * 无条件的边始终满足
   */
  private evaluateEdgeCondition(run: Run, edge: DAGEdge): boolean {
    if (!edge.condition) return true  // 无条件 → 始终通过

    const sourceNode = run.nodes.find(n => n.id === edge.source)
    if (!sourceNode) return false

    switch (edge.condition.type) {
      case 'status':
        // 源节点的最终状态需要匹配
        return sourceNode.status === edge.condition.value
      
      case 'output_contains': {
        // 源节点的 turn 输出包含特定内容
        const nodeTurns = this.turns.get(sourceNode.id) || []
        const lastTurn = [...nodeTurns].reverse().find(t => t.status === 'completed')
        return lastTurn?.output?.includes(edge.condition.value) ?? false
      }
      
      case 'expression':
        // 预留：简单表达式评估（后续可扩展为 JSONPath / CEL）
        return true

      default:
        return true
    }
  }

  /**
   * 构建节点上下文（Context Chaining）
   * 聚合所有前置节点的 Turn 输出和产出物，供后续节点消费
   */
  private buildNodeContext(run: Run, _node: TaskNode, incomingEdges: DAGEdge[]): NodeContext {
    const predecessorOutputs: PredecessorOutput[] = []

    for (const edge of incomingEdges) {
      const sourceNode = run.nodes.find(n => n.id === edge.source)
      if (!sourceNode || sourceNode.status === 'skipped') continue

      // 获取前置节点最后一个 turn 的输出作为摘要
      const nodeTurns = this.turns.get(sourceNode.id) || []
      const lastCompletedTurn = [...nodeTurns].reverse().find(t => t.status === 'completed')
      const summary = lastCompletedTurn?.output
        ? (lastCompletedTurn.output.length > 2000
          ? lastCompletedTurn.output.slice(0, 2000) + '\n...[truncated]'
          : lastCompletedTurn.output)
        : ''

      predecessorOutputs.push({
        nodeId: sourceNode.id,
        nodeName: sourceNode.name,
        nodeType: sourceNode.type,
        summary,
        artifacts: sourceNode.artifacts || [],
      })
    }

    return { predecessorOutputs }
  }

  /**
   * 启动节点（ready → running）
   */
  async startNode(runId: string, nodeId: string): Promise<TaskNode> {
    const run = this.getRun(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)

    const node = run.nodes.find((n) => n.id === nodeId)
    if (!node) throw new Error(`Node not found: ${nodeId}`)
    if (node.status !== 'ready') throw new Error(`Node ${nodeId} is not ready (current: ${node.status})`)

    node.status = 'running'
    node.startedAt = Date.now()

    // 确保 Run 是 running 状态
    if (run.status === 'created') {
      run.status = 'running'
      run.startedAt = Date.now()
    }

    this.emit('run:node_updated', { runId, nodeId, status: node.status })
    await this.persist()
    return node
  }

  /**
   * Agent 提交节点决策（running → wait_user_review 或 completed）
   * 参考 MAF: Agent 通过 maf workflow node submit 提交
   */
  async submitNodeDecision(
    runId: string,
    nodeId: string,
    decision: 'waiting_user_review' | 'completed' | 'failed',
    error?: string
  ): Promise<TaskNode> {
    const run = this.getRun(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)

    const node = run.nodes.find((n) => n.id === nodeId)
    if (!node) throw new Error(`Node not found: ${nodeId}`)
    if (node.status !== 'running') throw new Error(`Node ${nodeId} is not running`)

    switch (decision) {
      case 'waiting_user_review':
        node.status = 'wait_user_review'
        break
      case 'completed':
        node.status = 'completed'
        node.completedAt = Date.now()
        // 触发后续节点 ready 计算
        this.computeReadyNodes(run)
        // 检查整个 Run 是否完成
        this.checkRunCompletion(run)
        break
      case 'failed':
        node.status = 'failed'
        node.error = error
        node.completedAt = Date.now()
        break
    }

    this.emit('run:node_updated', { runId, nodeId, status: node.status })
    await this.persist()
    return node
  }

  /**
  * 用户确认节点（wait_user_review → completed）
  * @param feedback 可选的修改意见，会附加到节点 artifacts 中传递给后续节点
  */
  async approveNode(runId: string, nodeId: string, feedback?: string): Promise<TaskNode> {
    const run = this.getRun(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)

    const node = run.nodes.find((n) => n.id === nodeId)
    if (!node) throw new Error(`Node not found: ${nodeId}`)
    if (node.status !== 'wait_user_review') throw new Error(`Node ${nodeId} is not waiting for review`)

    // 如果用户提供了修改意见，附加到 artifacts 中供后续节点 Context Chaining 消费
    if (feedback && feedback.trim()) {
      node.artifacts.push({
        id: `feedback-${Date.now()}`,
        nodeId,
        title: '用户修改意见',
        category: 'document',
        format: 'markdown',
        content: feedback.trim(),
        createdAt: Date.now(),
      })
    }

    node.status = 'completed'
    node.completedAt = Date.now()

    // 触发后续节点
    this.computeReadyNodes(run)
    this.checkRunCompletion(run)

    this.emit('run:node_updated', { runId, nodeId, status: node.status })
    await this.persist()
    return node
  }

  /**
   * 用户要求重做节点（wait_user_review → running，回到上一次 turn）
   */
  async rejectNode(runId: string, nodeId: string, feedback?: string): Promise<TaskNode> {
    const run = this.getRun(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)

    const node = run.nodes.find((n) => n.id === nodeId)
    if (!node) throw new Error(`Node not found: ${nodeId}`)
    if (node.status !== 'wait_user_review') throw new Error(`Node ${nodeId} is not waiting for review`)

    node.status = 'running'
    if (feedback) {
      node.userInput = feedback
    }

    this.emit('run:node_updated', { runId, nodeId, status: node.status })
    await this.persist()
    return node
  }

  /**
   * 跳过节点
   */
  async skipNode(runId: string, nodeId: string): Promise<TaskNode> {
    const run = this.getRun(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)

    const node = run.nodes.find((n) => n.id === nodeId)
    if (!node) throw new Error(`Node not found: ${nodeId}`)

    node.status = 'skipped'
    node.completedAt = Date.now()

    this.computeReadyNodes(run)
    this.checkRunCompletion(run)

    this.emit('run:node_updated', { runId, nodeId, status: node.status })
    await this.persist()
    return node
  }

  /**
   * 强制重置节点（running/failed → ready）
   * 用于卡住的节点（进程已死但状态未更新）
   */
  async forceResetNode(runId: string, nodeId: string): Promise<TaskNode> {
    const run = this.getRun(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)

    const node = run.nodes.find((n) => n.id === nodeId)
    if (!node) throw new Error(`Node not found: ${nodeId}`)

    // 只允许从 running/failed 状态重置
    if (node.status !== 'running' && node.status !== 'failed') {
      throw new Error(`Node ${nodeId} is not in running/failed state (current: ${node.status})`)
    }

    node.status = 'ready'
    node.startedAt = undefined
    node.completedAt = undefined
    node.error = undefined

    this.emit('run:node_updated', { runId, nodeId, status: node.status })
    await this.persist()
    return node
  }

  /**
   * 回滚节点（任何状态 → pending，后续节点全部重置）
   */
  async rollbackNode(runId: string, nodeId: string): Promise<void> {
    const run = this.getRun(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)

    const node = run.nodes.find((n) => n.id === nodeId)
    if (!node) throw new Error(`Node not found: ${nodeId}`)

    // 重置当前节点
    node.status = 'pending'
    node.startedAt = undefined
    node.completedAt = undefined
    node.error = undefined
    node.artifacts = []

    // 重置所有后续节点
    const downstream = this.getDownstreamNodes(run, nodeId)
    for (const dn of downstream) {
      dn.status = 'pending'
      dn.startedAt = undefined
      dn.completedAt = undefined
      dn.error = undefined
      dn.artifacts = []
    }

    // 重新计算 ready 节点
    this.computeReadyNodes(run)

    // 如果 Run 已完成/失败，恢复为 running
    if (run.status === 'completed' || run.status === 'failed') {
      run.status = 'running'
    }

    this.emit('run:status_changed', { runId, status: run.status })
    await this.persist()
  }

  /**
   * 检查 Run 是否全部完成
   */
  private checkRunCompletion(run: Run): void {
    const allDone = run.nodes.every(
      (n) => n.status === 'completed' || n.status === 'skipped'
    )
    if (allDone) {
      run.status = 'completed'
      run.completedAt = Date.now()
      this.emit('run:status_changed', { runId: run.id, status: run.status })
    }
  }

  /**
   * 获取 Run 中所有 ready 状态的节点（可并行执行）
   */
  getReadyNodes(runId: string): TaskNode[] {
    const run = this.getRun(runId)
    if (!run) return []
    return run.nodes.filter(n => n.status === 'ready')
  }

  /**
   * 获取 Run 的配置
   */
  getRunConfig(runId: string): import('../types/index.js').RunConfig | undefined {
    return this.getRun(runId)?.config
  }

  /**
   * 更新 Run 配置
   */
  async updateRunConfig(runId: string, config: import('../types/index.js').RunConfig): Promise<void> {
    const run = this.getRun(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)
    run.config = { ...run.config, ...config }
    await this.persist()
  }

  /**
   * 获取下游节点（BFS）
   */
  private getDownstreamNodes(run: Run, nodeId: string): TaskNode[] {
    const result: TaskNode[] = []
    const visited = new Set<string>()
    const queue = [nodeId]

    while (queue.length > 0) {
      const current = queue.shift()!
      const outEdges = run.edges.filter((e) => e.source === current)

      for (const edge of outEdges) {
        if (!visited.has(edge.target)) {
          visited.add(edge.target)
          const targetNode = run.nodes.find((n) => n.id === edge.target)
          if (targetNode) {
            result.push(targetNode)
            queue.push(edge.target)
          }
        }
      }
    }
    return result
  }

  // ═══════════════ AgentTurn 管理 ═══════════════

  /**
   * 启动一个新的 Agent Turn（参考 MAF Phase 1: StartAgentTurn）
   */
  startTurn(nodeId: string, runId: string, agentId: string, prompt: string): AgentTurn {
    // Note: persist is fire-and-forget here to keep turn start synchronous
    const existingTurns = this.turns.get(nodeId) || []

    const turn: AgentTurn = {
      id: `turn_${randomUUID().slice(0, 8)}`,
      nodeId,
      runId,
      agentId,
      turnIndex: existingTurns.length,
      status: 'running',
      prompt,
      output: '',
      startedAt: Date.now(),
    }

    existingTurns.push(turn)
    this.turns.set(nodeId, existingTurns)

    this.emit('agent:turn_started', { turn })
    this.persist()  // fire-and-forget for performance
    return turn
  }

  /**
   * 记录 Turn 输出（流式追加）
   */
  appendTurnOutput(turnId: string, nodeId: string, chunk: string): void {
    const turns = this.turns.get(nodeId)
    if (!turns) return

    const turn = turns.find((t) => t.id === turnId)
    if (!turn) return

    turn.output += chunk
    this.emit('agent:turn_output', { turnId, nodeId, chunk })
  }

  /**
   * 记录 Turn 结果（参考 MAF Phase 2: RecordAgentTurnResult）
   */
  recordTurnResult(
    turnId: string,
    nodeId: string,
    result: TurnResult,
    question?: string,
    tokenUsage?: { input: number; output: number; total: number }
  ): AgentTurn {
    const turns = this.turns.get(nodeId)
    if (!turns) throw new Error(`No turns for node: ${nodeId}`)

    const turn = turns.find((t) => t.id === turnId)
    if (!turn) throw new Error(`Turn not found: ${turnId}`)
    if (turn.status !== 'running') throw new Error(`Turn ${turnId} is not running`)

    turn.result = result
    if (question) turn.question = question
    if (tokenUsage) turn.tokenUsage = tokenUsage

    return turn
  }

  /**
   * 完成 Turn（参考 MAF Phase 3+4: FinalizeAgentTurn + Commit）
   */
  finalizeTurn(turnId: string, nodeId: string): AgentTurn {
    const turns = this.turns.get(nodeId)
    if (!turns) throw new Error(`No turns for node: ${nodeId}`)

    const turn = turns.find((t) => t.id === turnId)
    if (!turn) throw new Error(`Turn not found: ${turnId}`)

    switch (turn.result) {
      case 'succeeded':
        turn.status = 'completed'
        turn.completedAt = Date.now()
        this.emit('agent:turn_completed', { turn })
        break
      case 'failed':
        turn.status = 'error'
        turn.completedAt = Date.now()
        this.emit('agent:turn_error', { turn })
        break
      case 'paused_for_question':
        turn.status = 'paused'
        this.emit('agent:turn_paused', { turn, question: turn.question })
        break
      default:
        // 兜底：未提交 result 的默认按 succeeded 处理
        turn.status = 'completed'
        turn.result = 'succeeded'
        turn.completedAt = Date.now()
        this.emit('agent:turn_completed', { turn })
    }

    this.persist()  // fire-and-forget for performance
    return turn
  }

  /**
   * 获取节点的所有 Turns
   */
  getNodeTurns(nodeId: string): AgentTurn[] {
    return this.turns.get(nodeId) || []
  }

  /**
   * 获取当前活跃的 Turn
   */
  getActiveTurn(nodeId: string): AgentTurn | undefined {
    const turns = this.turns.get(nodeId) || []
    return turns.find((t) => t.status === 'running' || t.status === 'paused')
  }

  // ═══════════════ Artifact 管理 ═══════════════

  /**
   * 添加产出物到节点
   */
  async addArtifact(runId: string, nodeId: string, artifact: Omit<Artifact, 'id' | 'nodeId' | 'createdAt'>): Promise<Artifact> {
    const run = this.getRun(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)

    const node = run.nodes.find((n) => n.id === nodeId)
    if (!node) throw new Error(`Node not found: ${nodeId}`)

    const full: Artifact = {
      ...artifact,
      nodeId,
      id: `art_${randomUUID().slice(0, 8)}`,
      createdAt: Date.now(),
    }
    node.artifacts.push(full)

    await this.persist()
    return full
  }

  /**
   * 获取节点的产出物（供后续节点消费）
   */
  getNodeArtifacts(runId: string, nodeId: string): Artifact[] {
    const run = this.getRun(runId)
    if (!run) return []

    const node = run.nodes.find((n) => n.id === nodeId)
    return node?.artifacts || []
  }

  /**
   * 获取 Run 所有已完成节点的产出物索引
   */
  getRunArtifactIndex(runId: string): { nodeId: string; nodeName: string; artifacts: Artifact[] }[] {
    const run = this.getRun(runId)
    if (!run) return []

    return run.nodes
      .filter((n) => n.status === 'completed' && n.artifacts.length > 0)
      .map((n) => ({
        nodeId: n.id,
        nodeName: n.name,
        artifacts: n.artifacts,
      }))
  }

  // ═══════════════ Inbox 机制 ═══════════════

  /**
   * 入队 inbox 消息
   */
  enqueueInbox(item: Omit<InboxItem, 'id' | 'createdAt' | 'status'>): InboxItem {
    const full: InboxItem = {
      ...item,
      id: `inbox_${randomUUID().slice(0, 8)}`,
      status: 'queued',
      createdAt: Date.now(),
    }

    const queue = this.inbox.get(item.agentId) || []
    queue.push(full)
    this.inbox.set(item.agentId, queue)

    return full
  }

  /**
   * 获取 Agent 的 inbox 队列
   */
  getInbox(agentId: string): InboxItem[] {
    return this.inbox.get(agentId) || []
  }

  /**
   * 解决 inbox 项
   */
  resolveInboxItem(agentId: string, itemId: string): void {
    const queue = this.inbox.get(agentId)
    if (!queue) return

    const item = queue.find((i) => i.id === itemId)
    if (item) {
      item.status = 'resolved'
      item.resolvedAt = Date.now()
    }
  }

  // ═══════════════ Token 消耗统计 ═══════════════

  /**
   * 获取 Run 级别的 Token 消耗统计
   * 聚合所有节点下所有 Turn 的 tokenUsage
   */
  getRunTokenStats(runId: string): {
    totalInput: number
    totalOutput: number
    totalTokens: number
    byNode: Array<{ nodeId: string; nodeName: string; input: number; output: number; total: number; turnCount: number }>
    estimatedCost?: { usd: number; breakdown: string }
  } {
    const run = this.getRun(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)

    let totalInput = 0
    let totalOutput = 0
    let totalTokens = 0
    const byNode: Array<{ nodeId: string; nodeName: string; input: number; output: number; total: number; turnCount: number }> = []

    for (const node of run.nodes) {
      const nodeTurns = this.turns.get(node.id) || []
      let nodeInput = 0
      let nodeOutput = 0
      let nodeTotal = 0
      let turnCount = 0

      for (const turn of nodeTurns) {
        if (turn.tokenUsage) {
          nodeInput += turn.tokenUsage.input
          nodeOutput += turn.tokenUsage.output
          nodeTotal += turn.tokenUsage.total
          turnCount++
        }
      }

      if (turnCount > 0) {
        byNode.push({
          nodeId: node.id,
          nodeName: node.name,
          input: nodeInput,
          output: nodeOutput,
          total: nodeTotal,
          turnCount,
        })
      }

      totalInput += nodeInput
      totalOutput += nodeOutput
      totalTokens += nodeTotal
    }

    // 估算成本（基于 Claude Sonnet 定价估算：$3/M input, $15/M output）
    const inputCost = (totalInput / 1_000_000) * 3
    const outputCost = (totalOutput / 1_000_000) * 15
    const totalCost = inputCost + outputCost

    return {
      totalInput,
      totalOutput,
      totalTokens,
      byNode,
      estimatedCost: totalTokens > 0 ? {
        usd: Math.round(totalCost * 10000) / 10000,
        breakdown: `Input: $${inputCost.toFixed(4)} (${totalInput} tokens) + Output: $${outputCost.toFixed(4)} (${totalOutput} tokens)`,
      } : undefined,
    }
  }

  // ═══════════════ 辅助 ═══════════════

  /**
   * DAG 拓扑排序（用于确定执行顺序）
   */
  topologicalSort(run: Run): string[] {
    const inDegree = new Map<string, number>()
    const adjList = new Map<string, string[]>()

    for (const node of run.nodes) {
      inDegree.set(node.id, 0)
      adjList.set(node.id, [])
    }

    for (const edge of run.edges) {
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1)
      adjList.get(edge.source)?.push(edge.target)
    }

    const queue: string[] = []
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id)
    }

    const sorted: string[] = []
    while (queue.length > 0) {
      const curr = queue.shift()!
      sorted.push(curr)

      for (const neighbor of adjList.get(curr) || []) {
        const newDegree = (inDegree.get(neighbor) || 1) - 1
        inDegree.set(neighbor, newDegree)
        if (newDegree === 0) queue.push(neighbor)
      }
    }

    return sorted
  }
}
