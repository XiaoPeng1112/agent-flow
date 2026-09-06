import type {
  Run, TaskNode, DAGEdge, AgentTurn,
  WsMessage, NodeContext, PredecessorOutput,
  EntryCondition, ExitCondition,
} from '../types/index.js'

/**
 * DAGScheduler — DAG 拓扑调度
 *
 * 职责：
 * - 计算 Ready 节点（前置依赖全部完成的节点）
 * - 条件边（Conditional Edge）评估
 * - Context Chaining（将前置节点产出物注入后续节点上下文）
 * - 拓扑排序
 * - 下游节点遍历（BFS）
 *
 * 不负责：Run 生命周期管理、Turn 管理、持久化
 */
export class DAGScheduler {
  /** 外部注入的 TurnManager 引用（用于读取 Turn 输出做条件评估） */
  private turnManager!: {
    getTurns(nodeId: string): AgentTurn[]
  }

  /** 外部注入的事件发射器 */
  private emitter!: (type: WsMessage['type'], payload: unknown) => void

  /**
   * 注入协作模块
   */
  inject(deps: {
    turnManager: DAGScheduler['turnManager']
    emitter: DAGScheduler['emitter']
  }): void {
    this.turnManager = deps.turnManager
    this.emitter = deps.emitter
  }

  // ═══════════════ Ready 节点计算 ═══════════════

  /**
   * 计算并设置 ready 节点
   * 规则：如果一个节点的所有前置节点都已 completed/skipped，则标记为 ready
   * 同时自动构建 Context Chaining —— 将前置节点的产出物注入到后续节点
   * 注意：如果 Run 处于 paused 状态，不推进新节点为 ready
   */
  computeReadyNodes(run: Run): void {
    if (run.status === 'paused') return
    // Iterate after skips so template array order cannot strand an inactive branch.
    let skipped: boolean
    do {
      skipped = false
      for (const node of run.nodes) {
        if (node.status !== 'pending') continue
        const incoming = run.edges.filter(edge => edge.target === node.id)
        const states = incoming.map(edge => this.evaluateEdgeCondition(run, edge))
        if (states.some(state => state === undefined)) continue
        const active = incoming.filter((_, i) => states[i] === true)
        if (incoming.length > 0 && active.length === 0) {
          node.status = 'skipped'
          skipped = true
        } else {
          const satisfied = active.every(edge => {
            const source = run.nodes.find(item => item.id === edge.source)
            return source?.status === 'completed' || source?.status === 'skipped'
              || (source?.status === 'failed' && edge.condition?.type === 'status' && edge.condition.value === 'failed')
          })
          if (!satisfied) continue
          const entry = this.evaluateEntryConditions(run, node)
          if (!entry.passed) {
            node.status = 'failed'
            node.error = `准入条件未满足: ${entry.failedReason}`
          } else {
            node.status = 'ready'
            if (active.length) node.context = this.buildNodeContext(run, node, active)
          }
        }
        this.emitter('run:node_updated', { runId: run.id, nodeId: node.id, status: node.status })
      }
    } while (skipped)
  }

  private exitVerifier?: (run: Run, node: TaskNode, condition: ExitCondition) => boolean

  /** Skipped nodes forward only their active dependency paths, never inactive branch code. */
  getCodePredecessors(run: Run, nodeId: string): string[] {
    const result = new Set<string>()
    const visited = new Set<string>()
    const visit = (id: string): void => {
      if (visited.has(id)) return
      visited.add(id)
      for (const edge of run.edges.filter(e => e.target === id)) {
        const active = this.evaluateEdgeCondition(run, edge)
        if (active === false) continue
        const source = run.nodes.find(n => n.id === edge.source)
        if (!source || active === undefined || !['completed', 'skipped', 'failed'].includes(source.status)) {
          throw new Error('Code predecessor is not finalized')
        }
        if (source.status === 'completed') result.add(source.id)
        if (source.status === 'skipped') visit(source.id)
      }
    }
    visit(nodeId)
    return [...result]
  }

  setExitVerifier(verifier: (run: Run, node: TaskNode, condition: ExitCondition) => boolean): void {
    this.exitVerifier = verifier
  }

  // ═══════════════ 准入/准出条件评估 ═══════════════

  /**
   * 评估节点准入条件（entryConditions）
   * 所有条件必须全部满足才通过
   */
  evaluateEntryConditions(run: Run, node: TaskNode): { passed: boolean; failedReason?: string } {
    if (!node.entryConditions || node.entryConditions.length === 0) {
      return { passed: true }
    }

    for (const cond of node.entryConditions) {
      const result = this.checkEntryCondition(run, cond)
      if (!result.passed) {
        return { passed: false, failedReason: result.reason || cond.description || `条件 ${cond.type}:${cond.value} 不满足` }
      }
    }
    return { passed: true }
  }

