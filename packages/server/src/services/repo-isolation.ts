import { randomUUID } from 'crypto'
import { execSync } from 'child_process'
import { mkdir, rm, symlink, stat } from 'fs/promises'
import { join } from 'path'
import type {
  RepoPool, RepoEntry, AgentWorkspace, RepoMount, RepoPermission,
} from '../types/index.js'

/**
 * RepoIsolationService — 仓库隔离服务
 * 
 * 核心职责：
 * 1. Run 级仓库池管理：一个 Run 可关联多个仓库，统一 clone/缓存
 * 2. Agent 工作空间隔离：每个 Agent Turn 获得独立的工作目录
 *    通过 git worktree（推荐）或 symlink/copy 实现
 * 3. 生命周期管理：自动创建/清理工作空间
 * 
 * 设计原则：
 * - 共享基础仓库（节省磁盘），隔离工作副本（防止冲突）
 * - worktree 模式下多个 Agent 可并行在不同分支工作
 * - 工作空间生命周期与 Turn 绑定，Turn 完成后可自动清理
 */
export class RepoIsolationService {
  private pools: Map<string, RepoPool> = new Map()     // runId → pool
  private workspaces: Map<string, AgentWorkspace> = new Map() // turnId → workspace
  private basePath: string

  constructor() {
    const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
    this.basePath = join(home, '.agent-flow', 'workspaces')
  }

  // ═══════════════ 仓库池管理 ═══════════════

  /**
   * 为 Run 创建仓库池
   */
  async createPool(runId: string): Promise<RepoPool> {
    const pool: RepoPool = { runId, repos: [] }
    this.pools.set(runId, pool)
    return pool
  }

  /**
   * 向仓库池添加仓库
   * 如果是远程 URL，会 clone 到本地缓存；如果是本地路径，直接引用
   */
  async addRepo(runId: string, params: {
    name: string
    url: string
    branch?: string
  }): Promise<RepoEntry> {
    let pool = this.pools.get(runId)
    if (!pool) {
      pool = await this.createPool(runId)
    }

    const repoId = `repo_${randomUUID().slice(0, 8)}`
    const localPath = join(this.basePath, 'repos', runId, repoId)

    // 检查是否为本地路径
    const isLocal = await this.isLocalPath(params.url)

    if (isLocal) {
      // 本地仓库直接引用
      const entry: RepoEntry = {
        id: repoId,
        name: params.name,
        url: params.url,
        localPath: params.url,
        branch: params.branch,
        clonedAt: Date.now(),
      }
      pool.repos.push(entry)
      return entry
    }

    // 远程仓库 clone
    await mkdir(localPath, { recursive: true })
    try {
      const branchArg = params.branch ? `--branch ${params.branch}` : ''
      execSync(
        `git clone ${branchArg} --single-branch "${params.url}" "${localPath}"`,
        { encoding: 'utf-8', stdio: 'pipe', timeout: 120_000 }
      )
    } catch (e) {
      throw new Error(`Failed to clone repo "${params.name}": ${(e as Error).message}`)
    }

    const entry: RepoEntry = {
      id: repoId,
      name: params.name,
      url: params.url,
      localPath,
      branch: params.branch,
      clonedAt: Date.now(),
    }
    pool.repos.push(entry)
    return entry
  }

  /**
   * 获取仓库池
   */
  getPool(runId: string): RepoPool | undefined {
    return this.pools.get(runId)
  }

  /**
   * 获取池中的特定仓库
   */
  getRepo(runId: string, repoId: string): RepoEntry | undefined {
    const pool = this.pools.get(runId)
    return pool?.repos.find(r => r.id === repoId)
  }

  // ═══════════════ Agent 工作空间 ═══════════════

  /**
   * 为 Agent Turn 创建隔离工作空间
   * 
   * 策略：
   * - 基于 git worktree 创建独立工作目录（推荐，最节省磁盘）
   * - 回退到 symlink 模式（本地仓库/只读场景）
   * - 最后回退到 copy 模式（万能但最耗磁盘）
   */
  async createWorkspace(params: {
    turnId: string
    agentId: string
    nodeId: string
    runId: string
    repoMounts: Array<{
      repoId: string
      mode?: 'worktree' | 'symlink' | 'copy'
      branch?: string
      permissions?: RepoPermission
    }>
  }): Promise<AgentWorkspace> {
    const { turnId, agentId, nodeId, runId, repoMounts } = params
    const workspacePath = join(this.basePath, 'active', runId, turnId)
    await mkdir(workspacePath, { recursive: true })

    const mounts: RepoMount[] = []

    for (const mount of repoMounts) {
      const repo = this.getRepo(runId, mount.repoId)
      if (!repo) {
        throw new Error(`Repo not found in pool: ${mount.repoId}`)
      }

      const mode = mount.mode || this.inferMountMode(repo, mount.permissions)
      const mountPath = join(workspacePath, repo.name)
      const permissions = mount.permissions || 'read-write'

      await this.mountRepo(repo, mountPath, mode, mount.branch)

      mounts.push({
        repoId: mount.repoId,
        mountPath,
        mode,
        branch: mount.branch,
        permissions,
      })
    }

    const workspace: AgentWorkspace = {
      turnId,
      agentId,
      nodeId,
      runId,
      basePath: workspacePath,
      repoMounts: mounts,
      createdAt: Date.now(),
    }

    this.workspaces.set(turnId, workspace)
    return workspace
  }

