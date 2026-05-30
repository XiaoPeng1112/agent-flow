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