  private checkEntryCondition(run: Run, cond: EntryCondition): { passed: boolean; reason?: string } {
    switch (cond.type) {
      case 'predecessor_status': {
        // value 格式: "{nodeId}:{expectedStatus}" 或直接 "{nodeId}"（默认检查 completed）
        const [nodeRef, expectedStatus = 'completed'] = cond.value.split(':')
        const targetNode = run.nodes.find(n => n.id.endsWith(nodeRef) || n.name === nodeRef)
        if (!targetNode) {
          return { passed: false, reason: `前置节点 "${nodeRef}" 不存在` }
        }
        if (targetNode.status !== expectedStatus) {
          return { passed: false, reason: `前置节点 "${targetNode.name}" 状态为 ${targetNode.status}，需要 ${expectedStatus}` }
        }
        return { passed: true }
      }

      case 'artifact_exists': {
        // value 格式: "{nodeId}.{contractId/title}"
        const dotIdx = cond.value.indexOf('.')
        if (dotIdx === -1) {
          return { passed: false, reason: `artifact_exists 格式错误: "${cond.value}"` }
        }
        const nodeRef = cond.value.slice(0, dotIdx)
        const artifactRef = cond.value.slice(dotIdx + 1)
        const targetNode = run.nodes.find(n => n.id.endsWith(nodeRef) || n.name === nodeRef)
        if (!targetNode) {
          return { passed: false, reason: `节点 "${nodeRef}" 不存在` }
        }
        const hasArtifact = targetNode.artifacts.some(a =>
          a.title.toLowerCase().includes(artifactRef.toLowerCase()) ||
          a.id === artifactRef
        )
        if (!hasArtifact) {
          return { passed: false, reason: `节点 "${targetNode.name}" 缺少产出物 "${artifactRef}"` }
        }
        return { passed: true }
      }

      default:
        return { passed: false, reason: `不支持的准入条件: ${cond.type}` }
    }
  }

  /**
   * 评估节点准出条件（exitConditions）
   * 在节点提交完成前调用，所有条件全部满足才允许节点标记为 completed
   */
  evaluateExitConditions(run: Run, node: TaskNode): { passed: boolean; failedReason?: string } {
    if (!node.exitConditions || node.exitConditions.length === 0) {
      return { passed: true }
    }

    for (const cond of node.exitConditions) {
      const result = this.checkExitCondition(run, node, cond)
      if (!result.passed) {
        return { passed: false, failedReason: result.reason || cond.description || `准出条件 ${cond.type}:${cond.value} 不满足` }
      }
    }
    return { passed: true }
  }

  private checkExitCondition(_run: Run, node: TaskNode, cond: ExitCondition): { passed: boolean; reason?: string } {
    switch (cond.type) {
      case 'output_contains': {
        // 检查最后一个 Turn 的输出是否包含指定关键字
        const nodeTurns = this.turnManager.getTurns(node.id)
        const lastTurn = [...nodeTurns].reverse().find(t => t.status === 'completed')
        if (!cond.value || !lastTurn?.output?.includes(cond.value)) {
          return { passed: false, reason: `节点输出中未包含 "${cond.value}"` }
        }
        return { passed: true }
      }

      case 'lint_pass':
      case 'test_pass':
        return this.exitVerifier?.(_run, node, cond)
          ? { passed: true }
          : { passed: false, reason: `缺少当前执行的通过证据: ${cond.type}` }
      default:
        return { passed: false, reason: `不支持的准出条件: ${cond.type}` }
    }
  }

  // ═══════════════ 条件边评估 ═══════════════

  /**
   * 评估边条件是否满足
   */
  private evaluateEdgeCondition(run: Run, edge: DAGEdge): boolean | undefined {
    if (!edge.condition) return true

    const sourceNode = run.nodes.find(n => n.id === edge.source)
    if (!sourceNode) return undefined
    if (!['completed', 'failed', 'skipped'].includes(sourceNode.status)) return undefined

    switch (edge.condition.type) {
      case 'status':
        return sourceNode.status === edge.condition.value

      case 'output_contains': {
        const nodeTurns = this.turnManager.getTurns(sourceNode.id)
        const lastTurn = [...nodeTurns].reverse().find(t => t.status === 'completed')
        return lastTurn?.output?.includes(edge.condition.value) ?? false
      }

      default:
        return undefined
    }
  }

  // ═══════════════ Context Chaining ═══════════════

  /**
   * 构建节点上下文
   * 聚合所有前置节点的 Turn 输出和产出物，供后续节点消费
   */
  private buildNodeContext(_run: Run, _node: TaskNode, incomingEdges: DAGEdge[]): NodeContext {
    const run = _run
    const predecessorOutputs: PredecessorOutput[] = []

    for (const edge of incomingEdges) {
      const sourceNode = run.nodes.find(n => n.id === edge.source)
      if (!sourceNode || sourceNode.status === 'skipped') continue

      const nodeTurns = this.turnManager.getTurns(sourceNode.id)
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
        artifacts: [...(sourceNode.artifacts || []), ...(sourceNode.approvalFeedback || []).map((feedback, index) => ({
          id: `approval-${sourceNode.id}-${index}`, nodeId: sourceNode.id, title: '用户批准意见',
          category: 'document' as const, format: 'markdown', content: feedback.content, createdAt: feedback.createdAt,
        }))],
      })
    }

    return { predecessorOutputs }
  }

  // ═══════════════ 拓扑排序 ═══════════════

  /**
   * DAG 拓扑排序（Kahn's Algorithm）
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

  // ═══════════════ 下游节点遍历 ═══════════════

  /**
   * 获取下游节点（BFS 遍历）
   */
  getDownstreamNodes(run: Run, nodeId: string): TaskNode[] {
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
}
