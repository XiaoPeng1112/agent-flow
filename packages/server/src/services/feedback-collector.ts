import { readFile, writeFile, mkdir, readdir } from 'fs/promises'
import { join } from 'path'

// ═══════════════════════════════════════════════════
// FeedbackCollector — 反馈采集器
//
// 职责：
// 1. 自动记录审批打回（reject）的原因和上下文
// 2. 自动记录 Diff Review 中 Discard 的原因
// 3. 自动记录 Run/Node 执行失败的错误信息
// 4. 提供按时间范围/类型查询反馈日志的能力
//
// 设计原则：
// - 只收集，不决策
// - 零侵入：通过公开方法被其他服务调用，不修改已有逻辑
// - 持久化为 JSON Lines（每行一条记录），按日期分文件
// - 单文件 < 300 行
// ═══════════════════════════════════════════════════

export type FeedbackType =
  | 'review_reject'      // 审批打回
  | 'diff_discard'       // Diff Review 丢弃变更
  | 'execution_failure'  // 执行失败（超时/报错/crash）
  | 'manual_note'        // 用户手动备注

export type FeedbackSeverity = 'low' | 'medium' | 'high' | 'critical'

export interface FeedbackEntry {
  id: string
  type: FeedbackType
  severity: FeedbackSeverity
  timestamp: number
  // 关联上下文
  runId?: string
  nodeId?: string
  nodeName?: string
  agentId?: string
  // 内容
  summary: string                // 一句话摘要
  details?: string               // 详细信息（用户填写的打回原因、错误堆栈等）
  context?: Record<string, unknown>  // 额外上下文数据
}

export interface FeedbackQuery {
  type?: FeedbackType
  severity?: FeedbackSeverity
  runId?: string
  startTime?: number
  endTime?: number
  limit?: number
}

export interface FeedbackStats {
  total: number
  byType: Record<FeedbackType, number>
  bySeverity: Record<FeedbackSeverity, number>
  recentTrend: Array<{ date: string; count: number }>
}

export class FeedbackCollector {
  private storagePath: string
  private todayEntries: FeedbackEntry[] = []
  private todayDate: string = ''

  constructor() {
    const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
    this.storagePath = join(home, '.agent-flow', 'feedback')
    this.todayDate = this.getDateStr(Date.now())
  }

  // ═══════════════ 反馈记录 ═══════════════

  /**
   * 记录审批打回
   */
  recordReviewReject(params: {
    runId: string
    nodeId: string
    nodeName: string
    agentId?: string
    reason: string
    retryCount: number
  }): FeedbackEntry {
    const entry: FeedbackEntry = {
      id: this.generateId(),
      type: 'review_reject',
      severity: params.retryCount >= 3 ? 'high' : params.retryCount >= 1 ? 'medium' : 'low',
      timestamp: Date.now(),
      runId: params.runId,
      nodeId: params.nodeId,
      nodeName: params.nodeName,
      agentId: params.agentId,
      summary: `节点「${params.nodeName}」第 ${params.retryCount + 1} 次被打回`,
      details: params.reason,
      context: { retryCount: params.retryCount },
    }
    this.append(entry)
    return entry
  }

  /**
   * 记录 Diff Review 丢弃变更
   */
  recordDiffDiscard(params: {
    runId: string
    nodeId?: string
    filesDiscarded: number
    reason?: string
  }): FeedbackEntry {
    const entry: FeedbackEntry = {
      id: this.generateId(),
      type: 'diff_discard',
      severity: params.filesDiscarded > 5 ? 'high' : 'medium',
      timestamp: Date.now(),
      runId: params.runId,
      nodeId: params.nodeId,
      summary: `Diff Review 丢弃 ${params.filesDiscarded} 个文件的变更`,
      details: params.reason,
      context: { filesDiscarded: params.filesDiscarded },
    }
    this.append(entry)
    return entry
  }

  /**
   * 记录执行失败
   */
  recordExecutionFailure(params: {
    runId: string
    nodeId: string
    nodeName: string
    agentId?: string
    error: string
    failureType: 'timeout' | 'crash' | 'error' | 'unknown'
  }): FeedbackEntry {
    const entry: FeedbackEntry = {
      id: this.generateId(),
      type: 'execution_failure',
      severity: params.failureType === 'crash' ? 'critical' : 'high',
      timestamp: Date.now(),
      runId: params.runId,
      nodeId: params.nodeId,
      nodeName: params.nodeName,
      agentId: params.agentId,
      summary: `节点「${params.nodeName}」执行失败（${params.failureType}）`,
      details: params.error,
      context: { failureType: params.failureType },
    }
    this.append(entry)
    return entry
  }

