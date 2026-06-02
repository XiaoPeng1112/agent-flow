import type {
  Run, TaskNode, TaskNodeStatus,
  AgentTurn, TurnResult, Artifact,
  WorkflowTemplate, InboxItem,
  WsMessage,
} from '../types/index.js'

import { RunManager } from './run-manager.js'
import { DAGScheduler } from './dag-scheduler.js'
import { TurnManager } from './turn-manager.js'
import type { ContextDBService } from './context-db.js'

type EventHandler = (message: WsMessage) => void

/**
 * WorkflowEngine — Facade（门面模式）
 *
 * 对外保持与旧版完全相同的 API 签名，内部委托给三个子模块：
 * - RunManager: Run CRUD / 节点状态机 / Artifact / Inbox / 持久化
 * - DAGScheduler: DAG 拓扑排序 / Ready 节点计算 / 条件边 / Context Chaining
 * - TurnManager: Agent Turn 生命周期 / Token 统计
 *
 * 外部调用方无需任何改动。
 */
export class WorkflowEngine {
  private runManager: RunManager
  private dagScheduler: DAGScheduler
  private turnManager: TurnManager

  constructor() {
    this.runManager = new RunManager()
    this.dagScheduler = new DAGScheduler()
    this.turnManager = new TurnManager()

    // 注入协作依赖（互相引用）
    const emitter = (type: WsMessage['type'], payload: unknown) => {
      this.runManager.emit(type, payload)
    }

    this.turnManager.inject({
      emitter,
      persistFn: () => { this.runManager.persist() },
    })

    this.dagScheduler.inject({
      turnManager: {
        getTurns: (nodeId: string) => this.turnManager.getTurns(nodeId),
      },
      emitter,
    })

    this.runManager.inject({
      dagScheduler: {
        computeReadyNodes: (run: Run) => this.dagScheduler.computeReadyNodes(run),
        getDownstreamNodes: (run: Run, nodeId: string) => this.dagScheduler.getDownstreamNodes(run, nodeId),
        evaluateExitConditions: (run: Run, node: TaskNode) => this.dagScheduler.evaluateExitConditions(run, node),
      },
      turnManager: {
        getTurns: (nodeId: string) => this.turnManager.getTurns(nodeId),
        setTurns: (nodeId: string, turns: AgentTurn[]) => this.turnManager.setTurns(nodeId, turns),
        getAllTurnsMap: () => this.turnManager.getAllTurnsMap(),
      },
    })
  }

  // ═══════════════ 初始化 ═══════════════

  /** 注入 ContextDBService（用于 L2 种子文件自动生成） */
  injectContextDB(contextDBService: ContextDBService): void {
    this.runManager.injectContextDB(contextDBService)
  }

  async load(): Promise<void> {
    await this.runManager.load()
  }

  // ═══════════════ 事件系统 ═══════════════

  onEvent(handler: EventHandler): () => void {
    return this.runManager.onEvent(handler)
  }

  // ═══════════════ Run 管理（委托 RunManager） ═══════════════

  async createRun(projectId: string, template: WorkflowTemplate, name?: string): Promise<Run> {
    return this.runManager.createRun(projectId, template, name)
  }

  async startRun(runId: string): Promise<Run> {
    return this.runManager.startRun(runId)
  }

  async pauseRun(runId: string): Promise<Run> {
    return this.runManager.pauseRun(runId)
  }

  async resumeRun(runId: string): Promise<Run> {
    return this.runManager.resumeRun(runId)
  }

  getRuns(projectId?: string): Run[] {
    return this.runManager.getRuns(projectId)
  }

  getRun(runId: string): Run | undefined {
    return this.runManager.getRun(runId)
  }

  async deleteRun(runId: string): Promise<boolean> {
    return this.runManager.deleteRun(runId)
  }

  async importRun(runData: Run, turnsData?: Record<string, AgentTurn[]>): Promise<void> {
    return this.runManager.importRun(runData, turnsData)
  }

  getRunTurns(runId: string): Record<string, AgentTurn[]> {
    return this.runManager.getRunTurns(runId)
  }

  getAllTurns(): Map<string, AgentTurn[]> {
    return this.turnManager.getAllTurnsMap()
  }

  // ═══════════════ TaskNode 状态机（委托 RunManager） ═══════════════

  async startNode(runId: string, nodeId: string): Promise<TaskNode> {
    return this.runManager.startNode(runId, nodeId)
  }

  async submitNodeDecision(
    runId: string,
    nodeId: string,
    decision: 'waiting_user_review' | 'completed' | 'failed',
    error?: string
  ): Promise<TaskNode> {
    return this.runManager.submitNodeDecision(runId, nodeId, decision, error)
  }

