import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { join } from 'path'
import type {
  Run, TaskNode, TaskNodeStatus, DAGEdge,
  AgentTurn, Artifact, WorkflowTemplate,
  InboxItem, WsMessage,
} from '../types/index.js'
import { StorageSQLite } from './storage-sqlite.js'
import type { ContextDBService } from './context-db.js'

type EventHandler = (message: WsMessage) => void

/**
 * RunManager — Run 生命周期管理
 *
 * 职责：
 * - Run CRUD（创建、查询、删除、导入）
 * - Run 状态机（created → running → paused → completed/failed）
 * - 节点状态操作（启动、提交决策、批准、拒绝、跳过、重置、回滚）
 * - Inbox 消息队列
 * - Artifact 产出物管理
 * - 持久化（SQLite + WAL，零额外服务）
 * - 事件广播
 *
 * 不负责：DAG 调度逻辑、Turn 管理
 * 需要外部注入 DAGScheduler 来执行 computeReadyNodes 等计算
 */
export class RunManager {
  private runs: Map<string, Run> = new Map()
  private inbox: Map<string, InboxItem[]> = new Map()
  private eventHandlers: Set<EventHandler> = new Set()
  private storage: StorageSQLite

  /** 外部注入的 DAG 调度器回调 */
  private dagScheduler!: {
    computeReadyNodes(run: Run): void
    getDownstreamNodes(run: Run, nodeId: string): TaskNode[]
    evaluateExitConditions(run: Run, node: TaskNode): { passed: boolean; failedReason?: string }
  }

  /** 外部注入的 TurnManager 引用（用于 orphan 清理） */
  private turnManager!: {
    getTurns(nodeId: string): AgentTurn[]
    setTurns(nodeId: string, turns: AgentTurn[]): void
    getAllTurnsMap(): Map<string, AgentTurn[]>
  }

  /** 外部注入的 ContextDBService（用于 L2 种子文件生成） */
  private contextDBService?: ContextDBService

  constructor() {
    this.storage = new StorageSQLite()
  }

  /**
   * 注入协作模块（避免循环依赖，由 Facade 负责注入）
   */
  inject(deps: {
    dagScheduler: RunManager['dagScheduler']
    turnManager: RunManager['turnManager']
  }): void {
    this.dagScheduler = deps.dagScheduler
    this.turnManager = deps.turnManager
  }

  /** 注入 ContextDBService（延迟注入） */
  injectContextDB(contextDBService: ContextDBService): void {
    this.contextDBService = contextDBService
  }

  // ═══════════════ 初始化 & 持久化 ═══════════════

  async load(): Promise<void> {
    // 首次启动：检测是否有旧版 JSON 数据需要迁移
    const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
    const legacyPath = join(home, '.agent-flow', 'runs', 'index.json')
    if (existsSync(legacyPath)) {
      const stats = this.storage.getStats()
      if (stats.runs === 0) {
        console.log('[RunManager] Detected legacy JSON data, migrating to SQLite...')
        const result = await this.storage.migrateFromJson(legacyPath)
        console.log(`[RunManager] Migration complete: ${result.runs} runs, ${result.turns} turns`)
      }
    }

    // 从 SQLite 加载到内存缓存
    const allRuns = this.storage.getAllRuns()
    for (const run of allRuns) {
      this.runs.set(run.id, run)
    }

    // 加载 Turn 数据到 TurnManager
    const allTurns = this.storage.getAllTurns()
    for (const [nodeId, nodeTurns] of allTurns) {
      this.turnManager.setTurns(nodeId, nodeTurns)
    }

    await this.resetOrphanRunningNodes()
  }

  /**
   * 重置孤儿 running 节点
   */
  private async resetOrphanRunningNodes(): Promise<void> {
    let resetCount = 0
    for (const run of this.runs.values()) {
      if (run.status !== 'running') continue
      for (const node of run.nodes) {
        if (node.status === 'running') {
          node.status = 'pending'
          const nodeTurns = this.turnManager.getTurns(node.id)
          for (const turn of nodeTurns) {
            if (turn.status === 'running') {
              turn.status = 'error'
              turn.result = 'failed'
              turn.completedAt = Date.now()
              turn.output += '\n[系统] 服务器重启，Agent 进程已丢失，请重新执行'
            }
          }
          resetCount++
        }
      }
    }
    if (resetCount > 0) {
      console.log(`[RunManager] Reset ${resetCount} orphan running node(s) on startup`)
      await this.persist()
    }
  }

  async persist(): Promise<void> {
    this.storage.saveAll(
      Array.from(this.runs.values()),
      this.turnManager.getAllTurnsMap()
    )
  }