  /**
   * 记录用户手动备注
   */
  recordManualNote(params: {
    runId?: string
    nodeId?: string
    note: string
  }): FeedbackEntry {
    const entry: FeedbackEntry = {
      id: this.generateId(),
      type: 'manual_note',
      severity: 'low',
      timestamp: Date.now(),
      runId: params.runId,
      nodeId: params.nodeId,
      summary: params.note.slice(0, 80),
      details: params.note,
    }
    this.append(entry)
    return entry
  }

  // ═══════════════ 查询 ═══════════════

  /**
   * 按条件查询反馈记录
   */
  async query(q: FeedbackQuery = {}): Promise<FeedbackEntry[]> {
    const entries = await this.loadRange(
      q.startTime || Date.now() - 30 * 24 * 60 * 60 * 1000, // 默认最近 30 天
      q.endTime || Date.now()
    )

    let filtered = entries
    if (q.type) filtered = filtered.filter(e => e.type === q.type)
    if (q.severity) filtered = filtered.filter(e => e.severity === q.severity)
    if (q.runId) filtered = filtered.filter(e => e.runId === q.runId)

    // 按时间倒序
    filtered.sort((a, b) => b.timestamp - a.timestamp)

    if (q.limit) filtered = filtered.slice(0, q.limit)
    return filtered
  }

  /**
   * 获取统计摘要
   */
  async getStats(days = 7): Promise<FeedbackStats> {
    const startTime = Date.now() - days * 24 * 60 * 60 * 1000
    const entries = await this.loadRange(startTime, Date.now())

    const byType: Record<FeedbackType, number> = {
      review_reject: 0,
      diff_discard: 0,
      execution_failure: 0,
      manual_note: 0,
    }
    const bySeverity: Record<FeedbackSeverity, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    }

    for (const e of entries) {
      byType[e.type]++
      bySeverity[e.severity]++
    }

    // 按日统计趋势
    const dailyCounts = new Map<string, number>()
    for (const e of entries) {
      const date = this.getDateStr(e.timestamp)
      dailyCounts.set(date, (dailyCounts.get(date) || 0) + 1)
    }
    const recentTrend = Array.from(dailyCounts.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))

    return {
      total: entries.length,
      byType,
      bySeverity,
      recentTrend,
    }
  }

  // ═══════════════ 持久化 ═══════════════

  private append(entry: FeedbackEntry): void {
    const dateStr = this.getDateStr(entry.timestamp)

    // 内存缓存当天数据
    if (dateStr === this.todayDate) {
      this.todayEntries.push(entry)
    }

    // 异步写入文件（fire-and-forget）
    this.appendToFile(dateStr, entry).catch(() => {/* 写入失败不阻塞 */})
  }

  private async appendToFile(dateStr: string, entry: FeedbackEntry): Promise<void> {
    await mkdir(this.storagePath, { recursive: true })
    const filePath = join(this.storagePath, `${dateStr}.jsonl`)
    const line = JSON.stringify(entry) + '\n'
    // appendFile 语义：追加写入
    const { appendFile } = await import('fs/promises')
    await appendFile(filePath, line, 'utf-8')
  }

  private async loadRange(startTime: number, endTime: number): Promise<FeedbackEntry[]> {
    const entries: FeedbackEntry[] = []

    try {
      const files = await readdir(this.storagePath)
      const startDate = this.getDateStr(startTime)
      const endDate = this.getDateStr(endTime)

      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue
        const fileDate = file.replace('.jsonl', '')
        if (fileDate < startDate || fileDate > endDate) continue

        const content = await readFile(join(this.storagePath, file), 'utf-8')
        for (const line of content.split('\n')) {
          if (!line.trim()) continue
          try {
            const entry = JSON.parse(line) as FeedbackEntry
            if (entry.timestamp >= startTime && entry.timestamp <= endTime) {
              entries.push(entry)
            }
          } catch { /* 跳过解析失败的行 */ }
        }
      }
    } catch {
      // 目录不存在等情况
    }

    return entries
  }

  // ═══════════════ 工具方法 ═══════════════

  private getDateStr(ts: number): string {
    const d = new Date(ts)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  private generateId(): string {
    return `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }
}
