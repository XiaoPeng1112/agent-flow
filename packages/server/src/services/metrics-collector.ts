import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import type { Run, AgentTurn } from '../types/index.js'

// ═══════════════════════════════════════════════════
// MetricsCollector — 可观测性增强
//
// 职责：
// 1. 采集 Run/Node/Turn 级别的时间、Token、工具调用指标
// 2. 计算聚合指标（一次通过率、平均耗时、Token 分布等）
// 3. 生成 Timeline（甘特图数据）用于前端可视化
// 4. 支持多次 Run 的趋势对比
//
// 采集点：
// - startNode → 记录节点开始时间
// - submitNodeDecision → 记录节点完成时间、Turn 指标
// - approveNode → 记录一次通过 / reject 后通过
// - Agent Turn 完成 → 记录 token 消耗和工具调用
// ═══════════════════════════════════════════════════

export interface TurnMetrics {
  turnId: string
  nodeId: string
  agentId: string
  turnIndex: number
  startedAt: number
  completedAt: number
  duration: number
  tokenUsage: { input: number; output: number; total: number }
  toolCalls: string[]
  filesModified: number
  result?: string
}

export interface NodeMetrics {
  nodeId: string
  nodeName: string
  nodeType: string
  agentRole: string
  turns: TurnMetrics[]
  totalDuration: number
  waitDuration: number          // 等待用户确认的时间
  executionDuration: number     // 纯执行时间（不含等待）
  retryCount: number            // reject 后重做次数
  firstPassApproved: boolean    // 第一次提交就被 approve
  finalStatus: string
  startedAt?: number
  completedAt?: number
}

export interface RunMetrics {
  runId: string
  templateId: string
  projectId: string
  nodeMetrics: NodeMetrics[]
  timeline: TimelineEntry[]
  totalDuration: number
  tokenUsage: { input: number; output: number; total: number }
  toolCallCount: number
  firstPassApprovalRate: number
  averageNodeDuration: number
  parallelismRatio: number      // 并行度（并行执行时间 / 总耗时）
  bottleneckNodeId?: string     // 耗时最长的节点
  createdAt: number
}

export interface TimelineEntry {
  nodeId: string
  nodeName: string
  nodeType: string
  status: string
  startedAt: number
  completedAt?: number
  duration: number
  segments: TimelineSegment[]   // 多轮执行的分段
}

export interface TimelineSegment {
  type: 'execution' | 'waiting' | 'review'
  startedAt: number
  completedAt: number
  duration: number
  label?: string
}

export interface TokenDistribution {
  nodeId: string
  nodeName: string
  input: number
  output: number
  total: number
  percentage: number
}

export interface EfficiencyEntry {
  nodeId: string
  nodeName: string
  nodeType: string
  duration: number
  retryCount: number
  firstPassApproved: boolean
  tokenUsage: number
  efficiencyScore: number       // 综合效率评分 (0-100)
}

export class MetricsCollector {
  private nodeStartTimes: Map<string, number> = new Map()      // nodeId → startTime
  private nodeReviewTimes: Map<string, number> = new Map()     // nodeId → enterReviewTime
  private nodeRejectCounts: Map<string, number> = new Map()    // nodeId → reject count
  private turnMetrics: Map<string, TurnMetrics[]> = new Map()  // nodeId → turn metrics
  private runMetricsCache: Map<string, RunMetrics> = new Map() // runId → computed metrics
  private storagePath: string

  constructor() {
    const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
    this.storagePath = join(home, '.agent-flow', 'metrics')
  }

  // ═══════════════ 指标采集 ═══════════════

  /**
   * 记录节点开始执行
   */
  recordNodeStart(nodeId: string): void {
    this.nodeStartTimes.set(nodeId, Date.now())
  }

  /**
   * 记录节点进入等待 review 状态
   */
  recordNodeWaitReview(nodeId: string): void {
    this.nodeReviewTimes.set(nodeId, Date.now())
  }

  /**
   * 记录节点被 reject（增加 retry 计数）
   */
  recordNodeReject(nodeId: string): void {
    const count = this.nodeRejectCounts.get(nodeId) || 0
    this.nodeRejectCounts.set(nodeId, count + 1)
  }

