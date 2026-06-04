import { writeFile, mkdir, readFile, readdir, unlink } from 'fs/promises'
import { join } from 'path'
import type { FeedbackCollector, FeedbackStats } from './feedback-collector.js'
import type { MetricsCollector, RunMetrics } from './metrics-collector.js'
import type { AutoFlowEngine } from './auto-flow-engine.js'

// ═══════════════════════════════════════════════════
// WeeklyDigest — 周报摘要生成器（升级版）
//
// 职责：
// 1. 定期汇总 feedback + metrics 数据
// 2. 趋势分析：对比本周与上周的关键指标变化
// 3. 异常检测：基于 Z-Score 检测指标突变
// 4. 信号健康度：监控 AutoFlow 各信号分布退化
// 5. 生成结构化 Markdown 摘要
// 6. 保留最近 8 周历史快照，支持长期趋势追踪
//
// 改进点（对比旧版）：
// - 旧版只做静态汇总，无历史对比 → 新版支持多周期趋势
// - 旧版无异常检测 → 新版基于统计学 Z-Score 检测
// - 旧版无信号分析 → 新版追踪各信号分布和健康度
// - 旧版建议固定模板 → 新版基于异常 + 趋势动态生成建议
// ═══════════════════════════════════════════════════

// ─── 类型定义 ───

export interface AutoFlowMetrics {
  totalEvaluations: number
  autoApproved: number
  requireReview: number
  accuracy: number            // 自动放行准确率 (%)
  falsePositiveRate: number   // 误放率 (%)
  averageConfidence: number
  savedReviewTime: number     // 估算节省的人工审核时间 (分钟)
}

/** 趋势方向 */
export type TrendDirection = 'improving' | 'stable' | 'degrading'

/** 单个指标趋势 */
export interface MetricTrend {
  current: number
  previous: number
  changePercent: number       // 百分比变化 (正 = 提升, 负 = 下降)
  direction: TrendDirection
}

/** 趋势分析报告 */
export interface TrendAnalysis {
  runCount: MetricTrend
  completionRate: MetricTrend
  averageDuration: MetricTrend
  tokenUsage: MetricTrend
  firstPassRate: MetricTrend
  autoApproveRate?: MetricTrend
  accuracy?: MetricTrend
  overallDirection: TrendDirection
}

/** 异常检测结果 */
export interface Anomaly {
  metric: string              // 异常指标名称
  value: number               // 当前值
  mean: number                // 历史均值
  stddev: number              // 标准差
  zScore: number              // Z-Score（绝对值 > 2 为异常）
  severity: 'warning' | 'critical'   // warning: |z| > 2, critical: |z| > 3
  direction: 'spike' | 'drop'       // 飙升 or 骤降
  isNegative: boolean         // true = 这个变化对系统不利
  suggestion: string          // 自动生成的应对建议
}

/** 信号健康度条目 */
export interface SignalHealthItem {
  name: string
  mean: number
  stdDev: number
  sampleCount: number
  health: 'healthy' | 'low_variance' | 'high_variance' | 'saturated'
}

/** 信号健康度报告 */
export interface SignalHealthReport {
  signals: SignalHealthItem[]
  overallHealth: 'healthy' | 'acceptable' | 'needs_attention' | 'unknown' | 'insufficient_data'
}

/** 历史快照（存储到文件用于跨周对比） */
export interface WeeklySnapshot {
  weekId: string           // YYYY-Www 格式
  period: { start: string; end: string }
  metrics: {
    totalRuns: number
    completedRuns: number
    failedRuns: number
    averageDuration: number
    totalTokens: number
    firstPassRate: number
    feedbackTotal: number
    criticalCount: number
    highCount: number
  }
  autoFlowMetrics?: {
    totalEvaluations: number
    autoApproved: number
    accuracy: number
    falsePositiveRate: number
    averageConfidence: number
  }
  generatedAt: number
}

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
  autoFlowMetrics?: AutoFlowMetrics
  // ── 新增字段 ──
  trendAnalysis?: TrendAnalysis
  anomalies: Anomaly[]
  signalHealth: SignalHealthReport
  historicalSnapshots: WeeklySnapshot[]
  generatedAt: number
}

