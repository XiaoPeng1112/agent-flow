import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import type { FeedbackCollector, FeedbackStats } from './feedback-collector.js'
import type { MetricsCollector, RunMetrics } from './metrics-collector.js'

// ═══════════════════════════════════════════════════
// WeeklyDigest — 周报摘要生成器
//
// 职责：
// 1. 定期（手动触发或自动）汇总 feedback + metrics 数据
// 2. 生成结构化的纯文本摘要
// 3. 输出到 .agent-flow/context/WEEKLY-DIGEST.md
// 4. 供下次对话时快速加载，定位优化方向
//
// 设计原则：
// - 只读取和汇总，不做决策
// - 输出 Markdown 格式，人类可读
// - 保留最近 4 周历史，超出自动归档
// ═══════════════════════════════════════════════════

export interface DigestData {
  period: { start: string; end: string }
  runsSummary: {
    totalRuns: number
    completedRuns: number
    failedRuns: number
    averageDuration: number
    totalTokens: number
  }
  feedbackSummary: FeedbackStats
  topIssues: Array<{
    pattern: string
    count: number
    severity: string
    suggestion: string
  }>
  agentPerformance: Array<{
    agentId: string
    runsParticipated: number
    firstPassRate: number
    averageTokens: number
  }>
  generatedAt: number
}

export class WeeklyDigest {
  private feedbackCollector: FeedbackCollector
  private metricsCollector: MetricsCollector
  private outputPath: string

  constructor(feedbackCollector: FeedbackCollector, metricsCollector: MetricsCollector) {
    this.feedbackCollector = feedbackCollector
    this.metricsCollector = metricsCollector

    const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
    this.outputPath = join(home, '.agent-flow', 'context')
  }

  /**
   * 生成周报摘要（默认最近 7 天）
   */
  async generate(days = 7): Promise<DigestData> {
    const endTime = Date.now()
    const startTime = endTime - days * 24 * 60 * 60 * 1000

    // 1. 获取反馈统计
    const feedbackSummary = await this.feedbackCollector.getStats(days)

    // 2. 获取 Metrics 数据（从缓存中提取）
    const runsSummary = this.computeRunsSummary(startTime, endTime)

    // 3. 分析 Top Issues（从反馈中提取模式）
    const topIssues = await this.analyzeTopIssues(days)

    // 4. Agent 表现（从 metrics 中提取）
    const agentPerformance = this.computeAgentPerformance(startTime, endTime)

    const digest: DigestData = {
      period: {
        start: this.formatDate(startTime),
        end: this.formatDate(endTime),
      },
      runsSummary,
      feedbackSummary,
      topIssues,
      agentPerformance,
      generatedAt: Date.now(),
    }

    // 写入 Markdown 文件
    await this.writeDigestMarkdown(digest)

    return digest
  }

  // ═══════════════ 数据计算 ═══════════════

  private computeRunsSummary(startTime: number, endTime: number) {
    // 从 metricsCollector 获取趋势数据（所有 template）
    // 这里通过反射获取内部 cache — 实际上 MetricsCollector 应该暴露一个 getAllMetrics 方法
    // 暂时用 getTrend 近似
    const allMetrics = this.getAllCachedMetrics()
    const periodMetrics = allMetrics.filter(m => m.createdAt >= startTime && m.createdAt <= endTime)

    const totalRuns = periodMetrics.length
    const completedRuns = periodMetrics.filter(m => m.nodeMetrics.every(n =>
      n.finalStatus === 'completed' || n.finalStatus === 'skipped'
    )).length
    const failedRuns = periodMetrics.filter(m => m.nodeMetrics.some(n =>
      n.finalStatus === 'failed'
    )).length

    const averageDuration = totalRuns > 0
      ? periodMetrics.reduce((sum, m) => sum + m.totalDuration, 0) / totalRuns
      : 0

    const totalTokens = periodMetrics.reduce((sum, m) => sum + m.tokenUsage.total, 0)

    return { totalRuns, completedRuns, failedRuns, averageDuration, totalTokens }
  }

