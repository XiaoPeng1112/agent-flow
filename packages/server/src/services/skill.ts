import { readFile, readdir, stat } from 'fs/promises'
import { join } from 'path'
import matter from 'gray-matter'
import type { SkillConfig } from '../types/index.js'

/**
 * Skill 管理服务
 * 负责发现、加载和管理项目中的 Skill 文件
 */
export class SkillService {
  private skills: SkillConfig[] = []

  /** 扫描并加载指定目录中的 Skills */
  async loadSkills(searchPaths: string[]): Promise<SkillConfig[]> {
    this.skills = []

    for (const basePath of searchPaths) {
      try {
        await this.scanDirectory(basePath)
      } catch {
        // 目录不存在则跳过
      }
    }

    return this.skills
  }

  /** 获取已加载的所有 Skills */
  getSkills(): SkillConfig[] {
    return this.skills
  }

  /** 根据名称获取 Skill */
  getSkill(name: string): SkillConfig | undefined {
    return this.skills.find((s) => s.name === name)
  }

  /** 读取 Skill 的完整内容 */
  async readSkillContent(skillPath: string): Promise<string> {
    return readFile(skillPath, 'utf-8')
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
