import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { TaskNode, Run, SkillConfig } from '../types/index.js'
import type { SkillService } from './skill.js'
import type { ProjectService } from './project.js'

/**
 * Skill 沉淀候选项
 */
export interface SkillCandidate {
  name: string
  description: string
  content: string
  triggers: string[]
  source: {
    runId: string
    nodeId: string
    nodeName: string
    nodeType: string
    artifactTitle?: string
  }
  confidence: number  // 0~1，沉淀置信度
}

/**
 * 沉淀规则配置
 */
export interface ExtractionRule {
  /** 最小内容长度（过短的不值得沉淀） */
  minContentLength: number
  /** 最小置信度阈值（低于此值不自动沉淀） */
  minConfidence: number
  /** 节点类型权重（哪些类型产出更值得沉淀） */
  nodeTypeWeights: Record<string, number>
  /** 关键词加分（内容中包含这些关键词则加分） */
  valueKeywords: string[]
}

const DEFAULT_RULES: ExtractionRule = {
  minContentLength: 200,
  minConfidence: 0.6,
  nodeTypeWeights: {
    specify: 0.7,    // 需求分析产出的模板
    design: 0.9,     // 方案设计产出的架构决策
    task: 0.5,       // 任务拆分相对通用性低
    implement: 0.8,  // 代码实现中的工具函数/模式
    review: 0.6,     // Review 产出的检查清单
    test: 0.7,       // 测试策略和用例模板
    deliver: 0.4,    // 交付汇总一般不复用
  },
  valueKeywords: [
    '模板', 'template', '规范', 'standard', '最佳实践', 'best practice',
    '架构', 'architecture', '通用', 'reusable', '工具', 'utility',
    '检查清单', 'checklist', '流程', 'workflow', '策略', 'strategy',
    '指南', 'guide', '配置', 'config', '脚手架', 'scaffold',
  ],
}

/**
 * SkillExtractionService — Skill 自动沉淀服务
 * 
 * 核心职责：
 * 1. 在节点执行完成后，分析产出物内容
 * 2. 基于规则评估是否值得作为 Skill 沉淀
 * 3. 自动生成 SKILL.md 并写入应用数据中的项目专属 skills 目录
 * 4. 重新加载 SkillService 使新 Skill 立即可用
 * 
 * 评分维度：
 * - 内容长度和结构性（Markdown 标题层次）
 * - 节点类型权重（设计类产出 > 交付类）
 * - 关键词匹配（包含"模板""规范"等通用化词汇）
 * - 代码块密度（含代码示例的更有价值）
 * - 去重检测（与已有 Skill 相似度过高则不重复沉淀）
 */
export class SkillExtractionService {
  private skillService: SkillService
  private projectService: ProjectService
  private rules: ExtractionRule
  private extractionLog: Array<{
    timestamp: number
    runId: string
    nodeId: string
    result: 'extracted' | 'skipped' | 'low_confidence'
    skillName?: string
    confidence?: number
  }> = []

  constructor(
    skillService: SkillService,
    projectService: ProjectService,
    rules?: Partial<ExtractionRule>
  ) {
    this.skillService = skillService
    this.projectService = projectService
    this.rules = { ...DEFAULT_RULES, ...rules }
  }

  /**
   * 核心入口：分析节点产出物并尝试沉淀为 Skill
   * 
   * 调用时机：节点 status 从 running → completed 时
   * 
   * @returns 沉淀成功的 Skill 列表（可能为空）
   */
  async extractFromNode(node: TaskNode, run: Run): Promise<SkillConfig[]> {
    const extractedSkills: SkillConfig[] = []

    // 无产出物则跳过
    if (!node.artifacts || node.artifacts.length === 0) {
      this.logExtraction(run.id, node.id, 'skipped')
      return extractedSkills
    }

    // 对每个产出物评估
    for (const artifact of node.artifacts) {
      const content = artifact.content
      if (!content || content.length < this.rules.minContentLength) continue

      // 评估沉淀价值
      const candidate = this.evaluateCandidate(content, node, run, artifact.title)
      if (!candidate) continue

      if (candidate.confidence < this.rules.minConfidence) {
        this.logExtraction(run.id, node.id, 'low_confidence', undefined, candidate.confidence)
        continue
      }

      // 去重检查
      if (this.isDuplicate(candidate)) {
        this.logExtraction(run.id, node.id, 'skipped')
        continue
      }

      // 执行沉淀
      try {
        const skill = await this.persistSkill(candidate, run.projectId)
        extractedSkills.push(skill)
        this.logExtraction(run.id, node.id, 'extracted', skill.name, candidate.confidence)
        console.log(`[SkillExtraction] Extracted skill "${skill.name}" (confidence: ${candidate.confidence.toFixed(2)}) from node "${node.name}"`)
      } catch (err) {
        console.warn(`[SkillExtraction] Failed to persist skill:`, (err as Error).message)
      }
    }

    return extractedSkills
  }