  /**
   * 获取 Agent 工作空间
   */
  getWorkspace(turnId: string): AgentWorkspace | undefined {
    return this.workspaces.get(turnId)
  }

  /**
   * 获取 Agent Turn 的主工作目录（第一个 mount 或 basePath）
   */
  getWorkingDirectory(turnId: string): string | undefined {
    const ws = this.workspaces.get(turnId)
    if (!ws) return undefined
    if (ws.repoMounts.length > 0) return ws.repoMounts[0].mountPath
    return ws.basePath
  }

  /**
   * 清理工作空间（Turn 完成后调用）
   */
  async cleanupWorkspace(turnId: string): Promise<void> {
    const workspace = this.workspaces.get(turnId)
    if (!workspace) return

    // 清理 worktree 引用
    for (const mount of workspace.repoMounts) {
      if (mount.mode === 'worktree') {
        const repo = this.getRepo(workspace.runId, mount.repoId)
        if (repo) {
          try {
            execSync(`git worktree remove "${mount.mountPath}" --force`, {
              cwd: repo.localPath,
              encoding: 'utf-8',
              stdio: 'pipe',
            })
          } catch {
            // worktree 删除失败不阻塞
          }
        }
      }
    }

    // 删除工作目录
    try {
      await rm(workspace.basePath, { recursive: true, force: true })
    } catch {
      // 清理失败不阻塞
    }

    workspace.cleanedAt = Date.now()
    this.workspaces.delete(turnId)
  }

  /**
   * 清理 Run 的所有工作空间和仓库池
   */
  async cleanupRun(runId: string): Promise<void> {
    // 清理所有活跃工作空间
    for (const [turnId, ws] of this.workspaces) {
      if (ws.runId === runId) {
        await this.cleanupWorkspace(turnId)
      }
    }

    // 清理 clone 的仓库
    const pool = this.pools.get(runId)
    if (pool) {
      const poolPath = join(this.basePath, 'repos', runId)
      try {
        await rm(poolPath, { recursive: true, force: true })
      } catch { /* ignore */ }
      this.pools.delete(runId)
    }
  }

  /**
   * 列出所有活跃工作空间
   */
  getActiveWorkspaces(): AgentWorkspace[] {
    return Array.from(this.workspaces.values())
  }

  // ═══════════════ Merge Conflict 检测 ═══════════════

  /** 冲突类型 */
  static readonly CONFLICT_TYPES = {
    CONTENT: 'content',          // 同一文件同一位置双方都修改
    ADD_ADD: 'add/add',          // 双方都新增了同名文件
    MODIFY_DELETE: 'modify/delete', // 一方修改、另一方删除
    RENAME: 'rename',            // 重命名冲突
    UNKNOWN: 'unknown',
  } as const

