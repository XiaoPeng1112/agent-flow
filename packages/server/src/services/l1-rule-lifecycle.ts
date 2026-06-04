import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import type { ContextDBService } from './context-db.js'
import type { FeedbackCollector } from './feedback-collector.js'

// ═══════════════════════════════════════════════════════════════════
// L1RuleLifecycleService — L1 规则生命周期管理
//
// 设计文档参考：深化方案 Phase 4 - L1 沉淀升级
//
// 核心职责：
// 1. 管理自动沉淀的 L1 质量规则的完整生命周期
// 2. 规则状态：draft → active → decaying → deprecated → archived
// 3. 规则版本化：每次更新保留历史版本，支持回溯
// 4. 规则有效性追踪：监控规则沉淀后的 reject 率变化
// 5. 自动衰减：长期未触发的规则逐步降级
// 6. 规则合并：语义相似的规则自动聚合
//
// 设计原则：
// - 规则不永久存在：无效规则自动衰减并最终归档
// - 版本化存储：每次修改产生新版本号，可追溯
// - 效果度量：规则生效后持续监控该类节点的 reject 率
// - 对 ContextDB 的写入最终落地为 Markdown 文件
// ═══════════════════════════════════════════════════════════════════

// ═══════════════ 类型定义 ═══════════════

/** 规则生命周期状态 */
export type RuleLifecycleStatus =
  | 'draft'       // 刚生成，等待首次验证
  | 'active'      // 生效中，正在被 Agent 消费
  | 'decaying'    // 衰减中（长期未触发 reject）
  | 'deprecated'  // 已废弃（经验证无效或手动废弃）
  | 'archived'    // 已归档（从 L1 context 中移除，保留历史记录）

/** 规则严重级别 */
export type RuleSeverity = 'critical' | 'high' | 'medium' | 'low'

/** 单条规则项（一个 reject 原因聚合后的条目） */
export interface RuleItem {
  /** 规则描述（从 reject 原因聚合） */
  description: string
  /** 出现频率 */
  frequency: number
  /** 严重程度 */
  severity: RuleSeverity
  /** 示例（首次出现时的具体 reject 内容） */
  example?: string
  /** 首次出现时间 */
  firstSeen: number
  /** 最后出现时间 */
  lastSeen: number
}

/** 版本变更记录 */
export interface RuleChangelogEntry {
  version: number
  timestamp: number
  description: string
  changes: string[]
}

/** 规则效果度量 */
export interface RuleEffectiveness {
  /** 规则生效前该类节点的基线 reject 率 */
  baselineRejectRate: number
  /** 当前 reject 率（规则生效后） */
  currentRejectRate: number
  /** 规则生效后的总样本数 */
  postRuleSamples: number
  /** 规则生效后的 reject 数 */
  postRuleRejects: number
  /** 改善率 = (baseline - current) / baseline */
  improvementRate: number
  /** 最后度量时间 */
  lastMeasuredAt: number
}

/** 规则衰减信息 */
export interface RuleDecayInfo {
  /** 最后一次有相关 reject 的时间 */
  lastTriggeredAt: number
  /** 自上次触发以来的天数 */
  daysSinceLastTrigger: number
  /** 衰减分数 (1.0 = 完全活跃, 0.0 = 完全衰减) */
  decayScore: number
}

/** L1 规则完整结构 */
export interface L1Rule {
  /** 唯一标识："{templateId}:{nodeName}:{创建时间戳的36进制}" */
  id: string
  /** 所属模板 ID */
  templateId: string
  /** 关联节点名称（模板级，非实例级） */
  nodeName: string
  /** 当前状态 */
  status: RuleLifecycleStatus
  /** 版本号（从 1 开始，每次更新 +1） */
  version: number
  /** 规则项列表（聚合后的检查要点） */
  items: RuleItem[]
  /** 触发沉淀的 reject 总次数 */
  totalTriggerCount: number
  /** 效果度量 */
  effectiveness: RuleEffectiveness
  /** 衰减信息 */
  decayInfo: RuleDecayInfo
  /** 创建时间 */
  createdAt: number
  /** 最后更新时间 */
  updatedAt: number
  /** 变更历史 */
  changelog: RuleChangelogEntry[]
}

/** 沉淀请求参数（由 AutoFlowEngine 传入） */
export interface SedimentationRequest {
  templateId: string
  nodeName: string
  reasons: Array<{ reason: string; count: number }>
  totalRejects: number
}

