import { randomUUID } from 'crypto'
import { ProviderJournal } from './providers/journal.js'
import { execFileSync } from 'child_process'
import { existsSync, linkSync, unlinkSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'fs'
import { join, relative, resolve } from 'path'
import type { AgentWorkspace } from '../types/index.js'
import { resolveProjectDirectory } from './project-directory.js'

export interface ExecutionWorkspace extends AgentWorkspace {
  execution: {
    workspaceTurnId?: string
    repository: string
    projectDirectory: string
    cwd: string
    baseBranch: string
    baseCommit: string
    inputCommit: string
    requiredParents: string[]
    predecessorTurnIds?: string[]
    headCommit?: string
  }
}

/** Local-only execution ledger. Never imported from workflow sync or supplied by an agent. */
export class ExecutionWorkspaceStore {
  readonly providers: ProviderJournal
  constructor(readonly root: string) {
    this.providers = new ProviderJournal(join(root, 'providers'))
  }

  private id(value: string): string {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new Error('Invalid workspace identifier')
    return value
  }

  has(turnId: string): boolean { return existsSync(this.manifest(turnId)) }

  private manifest(turnId: string): string { return join(this.root, 'turns', `${this.id(turnId)}.json`) }

  git(cwd: string, args: string[]): string {
    return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
      '-c', 'user.name=AgentFlow', '-c', 'user.email=agent-flow@localhost', ...args], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
    }).trim()
  }

  private save(path: string, data: unknown): void {
    mkdirSync(resolve(path, '..'), { recursive: true })
    const temporary = `${path}.${randomUUID()}.tmp`
    writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 })
    renameSync(temporary, path)
  }

  get(turnId: string): ExecutionWorkspace | undefined {
    const path = this.manifest(turnId)
    if (!existsSync(path)) return undefined
    const workspace = JSON.parse(readFileSync(path, 'utf8')) as ExecutionWorkspace
    if (workspace.turnId !== turnId || !workspace.execution) throw new Error('Invalid workspace manifest')
    this.assertWorkspace(workspace)
    return workspace
  }

  list(): ExecutionWorkspace[] {
    const directory = join(this.root, 'turns')
    if (!existsSync(directory)) return []
    return readdirSync(directory).filter(file => file.endsWith('.json'))
      .map(file => this.get(file.slice(0, -5))!).sort((a, b) => a.createdAt - b.createdAt)
  }

  private assertWorkspace(workspace: ExecutionWorkspace): void {
    const mount = workspace.repoMounts[0]
    const expected = join(this.root, 'trees', this.id(workspace.runId), this.id(workspace.execution.workspaceTurnId || workspace.turnId))
    if (!mount || mount.mode !== 'worktree' || realpathSync(mount.mountPath) !== realpathSync(expected)) {
      throw new Error('Execution worktree is missing or has moved')
    }
    const common = (cwd: string) => realpathSync(resolve(cwd, this.git(cwd, ['rev-parse', '--git-common-dir'])))
    if (common(mount.mountPath) !== common(workspace.execution.repository) ||
        this.git(mount.mountPath, ['branch', '--show-current']) !== mount.branch) {
      throw new Error('Execution worktree identity changed')
    }
    resolveProjectDirectory(mount.mountPath, workspace.execution.cwd)
  }

  prepare(params: {
    turnId: string; nodeId: string; runId: string; agentId: string; projectPath: string
    scriptCwd?: string; previousTurnId?: string; predecessorTurnIds: string[]
  }): ExecutionWorkspace {
    const { turnId, nodeId, runId, agentId } = params
    this.id(turnId); this.id(runId); this.id(nodeId)
    if (existsSync(this.manifest(turnId))) throw new Error('Turn already has a workspace')
    const project = realpathSync(params.projectPath)
    const repository = realpathSync(this.git(project, ['rev-parse', '--show-toplevel']))
    const projectDirectory = relative(repository, project)
    const runPath = join(this.root, 'runs', `${runId}.json`)
    let baseline: { repository: string; baseCommit: string; baseBranch: string }
    if (existsSync(runPath)) {
      baseline = JSON.parse(readFileSync(runPath, 'utf8'))
      if (baseline.repository !== repository) throw new Error('Run repository changed; create a new run')
    } else {
      if (this.git(repository, ['status', '--porcelain', '--untracked-files=normal'])) {
        throw new Error('项目有未提交修改；请先提交所需代码，再开始隔离执行（不会自动提交或清理项目）')
      }
      const baseBranch = this.git(repository, ['branch', '--show-current'])
      if (!baseBranch) throw new Error('Project must have a checked-out branch')
      if (this.git(repository, ['ls-files', '--stage']).split('\n').some(line => line.startsWith('160000 '))) {
        throw new Error('Submodule projects require an explicit checkout strategy before isolated execution')
      }
      baseline = { repository, baseBranch, baseCommit: this.git(repository, ['rev-parse', '--verify', 'HEAD']) }
      // Publish a complete baseline exactly once, even when different workers start together.
      const temporary = `${runPath}.${randomUUID()}.tmp`
      mkdirSync(resolve(runPath, '..'), { recursive: true })
      writeFileSync(temporary, JSON.stringify(baseline), { mode: 0o600 })
      try { linkSync(temporary, runPath) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      } finally { unlinkSync(temporary) }
      baseline = JSON.parse(readFileSync(runPath, 'utf8'))
      if (baseline.repository !== repository) throw new Error('Run repository changed; create a new run')
    }
    const predecessorTurnIds = [...new Set(params.predecessorTurnIds)].sort()
    const parents: string[] = []
    for (const parentId of predecessorTurnIds) {
      const parent = this.assertSnapshot(parentId)
      if (parent.runId !== runId || parent.execution.repository !== repository) {
        throw new Error('Predecessor execution workspace is unavailable')
      }
      parents.push(parent.execution.headCommit!)
    }
    let inputCommit = parents[0] || baseline.baseCommit
    if (params.previousTurnId) {
      const previous = this.get(params.previousTurnId)
      if (!previous || previous.runId !== runId || previous.nodeId !== nodeId) throw new Error('Previous execution workspace is unavailable')
      // Only a retry of the same inputs may inherit its old edits. Changed upstream input starts afresh.
      if (JSON.stringify(previous.execution.predecessorTurnIds || []) === JSON.stringify(predecessorTurnIds)) {
        inputCommit = this.snapshot(previous.turnId)
      }
    }
    const mountPath = join(this.root, 'trees', runId, turnId)
    mkdirSync(resolve(mountPath, '..'), { recursive: true })
    const branch = `codex/flow-${runId}-${turnId}`
    this.git(repository, ['worktree', 'add', '-b', branch, mountPath, inputCommit])
    const workspace: ExecutionWorkspace = {
      turnId, nodeId, runId, agentId, basePath: mountPath, createdAt: Date.now(),
      repoMounts: [{ repoId: `execution-${runId}`, mountPath, mode: 'worktree', branch, permissions: 'read-write' }],
      execution: { ...baseline, projectDirectory, cwd: mountPath, inputCommit, requiredParents: [inputCommit, ...parents], predecessorTurnIds },
    }
    this.save(this.manifest(turnId), workspace)
    try {
      for (const parent of [...new Set(parents)]) this.git(mountPath, ['merge', '--no-edit', parent])
      workspace.execution.inputCommit = this.git(mountPath, ['rev-parse', 'HEAD'])
      const projectRoot = resolveProjectDirectory(mountPath, projectDirectory)
      workspace.execution.cwd = resolveProjectDirectory(projectRoot, params.scriptCwd)
      this.save(this.manifest(turnId), workspace)
    } catch (error) {
      throw new Error(`Workspace assembly failed; preserved worktree: ${mountPath}. ${(error as Error).message}`)
    }
    return workspace
  }

  resume(turnId: string, previousTurnId: string): ExecutionWorkspace {
    if (existsSync(this.manifest(turnId))) throw new Error('Turn already has a workspace')
    const previous = this.get(previousTurnId)
    if (!previous) throw new Error('Recovery workspace missing')
    // Keep the same cwd: providers persist path-sensitive tool context in the transcript.
    const inputCommit = this.snapshot(previousTurnId)
    const workspace: ExecutionWorkspace = { ...previous, turnId, createdAt: Date.now(), execution: {
      ...previous.execution, workspaceTurnId: previous.execution.workspaceTurnId || previous.turnId,
      inputCommit, requiredParents: [inputCommit], headCommit: undefined,
    } }
    this.save(this.manifest(turnId), workspace)
    return workspace
  }

  snapshot(turnId: string): string {
    const workspace = this.get(turnId)
    if (!workspace) throw new Error('Execution workspace missing')
    const cwd = workspace.repoMounts[0].mountPath
    if (this.git(cwd, ['ls-files', '--unmerged'])) throw new Error('Unresolved conflicts in execution worktree')
    if (this.git(cwd, ['status', '--porcelain', '--untracked-files=normal'])) {
      this.git(cwd, ['add', '--all', '--', '.'])
      this.git(cwd, ['commit', '-m', `AgentFlow turn ${turnId}`])
    }
    for (const parent of workspace.execution.requiredParents) {
      this.git(cwd, ['merge-base', '--is-ancestor', parent, 'HEAD'])
    }
    workspace.execution.headCommit = this.git(cwd, ['rev-parse', 'HEAD'])
    this.save(this.manifest(turnId), workspace)
    return workspace.execution.headCommit
  }

  assertSnapshot(turnId: string, expectedHead?: string): ExecutionWorkspace {
    const workspace = this.get(turnId)
    if (!workspace?.execution.headCommit) throw new Error('Execution has no finalized code snapshot')
    const cwd = workspace.repoMounts[0].mountPath
    if (this.git(cwd, ['status', '--porcelain', '--untracked-files=normal']) ||
        this.git(cwd, ['rev-parse', 'HEAD']) !== workspace.execution.headCommit ||
        (expectedHead && expectedHead !== workspace.execution.headCommit)) {
      throw new Error('Code changed since the execution snapshot; retry and verify before delivery')
    }
    return workspace
  }
}
