import { execSync, execFileSync } from 'child_process'
import type { RepoIsolationService } from './repo-isolation.js'
import type { GitService } from './git.js'
import type { AuthService } from './auth.js'

// ═══════════════════════════════════════════════════
// ArtifactMergeService — 产出物闭环
//
// 职责：
// 1. 为处于 wait_user_review 状态的节点生成 Diff Review 数据
// 2. 用户 Approve 后将 Agent 工作分支合入主分支（local 模式）
//    或 push 工作分支到远端并创建 GitHub PR（pr 模式）
// 3. 用户 Reject/Skip 后丢弃分支变更
//
// 数据流：
//   Agent 在 worktree 分支工作 → 提交 commit
//   → prepareDiffReview() 获取 diff 供前端展示
//   → local 模式: 用户 Approve → mergeBranch() 合入主分支
//   → pr 模式:    用户 Approve → pushAndCreatePR() 推送分支 + 创建 GitHub PR
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

export interface RepoTypeDetection {
  repoType: 'team' | 'personal'
  ownerType: 'Organization' | 'User'
  collaboratorCount: number
  recentAuthors: string[]
  hasBranchProtection: boolean
  confidence: number       // 0-1 置信度
  suggestedMergeMode: 'local' | 'pr'
  reason: string
}

export interface PRResult {
  success: boolean
  prUrl?: string
  prNumber?: number
  headBranch?: string
  baseBranch?: string
  error?: string
}

export class ArtifactMergeService {
  private reviews: Map<string, DiffReview> = new Map()  // turnId → review
  private authService: AuthService | null = null

  constructor(
    private repoIsolation: RepoIsolationService,
    private gitService: GitService
  ) {}

  private deliveryVerifier?: (turnId: string, runId: string, nodeId: string) => boolean

  setDeliveryVerifier(verifier: (turnId: string, runId: string, nodeId: string) => boolean): void {
    this.deliveryVerifier = verifier
  }

  private assertDelivery(review: DiffReview): void {
    this.repoIsolation.executions.assertSnapshot(review.turnId, review.headCommit)
    if (!this.deliveryVerifier?.(review.turnId, review.runId, review.nodeId)) {
      throw new Error('Delivery requires approval and passing verification of the current turn')
    }
  }

  /** 注入 AuthService（延迟注入避免循环依赖） */
  injectAuth(authService: AuthService): void {
    this.authService = authService
  }

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

    const snapshot = this.repoIsolation.executions.assertSnapshot(params.turnId)
    if (snapshot.runId !== params.runId || snapshot.nodeId !== params.nodeId) throw new Error('Workspace ownership mismatch')
    const workBranch = snapshot.repoMounts[0].branch!
    const { baseBranch, baseCommit, headCommit } = snapshot.execution

    // 生成 diff
    const rawDiff = this.gitService.getDiffBetween(cwd, baseCommit, headCommit!)
    const diffSummary = this.gitService.generateDiffSummary(rawDiff)
    const changedFiles = this.gitService.getChangedFiles(cwd, baseCommit, headCommit!)

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
      headCommit: headCommit!,
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