/** 持久化状态结构 */
interface PersistedL1RuleState {
  version: 1
  persistedAt: number
  rules: Record<string, L1Rule>
}

// ═══════════════ 配置常量 ═══════════════

/** 衰减配置 */
const DECAY_CONFIG = {
  /** 从活跃到开始衰减的天数（无 reject 触发） */
  GRACE_PERIOD_DAYS: 30,
  /** 从开始衰减到归档的天数 */
  DECAY_DURATION_DAYS: 60,
  /** 无效判定阈值：改善率 < 此值且样本量足够 → deprecated */
  INEFFECTIVE_THRESHOLD: 0.05,
  /** 最小样本量（低于此值不做有效性判定） */
  MIN_EFFECTIVENESS_SAMPLES: 10,
} as const

/** 规则合并配置 */
const MERGE_CONFIG = {
  /** 词汇重叠率阈值（超过此值认为可合并） */
  SIMILARITY_THRESHOLD: 0.6,
  /** 同一节点名下最大活跃规则数 */
  MAX_ACTIVE_RULES_PER_NODE: 5,
} as const

// ═══════════════ 服务实现 ═══════════════

export class L1RuleLifecycleService {
  private contextDB?: ContextDBService
  private feedbackCollector?: FeedbackCollector

  /** 规则索引 */
  private rules: Map<string, L1Rule> = new Map()

  /** 存储路径 */
  private storagePath: string

  /** 定期维护定时器 */
  private maintenanceTimer?: ReturnType<typeof setInterval>

  /** 持久化防抖定时器 */
  private persistTimer?: ReturnType<typeof setTimeout>

  constructor() {
    const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
    this.storagePath = join(home, '.agent-flow', 'l1-rules')
  }

  /**
   * 注入依赖
   */
  inject(deps: {
    contextDB: ContextDBService
    feedbackCollector: FeedbackCollector
  }): void {
    this.contextDB = deps.contextDB
    this.feedbackCollector = deps.feedbackCollector
  }

  /**
   * 启动服务：恢复持久化状态 + 启动定期维护
   */
  async start(): Promise<void> {
    await this.loadRules()
    // 每小时执行一次维护（衰减检查 + 有效性评估）
    this.maintenanceTimer = setInterval(() => {
      this.runMaintenance().catch(err => {
        console.warn('[L1Lifecycle] Maintenance error:', (err as Error).message)
      })
    }, 60 * 60 * 1000)
  }