  async approveNode(runId: string, nodeId: string, feedback?: string): Promise<TaskNode> {
    return this.runManager.approveNode(runId, nodeId, feedback)
  }

  async rejectNode(runId: string, nodeId: string, feedback?: string): Promise<TaskNode> {
    return this.runManager.rejectNode(runId, nodeId, feedback)
  }

  async skipNode(runId: string, nodeId: string): Promise<TaskNode> {
    return this.runManager.skipNode(runId, nodeId)
  }

  async forceResetNode(runId: string, nodeId: string): Promise<TaskNode> {
    return this.runManager.forceResetNode(runId, nodeId)
  }

  async rollbackNode(runId: string, nodeId: string): Promise<void> {
    return this.runManager.rollbackNode(runId, nodeId)
  }

  async restoreFromCheckpoint(runId: string, nodeStates: Array<{ nodeId: string; status: TaskNodeStatus }>): Promise<void> {
    return this.runManager.restoreFromCheckpoint(runId, nodeStates)
  }

  getReadyNodes(runId: string): TaskNode[] {
    return this.runManager.getReadyNodes(runId)
  }

  getRunConfig(runId: string): import('../types/index.js').RunConfig | undefined {
    return this.runManager.getRunConfig(runId)
  }

  async updateRunConfig(runId: string, config: import('../types/index.js').RunConfig): Promise<void> {
    return this.runManager.updateRunConfig(runId, config)
  }

  // ═══════════════ AgentTurn 管理（委托 TurnManager） ═══════════════

  startTurn(nodeId: string, runId: string, agentId: string, prompt: string): AgentTurn {
    return this.turnManager.startTurn(nodeId, runId, agentId, prompt)
  }

  appendTurnOutput(turnId: string, nodeId: string, chunk: string): void {
    this.turnManager.appendTurnOutput(turnId, nodeId, chunk)
  }

  recordTurnResult(
    turnId: string,
    nodeId: string,
    result: TurnResult,
    question?: string,
    tokenUsage?: { input: number; output: number; total: number }
  ): AgentTurn {
    return this.turnManager.recordTurnResult(turnId, nodeId, result, question, tokenUsage)
  }

  finalizeTurn(turnId: string, nodeId: string): AgentTurn {
    return this.turnManager.finalizeTurn(turnId, nodeId)
  }

  getNodeTurns(nodeId: string): AgentTurn[] {
    return this.turnManager.getNodeTurns(nodeId)
  }

  getActiveTurn(nodeId: string): AgentTurn | undefined {
    return this.turnManager.getActiveTurn(nodeId)
  }

  // ═══════════════ Artifact 管理（委托 RunManager） ═══════════════

  async addArtifact(runId: string, nodeId: string, artifact: Omit<Artifact, 'id' | 'nodeId' | 'createdAt'>): Promise<Artifact> {
    return this.runManager.addArtifact(runId, nodeId, artifact)
  }

  getNodeArtifacts(runId: string, nodeId: string): Artifact[] {
    return this.runManager.getNodeArtifacts(runId, nodeId)
  }

  getRunArtifactIndex(runId: string): { nodeId: string; nodeName: string; artifacts: Artifact[] }[] {
    return this.runManager.getRunArtifactIndex(runId)
  }

  // ═══════════════ Inbox 机制（委托 RunManager） ═══════════════

  enqueueInbox(item: Omit<InboxItem, 'id' | 'createdAt' | 'status'>): InboxItem {
    return this.runManager.enqueueInbox(item)
  }

  getInbox(agentId: string): InboxItem[] {
    return this.runManager.getInbox(agentId)
  }

  resolveInboxItem(agentId: string, itemId: string): void {
    this.runManager.resolveInboxItem(agentId, itemId)
  }

  // ═══════════════ Token 统计（委托 TurnManager） ═══════════════

  getRunTokenStats(runId: string): {
    totalInput: number
    totalOutput: number
    totalTokens: number
    byNode: Array<{ nodeId: string; nodeName: string; input: number; output: number; total: number; turnCount: number }>
    estimatedCost?: { usd: number; breakdown: string }
  } {
    const run = this.getRun(runId)
    if (!run) throw new Error(`Run not found: ${runId}`)
    return this.turnManager.getRunTokenStats(run)
  }

  // ═══════════════ DAG 工具（委托 DAGScheduler） ═══════════════

  topologicalSort(run: Run): string[] {
    return this.dagScheduler.topologicalSort(run)
  }
}
