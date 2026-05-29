import { execSync } from 'child_process'

/**
 * Git 集成服务
 * 提供 Git 仓库信息查询、Diff 获取、分支管理等能力
 * 用于 Agent 产出物的 Code Review 和版本追踪
 */
export class GitService {
  /**
   * 检查目录是否是 Git 仓库
   */
  isGitRepo(cwd: string): boolean {
    try {
      execSync('git rev-parse --is-inside-work-tree', { cwd, encoding: 'utf-8', stdio: 'pipe' })
      return true
    } catch {
      return false
    }
  }

  /**
   * 获取当前分支名
   */
  getCurrentBranch(cwd: string): string {
    try {
      return execSync('git branch --show-current', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim()
    } catch {
      return 'unknown'
    }
  }

  /**
   * 获取最近的 commit 列表
   */
  getRecentCommits(cwd: string, count = 10): Array<{ hash: string; message: string; author: string; date: string }> {
    try {
      const output = execSync(
        `git log --oneline --format="%H|%s|%an|%ai" -${count}`,
        { cwd, encoding: 'utf-8', stdio: 'pipe' }
      ).trim()
      
      if (!output) return []
      
      return output.split('\n').map(line => {
        const [hash, message, author, date] = line.split('|')
        return { hash: hash.slice(0, 8), message, author, date }
      })
    } catch {
      return []
    }
  }

  /**
   * 获取工作区变更的 diff（未暂存的修改）
   */
  getWorkingDiff(cwd: string): string {
    try {
      return execSync('git diff', { cwd, encoding: 'utf-8', stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 })
    } catch {
      return ''
    }
  }

  /**
   * 获取暂存区的 diff
   */
  getStagedDiff(cwd: string): string {
    try {
      return execSync('git diff --cached', { cwd, encoding: 'utf-8', stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 })
    } catch {
      return ''
    }
  }

  /**
   * 获取两个 commit 之间的 diff
   */
  getDiffBetween(cwd: string, from: string, to = 'HEAD'): string {
    try {
      return execSync(`git diff ${from}..${to}`, { cwd, encoding: 'utf-8', stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 })
    } catch (e) {
      throw new Error(`Failed to get diff: ${(e as Error).message}`)
    }
  }

  /**
   * 获取变更文件列表（stat 模式）
   */
  getChangedFiles(cwd: string, from?: string, to = 'HEAD'): Array<{ file: string; additions: number; deletions: number }> {
    try {
      const cmd = from
        ? `git diff --numstat ${from}..${to}`
        : 'git diff --numstat'
      
      const output = execSync(cmd, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim()
      if (!output) return []

      return output.split('\n').map(line => {
        const [add, del, file] = line.split('\t')
        return {
          file,
          additions: add === '-' ? 0 : parseInt(add, 10),
          deletions: del === '-' ? 0 : parseInt(del, 10),
        }
      })
    } catch {
      return []
    }
  }

  /**
   * 获取仓库状态概要
   */
  getStatus(cwd: string): {
    branch: string
    isClean: boolean
    staged: number
    modified: number
    untracked: number
  } {
    try {
      const branch = this.getCurrentBranch(cwd)
      const statusOutput = execSync('git status --porcelain', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim()
      
      if (!statusOutput) {
        return { branch, isClean: true, staged: 0, modified: 0, untracked: 0 }
      }

      const lines = statusOutput.split('\n')
      let staged = 0, modified = 0, untracked = 0

      for (const line of lines) {
        const indexStatus = line[0]
        const workStatus = line[1]
        if (indexStatus !== ' ' && indexStatus !== '?') staged++
        if (workStatus === 'M' || workStatus === 'D') modified++
        if (indexStatus === '?') untracked++
      }

      return { branch, isClean: false, staged, modified, untracked }
    } catch {
      return { branch: 'unknown', isClean: true, staged: 0, modified: 0, untracked: 0 }
    }
  }

  /**
   * 为 Diff Review 生成摘要
   * 解析 diff 输出，统计变更规模，提供 review 上下文
   */
  generateDiffSummary(diff: string): {
    filesChanged: number
    totalAdditions: number
    totalDeletions: number
    files: Array<{ path: string; additions: number; deletions: number }>
  } {
    const files: Array<{ path: string; additions: number; deletions: number }> = []
    let currentFile = ''
    let additions = 0
    let deletions = 0

    for (const line of diff.split('\n')) {
      if (line.startsWith('diff --git')) {
        if (currentFile) {
          files.push({ path: currentFile, additions, deletions })
        }
        const match = line.match(/b\/(.+)$/)
        currentFile = match?.[1] || ''
        additions = 0
        deletions = 0
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++
      }
    }

    if (currentFile) {
      files.push({ path: currentFile, additions, deletions })
    }

    return {
      filesChanged: files.length,
      totalAdditions: files.reduce((sum, f) => sum + f.additions, 0),
      totalDeletions: files.reduce((sum, f) => sum + f.deletions, 0),
      files,
    }
  }
}
