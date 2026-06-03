import { readFile, writeFile, mkdir, readdir, stat } from 'fs/promises'
import { join, relative } from 'path'
import type { AuthService } from './auth.js'
import { ProjectService } from './project.js'
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
  /**
   * 跨设备项目路径映射
   * key = 远端项目 ID（如 proj_1780050115714）
   * value = 本地项目路径（如 /Users/xxx/projects/agent-flow）
   * 
   * 当新设备 pull 时，远端项目 ID 不在本地 projects 中，
   * 系统会查找 pathMapping 来确定本地路径，并以远端 ID 创建项目。
   */
  pathMapping?: Record<string, string>
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
  /** 当前用户的远端路径前缀（如 users/XiaoPeng1112） */
  userPrefix: string | null
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
 * GitHub Sync Service (v2 Multi-User)
 * 
 * 将本地 AgentFlow 数据同步到 GitHub 仓库，支持多用户数据隔离。
 * 
 * 架构设计：
 *   - 使用 GitHub Contents API（无需本地 git CLI）
 *   - 多用户隔离：每个用户数据存储在 users/{github_login}/ 下
 *   - 共享资源：团队公共模板/context 存储在 shared/ 下
 *   - 冲突策略：LWW（Last Write Wins），以时间戳较新的为准
 *   - 数据范围：projects.json、templates.json、runs/、context-db/
 *   - 权限控制：通过 GitHub Collaborator 管理仓库访问
 * 
 * 远端仓库结构（v2 多用户版）：
 *   agent-flow-data/
 *   ├── README.md
 *   ├── users/
 *   │   ├── {github_login_A}/       (用户 A 的独立数据空间)
 *   │   │   ├── manifest.json
 *   │   │   ├── projects.json
 *   │   │   ├── templates.json
 *   │   │   ├── runs/
 *   │   │   │   └── {runId}.json
 *   │   │   └── context-db/
 *   │   │       ├── _global/
 *   │   │       └── {projectId}/
 *   │   └── {github_login_B}/       (协作者 B 的独立空间)
 *   │       └── ...
 *   └── shared/                      (团队共享资源)
 *       ├── templates.json
 *       └── context-db/
 */
