import { execSync } from 'child_process'
import type { RepoIsolationService } from './repo-isolation.js'
import type { GitService } from './git.js'

// ═══════════════════════════════════════════════════
// ArtifactMergeService — 产出物闭环
//
// 职责：
// 1. 为处于 wait_user_review 状态的节点生成 Diff Review 数据
// 2. 用户 Approve 后将 Agent 工作分支合入主分支
// 3. 用户 Reject/Skip 后丢弃分支变更
//
// 数据流：
//   Agent 在 worktree 分支工作 → 提交 commit
//   → prepareDiffReview() 获取 diff 供前端展示
//   → 用户 Approve → mergeBranch() 合入主分支
//   → 用户 Reject → discardBranch() 丢弃分支
// ═══════════════════════════════════════════════════

export interface DiffFile {
  path: string
  additions: number
  deletions: number
  status: 'added' | 'modified' | 'deleted' | 'renamed'
}

export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

export interface DiffLine {
  type: 'add' | 'delete' | 'context'
  content: string
  oldLineNo?: number
  newLineNo?: number
}

export interface FileDiff {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  hunks: DiffHunk[]
  additions: number
  deletions: number
}

export interface DiffReview {
  turnId: string
  nodeId: string
  runId: string
  baseBranch: string
  workBranch: string
  baseCommit: string
  headCommit: string
  files: DiffFile[]
  fileDiffs: FileDiff[]
  summary: {
    filesChanged: number
    totalAdditions: number
    totalDeletions: number
  }
  createdAt: number
}

export type MergeStrategy = 'merge' | 'squash' | 'rebase'

export interface MergeResult {
  success: boolean
  mergeCommit?: string
  strategy: MergeStrategy
  filesAffected: number
  error?: string
}

export class ArtifactMergeService {
  private reviews: Map<string, DiffReview> = new Map()  // turnId → review

  constructor(
    private repoIsolation: RepoIsolationService,
    private gitService: GitService
  ) {}

  /**
   * 为 Agent Turn 的产出物生成 Diff Review
   * 在节点进入 wait_user_review 时调用
   */
  prepareDiffReview(params: {
    turnId: string
    nodeId: string
    runId: string
  }): DiffReview | null {
    const workspace = this.repoIsolation.getWorkspace(params.turnId)
    if (!workspace) return null

    // 找到第一个 worktree 模式的 mount（代码产出物的主要来源）
    const worktreeMount = workspace.repoMounts.find(m => m.mode === 'worktree')
    if (!worktreeMount) return null

    const cwd = worktreeMount.mountPath

    // 检查是否有未提交的变更，如果有则自动 commit
    const status = this.gitService.getStatus(cwd)
    if (!status.isClean) {
      try {
        execSync('git add -A', { cwd, encoding: 'utf-8', stdio: 'pipe' })
        execSync('git commit -m "Agent work output" --allow-empty', {
          cwd, encoding: 'utf-8', stdio: 'pipe',
        })
      } catch {
        // commit 失败不阻塞（可能没有实际变更）
      }
    }

    // 获取基准分支和工作分支
    const workBranch = this.gitService.getCurrentBranch(cwd)
    const baseBranch = this.detectBaseBranch(cwd)
    const baseCommit = this.getBaseCommit(cwd, baseBranch, workBranch)
    const headCommit = this.getHeadCommit(cwd)

    // 生成 diff
    const rawDiff = this.gitService.getDiffBetween(cwd, baseCommit, headCommit)
    const diffSummary = this.gitService.generateDiffSummary(rawDiff)
    const changedFiles = this.gitService.getChangedFiles(cwd, baseCommit, headCommit)

    // 解析文件状态
    const files: DiffFile[] = changedFiles.map(f => ({
      path: f.file,
      additions: f.additions,
      deletions: f.deletions,
      status: this.inferFileStatus(f),
    }))

    // 解析逐文件 Diff（含 hunk）
    const fileDiffs = this.parseDiff(rawDiff)

    const review: DiffReview = {
      turnId: params.turnId,
      nodeId: params.nodeId,
      runId: params.runId,
      baseBranch,
      workBranch,
      baseCommit,
      headCommit,
      files,
      fileDiffs,
      summary: {
        filesChanged: diffSummary.filesChanged,
        totalAdditions: diffSummary.totalAdditions,
        totalDeletions: diffSummary.totalDeletions,
      },
      createdAt: Date.now(),
    }

    this.reviews.set(params.turnId, review)
    return review
  }