// ─── 服务实现 ───

export class WeeklyDigest {
  private feedbackCollector: FeedbackCollector
  private metricsCollector: MetricsCollector
  private autoFlowEngine?: AutoFlowEngine
  private outputPath: string
  private historyPath: string

  /** 异常检测阈值 */
  private static readonly Z_SCORE_WARNING = 2.0
  private static readonly Z_SCORE_CRITICAL = 3.0
  /** 趋势变化阈值：超过 ±10% 视为有意义的变化 */
  private static readonly TREND_THRESHOLD = 0.10
  /** 保留历史周数 */
  private static readonly MAX_HISTORY_WEEKS = 8

  constructor(feedbackCollector: FeedbackCollector, metricsCollector: MetricsCollector) {
    this.feedbackCollector = feedbackCollector
    this.metricsCollector = metricsCollector

    const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
    this.outputPath = join(home, '.agent-flow', 'context')
    this.historyPath = join(home, '.agent-flow', 'context', 'digest-history.json')
  }

  /**
   * 注入 AutoFlowEngine（延迟注入，避免循环依赖）
   */
  injectAutoFlow(engine: AutoFlowEngine): void {
    this.autoFlowEngine = engine
  }

  /**
   * 生成周报摘要（默认最近 7 天）
   *
   * 流程：
   * 1. 收集本期数据
   * 2. 加载历史快照
   * 3. 计算趋势分析（本期 vs 上期）
   * 4. 异常检测（本期 vs 历史均值 ± σ）
   * 5. 信号健康度分析
   * 6. 生成摘要 + 保存快照
   */
  async generate(days = 7): Promise<DigestData> {
    const endTime = Date.now()
    const startTime = endTime - days * 24 * 60 * 60 * 1000

    // 1. 获取基础数据
    const feedbackSummary = await this.feedbackCollector.getStats(days)
    const runsSummary = this.computeRunsSummary(startTime, endTime)
    const topIssues = await this.analyzeTopIssues(days)
    const agentPerformance = this.computeAgentPerformance(startTime, endTime)
    const autoFlowMetrics = this.computeAutoFlowMetrics(days)

    // 2. 加载历史快照
    const historicalSnapshots = await this.loadHistory()

    // 3. 构建当前快照
    const firstPassRate = this.computeOverallFirstPassRate(startTime, endTime)
    const currentSnapshot = this.buildSnapshot(startTime, endTime, runsSummary, firstPassRate, feedbackSummary, autoFlowMetrics)

    // 4. 计算趋势分析
    const trendAnalysis = this.computeTrendAnalysis(currentSnapshot, historicalSnapshots)

    // 5. 异常检测
    const anomalies = this.detectAnomalies(currentSnapshot, historicalSnapshots)

    // 6. 信号健康度
    const signalHealth = this.computeSignalHealth()

    const digest: DigestData = {
      period: {
        start: this.formatDate(startTime),
        end: this.formatDate(endTime),
      },
      runsSummary,
      feedbackSummary,
      topIssues,
      agentPerformance,
      autoFlowMetrics,
      trendAnalysis,
      anomalies,
      signalHealth,
      historicalSnapshots,
      generatedAt: Date.now(),
    }

    // 7. 写入 Markdown + 保存快照
    await this.writeDigestMarkdown(digest)
    await this.saveSnapshot(currentSnapshot, historicalSnapshots)

    return digest
  }

  // ═══════════════ 趋势分析 ═══════════════

