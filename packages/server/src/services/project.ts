import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { ProjectData, SkillConfig, ProjectContext } from '../types/index.js'
import { SkillService } from './skill.js'

const execFileAsync = promisify(execFile)

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

  /** 添加项目（自动探测 git remote URL） */
  async addProject(data: {
    name: string
    path: string
    description?: string
    contextConfig?: ProjectContext
  }): Promise<ProjectData> {
    const gitRemote = await this.detectGitRemote(data.path)
    const project: ProjectData = {
      id: `proj_${Date.now()}`,
      name: data.name,
      path: data.path,
      description: data.description,
      contextConfig: data.contextConfig,
      gitRemote,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    }
    this.projects.push(project)
    await this.save()
    return project
  }

  /**
   * 以指定 ID 添加项目（跨设备同步时保留远端 ID）
   * 如果本地已存在相同 ID 的项目则跳过
   */
  async addProjectWithId(data: {
    id: string
    name: string
    path: string
    description?: string
    contextConfig?: ProjectContext
    gitRemote?: string
    createdAt?: number
    lastActiveAt?: number
  }): Promise<ProjectData> {
    // 如果已存在相同 ID，直接返回
    const existing = this.projects.find(p => p.id === data.id)
    if (existing) return existing

    const gitRemote = data.gitRemote || await this.detectGitRemote(data.path)
    const project: ProjectData = {
      id: data.id,
      name: data.name,
      path: data.path,
      description: data.description,
      contextConfig: data.contextConfig,
      gitRemote,
      createdAt: data.createdAt || Date.now(),
      lastActiveAt: data.lastActiveAt || Date.now(),
    }
    this.projects.push(project)
    await this.save()
    return project
  }

  /** 更新项目 */
  async updateProject(id: string, updates: Partial<Pick<ProjectData, 'name' | 'description' | 'contextConfig' | 'enabledAgentIds'>>): Promise<ProjectData | undefined> {
    const project = this.projects.find((p) => p.id === id)
    if (!project) return undefined

    if (updates.name !== undefined) project.name = updates.name
    if (updates.description !== undefined) project.description = updates.description
    if (updates.contextConfig !== undefined) project.contextConfig = updates.contextConfig
    if (updates.enabledAgentIds !== undefined) project.enabledAgentIds = updates.enabledAgentIds
    project.lastActiveAt = Date.now()

    await this.save()
    return project
  }

  /**
   * 替换项目 ID（跨设备同步时将本地临时 ID 替换为远端全局 ID）
   * 确保项目在所有设备上使用同一个 ID
   */
  async replaceProjectId(oldId: string, newId: string): Promise<boolean> {
    const project = this.projects.find(p => p.id === oldId)
    if (!project) return false

    // 确保新 ID 没有冲突
    if (this.projects.some(p => p.id === newId)) {
      console.warn(`[ProjectService] Cannot replace ID: ${newId} already exists`)
      return false
    }

    project.id = newId
    await this.save()
    console.log(`[ProjectService] Replaced project ID: ${oldId} → ${newId}`)
    return true
  }

  /** 删除项目 */
  async removeProject(id: string): Promise<boolean> {
    const idx = this.projects.findIndex((p) => p.id === id)
    if (idx === -1) return false
    this.projects.splice(idx, 1)
    await this.save()
    return true
  }

  /**
   * 探测项目路径的 git remote origin URL
   * 用于跨设备同步时自动匹配同一项目
   */
  private async detectGitRemote(projectPath: string): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
        cwd: projectPath,
        timeout: 5000,
      })
      const url = stdout.trim()
      return url || undefined
    } catch {
      // 不是 git 仓库或没有 remote，返回 undefined
      return undefined
    }
  }

  /**
   * 标准化 git remote URL（去除 .git 后缀和协议差异）
   * 使得 https://github.com/user/repo.git 和 git@github.com:user/repo 匹配为同一项目
   */
  static normalizeGitRemote(url: string): string {
    let normalized = url.trim()
    // SSH 格式转换: git@github.com:user/repo → github.com/user/repo
    const sshMatch = normalized.match(/^git@([^:]+):(.+)$/)
    if (sshMatch) {
      normalized = `${sshMatch[1]}/${sshMatch[2]}`
    } else {
      // HTTPS 格式: 去除协议部分
      normalized = normalized.replace(/^https?:\/\//, '')
    }
    // 去除 .git 后缀
    normalized = normalized.replace(/\.git$/, '')
    // 统一小写
    return normalized.toLowerCase()
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