  /**
   * 获取已有的 Diff Review
   */
  getReview(turnId: string): DiffReview | undefined {
    return this.reviews.get(turnId)
  }

  /**
   * 获取节点关联的所有 Diff Reviews
   */
  getNodeReviews(nodeId: string): DiffReview[] {
    return Array.from(this.reviews.values()).filter(r => r.nodeId === nodeId)
  }

  /**
   * 用户 Approve 后合入工作分支到主分支
   */
  mergeBranch(turnId: string, strategy: MergeStrategy = 'squash'): MergeResult {
    const review = this.reviews.get(turnId)
    if (!review) {
      return { success: false, strategy, filesAffected: 0, error: 'No review found for this turn' }
    }

    const workspace = this.repoIsolation.getWorkspace(turnId)
    if (!workspace) {
      return { success: false, strategy, filesAffected: 0, error: 'Workspace not found' }
    }

    const worktreeMount = workspace.repoMounts.find(m => m.mode === 'worktree')
    if (!worktreeMount) {
      return { success: false, strategy, filesAffected: 0, error: 'No worktree mount found' }
    }

    // 找到主仓库路径（通过 repoIsolation 获取原始 repo）
    const repo = this.repoIsolation.getRepo(workspace.runId, worktreeMount.repoId)
    if (!repo) {
      return { success: false, strategy, filesAffected: 0, error: 'Repository not found in pool' }
    }

    const mainCwd = repo.localPath

    try {
      let mergeCommit: string

      switch (strategy) {
        case 'squash': {
          execSync(`git merge --squash "${review.workBranch}"`, {
            cwd: mainCwd, encoding: 'utf-8', stdio: 'pipe',
          })
          execSync(`git commit -m "Merge agent work: ${review.nodeId}" --allow-empty`, {
            cwd: mainCwd, encoding: 'utf-8', stdio: 'pipe',
          })
          mergeCommit = this.getHeadCommit(mainCwd)
          break
        }
        case 'rebase': {
          execSync(`git rebase "${review.workBranch}"`, {
            cwd: mainCwd, encoding: 'utf-8', stdio: 'pipe',
          })
          mergeCommit = this.getHeadCommit(mainCwd)
          break
        }
        case 'merge':
        default: {
          execSync(`git merge --no-ff "${review.workBranch}" -m "Merge agent work: ${review.nodeId}"`, {
            cwd: mainCwd, encoding: 'utf-8', stdio: 'pipe',
          })
          mergeCommit = this.getHeadCommit(mainCwd)
          break
        }
      }

      return {
        success: true,
        mergeCommit,
        strategy,
        filesAffected: review.summary.filesChanged,
      }
    } catch (e) {
      return {
        success: false,
        strategy,
        filesAffected: 0,
        error: `Merge failed: ${(e as Error).message}`,
      }
    }
  }

  /**
   * 丢弃工作分支（Reject/Skip 时调用）
   */
  discardBranch(turnId: string): { success: boolean; error?: string } {
    const review = this.reviews.get(turnId)
    if (!review) {
      return { success: false, error: 'No review found for this turn' }
    }

    const workspace = this.repoIsolation.getWorkspace(turnId)
    if (!workspace) {
      // workspace 可能已经清理过了
      this.reviews.delete(turnId)
      return { success: true }
    }

    const worktreeMount = workspace.repoMounts.find(m => m.mode === 'worktree')
    if (!worktreeMount) {
      this.reviews.delete(turnId)
      return { success: true }
    }

    const repo = this.repoIsolation.getRepo(workspace.runId, worktreeMount.repoId)
    if (repo) {
      try {
        // 删除 worktree
        execSync(`git worktree remove "${worktreeMount.mountPath}" --force`, {
          cwd: repo.localPath, encoding: 'utf-8', stdio: 'pipe',
        })
        // 删除分支
        execSync(`git branch -D "${review.workBranch}" 2>/dev/null || true`, {
          cwd: repo.localPath, encoding: 'utf-8', stdio: 'pipe',
        })
      } catch {
        // 清理失败不阻塞
      }
    }

    this.reviews.delete(turnId)
    return { success: true }
  }

