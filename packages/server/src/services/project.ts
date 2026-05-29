import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import type { SkillConfig } from '../types/index.js'
import { SkillService } from './skill.js'

export interface ProjectData {
  id: string
  name: string
  path: string
  description?: string
  createdAt: number
  lastActiveAt: number
}

/**
 * 项目管理服务
 * 负责管理本地项目列表和持久化
 */
export class ProjectService {
  private projects: ProjectData[] = []
  private storagePath: string
  private skillService: SkillService

  constructor(skillService: SkillService) {
    this.skillService = skillService
    // 数据存储在 ~/.agent-flow/projects.json
    const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
    this.storagePath = join(home, '.agent-flow', 'projects.json')
  }

  /** 加载已保存的项目列表 */
  async load(): Promise<void> {
    try {
      const raw = await readFile(this.storagePath, 'utf-8')
      this.projects = JSON.parse(raw)
    } catch {
      this.projects = []
    }
  }

  /** 持久化项目列表 */
  private async save(): Promise<void> {
    const dir = this.storagePath.replace(/\/[^/]+$/, '')
    await mkdir(dir, { recursive: true })
    await writeFile(this.storagePath, JSON.stringify(this.projects, null, 2), 'utf-8')
  }

  /** 获取所有项目 */
  getProjects(): ProjectData[] {
    return this.projects
  }

  /** 添加项目 */
  async addProject(data: { name: string; path: string; description?: string }): Promise<ProjectData> {
    const project: ProjectData = {
      id: `proj_${Date.now()}`,
      name: data.name,
      path: data.path,
      description: data.description,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    }
    this.projects.push(project)
    await this.save()
    return project
  }

  /** 删除项目 */
  async removeProject(id: string): Promise<boolean> {
    const idx = this.projects.findIndex((p) => p.id === id)
    if (idx === -1) return false
    this.projects.splice(idx, 1)
    await this.save()
    return true
  }

  /** 获取单个项目 */
  getProject(id: string): ProjectData | undefined {
    return this.projects.find((p) => p.id === id)
  }

  /** 扫描项目的 Skills */
  async scanProjectSkills(projectId: string): Promise<SkillConfig[]> {
    const project = this.getProject(projectId)
    if (!project) throw new Error('Project not found')

    // 扫描项目目录下的 .catpaw/skills 以及全局 skills
    const searchPaths = [
      join(project.path, '.catpaw', 'skills'),
      `${process.env.HOME}/.catpaw/skills`,
    ]
    return this.skillService.loadSkills(searchPaths)
  }
}
