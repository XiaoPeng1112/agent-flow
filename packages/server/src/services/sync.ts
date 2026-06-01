import { readFile, writeFile, mkdir, readdir, stat } from 'fs/promises'
import { join, relative } from 'path'
import type { AuthService } from './auth.js'
import type { ProjectService } from './project.js'
import type { WorkflowEngine } from './workflow-engine.js'
import type { TemplateService } from './template.js'

/**
 * 同步配置
 */
export interface SyncConfig {
  /** 远端 GitHub 私有仓库全名（如 user/agent-flow-data） */
  repoFullName: string
  /** 是否启用自动同步（项目变更时自动 push） */
  autoSync: boolean
  /** 上次同步时间戳 */
  lastSyncAt?: number
  /** 上次 push 的 commit SHA */
  lastCommitSha?: string
}

/**
 * 同步状态
 */
export interface SyncStatus {
  configured: boolean
  repoFullName: string | null
  autoSync: boolean
  lastSyncAt: number | null
  lastCommitSha: string | null
  authenticated: boolean
  /** 是否有本地未推送的变更 */
  dirty: boolean
}


/**
 * GitHub Contents API 文件信息
 */
interface GitHubFileContent {
  name: string
  path: string
  sha: string
  size: number
  content?: string  // base64 encoded
  encoding?: string
}

/**
 * GitHub Sync Service
 * 
 * 将本地 AgentFlow 数据同步到用户的 GitHub 私有仓库。
 * 
 * 架构设计：
 *   - 使用 GitHub Contents API（无需本地 git CLI）
 *   - 路径映射：本地数据 → 远端 repo 文件结构
 *   - 冲突策略：LWW（Last Write Wins），以时间戳较新的为准
 *   - 数据范围：projects.json、templates.json、runs/、context-db/
 * 
 * 远端仓库结构：
 *   agent-flow-data/
 *   ├── manifest.json          (元信息：版本、最后同步时间)
 *   ├── projects.json          (项目列表)
 *   ├── templates.json         (工作流模板)
 *   ├── runs/
 *   │   ├── {runId}.json       (每个 Run 独立文件)
 *   │   └── ...
 *   └── context-db/
 *       ├── _global/           (全局 SYS/L0/L1/L2 层)
 *       └── {projectId}/       (项目级 context 文件)
 */
export class SyncService {
  private config: SyncConfig | null = null
  private configPath: string
  private localDataVersion = 0  // 本地数据版本号（每次变更 +1）
  private lastSyncVersion = 0   // 上次同步时的版本号

  constructor(
    private authService: AuthService,
    private projectService: ProjectService,
    private workflowEngine: WorkflowEngine,
    private templateService: TemplateService,
  ) {
    const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
    this.configPath = join(home, '.agent-flow', 'sync-config.json')
  }

  // ════════════════════════════════════════
  // 初始化 & 配置
  // ════════════════════════════════════════

  /** 加载同步配置 */
  async load(): Promise<void> {
    try {
      const raw = await readFile(this.configPath, 'utf-8')
      this.config = JSON.parse(raw)
    } catch {
      this.config = null
    }
  }

  /** 保存同步配置 */
  private async saveConfig(): Promise<void> {
    const dir = this.configPath.replace(/\/[^/]+$/, '')
    await mkdir(dir, { recursive: true })
    await writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8')
  }

  /** 配置同步仓库 */
  async configure(repoFullName: string, autoSync = true): Promise<SyncConfig> {
    this.config = {
      repoFullName,
      autoSync,
      lastSyncAt: undefined,
      lastCommitSha: undefined,
    }
    await this.saveConfig()

    // 确保远端仓库有初始结构
    await this.ensureRepoStructure()

    return this.config
  }

  /** 获取同步状态 */
  getStatus(): SyncStatus {
    return {
      configured: this.config !== null,
      repoFullName: this.config?.repoFullName || null,
      autoSync: this.config?.autoSync ?? false,
      lastSyncAt: this.config?.lastSyncAt || null,
      lastCommitSha: this.config?.lastCommitSha || null,
      authenticated: this.authService.isAuthenticated(),
      dirty: this.localDataVersion > this.lastSyncVersion,
    }
  }

  /** 获取同步配置 */
  getConfig(): SyncConfig | null {
    return this.config
  }

  /** 更新自动同步开关 */
  async setAutoSync(enabled: boolean): Promise<void> {
    if (!this.config) throw new Error('Sync not configured')
    this.config.autoSync = enabled
    await this.saveConfig()
  }