  /**
   * 记录 Agent Turn 完成的指标
   */
  recordTurnComplete(turn: AgentTurn, toolCalls: string[] = [], filesModified = 0): void {
    const metrics: TurnMetrics = {
      turnId: turn.id,
      nodeId: turn.nodeId,
      agentId: turn.agentId,
      turnIndex: turn.turnIndex,
      startedAt: turn.startedAt,
      completedAt: turn.completedAt || Date.now(),
      duration: (turn.completedAt || Date.now()) - turn.startedAt,
      tokenUsage: turn.tokenUsage || { input: 0, output: 0, total: 0 },
      toolCalls,
      filesModified,
      result: turn.result,
    }

    const existing = this.turnMetrics.get(turn.nodeId) || []
    existing.push(metrics)
    this.turnMetrics.set(turn.nodeId, existing)
  }

  // ═══════════════ 指标计算 ═══════════════

  /**
   * 计算 Run 级别的完整指标
   */
  computeRunMetrics(run: Run, allTurns: Map<string, AgentTurn[]>): RunMetrics {
    const nodeMetrics: NodeMetrics[] = []
    let totalInput = 0
    let totalOutput = 0
    let totalToolCalls = 0
    let firstPassCount = 0
    let reviewedCount = 0

    for (const node of run.nodes) {
      if (node.status === 'pending' || node.status === 'ready') continue

      const nodeTurns = allTurns.get(node.id) || []
      const turnMetricsForNode = this.turnMetrics.get(node.id) || []
      // 优先从持久化的 node.rejectCount 读取，fallback 到运行时 Map
      const rejectCount = node.rejectCount ?? this.nodeRejectCounts.get(node.id) ?? 0

      // 计算节点总 token
      let nodeInput = 0
      let nodeOutput = 0
      const nodeToolCalls: string[] = []

      for (const tm of turnMetricsForNode) {
        nodeInput += tm.tokenUsage.input
        nodeOutput += tm.tokenUsage.output
        nodeToolCalls.push(...tm.toolCalls)
      }

      // 如果 turnMetrics 没有数据，从 AgentTurn 中提取并构建 TurnMetrics
      if (turnMetricsForNode.length === 0 && nodeTurns.length > 0) {
        for (const turn of nodeTurns) {
          // 优先使用已有的 tokenUsage，否则尝试从 output 中重新解析
          let tokenUsage = turn.tokenUsage
          if (!tokenUsage && turn.output) {
            tokenUsage = this.parseTokenFromOutput(turn.output)
          }
          if (tokenUsage) {
            nodeInput += tokenUsage.input
            nodeOutput += tokenUsage.output
          }
          // 从 AgentTurn 持久化字段读取 toolCalls（同步后可用）
          const turnToolCalls = turn.toolCalls || []
          nodeToolCalls.push(...turnToolCalls)
          // 构建 TurnMetrics 以便 Token 分布和效率表格能读取
          turnMetricsForNode.push({
            turnId: turn.id,
            nodeId: turn.nodeId,
            agentId: turn.agentId,
            turnIndex: turn.turnIndex,
            startedAt: turn.startedAt,
            completedAt: turn.completedAt || Date.now(),
            duration: (turn.completedAt || Date.now()) - turn.startedAt,
            tokenUsage: tokenUsage || { input: 0, output: 0, total: 0 },
            toolCalls: turnToolCalls,
            filesModified: turn.filesModified || 0,
            result: turn.result,
          })
        }
      }

      totalInput += nodeInput
      totalOutput += nodeOutput
      totalToolCalls += nodeToolCalls.length

      // 计算时间指标
      const nodeDuration = (node.completedAt && node.startedAt)
        ? node.completedAt - node.startedAt
        : 0
      // 优先从持久化的 node.reviewEnteredAt 读取，fallback 到运行时 Map
      const reviewEnterTime = node.reviewEnteredAt ?? this.nodeReviewTimes.get(node.id)
      const waitDuration = (reviewEnterTime && node.completedAt)
        ? node.completedAt - reviewEnterTime
        : 0
      const executionDuration = nodeDuration - waitDuration

      // 一次通过判定
      const firstPassApproved = rejectCount === 0 && node.status === 'completed'
      if (node.status === 'completed') {
        reviewedCount++
        if (firstPassApproved) firstPassCount++
      }

      const nm: NodeMetrics = {
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        agentRole: node.agentRole,
        turns: turnMetricsForNode,
        totalDuration: nodeDuration,
        waitDuration,
        executionDuration,
        retryCount: rejectCount,
        firstPassApproved,
        finalStatus: node.status,
        startedAt: node.startedAt,
        completedAt: node.completedAt,
      }
      nodeMetrics.push(nm)
    }

    // Timeline 数据
    const timeline = this.buildTimeline(run, nodeMetrics)

    // 总耗时
    const totalDuration = (run.completedAt && run.startedAt)
      ? run.completedAt - run.startedAt
      : run.startedAt ? Date.now() - run.startedAt : 0

    // 并行度计算
    const parallelismRatio = this.computeParallelism(nodeMetrics, totalDuration)

    // 瓶颈节点
    const bottleneck = nodeMetrics.reduce((max, nm) =>
      nm.totalDuration > (max?.totalDuration || 0) ? nm : max, nodeMetrics[0])

    // 平均节点耗时
    const completedMetrics = nodeMetrics.filter(nm => nm.totalDuration > 0)
    const averageNodeDuration = completedMetrics.length > 0
      ? completedMetrics.reduce((sum, nm) => sum + nm.totalDuration, 0) / completedMetrics.length
      : 0

    const metrics: RunMetrics = {
      runId: run.id,
      templateId: run.templateId,
      projectId: run.projectId,
      nodeMetrics,
      timeline,
      totalDuration,
      tokenUsage: { input: totalInput, output: totalOutput, total: totalInput + totalOutput },
      toolCallCount: totalToolCalls,
      firstPassApprovalRate: reviewedCount > 0 ? firstPassCount / reviewedCount : 0,
      averageNodeDuration,
      parallelismRatio,
      bottleneckNodeId: bottleneck?.nodeId,
      createdAt: Date.now(),
    }

    this.runMetricsCache.set(run.id, metrics)
    return metrics
  }