  private async analyzeTopIssues(days: number) {
    const feedbacks = await this.feedbackCollector.query({
      startTime: Date.now() - days * 24 * 60 * 60 * 1000,
    })

    // 按节点名 + 类型归类
    const patterns = new Map<string, { count: number; severity: string; type: string }>()
    for (const fb of feedbacks) {
      if (fb.type === 'manual_note') continue
      const key = `${fb.type}:${fb.nodeName || 'unknown'}`
      const existing = patterns.get(key) || { count: 0, severity: fb.severity, type: fb.type }
      existing.count++
      if (this.severityWeight(fb.severity) > this.severityWeight(existing.severity)) {
        existing.severity = fb.severity
      }
      patterns.set(key, existing)
    }

    return Array.from(patterns.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([key, val]) => {
        const [type, nodeName] = key.split(':')
        return {
          pattern: `${nodeName} — ${this.typeLabel(type)}`,
          count: val.count,
          severity: val.severity,
          suggestion: this.generateSuggestion(type, nodeName, val.count),
        }
      })
  }

  private computeAgentPerformance(_startTime: number, _endTime: number) {
    const allMetrics = this.getAllCachedMetrics()
    const agentMap = new Map<string, { runs: number; firstPass: number; total: number; tokens: number }>()

    for (const rm of allMetrics) {
      for (const nm of rm.nodeMetrics) {
        if (nm.turns.length === 0) continue
        const agentId = nm.turns[0]?.agentId || 'unknown'
        const existing = agentMap.get(agentId) || { runs: 0, firstPass: 0, total: 0, tokens: 0 }
        existing.runs++
        existing.total++
        if (nm.firstPassApproved) existing.firstPass++
        existing.tokens += nm.turns.reduce((s, t) => s + t.tokenUsage.total, 0)
        agentMap.set(agentId, existing)
      }
    }

    return Array.from(agentMap.entries())
      .map(([agentId, data]) => ({
        agentId,
        runsParticipated: data.runs,
        firstPassRate: data.total > 0 ? Math.round((data.firstPass / data.total) * 100) : 0,
        averageTokens: data.runs > 0 ? Math.round(data.tokens / data.runs) : 0,
      }))
      .sort((a, b) => b.runsParticipated - a.runsParticipated)
  }

  // ═══════════════ Markdown 输出 ═══════════════

  private async writeDigestMarkdown(digest: DigestData): Promise<void> {
    const md = this.renderMarkdown(digest)
    await mkdir(this.outputPath, { recursive: true })
    await writeFile(join(this.outputPath, 'WEEKLY-DIGEST.md'), md, 'utf-8')
  }