  /**
   * 评估产出物是否值得沉淀为 Skill
   */
  private evaluateCandidate(
    content: string,
    node: TaskNode,
    run: Run,
    artifactTitle?: string
  ): SkillCandidate | null {
    let score = 0
    const maxScore = 100

    // 1. 节点类型权重 (0~30分)
    const typeWeight = this.rules.nodeTypeWeights[node.type] || 0.5
    score += typeWeight * 30

    // 2. 内容长度评分 (0~15分)
    if (content.length >= 500) score += 5
    if (content.length >= 1000) score += 5
    if (content.length >= 2000) score += 5

    // 3. 结构性评分：Markdown 标题层次 (0~20分)
    const headingCount = (content.match(/^#{1,4}\s+/gm) || []).length
    score += Math.min(headingCount * 3, 20)

    // 4. 代码块密度 (0~15分)
    const codeBlockCount = (content.match(/```[\s\S]*?```/g) || []).length
    score += Math.min(codeBlockCount * 4, 15)

    // 5. 关键词匹配 (0~20分)
    const contentLower = content.toLowerCase()
    let keywordHits = 0
    for (const kw of this.rules.valueKeywords) {
      if (contentLower.includes(kw.toLowerCase())) keywordHits++
    }
    score += Math.min(keywordHits * 4, 20)

    const confidence = score / maxScore

    // 低于阈值直接返回 null
    if (confidence < this.rules.minConfidence * 0.5) return null

    // 生成 Skill 元信息
    const name = this.generateSkillName(node, artifactTitle)
    const description = this.generateDescription(content, node)
    const triggers = this.extractTriggers(content, node)

    return {
      name,
      description,
      content,
      triggers,
      source: {
        runId: run.id,
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        artifactTitle,
      },
      confidence,
    }
  }

  /**
   * 去重检测：检查新 Skill 是否与已有 Skill 高度重复
   */
  private isDuplicate(candidate: SkillCandidate): boolean {
    const existingSkills = this.skillService.getSkills()
    
    for (const existing of existingSkills) {
      // 名称相似度
      if (existing.name.toLowerCase() === candidate.name.toLowerCase()) return true

      // 内容相似度（简单 Jaccard 系数：共有词数 / 并集词数）
      if (existing.content) {
        const similarity = this.computeContentSimilarity(existing.content, candidate.content)
        if (similarity > 0.7) return true
      }
    }

    return false
  }

  /**
   * 简单内容相似度（基于词集 Jaccard）
   */
  private computeContentSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3))
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3))
    
    if (wordsA.size === 0 || wordsB.size === 0) return 0

    let intersection = 0
    for (const word of wordsA) {
      if (wordsB.has(word)) intersection++
    }

    const union = wordsA.size + wordsB.size - intersection
    return union > 0 ? intersection / union : 0
  }

  /**
   * 生成 Skill 名称
   */
  private generateSkillName(node: TaskNode, artifactTitle?: string): string {
    const base = artifactTitle || node.name
    // 清理并转为合法的目录名
    return base
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s\-_]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase()
      .slice(0, 50)
  }

  /**
   * 生成描述
   */
  private generateDescription(content: string, node: TaskNode): string {
    // 从内容开头提取摘要
    const firstParagraph = content.split('\n\n')[0] || ''
    const cleaned = firstParagraph.replace(/^#.*\n?/, '').trim()
    const summary = cleaned.slice(0, 200)
    return `从${node.name}节点沉淀：${summary}`
  }

  /**
   * 从内容中提取触发关键词
   */
  private extractTriggers(content: string, node: TaskNode): string[] {
    const triggers: string[] = [node.type]
    
    // 提取 Markdown 标题作为触发词
    const headings = content.match(/^#{1,3}\s+(.+)$/gm) || []
    for (const h of headings.slice(0, 5)) {
      const text = h.replace(/^#+\s+/, '').trim()
      if (text.length <= 20) triggers.push(text)
    }

    // 提取代码语言标记
    const langs = content.match(/```(\w+)/g) || []
    for (const lang of [...new Set(langs)]) {
      triggers.push(lang.replace('```', ''))
    }

    return [...new Set(triggers)].slice(0, 10)
  }

  /**
   * 持久化 Skill 到应用数据中的项目专属 skills 目录
   */
  private async persistSkill(candidate: SkillCandidate, projectId: string): Promise<SkillConfig> {
    const project = this.projectService.getProject(projectId)
    if (!project) throw new Error(`Project not found: ${projectId}`)

    // 确定存储目录
    const skillsDir = this.projectService.getSkillsDir(projectId)
    if (!skillsDir) throw new Error('Project skill storage is unavailable')
    const skillDir = join(skillsDir, candidate.name)
    
    // 创建目录
    await mkdir(skillDir, { recursive: true })

    // 生成 SKILL.md（带 frontmatter）
    const skillContent = this.formatSkillMd(candidate)
    const skillPath = join(skillDir, 'SKILL.md')
    await writeFile(skillPath, skillContent, 'utf-8')

    // 构造 SkillConfig 并注册到 SkillService
    const skillConfig: SkillConfig = {
      id: `skill_${candidate.name.replace(/[^a-zA-Z0-9]/g, '_')}`,
      name: candidate.name,
      path: skillPath,
      description: candidate.description,
      triggers: candidate.triggers,
      content: candidate.content,
    }

    return skillConfig
  }

  /**
   * 生成 SKILL.md 文件内容（带 YAML frontmatter）
   */
  private formatSkillMd(candidate: SkillCandidate): string {
    const frontmatter = [
      '---',
      `name: "${candidate.name}"`,
      `description: "${candidate.description.replace(/"/g, '\\"')}"`,
      `triggers:`,
      ...candidate.triggers.map(t => `  - "${t}"`),
      `source:`,
      `  runId: "${candidate.source.runId}"`,
      `  nodeId: "${candidate.source.nodeId}"`,
      `  nodeName: "${candidate.source.nodeName}"`,
      `  nodeType: "${candidate.source.nodeType}"`,
      candidate.source.artifactTitle ? `  artifactTitle: "${candidate.source.artifactTitle}"` : null,
      `confidence: ${candidate.confidence.toFixed(2)}`,
      `extractedAt: "${new Date().toISOString()}"`,
      '---',
    ].filter(Boolean).join('\n')

    return `${frontmatter}\n\n${candidate.content}`
  }

  // ═══════════════ 查询与管理 ═══════════════

  /**
   * 获取沉淀日志
   */
  getExtractionLog(runId?: string): typeof this.extractionLog {
    if (runId) return this.extractionLog.filter(l => l.runId === runId)
    return [...this.extractionLog]
  }

  /**
   * 获取沉淀统计
   */
  getStats(): {
    totalExtractions: number
    successCount: number
    skipCount: number
    lowConfidenceCount: number
  } {
    const total = this.extractionLog.length
    const success = this.extractionLog.filter(l => l.result === 'extracted').length
    const skip = this.extractionLog.filter(l => l.result === 'skipped').length
    const lowConf = this.extractionLog.filter(l => l.result === 'low_confidence').length
    return { totalExtractions: total, successCount: success, skipCount: skip, lowConfidenceCount: lowConf }
  }

  /**
   * 手动触发沉淀（用户选择某个产出物强制沉淀）
   */
  async forceExtract(
    content: string,
    name: string,
    projectId: string,
    source: SkillCandidate['source']
  ): Promise<SkillConfig> {
    const candidate: SkillCandidate = {
      name: name.replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s\-_]/g, '').replace(/\s+/g, '-').toLowerCase(),
      description: `手动沉淀的 Skill：${content.slice(0, 100)}`,
      content,
      triggers: [source.nodeType],
      source,
      confidence: 1.0,  // 手动沉淀置信度为 1
    }

    return this.persistSkill(candidate, projectId)
  }

  private logExtraction(
    runId: string,
    nodeId: string,
    result: 'extracted' | 'skipped' | 'low_confidence',
    skillName?: string,
    confidence?: number
  ): void {
    this.extractionLog.push({
      timestamp: Date.now(),
      runId,
      nodeId,
      result,
      skillName,
      confidence,
    })
    // 保留最近 200 条
    if (this.extractionLog.length > 200) {
      this.extractionLog = this.extractionLog.slice(-200)
    }
  }
}