  /**
   * 计算本期与上期的趋势变化
   * 对比逻辑：当前快照 vs 历史中最近一个快照
   */
  private computeTrendAnalysis(current: WeeklySnapshot, history: WeeklySnapshot[]): TrendAnalysis | undefined {
    if (history.length === 0) return undefined

    const previous = history[history.length - 1]

    const runCount = this.computeMetricTrend(current.metrics.totalRuns, previous.metrics.totalRuns)
    const completionRate = this.computeMetricTrend(
      current.metrics.totalRuns > 0 ? current.metrics.completedRuns / current.metrics.totalRuns : 0,
      previous.metrics.totalRuns > 0 ? previous.metrics.completedRuns / previous.metrics.totalRuns : 0,
    )
    const averageDuration = this.computeMetricTrend(current.metrics.averageDuration, previous.metrics.averageDuration, true)
    const tokenUsage = this.computeMetricTrend(current.metrics.totalTokens, previous.metrics.totalTokens, true)
    const firstPassRate = this.computeMetricTrend(current.metrics.firstPassRate, previous.metrics.firstPassRate)

    let autoApproveRate: MetricTrend | undefined
    let accuracy: MetricTrend | undefined
    if (current.autoFlowMetrics && previous.autoFlowMetrics) {
      const currentAutoRate = current.autoFlowMetrics.totalEvaluations > 0
        ? current.autoFlowMetrics.autoApproved / current.autoFlowMetrics.totalEvaluations
        : 0
      const previousAutoRate = previous.autoFlowMetrics.totalEvaluations > 0
        ? previous.autoFlowMetrics.autoApproved / previous.autoFlowMetrics.totalEvaluations
        : 0
      autoApproveRate = this.computeMetricTrend(currentAutoRate, previousAutoRate)
      accuracy = this.computeMetricTrend(current.autoFlowMetrics.accuracy, previous.autoFlowMetrics.accuracy)
    }

    // 计算整体方向
    const trends = [runCount, completionRate, firstPassRate]
    const improving = trends.filter(t => t.direction === 'improving').length
    const degrading = trends.filter(t => t.direction === 'degrading').length
    const overallDirection: TrendDirection = improving > degrading ? 'improving'
      : degrading > improving ? 'degrading' : 'stable'

    return { runCount, completionRate, averageDuration, tokenUsage, firstPassRate, autoApproveRate, accuracy, overallDirection }
  }

  /**
   * 计算单个指标的趋势
   * @param inverseBetter - 为 true 时，数值下降视为改善（如耗时/Token）
   */
  private computeMetricTrend(current: number, previous: number, inverseBetter = false): MetricTrend {
    const changePercent = previous !== 0
      ? ((current - previous) / previous)
      : (current > 0 ? 1.0 : 0.0)

    let direction: TrendDirection
    if (Math.abs(changePercent) < WeeklyDigest.TREND_THRESHOLD) {
      direction = 'stable'
    } else if (inverseBetter) {
      direction = changePercent < 0 ? 'improving' : 'degrading'
    } else {
      direction = changePercent > 0 ? 'improving' : 'degrading'
    }

    return { current, previous, changePercent: Math.round(changePercent * 1000) / 10, direction }
  }

  // ═══════════════ 异常检测 ═══════════════