  /**
   * 获取指定文件的完整 diff 内容（用于前端逐文件查看）
   */
  getFileDiff(turnId: string, filePath: string): FileDiff | null {
    const review = this.reviews.get(turnId)
    if (!review) return null
    return review.fileDiffs.find(f => f.path === filePath) || null
  }

  // ═══════════════ 内部方法 ═══════════════

  private detectBaseBranch(cwd: string): string {
    try {
      // 尝试常见的主分支名
      const candidates = ['main', 'master', 'develop']
      for (const name of candidates) {
        try {
          execSync(`git rev-parse --verify "${name}"`, { cwd, encoding: 'utf-8', stdio: 'pipe' })
          return name
        } catch { /* 继续尝试 */ }
      }
    } catch { /* fallback */ }
    return 'main'
  }

  private getBaseCommit(cwd: string, baseBranch: string, workBranch: string): string {
    try {
      return execSync(`git merge-base "${baseBranch}" "${workBranch}"`, {
        cwd, encoding: 'utf-8', stdio: 'pipe',
      }).trim()
    } catch {
      // 找不到共同祖先，用 baseBranch HEAD
      try {
        return execSync(`git rev-parse "${baseBranch}"`, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim()
      } catch {
        return 'HEAD~1'
      }
    }
  }

  private getHeadCommit(cwd: string): string {
    try {
      return execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim()
    } catch {
      return 'HEAD'
    }
  }

  private inferFileStatus(f: { file: string; additions: number; deletions: number }): DiffFile['status'] {
    if (f.deletions === 0 && f.additions > 0) return 'added'
    if (f.additions === 0 && f.deletions > 0) return 'deleted'
    return 'modified'
  }

  /**
   * 解析 unified diff 格式为结构化数据
   */
  private parseDiff(rawDiff: string): FileDiff[] {
    if (!rawDiff.trim()) return []

    const fileDiffs: FileDiff[] = []
    const fileSections = rawDiff.split(/^diff --git /m).filter(Boolean)

    for (const section of fileSections) {
      const lines = section.split('\n')
      
      // 提取文件路径
      const headerMatch = lines[0]?.match(/a\/(.+?) b\/(.+)/)
      if (!headerMatch) continue

      const filePath = headerMatch[2]
      let status: FileDiff['status'] = 'modified'
      
      // 检测文件状态
      if (lines.some(l => l.startsWith('new file'))) status = 'added'
      else if (lines.some(l => l.startsWith('deleted file'))) status = 'deleted'
      else if (lines.some(l => l.startsWith('rename from'))) status = 'renamed'

      // 解析 hunks
      const hunks: DiffHunk[] = []
      let currentHunk: DiffHunk | null = null
      let oldLine = 0
      let newLine = 0
      let additions = 0
      let deletions = 0

      for (const line of lines) {
        const hunkHeader = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/)
        if (hunkHeader) {
          if (currentHunk) hunks.push(currentHunk)
          oldLine = parseInt(hunkHeader[1], 10)
          newLine = parseInt(hunkHeader[2], 10)
          currentHunk = { header: line, lines: [] }
          continue
        }

        if (!currentHunk) continue

        if (line.startsWith('+')) {
          currentHunk.lines.push({ type: 'add', content: line.slice(1), newLineNo: newLine })
          newLine++
          additions++
        } else if (line.startsWith('-')) {
          currentHunk.lines.push({ type: 'delete', content: line.slice(1), oldLineNo: oldLine })
          oldLine++
          deletions++
        } else if (line.startsWith(' ')) {
          currentHunk.lines.push({ type: 'context', content: line.slice(1), oldLineNo: oldLine, newLineNo: newLine })
          oldLine++
          newLine++
        }
      }

      if (currentHunk) hunks.push(currentHunk)

      fileDiffs.push({ path: filePath, status, hunks, additions, deletions })
    }

    return fileDiffs
  }
}