export class SyncService {
  private config: SyncConfig | null = null
  private configPath: string
  private localDataVersion = 0  // 本地数据版本号（每次变更 +1）
  private lastSyncVersion = 0   // 上次同步时的版本号
  private pushQueue: Promise<unknown> = Promise.resolve()

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
    const user = this.authService.getCurrentUser()
    return {
      configured: this.config !== null,
      repoFullName: this.config?.repoFullName || null,
      autoSync: this.config?.autoSync ?? false,
      lastSyncAt: this.config?.lastSyncAt || null,
      lastCommitSha: this.config?.lastCommitSha || null,
      authenticated: this.authService.isAuthenticated(),
      dirty: this.localDataVersion > this.lastSyncVersion,
      userPrefix: user ? `users/${user.login}` : null,
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
  // 跨设备项目路径映射
  // ════════════════════════════════════════

  /** 获取当前路径映射配置 */
  getPathMapping(): Record<string, string> {
    return this.config?.pathMapping || {}
  }

  /**
   * 设置项目路径映射（跨设备同步时使用）
   * 
   * @param mapping - { remoteProjectId: localPath } 的映射关系
   * @param merge - 是否合并到现有映射（默认 true），false 则覆盖
   */
  async setPathMapping(mapping: Record<string, string>, merge = true): Promise<Record<string, string>> {
    if (!this.config) throw new Error('Sync not configured')

    if (merge) {
      this.config.pathMapping = {
        ...(this.config.pathMapping || {}),
        ...mapping,
      }
    } else {
      this.config.pathMapping = mapping
    }

    await this.saveConfig()
    return this.config.pathMapping
  }

  /** 删除单个路径映射 */
  async removePathMapping(projectId: string): Promise<void> {
    if (!this.config) throw new Error('Sync not configured')
    if (this.config.pathMapping) {
      delete this.config.pathMapping[projectId]
      await this.saveConfig()
    }
  }

  /**
   * 查询远端仓库中当前用户的所有项目
   * 用于新设备查看哪些远端项目已经自动匹配、哪些还需要手动添加
   */
  async getRemoteProjects(): Promise<Array<{ id: string; name: string; path: string; gitRemote?: string; matched: boolean; localPath?: string }>> {
    if (!this.config) throw new Error('Sync not configured')
    const token = this.authService.getAccessToken()
    if (!token) throw new Error('Not authenticated with GitHub')

    const repo = this.config.repoFullName
    const projectsRaw = await this.getFile(token, repo, this.userPath('projects.json'))
    if (!projectsRaw) return []

    const remoteProjects = JSON.parse(projectsRaw) as Array<{ id: string; name: string; path: string; gitRemote?: string }>
    const localProjects = this.projectService.getProjects()
    const localMap = new Map(localProjects.map(p => [p.id, p]))

    // 也按 gitRemote 做匹配检测
    const localByGitRemote = new Map<string, typeof localProjects[0]>()
    for (const p of localProjects) {
      if (p.gitRemote) {
        localByGitRemote.set(ProjectService.normalizeGitRemote(p.gitRemote), p)
      }
    }

    return remoteProjects.map(rp => {
      const localById = localMap.get(rp.id)
      const localByRemote = rp.gitRemote ? localByGitRemote.get(ProjectService.normalizeGitRemote(rp.gitRemote)) : undefined
      const matchedLocal = localById || localByRemote
      return {
        id: rp.id,
        name: rp.name,
        path: rp.path,
        gitRemote: rp.gitRemote,
        matched: !!matchedLocal,
        localPath: matchedLocal?.path || undefined,
      }
    })
  }

  // ════════════════════════════════════════
  // 用户路径隔离
  // ════════════════════════════════════════

  /**
   * 获取当前用户的远端路径前缀
   * 多用户模式下每个用户的数据都在 users/{login}/ 下
   */
  private getUserPrefix(): string {
    const user = this.authService.getCurrentUser()
    if (!user) throw new Error('User not authenticated, cannot determine user prefix')
    return `users/${user.login}`
  }

  /**
   * 构建用户级远端路径
   * 例如: userPath('projects.json') → 'users/XiaoPeng1112/projects.json'
   */
  private userPath(path: string): string {
    return `${this.getUserPrefix()}/${path}`
  }

  /**
   * 构建共享级远端路径
   * 例如: sharedPath('templates.json') → 'shared/templates.json'
   */
  private sharedPath(path: string): string {
    return `shared/${path}`
  }

  // ════════════════════════════════════════
  // Push（本地 → 远端）
  // ════════════════════════════════════════

  /** 推送本地数据到远端 GitHub 仓库（用户隔离目录 users/{login}/） */
  async push(): Promise<{ success: boolean; filesUpdated: number; commitSha?: string }> {
    const queuedPush = this.pushQueue.then(
      () => this.performPush(),
      () => this.performPush(),
    )
    this.pushQueue = queuedPush.then(() => undefined, () => undefined)
    return queuedPush
  }

  /** 执行一次实际的 push，同一时刻只允许一个实例运行 */
  private async performPush(): Promise<{ success: boolean; filesUpdated: number; commitSha?: string }> {
    if (!this.config) throw new Error('Sync not configured')
    const token = this.authService.getAccessToken()
    if (!token) throw new Error('Not authenticated with GitHub')

    const repo = this.config.repoFullName
    let filesUpdated = 0
    const syncTargetVersion = this.localDataVersion

    try {
      // 1. 推送 projects.json（用户级）
      const projects = this.projectService.getProjects()
      await this.putFile(token, repo, this.userPath('projects.json'), JSON.stringify(projects, null, 2))
      filesUpdated++

      // 2. 推送 templates.json（用户级）
      const templates = this.templateService.getTemplates()
      await this.putFile(token, repo, this.userPath('templates.json'), JSON.stringify(templates, null, 2))
      filesUpdated++

      // 3. 推送 runs（用户级，每个 Run 一个文件，包含关联的 turns）
      const runs = this.workflowEngine.getRuns()
      for (const run of runs) {
        const runDetail = this.workflowEngine.getRun(run.id)
        if (runDetail) {
          const runTurns = this.workflowEngine.getRunTurns(run.id)
          const runPayload = {
            ...runDetail,
            _turns: runTurns,  // 附带 turns 数据一起同步
          }
          await this.putFile(token, repo, this.userPath(`runs/${run.id}.json`), JSON.stringify(runPayload, null, 2))
          filesUpdated++
        }
      }

      // 4. 清理远端已删除的 Runs（用户级）
      await this.cleanupDeletedRuns(token, repo, runs.map(r => r.id))

      // 5. 推送 Context DB 文件（用户级）
      const contextFilesCount = await this.pushContextDb(token, repo, projects)
      filesUpdated += contextFilesCount

      // 6. 更新用户 manifest（v2 多用户结构）
      const manifest = {
        version: 2,
        userLogin: this.authService.getCurrentUser()?.login,
        syncedAt: Date.now(),
        syncedFrom: process.env.HOSTNAME || 'unknown',
        projectCount: projects.length,
        templateCount: templates.length,
        runCount: runs.length,
        contextDbFiles: contextFilesCount,
      }
      await this.putFile(token, repo, this.userPath('manifest.json'), JSON.stringify(manifest, null, 2))
      filesUpdated++

      // 7. 更新同步状态
      this.config.lastSyncAt = Date.now()
      this.lastSyncVersion = syncTargetVersion
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

  /** 从远端 GitHub 仓库拉取当前用户的数据并合并到本地 */
  async pull(): Promise<{ success: boolean; filesRead: number; conflicts: string[]; unmappedProjects?: Array<{ id: string; name: string; path: string; gitRemote?: string }> }> {
    if (!this.config) throw new Error('Sync not configured')
    const token = this.authService.getAccessToken()
    if (!token) throw new Error('Not authenticated with GitHub')

    const repo = this.config.repoFullName
    let filesRead = 0
    const conflicts: string[] = []
    let unmappedProjects: Array<{ id: string; name: string; path: string; gitRemote?: string }> = []

    try {
      // 1. 读取用户级 manifest
      const manifestRaw = await this.getFile(token, repo, this.userPath('manifest.json'))
      if (!manifestRaw) {
        // 兼容旧结构：尝试读取根级 manifest（迁移前的 v1 数据）
        const legacyManifest = await this.getFile(token, repo, 'manifest.json')
        if (legacyManifest) {
          conflicts.push('Detected legacy v1 repo structure. Run migrateFromV1() to migrate data to users/ directory.')
        }
        return { success: true, filesRead: 0, conflicts }
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

      // 3. 拉取 projects.json（用户级）
      const projectsRaw = await this.getFile(token, repo, this.userPath('projects.json'))
      if (projectsRaw) {
        const remoteProjects = JSON.parse(projectsRaw)
        const mergeResult = await this.mergeProjects(remoteProjects)
        unmappedProjects = mergeResult.unmappedProjects
        filesRead++
      }

      // 4. 拉取 templates.json（用户级）
      const templatesRaw = await this.getFile(token, repo, this.userPath('templates.json'))
      if (templatesRaw) {
        const remoteTemplates = JSON.parse(templatesRaw)
        await this.mergeTemplates(remoteTemplates)
        filesRead++
      }

      // 5. 拉取 runs/（用户级）— 包含删除远端已移除的 Run
      const runFiles = await this.listDir(token, repo, this.userPath('runs'))
      const remoteRunIds = new Set<string>()
      for (const file of runFiles) {
        if (file.name.endsWith('.json')) {
          const runRaw = await this.getFile(token, repo, this.userPath(`runs/${file.name}`))
          if (runRaw) {
            const remoteRun = JSON.parse(runRaw)
            remoteRunIds.add(remoteRun.id)
            await this.mergeRun(remoteRun)
            filesRead++
          }
        }
      }

      // 5b. 删除远端已不存在的本地 Run（同步删除）
      if (remoteRunIds.size > 0) {
        const localRuns = this.workflowEngine.getRuns()
        for (const localRun of localRuns) {
          if (!remoteRunIds.has(localRun.id)) {
            console.log(`[Sync] Deleting local run ${localRun.id} (removed on remote)`)
            await this.workflowEngine.deleteRun(localRun.id)
          }
        }
      }

      // 6. 拉取 context-db/（用户级）
      const contextFilesRead = await this.pullContextDb(token, repo)
      filesRead += contextFilesRead

      // 7. 拉取 shared/ 共享资源（团队公共模板和 context）
      const sharedFilesRead = await this.pullSharedResources(token, repo)
      filesRead += sharedFilesRead

      // 8. 更新本地同步状态
      this.config.lastSyncAt = Date.now()
      this.lastSyncVersion = this.localDataVersion
      await this.saveConfig()

      // 如果有未映射的项目，提示用户先在系统中添加对应项目
      if (unmappedProjects.length > 0) {
        const names = unmappedProjects.map(p => p.name).join(', ')
        conflicts.push(`Found ${unmappedProjects.length} remote project(s) not matched locally: [${names}]. Please clone the repo and add the project in AgentFlow first, then pull again.`)
      }

      return { success: true, filesRead, conflicts, unmappedProjects: unmappedProjects.length > 0 ? unmappedProjects : undefined }
    } catch (err) {
      console.error('[Sync] Pull failed:', (err as Error).message)
      throw new Error(`Pull failed: ${(err as Error).message}`)
    }
  }

  // ════════════════════════════════════════
  // 数据合并策略（LWW）
  // ════════════════════════════════════════

  /**
   * 合并远端项目数据（基于 lastActiveAt 的 LWW + gitRemote 自动匹配）
   * 
   * 跨设备同步流程：
   *   1. 用户在新设备上克隆项目代码、在系统中添加项目（此时本地生成新 ID，自动探测 gitRemote）
   *   2. Pull 时，远端项目 ID 本地没有 → 按 gitRemote 匹配本地已有项目
   *   3. 匹配成功 → 将本地项目 ID 替换为远端 ID（保持全局一致）
   *   4. 匹配失败 → 记录为 unmappedProjects，可能是用户还没添加该项目
   */
  private async mergeProjects(remoteProjects: any[]): Promise<{ unmappedProjects: Array<{ id: string; name: string; path: string; gitRemote?: string }> }> {
    const localProjects = this.projectService.getProjects()
    const localMap = new Map(localProjects.map(p => [p.id, p]))
    const unmappedProjects: Array<{ id: string; name: string; path: string; gitRemote?: string }> = []

    // 构建本地 gitRemote → project 的索引（标准化后）
    const localByGitRemote = new Map<string, typeof localProjects[0]>()
    for (const p of localProjects) {
      if (p.gitRemote) {
        const normalized = ProjectService.normalizeGitRemote(p.gitRemote)
        localByGitRemote.set(normalized, p)
      }
    }

    for (const remote of remoteProjects) {
      const local = localMap.get(remote.id)
      if (local) {
        // ID 直接匹配 → LWW 更新
        if (remote.lastActiveAt > local.lastActiveAt) {
          await this.projectService.updateProject(local.id, {
            name: remote.name,
            description: remote.description,
            contextConfig: remote.contextConfig,
            enabledAgentIds: remote.enabledAgentIds,
          })
        }
        // 本地更新 → 不覆盖（等 push 时同步上去）
      } else {
        // 远端 ID 本地没有 → 尝试按 gitRemote 匹配
        let matched = false

        if (remote.gitRemote) {
          const remoteNormalized = ProjectService.normalizeGitRemote(remote.gitRemote)
          const localMatch = localByGitRemote.get(remoteNormalized)

          if (localMatch) {
            // gitRemote 匹配成功！将本地 ID 替换为远端 ID
            console.log(`[Sync] Auto-matched by gitRemote: local "${localMatch.id}" → remote "${remote.id}" (${remoteNormalized})`)
            await this.projectService.replaceProjectId(localMatch.id, remote.id)
            // 更新 localMap 以避免后续重复匹配
            localMap.delete(localMatch.id)
            localMap.set(remote.id, { ...localMatch, id: remote.id })
            localByGitRemote.delete(remoteNormalized)
            matched = true
          }
        }

        if (!matched) {
          // 也尝试用 pathMapping 兜底（向后兼容）
          const pathMapping = this.config?.pathMapping || {}
          const mappedPath = pathMapping[remote.id]
          if (mappedPath) {
            await this.projectService.addProjectWithId({
              id: remote.id,
              name: remote.name,
              path: mappedPath,
              description: remote.description,
              contextConfig: remote.contextConfig,
              gitRemote: remote.gitRemote,
              createdAt: remote.createdAt,
              lastActiveAt: remote.lastActiveAt,
            })
            console.log(`[Sync] Mapped via pathMapping: ${remote.id} → ${mappedPath}`)
            matched = true
          }
        }

        if (!matched) {
          // 无法匹配 → 等待用户先在系统中添加该项目
          unmappedProjects.push({
            id: remote.id,
            name: remote.name,
            path: remote.path,
            gitRemote: remote.gitRemote,
          })
          console.log(`[Sync] Unmapped remote project: ${remote.id} (${remote.name}), gitRemote: ${remote.gitRemote || 'none'}`)
        }
      }
    }

    return { unmappedProjects }
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
    // 提取 _turns 数据（push 时附带的 turns 序列化字段）
    const turnsData = remoteRun._turns || undefined
    // 从 run 对象中移除 _turns，避免污染 Run 数据结构
    const { _turns, ...runData } = remoteRun

    const localRun = this.workflowEngine.getRun(runData.id)
    if (!localRun) {
      // 远端有、本地没有 → 导入（含 turns）
      await this.workflowEngine.importRun(runData, turnsData)
    } else {
      // 都有 → 比较最后活跃时间，取更新的
      const remoteTime = runData.completedAt || runData.startedAt || runData.createdAt || 0
      const localTime = localRun.completedAt || localRun.startedAt || localRun.createdAt || 0
      if (remoteTime > localTime) {
        await this.workflowEngine.importRun(runData, turnsData)
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
    let sha = await this.getFileSha(token, repo, path)

    for (let attempt = 0; attempt < 2; attempt++) {
      const body: Record<string, string> = {
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

      if (res.ok) return

      const err = await res.json().catch(() => ({}))
      if (res.status === 409 && attempt === 0) {
        console.warn(`[Sync] Conflict detected for ${path}, refreshing SHA and retrying once`)
        sha = await this.getFileSha(token, repo, path)
        continue
      }

      throw new Error(`Failed to put file ${path}: ${res.status} ${(err as any)?.message || res.statusText}`)
    }
  }

  /** 获取远端文件当前 SHA（文件不存在时返回 undefined） */
  private async getFileSha(token: string, repo: string, path: string): Promise<string | undefined> {
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      })
      if (!res.ok) return undefined
      const data = await res.json() as GitHubFileContent
      return data.sha
    } catch {
      return undefined
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

  /** 确保远端仓库有基本文件结构（v2 多用户版） */
  private async ensureRepoStructure(): Promise<void> {
    const token = this.authService.getAccessToken()
    if (!token || !this.config) return

    const repo = this.config.repoFullName

    // 检查用户目录下是否已有 manifest.json
    const manifest = await this.getFile(token, repo, this.userPath('manifest.json'))
    if (!manifest) {
      // 首次初始化：创建用户 manifest
      const user = this.authService.getCurrentUser()
      await this.putFile(token, repo, this.userPath('manifest.json'), JSON.stringify({
        version: 2,
        userLogin: user?.login,
        syncedAt: Date.now(),
        syncedFrom: process.env.HOSTNAME || 'unknown',
        projectCount: 0,
        templateCount: 0,
        runCount: 0,
      }, null, 2))

      // 仅在仓库 README 不存在时创建（多用户共享的仓库级文件）
      const readme = await this.getFile(token, repo, 'README.md')
      if (!readme) {
        await this.putFile(token, repo, 'README.md', [
          '# AgentFlow Data Sync',
          '',
          'This repository stores AgentFlow project data for multi-user synchronization.',
          '',
          '> **Do not manually edit these files** — they are managed by AgentFlow automatically.',
          '',
          '## Structure (v2 Multi-User)',
          '',
          '```',
          'agent-flow-data/',
          '  users/',
          '    {github_login}/        <- Each user has isolated data',
          '      manifest.json',
          '      projects.json',
          '      templates.json',
          '      runs/',
          '      context-db/',
          '  shared/                   <- Team shared resources',
          '    templates.json',
          '    context-db/',
          '```',
          '',
          '## Access Control',
          '',
          'Add team members as **Collaborators** in repository settings.',
          'Each user reads/writes only their own `users/{login}/` directory via the app.',
          'Shared resources in `shared/` are accessible to all collaborators.',
        ].join('\n'))
      }
    }
  }

  /** 清理远端已被本地删除的 Run 文件（用户级路径） */
  private async cleanupDeletedRuns(token: string, repo: string, localRunIds: string[]): Promise<void> {
    const remoteFiles = await this.listDir(token, repo, this.userPath('runs'))
    const localIdSet = new Set(localRunIds)

    for (const file of remoteFiles) {
      if (file.name.endsWith('.json')) {
        const runId = file.name.replace('.json', '')
        if (!localIdSet.has(runId)) {
          await this.deleteFile(token, repo, this.userPath(`runs/${file.name}`))
        }
      }
    }
  }

  // ════════════════════════════════════════
  // Context DB 同步
  // ════════════════════════════════════════

  /**
   * 推送 Context DB 到远端（用户级路径）
   * 
   * 遍历每个项目的 .agent-flow/context/ 目录，
   * 上传到远端 users/{login}/context-db/{projectId}/ 下。
   * 同时上传全局 ~/.agent-flow/context-db/ 下的 SYS 层文件。
   */
  private async pushContextDb(token: string, repo: string, projects: any[]): Promise<number> {
    let filesUploaded = 0

    // 1. 推送全局 context-db（SYS 层）→ users/{login}/context-db/_global/
    const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
    const globalContextDir = join(home, '.agent-flow', 'context-db')
    const globalFiles = await this.scanDirRecursive(globalContextDir)
    for (const filePath of globalFiles) {
      const relativePath = relative(globalContextDir, filePath)
      const content = await readFile(filePath, 'utf-8')
      await this.putFile(token, repo, this.userPath(`context-db/_global/${relativePath}`), content)
      filesUploaded++
    }

    // 2. 推送各项目的 .agent-flow/context/ 目录 → users/{login}/context-db/{projectId}/
    for (const project of projects) {
      if (!project.path) continue
      const contextDir = join(project.path, '.agent-flow', 'context')
      const files = await this.scanDirRecursive(contextDir)
      for (const filePath of files) {
        const relativePath = relative(contextDir, filePath)
        const content = await readFile(filePath, 'utf-8')
        await this.putFile(token, repo, this.userPath(`context-db/${project.id}/${relativePath}`), content)
        filesUploaded++
      }
    }

    return filesUploaded
  }

  /**
   * 从远端拉取 Context DB 到本地（用户级路径）
   * 
   * 下载 users/{login}/context-db/{projectId}/ 下的文件到对应项目的 .agent-flow/context/ 目录。
   * 下载 users/{login}/context-db/_global/ 到 ~/.agent-flow/context-db/。
   */
  private async pullContextDb(token: string, repo: string): Promise<number> {
    let filesRead = 0

    // 列出 users/{login}/context-db/ 顶层目录
    const topDirs = await this.listDir(token, repo, this.userPath('context-db'))
    if (topDirs.length === 0) return 0

    const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
    const projects = this.projectService.getProjects()
    const projectMap = new Map(projects.map(p => [p.id, p]))

    for (const dir of topDirs) {
      if (dir.name === '_global') {
        // 全局 context-db → ~/.agent-flow/context-db/
        const globalContextDir = join(home, '.agent-flow', 'context-db')
        filesRead += await this.pullDirRecursive(token, repo, this.userPath('context-db/_global'), globalContextDir)
      } else {
        // 项目级 context → {project.path}/.agent-flow/context/
        const project = projectMap.get(dir.name)
        if (project?.path) {
          const contextDir = join(project.path, '.agent-flow', 'context')
          filesRead += await this.pullDirRecursive(token, repo, this.userPath(`context-db/${dir.name}`), contextDir)
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
        if (localStat.mtimeMs > (this.config?.lastSyncAt || 0)) {
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

  // ════════════════════════════════════════
  // Shared（团队公共资源同步）
  // ════════════════════════════════════════

  /**
   * 推送共享资源到 shared/ 目录
   * 可将模板和全局 context 标记为团队共享
   */
  async pushSharedResources(options: { templates?: boolean; contextFiles?: string[] } = {}): Promise<{ filesUpdated: number }> {
    if (!this.config) throw new Error('Sync not configured')
    const token = this.authService.getAccessToken()
    if (!token) throw new Error('Not authenticated with GitHub')

    const repo = this.config.repoFullName
    let filesUpdated = 0

    // 推送共享模板
    if (options.templates !== false) {
      const templates = this.templateService.getTemplates()
      await this.putFile(token, repo, this.sharedPath('templates.json'), JSON.stringify(templates, null, 2))
      filesUpdated++
    }

    // 推送指定的共享 context 文件
    if (options.contextFiles?.length) {
      for (const filePath of options.contextFiles) {
        try {
          const content = await readFile(filePath, 'utf-8')
          const filename = filePath.split('/').pop() || 'unknown.md'
          await this.putFile(token, repo, this.sharedPath(`context-db/${filename}`), content)
          filesUpdated++
        } catch {
          // 文件不存在，跳过
        }
      }
    }

    return { filesUpdated }
  }

  /**
   * 从远端拉取 shared/ 共享资源
   * 共享模板会合并到本地（不覆盖已有的同 ID 模板）
   * 共享 context 文件存到 ~/.agent-flow/context-db/ 下
   */
  private async pullSharedResources(token: string, repo: string): Promise<number> {
    let filesRead = 0

    // 拉取共享模板
    const sharedTemplatesRaw = await this.getFile(token, repo, this.sharedPath('templates.json'))
    if (sharedTemplatesRaw) {
      const sharedTemplates = JSON.parse(sharedTemplatesRaw)
      await this.mergeTemplates(sharedTemplates)
      filesRead++
    }

    // 拉取共享 context-db 文件
    const sharedContextFiles = await this.listDir(token, repo, this.sharedPath('context-db'))
    for (const file of sharedContextFiles) {
      if (file.name.startsWith('.')) continue
      const content = await this.getFile(token, repo, this.sharedPath(`context-db/${file.name}`))
      if (content) {
        const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
        const sharedDir = join(home, '.agent-flow', 'context-db', '_shared')
        await mkdir(sharedDir, { recursive: true })
        await writeFile(join(sharedDir, file.name), content, 'utf-8')
        filesRead++
      }
    }

    return filesRead
  }

  // ════════════════════════════════════════
  // 用户管理 & 数据迁移
  // ════════════════════════════════════════

  /** 列出仓库中所有用户目录 */
  async listUsers(): Promise<string[]> {
    if (!this.config) throw new Error('Sync not configured')
    const token = this.authService.getAccessToken()
    if (!token) throw new Error('Not authenticated with GitHub')

    const repo = this.config.repoFullName
    const dirs = await this.listDir(token, repo, 'users')
    return dirs.map(d => d.name)
  }

  /**
   * 从 v1（根级平铺结构）迁移到 v2（多用户 users/{login}/ 结构）
   * 
   * 将根级的 manifest.json、projects.json、templates.json、runs/、context-db/
   * 复制到 users/{login}/ 下，然后删除根级文件（保留 README.md）。
   */
  async migrateFromV1(): Promise<{ success: boolean; filesMigrated: number }> {
    if (!this.config) throw new Error('Sync not configured')
    const token = this.authService.getAccessToken()
    if (!token) throw new Error('Not authenticated with GitHub')

    const repo = this.config.repoFullName
    let filesMigrated = 0

    // 检查是否存在根级 manifest（v1 标志）
    const legacyManifest = await this.getFile(token, repo, 'manifest.json')
    if (!legacyManifest) {
      return { success: true, filesMigrated: 0 }
    }

    // 迁移 projects.json
    const projectsRaw = await this.getFile(token, repo, 'projects.json')
    if (projectsRaw) {
      await this.putFile(token, repo, this.userPath('projects.json'), projectsRaw)
      await this.deleteFile(token, repo, 'projects.json')
      filesMigrated++
    }

    // 迁移 templates.json
    const templatesRaw = await this.getFile(token, repo, 'templates.json')
    if (templatesRaw) {
      await this.putFile(token, repo, this.userPath('templates.json'), templatesRaw)
      await this.deleteFile(token, repo, 'templates.json')
      filesMigrated++
    }

    // 迁移 runs/
    const runFiles = await this.listDir(token, repo, 'runs')
    for (const file of runFiles) {
      if (file.name.endsWith('.json')) {
        const content = await this.getFile(token, repo, `runs/${file.name}`)
        if (content) {
          await this.putFile(token, repo, this.userPath(`runs/${file.name}`), content)
          await this.deleteFile(token, repo, `runs/${file.name}`)
          filesMigrated++
        }
      }
    }

    // 迁移 context-db/
    const contextDirs = await this.listDir(token, repo, 'context-db')
    for (const dir of contextDirs) {
      const files = await this.listDir(token, repo, `context-db/${dir.name}`)
      for (const file of files) {
        const content = await this.getFile(token, repo, `context-db/${dir.name}/${file.name}`)
        if (content) {
          await this.putFile(token, repo, this.userPath(`context-db/${dir.name}/${file.name}`), content)
          await this.deleteFile(token, repo, `context-db/${dir.name}/${file.name}`)
          filesMigrated++
        }
      }
    }

    // 迁移 manifest → 创建 v2 用户级 manifest 并删除根级 manifest
    const manifest = JSON.parse(legacyManifest)
    manifest.version = 2
    manifest.userLogin = this.authService.getCurrentUser()?.login
    manifest.migratedAt = Date.now()
    await this.putFile(token, repo, this.userPath('manifest.json'), JSON.stringify(manifest, null, 2))
    await this.deleteFile(token, repo, 'manifest.json')
    filesMigrated++

    console.log(`[Sync] Migration from v1 to v2 completed: ${filesMigrated} files migrated`)
    return { success: true, filesMigrated }
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