  private renderMarkdown(d: DigestData): string {
    const lines: string[] = []

    lines.push(`# AgentFlow 周报摘要`)
    lines.push(``)
    lines.push(`> 统计周期：${d.period.start} ~ ${d.period.end}`)
    lines.push(`> 生成时间：${this.formatDate(d.generatedAt)}`)
    lines.push(``)

    // Run 概览
    lines.push(`## 执行概览`)
    lines.push(``)
    lines.push(`| 指标 | 数值 |`)
    lines.push(`|------|------|`)
    lines.push(`| 总 Run 数 | ${d.runsSummary.totalRuns} |`)
    lines.push(`| 完成 | ${d.runsSummary.completedRuns} |`)
    lines.push(`| 失败 | ${d.runsSummary.failedRuns} |`)
    lines.push(`| 平均耗时 | ${this.formatDuration(d.runsSummary.averageDuration)} |`)
    lines.push(`| Token 消耗 | ${d.runsSummary.totalTokens.toLocaleString()} |`)
    lines.push(``)

    // 反馈统计
    lines.push(`## 反馈统计`)
    lines.push(``)
    lines.push(`共 ${d.feedbackSummary.total} 条反馈记录：`)
    lines.push(`- 审批打回：${d.feedbackSummary.byType.review_reject} 次`)
    lines.push(`- Diff 丢弃：${d.feedbackSummary.byType.diff_discard} 次`)
    lines.push(`- 执行失败：${d.feedbackSummary.byType.execution_failure} 次`)
    lines.push(`- 手动备注：${d.feedbackSummary.byType.manual_note} 条`)
    lines.push(``)

    if (d.feedbackSummary.bySeverity.critical > 0 || d.feedbackSummary.bySeverity.high > 0) {
      lines.push(`⚠️ **需关注**：${d.feedbackSummary.bySeverity.critical} 条严重 + ${d.feedbackSummary.bySeverity.high} 条高优先级问题`)
      lines.push(``)
    }

    // Top Issues
    if (d.topIssues.length > 0) {
      lines.push(`## 高频问题 TOP ${d.topIssues.length}`)
      lines.push(``)
      lines.push(`| 模式 | 次数 | 严重度 | 改进建议 |`)
      lines.push(`|------|------|--------|----------|`)
      for (const issue of d.topIssues) {
        lines.push(`| ${issue.pattern} | ${issue.count} | ${issue.severity} | ${issue.suggestion} |`)
      }
      lines.push(``)
    }

    // Agent 表现
    if (d.agentPerformance.length > 0) {
      lines.push(`## Agent 表现`)
      lines.push(``)
      lines.push(`| Agent | 参与节点数 | 一次通过率 | 平均 Token |`)
      lines.push(`|-------|-----------|-----------|-----------|`)
      for (const ap of d.agentPerformance) {
        lines.push(`| ${ap.agentId} | ${ap.runsParticipated} | ${ap.firstPassRate}% | ${ap.averageTokens.toLocaleString()} |`)
      }
      lines.push(``)
    }

    // 建议
    lines.push(`## 下一步建议`)
    lines.push(``)
    if (d.feedbackSummary.total === 0 && d.runsSummary.totalRuns === 0) {
      lines.push(`本周暂无执行数据。开始使用 AgentFlow 执行真实任务后，此处将自动生成优化建议。`)
    } else {
      lines.push(`基于本周数据，建议关注：`)
      if (d.topIssues.length > 0) {
        lines.push(`1. 优先解决高频问题「${d.topIssues[0].pattern}」（出现 ${d.topIssues[0].count} 次）`)
      }
      if (d.runsSummary.failedRuns > 0) {
        lines.push(`${d.topIssues.length > 0 ? '2' : '1'}. 排查 ${d.runsSummary.failedRuns} 个失败 Run 的根因`)
      }
      if (d.agentPerformance.some(a => a.firstPassRate < 50)) {
        const lowPerf = d.agentPerformance.filter(a => a.firstPassRate < 50)
        lines.push(`${d.topIssues.length + (d.runsSummary.failedRuns > 0 ? 2 : 1)}. Agent ${lowPerf.map(a => a.agentId).join('、')} 一次通过率偏低，考虑优化 Prompt 或切换 Agent`)
      }
    }
    lines.push(``)

    return lines.join('\n')
  }

  // ═══════════════ 工具方法 ═══════════════

  private getAllCachedMetrics(): RunMetrics[] {
    // 通过 MetricsCollector 的 getTrend 接口间接获取
    // 由于 MetricsCollector 没有暴露 getAllMetrics，这里用反射访问内部 cache
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cache = (this.metricsCollector as any).runMetricsCache as Map<string, RunMetrics> | undefined
    return cache ? Array.from(cache.values()) : []
  }

  private formatDate(ts: number): string {
    const d = new Date(ts)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  private formatDuration(ms: number): string {
    if (ms === 0) return '-'
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.floor((ms % 60000) / 1000)
    if (minutes > 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    if (minutes > 0) return `${minutes}m ${seconds}s`
    return `${seconds}s`
  }

  private severityWeight(s: string): number {
    return { critical: 4, high: 3, medium: 2, low: 1 }[s] || 0
  }

  private typeLabel(type: string): string {
    const labels: Record<string, string> = {
      review_reject: '审批打回',
      diff_discard: 'Diff 丢弃',
      execution_failure: '执行失败',
    }
    return labels[type] || type
  }

  private generateSuggestion(type: string, nodeName: string, count: number): string {
    if (type === 'review_reject' && count >= 3) {
      return `考虑优化「${nodeName}」的 Prompt 或增加 outputContract 约束`
    }
    if (type === 'execution_failure' && count >= 2) {
      return `排查「${nodeName}」执行环境，考虑增加超时阈值或启用 HYB 模式`
    }
    if (type === 'diff_discard') {
      return `Agent 产出与预期不符，建议在节点描述中补充更详细的需求说明`
    }
    return `持续观察，如频次上升则需针对性优化`
  }
}