  /** 断开同步（清除配置但不删除远端数据） */
  async disconnect(): Promise<void> {
    this.config = null
    await this.saveConfig()
  }

  // ════════════════════════════════════════
  // Push（本地 → 远端）
  // ════════════════════════════════════════

  /** 推送本地数据到远端 GitHub 仓库 */
  async push(): Promise<{ success: boolean; filesUpdated: number; commitSha?: string }> {
    if (!this.config) throw new Error('Sync not configured')
    const token = this.authService.getAccessToken()
    if (!token) throw new Error('Not authenticated with GitHub')

    const repo = this.config.repoFullName
    let filesUpdated = 0

    try {
      // 1. 推送 projects.json
      const projects = this.projectService.getProjects()
      await this.putFile(token, repo, 'projects.json', JSON.stringify(projects, null, 2))
      filesUpdated++

      // 2. 推送 templates.json
      const templates = this.templateService.getTemplates()
      await this.putFile(token, repo, 'templates.json', JSON.stringify(templates, null, 2))
      filesUpdated++

      // 3. 推送 runs（每个 Run 一个文件）
      const runs = this.workflowEngine.getRuns()
      for (const run of runs) {
        const runDetail = this.workflowEngine.getRun(run.id)
        if (runDetail) {
          await this.putFile(token, repo, `runs/${run.id}.json`, JSON.stringify(runDetail, null, 2))
          filesUpdated++
        }
      }

      // 4. 清理远端已删除的 Runs
      await this.cleanupDeletedRuns(token, repo, runs.map(r => r.id))

      // 5. 推送 Context DB 文件（项目内的 .agent-flow/context/ 目录）
      const contextFilesCount = await this.pushContextDb(token, repo, projects)
      filesUpdated += contextFilesCount

      // 6. 更新 manifest
      const manifest = {
        version: 1,
        syncedAt: Date.now(),
        syncedFrom: process.env.HOSTNAME || 'unknown',
        projectCount: projects.length,
        templateCount: templates.length,
        runCount: runs.length,
        contextDbFiles: contextFilesCount,
      }
      await this.putFile(token, repo, 'manifest.json', JSON.stringify(manifest, null, 2))
      filesUpdated++

      // 7. 更新同步状态
      this.config.lastSyncAt = Date.now()
      this.lastSyncVersion = this.localDataVersion
      await this.saveConfig()

      return { success: true, filesUpdated }
    } catch (err) {
      console.error('[Sync] Push failed:', (err as Error).message)
      throw new Error(`Push failed: ${(err as Error).message}`)
    }
  }

  // ════════════════════════════════════════
  // Pull（远端 → 本地）
  // ════════════════════════════════════════

  /** 从远端 GitHub 仓库拉取数据并合并到本地 */
  async pull(): Promise<{ success: boolean; filesRead: number; conflicts: string[] }> {
    if (!this.config) throw new Error('Sync not configured')
    const token = this.authService.getAccessToken()
    if (!token) throw new Error('Not authenticated with GitHub')

    const repo = this.config.repoFullName
    let filesRead = 0
    const conflicts: string[] = []

    try {
      // 1. 读取远端 manifest
      const manifestRaw = await this.getFile(token, repo, 'manifest.json')
      if (!manifestRaw) {
        return { success: true, filesRead: 0, conflicts: ['Remote repo is empty, nothing to pull'] }
      }
      const manifest = JSON.parse(manifestRaw)
      filesRead++

      // 2. LWW 冲突检测：远端同步时间 vs 本地同步时间
      const remoteSyncedAt = manifest.syncedAt || 0
      const localSyncedAt = this.config.lastSyncAt || 0

      // 如果本地比远端更新，且有未推送的变更，标记冲突
      if (localSyncedAt > remoteSyncedAt && this.localDataVersion > this.lastSyncVersion) {
        conflicts.push('Local data is newer than remote. Use force-pull to overwrite local data.')
      }

      // 3. 拉取 projects.json
      const projectsRaw = await this.getFile(token, repo, 'projects.json')
      if (projectsRaw) {
        const remoteProjects = JSON.parse(projectsRaw)
        await this.mergeProjects(remoteProjects)
        filesRead++
      }

      // 4. 拉取 templates.json
      const templatesRaw = await this.getFile(token, repo, 'templates.json')
      if (templatesRaw) {
        const remoteTemplates = JSON.parse(templatesRaw)
        await this.mergeTemplates(remoteTemplates)
        filesRead++
      }

      // 5. 拉取 runs/
      const runFiles = await this.listDir(token, repo, 'runs')
      for (const file of runFiles) {
        if (file.name.endsWith('.json')) {
          const runRaw = await this.getFile(token, repo, `runs/${file.name}`)
          if (runRaw) {
            const remoteRun = JSON.parse(runRaw)
            await this.mergeRun(remoteRun)
            filesRead++
          }
        }
      }

      // 6. 拉取 context-db/（递归下载到各项目的 .agent-flow/context/ 目录）
      const contextFilesRead = await this.pullContextDb(token, repo)
      filesRead += contextFilesRead

      // 7. 更新本地同步状态
      this.config.lastSyncAt = Date.now()
      this.lastSyncVersion = this.localDataVersion
      await this.saveConfig()

      return { success: true, filesRead, conflicts }
    } catch (err) {
      console.error('[Sync] Pull failed:', (err as Error).message)
      throw new Error(`Pull failed: ${(err as Error).message}`)
    }
  }