  /**
   * 获取缓存的 Run 指标
   */
  getRunMetrics(runId: string): RunMetrics | undefined {
    return this.runMetricsCache.get(runId)
  }

  /**
   * 获取 Token 分布数据（按节点）
   */
  getTokenDistribution(runId: string): TokenDistribution[] {
    const metrics = this.runMetricsCache.get(runId)
    if (!metrics) return []

    const totalTokens = metrics.tokenUsage.total || 1

    return metrics.nodeMetrics
      .filter(nm => nm.turns.length > 0 || nm.totalDuration > 0)
      .map(nm => {
        const nodeTotal = nm.turns.reduce((sum, t) => sum + t.tokenUsage.total, 0)
        return {
          nodeId: nm.nodeId,
          nodeName: nm.nodeName,
          input: nm.turns.reduce((sum, t) => sum + t.tokenUsage.input, 0),
          output: nm.turns.reduce((sum, t) => sum + t.tokenUsage.output, 0),
          total: nodeTotal,
          percentage: Math.round((nodeTotal / totalTokens) * 100),
        }
      })
      .sort((a, b) => b.total - a.total)
  }

  /**
   * 获取效率表格数据
   */
  getEfficiencyTable(runId: string): EfficiencyEntry[] {
    const metrics = this.runMetricsCache.get(runId)
    if (!metrics) return []

    return metrics.nodeMetrics
      .filter(nm => nm.finalStatus !== 'pending' && nm.finalStatus !== 'ready')
      .map(nm => {
        const tokenUsage = nm.turns.reduce((sum, t) => sum + t.tokenUsage.total, 0)
        // 效率评分：综合考虑一次通过、耗时、retry 次数
        const passScore = nm.firstPassApproved ? 40 : Math.max(0, 40 - nm.retryCount * 15)
        const durationScore = Math.max(0, 30 - Math.min(30, nm.totalDuration / 60000 * 5))
        const tokenScore = Math.max(0, 30 - Math.min(30, tokenUsage / 10000 * 10))
        const efficiencyScore = Math.round(passScore + durationScore + tokenScore)

        return {
          nodeId: nm.nodeId,
          nodeName: nm.nodeName,
          nodeType: nm.nodeType,
          duration: nm.totalDuration,
          retryCount: nm.retryCount,
          firstPassApproved: nm.firstPassApproved,
          tokenUsage,
          efficiencyScore: Math.min(100, Math.max(0, efficiencyScore)),
        }
      })
      .sort((a, b) => a.efficiencyScore - b.efficiencyScore)
  }

