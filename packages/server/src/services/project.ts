import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import type { ProjectData, SkillConfig, ProjectContext } from '../types/index.js'
import { SkillService } from './skill.js'

/**
 * 项目管理服务
 * 负责管理本地项目列表、上下文配置和持久化
 */
export class ProjectService {
  private projects: ProjectData[] = []
  private storagePath: string
  private skillService: SkillService

  constructor(skillService: SkillService) {
    this.skillService = skillService
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

  /** 获取单个项目 */
  getProject(id: string): ProjectData | undefined {
    return this.projects.find((p) => p.id === id)
  }

  /** 添加项目 */
  async addProject(data: {
    name: string
    path: string
    description?: string
    contextConfig?: ProjectContext
  }): Promise<ProjectData> {
    const project: ProjectData = {
      id: `proj_${Date.now()}`,
      name: data.name,
      path: data.path,
      description: data.description,
      contextConfig: data.contextConfig,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    }
    this.projects.push(project)
    await this.save()
    return project
  }

  /** 更新项目 */
  async updateProject(id: string, updates: Partial<Pick<ProjectData, 'name' | 'description' | 'contextConfig'>>): Promise<ProjectData | undefined> {
    const project = this.projects.find((p) => p.id === id)
    if (!project) return undefined

    if (updates.name !== undefined) project.name = updates.name
    if (updates.description !== undefined) project.description = updates.description
    if (updates.contextConfig !== undefined) project.contextConfig = updates.contextConfig
    project.lastActiveAt = Date.now()

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

  /** 扫描项目的 Skills */
  async scanProjectSkills(projectId: string): Promise<SkillConfig[]> {
    const project = this.getProject(projectId)
    if (!project) throw new Error('Project not found')

    const searchPaths = [
      join(project.path, '.catpaw', 'skills'),
      join(project.path, '.claude', 'skills'),
      join(project.path, '.codex', 'skills'),
      `${process.env.HOME}/.catpaw/skills`,
      `${process.env.HOME}/.claude/skills`,
      `${process.env.HOME}/.codex/skills`,
    ]
    return this.skillService.loadSkills(searchPaths)
  }
}