  /**
   * 检查节点关联的工作空间是否存在合并冲突风险（升级版）
   *
   * 原理：使用 git merge-tree（dry-run）检测当前分支与目标分支是否有冲突
   * 如果没有工作空间/不是 git 仓库/不是 worktree，返回 { hasConflict: false }
   *
   * 升级内容：
   * 1. 冲突类型分析：区分 content/add-add/modify-delete/rename 冲突
   * 2. 冲突严重度评估：基于文件路径、冲突类型和冲突数量
   * 3. 详细信息返回：每个冲突文件的类型和路径
   *
   * @param runId - 所属 Run
   * @param nodeId - 节点 ID（用于查找关联的 workspace）
   */
  checkMergeConflict(runId: string, nodeId: string): MergeConflictResult {
    // 找到该节点关联的工作空间
    const workspace = this.findWorkspaceByNode(runId, nodeId)
    if (!workspace) return { hasConflict: false, conflictFiles: [], conflicts: [], severity: 'none', severityScore: 1.0 }

    const conflictFiles: string[] = []
    const conflicts: ConflictDetail[] = []
    let hasConflict = false
    let targetBranch: string | undefined

    for (const mount of workspace.repoMounts) {
      if (mount.mode !== 'worktree') continue

      try {
        // 获取当前分支
        const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
          cwd: mount.mountPath,
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: 10_000,
        }).trim()

        // 确定目标分支（main / master / develop）
        const target = this.detectTargetBranch(mount.mountPath)
        if (!target || target === currentBranch) continue
        targetBranch = target

        // 使用 merge-tree 进行 dry-run 合并检测
        try {
          execSync(`git merge-tree --write-tree ${target} ${currentBranch}`, {
            cwd: mount.mountPath,
            encoding: 'utf-8',
            stdio: 'pipe',
            timeout: 10_000,
          })
          // 成功 = 无冲突
        } catch (mergeErr) {
          const output = (mergeErr as { stdout?: string }).stdout || ''
          if (output.includes('CONFLICT') || (mergeErr as { status?: number }).status === 1) {
            hasConflict = true
            // 解析冲突详情
            const lines = output.split('\n')
            for (const line of lines) {
              const detail = this.parseConflictLine(line)
              if (detail) {
                conflicts.push(detail)
                conflictFiles.push(detail.filePath)
              }
            }
          }
        }
      } catch {
        continue
      }
    }

    // 计算冲突严重度
    const { severity, severityScore } = this.assessConflictSeverity(conflicts)

    return { hasConflict, conflictFiles, conflicts, targetBranch, severity, severityScore }
  }

  /**
   * 解析单行冲突输出，提取冲突类型和文件路径
   */
  private parseConflictLine(line: string): ConflictDetail | null {
    // CONFLICT (content): Merge conflict in src/foo.ts
    const contentMatch = line.match(/CONFLICT \(content\):\s+Merge conflict in\s+(.+)/)
    if (contentMatch) {
      return { type: 'content', filePath: contentMatch[1].trim() }
    }

    // CONFLICT (add/add): Merge conflict in path/to/file
    const addAddMatch = line.match(/CONFLICT \(add\/add\):\s+Merge conflict in\s+(.+)/)
    if (addAddMatch) {
      return { type: 'add/add', filePath: addAddMatch[1].trim() }
    }

    // CONFLICT (modify/delete): path/to/file deleted in ... and modified in ...
    const modDelMatch = line.match(/CONFLICT \(modify\/delete\):\s+(.+?)\s+deleted/)
    if (modDelMatch) {
      return { type: 'modify/delete', filePath: modDelMatch[1].trim() }
    }

    // CONFLICT (rename/...): ...
    const renameMatch = line.match(/CONFLICT \(rename[^)]*\):\s+(.+)/)
    if (renameMatch) {
      return { type: 'rename', filePath: renameMatch[1].trim() }
    }

    // 通用 fallback
    const genericMatch = line.match(/CONFLICT \([^)]+\):\s+(.+)/)
    if (genericMatch) {
      return { type: 'unknown', filePath: genericMatch[1].trim() }
    }

    return null
  }

  /**
   * 评估冲突整体严重度
   * 
   * 评分策略：
   * - 核心代码文件冲突（src/, lib/, packages/）→ 高严重度
   * - 配置文件冲突（package.json, tsconfig, etc）→ 中等严重度
   * - 文档/测试文件冲突 → 低严重度
   * - modify/delete 冲突比 content 冲突更严重（暗示架构分歧）
   * - 冲突数量多会加重严重度
   * 
   * @returns severity 级别 + severityScore (0.0-1.0, 1.0=无风险, 0.0=极严重)
   */
  private assessConflictSeverity(conflicts: ConflictDetail[]): {
    severity: ConflictSeverity
    severityScore: number
  } {
    if (conflicts.length === 0) return { severity: 'none', severityScore: 1.0 }

    let totalWeight = 0

    for (const conflict of conflicts) {
      let fileWeight = 1.0
      const path = conflict.filePath.toLowerCase()

      // 文件路径权重
      if (path.match(/\.(ts|tsx|js|jsx|java|go|py|rs)$/)) {
        // 源代码
        if (path.includes('src/') || path.includes('lib/') || path.includes('packages/')) {
          fileWeight = 3.0  // 核心代码
        } else {
          fileWeight = 2.0
        }
      } else if (path.match(/package\.json|tsconfig|pom\.xml|go\.mod|cargo\.toml/)) {
        fileWeight = 2.5  // 关键配置
      } else if (path.match(/\.(md|txt|doc)$/) || path.includes('test') || path.includes('spec')) {
        fileWeight = 0.5  // 文档/测试
      } else if (path.match(/\.(lock|sum)$/)) {
        fileWeight = 1.5  // 锁文件（通常自动解决但需注意）
      }

      // 冲突类型权重
      const typeWeight: Record<string, number> = {
        'content': 1.0,
        'add/add': 1.2,
        'modify/delete': 2.0,  // 架构性分歧
        'rename': 1.5,
        'unknown': 1.0,
      }

      totalWeight += fileWeight * (typeWeight[conflict.type] || 1.0)
    }

    // 数量加成（冲突越多越严重）
    const quantityMultiplier = 1 + Math.log2(Math.max(1, conflicts.length)) * 0.3

    const rawSeverityScore = totalWeight * quantityMultiplier

    // 映射到 0-1 分数（severityScore 越高 = 风险越大 → 最终返回 1-风险）
    // 严重度阈值：
    // rawScore < 2 → 低 → severityScore 0.8
    // rawScore < 5 → 中 → severityScore 0.5
    // rawScore < 10 → 高 → severityScore 0.2
    // rawScore >= 10 → 极严重 → severityScore 0.0
    let severity: ConflictSeverity
    let severityScore: number

    if (rawSeverityScore < 2) {
      severity = 'low'
      severityScore = 0.8
    } else if (rawSeverityScore < 5) {
      severity = 'medium'
      severityScore = 0.5
    } else if (rawSeverityScore < 10) {
      severity = 'high'
      severityScore = 0.2
    } else {
      severity = 'critical'
      severityScore = 0.0
    }

    return { severity, severityScore }
  }

  /**
   * 通过 nodeId 查找该节点最后一个 Turn 的工作空间
   */
  private findWorkspaceByNode(runId: string, nodeId: string): AgentWorkspace | undefined {
    for (const ws of this.workspaces.values()) {
      if (ws.runId === runId && ws.nodeId === nodeId) return ws
    }
    return undefined
  }

  /**
   * 探测仓库的目标分支（main / master / develop）
   */
  private detectTargetBranch(cwd: string): string | undefined {
    try {
      const refs = execSync('git branch -r', { cwd, encoding: 'utf-8', stdio: 'pipe', timeout: 5_000 })
      if (refs.includes('origin/main')) return 'origin/main'
      if (refs.includes('origin/master')) return 'origin/master'
      if (refs.includes('origin/develop')) return 'origin/develop'
      return undefined
    } catch {
      return undefined
    }
  }

  // ═══════════════ 内部方法 ═══════════════

  /**
   * 根据仓库类型和权限推断最佳挂载模式
   */
  private inferMountMode(
    repo: RepoEntry,
    permissions?: RepoPermission
  ): 'worktree' | 'symlink' | 'copy' {
    // 只读场景用 symlink（零开销）
    if (permissions === 'read') return 'symlink'

    // 如果是 git 仓库，优先使用 worktree
    try {
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: repo.localPath,
        encoding: 'utf-8',
        stdio: 'pipe',
      })
      return 'worktree'
    } catch {
      // 非 git 仓库，回退 symlink
      return 'symlink'
    }
  }

  /**
   * 执行仓库挂载
   */
  private async mountRepo(
    repo: RepoEntry,
    mountPath: string,
    mode: 'worktree' | 'symlink' | 'copy',
    branch?: string
  ): Promise<void> {
    switch (mode) {
      case 'worktree': {
        const branchName = branch || `agent-work-${randomUUID().slice(0, 6)}`
        try {
          // 先创建分支（如果不存在）
          try {
            execSync(`git branch "${branchName}" HEAD 2>/dev/null || true`, {
              cwd: repo.localPath, encoding: 'utf-8', stdio: 'pipe',
            })
          } catch { /* branch may already exist */ }

          execSync(`git worktree add "${mountPath}" "${branchName}"`, {
            cwd: repo.localPath, encoding: 'utf-8', stdio: 'pipe',
          })
        } catch (e) {
          // worktree 失败回退到 symlink
          console.warn(`[RepoIsolation] worktree failed, fallback to symlink: ${(e as Error).message}`)
          await symlink(repo.localPath, mountPath)
        }
        break
      }
      case 'symlink': {
        await symlink(repo.localPath, mountPath)
        break
      }
      case 'copy': {
        execSync(`cp -r "${repo.localPath}" "${mountPath}"`, {
          encoding: 'utf-8', stdio: 'pipe',
        })
        break
      }
    }
  }

  /**
   * 检查路径是否为本地路径（非 URL）
   */
  private async isLocalPath(url: string): Promise<boolean> {
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('git@')) {
      return false
    }
    try {
      const s = await stat(url)
      return s.isDirectory()
    } catch {
      return false
    }
  }
}

// ═══════════════ 类型定义 ═══════════════

/** 冲突详情 */
export interface ConflictDetail {
  /** 冲突类型 */
  type: 'content' | 'add/add' | 'modify/delete' | 'rename' | 'unknown'
  /** 冲突文件路径 */
  filePath: string
}

/** 冲突严重度级别 */
export type ConflictSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical'

/** Merge Conflict 检测结果 */
export interface MergeConflictResult {
  hasConflict: boolean
  conflictFiles: string[]
  conflicts: ConflictDetail[]
  targetBranch?: string
  severity: ConflictSeverity
  /** 综合分数：1.0=无风险, 0.0=极严重 */
  severityScore: number
}
