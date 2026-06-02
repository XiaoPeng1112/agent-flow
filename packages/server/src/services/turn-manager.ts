import { randomUUID } from 'crypto'
import type {
  Run, AgentTurn, TurnResult, WsMessage,
} from '../types/index.js'

/**
 * TurnManager — Agent Turn 生命周期管理
 *
 * 职责：
 * - Turn 启动 / 输出追加 / 结果记录 / 完成
 * - Turn 查询（按节点、按活跃状态）
 * - Token 消耗统计与解析
 * - 获取所有 Turns 数据（供 MetricsCollector / 持久化使用）
 *
 * 不负责：Run 生命周期、DAG 调度、持久化
 */
export class TurnManager {
  private turns: Map<string, AgentTurn[]> = new Map()  // nodeId → turns

  /** 外部注入的事件发射器 */
  private emitter!: (type: WsMessage['type'], payload: unknown) => void

  /** 外部注入的持久化触发器（fire-and-forget） */
  private persistFn!: () => void

  /**
   * 注入协作模块
   */
  inject(deps: {
    emitter: TurnManager['emitter']
    persistFn: TurnManager['persistFn']
  }): void {
    this.emitter = deps.emitter
    this.persistFn = deps.persistFn
  }

  // ═══════════════ Turn CRUD（供 RunManager 调用） ═══════════════

  getTurns(nodeId: string): AgentTurn[] {
    return this.turns.get(nodeId) || []
  }

  setTurns(nodeId: string, turns: AgentTurn[]): void {
    this.turns.set(nodeId, turns)
  }

  deleteTurns(nodeId: string): void {
    this.turns.delete(nodeId)
  }

  getAllTurnsMap(): Map<string, AgentTurn[]> {
    return this.turns
  }

  // ═══════════════ Turn 生命周期 ═══════════════

  /**
   * 启动一个新的 Agent Turn
   */
  startTurn(nodeId: string, runId: string, agentId: string, prompt: string): AgentTurn {
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

    this.emitter('agent:turn_started', { turn })
    this.persistFn()
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
    this.emitter('agent:turn_output', { turnId, nodeId, chunk })
  }

  /**
   * 记录 Turn 结果
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
   * 完成 Turn（FinalizeAgentTurn）
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
        this.emitter('agent:turn_completed', { turn })
        break
      case 'failed':
        turn.status = 'error'
        turn.completedAt = Date.now()
        this.emitter('agent:turn_error', { turn })
        break
      case 'paused_for_question':
        turn.status = 'paused'
        this.emitter('agent:turn_paused', { turn, question: turn.question })
        break
      default:
        turn.status = 'completed'
        turn.result = 'succeeded'
        turn.completedAt = Date.now()
        this.emitter('agent:turn_completed', { turn })
    }

    this.persistFn()
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

  // ═══════════════ Token 消耗统计 ═══════════════

  /**
   * 获取 Run 级别的 Token 消耗统计
   */
  getRunTokenStats(run: Run): {
    totalInput: number
    totalOutput: number
    totalTokens: number
    byNode: Array<{ nodeId: string; nodeName: string; input: number; output: number; total: number; turnCount: number }>
    estimatedCost?: { usd: number; breakdown: string }
  } {
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
        let tokenUsage = turn.tokenUsage
        if (!tokenUsage && turn.output) {
          tokenUsage = this.parseTokenFromOutput(turn.output)
        }
        if (tokenUsage) {
          nodeInput += tokenUsage.input
          nodeOutput += tokenUsage.output
          nodeTotal += tokenUsage.total
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

    // 估算成本（基于 Claude Sonnet 定价）
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
   * 从 Turn 输出文本中解析 Token 使用量
   */
  private parseTokenFromOutput(output: string): { input: number; output: number; total: number } | undefined {
    try {
      // 清除 ANSI 转义码
      // eslint-disable-next-line no-control-regex
      const clean = output.replace(/\x1b\[[0-9;]*m/g, '')

      // Codex 格式
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