  // ════════════════════════════════════════
  // 数据合并策略（LWW）
  // ════════════════════════════════════════

  /** 合并远端项目数据（基于 lastActiveAt 的 LWW） */
  private async mergeProjects(remoteProjects: any[]): Promise<void> {
    const localProjects = this.projectService.getProjects()
    const localMap = new Map(localProjects.map(p => [p.id, p]))

    for (const remote of remoteProjects) {
      const local = localMap.get(remote.id)
      if (!local) {
        // 远端有、本地没有 → 添加到本地
        await this.projectService.addProject({
          name: remote.name,
          path: remote.path,
          description: remote.description,
          contextConfig: remote.contextConfig,
        })
      } else if (remote.lastActiveAt > local.lastActiveAt) {
        // 远端更新 → 覆盖本地
        await this.projectService.updateProject(local.id, {
          name: remote.name,
          description: remote.description,
          contextConfig: remote.contextConfig,
          enabledAgentIds: remote.enabledAgentIds,
        })
      }
      // 本地更新 → 不覆盖（等 push 时同步上去）
    }
  }

  /** 合并远端模板数据 */
  private async mergeTemplates(remoteTemplates: any[]): Promise<void> {
    const localTemplates = this.templateService.getTemplates()
    const localIds = new Set(localTemplates.map(t => t.id))

    for (const remote of remoteTemplates) {
      if (!localIds.has(remote.id)) {
        // 远端有、本地没有 → 创建
        await this.templateService.createTemplate(remote)
      }
      // 模板一般不频繁修改，简单用 ID 去重即可
    }
  }

  /** 合并单个 Run */
  private async mergeRun(remoteRun: any): Promise<void> {
    const localRun = this.workflowEngine.getRun(remoteRun.id)
    if (!localRun) {
      // 远端有、本地没有 → 导入
      await this.workflowEngine.importRun(remoteRun)
    } else {
      // 都有 → 比较最后活跃时间，取更新的
      const remoteTime = remoteRun.completedAt || remoteRun.startedAt || remoteRun.createdAt || 0
      const localTime = localRun.completedAt || localRun.startedAt || localRun.createdAt || 0
      if (remoteTime > localTime) {
        await this.workflowEngine.importRun(remoteRun)
      }
    }
  }

  // ════════════════════════════════════════
  // GitHub Contents API 封装
  // ════════════════════════════════════════

