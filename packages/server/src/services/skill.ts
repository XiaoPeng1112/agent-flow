import { readFile, readdir, stat, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import matter from 'gray-matter'
import type { SkillConfig } from '../types/index.js'

/**
 * Skill 管理服务
 * 负责发现、加载和管理项目中的 Skill 文件
 */
export class SkillService {
  private skills: SkillConfig[] = []
  private lastSearchPaths: string[] = []

  /** 扫描并加载指定目录中的 Skills */
  async loadSkills(searchPaths: string[]): Promise<SkillConfig[]> {
    this.skills = []
    this.lastSearchPaths = searchPaths

    for (const basePath of searchPaths) {
      try {
        await this.scanDirectory(basePath)
      } catch {
        // 目录不存在则跳过
      }
    }

    return this.skills
  }

  /** 重新加载（使用上次的搜索路径） */
  async reload(): Promise<SkillConfig[]> {
    if (this.lastSearchPaths.length === 0) return this.skills
    return this.loadSkills(this.lastSearchPaths)
  }

  /** 追加加载额外路径（不清空已有 Skills） */
  async loadAdditional(searchPaths: string[]): Promise<SkillConfig[]> {
    for (const basePath of searchPaths) {
      try {
        await this.scanDirectory(basePath)
      } catch {
        // 目录不存在则跳过
      }
    }
    // 去重（按 id）
    const seen = new Set<string>()
    this.skills = this.skills.filter(s => {
      if (seen.has(s.id)) return false
      seen.add(s.id)
      return true
    })
    return this.skills
  }

  /** 获取已加载的所有 Skills */
  getSkills(): SkillConfig[] {
    return this.skills
  }

  /** 根据 ID 获取 Skill */
  getSkillById(id: string): SkillConfig | undefined {
    return this.skills.find((s) => s.id === id)
  }

  /** 根据名称获取 Skill */
  getSkill(name: string): SkillConfig | undefined {
    return this.skills.find((s) => s.name === name)
  }

  /** 读取 Skill 的完整内容 */
  async readSkillContent(skillPath: string): Promise<string> {
    return readFile(skillPath, 'utf-8')
  }

  /**
   * 写入新 Skill 到指定目录
   * 用于 Skill 沉淀：将分析出的有价值内容持久化为 SKILL.md
   */
  async writeSkill(targetDir: string, skill: SkillConfig): Promise<string> {
    const skillDir = join(targetDir, skill.name)
    await mkdir(skillDir, { recursive: true })

    const skillPath = join(skillDir, 'SKILL.md')
    const content = skill.content || ''
    await writeFile(skillPath, content, 'utf-8')

    // 注册到内存中
    const registered: SkillConfig = { ...skill, path: skillPath }
    // 避免重复
    const existIdx = this.skills.findIndex(s => s.id === skill.id)
    if (existIdx >= 0) {
      this.skills[existIdx] = registered
    } else {
      this.skills.push(registered)
    }

    return skillPath
  }

  /** 删除已注册的 Skill（仅从内存移除，不删文件） */
  unregisterSkill(id: string): boolean {
    const idx = this.skills.findIndex(s => s.id === id)
    if (idx >= 0) {
      this.skills.splice(idx, 1)
      return true
    }
    return false
  }

  private async scanDirectory(dirPath: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dirPath, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)

      if (entry.isDirectory()) {
        // 查找目录下的 SKILL.md
        const skillFile = join(fullPath, 'SKILL.md')
        try {
          const s = await stat(skillFile)
          if (s.isFile()) {
            await this.parseSkillFile(skillFile, entry.name)
          }
        } catch {
          // 不存在 SKILL.md，继续递归
          await this.scanDirectory(fullPath)
        }
      } else if (entry.name === 'SKILL.md') {
        await this.parseSkillFile(fullPath, dirPath.split('/').pop() || 'unknown')
      }
    }
  }

  private async parseSkillFile(filePath: string, name: string): Promise<void> {
    try {
      const raw = await readFile(filePath, 'utf-8')
      const { data: frontmatter, content } = matter(raw)

      this.skills.push({
        id: `skill_${name.replace(/[^a-zA-Z0-9]/g, '_')}`,
        name: (frontmatter.name as string) || name,
        path: filePath,
        description: (frontmatter.description as string) || content.slice(0, 200),
        triggers: (frontmatter.triggers as string[]) || [],
        content,
      })
    } catch {
      // 解析失败跳过
    }
  }
}