    try {
      this.assertDelivery(review)
      const snapshot = this.repoIsolation.executions.assertSnapshot(turnId, review.headCommit)
      const mainCwd = snapshot.execution.repository
      const git = (args: string[]) => this.repoIsolation.executions.git(mainCwd, args)
      if (!['merge', 'squash'].includes(strategy)) throw new Error('Rebase delivery is unsupported; use merge or squash')
      if (git(['status', '--porcelain', '--untracked-files=normal'])) throw new Error('Project has uncommitted changes')
      if (git(['branch', '--show-current']) !== review.baseBranch || git(['rev-parse', 'HEAD']) !== review.baseCommit) {
        throw new Error('Target branch changed since the run baseline; integrate and verify in a new run')
      }
      if (strategy === 'squash') {
        git(['merge', '--squash', review.headCommit])
        git(['commit', '--allow-empty', '-m', `Merge agent work: ${review.nodeId}`])
      } else {
        git(['merge', '--no-ff', review.headCommit, '-m', `Merge agent work: ${review.nodeId}`])
      }
      const mergeCommit = this.getHeadCommit(mainCwd)

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

    // A rejected review must not delete the code needed by retries or downstream attempts.
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

  // ═══════════════ PR 模式（团队协作） ═══════════════

  /**
   * Push 工作分支到远端并创建 GitHub Pull Request
   * 
   * 流程：
   *   1. 确认当前 Turn 已审批且代码快照仍通过验证
   *   2. git push origin <workBranch>
   *   3. 通过 GitHub API 创建 Pull Request
   *   4. 返回 PR URL 供前端展示
   */
  async pushAndCreatePR(turnId: string, params?: {
    title?: string
    body?: string
    baseBranch?: string
  }): Promise<PRResult> {
    const review = this.reviews.get(turnId)
    if (!review) {
      return { success: false, error: 'No review found for this turn' }
    }

    try { this.assertDelivery(review) } catch (error) {
      return { success: false, error: (error as Error).message }
    }

    if (!this.authService) {
      return { success: false, error: 'AuthService not injected' }
    }

    const token = this.authService.getAccessToken()
    if (!token) {
      return { success: false, error: 'Not authenticated with GitHub. Please login first.' }
    }

    const workspace = this.repoIsolation.getWorkspace(turnId)
    if (!workspace) {
      return { success: false, error: 'Workspace not found' }
    }

    const worktreeMount = workspace.repoMounts.find(m => m.mode === 'worktree')
    if (!worktreeMount) {
      return { success: false, error: 'No worktree mount found' }
    }

    const cwd = worktreeMount.mountPath

    // 从 git remote 中提取 owner/repo
    const repoInfo = this.extractGitHubRepoInfo(cwd)
    if (!repoInfo) {
      return { success: false, error: 'Cannot detect GitHub repo info from git remote. Ensure the project has a GitHub remote configured.' }
    }

    const { owner, repo } = repoInfo
    const headBranch = review.workBranch
    const baseBranch = params?.baseBranch || review.baseBranch

    // Step 1: Push 工作分支到远端
    try {
      execFileSync('git', ['push', 'origin', `${review.headCommit}:refs/heads/${headBranch}`], {
        cwd, encoding: 'utf-8', stdio: 'pipe', timeout: 60_000,
      })
    } catch (error) {
      return { success: false, error: `Failed to push branch: ${(error as Error).message}` }
    }

    // Step 2: 通过 GitHub API 创建 PR
    const prTitle = params?.title || `[AgentFlow] ${review.nodeId}: Agent work output`
    const prBody = params?.body || this.generatePRBody(review)

    try {
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: prTitle,
          body: prBody,
          head: headBranch,
          base: baseBranch,
        }),
      })

      if (!response.ok) {
        const errData = await response.json() as any
        // 如果 PR 已经存在，返回已有 PR 的信息
        if (response.status === 422 && errData.errors?.some((e: any) => e.message?.includes('A pull request already exists'))) {
          // 查找已有的 PR
          const existingPR = await this.findExistingPR(owner, repo, headBranch, baseBranch, token)
          if (existingPR) {
            return {
              success: true,
              prUrl: existingPR.html_url,
              prNumber: existingPR.number,
              headBranch,
              baseBranch,
            }
          }
        }
        return { success: false, error: `GitHub API error: ${errData.message || response.statusText}` }
      }

      const prData = await response.json() as any
      return {
        success: true,
        prUrl: prData.html_url,
        prNumber: prData.number,
        headBranch,
        baseBranch,
      }
    } catch (e) {
      return { success: false, error: `Failed to create PR: ${(e as Error).message}` }
    }
  }

  /**
   * 查询 PR 状态（供前端轮询）
   */
  async getPRStatus(owner: string, repo: string, prNumber: number): Promise<{
    state: string
    merged: boolean
    mergeable: boolean | null
    reviewDecision?: string
    html_url: string
  } | null> {
    if (!this.authService) return null
    const token = this.authService.getAccessToken()
    if (!token) return null

    try {
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      })
      if (!response.ok) return null
      const data = await response.json() as any
      return {
        state: data.state,
        merged: data.merged,
        mergeable: data.mergeable,
        html_url: data.html_url,
      }
    } catch {
      return null
    }
  }

  // ═══════════════ 内部方法 ═══════════════

  /**
   * 从 git remote URL 中提取 GitHub owner/repo
   */
  private extractGitHubRepoInfo(cwd: string): { owner: string; repo: string } | null {
    try {
      const remoteUrl = execSync('git remote get-url origin', {
        cwd, encoding: 'utf-8', stdio: 'pipe',
      }).trim()

      // 匹配 SSH: git@github.com:owner/repo.git
      const sshMatch = remoteUrl.match(/git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/)
      if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] }

      // 匹配 HTTPS: https://github.com/owner/repo.git
      const httpsMatch = remoteUrl.match(/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/)
      if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] }

      return null
    } catch {
      return null
    }
  }

  /**
   * 查找已存在的 PR
   */
  private async findExistingPR(
    owner: string, repo: string, head: string, base: string, token: string
  ): Promise<{ html_url: string; number: number } | null> {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&head=${owner}:${head}&base=${base}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github.v3+json',
          },
        }
      )
      if (!response.ok) return null
      const prs = await response.json() as any[]
      if (prs.length > 0) return { html_url: prs[0].html_url, number: prs[0].number }
      return null
    } catch {
      return null
    }
  }

  /**
   * 生成 PR 描述正文
   */
  private generatePRBody(review: DiffReview): string {
    const lines = [
      `## AgentFlow Auto-generated PR`,
      '',
      `**Run ID:** \`${review.runId}\``,
      `**Node:** \`${review.nodeId}\``,
      `**Branch:** \`${review.workBranch}\` → \`${review.baseBranch}\``,
      '',
      `### Summary`,
      '',
      `- Files changed: ${review.summary.filesChanged}`,
      `- Additions: +${review.summary.totalAdditions}`,
      `- Deletions: -${review.summary.totalDeletions}`,
      '',
      `### Changed Files`,
      '',
      ...review.files.map(f => `- \`${f.path}\` (${f.status}, +${f.additions}/-${f.deletions})`),
      '',
      '---',
      '*This PR was automatically created by [AgentFlow](https://github.com/XiaoPeng1112/agent-flow).*',
    ]
    return lines.join('\n')
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

  // ═══════════════════════════════════════════════════
  // 仓库类型检测（团队项目 vs 个人项目）
  // ═══════════════════════════════════════════════════

  /**
   * 检测远程仓库是团队项目还是个人项目
   *
   * 判断策略（按权重）：
   * 1. owner.type === 'Organization' → 几乎必定是团队项目（权重 0.5）
   * 2. collaborators > 1             → 多人协作（权重 0.3）
   * 3. 近30条 commit 有多位作者     → 团队开发（权重 0.2）
   */
  async detectRepoType(cwd: string): Promise<RepoTypeDetection> {
    const token = this.authService?.getAccessToken()
    if (!token) {
      return {
        repoType: 'personal',
        ownerType: 'User',
        collaboratorCount: 1,
        recentAuthors: [],
        hasBranchProtection: false,
        confidence: 0.3,
        suggestedMergeMode: 'local',
        reason: '未登录 GitHub，无法检测仓库类型，默认为个人项目',
      }
    }

    const repoInfo = this.extractGitHubRepoInfo(cwd)
    if (!repoInfo) {
      return {
        repoType: 'personal',
        ownerType: 'User',
        collaboratorCount: 1,
        recentAuthors: [],
        hasBranchProtection: false,
        confidence: 0.3,
        suggestedMergeMode: 'local',
        reason: '无法从 git remote 中解析 GitHub 仓库信息',
      }
    }

    const { owner, repo } = repoInfo
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    }

    let score = 0
    let ownerType: 'Organization' | 'User' = 'User'
    let collaboratorCount = 1
    let recentAuthors: string[] = []
    let hasBranchProtection = false
    const reasons: string[] = []

    // 1. 检查仓库 owner 类型
    try {
      const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers })
      if (repoRes.ok) {
        const repoData = await repoRes.json() as any
        ownerType = repoData.owner?.type === 'Organization' ? 'Organization' : 'User'
        if (ownerType === 'Organization') {
          score += 0.5
          reasons.push(`仓库属于组织 ${owner}`)
        }
      }
    } catch { /* ignore */ }

    // 2. 检查 collaborators 数量
    try {
      const collabRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/collaborators?per_page=10`, { headers })
      if (collabRes.ok) {
        const collabs = await collabRes.json() as any[]
        collaboratorCount = collabs.length
        if (collaboratorCount > 1) {
          score += 0.3
          reasons.push(`有 ${collaboratorCount} 位协作者`)
        }
      }
    } catch { /* ignore */ }

    // 3. 检查近期 commit 作者多样性
    try {
      const commitsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=30`, { headers })
      if (commitsRes.ok) {
        const commits = await commitsRes.json() as any[]
        const authors = new Set<string>()
        for (const c of commits) {
          const login = c.author?.login || c.commit?.author?.name
          if (login) authors.add(login)
        }
        recentAuthors = [...authors]
        if (authors.size > 1) {
          score += 0.2
          reasons.push(`近期有 ${authors.size} 位不同作者提交`)
        }
      }
    } catch { /* ignore */ }

    // 4. 检查是否有 branch protection（辅助信号）
    try {
      const defaultBranch = 'main' // 可优化为从 repo API 获取
      const protRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/branches/${defaultBranch}/protection`,
        { headers }
      )
      if (protRes.ok) {
        hasBranchProtection = true
        score += 0.1
        reasons.push('主分支有保护规则')
      }
    } catch { /* ignore */ }

    const isTeam = score >= 0.4
    const confidence = Math.min(1, score + 0.3) // 基础置信度 0.3

    return {
      repoType: isTeam ? 'team' : 'personal',
      ownerType,
      collaboratorCount,
      recentAuthors,
      hasBranchProtection,
      confidence,
      suggestedMergeMode: isTeam ? 'pr' : 'local',
      reason: reasons.length > 0
        ? `判定为${isTeam ? '团队' : '个人'}项目：${reasons.join('；')}`
        : '无法获取足够信息，默认为个人项目',
    }
  }

  /**
   * 基于 repoUrl 字符串检测仓库类型（无需 cwd）
   */
  async detectRepoTypeByUrl(repoUrl: string): Promise<RepoTypeDetection> {
    const token = this.authService?.getAccessToken()
    if (!token) {
      return {
        repoType: 'personal', ownerType: 'User', collaboratorCount: 1,
        recentAuthors: [], hasBranchProtection: false, confidence: 0.3,
        suggestedMergeMode: 'local', reason: '未登录 GitHub',
      }
    }

    // 从 URL 中解析 owner/repo
    const sshMatch = repoUrl.match(/git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/)
    const httpsMatch = repoUrl.match(/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/)
    const match = sshMatch || httpsMatch
    if (!match) {
      return {
        repoType: 'personal', ownerType: 'User', collaboratorCount: 1,
        recentAuthors: [], hasBranchProtection: false, confidence: 0.3,
        suggestedMergeMode: 'local', reason: '无法解析仓库 URL',
      }
    }

    // 创建临时目录不现实，复用逻辑但直接用解析结果
    const owner = match[1]
    const repo = match[2]
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    }

    let score = 0
    let ownerType: 'Organization' | 'User' = 'User'
    let collaboratorCount = 1
    let recentAuthors: string[] = []
    let hasBranchProtection = false
    const reasons: string[] = []

    try {
      const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers })
      if (repoRes.ok) {
        const repoData = await repoRes.json() as any
        ownerType = repoData.owner?.type === 'Organization' ? 'Organization' : 'User'
        if (ownerType === 'Organization') { score += 0.5; reasons.push(`仓库属于组织 ${owner}`) }
      }
    } catch { /* ignore */ }

    try {
      const collabRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/collaborators?per_page=10`, { headers })
      if (collabRes.ok) {
        const collabs = await collabRes.json() as any[]
        collaboratorCount = collabs.length
        if (collaboratorCount > 1) { score += 0.3; reasons.push(`有 ${collaboratorCount} 位协作者`) }
      }
    } catch { /* ignore */ }

    try {
      const commitsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=30`, { headers })
      if (commitsRes.ok) {
        const commits = await commitsRes.json() as any[]
        const authors = new Set<string>()
        for (const c of commits) {
          const login = c.author?.login || c.commit?.author?.name
          if (login) authors.add(login)
        }
        recentAuthors = [...authors]
        if (authors.size > 1) { score += 0.2; reasons.push(`近期有 ${authors.size} 位不同作者提交`) }
      }
    } catch { /* ignore */ }

    try {
      const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers })
      if (repoRes.ok) {
        const repoData = await repoRes.json() as any
        const defaultBranch = repoData.default_branch || 'main'
        const protRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/branches/${defaultBranch}/protection`,
          { headers }
        )
        if (protRes.ok) { hasBranchProtection = true; score += 0.1; reasons.push('主分支有保护规则') }
      }
    } catch { /* ignore */ }

    const isTeam = score >= 0.4
    const confidence = Math.min(1, score + 0.3)

    return {
      repoType: isTeam ? 'team' : 'personal',
      ownerType, collaboratorCount, recentAuthors, hasBranchProtection, confidence,
      suggestedMergeMode: isTeam ? 'pr' : 'local',
      reason: reasons.length > 0
        ? `判定为${isTeam ? '团队' : '个人'}项目：${reasons.join('；')}`
        : '无法获取足够信息，默认为个人项目',
    }
  }
}