  /** 读取远端文件内容 */
  private async getFile(token: string, repo: string, path: string): Promise<string | null> {
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      })
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${res.statusText}`)

      const data = await res.json() as GitHubFileContent
      if (data.content && data.encoding === 'base64') {
        return Buffer.from(data.content, 'base64').toString('utf-8')
      }
      return null
    } catch (err) {
      if ((err as any)?.message?.includes('404')) return null
      throw err
    }
  }

  /** 创建或更新远端文件 */
  private async putFile(token: string, repo: string, path: string, content: string): Promise<void> {
    // 先获取现有文件的 SHA（更新时需要）
    let sha: string | undefined
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      })
      if (res.ok) {
        const data = await res.json() as GitHubFileContent
        sha = data.sha
      }
    } catch {
      // 文件不存在，sha 为 undefined（创建新文件）
    }

    const body: any = {
      message: `sync: update ${path}`,
      content: Buffer.from(content, 'utf-8').toString('base64'),
    }
    if (sha) body.sha = sha

    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(`Failed to put file ${path}: ${res.status} ${(err as any)?.message || res.statusText}`)
    }
  }

  /** 删除远端文件 */
  private async deleteFile(token: string, repo: string, path: string): Promise<void> {
    // 先获取 SHA
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    })
    if (!res.ok) return // 文件不存在就不用删

    const data = await res.json() as GitHubFileContent
    await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `sync: delete ${path}`,
        sha: data.sha,
      }),
    })
  }

  /** 列出远端目录下的文件 */
  private async listDir(token: string, repo: string, path: string): Promise<GitHubFileContent[]> {
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      })
      if (res.status === 404) return []
      if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)

      const data = await res.json()
      return Array.isArray(data) ? data : []
    } catch {
      return []
    }
  }

  // ════════════════════════════════════════
  // 辅助方法
  // ════════════════════════════════════════

  /** 确保远端仓库有基本文件结构 */
  private async ensureRepoStructure(): Promise<void> {
    const token = this.authService.getAccessToken()
    if (!token || !this.config) return

    const repo = this.config.repoFullName

    // 检查是否已有 manifest.json
    const manifest = await this.getFile(token, repo, 'manifest.json')
    if (!manifest) {
      // 首次初始化：创建 manifest 和 README
      await this.putFile(token, repo, 'manifest.json', JSON.stringify({
        version: 1,
        syncedAt: Date.now(),
        syncedFrom: process.env.HOSTNAME || 'unknown',
        projectCount: 0,
        templateCount: 0,
        runCount: 0,
      }, null, 2))

      await this.putFile(token, repo, 'README.md', [
        '# AgentFlow Data Sync',
        '',
        'This repository stores AgentFlow project data for multi-device synchronization.',
        '',
        '> **⚠️ Do not manually edit these files** — they are managed by AgentFlow automatically.',
        '',
        '## Structure',
        '',
        '- `manifest.json` — Sync metadata',
        '- `projects.json` — Project list and configurations',
        '- `templates.json` — Workflow templates',
        '- `runs/` — Individual run data (one file per run)',
      ].join('\n'))
    }
  }

  /** 清理远端已被本地删除的 Run 文件 */
  private async cleanupDeletedRuns(token: string, repo: string, localRunIds: string[]): Promise<void> {
    const remoteFiles = await this.listDir(token, repo, 'runs')
    const localIdSet = new Set(localRunIds)

    for (const file of remoteFiles) {
      if (file.name.endsWith('.json')) {
        const runId = file.name.replace('.json', '')
        if (!localIdSet.has(runId)) {
          await this.deleteFile(token, repo, `runs/${file.name}`)
        }
      }
    }
  }

  // ════════════════════════════════════════
  // Context DB 同步
  // ════════════════════════════════════════

  /**
   * 推送 Context DB 到远端
   * 
   * 遍历每个项目的 .agent-flow/context/ 目录，
   * 上传到远端 context-db/{projectId}/ 下。
   * 同时上传全局 ~/.agent-flow/context-db/ 下的 SYS 层文件。
   */
  private async pushContextDb(token: string, repo: string, projects: any[]): Promise<number> {
    let filesUploaded = 0

    // 1. 推送全局 context-db（SYS 层）
    const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
    const globalContextDir = join(home, '.agent-flow', 'context-db')
    const globalFiles = await this.scanDirRecursive(globalContextDir)
    for (const filePath of globalFiles) {
      const relativePath = relative(globalContextDir, filePath)
      const content = await readFile(filePath, 'utf-8')
      await this.putFile(token, repo, `context-db/_global/${relativePath}`, content)
      filesUploaded++
    }

    // 2. 推送各项目的 .agent-flow/context/ 目录
    for (const project of projects) {
      if (!project.path) continue
      const contextDir = join(project.path, '.agent-flow', 'context')
      const files = await this.scanDirRecursive(contextDir)
      for (const filePath of files) {
        const relativePath = relative(contextDir, filePath)
        const content = await readFile(filePath, 'utf-8')
        await this.putFile(token, repo, `context-db/${project.id}/${relativePath}`, content)
        filesUploaded++
      }
    }

    return filesUploaded
  }

  /**
   * 从远端拉取 Context DB 到本地
   * 
   * 下载 context-db/{projectId}/ 下的文件到对应项目的 .agent-flow/context/ 目录。
   * 下载 context-db/_global/ 到 ~/.agent-flow/context-db/。
   */
  private async pullContextDb(token: string, repo: string): Promise<number> {
    let filesRead = 0

    // 列出 context-db/ 顶层目录
    const topDirs = await this.listDir(token, repo, 'context-db')
    if (topDirs.length === 0) return 0

    const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
    const projects = this.projectService.getProjects()
    const projectMap = new Map(projects.map(p => [p.id, p]))

    for (const dir of topDirs) {
      if (dir.name === '_global') {
        // 全局 context-db → ~/.agent-flow/context-db/
        const globalContextDir = join(home, '.agent-flow', 'context-db')
        filesRead += await this.pullDirRecursive(token, repo, 'context-db/_global', globalContextDir)
      } else {
        // 项目级 context → {project.path}/.agent-flow/context/
        const project = projectMap.get(dir.name)
        if (project?.path) {
          const contextDir = join(project.path, '.agent-flow', 'context')
          filesRead += await this.pullDirRecursive(token, repo, `context-db/${dir.name}`, contextDir)
        }
      }
    }

    return filesRead
  }

  /** 递归扫描本地目录，返回所有文件的绝对路径 */
  private async scanDirRecursive(dirPath: string): Promise<string[]> {
    const files: string[] = []
    try {
      const entries = await readdir(dirPath)
      for (const entry of entries) {
        if (entry.startsWith('.')) continue // 跳过隐藏文件
        const fullPath = join(dirPath, entry)
        const fileStat = await stat(fullPath)
        if (fileStat.isDirectory()) {
          const subFiles = await this.scanDirRecursive(fullPath)
          files.push(...subFiles)
        } else if (fileStat.isFile()) {
          files.push(fullPath)
        }
      }
    } catch {
      // 目录不存在或无法读取，返回空
    }
    return files
  }

  /** 递归从远端目录下载文件到本地目录 */
  private async pullDirRecursive(token: string, repo: string, remotePath: string, localDir: string): Promise<number> {
    let count = 0
    const entries = await this.listDir(token, repo, remotePath)

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const entryRemotePath = `${remotePath}/${entry.name}`

      if (entry.size === 0 && !entry.content) {
        // 可能是目录（GitHub Contents API 对目录返回 size=0 且无 content）
        // 尝试递归列出
        const subEntries = await this.listDir(token, repo, entryRemotePath)
        if (subEntries.length > 0) {
          const subDir = join(localDir, entry.name)
          count += await this.pullDirRecursive(token, repo, entryRemotePath, subDir)
          continue
        }
      }

      // 下载文件内容（LWW：本地文件更新则跳过覆盖）
      const localPath = join(localDir, entry.name)
      let shouldWrite = true
      try {
        const localStat = await stat(localPath)
        // 如果本地文件比远端仓库最后同步时间更新，则跳过（本地优先）
        if (localStat.mtimeMs > (this.config.lastSyncAt || 0)) {
          shouldWrite = false
        }
      } catch {
        // 本地文件不存在，直接写入
      }

      if (shouldWrite) {
        const content = await this.getFile(token, repo, entryRemotePath)
        if (content !== null) {
          const dir = localPath.replace(/\/[^/]+$/, '')
          await mkdir(dir, { recursive: true })
          await writeFile(localPath, content, 'utf-8')
          count++
        }
      }
    }

    return count
  }

  /** 创建远端私有仓库（如果不存在） */
  async createSyncRepo(repoName: string): Promise<{ full_name: string; html_url: string }> {
    const token = this.authService.getAccessToken()
    if (!token) throw new Error('Not authenticated with GitHub')

    // 先检查仓库是否已存在
    const user = this.authService.getCurrentUser()
    if (!user) throw new Error('User not found')
    const fullName = `${user.login}/${repoName}`

    const checkRes = await fetch(`https://api.github.com/repos/${fullName}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    })

    if (checkRes.ok) {
      const existing = await checkRes.json() as any
      return { full_name: existing.full_name, html_url: existing.html_url }
    }

    // 创建新的私有仓库
    const res = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: repoName,
        description: 'AgentFlow data sync (auto-managed)',
        private: true,
        auto_init: true,  // 创建初始 README 以便 Contents API 可以直接使用
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(`Failed to create repo: ${(err as any)?.message || res.statusText}`)
    }

    const repo = await res.json() as any
    return { full_name: repo.full_name, html_url: repo.html_url }
  }

  /** 标记本地数据已变更（由外部服务调用） */
  markDirty(): void {
    this.localDataVersion++
  }

  /** 自动同步触发（如果启用了 autoSync 且有未推送变更） */
  async autoSyncIfNeeded(): Promise<void> {
    if (!this.config?.autoSync) return
    if (this.localDataVersion <= this.lastSyncVersion) return
    if (!this.authService.isAuthenticated()) return

    try {
      await this.push()
      console.log('[Sync] Auto-sync completed')
    } catch (err) {
      console.error('[Sync] Auto-sync failed:', (err as Error).message)
    }
  }
}