  // ═══════════════ 事件系统 ═══════════════

  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.add(handler)
    return () => this.eventHandlers.delete(handler)
  }

  emit(type: WsMessage['type'], payload: unknown): void {
    const msg: WsMessage = { type, payload, timestamp: Date.now() }
    for (const handler of this.eventHandlers) {
      handler(msg)
    }
  }

  // ═══════════════ Run CRUD ═══════════════

  async createRun(projectId: string, template: WorkflowTemplate, name?: string): Promise<Run> {
    const runId = `run_${randomUUID().slice(0, 8)}`

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
      roleStatement: tplNode.roleStatement,
      inputs: tplNode.inputs,
      outputContracts: tplNode.outputContracts,
      entryConditions: tplNode.entryConditions,
      exitConditions: tplNode.exitConditions,
      order: idx,
      executionMode: tplNode.executionMode,
      script: tplNode.script,
      scriptCwd: tplNode.scriptCwd,
    }))

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
    this.dagScheduler.computeReadyNodes(run)
    await this.persist()

    // 为每个节点生成 L2 种子文件（根据节点模板信息动态生成对应内容）
    if (this.contextDBService) {
      try {
        await this.contextDBService.seedL2ForRun(nodes.map(n => ({
          id: n.id,
          name: n.name,
          type: n.type,
          description: n.description,
          agentRole: n.agentRole,
          roleStatement: n.roleStatement,
          inputs: n.inputs,
          outputContracts: n.outputContracts,
          exitConditions: n.exitConditions,
        })))
      } catch (err) {
        console.warn(`[RunManager] Failed to seed L2 context for run ${runId}:`, (err as Error).message)
      }
    }

    return run
  }

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

  async pauseRun(runId: string): Promise<Run> {
    const run = this.getRun(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)
    if (run.status !== 'running') throw new Error(`Run ${runId} is not in 'running' state (current: ${run.status})`)

    run.status = 'paused'
    this.emit('run:status_changed', { runId, status: run.status })
    await this.persist()
    return run
  }

  async resumeRun(runId: string): Promise<Run> {
    const run = this.getRun(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)
    if (run.status !== 'paused') throw new Error(`Run ${runId} is not in 'paused' state (current: ${run.status})`)

    run.status = 'running'
    this.dagScheduler.computeReadyNodes(run)
    this.checkRunCompletion(run)

    this.emit('run:status_changed', { runId, status: run.status })
    await this.persist()
    return run
  }

  getRuns(projectId?: string): Run[] {
    const all = Array.from(this.runs.values())
    if (projectId) return all.filter((r) => r.projectId === projectId)
    return all
  }

  getRun(runId: string): Run | undefined {
    return this.runs.get(runId)
  }

  async deleteRun(runId: string): Promise<boolean> {
    const deleted = this.runs.delete(runId)
    if (deleted) await this.persist()
    return deleted
  }

  async importRun(runData: Run, turnsData?: Record<string, AgentTurn[]>): Promise<void> {
    this.runs.set(runData.id, runData)
    if (turnsData) {
      for (const [nodeId, nodeTurns] of Object.entries(turnsData)) {
        this.turnManager.setTurns(nodeId, nodeTurns)
      }
    }
    await this.persist()
  }

  getRunTurns(runId: string): Record<string, AgentTurn[]> {
    const run = this.runs.get(runId)
    if (!run) return {}
    const result: Record<string, AgentTurn[]> = {}
    for (const node of run.nodes) {
      const nodeTurns = this.turnManager.getTurns(node.id)
      if (nodeTurns.length > 0) {
        result[node.id] = nodeTurns
      }
    }
    return result
  }

  // ═══════════════ Node 状态机 ═══════════════

  async startNode(runId: string, nodeId: string): Promise<TaskNode> {
    const run = this.getRun(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)

    const node = run.nodes.find((n) => n.id === nodeId)
    if (!node) throw new Error(`Node not found: ${nodeId}`)
    if (node.status !== 'ready') throw new Error(`Node ${nodeId} is not ready (current: ${node.status})`)

    node.status = 'running'
    node.startedAt = Date.now()

    if (run.status === 'created') {
      run.status = 'running'
      run.startedAt = Date.now()
    }

    this.emit('run:node_updated', { runId, nodeId, status: node.status })
    await this.persist()
    return node
  }

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
      case 'completed': {
        // 准出条件验证：如果定义了 exitConditions，必须全部满足才能标记为 completed
        if (node.exitConditions && node.exitConditions.length > 0) {
          const exitResult = this.dagScheduler.evaluateExitConditions(run, node)
          if (!exitResult.passed) {
            // 准出条件不满足：不标记为完成，而是保持 running 并记录警告
            node.error = `准出条件未满足: ${exitResult.failedReason}`
            this.emit('run:node_updated', { runId, nodeId, status: node.status, warning: exitResult.failedReason })
            await this.persist()
            return node
          }
        }
        node.status = 'completed'
        node.completedAt = Date.now()
        this.dagScheduler.computeReadyNodes(run)
        this.checkRunCompletion(run)
        break
      }
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

  async approveNode(runId: string, nodeId: string, feedback?: string): Promise<TaskNode> {
    const run = this.getRun(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)

    const node = run.nodes.find((n) => n.id === nodeId)
    if (!node) throw new Error(`Node not found: ${nodeId}`)
    if (node.status !== 'wait_user_review') throw new Error(`Node ${nodeId} is not waiting for review`)

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

    this.dagScheduler.computeReadyNodes(run)
    this.checkRunCompletion(run)

    this.emit('run:node_updated', { runId, nodeId, status: node.status })
    await this.persist()
    return node
  }

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

  async skipNode(runId: string, nodeId: string): Promise<TaskNode> {
    const run = this.getRun(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)

    const node = run.nodes.find((n) => n.id === nodeId)
    if (!node) throw new Error(`Node not found: ${nodeId}`)

    node.status = 'skipped'
    node.completedAt = Date.now()

    this.dagScheduler.computeReadyNodes(run)
    this.checkRunCompletion(run)

    this.emit('run:node_updated', { runId, nodeId, status: node.status })
    await this.persist()
    return node
  }

  async forceResetNode(runId: string, nodeId: string): Promise<TaskNode> {
    const run = this.getRun(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)

    const node = run.nodes.find((n) => n.id === nodeId)
    if (!node) throw new Error(`Node not found: ${nodeId}`)

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

  async rollbackNode(runId: string, nodeId: string): Promise<void> {
    const run = this.getRun(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)

    const node = run.nodes.find((n) => n.id === nodeId)
    if (!node) throw new Error(`Node not found: ${nodeId}`)

    node.status = 'pending'
    node.startedAt = undefined
    node.completedAt = undefined
    node.error = undefined
    node.artifacts = []

    const downstream = this.dagScheduler.getDownstreamNodes(run, nodeId)
    for (const dn of downstream) {
      dn.status = 'pending'
      dn.startedAt = undefined
      dn.completedAt = undefined
      dn.error = undefined
      dn.artifacts = []
    }

    this.dagScheduler.computeReadyNodes(run)

    if (run.status === 'completed' || run.status === 'failed') {
      run.status = 'running'
    }

    this.emit('run:status_changed', { runId, status: run.status })
    await this.persist()
  }

  /**
   * 从 Checkpoint 恢复
   */
  async restoreFromCheckpoint(runId: string, nodeStates: Array<{ nodeId: string; status: TaskNodeStatus }>): Promise<void> {
    const run = this.getRun(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)

    for (const { nodeId, status } of nodeStates) {
      const node = run.nodes.find(n => n.id === nodeId)
      if (node) {
        node.status = status
        if (status === 'pending' || status === 'ready') {
          node.startedAt = undefined
          node.completedAt = undefined
          node.error = undefined
        }
      }
    }

    if (run.status === 'completed' || run.status === 'failed') {
      run.status = 'running'
      run.completedAt = undefined
    }

    this.dagScheduler.computeReadyNodes(run)
    this.emit('run:status_changed', { runId, status: run.status })
    await this.persist()
  }

  getReadyNodes(runId: string): TaskNode[] {
    const run = this.getRun(runId)
    if (!run) return []
    return run.nodes.filter(n => n.status === 'ready')
  }

  getRunConfig(runId: string): import('../types/index.js').RunConfig | undefined {
    return this.getRun(runId)?.config
  }

  async updateRunConfig(runId: string, config: import('../types/index.js').RunConfig): Promise<void> {
    const run = this.getRun(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)
    run.config = { ...run.config, ...config }
    await this.persist()
  }

  // ═══════════════ Run 完成检测 ═══════════════

  checkRunCompletion(run: Run): void {
    const allDone = run.nodes.every(
      (n) => n.status === 'completed' || n.status === 'skipped'
    )
    if (allDone) {
      run.status = 'completed'
      run.completedAt = Date.now()
      this.emit('run:status_changed', { runId: run.id, status: run.status })
    }
  }

  // ═══════════════ Artifact 管理 ═══════════════

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

  getNodeArtifacts(runId: string, nodeId: string): Artifact[] {
    const run = this.getRun(runId)
    if (!run) return []
    const node = run.nodes.find((n) => n.id === nodeId)
    return node?.artifacts || []
  }

  getRunArtifactIndex(runId: string): { nodeId: string; nodeName: string; artifacts: Artifact[] }[] {
    const run = this.getRun(runId)
    if (!run) return []
    return run.nodes
      .filter((n) => n.status === 'completed' && n.artifacts.length > 0)
      .map((n) => ({ nodeId: n.id, nodeName: n.name, artifacts: n.artifacts }))
  }

  // ═══════════════ Inbox 机制 ═══════════════

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

  getInbox(agentId: string): InboxItem[] {
    return this.inbox.get(agentId) || []
  }

  resolveInboxItem(agentId: string, itemId: string): void {
    const queue = this.inbox.get(agentId)
    if (!queue) return
    const item = queue.find((i) => i.id === itemId)
    if (item) {
      item.status = 'resolved'
      item.resolvedAt = Date.now()
    }
  }
}