  /**
   * 获取趋势对比数据（同一 template 的多次 Run）
   */
  getTrend(templateId: string): Array<{
    runId: string
    totalDuration: number
    firstPassRate: number
    totalTokens: number
    createdAt: number
  }> {
    return Array.from(this.runMetricsCache.values())
      .filter(m => m.templateId === templateId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(m => ({
        runId: m.runId,
        totalDuration: m.totalDuration,
        firstPassRate: m.firstPassApprovalRate,
        totalTokens: m.tokenUsage.total,
        createdAt: m.createdAt,
      }))
  }

  // ═══════════════ 持久化 ═══════════════

  async persist(): Promise<void> {
    try {
      await mkdir(this.storagePath, { recursive: true })
      const data = {
        turnMetrics: Object.fromEntries(this.turnMetrics),
        rejectCounts: Object.fromEntries(this.nodeRejectCounts),
        runMetrics: Object.fromEntries(this.runMetricsCache),
      }
      await writeFile(join(this.storagePath, 'metrics.json'), JSON.stringify(data, null, 2))
    } catch {
      // 持久化失败不阻塞
    }
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(join(this.storagePath, 'metrics.json'), 'utf-8')
      const data = JSON.parse(raw)
      if (data.turnMetrics) {
        for (const [k, v] of Object.entries(data.turnMetrics)) {
          this.turnMetrics.set(k, v as TurnMetrics[])
        }
      }
      if (data.rejectCounts) {
        for (const [k, v] of Object.entries(data.rejectCounts)) {
          this.nodeRejectCounts.set(k, v as number)
        }
      }
      if (data.runMetrics) {
        for (const [k, v] of Object.entries(data.runMetrics)) {
          this.runMetricsCache.set(k, v as RunMetrics)
        }
      }
    } catch {
      // 首次启动无数据
    }
  }

  // ═══════════════ 内部方法 ═══════════════

  private buildTimeline(_run: Run, nodeMetrics: NodeMetrics[]): TimelineEntry[] {
    return nodeMetrics
      .filter(nm => nm.startedAt)
      .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0))
      .map(nm => {
        const segments: TimelineSegment[] = []

        // 从 turns 构建分段
        if (nm.turns.length > 0) {
          for (const turn of nm.turns) {
            segments.push({
              type: 'execution',
              startedAt: turn.startedAt,
              completedAt: turn.completedAt,
              duration: turn.duration,
              label: `Turn ${turn.turnIndex + 1}`,
            })
          }
        } else if (nm.startedAt) {
          // 没有细粒度 turn 数据，用整体
          segments.push({
            type: 'execution',
            startedAt: nm.startedAt,
            completedAt: nm.completedAt || Date.now(),
            duration: nm.executionDuration,
          })
        }

        // 如果有等待时间，添加 review 分段
        if (nm.waitDuration > 0 && nm.completedAt) {
          segments.push({
            type: 'review',
            startedAt: nm.completedAt - nm.waitDuration,
            completedAt: nm.completedAt,
            duration: nm.waitDuration,
            label: '等待确认',
          })
        }

        return {
          nodeId: nm.nodeId,
          nodeName: nm.nodeName,
          nodeType: nm.nodeType,
          status: nm.finalStatus,
          startedAt: nm.startedAt!,
          completedAt: nm.completedAt,
          duration: nm.totalDuration,
          segments,
        }
      })
  }

  private computeParallelism(nodeMetrics: NodeMetrics[], totalDuration: number): number {
    if (totalDuration === 0 || nodeMetrics.length === 0) return 0

    // 并行度 = 所有节点执行时间之和 / Run 总时长
    const totalNodeTime = nodeMetrics.reduce((sum, nm) => sum + nm.totalDuration, 0)
    return Math.min(1, totalNodeTime / totalDuration / nodeMetrics.length)
  }

  /**
   * 从 Turn 输出文本中重新解析 Token 使用量
   * 用于历史数据补救：当初始采集时因 ANSI 转义码等原因未能捕获 token 信息
   */
  private parseTokenFromOutput(output: string): { input: number; output: number; total: number } | undefined {
    try {
      // 清除 ANSI 转义码
      // eslint-disable-next-line no-control-regex
      const clean = output.replace(/\x1b\[[0-9;]*m/g, '')

      // Codex 格式："tokens used\n30,313"
      const match = clean.match(/tokens?\s*used\s*\n?\s*([\d,]+)/i)
        || clean.match(/\((\s*[\d,]+)\s*tokens?\s*\)/i)
        || clean.match(/token\s*usage[:\s]+([\d,]+)/i)
      if (match) {
        const total = parseInt(match[1].replace(/[,\s]/g, ''), 10)
        return { input: Math.round(total * 0.7), output: Math.round(total * 0.3), total }
      }

      // Claude 格式
      const inputMatch = clean.match(/input\s*tokens?[:\s]+([\d,]+)/i)
      const outputMatch = clean.match(/output\s*tokens?[:\s]+([\d,]+)/i)
      if (inputMatch || outputMatch) {
        const inp = inputMatch ? parseInt(inputMatch[1].replace(/,/g, ''), 10) : 0
        const out = outputMatch ? parseInt(outputMatch[1].replace(/,/g, ''), 10) : 0
        return { input: inp, output: out, total: inp + out }
      }
    } catch {
      // 解析失败静默
    }
    return undefined
  }
}
