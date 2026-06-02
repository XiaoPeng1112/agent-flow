import type {
  Run, TaskNode, DAGEdge, AgentTurn,
  WsMessage, NodeContext, PredecessorOutput,
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

    for (const node of run.nodes) {
      if (node.status !== 'pending') continue

      const incomingEdges = run.edges.filter((e) => e.target === node.id)

      if (incomingEdges.length === 0) {
        // 无前置依赖，直接 ready
        node.status = 'ready'
        this.emitter('run:node_updated', { runId: run.id, nodeId: node.id, status: node.status })
      } else {
        // 过滤满足条件的边
        const activeEdges = incomingEdges.filter(edge => this.evaluateEdgeCondition(run, edge))

        if (activeEdges.length === 0 && incomingEdges.some(e => e.condition)) {
          // 所有边都有条件但都不满足 → 跳过该节点
          node.status = 'skipped'
          this.emitter('run:node_updated', { runId: run.id, nodeId: node.id, status: node.status })
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
          // Context Chaining
          node.context = this.buildNodeContext(run, node, edgesToCheck)
          this.emitter('run:node_updated', { runId: run.id, nodeId: node.id, status: node.status })
        }
      }
    }
  }

  // ═══════════════ 条件边评估 ═══════════════

  /**
   * 评估边条件是否满足
   */
  private evaluateEdgeCondition(run: Run, edge: DAGEdge): boolean {
    if (!edge.condition) return true

    const sourceNode = run.nodes.find(n => n.id === edge.source)
    if (!sourceNode) return false

    switch (edge.condition.type) {
      case 'status':
        return sourceNode.status === edge.condition.value

      case 'output_contains': {
        const nodeTurns = this.turnManager.getTurns(sourceNode.id)
        const lastTurn = [...nodeTurns].reverse().find(t => t.status === 'completed')
        return lastTurn?.output?.includes(edge.condition.value) ?? false
      }

      case 'expression':
        return true

      default:
        return true
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
        artifacts: sourceNode.artifacts || [],
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