  /**
   * 基于 Z-Score 的异常检测
   *
   * 算法：
   * 1. 从历史快照计算每个指标的均值和标准差
   * 2. 计算当前值的 Z-Score = (value - mean) / stddev
   * 3. |Z| > 2.0 → warning, |Z| > 3.0 → critical
   *
   * 需要至少 3 个历史数据点才有统计意义
   */
  private detectAnomalies(current: WeeklySnapshot, history: WeeklySnapshot[]): Anomaly[] {
    if (history.length < 3) return []

    const anomalies: Anomaly[] = []

    // 定义要检测的指标
    const metricsToCheck: Array<{
      name: string
      extractor: (s: WeeklySnapshot) => number
      higherIsBad: boolean  // true = 升高是坏事
      suggestionOnSpike: string
      suggestionOnDrop: string
    }> = [
      {
        name: '运行次数',
        extractor: s => s.metrics.totalRuns,
        higherIsBad: false,
        suggestionOnSpike: '运行次数激增，关注系统负载和资源消耗',
        suggestionOnDrop: '运行次数显著下降，请确认是否有环境/配置变更导致任务无法触发',
      },
      {
        name: '失败率',
        extractor: s => s.metrics.totalRuns > 0 ? s.metrics.failedRuns / s.metrics.totalRuns : 0,
        higherIsBad: true,
        suggestionOnSpike: '失败率异常升高，建议排查最近的代码变更或外部依赖变化',
        suggestionOnDrop: '失败率显著降低（积极变化），之前的优化正在生效',
      },
      {
        name: '平均耗时',
        extractor: s => s.metrics.averageDuration,
        higherIsBad: true,
        suggestionOnSpike: '执行耗时异常增加，可能是上下文过长或外部 API 响应变慢',
        suggestionOnDrop: '耗时显著缩短（积极变化），性能优化效果显现',
      },
      {
        name: 'Token消耗',
        extractor: s => s.metrics.totalTokens,
        higherIsBad: true,
        suggestionOnSpike: 'Token 消耗异常增长，建议检查 Prompt 是否有不必要的膨胀或循环重试',
        suggestionOnDrop: 'Token 消耗显著减少（积极变化），Prompt 精简或重试减少',
      },
      {
        name: '一次通过率',
        extractor: s => s.metrics.firstPassRate,
        higherIsBad: false,
        suggestionOnSpike: '一次通过率显著提升（积极变化），Agent 能力持续增强',
        suggestionOnDrop: '一次通过率异常下降，可能是 Agent Prompt 退化或需求复杂度上升',
      },
      {
        name: '严重问题数',
        extractor: s => s.metrics.criticalCount + s.metrics.highCount,
        higherIsBad: true,
        suggestionOnSpike: '高严重度问题激增，优先排查 critical 级反馈涉及的节点',
        suggestionOnDrop: '高严重度问题减少（积极变化），系统稳定性提升',
      },
    ]

    // 如果有 AutoFlow 指标，增加监控
    if (current.autoFlowMetrics && history.filter(h => h.autoFlowMetrics).length >= 3) {
      metricsToCheck.push(
        {
          name: 'AutoFlow误放率',
          extractor: s => s.autoFlowMetrics?.falsePositiveRate ?? 0,
          higherIsBad: true,
          suggestionOnSpike: '误放率异常升高，建议提高 confidenceThreshold 或检查信号可靠性',
          suggestionOnDrop: '误放率显著降低（积极变化），信号校准效果良好',
        },
        {
          name: 'AutoFlow平均信心分',
          extractor: s => s.autoFlowMetrics?.averageConfidence ?? 50,
          higherIsBad: false,
          suggestionOnSpike: '平均信心分显著提升（积极变化），模型信号越来越准确',
          suggestionOnDrop: '平均信心分骤降，可能信号数据质量下降或新类型任务引入',
        },
      )
    }

    for (const metric of metricsToCheck) {
      const historicalValues = history.map(h => metric.extractor(h))
      const currentValue = metric.extractor(current)

      const { mean, stddev } = this.computeStats(historicalValues)
      if (stddev === 0) continue  // 无方差，无法判断异常

      const zScore = (currentValue - mean) / stddev

      if (Math.abs(zScore) >= WeeklyDigest.Z_SCORE_WARNING) {
        const direction: 'spike' | 'drop' = zScore > 0 ? 'spike' : 'drop'
        const isNegative = metric.higherIsBad ? direction === 'spike' : direction === 'drop'

        anomalies.push({
          metric: metric.name,
          value: currentValue,
          mean: Math.round(mean * 1000) / 1000,
          stddev: Math.round(stddev * 1000) / 1000,
          zScore: Math.round(zScore * 100) / 100,
          severity: Math.abs(zScore) >= WeeklyDigest.Z_SCORE_CRITICAL ? 'critical' : 'warning',
          direction,
          isNegative,
          suggestion: direction === 'spike' ? metric.suggestionOnSpike : metric.suggestionOnDrop,
        })
      }
    }

    // 按严重度排序：critical 优先，然后是 negative 优先
    return anomalies.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1
      if (a.isNegative !== b.isNegative) return a.isNegative ? -1 : 1
      return Math.abs(b.zScore) - Math.abs(a.zScore)
    })
  }

  // ═══════════════ 信号健康度 ═══════════════

  /**
   * 分析 AutoFlow 各信号的分布健康度
   *
   * 退化检测：如果某个信号所有值都集中在同一区间（如全部 > 0.95），
   * 则该信号失去了区分能力，标记为 saturated
   */
  private computeSignalHealth(): SignalHealthReport {
    if (!this.autoFlowEngine) return { signals: [], overallHealth: 'unknown' }

    const auditLog = this.autoFlowEngine.getAuditLog()
    if (auditLog.length < 5) return { signals: [], overallHealth: 'insufficient_data' }

    const signalNames = ['feedbackPositive', 'contextRelevance', 'historicalPassRate', 'outputQuality', 'executionStability', 'mergeConflictFree'] as const
    const signals: SignalHealthItem[] = []

    for (const name of signalNames) {
      const values = auditLog
        .map(entry => entry.signals[name as keyof typeof entry.signals] as number | undefined)
        .filter((v): v is number => typeof v === 'number')

      if (values.length < 5) continue

      const { mean, stddev } = this.computeStats(values)

      // 健康度判断
      let health: SignalHealthItem['health']
      if (mean > 0.95 && stddev < 0.05) {
        health = 'saturated' // 信号总是接近 1.0，没有区分度
      } else if (stddev < 0.02) {
        health = 'low_variance' // 方差过低，信号缺乏区分能力
      } else if (stddev > 0.4) {
        health = 'high_variance' // 方差过高，信号不稳定
      } else {
        health = 'healthy'
      }

      signals.push({
        name,
        mean: Math.round(mean * 1000) / 1000,
        stdDev: Math.round(stddev * 1000) / 1000,
        sampleCount: values.length,
        health,
      })
    }

    const unhealthyCount = signals.filter(s => s.health !== 'healthy').length
    const overallHealth: SignalHealthReport['overallHealth'] =
      unhealthyCount === 0 ? 'healthy' :
        unhealthyCount <= 1 ? 'acceptable' : 'needs_attention'

    return { signals, overallHealth }
  }

  // ═══════════════ 历史快照管理 ═══════════════

  private buildSnapshot(
    startTime: number,
    endTime: number,
    runsSummary: DigestData['runsSummary'],
    firstPassRate: number,
    feedbackSummary: FeedbackStats,
    autoFlowMetrics?: AutoFlowMetrics,
  ): WeeklySnapshot {
    const weekId = this.getWeekId(endTime)

    return {
      weekId,
      period: { start: this.formatDate(startTime), end: this.formatDate(endTime) },
      metrics: {
        totalRuns: runsSummary.totalRuns,
        completedRuns: runsSummary.completedRuns,
        failedRuns: runsSummary.failedRuns,
        averageDuration: runsSummary.averageDuration,
        totalTokens: runsSummary.totalTokens,
        firstPassRate,
        feedbackTotal: feedbackSummary.total,
        criticalCount: feedbackSummary.bySeverity.critical,
        highCount: feedbackSummary.bySeverity.high,
      },
      autoFlowMetrics: autoFlowMetrics ? {
        totalEvaluations: autoFlowMetrics.totalEvaluations,
        autoApproved: autoFlowMetrics.autoApproved,
        accuracy: autoFlowMetrics.accuracy,
        falsePositiveRate: autoFlowMetrics.falsePositiveRate,
        averageConfidence: autoFlowMetrics.averageConfidence,
      } : undefined,
      generatedAt: Date.now(),
    }
  }

  private getWeekId(timestamp: number): string {
    const d = new Date(timestamp)
    const yearStart = new Date(d.getFullYear(), 0, 1)
    const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + yearStart.getDay() + 1) / 7)
    return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
  }

  private async loadHistory(): Promise<WeeklySnapshot[]> {
    try {
      const raw = await readFile(this.historyPath, 'utf-8')
      const history = JSON.parse(raw) as WeeklySnapshot[]
      return history.slice(-WeeklyDigest.MAX_HISTORY_WEEKS)
    } catch {
      return []
    }
  }

  private async saveSnapshot(current: WeeklySnapshot, history: WeeklySnapshot[]): Promise<void> {
    // 去重：如果已有同一 weekId，替换之
    const filtered = history.filter(h => h.weekId !== current.weekId)
    filtered.push(current)

    // 只保留最近 N 周
    const trimmed = filtered.slice(-WeeklyDigest.MAX_HISTORY_WEEKS)

    await mkdir(this.outputPath, { recursive: true })
    await writeFile(this.historyPath, JSON.stringify(trimmed, null, 2), 'utf-8')
  }

  // ═══════════════ 基础数据计算 ═══════════════

  private computeRunsSummary(startTime: number, endTime: number) {
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

  private computeOverallFirstPassRate(startTime: number, endTime: number): number {
    const allMetrics = this.getAllCachedMetrics()
    const periodMetrics = allMetrics.filter(m => m.createdAt >= startTime && m.createdAt <= endTime)

    let totalNodes = 0
    let firstPassNodes = 0
    for (const rm of periodMetrics) {
      for (const nm of rm.nodeMetrics) {
        totalNodes++
        if (nm.firstPassApproved) firstPassNodes++
      }
    }
    return totalNodes > 0 ? firstPassNodes / totalNodes : 0
  }

  private async analyzeTopIssues(days: number) {
    const feedbacks = await this.feedbackCollector.query({
      startTime: Date.now() - days * 24 * 60 * 60 * 1000,
    })

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

  private computeAutoFlowMetrics(days = 7): AutoFlowMetrics | undefined {
    if (!this.autoFlowEngine) return undefined

    const stats = this.autoFlowEngine.getAutoFlowStats(days)
    if (stats.totalEvaluations === 0) return undefined

    const totalAutoApproveDecisions = stats.autoApproveCorrect + stats.autoApproveIncorrect
    const accuracy = totalAutoApproveDecisions > 0
      ? Math.round((stats.autoApproveCorrect / totalAutoApproveDecisions) * 100)
      : 100

    const falsePositiveRate = totalAutoApproveDecisions > 0
      ? Math.round((stats.autoApproveIncorrect / totalAutoApproveDecisions) * 100)
      : 0

    const savedReviewTime = stats.autoApproveCorrect * 2

    return {
      totalEvaluations: stats.totalEvaluations,
      autoApproved: stats.autoApproved,
      requireReview: stats.requireReview,
      accuracy,
      falsePositiveRate,
      averageConfidence: stats.averageConfidence,
      savedReviewTime,
    }
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

    // 归档历史
    await this.archiveDigest(digest)
  }

  private async archiveDigest(digest: DigestData): Promise<void> {
    const archivePath = join(this.outputPath, 'digest-history')
    await mkdir(archivePath, { recursive: true })
    const filename = `digest-${digest.period.start}-to-${digest.period.end}.json`
    await writeFile(join(archivePath, filename), JSON.stringify(digest, null, 2), 'utf-8')

    // 清理超过 8 周的归档文件
    try {
      const files = await readdir(archivePath)
      const digestFiles = files.filter(f => f.startsWith('digest-') && f.endsWith('.json')).sort()
      if (digestFiles.length > WeeklyDigest.MAX_HISTORY_WEEKS) {
        const toDelete = digestFiles.slice(0, digestFiles.length - WeeklyDigest.MAX_HISTORY_WEEKS)
        for (const f of toDelete) {
          await unlink(join(archivePath, f))
        }
      }
    } catch {
      // 归档清理失败不影响主流程
    }
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

    // 趋势分析（新增）
    if (d.trendAnalysis) {
      const ta = d.trendAnalysis
      const dirIcon = { improving: '📈', degrading: '📉', stable: '➡️' }
      const dirLabel = { improving: '向好', degrading: '恶化', stable: '平稳' }
      lines.push(`## 趋势分析`)
      lines.push(``)
      lines.push(`整体趋势：${dirIcon[ta.overallDirection]} **${dirLabel[ta.overallDirection]}**`)
      lines.push(``)
      lines.push(`| 指标 | 上周 | 本周 | 变化 | 方向 |`)
      lines.push(`|------|------|------|------|------|`)
      this.appendTrendRow(lines, '运行次数', ta.runCount)
      this.appendTrendRow(lines, '完成率', ta.completionRate, true)
      this.appendTrendRow(lines, '平均耗时', ta.averageDuration, false, true)
      this.appendTrendRow(lines, 'Token 消耗', ta.tokenUsage)
      this.appendTrendRow(lines, '一次通过率', ta.firstPassRate, true)
      if (ta.autoApproveRate) this.appendTrendRow(lines, '自动放行率', ta.autoApproveRate, true)
      if (ta.accuracy) this.appendTrendRow(lines, '放行准确率', ta.accuracy, true)
      lines.push(``)
    }

    // 异常检测（新增）
    if (d.anomalies.length > 0) {
      lines.push(`## ⚠️ 异常检测`)
      lines.push(``)
      const negativeAnomalies = d.anomalies.filter(a => a.isNegative)
      const positiveAnomalies = d.anomalies.filter(a => !a.isNegative)

      if (negativeAnomalies.length > 0) {
        lines.push(`### 需要关注`)
        lines.push(``)
        for (const a of negativeAnomalies) {
          const icon = a.severity === 'critical' ? '🔴' : '🟡'
          lines.push(`${icon} **${a.metric}** — ${a.suggestion}（Z=${a.zScore}, 均值=${a.mean}）`)
        }
        lines.push(``)
      }

      if (positiveAnomalies.length > 0) {
        lines.push(`### 积极变化`)
        lines.push(``)
        for (const a of positiveAnomalies) {
          lines.push(`🟢 **${a.metric}** — ${a.suggestion}（Z=${a.zScore}）`)
        }
        lines.push(``)
      }
    }

    // 信号健康度（新增）
    if (d.signalHealth.signals.length > 0) {
      lines.push(`## 信号健康度`)
      lines.push(``)
      const healthLabel: Record<string, string> = {
        healthy: '✅ 正常',
        low_variance: '⚠️ 区分度不足',
        high_variance: '⚠️ 不稳定',
        saturated: '⚠️ 饱和',
      }
      lines.push(`| 信号 | 均值 | 标准差 | 样本数 | 状态 |`)
      lines.push(`|------|------|--------|--------|------|`)
      for (const sig of d.signalHealth.signals) {
        lines.push(`| ${sig.name} | ${sig.mean} | ${sig.stdDev} | ${sig.sampleCount} | ${healthLabel[sig.health]} |`)
      }
      lines.push(``)
      const saturated = d.signalHealth.signals.filter(s => s.health === 'saturated')
      if (saturated.length > 0) {
        lines.push(`> 💡 饱和信号（${saturated.map(s => s.name).join('、')}）总是接近 1.0，对决策贡献有限。建议调低其权重或引入更精细的计算逻辑。`)
        lines.push(``)
      }
    }

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

    // AutoFlow 自动放行准确率
    if (d.autoFlowMetrics) {
      const af = d.autoFlowMetrics
      lines.push(`## AutoFlow 自动放行`)
      lines.push(``)
      lines.push(`| 指标 | 数值 |`)
      lines.push(`|------|------|`)
      lines.push(`| 总评估次数 | ${af.totalEvaluations} |`)
      lines.push(`| 自动通过 | ${af.autoApproved} |`)
      lines.push(`| 需人工审核 | ${af.requireReview} |`)
      lines.push(`| 放行准确率 | ${af.accuracy}% |`)
      lines.push(`| 误放率 | ${af.falsePositiveRate}% |`)
      lines.push(`| 平均信心分 | ${af.averageConfidence} |`)
      lines.push(`| 节省审核时间 | ~${af.savedReviewTime} 分钟 |`)
      lines.push(``)
      if (af.falsePositiveRate > 10) {
        lines.push(`⚠️ 误放率较高（>${af.falsePositiveRate}%），建议提高 confidenceThreshold 或检查信号权重配置。`)
        lines.push(``)
      }
      if (af.accuracy >= 95) {
        lines.push(`✅ 自动放行准确率优秀（${af.accuracy}%），可考虑适当降低 confidenceThreshold 以提升自动化率。`)
        lines.push(``)
      }
    }

    // 下一步建议（升级版 — 结合异常 + 趋势 + 信号健康）
    lines.push(`## 下一步建议`)
    lines.push(``)
    if (d.feedbackSummary.total === 0 && d.runsSummary.totalRuns === 0) {
      lines.push(`本周暂无执行数据。开始使用 AgentFlow 执行真实任务后，此处将自动生成优化建议。`)
    } else {
      lines.push(`基于本周数据，建议关注：`)
      let idx = 1

      // 异常驱动的建议（最高优先级）
      for (const anomaly of d.anomalies.filter(a => a.isNegative)) {
        lines.push(`${idx}. 🚨 ${anomaly.suggestion}`)
        idx++
        if (idx > 3) break  // 最多展示 3 条异常建议
      }

      // 趋势驱动的建议
      if (d.trendAnalysis?.overallDirection === 'degrading') {
        lines.push(`${idx}. 📉 系统整体趋势恶化，建议重点排查退化最严重的指标`)
        idx++
      }

      // 传统建议
      if (d.topIssues.length > 0) {
        lines.push(`${idx}. 优先解决高频问题「${d.topIssues[0].pattern}」（出现 ${d.topIssues[0].count} 次）`)
        idx++
      }
      if (d.runsSummary.failedRuns > 0) {
        lines.push(`${idx}. 排查 ${d.runsSummary.failedRuns} 个失败 Run 的根因`)
        idx++
      }
      if (d.agentPerformance.some(a => a.firstPassRate < 50)) {
        const lowPerf = d.agentPerformance.filter(a => a.firstPassRate < 50)
        lines.push(`${idx}. Agent ${lowPerf.map(a => a.agentId).join('、')} 一次通过率偏低，考虑优化 Prompt 或切换 Agent`)
        idx++
      }

      // 信号健康建议
      const saturated = d.signalHealth.signals.filter(s => s.health === 'saturated')
      if (saturated.length > 0) {
        lines.push(`${idx}. 信号 ${saturated.map(s => s.name).join('、')} 处于饱和状态，建议引入更精细的评估逻辑或降低权重`)
      }
    }
    lines.push(``)

    return lines.join('\n')
  }

  private appendTrendRow(lines: string[], label: string, trend: MetricTrend, isPercent = false, isDuration = false): void {
    const dirIcon = { improving: '📈', degrading: '📉', stable: '➡️' }
    const formatVal = (v: number) => {
      if (isDuration) return this.formatDuration(v)
      if (isPercent) return `${Math.round(v * 100)}%`
      return v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(Math.round(v))
    }
    const changeStr = trend.changePercent >= 0 ? `+${trend.changePercent}%` : `${trend.changePercent}%`
    lines.push(`| ${label} | ${formatVal(trend.previous)} | ${formatVal(trend.current)} | ${changeStr} | ${dirIcon[trend.direction]} |`)
  }

  // ═══════════════ 统计工具方法 ═══════════════

  private computeStats(values: number[]): { mean: number; stddev: number } {
    if (values.length === 0) return { mean: 0, stddev: 0 }
    const mean = values.reduce((s, v) => s + v, 0) / values.length
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
    return { mean, stddev: Math.sqrt(variance) }
  }

  // ═══════════════ 通用工具方法 ═══════════════

  private getAllCachedMetrics(): RunMetrics[] {
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