  /**
   * 停止服务：清理定时器 + 刷写状态
   */
  async stop(): Promise<void> {
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer)
      this.maintenanceTimer = undefined
    }
    await this.flushRules()
  }

  // ═══════════════ 沉淀入口（核心接口） ═══════════════

  /**
   * 沉淀规则（由 AutoFlowEngine.checkAndSedimentToL1 调用）
   *
   * 流程：
   * 1. 检查是否有可合并的已有规则
   * 2. 有 → 更新已有规则（版本+1）
   * 3. 无 → 创建新规则
   * 4. 写入 L1 Context 文件
   * 5. 触发持久化
   *
   * @returns 创建或更新的规则
   */
  async sediment(request: SedimentationRequest): Promise<L1Rule> {
    const { templateId, nodeName, reasons, totalRejects } = request

    // 查找同模板同节点的可合并目标
    const existingActive = this.findRulesForNode(templateId, nodeName)
      .filter(r => r.status === 'active' || r.status === 'draft' || r.status === 'decaying')

    const mergeTarget = this.findMergeCandidate(existingActive, reasons)

    let rule: L1Rule
    if (mergeTarget) {
      rule = this.mergeIntoRule(mergeTarget, reasons, totalRejects)
    } else {
      rule = this.createNewRule(templateId, nodeName, reasons, totalRejects)
    }

    // 如果衰减中的规则被触发，恢复
    if (rule.status === 'decaying') {
      rule.status = 'active'
      rule.decayInfo.decayScore = 1.0
    }

    // 限制每个节点的活跃规则数
    await this.enforceMaxRulesPerNode(templateId, nodeName)

    // 同步到 ContextDB
    await this.syncRuleToContext(rule)

    // 持久化
    this.schedulePersist()

    console.log(`[L1Lifecycle] Rule ${mergeTarget ? 'merged' : 'created'}: ${rule.id} (v${rule.version}, status=${rule.status})`)
    return rule
  }

  /**
   * 记录规则被触发（有新的 reject 命中已有规则的节点）
   *
   * 作用：
   * - 重置衰减计时
   * - 如果处于衰减中，恢复为活跃
   * - 累加效果度量的 postRuleRejects
   */
  recordTrigger(templateId: string, nodeName: string): void {
    const rules = this.findRulesForNode(templateId, nodeName)
      .filter(r => r.status === 'active' || r.status === 'decaying')

    const now = Date.now()
    for (const rule of rules) {
      rule.decayInfo.lastTriggeredAt = now
      rule.decayInfo.daysSinceLastTrigger = 0

      // 衰减恢复
      if (rule.status === 'decaying') {
        rule.status = 'active'
        rule.decayInfo.decayScore = 1.0
        rule.changelog.push({
          version: rule.version,
          timestamp: now,
          description: '衰减恢复：新的相关 reject 触发',
          changes: ['status: decaying → active', 'decayScore → 1.0'],
        })
        console.log(`[L1Lifecycle] Rule recovered: ${rule.id}`)
      }

      // 效果度量
      rule.effectiveness.postRuleRejects++
      rule.effectiveness.postRuleSamples++
    }

    this.schedulePersist()
  }

  /**
   * 记录节点被通过（该节点没有被 reject）
   * 用于效果度量——正样本
   */
  recordApproval(templateId: string, nodeName: string): void {
    const rules = this.findRulesForNode(templateId, nodeName)
      .filter(r => r.status === 'active')

    for (const rule of rules) {
      rule.effectiveness.postRuleSamples++
    }

    // 不需要频繁持久化通过记录（maintenance 周期会保存）
  }

  // ═══════════════ 管理接口 ═══════════════

  /**
   * 手动激活规则
   */
  async activateRule(ruleId: string): Promise<boolean> {
    const rule = this.rules.get(ruleId)
    if (!rule || (rule.status !== 'draft' && rule.status !== 'decaying')) return false

    const prevStatus = rule.status
    rule.status = 'active'
    rule.updatedAt = Date.now()
    rule.changelog.push({
      version: rule.version,
      timestamp: Date.now(),
      description: '手动激活',
      changes: [`status: ${prevStatus} → active`],
    })

    await this.syncRuleToContext(rule)
    this.schedulePersist()
    return true
  }

  /**
   * 手动废弃规则
   */
  async deprecateRule(ruleId: string, reason: string): Promise<boolean> {
    const rule = this.rules.get(ruleId)
    if (!rule || rule.status === 'archived' || rule.status === 'deprecated') return false

    const prevStatus = rule.status
    rule.status = 'deprecated'
    rule.updatedAt = Date.now()
    rule.changelog.push({
      version: rule.version,
      timestamp: Date.now(),
      description: `手动废弃: ${reason}`,
      changes: [`status: ${prevStatus} → deprecated`],
    })

    await this.removeRuleFromContext(rule)
    this.schedulePersist()
    return true
  }

  /**
   * 检查某个节点是否已有沉淀规则（供 AutoFlowEngine 快速判断）
   */
  hasActiveRules(templateId: string, nodeName: string): boolean {
    return this.findRulesForNode(templateId, nodeName)
      .some(r => r.status === 'active' || r.status === 'draft')
  }

  // ═══════════════ 查询接口 ═══════════════

  /**
   * 获取某模板下所有规则
   */
  getRulesForTemplate(templateId: string): L1Rule[] {
    return Array.from(this.rules.values())
      .filter(r => r.templateId === templateId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /**
   * 获取某节点的活跃规则
   */
  getActiveRulesForNode(templateId: string, nodeName: string): L1Rule[] {
    return this.findRulesForNode(templateId, nodeName)
      .filter(r => r.status === 'active' || r.status === 'draft')
  }

  /**
   * 获取全局规则统计
   */
  getStats(): {
    total: number
    byStatus: Record<RuleLifecycleStatus, number>
    averageEffectiveness: number
    topEffective: Array<{ ruleId: string; nodeName: string; improvement: number }>
    decayingCount: number
  } {
    const byStatus: Record<RuleLifecycleStatus, number> = {
      draft: 0, active: 0, decaying: 0, deprecated: 0, archived: 0,
    }

    let totalImprovement = 0
    let measuredCount = 0
    const effectiveRules: Array<{ ruleId: string; nodeName: string; improvement: number }> = []

    for (const rule of this.rules.values()) {
      byStatus[rule.status]++
      if (rule.effectiveness.postRuleSamples >= DECAY_CONFIG.MIN_EFFECTIVENESS_SAMPLES) {
        this.updateEffectivenessMetrics(rule)
        totalImprovement += rule.effectiveness.improvementRate
        measuredCount++
        if (rule.effectiveness.improvementRate > 0.1) {
          effectiveRules.push({
            ruleId: rule.id,
            nodeName: rule.nodeName,
            improvement: rule.effectiveness.improvementRate,
          })
        }
      }
    }

    effectiveRules.sort((a, b) => b.improvement - a.improvement)

    return {
      total: this.rules.size,
      byStatus,
      averageEffectiveness: measuredCount > 0 ? totalImprovement / measuredCount : 0,
      topEffective: effectiveRules.slice(0, 5),
      decayingCount: byStatus.decaying,
    }
  }

  /**
   * 立即持久化（供优雅退出时调用）
   */
  async flushRules(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = undefined
    }
    await this.persistRules()
  }

  // ═══════════════ 规则创建与合并 ═══════════════

  private findRulesForNode(templateId: string, nodeName: string): L1Rule[] {
    return Array.from(this.rules.values())
      .filter(r => r.templateId === templateId && r.nodeName === nodeName)
  }

  /**
   * 查找可合并的目标规则
   * 
   * 合并标准：同一节点下的规则，如果新的 reject 原因与已有规则
   * 在词汇上有足够重叠（Jaccard 系数 > 阈值），则合并
   */
  private findMergeCandidate(
    existingRules: L1Rule[],
    newReasons: Array<{ reason: string; count: number }>
  ): L1Rule | null {
    if (existingRules.length === 0) return null

    const newText = newReasons.map(r => r.reason).join(' ')
    const newTokens = this.tokenize(newText)

    let bestMatch: L1Rule | null = null
    let bestSimilarity = 0

    for (const rule of existingRules) {
      const ruleText = rule.items.map(item => item.description).join(' ')
      const ruleTokens = this.tokenize(ruleText)
      const similarity = this.jaccardSimilarity(newTokens, ruleTokens)

      if (similarity >= MERGE_CONFIG.SIMILARITY_THRESHOLD && similarity > bestSimilarity) {
        bestMatch = rule
        bestSimilarity = similarity
      }
    }

    return bestMatch
  }

  /**
   * 合并新的 reject 原因到已有规则
   */
  private mergeIntoRule(
    rule: L1Rule,
    reasons: Array<{ reason: string; count: number }>,
    totalRejects: number
  ): L1Rule {
    // 保存当前版本到历史
    rule.changelog.push({
      version: rule.version,
      timestamp: Date.now(),
      description: `合并 ${reasons.length} 条新 reject 原因（累计 ${totalRejects} 次）`,
      changes: reasons.map(r => `新增: ${r.reason.slice(0, 50)}`),
    })
    rule.version++

    // 合并规则项
    const now = Date.now()
    for (const r of reasons) {
      const existing = rule.items.find(
        item => this.jaccardSimilarity(
          this.tokenize(item.description),
          this.tokenize(r.reason)
        ) >= 0.7
      )

      if (existing) {
        existing.frequency += r.count
        existing.lastSeen = now
      } else {
        rule.items.push({
          description: r.reason,
          frequency: r.count,
          severity: r.count >= 5 ? 'high' : r.count >= 3 ? 'medium' : 'low',
          example: r.reason,
          firstSeen: now,
          lastSeen: now,
        })
      }
    }

    // 按频率排序，保留 top-8
    rule.items.sort((a, b) => b.frequency - a.frequency)
    if (rule.items.length > 8) {
      rule.items = rule.items.slice(0, 8)
    }

    rule.totalTriggerCount += totalRejects
    rule.updatedAt = now

    // draft 规则在累计触发 >= 5 次后自动激活
    if (rule.status === 'draft' && rule.totalTriggerCount >= 5) {
      rule.status = 'active'
    }

    this.rules.set(rule.id, rule)
    return rule
  }

  /**
   * 创建新规则
   */
  private createNewRule(
    templateId: string,
    nodeName: string,
    reasons: Array<{ reason: string; count: number }>,
    totalRejects: number
  ): L1Rule {
    const now = Date.now()
    const ruleId = `${templateId}:${nodeName}:${now.toString(36)}`

    const items: RuleItem[] = reasons
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map(r => ({
        description: r.reason,
        frequency: r.count,
        severity: r.count >= 5 ? 'high' as RuleSeverity : r.count >= 3 ? 'medium' as RuleSeverity : 'low' as RuleSeverity,
        example: r.reason,
        firstSeen: now,
        lastSeen: now,
      }))

    const rule: L1Rule = {
      id: ruleId,
      templateId,
      nodeName,
      status: totalRejects >= 5 ? 'active' : 'draft',
      version: 1,
      items,
      totalTriggerCount: totalRejects,
      effectiveness: {
        baselineRejectRate: this.estimateBaselineRejectRate(nodeName),
        currentRejectRate: 0,
        postRuleSamples: 0,
        postRuleRejects: 0,
        improvementRate: 0,
        lastMeasuredAt: now,
      },
      decayInfo: {
        lastTriggeredAt: now,
        daysSinceLastTrigger: 0,
        decayScore: 1.0,
      },
      createdAt: now,
      updatedAt: now,
      changelog: [{
        version: 1,
        timestamp: now,
        description: `初始创建，触发条件: ${totalRejects} 次 reject`,
        changes: reasons.map(r => `${r.reason.slice(0, 50)} (×${r.count})`),
      }],
    }

    this.rules.set(ruleId, rule)
    return rule
  }

  /**
   * 估算规则生效前的基线 reject 率
   */
  private estimateBaselineRejectRate(nodeName: string): number {
    if (!this.feedbackCollector) return 0.5

    const rejects = this.feedbackCollector.getRecentRejectsByNodeName(nodeName, 20)
    const totalRejectCount = rejects.reduce((sum, r) => sum + r.count, 0)
    // 粗略估计：假设通过率约 67%（即 rejects 占总样本的 1/3）
    const estimatedTotal = Math.max(totalRejectCount * 3, 1)
    return totalRejectCount / estimatedTotal
  }

  // ═══════════════ Context 同步 ═══════════════

  /**
   * 将规则同步到 ContextDB（L1 层级）
   * 只有 active 和 draft 状态的规则会写入 Context
   */
  private async syncRuleToContext(rule: L1Rule): Promise<void> {
    if (!this.contextDB) return
    if (rule.status !== 'active' && rule.status !== 'draft') return

    const filename = this.getRuleFilename(rule.nodeName)
    const content = this.generateRuleMarkdown(rule)
    await this.contextDB.upsertContext('L1', rule.templateId, filename, content)
  }

  /**
   * 从 ContextDB 中移除规则（归档/废弃时）
   * 写入归档标记而非删除文件
   */
  private async removeRuleFromContext(rule: L1Rule): Promise<void> {
    if (!this.contextDB) return

    const filename = this.getRuleFilename(rule.nodeName)
    const archivedContent = [
      `# [已归档] 节点「${rule.nodeName}」质量检查规则`,
      '',
      `> 此规则已于 ${new Date().toISOString()} 归档。`,
      `> 归档原因: ${rule.status === 'deprecated' ? '验证无效或手动废弃' : '自然衰减'}`,
      `> 历史版本数: ${rule.version}`,
      '',
      '此文件内容不再注入 Agent 上下文中。',
    ].join('\n')

    await this.contextDB.upsertContext('L1', rule.templateId, filename, archivedContent)
  }

  /**
   * 生成规则 Markdown 内容（注入 Agent prompt 的格式）
   */
  private generateRuleMarkdown(rule: L1Rule): string {
    const statusLabel: Record<RuleLifecycleStatus, string> = {
      draft: '📝 待验证',
      active: '✅ 生效中',
      decaying: '⚠️ 衰减中',
      deprecated: '❌ 已废弃',
      archived: '📦 已归档',
    }

    const itemsText = rule.items
      .map((item, i) => `${i + 1}. ${item.description}（出现 ${item.frequency} 次，严重程度: ${item.severity}）`)
      .join('\n')

    const sections = [
      `# 节点「${rule.nodeName}」质量检查规则`,
      '',
      `> 此文件由 AutoFlow L1 规则引擎自动生成和维护。`,
      `> 规则 ID: ${rule.id}`,
      `> 版本: v${rule.version} | 状态: ${statusLabel[rule.status]}`,
      `> 创建时间: ${new Date(rule.createdAt).toISOString()}`,
      `> 最后更新: ${new Date(rule.updatedAt).toISOString()}`,
      `> 累计触发: ${rule.totalTriggerCount} 次打回`,
    ]

    // 有效性评分（样本量足够时显示）
    if (rule.effectiveness.postRuleSamples >= DECAY_CONFIG.MIN_EFFECTIVENESS_SAMPLES) {
      sections.push(`> 有效性评分: ${Math.round(rule.effectiveness.improvementRate * 100)}%`)
    }

    sections.push(
      '',
      '---',
      '',
      '## 常见问题与注意事项',
      '',
      itemsText,
      '',
      '## 执行要求',
      '',
      '请在完成任务后对照以上规则自查，确保不再重复出现相同问题。',
      '如果你认为某条规则已不再适用，请在输出中说明原因。',
    )

    // 变更历史（最近 5 条）
    if (rule.changelog.length > 0) {
      sections.push(
        '',
        '---',
        '',
        '## 变更历史',
        '',
        ...rule.changelog.slice(-5).map(entry =>
          `- [v${entry.version}] ${new Date(entry.timestamp).toLocaleDateString()}: ${entry.description}`
        ),
      )
    }

    return sections.join('\n')
  }

  private getRuleFilename(nodeName: string): string {
    return `autoflow-rules-${nodeName.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '-')}.md`
  }

  // ═══════════════ 节点规则数量控制 ═══════════════

  /**
   * 强制限制同一节点的活跃规则数量
   * 超过限制时归档最低效/最旧的规则
   */
  private async enforceMaxRulesPerNode(templateId: string, nodeName: string): Promise<void> {
    const activeRules = this.findRulesForNode(templateId, nodeName)
      .filter(r => r.status === 'active' || r.status === 'draft')

    if (activeRules.length <= MERGE_CONFIG.MAX_ACTIVE_RULES_PER_NODE) return

    // 排序策略：有效性高的保留，新创建的优先保留
    activeRules.sort((a, b) => {
      // 有足够样本的规则按效果排序
      const aHasSamples = a.effectiveness.postRuleSamples >= DECAY_CONFIG.MIN_EFFECTIVENESS_SAMPLES
      const bHasSamples = b.effectiveness.postRuleSamples >= DECAY_CONFIG.MIN_EFFECTIVENESS_SAMPLES
      if (aHasSamples && bHasSamples) {
        return b.effectiveness.improvementRate - a.effectiveness.improvementRate
      }
      // 新规则（样本不足）优先保留
      if (!aHasSamples && !bHasSamples) return b.createdAt - a.createdAt
      return aHasSamples ? -1 : 1  // 有样本的优先
    })

    const toArchive = activeRules.slice(MERGE_CONFIG.MAX_ACTIVE_RULES_PER_NODE)
    for (const rule of toArchive) {
      rule.status = 'archived'
      rule.updatedAt = Date.now()
      rule.changelog.push({
        version: rule.version,
        timestamp: Date.now(),
        description: '归档：超过同节点最大活跃规则数',
        changes: ['status → archived'],
      })
      await this.removeRuleFromContext(rule)
      console.log(`[L1Lifecycle] Rule archived (max exceeded): ${rule.id}`)
    }
  }

  // ═══════════════ 定期维护 ═══════════════

  /**
   * 定期维护任务（每小时执行）
   *
   * 1. 更新衰减分数
   * 2. 归档充分衰减的规则
   * 3. 评估规则有效性
   * 4. 废弃无效规则
   */
  private async runMaintenance(): Promise<void> {
    const now = Date.now()
    let changed = false

    for (const rule of this.rules.values()) {
      if (rule.status === 'archived' || rule.status === 'deprecated') continue

      // 1. 更新衰减天数
      const daysSinceTrigger = (now - rule.decayInfo.lastTriggeredAt) / (24 * 60 * 60 * 1000)
      rule.decayInfo.daysSinceLastTrigger = daysSinceTrigger

      // 2. 活跃 → 衰减
      if (rule.status === 'active' && daysSinceTrigger > DECAY_CONFIG.GRACE_PERIOD_DAYS) {
        rule.status = 'decaying'
        rule.changelog.push({
          version: rule.version,
          timestamp: now,
          description: `进入衰减：${Math.round(daysSinceTrigger)} 天未触发`,
          changes: ['status: active → decaying'],
        })
        changed = true
      }

      // 3. 衰减分数计算 + 归档
      if (rule.status === 'decaying') {
        const decayDays = daysSinceTrigger - DECAY_CONFIG.GRACE_PERIOD_DAYS
        rule.decayInfo.decayScore = Math.max(0, 1.0 - (decayDays / DECAY_CONFIG.DECAY_DURATION_DAYS))

        if (rule.decayInfo.decayScore <= 0) {
          rule.status = 'archived'
          rule.updatedAt = now
          rule.changelog.push({
            version: rule.version,
            timestamp: now,
            description: '归档：衰减完毕',
            changes: ['status: decaying → archived', 'decayScore → 0'],
          })
          await this.removeRuleFromContext(rule)
          console.log(`[L1Lifecycle] Rule archived (decay): ${rule.id}`)
          changed = true
        }
      }

      // 4. 有效性评估 + 无效废弃
      if (rule.status === 'active' &&
          rule.effectiveness.postRuleSamples >= DECAY_CONFIG.MIN_EFFECTIVENESS_SAMPLES) {
        this.updateEffectivenessMetrics(rule)

        // 样本量达到 2× 最小阈值，仍然无效 → 废弃
        if (rule.effectiveness.improvementRate < DECAY_CONFIG.INEFFECTIVE_THRESHOLD &&
            rule.effectiveness.postRuleSamples >= DECAY_CONFIG.MIN_EFFECTIVENESS_SAMPLES * 2) {
          rule.status = 'deprecated'
          rule.updatedAt = now
          rule.changelog.push({
            version: rule.version,
            timestamp: now,
            description: `自动废弃：改善率仅 ${Math.round(rule.effectiveness.improvementRate * 100)}%`,
            changes: ['status: active → deprecated'],
          })
          await this.removeRuleFromContext(rule)
          console.log(`[L1Lifecycle] Rule deprecated (ineffective): ${rule.id}`)
          changed = true
        }
      }
    }

    if (changed) {
      await this.persistRules()
    }
  }

  /**
   * 更新规则有效性度量
   */
  private updateEffectivenessMetrics(rule: L1Rule): void {
    const eff = rule.effectiveness
    if (eff.postRuleSamples > 0) {
      eff.currentRejectRate = eff.postRuleRejects / eff.postRuleSamples
    }
    if (eff.baselineRejectRate > 0) {
      eff.improvementRate = (eff.baselineRejectRate - eff.currentRejectRate) / eff.baselineRejectRate
    } else {
      eff.improvementRate = 0
    }
    eff.lastMeasuredAt = Date.now()
  }

  // ═══════════════ 文本相似度 ═══════════════

  /**
   * 分词（简单按空格 + 标点切分）
   */
  private tokenize(text: string): Set<string> {
    const tokens = text
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff]+/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1) // 过滤单字
    return new Set(tokens)
  }

  /**
   * Jaccard 相似系数
   */
  private jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
    if (setA.size === 0 && setB.size === 0) return 0

    let intersection = 0
    for (const token of setA) {
      if (setB.has(token)) intersection++
    }

    const union = setA.size + setB.size - intersection
    return union > 0 ? intersection / union : 0
  }

  // ═══════════════ 持久化 ═══════════════

  private schedulePersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
    }
    this.persistTimer = setTimeout(() => {
      this.persistRules().catch(err => {
        console.error('[L1Lifecycle] Persist failed:', (err as Error).message)
      })
    }, 3000)
  }

  private async persistRules(): Promise<void> {
    const state: PersistedL1RuleState = {
      version: 1,
      persistedAt: Date.now(),
      rules: Object.fromEntries(this.rules),
    }

    await mkdir(this.storagePath, { recursive: true })
    const filePath = join(this.storagePath, 'l1-rules-state.json')
    await writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8')
  }

  private async loadRules(): Promise<void> {
    const filePath = join(this.storagePath, 'l1-rules-state.json')
    try {
      const content = await readFile(filePath, 'utf-8')
      const state: PersistedL1RuleState = JSON.parse(content)

      if (state.version !== 1) {
        console.warn(`[L1Lifecycle] Unknown state version ${state.version}, skipping`)
        return
      }

      for (const [key, rule] of Object.entries(state.rules)) {
        this.rules.set(key, rule)
      }

      console.log(`[L1Lifecycle] Loaded ${this.rules.size} rules`)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return // 首次启动
      throw err
    }
  }
}
