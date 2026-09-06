import type {
  SkillWhitelist, MaterializedSkill, SkillConfig,
} from '../types/index.js'
import type { SkillService } from './skill.js'

/**
 * SkillMaterializationService — Skill 物化服务
 * 
 * 核心职责：
 * 1. 白名单管理：每个节点可配置允许使用的 Skill 列表
 * 2. 物化（Materialization）：将 Skill 文件内容读取并注入到 Agent 执行上下文
 * 3. 缓存与过期：物化的 Skill 有 TTL，避免长时间缓存导致 Skill 更新不生效
 * 4. 安全检查：黑名单优先于白名单，确保敏感 Skill 不被未授权 Agent 使用
 * 
 * 设计原则：
 * - 最小权限：Agent 只能访问节点白名单中的 Skill
 * - 内容快照：注入时取 Skill 文件的快照，执行过程中内容不变
 * - 运行时注入：物化内容作为额外的 system prompt 拼接到 Agent 调用中
 */
export class SkillMaterializationService {
  private whitelists: Map<string, SkillWhitelist> = new Map()  // nodeId → whitelist
  private materializedCache: Map<string, MaterializedSkill[]> = new Map()  // nodeId → skills
  private skillService: SkillService

  private static DEFAULT_TTL_MS = 30 * 60 * 1000  // 30 分钟

  constructor(skillService: SkillService) {
    this.skillService = skillService
  }

  // ═══════════════ 白名单管理 ═══════════════

  /**
   * 设置节点的 Skill 白名单
   */
  setWhitelist(nodeId: string, allowedSkillIds: string[], denySkillIds?: string[]): void {
    this.whitelists.set(nodeId, {
      nodeId,
      allowedSkillIds,
      denySkillIds,
    })
  }

  /**
   * 获取节点的白名单配置
   */
  getWhitelist(nodeId: string): SkillWhitelist | undefined {
    return this.whitelists.get(nodeId)
  }

  /**
   * 从模板节点 skillIds 自动生成白名单
   */
  initWhitelistFromTemplate(nodeId: string, skillIds: string[]): void {
    if (skillIds.length > 0) {
      this.setWhitelist(nodeId, skillIds)
    }
  }

  /**
   * 检查某个 Skill 是否在节点白名单内
   */
  isSkillAllowed(nodeId: string, skillId: string): boolean {
    const whitelist = this.whitelists.get(nodeId)
    if (!whitelist) return true  // 无白名单配置 → 允许所有

    // 黑名单优先
    if (whitelist.denySkillIds?.includes(skillId)) return false

    // 白名单为空 → 允许所有（除了黑名单中的）
    if (whitelist.allowedSkillIds.length === 0) return true

    return whitelist.allowedSkillIds.includes(skillId)
  }

  // ═══════════════ Skill 物化 ═══════════════

  /**
   * 为节点物化 Skill — 核心方法
   * 
   * 流程：
   * 1. 检查缓存是否有效
   * 2. 根据白名单过滤可用 Skill
   * 3. 读取 Skill 文件内容形成快照
   * 4. 缓存物化结果
   * 
   * @returns 物化后的 Skill 列表（内含完整内容）
   */
  async materializeForNode(nodeId: string, snapshot?: SkillConfig[]): Promise<MaterializedSkill[]> {
    // 检查缓存
    const cached = this.materializedCache.get(nodeId)
    if (!snapshot && cached && this.isCacheValid(cached)) {
      return cached
    }

    const allSkills = snapshot || this.skillService.getSkills()
    const whitelist = this.whitelists.get(nodeId)

    // 过滤出允许的 Skills
    const allowedSkills = allSkills.filter(skill => {
      if (!whitelist) return true
      if (whitelist.denySkillIds?.includes(skill.id)) return false
      if (whitelist.allowedSkillIds.length === 0) return true
      return whitelist.allowedSkillIds.includes(skill.id)
    })

    // 物化：读取 Skill 内容形成快照
    const materialized: MaterializedSkill[] = []
    const now = Date.now()

    for (const skill of allowedSkills) {
      try {
        const content = skill.content || await this.skillService.readSkillContent(skill.path)
        materialized.push({
          skillId: skill.id,
          name: skill.name,
          content,
          injectedAt: now,
          expiresAt: now + SkillMaterializationService.DEFAULT_TTL_MS,
        })
      } catch {
        // 单个 Skill 读取失败不阻塞整体
        console.warn(`[SkillMaterialization] Failed to materialize skill: ${skill.name}`)
      }
    }

    // 缓存
    this.materializedCache.set(nodeId, materialized)
    return materialized
  }

  /**
   * 将物化的 Skill 转化为 Agent prompt 注入片段
   * 
   * 格式化为结构化的指令块，供 Agent 理解和使用
   */
  formatSkillsAsPrompt(skills: MaterializedSkill[]): string {
    if (skills.length === 0) return ''

    const parts: string[] = [
      '\n## 可用 Skills（工具与知识）\n',
      '以下是你在本次任务中可以使用的 Skills，请根据任务需要选择合适的 Skill：\n',
    ]

    for (const skill of skills) {
      parts.push(`### ${skill.name}`)
      parts.push('```')
      parts.push(skill.content)
      parts.push('```\n')
    }

    return parts.join('\n')
  }

  /**
   * 一站式接口：物化 + 格式化
   */
  async getSkillPromptForNode(nodeId: string, snapshot?: SkillConfig[]): Promise<string> {
    const materialized = await this.materializeForNode(nodeId, snapshot)
    return this.formatSkillsAsPrompt(materialized)
  }

  // ═══════════════ 缓存管理 ═══════════════

  /**
   * 检查缓存是否仍有效
   */
  private isCacheValid(skills: MaterializedSkill[]): boolean {
    if (skills.length === 0) return false
    const now = Date.now()
    return skills.every(s => !s.expiresAt || s.expiresAt > now)
  }

  /**
   * 清除节点的物化缓存（Skill 更新后调用）
   */
  invalidateCache(nodeId: string): void {
    this.materializedCache.delete(nodeId)
  }

  /**
   * 清除所有缓存
   */
  invalidateAllCaches(): void {
    this.materializedCache.clear()
  }

  /**
   * 获取物化统计
   */
  getStats(): {
    totalWhitelists: number
    cachedNodes: number
    totalMaterialized: number
  } {
    let totalMaterialized = 0
    for (const skills of this.materializedCache.values()) {
      totalMaterialized += skills.length
    }
    return {
      totalWhitelists: this.whitelists.size,
      cachedNodes: this.materializedCache.size,
      totalMaterialized,
    }
  }
}
